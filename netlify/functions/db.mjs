// ════════════════════════════════════════════════════════════════════════
//  Team Hours Tracker — proxy serverless verso Neon Postgres
//  Netlify Function. La connection string vive SOLO qui (env var DATABASE_URL),
//  mai nel browser. Il client invia { action, payload }; ogni action esegue
//  query SQL FISSE e PARAMETRIZZATE: niente SQL arbitrario dal client.
//  Le tabelle utenti_pwd/config sono accessibili solo da qui (le password
//  non escono mai: i check ritornano un boolean, mai l'hash).
// ════════════════════════════════════════════════════════════════════════
import { neon }    from '@neondatabase/serverless';
import nodemailer   from 'nodemailer';

const sql = neon(process.env.DATABASE_URL);

// ── letture: un'unica bootstrap che restituisce tutto lo stato ──
async function bootstrap(){
  // Crea la join table dei TL multipli se non esiste + migrazione one-time
  await sql`CREATE TABLE IF NOT EXISTS progetto_team_leads (
    progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    risorsa_id  INTEGER NOT NULL REFERENCES risorse(id)  ON DELETE CASCADE,
    PRIMARY KEY (progetto_id, risorsa_id)
  )`;
  await sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id)
    SELECT id, team_lead_id FROM progetti WHERE team_lead_id IS NOT NULL
    ON CONFLICT DO NOTHING`;
  await sql`ALTER TABLE ferie ADD COLUMN IF NOT EXISTS ora_inizio TEXT`;
  await sql`ALTER TABLE ferie ADD COLUMN IF NOT EXISTS ora_fine TEXT`;
  await sql`ALTER TABLE ferie DROP CONSTRAINT IF EXISTS ferie_tipo_check`;
  await sql`ALTER TABLE ferie ADD CONSTRAINT ferie_tipo_check CHECK (tipo IN ('Ferie', 'Malattia', 'Permesso/ROL'))`;
  await sql`ALTER TABLE reperibilita ADD COLUMN IF NOT EXISTS etichetta TEXT DEFAULT ''`;
  await sql`ALTER TABLE reperibilita DROP CONSTRAINT IF EXISTS reperibilita_risorse_id_progetto_id_anno_mese_key`;
  await sql`ALTER TABLE reperibilita DROP CONSTRAINT IF EXISTS reperibilita_risorsa_id_progetto_id_anno_mese_key`;
  await sql`DROP INDEX IF EXISTS reperibilita_risorse_id_progetto_id_anno_mese_key`;
  await sql`DROP INDEX IF EXISTS reperibilita_risorsa_id_progetto_id_anno_mese_key`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS rep_unique_per_turno ON reperibilita (risorsa_id, progetto_id, anno, mese, COALESCE(etichetta,''))`;
  await sql`CREATE TABLE IF NOT EXISTS daily_hours (
    id         BIGSERIAL    PRIMARY KEY,
    risorsa_id INTEGER      NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
    data       DATE         NOT NULL,
    ore        NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP    DEFAULT NOW(),
    updated_at TIMESTAMP    DEFAULT NOW(),
    UNIQUE (risorsa_id, data)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS email_log (
    id           BIGSERIAL PRIMARY KEY,
    tipo         TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    nome         TEXT,
    oggetto      TEXT,
    stato        TEXT NOT NULL,
    errore       TEXT,
    meta         JSONB,
    created_at   TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC)`;
  // Reminder giornaliero: attivo di default per tutti (anche per le righe già esistenti)
  await sql`ALTER TABLE risorse ADD COLUMN IF NOT EXISTS daily_reminder BOOLEAN NOT NULL DEFAULT TRUE`;

  const [progetti, risorse, allocazioni, ore, ferie, rep, wbsRows, repTipiRows] = await Promise.all([
    sql`SELECT p.id, p.nome, p.wbs,
          COALESCE(
            ARRAY_AGG(r.full_name ORDER BY r.cognome, r.nome)
            FILTER (WHERE r.id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS team_lead_names
        FROM progetti p
        LEFT JOIN progetto_team_leads ptl ON p.id = ptl.progetto_id
        LEFT JOIN risorse r ON ptl.risorsa_id = r.id
        GROUP BY p.id, p.nome, p.wbs
        ORDER BY p.nome`,
    sql`SELECT id, nome, cognome, full_name, email, manager_id, is_manager, load_cost, daily_reminder FROM risorse ORDER BY cognome, nome`,
    sql`SELECT risorsa_id, progetto_id FROM allocazioni`,
    sql`SELECT id, risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2 FROM ore_mensili`,
    sql`SELECT id, risorsa_id, data_inizio, data_fine, tipo, note, ora_inizio, ora_fine FROM ferie`,
    sql`SELECT id, risorsa_id, progetto_id, team_lead_id, anno, mese, giorni, etichetta FROM reperibilita`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 4) = 'wbs_'`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 9) = 'rep_tipi_'`
  ]);
  const wbs = {};
  wbsRows.forEach(r => {
    const key = r.chiave.substring(4); // strip 'wbs_' prefix → '{risorsaId}_{anno}_{mese}'
    try { wbs[key] = JSON.parse(r.valore); } catch {}
  });
  const repTipi = {};
  repTipiRows.forEach(r => {
    const pid = r.chiave.substring(9); // strip 'rep_tipi_' prefix → progetto_id
    try { repTipi[pid] = JSON.parse(r.valore); } catch {}
  });
  return { progetti, risorse, allocazioni, ore, ferie, rep, wbs, repTipi };
}

// ── ore (upsert sul vincolo UNIQUE risorsa_id,anno,mese) ──
async function saveOre(p){
  await sql`
    INSERT INTO ore_mensili (risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2)
    VALUES (${p.risorsaId}, ${p.anno}, ${p.mese}, ${p.ore_q1}, ${p.note_q1}, ${p.ore_q2}, ${p.note_q2})
    ON CONFLICT (risorsa_id, anno, mese)
    DO UPDATE SET ore_q1=EXCLUDED.ore_q1, note_q1=EXCLUDED.note_q1,
                  ore_q2=EXCLUDED.ore_q2, note_q2=EXCLUDED.note_q2
  `;
}
async function deleteOre(p){ await sql`DELETE FROM ore_mensili WHERE id=${p.id}`; }

// ── ferie ──
async function saveFerie(p){
  const oraInizio = (p.tipo === 'Permesso/ROL' && p.oraInizio) ? p.oraInizio : null;
  const oraFine   = (p.tipo === 'Permesso/ROL' && p.oraFine)   ? p.oraFine   : null;
  await sql`INSERT INTO ferie (risorsa_id, data_inizio, data_fine, tipo, note, ora_inizio, ora_fine)
            VALUES (${p.risorsaId}, ${p.start}, ${p.end}, ${p.tipo}, ${p.note}, ${oraInizio}, ${oraFine})`;
  // Notifica email ai TL — awaited, errori catturati per non bloccare il salvataggio
  let notifica = { sent: 0, reason: 'ok' };
  try { notifica = await sendAbsenceNotification(p); }
  catch (err) { console.error('[absence-notify]', err.message); notifica = { sent: 0, reason: 'error', error: err.message }; }
  return notifica;
}
async function deleteFerie(p){ await sql`DELETE FROM ferie WHERE id=${p.id}`; }

// ════════════════════════════════════════════════════════════════════════
//  Notifica assenza — invia email ai TL dei progetti della risorsa
// ════════════════════════════════════════════════════════════════════════

// Scrive una riga in email_log. Non deve mai far fallire l'invio: errori silenziati.
async function _logEmail(tipo, destinatario, nome, oggetto, stato, errore, meta) {
  try {
    await sql`INSERT INTO email_log (tipo, destinatario, nome, oggetto, stato, errore, meta)
              VALUES (${tipo}, ${destinatario}, ${nome || null}, ${oggetto || null},
                      ${stato}, ${errore || null}, ${meta ? JSON.stringify(meta) : null})`;
  } catch (e) { console.error('[email_log]', e.message); }
}

function _absenceTransporter() {
  return nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// "2026-09-01" → "01/09/2026"
function _fmtDateIT(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Tipo → colori email
function _tipoColor(tipo) {
  if (tipo === 'Ferie')        return { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' };
  if (tipo === 'Malattia')     return { bg: '#fee2e2', text: '#dc2626', border: '#fca5a5' };
  return                              { bg: '#fef3c7', text: '#d97706', border: '#fcd34d' }; // Permesso/ROL
}

// Espande [start, end] in array di ISO date
function _expandDays(start, end) {
  const days = [];
  let cur = new Date(start + 'T12:00:00Z');
  const fin = new Date(end   + 'T12:00:00Z');
  while (cur <= fin) { days.push(cur.toISOString().split('T')[0]); cur.setUTCDate(cur.getUTCDate() + 1); }
  return days;
}

// Costruisce mappa overlap: { progetto → { isoDay → [{name, tipo}] } }
// La nuova assenza (newName/tipo) appare in ogni giorno dove c'è almeno un collega
function _buildOverlapMap(newName, tipo, start, end, overlaps) {
  const days = _expandDays(start, end);
  const map  = {};
  overlaps.forEach(ov => {
    const ovS = new Date(ov.data_inizio + 'T12:00:00Z');
    const ovE = new Date(ov.data_fine   + 'T12:00:00Z');
    days.forEach(day => {
      const d = new Date(day + 'T12:00:00Z');
      if (d < ovS || d > ovE) return;
      if (!map[ov.progetto])       map[ov.progetto] = {};
      if (!map[ov.progetto][day])  map[ov.progetto][day] = [{ name: newName, tipo }];
      if (!map[ov.progetto][day].some(x => x.name === ov.full_name))
        map[ov.progetto][day].push({ name: ov.full_name, tipo: ov.tipo });
    });
  });
  return map;
}

async function sendAbsenceNotification(p) {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
  const FROM_NAME  = process.env.FROM_NAME || 'Team Hours Tracker';
  if (!GMAIL_USER || !GMAIL_PASS) return { sent: 0, reason: 'no_smtp' };

  // 1. Risorsa che ha salvato l'assenza
  const [risorsa] = await sql`SELECT full_name FROM risorse WHERE id = ${p.risorsaId}`;
  if (!risorsa) return { sent: 0, reason: 'no_resource' };
  const personName = risorsa.full_name;

  // 2. TL dei progetti della risorsa (esclusa la risorsa stessa, con email valida)
  const tlRows = await sql`
    SELECT DISTINCT r.full_name, r.email, proj.nome AS progetto
    FROM allocazioni a
    JOIN progetti proj ON proj.id = a.progetto_id
    JOIN progetto_team_leads ptl ON ptl.progetto_id = proj.id
    JOIN risorse r ON r.id = ptl.risorsa_id
    WHERE a.risorsa_id = ${p.risorsaId}
      AND ptl.risorsa_id != ${p.risorsaId}
      AND r.email IS NOT NULL AND r.email <> ''
    ORDER BY r.email, proj.nome`;
  if (!tlRows.length) {
    await _logEmail('assenza', '—', personName, `[Nuova assenza] ${personName}`, 'skipped',
                    'Nessun Team Leader con email sui progetti della risorsa',
                    { risorsa: personName, tipo: p.tipo, dal: p.start, al: p.end });
    return { sent: 0, reason: 'no_tl' };
  }

  // 3. Progetti della risorsa
  const projRows = await sql`
    SELECT proj.nome
    FROM allocazioni a
    JOIN progetti proj ON proj.id = a.progetto_id
    WHERE a.risorsa_id = ${p.risorsaId}
    ORDER BY proj.nome`;
  const progetti = projRows.map(r => r.nome);

  // 4. Sovrapposizioni con altri colleghi sugli stessi progetti
  const overlapRows = await sql`
    SELECT DISTINCT
      f.risorsa_id, r.full_name, f.data_inizio::text AS data_inizio,
      f.data_fine::text AS data_fine, f.tipo, proj.nome AS progetto
    FROM ferie f
    JOIN risorse r      ON r.id   = f.risorsa_id
    JOIN allocazioni a  ON a.risorsa_id = f.risorsa_id
    JOIN progetti proj  ON proj.id = a.progetto_id
    WHERE f.risorsa_id != ${p.risorsaId}
      AND a.progetto_id IN (
        SELECT progetto_id FROM allocazioni WHERE risorsa_id = ${p.risorsaId}
      )
      AND f.data_fine   >= ${p.start}::date
      AND f.data_inizio <= ${p.end}::date
    ORDER BY progetto, data_inizio, full_name`;

  const overlapMap = _buildOverlapMap(personName, p.tipo, p.start, p.end, overlapRows);
  const hasOverlap = Object.keys(overlapMap).length > 0;

  // 5. Deduplicazione TL per email
  const tlByEmail = {};
  tlRows.forEach(tl => {
    if (!tlByEmail[tl.email]) tlByEmail[tl.email] = { name: tl.full_name, email: tl.email };
  });

  // 6. Invio email
  const mailer  = _absenceTransporter();
  const subject = `[Nuova assenza] ${personName}`;
  const html    = buildAbsenceEmailHtml(personName, p, progetti, overlapMap, hasOverlap);
  const text    = buildAbsenceEmailText(personName, p, progetti, overlapMap, hasOverlap);

  const meta = { risorsa: personName, tipo: p.tipo, dal: p.start, al: p.end, progetti, overlap: hasOverlap };
  let sent = 0, failed = 0;
  const destinatari = [];
  for (const tl of Object.values(tlByEmail)) {
    try {
      const info = await mailer.sendMail({
        from: `${FROM_NAME} <${GMAIL_USER}>`,
        to:   tl.email,
        subject, html, text
      });
      const rejected = info?.rejected || [];
      const infoMeta = { ...meta, messageId: info?.messageId || null,
                         response: info?.response || null, rejected };
      if (rejected.length) {
        // sendMail risolve anche con destinatari rifiutati
        failed++;
        console.error(`[absence-notify] ✗ ${tl.email}: rifiutato — ${info?.response || ''}`);
        await _logEmail('assenza', tl.email, tl.name, subject, 'error', 'Destinatario rifiutato da SMTP', infoMeta);
      } else {
        sent++;
        destinatari.push(tl.name);
        console.log(`[absence-notify] ✓ ${tl.email} — ${personName} ${p.tipo} ${p.start}→${p.end}`);
        await _logEmail('assenza', tl.email, tl.name, subject, 'sent', null, infoMeta);
      }
    } catch (err) {
      failed++;
      console.error(`[absence-notify] ✗ ${tl.email}: ${err.message}`);
      await _logEmail('assenza', tl.email, tl.name, subject, 'error', err.message,
                      { ...meta, code: err.code || null, responseCode: err.responseCode || null });
    }
  }
  return { sent, failed, destinatari, reason: failed && !sent ? 'error' : 'ok' };
}

function buildAbsenceEmailText(personName, p, progetti, overlapMap, hasOverlap) {
  const col = _tipoColor(p.tipo);
  let t = `Team Hours Tracker — Nuova assenza\n\n`;
  t += `${personName} ha inserito una nuova assenza.\n\n`;
  t += `Tipo: ${p.tipo}\n`;
  t += `Periodo: ${_fmtDateIT(p.start)} - ${_fmtDateIT(p.end)}\n`;
  t += `\nProgetti coinvolti:\n${progetti.map(n => `- ${n}`).join('\n')}\n`;
  if (hasOverlap) {
    t += `\n⚠️ SONO PRESENTI ASSENZE CONTEMPORANEE:\n\n`;
    Object.entries(overlapMap).forEach(([prog, byDay]) => {
      t += `${prog}\n`;
      Object.entries(byDay).sort(([a],[b])=>a.localeCompare(b)).forEach(([day, people]) => {
        t += `  ${_fmtDateIT(day)}\n`;
        people.forEach(x => { t += `  - ${x.name} (${x.tipo})\n`; });
      });
      t += '\n';
    });
  } else {
    t += `\nNessuna sovrapposizione rilevata.\n`;
  }
  t += `\n---\nMessaggio automatico generato da Team Hours Tracker.`;
  return t;
}

function buildAbsenceEmailHtml(personName, p, progetti, overlapMap, hasOverlap) {
  const col    = _tipoColor(p.tipo);
  const period = p.start === p.end
    ? _fmtDateIT(p.start)
    : `${_fmtDateIT(p.start)} — ${_fmtDateIT(p.end)}`;

  // ── sezione sovrapposizioni ──
  let overlapHtml = '';
  if (hasOverlap) {
    let ovBody = '';
    Object.entries(overlapMap).forEach(([prog, byDay]) => {
      ovBody += `
        <tr><td colspan="2" style="padding:10px 0 4px;font-family:Arial,Helvetica,sans-serif;
            font-size:13px;font-weight:700;color:#92400e;">${prog}</td></tr>`;
      Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b)).forEach(([day, people]) => {
        ovBody += `
        <tr><td colspan="2" style="padding:4px 0 2px;font-family:Arial,Helvetica,sans-serif;
            font-size:12px;color:#78350f;font-weight:600;">${_fmtDateIT(day)}</td></tr>`;
        people.forEach(x => {
          const pc = _tipoColor(x.tipo);
          ovBody += `
        <tr>
          <td style="padding:2px 0 2px 12px;font-family:Arial,Helvetica,sans-serif;
              font-size:12px;color:#451a03;">• ${x.name}</td>
          <td style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;">
            <span style="background:${pc.bg};color:${pc.text};border-radius:3px;
                padding:1px 6px;font-weight:600;">${x.tipo}</span>
          </td>
        </tr>`;
        });
      });
    });
    overlapHtml = `
      <tr>
        <td style="padding:0 40px 32px;background-color:#ffffff;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:6px;overflow:hidden;">
            <tr>
              <td bgcolor="#fef3c7" style="background-color:#fef3c7;padding:12px 16px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;
                   font-weight:700;color:#92400e;">&#9888;&#65039; Sono presenti assenze contemporanee</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${ovBody}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  } else {
    overlapHtml = `
      <tr>
        <td style="padding:0 40px 32px;background-color:#ffffff;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
            <tr>
              <td style="padding:12px 16px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;
                   color:#166534;">&#10003; Nessuna sovrapposizione rilevata.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  // ── progetti list ──
  const progettiHtml = progetti.map(n =>
    `<tr><td style="padding:2px 0 2px 0;font-family:Arial,Helvetica,sans-serif;
       font-size:13px;color:#374151;">• ${n}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Nuova assenza — ${personName}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>table{border-collapse:collapse;}</style>
<![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
@media(prefers-color-scheme:dark){
  .dm-outer{background-color:#1e1e2e!important;}
  .dm-card{background-color:#2a2a3e!important;}
  .dm-body{background-color:#2a2a3e!important;}
  .dm-foot{background-color:#222230!important;}
  .dm-title{color:#e8e8e8!important;}
  .dm-sub{color:#bbbbbb!important;}
  .dm-label{color:#aaaaaa!important;}
  .dm-value{color:#ffffff!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       class="dm-outer" style="background-color:#f0f2f5;">
  <tr><td align="center" valign="top" style="padding:40px 16px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
           class="dm-card" style="max-width:600px;width:100%;background-color:#ffffff;">

      <!-- HEADER -->
      <tr>
        <td align="center" bgcolor="#A100FF"
            style="background-color:#A100FF;padding:28px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;
                    font-family:Arial,Helvetica,sans-serif;">Team Hours Tracker</p>
          <p style="margin:6px 0 0;font-size:13px;color:#e8c4ff;
                    font-family:Arial,Helvetica,sans-serif;">Notifica assenza</p>
        </td>
      </tr>

      <!-- INTRO -->
      <tr>
        <td align="left" bgcolor="#ffffff" class="dm-body"
            style="background-color:#ffffff;padding:32px 40px 20px;">
          <p style="margin:0;font-size:16px;font-weight:600;color:#111827;
                    font-family:Arial,Helvetica,sans-serif;" class="dm-title">
            ${personName} ha inserito una nuova assenza.
          </p>
        </td>
      </tr>

      <!-- TIPO + PERIODO -->
      <tr>
        <td bgcolor="#ffffff" class="dm-body"
            style="background-color:#ffffff;padding:0 40px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-right:24px;vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6b7280;
                          text-transform:uppercase;letter-spacing:.06em;
                          font-family:Arial,Helvetica,sans-serif;" class="dm-label">Tipo</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="${col.bg}" style="background-color:${col.bg};border:1px solid ${col.border};
                        border-radius:4px;padding:5px 14px;">
                      <p style="margin:0;font-size:13px;font-weight:700;color:${col.text};
                                font-family:Arial,Helvetica,sans-serif;">${p.tipo}</p>
                    </td>
                  </tr>
                </table>
              </td>
              <td style="vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6b7280;
                          text-transform:uppercase;letter-spacing:.06em;
                          font-family:Arial,Helvetica,sans-serif;" class="dm-label">Periodo</p>
                <p style="margin:0;font-size:14px;font-weight:600;color:#111827;
                          font-family:Arial,Helvetica,sans-serif;" class="dm-value">${period}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- PROGETTI -->
      <tr>
        <td bgcolor="#ffffff" class="dm-body"
            style="background-color:#ffffff;padding:0 40px 28px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#6b7280;
                    text-transform:uppercase;letter-spacing:.06em;
                    font-family:Arial,Helvetica,sans-serif;" class="dm-label">Progetti coinvolti</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            ${progettiHtml}
          </table>
        </td>
      </tr>

      <!-- SOVRAPPOSIZIONI -->
      ${overlapHtml}

      <!-- FOOTER -->
      <tr>
        <td align="center" bgcolor="#f8f9fc" class="dm-foot"
            style="background-color:#f8f9fc;padding:18px 40px;border-top:1px solid #eeeeee;">
          <p style="margin:0;font-size:12px;color:#aaaaaa;
                    font-family:Arial,Helvetica,sans-serif;">
            Messaggio automatico generato da Team Hours Tracker.<br>
            Non rispondere a questa email.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>

</body>
</html>`;
}

// ── progetti (la DELETE sfrutta ON DELETE CASCADE sulle allocazioni) ──
async function addProject(p){
  const wbs = p.wbs || null;
  const [proj] = await sql`INSERT INTO progetti (nome, wbs) VALUES (${p.nome}, ${wbs}) RETURNING id`;
  for(const name of (p.teamLeadNames || [])){
    const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${name}`;
    if(tl) await sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id) VALUES (${proj.id}, ${tl.id}) ON CONFLICT DO NOTHING`;
  }
}
async function addProjectTL(p){
  const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.tlName}`;
  if(!tl) throw new Error('Risorsa non trovata: ' + p.tlName);
  await sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id) VALUES (${p.progettoId}, ${tl.id}) ON CONFLICT DO NOTHING`;
}
async function removeProjectTL(p){
  const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.tlName}`;
  if(!tl) return;
  await sql`DELETE FROM progetto_team_leads WHERE progetto_id=${p.progettoId} AND risorsa_id=${tl.id}`;
}
async function saveProjectLead(p){ /* mantenuto per compatibilità — usa addProjectTL/removeProjectTL */ }
async function saveProjectWbs(p){
  await sql`UPDATE progetti SET wbs=${p.wbs||null} WHERE id=${p.id}`;
}
async function deleteProject(p){ await sql`DELETE FROM progetti WHERE nome=${p.nome}`; }

// ── risorse + allocazioni (full_name lo genera il trigger; team_lead è testo) ──
async function addResource(p){
  const managerId = p.managerId || null;
  const isManager = !!p.isManager;
  const email = p.email || null;
  const loadCost = (p.loadCost != null && p.loadCost !== '') ? +p.loadCost : null;
  const [r] = await sql`INSERT INTO risorse (nome, cognome, email, manager_id, is_manager, load_cost) VALUES (${p.nome}, ${p.cognome}, ${email}, ${managerId}, ${isManager}, ${loadCost}) RETURNING id`;
  for(const nome of (p.progetti || [])){
    await sql`INSERT INTO allocazioni (risorsa_id, progetto_id)
              SELECT ${r.id}, id FROM progetti WHERE nome=${nome}`;
  }
}
async function saveEdit(p){
  const managerId = p.managerId || null;
  const isManager = !!p.isManager;
  const email = p.email || null;
  const loadCost = (p.loadCost != null && p.loadCost !== '') ? +p.loadCost : null;
  await sql`UPDATE risorse SET nome=${p.nome}, cognome=${p.cognome}, email=${email}, manager_id=${managerId}, is_manager=${isManager}, load_cost=${loadCost} WHERE id=${p.id}`;
  await sql`DELETE FROM allocazioni WHERE risorsa_id=${p.id}`;
  for(const nome of (p.progetti || [])){
    await sql`INSERT INTO allocazioni (risorsa_id, progetto_id)
              SELECT ${p.id}, id FROM progetti WHERE nome=${nome}`;
  }
}
async function deleteResource(p){ await sql`DELETE FROM risorse WHERE id=${p.id}`; } // CASCADE

// ── manager assignment (separata dall'edit per aggiornamenti rapidi inline) ──
async function setResourceManager(p){
  const managerId = p.managerId || null;
  await sql`UPDATE risorse SET manager_id=${managerId} WHERE id=${p.risorsaId}`;
}
async function toggleIsManager(p){
  await sql`UPDATE risorse SET is_manager=${!!p.value} WHERE id=${p.risorsaId}`;
}

// ── reminder giornaliero on/off per risorsa ──
async function setDailyReminder(p){
  await sql`UPDATE risorse SET daily_reminder=${!!p.value} WHERE id=${p.risorsaId}`;
}

async function saveRep(p){
  const [proj] = await sql`SELECT id FROM progetti WHERE nome=${p.progetto}`;
  if(!proj) throw new Error('Progetto non trovato: ' + p.progetto);
  let tlId = null;
  if(p.teamLead){
    const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.teamLead}`;
    tlId = tl ? tl.id : null;
  }
  const etichetta = p.etichetta || '';
  await sql`DELETE FROM reperibilita WHERE risorsa_id=${p.risorsaId} AND progetto_id=${proj.id} AND anno=${p.anno} AND mese=${p.mese} AND COALESCE(etichetta,'')=${etichetta}`;
  if(p.giorni && p.giorni.length > 0){
    const [row] = await sql`INSERT INTO reperibilita (risorsa_id, progetto_id, team_lead_id, anno, mese, giorni, etichetta) VALUES (${p.risorsaId}, ${proj.id}, ${tlId}, ${p.anno}, ${p.mese}, ${JSON.stringify(p.giorni)}::jsonb, ${etichetta}) RETURNING id, giorni`;
    return {id: row.id, giorni: row.giorni};
  }
  return {giorni: []};
}
async function deleteRep(p){ await sql`DELETE FROM reperibilita WHERE id=${p.id}`; }
async function getRepForProject(p){
  const [proj] = await sql`SELECT id FROM progetti WHERE nome=${p.progetto}`;
  if(!proj) return [];
  const rows = await sql`SELECT id, risorsa_id, anno, mese, giorni, etichetta FROM reperibilita WHERE progetto_id=${proj.id} AND anno=${p.anno} AND mese=${p.mese}`;
  return rows.map(r=>({id:r.id, risorsaId:+r.risorsa_id, anno:+r.anno, mese:+r.mese, giorni:Array.isArray(r.giorni)?r.giorni.map(Number):[], etichetta:r.etichetta||''}));
}

// ── presenze in ufficio ──
async function getPresenze(p){
  const rows = await sql`SELECT risorsa_id, data::text AS data FROM presenze WHERE data BETWEEN ${p.from}::date AND ${p.to}::date ORDER BY data`;
  return rows;
}
async function savePresenza(p){
  await sql`INSERT INTO presenze (risorsa_id, data) VALUES (${p.risorsaId}, ${p.data}) ON CONFLICT (risorsa_id, data) DO NOTHING`;
}
async function deletePresenza(p){
  await sql`DELETE FROM presenze WHERE risorsa_id=${p.risorsaId} AND data=${p.data}`;
}

// ── password: l'hash entra, ma non esce mai (ritorniamo solo boolean/void) ──
async function userHasPwd(p){
  const [r] = await sql`SELECT 1 FROM utenti_pwd WHERE risorsa_id=${p.risorsaId}`;
  return !!r;
}
async function checkUserPwd(p){
  const [r] = await sql`SELECT 1 FROM utenti_pwd WHERE risorsa_id=${p.risorsaId} AND pwd_hash=${p.hash}`;
  return !!r;
}
async function setUserPwd(p){
  await sql`INSERT INTO utenti_pwd (risorsa_id, pwd_hash) VALUES (${p.risorsaId}, ${p.hash})
            ON CONFLICT (risorsa_id) DO UPDATE SET pwd_hash=EXCLUDED.pwd_hash, updated_at=NOW()`;
}
async function resetUserPwd(p){ await sql`DELETE FROM utenti_pwd WHERE risorsa_id=${p.risorsaId}`; }

// ── rep tipi (stored in config as rep_tipi_{progetto_id}) ──
async function saveRepTipi(p){
  const chiave = `rep_tipi_${p.id}`;
  const valore = JSON.stringify(p.tipi || []);
  await sql`INSERT INTO config (chiave, valore) VALUES (${chiave}, ${valore})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}

// ── WBS (stored in config as wbs_{risorsaId}_{anno}_{mese}) ──
async function saveWbs(p){
  const chiave = `wbs_${p.risorsaId}_${p.anno}_${p.mese}`;
  const valore = JSON.stringify(p.entries || []);
  await sql`INSERT INTO config (chiave, valore) VALUES (${chiave}, ${valore})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}
async function checkAdminPwd(p){
  const [r] = await sql`SELECT 1 FROM config WHERE chiave='admin_pwd' AND valore=${p.hash}`;
  return !!r;
}
async function setAdminPwd(p){
  await sql`INSERT INTO config (chiave, valore) VALUES ('admin_pwd', ${p.hash})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}

// ── email log: ultime N righe, filtrabili per tipo/stato ──
async function getEmailLog(p){
  const limit = Math.min(+p.limit || 100, 500);
  const tipo  = p.tipo  || null;
  const stato = p.stato || null;
  const rows = await sql`
    SELECT id, tipo, destinatario, nome, oggetto, stato, errore, meta,
           to_char(created_at, 'DD/MM/YYYY HH24:MI') AS quando
    FROM email_log
    WHERE (${tipo}::text  IS NULL OR tipo  = ${tipo})
      AND (${stato}::text IS NULL OR stato = ${stato})
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows;
}

// ── consuntivo: scrittura ore giornaliere su daily_hours ──
// ore null/0/'': cancella la riga; altrimenti upsert
async function saveConsuntivo(p){
  const ore=(p.ore!==null&&p.ore!==''&&!isNaN(+p.ore)&&+p.ore>0)?+p.ore:null;
  if(ore===null){
    await sql`DELETE FROM daily_hours WHERE risorsa_id=${p.risorsaId} AND data=${p.data}`;
  }else{
    await sql`INSERT INTO daily_hours (risorsa_id, data, ore, updated_at)
              VALUES (${p.risorsaId}, ${p.data}, ${ore}, NOW())
              ON CONFLICT (risorsa_id, data) DO UPDATE SET ore=EXCLUDED.ore, updated_at=NOW()`;
  }
}

// ── consuntivo: lettura ore giornaliere da daily_hours (sola lettura) ──
async function getConsuntivo(p){
  const anno = +p.anno;
  const mese = +p.mese; // 0-based dal frontend → EXTRACT(MONTH) è 1-based
  const rows = await sql`
    SELECT dh.risorsa_id, dh.data::text AS data, dh.ore::float AS ore, r.full_name
    FROM daily_hours dh
    JOIN risorse r ON r.id = dh.risorsa_id
    WHERE EXTRACT(YEAR  FROM dh.data) = ${anno}
      AND EXTRACT(MONTH FROM dh.data) = ${mese + 1}
    ORDER BY dh.risorsa_id, dh.data`;
  return rows;
}

// ── routing: whitelist esplicita delle action consentite ──
const ACTIONS = {
  bootstrap, saveOre, deleteOre, saveFerie, deleteFerie, addProject, deleteProject, saveProjectLead, saveProjectWbs,
  addProjectTL, removeProjectTL,
  addResource, saveEdit, deleteResource, saveRep, deleteRep, getRepForProject,
  getPresenze, savePresenza, deletePresenza,
  userHasPwd, checkUserPwd, setUserPwd, resetUserPwd, checkAdminPwd, setAdminPwd,
  saveWbs, setResourceManager, toggleIsManager, saveRepTipi,
  getConsuntivo, saveConsuntivo, getEmailLog, setDailyReminder
};

export async function handler(event){
  const headers = { 'Content-Type': 'application/json' };
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  let action, payload;
  try {
    const parsed = JSON.parse(event.body || '{}');
    action = parsed.action; payload = parsed.payload || {};
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body JSON non valido' }) };
  }
  const fn = ACTIONS[action];
  if(!fn){
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action sconosciuta: ' + action }) };
  }
  try {
    const result = await fn(payload);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: result ?? null }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
