// ════════════════════════════════════════════════════════════════════════
//  Team Hours Tracker — proxy serverless verso Neon Postgres
//  Netlify Function. La connection string vive SOLO qui (env var DATABASE_URL),
//  mai nel browser. Il client invia { action, payload } e, dopo il login, il token
//  di sessione (header Authorization: Bearer). Ogni action esegue query SQL FISSE e
//  PARAMETRIZZATE: niente SQL arbitrario dal client. Identità e ruolo sono verificati
//  qui a ogni richiesta (vedi ../lib/auth.mjs): il client non è mai considerato affidabile.
//  Le password non escono mai: si salvano solo come hash scrypt.
// ════════════════════════════════════════════════════════════════════════
import { neon }    from '@neondatabase/serverless';
import nodemailer   from 'nodemailer';
import { createHmac, timingSafeEqual, randomBytes } from 'crypto';
import { HttpError, deny, hashPassword, verifyPassword, checkPwdPolicy, signSession, readSession, pwdVersion,
         isElevated, canManageProject, canActOn, canAdminResource, seesPersonalDetail, maskFerie,
         signInvite, readInvite, INVITE_TTL } from '../lib/auth.mjs';
import { ensureSchema } from '../lib/migrations.mjs';
import * as V from '../lib/validate.mjs';
import { siteUrl } from '../lib/site.mjs';

let sql = neon(process.env.DATABASE_URL);
// Solo per i test automatici: sostituisce il client Neon con un database locale
export function _setSqlForTests(s){ sql = s; }

// ── letture: un'unica bootstrap che restituisce tutto lo stato ──
// Lo schema è gestito da ../lib/migrations.mjs: qui solo letture.
// Load cost ed employee number delle altre risorse sono visibili solo ad admin e manager.
async function bootstrap(ctx){
  const [progetti, risorse, allocazioni, ore, ferie, rep, wbsRows, repTipiRows, aree, soglie, repExpRows, benchRows] = await Promise.all([
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
    sql`SELECT id, nome, cognome, full_name, email, manager_id, is_manager, is_senior, load_cost, daily_reminder, employee_id FROM risorse ORDER BY cognome, nome`,
    sql`SELECT risorsa_id, progetto_id FROM allocazioni`,
    sql`SELECT id, risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2 FROM ore_mensili`,
    sql`SELECT id, risorsa_id, data_inizio, data_fine, tipo, note, ora_inizio, ora_fine FROM ferie`,
    sql`SELECT id, risorsa_id, progetto_id, team_lead_id, anno, mese, giorni, etichetta FROM reperibilita`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 4) = 'wbs_'`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 9) = 'rep_tipi_'`,
    sql`SELECT id, progetto_id, nome, team_lead_id, attiva FROM aree ORDER BY nome`,
    sql`SELECT progetto_id, area_id, soglia, soglia_ee::float AS soglia_ee, attiva, destinatari FROM soglie_ticket`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 11) = 'rep_export_'`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 10) = 'benchmark_'`
  ]);
  const benchmark = {};
  benchRows.forEach(r => {
    try { benchmark[r.chiave.substring(10)] = JSON.parse(r.valore); } catch {}
  });
  const repExport = {};
  repExpRows.forEach(r => {
    try { repExport[r.chiave.substring(11)] = JSON.parse(r.valore); } catch {}
  });
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
  // Dati personali filtrati per ruolo (vedi seesPersonalDetail): l'interfaccia mostra già solo questi,
  // ma senza filtro sul server ogni utente riceveva ore, note e malattie di tutti
  const sees = rid => seesPersonalDetail(ctx, rid);
  if (!isElevated(ctx)) risorse.forEach(r => { if (+r.id !== ctx.id) { r.load_cost = null; r.employee_id = null; r.email = null; } });
  Object.keys(wbs).forEach(k => { if (!sees(k.split('_')[0])) delete wbs[k]; });
  return { progetti, risorse, allocazioni, ore: ore.filter(o => sees(o.risorsa_id)),
           ferie: ferie.map(f => sees(f.risorsa_id) ? f : maskFerie(f)), rep, wbs, repTipi, aree, soglie, repExport, benchmark,
           tema: await _getTema(ctx) };
}

// Alberatura AMS per la classificazione dei ticket: unica fonte, inviata ai client e usata per validare
const TICKET_TREE = {
  L1: {
    'OPERATION': ['Recupero / Ripristino', 'Riavvio', 'Rerun / Riesecuzione', 'Monitoraggio', 'Gestione alert', 'Controllo esito elaborazione', 'Verifica disponibilità servizio'],
    'CONFIGURAZIONE': ['Gestione utenze', 'Gestione accessi', 'Abilitazione / Disabilitazione', 'Parametrizzazione standard', 'Setup standard'],
    'DATA OPERATION': ['Controllo dati', 'Estrazione standard', 'Caricamento standard', 'Controllo file', 'Controllo flussi', 'Recupero elaborazione'],
    'SUPPORTO': ['How-to', 'Supporto utente', 'Check funzionale', 'Raccolta evidenze', 'Verifica segnalazione', 'Escalation']
  },
  L2: {
    'TROUBLESHOOTING': ['Analisi anomalia applicativa', 'Analisi errore tecnico', 'Analisi log', 'Analisi integrazione', 'Analisi performance', 'Analisi dipendenze', 'Identificazione causa'],
    'OPERATION SPECIALISTICA': ['Recovery specialistico', 'Rerun con gestione dipendenze', 'Ripristino flusso', 'Gestione batch', 'Gestione job', 'Sblocco elaborazione', 'Remediation operativa'],
    'CONFIGURAZIONE': ['Configurazione applicativa', 'Parametrizzazione avanzata', 'Configurazione integrazione', 'Configurazione schedulazione', 'Configurazione autorizzazioni', 'Configurazione ambiente'],
    'DATA MANAGEMENT': ['Bonifica dati', 'Correzione dati', 'Rielaborazione dati', 'Allineamento dati', 'Analisi inconsistenze', 'Riconciliazione dati', 'Estrazione'],
    'INTEGRATION': ['Analisi flusso', 'Analisi interfaccia', 'Analisi API', 'Analisi errore integrazione', 'Gestione messaggi / code', 'Ripristino integrazione'],
    'PROBLEM ANALYSIS': ['Analisi incident ricorrenti', 'Root Cause Analysis', 'Analisi impatto', 'Individuazione workaround', 'Identificazione remediation', 'Escalation L3']
  },
  L3: {
    'MANUTENZIONE CORRETTIVA': ['Bug fixing', 'Correzione codice', 'Correzione query / procedure', 'Correzione pipeline', 'Correzione interfaccia', 'Correzione logica applicativa', 'Hotfix'],
    'MANUTENZIONE EVOLUTIVA': ['Modifica funzionalità', 'Nuova funzionalità', 'Enhancement', 'Modifica logica applicativa', 'Modifica logica dati', 'Estensione integrazione'],
    'CONFIGURAZIONE AVANZATA': ['Modifica configurazione strutturale', 'Modifica componenti', 'Modifica integrazione', 'Modifica security / permission', 'Modifica schedulazione complessa', 'Modifica configurazione ambiente'],
    'DATA & DATABASE': ['Modifica schema', 'Modifica data model', 'Modifica procedure', 'Modifica query', 'Ottimizzazione performance', 'Intervento strutturale sui dati'],
    'INTEGRATION & PIPELINE': ['Modifica API / interfaccia', 'Modifica pipeline', 'Modifica flusso', 'Refactoring integrazione', 'Nuova integrazione', 'Re-engineering flusso'],
    'ARCHITETTURA': ['Refactoring', 'Re-engineering', 'Migrazione', 'Modifica architetturale', 'Upgrade tecnologico', 'Introduzione nuovo componente'],
    'RELEASE & DEPLOYMENT': ['Deployment', 'Patch', 'Hotfix release', 'Rollback', 'Supporto UAT', 'Verifica post-release', 'Hypercare']
  }
};

// ── ore (upsert sul vincolo UNIQUE risorsa_id,anno,mese) ──
async function saveOre(p){
  p = { risorsaId: V.id(p.risorsaId, 'Risorsa'), anno: V.anno(p.anno), mese: V.mese(p.mese),
        ore_q1: V.optNum(p.ore_q1, 'Ore I quindicina', 0, 400), note_q1: V.optText(p.note_q1, 'Note I quindicina', 500),
        ore_q2: V.optNum(p.ore_q2, 'Ore II quindicina', 0, 400), note_q2: V.optText(p.note_q2, 'Note II quindicina', 500) };
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
const FERIE_TIPI = ['Ferie', 'Malattia', 'Permesso/ROL'];
async function saveFerie(p){
  p = { ...p, risorsaId: V.id(p.risorsaId, 'Risorsa'), start: V.isoDate(p.start, 'Data inizio'), end: V.isoDate(p.end, 'Data fine'),
        tipo: V.oneOf(p.tipo, FERIE_TIPI, 'Tipo assenza'), note: V.optText(p.note, 'Note', 500),
        oraInizio: V.optTime(p.oraInizio, 'Ora inizio'), oraFine: V.optTime(p.oraFine, 'Ora fine') };
  if (p.end < p.start) throw new HttpError(400, 'La data di fine precede la data di inizio');
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
  // Valori incollati dal pannello Netlify: spazi e a capo vanno tolti. Google mostra la password
  // per app a gruppi ("abcd efgh ijkl mnop"), ma la password vera sono i 16 caratteri senza spazi.
  return nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    auth: { user: String(process.env.GMAIL_USER || '').trim(), pass: String(process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '') }
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
            font-size:13px;font-weight:700;color:#92400e;">${_esc(prog)}</td></tr>`;
      Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b)).forEach(([day, people]) => {
        ovBody += `
        <tr><td colspan="2" style="padding:4px 0 2px;font-family:Arial,Helvetica,sans-serif;
            font-size:12px;color:#78350f;font-weight:600;">${_fmtDateIT(day)}</td></tr>`;
        people.forEach(x => {
          const pc = _tipoColor(x.tipo);
          ovBody += `
        <tr>
          <td style="padding:2px 0 2px 12px;font-family:Arial,Helvetica,sans-serif;
              font-size:12px;color:#451a03;">• ${_esc(x.name)}</td>
          <td style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;">
            <span style="background:${pc.bg};color:${pc.text};border-radius:3px;
                padding:1px 6px;font-weight:600;">${_esc(x.tipo)}</span>
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
<title>Nuova assenza — ${_esc(personName)}</title>
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
  p = { ...p, nome: V.text(p.nome, 'Nome progetto', 200), teamLeadNames: V.arr(p.teamLeadNames, 'Team Lead', 50) };
  const wbs = V.optText(p.wbs, 'WBS', 100);
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
async function deleteProject(p){
  const [pr] = await sql`SELECT id FROM progetti WHERE nome=${p.nome}`;
  if (pr) await sql`DELETE FROM config WHERE chiave=${'benchmark_' + pr.id}`;
  await sql`DELETE FROM progetti WHERE nome=${p.nome}`;
}

// ── risorse + allocazioni (full_name lo genera il trigger; team_lead è testo) ──
// Employee number facoltativo: vuoto = null
function _employeeId(v){
  const s = String(v ?? '').trim();
  if (s.length > 50) throw new Error('Employee number troppo lungo (massimo 50 caratteri)');
  return s || null;
}
// Campi anagrafici comuni ad aggiunta e modifica
function _resFields(p){
  return { ...p, nome: V.text(p.nome, 'Nome', 100), cognome: V.text(p.cognome, 'Cognome', 100), email: V.optEmail(p.email),
           managerId: p.managerId ? V.id(p.managerId, 'Manager') : null, progetti: V.arr(p.progetti, 'Progetti', 200),
           loadCost: V.optNum(p.loadCost, 'Load cost', 0, 1000000),
           managerIds: V.arr(p.managerIds, 'Manager associati', 500).map(x => V.id(x, 'Manager')) };
}
// Senior Manager: i manager associati hanno lui come manager; quelli tolti dall'elenco restano senza manager.
// Non si può associare chi sta sopra di lui nella gerarchia (si creerebbe un ciclo).
async function _setSeniorTeam(smId, ids){
  ids = [...new Set(ids)].filter(id => id !== smId);
  if (ids.length) {
    const up = await sql`
      WITH RECURSIVE a(id) AS (
        SELECT manager_id FROM risorse WHERE id = ${smId} AND manager_id IS NOT NULL
        UNION SELECT r.manager_id FROM risorse r JOIN a ON r.id = a.id WHERE r.manager_id IS NOT NULL
      ) SELECT r.full_name FROM risorse r WHERE r.id IN (SELECT id FROM a) AND r.id = ANY(${ids}::int[])`;
    if (up.length) throw new Error(`${up[0].full_name} è sopra questo Senior Manager nella gerarchia: non può esserne un manager associato`);
  }
  await sql`UPDATE risorse SET manager_id = NULL WHERE manager_id = ${smId} AND is_manager AND id <> ALL(${ids}::int[])`;
  if (ids.length) await sql`UPDATE risorse SET manager_id = ${smId} WHERE id = ANY(${ids}::int[]) AND is_manager`;
}
async function addResource(p){
  p = _resFields(p);
  const managerId = p.managerId || null;
  const isSenior = p.isSenior === true, isManager = !!p.isManager || isSenior;   // il Senior Manager è anche manager
  const email = p.email || null;
  const loadCost = (p.loadCost != null && p.loadCost !== '') ? +p.loadCost : null;
  const employeeId = _employeeId(p.employeeId);
  const [r] = await sql`INSERT INTO risorse (nome, cognome, email, manager_id, is_manager, is_senior, load_cost, employee_id) VALUES (${p.nome}, ${p.cognome}, ${email}, ${managerId}, ${isManager}, ${isSenior}, ${loadCost}, ${employeeId}) RETURNING id`;
  if (isSenior) await _setSeniorTeam(+r.id, p.managerIds);
  for(const nome of (p.progetti || [])){
    await sql`INSERT INTO allocazioni (risorsa_id, progetto_id)
              SELECT ${r.id}, id FROM progetti WHERE nome=${nome}`;
  }
}
async function saveEdit(p){
  p = { ..._resFields(p), id: V.id(p.id, 'Risorsa') };
  // Cambio email: un invito già inviato al vecchio indirizzo non deve più valere
  await sql`DELETE FROM password_invites WHERE risorsa_id=${p.id}
            AND EXISTS (SELECT 1 FROM risorse WHERE id=${p.id} AND lower(COALESCE(email,'')) <> ${p.email || ''})`;
  const managerId = p.managerId || null;
  if (managerId === p.id) throw new Error('Una risorsa non può essere manager di sé stessa');
  // isSenior non inviato (modifica da parte di un manager) = ruolo invariato
  const keepSenior = typeof p.isSenior !== 'boolean', isSenior = p.isSenior === true;
  const isManager = !!p.isManager || isSenior;
  const email = p.email || null;
  const loadCost = (p.loadCost != null && p.loadCost !== '') ? +p.loadCost : null;
  // employeeId non inviato = valore invariato
  const keepEmp = p.employeeId === undefined, employeeId = keepEmp ? null : _employeeId(p.employeeId);
  await sql`UPDATE risorse SET nome=${p.nome}, cognome=${p.cognome}, email=${email}, manager_id=${managerId},
            is_senior = CASE WHEN ${keepSenior}::boolean THEN is_senior ELSE ${isSenior} END,
            is_manager = ${isManager} OR (${keepSenior}::boolean AND is_senior), load_cost=${loadCost},
            employee_id = CASE WHEN ${keepEmp}::boolean THEN employee_id ELSE ${employeeId} END WHERE id=${p.id}`;
  if (!keepSenior && isSenior) await _setSeniorTeam(p.id, p.managerIds);
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
  p = { ...p, risorsaId: V.id(p.risorsaId, 'Risorsa'), anno: V.anno(p.anno), mese: V.mese(p.mese),
        etichetta: V.optText(p.etichetta, 'Turno', 100) || '', teamLead: V.optText(p.teamLead, 'Team Lead', 200),
        giorni: V.arr(p.giorni, 'Giorni', 31).map(d => V.int(d, 'Giorno', 1, 31)) };
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
// Presenze: admin tutte; gli altri le proprie, del proprio team e dei colleghi di progetto (come la griglia)
async function getPresenze(p, ctx){
  p = { from: V.isoDate(p.from, 'Data inizio'), to: V.isoDate(p.to, 'Data fine') };
  const me = ctx.id || 0, all = !!ctx.admin;
  const rows = await sql`SELECT risorsa_id, data::text AS data FROM presenze
    WHERE data BETWEEN ${p.from}::date AND ${p.to}::date
      AND (${all}::boolean OR risorsa_id = ${me} OR risorsa_id = ANY(${[...ctx.team]}::int[])
           OR risorsa_id IN (SELECT a2.risorsa_id FROM allocazioni a1 JOIN allocazioni a2 ON a2.progetto_id = a1.progetto_id WHERE a1.risorsa_id = ${me}))
    ORDER BY data`;
  return rows;
}
async function savePresenza(p){
  V.isoDate(p.data);
  await sql`INSERT INTO presenze (risorsa_id, data) VALUES (${p.risorsaId}, ${p.data}) ON CONFLICT (risorsa_id, data) DO NOTHING`;
}
async function deletePresenza(p){
  await sql`DELETE FROM presenze WHERE risorsa_id=${p.risorsaId} AND data=${p.data}`;
}

// ════════════════════════════════════════════════════════════════════════
//  Login e password. La password viaggia in HTTPS e viene verificata qui (scrypt);
//  gli hash legacy (djb2 calcolato nel browser) vengono riscritti al primo login riuscito.
//  Dopo 10 tentativi falliti in 15 minuti l'account (o l'accesso admin) viene bloccato.
// ════════════════════════════════════════════════════════════════════════
const MAX_FAILS = 10;
async function _throttle(chiave){
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM login_attempts WHERE chiave=${chiave} AND created_at > NOW() - INTERVAL '15 minutes'`;
  if (r.n >= MAX_FAILS) throw new HttpError(429, 'Troppi tentativi falliti: riprova tra 15 minuti');
}
async function _loginFailed(chiave){
  await sql`INSERT INTO login_attempts (chiave) VALUES (${chiave})`;
  await sql`DELETE FROM login_attempts WHERE created_at < NOW() - INTERVAL '1 day'`;
}
async function _loginOk(chiave){ await sql`DELETE FROM login_attempts WHERE chiave=${chiave}`; }

// Primo passo del login: dall'email alla risorsa (nessun altro dato prima dell'autenticazione)
async function loginLookup(p){
  const email = V.optEmail(p.email);
  if (!email) throw new HttpError(400, 'Inserisci un indirizzo email valido.');
  const [r] = await sql`SELECT r.id, r.full_name, (u.risorsa_id IS NOT NULL) AS has_pwd
                        FROM risorse r LEFT JOIN utenti_pwd u ON u.risorsa_id = r.id
                        WHERE lower(r.email) = ${email} ORDER BY r.id LIMIT 1`;
  return r ? { risorsaId: +r.id, fullName: r.full_name, hasPwd: !!r.has_pwd } : null;
}
async function login(p){
  const rid = V.id(p.risorsaId, 'Risorsa'), key = 'u:' + rid;
  await _throttle(key);
  const [u] = await sql`SELECT pwd_hash FROM utenti_pwd WHERE risorsa_id=${rid}`;
  const v = u ? await verifyPassword(u.pwd_hash, p.password) : { ok: false };
  if (!v.ok) { await _loginFailed(key); return { ok: false }; }
  let stored = u.pwd_hash;
  if (v.legacy) {
    stored = await hashPassword(p.password);
    await sql`UPDATE utenti_pwd SET pwd_hash=${stored}, updated_at=NOW() WHERE risorsa_id=${rid}`;
  }
  await _loginOk(key);
  return { ok: true, token: signSession(rid, stored) };
}
// ── Primo accesso e reset: la password si imposta solo dal link d'invito inviato all'email aziendale.
//    Prima bastava conoscere l'email di un account senza password per impostarla al posto del titolare.
let _mailer = null;
// Solo per i test automatici: sostituisce l'SMTP con un trasporto finto
export function _setMailerForTests(m){ _mailer = m; }
function _mail(){
  if (_mailer) return _mailer;
  return process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD ? _absenceTransporter() : null;
}
const MAX_INVITES = 3;   // per risorsa ogni 15 minuti
function _maskEmail(e){ const [u, d] = String(e).split('@'); return (u.length <= 2 ? u[0] + '*' : u.slice(0, 2) + '***') + '@' + d; }

async function _sendInvite(rid){
  const [r] = await sql`SELECT id, full_name, email FROM risorse WHERE id=${rid}`;
  if (!r) throw new HttpError(404, 'Risorsa non trovata');
  if (!r.email) throw new HttpError(400, 'Nessun indirizzo email configurato per questo account: contatta il tuo manager');
  const site = siteUrl(), mailer = _mail();
  if (!site || !mailer) {
    // Nei log di Netlify si vede subito cosa manca (SITE_URL è facoltativo: Netlify fornisce URL)
    const missing = [!site && 'SITE_URL', !process.env.GMAIL_USER && 'GMAIL_USER', !process.env.GMAIL_APP_PASSWORD && 'GMAIL_APP_PASSWORD'].filter(Boolean);
    console.error(JSON.stringify({ level: 'error', action: 'requestInvite', error: 'invio email non configurato', missing }));
    throw new HttpError(503, 'Invio email non configurato: contatta l\'amministratore');
  }
  const nonce = randomBytes(16).toString('hex');
  // Un nuovo invito sostituisce il precedente: i link già inviati non valgono più
  await sql`INSERT INTO password_invites (risorsa_id, nonce, expires_at) VALUES (${rid}, ${nonce}, NOW() + make_interval(secs => ${INVITE_TTL}))
            ON CONFLICT (risorsa_id) DO UPDATE SET nonce=EXCLUDED.nonce, expires_at=EXCLUDED.expires_at, created_at=NOW()`;
  const link = `${site}/?invite=${encodeURIComponent(signInvite(rid, nonce))}`;
  const subject = 'Team Hours Tracker — imposta la tua password';
  const ore = INVITE_TTL / 3600;
  const text = `Ciao ${r.full_name},\n\nper impostare la password di Team Hours Tracker apri questo link (valido ${ore} ore, utilizzabile una sola volta):\n${link}\n\nSe non hai richiesto tu questo link, ignora questa email.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;max-width:520px">
    <p>Ciao <strong>${_esc(r.full_name)}</strong>,</p>
    <p>per impostare la password di <strong>Team Hours Tracker</strong> usa il pulsante qui sotto.</p>
    <p style="margin:24px 0"><a href="${_esc(link)}" style="background:#a100ff;color:#fff;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700">Imposta la password</a></p>
    <p style="font-size:13px;color:#666">Il link è valido ${ore} ore e si può usare una sola volta. Se non hai richiesto tu questo link, ignora questa email.</p></div>`;
  try {
    const info = await mailer.sendMail({ from: `${process.env.FROM_NAME || 'Team Hours Tracker'} <${process.env.GMAIL_USER || 'noreply@localhost'}>`, to: r.email, subject, text, html });
    await _logEmail('invito', r.email, r.full_name, subject, 'sent', null, { messageId: info && info.messageId });
  } catch (err) {
    await _logEmail('invito', r.email, r.full_name, subject, 'error', err.message, null);
    // Nei log di Netlify: 535 = credenziali rifiutate, ETIMEDOUT/ECONNECTION = SMTP non raggiungibile
    console.error(JSON.stringify({ level: 'error', action: 'requestInvite', kind: 'smtp', code: err.code, responseCode: err.responseCode, error: err.message }));
    throw new HttpError(502, 'Invio dell\'email non riuscito: riprova tra poco');
  }
  return { sent: true, email: _maskEmail(r.email) };
}
// Dalla pagina di accesso: chi non ha ancora una password chiede il link d'invito
async function requestInvite(p){
  const rid = V.id(p.risorsaId, 'Risorsa'), key = 'inv:' + rid;
  const [u] = await sql`SELECT 1 FROM utenti_pwd WHERE risorsa_id=${rid}`;
  if (u) throw new HttpError(409, 'Password già impostata: accedi con la tua password');
  const [c] = await sql`SELECT COUNT(*)::int AS n FROM login_attempts WHERE chiave=${key} AND created_at > NOW() - INTERVAL '15 minutes'`;
  if (c.n >= MAX_INVITES) throw new HttpError(429, 'Hai già richiesto il link più volte: controlla la posta o riprova tra 15 minuti');
  const res = await _sendInvite(rid);
  await sql`INSERT INTO login_attempts (chiave) VALUES (${key})`;
  return res;
}
async function _validInvite(token){
  const inv = readInvite(token);
  const bad = () => new HttpError(400, 'Link non valido o scaduto: richiedine uno nuovo dalla pagina di accesso');
  if (!inv) throw bad();
  const [row] = await sql`SELECT r.full_name FROM password_invites i JOIN risorse r ON r.id = i.risorsa_id
                          WHERE i.risorsa_id=${+inv.r} AND i.nonce=${String(inv.n)} AND i.expires_at > NOW()`;
  if (!row) throw bad();
  return { rid: +inv.r, nonce: String(inv.n), fullName: row.full_name };
}
// Apertura del link: a chi appartiene (per salutare l'utente prima che scelga la password)
async function inviteInfo(p){ const v = await _validInvite(p.token); return { fullName: v.fullName }; }
// Impostazione della password dal link: l'invito viene consumato in modo atomico (monouso)
async function firstAccess(p){
  checkPwdPolicy(p.password);
  const v = await _validInvite(p.token);
  const stored = await hashPassword(p.password);
  const used = await sql`DELETE FROM password_invites WHERE risorsa_id=${v.rid} AND nonce=${v.nonce} AND expires_at > NOW() RETURNING risorsa_id`;
  if (!used.length) throw new HttpError(400, 'Link non valido o scaduto: richiedine uno nuovo dalla pagina di accesso');
  await sql`INSERT INTO utenti_pwd (risorsa_id, pwd_hash) VALUES (${v.rid}, ${stored})
            ON CONFLICT (risorsa_id) DO UPDATE SET pwd_hash=EXCLUDED.pwd_hash, updated_at=NOW()`;
  await _loginOk('u:' + v.rid);
  return { ok: true, token: signSession(v.rid, stored), fullName: v.fullName };
}
async function adminLogin(p){
  await _throttle('admin');
  const [r] = await sql`SELECT valore FROM config WHERE chiave='admin_pwd'`;
  const v = r ? await verifyPassword(r.valore, p.password) : { ok: false };
  if (!v.ok) { await _loginFailed('admin'); return { ok: false }; }
  let stored = r.valore;
  if (v.legacy) {
    stored = await hashPassword(p.password);
    await sql`UPDATE config SET valore=${stored} WHERE chiave='admin_pwd'`;
  }
  await _loginOk('admin');
  return { ok: true, token: signSession('admin', stored) };
}
// Cambio password admin: le altre sessioni admin decadono, quella corrente riceve un nuovo token
async function setAdminPwd(p){
  checkPwdPolicy(p.password);
  const stored = await hashPassword(p.password);
  await sql`INSERT INTO config (chiave, valore) VALUES ('admin_pwd', ${stored})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
  return { token: signSession('admin', stored) };
}
// Ripresa della sessione (refresh della pagina, nuova scheda): chi è l'utente + token rinnovato,
// così chi usa l'app con continuità non deve rifare il login ogni 12 ore
async function session(ctx){
  if (ctx.admin) {
    const [r] = await sql`SELECT valore FROM config WHERE chiave='admin_pwd'`;
    return { admin: true, risorsaId: null, fullName: 'ADMIN', token: signSession('admin', r.valore) };
  }
  const [r] = await sql`SELECT r.full_name, u.pwd_hash FROM risorse r JOIN utenti_pwd u ON u.risorsa_id = r.id WHERE r.id=${ctx.id}`;
  return { admin: false, risorsaId: ctx.id, fullName: r.full_name, token: signSession(ctx.id, r.pwd_hash) };
}
async function userHasPwd(p){
  const [r] = await sql`SELECT 1 FROM utenti_pwd WHERE risorsa_id=${p.risorsaId}`;
  return !!r;
}
// Reset: la risorsa tornerà al "primo accesso" e le sue sessioni aperte decadono
async function resetUserPwd(p){
  await sql`DELETE FROM utenti_pwd WHERE risorsa_id=${p.risorsaId}`;
  await sql`DELETE FROM password_invites WHERE risorsa_id=${p.risorsaId}`;
}

// ── rep tipi (stored in config as rep_tipi_{progetto_id}) ──
async function saveRepTipi(p){
  const chiave = `rep_tipi_${p.id}`;
  const valore = JSON.stringify(p.tipi || []);
  await sql`INSERT INTO config (chiave, valore) VALUES (${chiave}, ${valore})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}

// ── valori fissi per l'export Excel della reperibilità, per progetto (config rep_export_{progettoId}) ──
const REP_WORKFORCE = ['Consulting', 'Services', 'Outsourcing', 'Solutions'];
async function saveRepExport(p){
  const pid = +p.id;
  const [proj] = pid ? await sql`SELECT id FROM progetti WHERE id=${pid}` : [];
  if (!proj) throw new Error('Progetto non trovato');
  const txt = (v, label) => {
    const s = String(v ?? '').trim();
    if (s.length > 200) throw new Error(`${label}: massimo 200 caratteri`);
    return s;
  };
  const workforce = String(p.workforce ?? '').trim();
  if (workforce && !REP_WORKFORCE.includes(workforce)) throw new Error(`Workforce non valida: usa ${REP_WORKFORCE.join(', ')}`);
  const valore = JSON.stringify({ workforce, wbs: txt(p.wbs, 'WBS JOB/progetto'), spoc: txt(p.spoc, 'SPOC'), jobUnit: txt(p.jobUnit, 'Job/Unit/Progetto') });
  await sql`INSERT INTO config (chiave, valore) VALUES (${'rep_export_' + pid}, ${valore})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
  return JSON.parse(valore);
}


// ── Tema colore dell'app: ognuno sceglie il proprio (l'admin, che non è una risorsa, in config) ──
const TEMI = ['viola', 'blu', 'verde', 'teal', 'rosso', 'rosa', 'arancio', 'grafite'];
async function _getTema(ctx){
  const [r] = ctx.admin ? await sql`SELECT valore AS tema FROM config WHERE chiave='admin_tema'`
                        : await sql`SELECT tema FROM risorse WHERE id=${ctx.id || 0}`;
  return r && TEMI.includes(r.tema) ? r.tema : 'viola';
}
async function setTema(p, ctx){
  const tema = V.oneOf(p.tema, TEMI, 'Tema');
  if (ctx.admin) await sql`INSERT INTO config (chiave, valore) VALUES ('admin_tema', ${tema}) ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
  else await sql`UPDATE risorse SET tema=${tema} WHERE id=${ctx.id}`;
  return { tema };
}

// ── Notifiche email di Eventi e Confronto & Feedback ──
// Non fanno mai fallire l'azione: chi crea un evento o aggiorna una richiesta riceve comunque l'esito,
// e ogni invio (riuscito, fallito o saltato) finisce nel log email dell'Admin.
const _fmtGiorno = iso => iso ? new Date(String(iso).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
function _mailTpl({ titolo, intro, righe = [], citazione, elenco = [], cta }){
  const r = righe.filter(x => x && x[1]).map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#5B6275;font-size:13px;white-space:nowrap;vertical-align:top">${_esc(k)}</td><td style="padding:4px 0;font-size:14px;color:#111827">${_esc(v)}</td></tr>`).join('');
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;color:#111827">
    <div style="background:linear-gradient(135deg,#3B0F80,#7C3AED);color:#fff;padding:18px 22px;border-radius:12px 12px 0 0;font-size:18px;font-weight:700">${_esc(titolo)}</div>
    <div style="border:1px solid #E2E5EC;border-top:none;border-radius:0 0 12px 12px;padding:20px 22px">
      <p style="font-size:15px;margin:0 0 14px">${intro}</p>
      ${citazione ? `<div style="background:#F1EBFD;border-left:3px solid #6D28D9;padding:10px 14px;border-radius:6px;font-size:14px;margin:0 0 14px;white-space:pre-line">${_esc(citazione)}</div>` : ''}
      ${r ? `<table style="border-collapse:collapse;margin:0 0 14px">${r}</table>` : ''}
      ${elenco.length ? `<ul style="margin:0 0 14px;padding-left:20px;font-size:14px">${elenco.map(x => `<li>${_esc(x)}</li>`).join('')}</ul>` : ''}
      ${cta ? `<p style="margin:20px 0 6px"><a href="${_esc(cta.url)}" style="background:#6D28D9;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:700;display:inline-block">${_esc(cta.label)}</a></p>` : ''}
      <p style="font-size:12px;color:#5B6275;margin:16px 0 0">Email automatica di Team Hours Tracker.</p>
    </div></div>`;
}
function _mailTxt({ titolo, intro, righe = [], citazione, elenco = [], cta }){
  return [titolo, '', intro.replace(/<[^>]+>/g, ''), citazione ? `\n"${citazione}"` : '', ...righe.filter(x => x && x[1]).map(([k, v]) => `${k}: ${v}`),
          ...elenco.map(x => '- ' + x), cta ? `\n${cta.label}: ${cta.url}` : ''].filter(x => x !== '').join('\n');
}
// destinatari: [{ email, full_name }] — build(r) restituisce { subject, titolo, intro, righe, citazione, elenco, cta }
async function _notify(tipo, destinatari, build, meta){
  const list = destinatari.filter(d => d && d.email);
  if (!list.length) return { sent: 0, total: 0 };
  const mailer = _mail();
  const from = `${process.env.FROM_NAME || 'Team Hours Tracker'} <${String(process.env.GMAIL_USER || 'noreply@localhost').trim()}>`;
  const res = await Promise.allSettled(list.map(async d => {
    const m = build(d);
    if (!mailer) { await _logEmail(tipo, d.email, d.full_name, m.subject, 'skipped', 'SMTP non configurato', meta); return false; }
    try {
      const info = await mailer.sendMail({ from, to: d.email, subject: m.subject, html: _mailTpl(m), text: _mailTxt(m) });
      await _logEmail(tipo, d.email, d.full_name, m.subject, 'sent', null, { ...meta, messageId: info && info.messageId });
      return true;
    } catch (err) {
      await _logEmail(tipo, d.email, d.full_name, m.subject, 'error', err.message, meta);
      console.error(JSON.stringify({ level: 'error', action: tipo, kind: 'smtp', code: err.code, responseCode: err.responseCode, error: err.message }));
      return false;
    }
  }));
  return { sent: res.filter(x => x.status === 'fulfilled' && x.value).length, total: list.length };
}
const _people = ids => ids.length ? sql`SELECT id, full_name, email FROM risorse WHERE id = ANY(${ids}::int[])` : [];
async function _nameOf(ctx){ if (!ctx.id) return 'L\'amministratore'; const [r] = await sql`SELECT full_name FROM risorse WHERE id=${ctx.id}`; return r ? r.full_name : 'Un collega'; }

// Invito a un evento: a chi è appena stato aggiunto, escluso chi lo ha creato
async function _notifyEvento(eid, ids, ctx){
  ids = ids.filter(id => id !== ctx.id);
  if (!ids.length) return { sent: 0, total: 0 };
  const [[e], dest, org] = await Promise.all([
    sql`SELECT id, nome, descrizione, luogo, data::text AS data, periodo_da::text AS periodo_da, periodo_a::text AS periodo_a FROM eventi WHERE id=${eid}`,
    _people(ids), _nameOf(ctx)]);
  const link = siteUrl() ? `${siteUrl()}/?tab=eventi&ev=${eid}` : null;
  const quando = e.data ? _fmtGiorno(e.data) : e.periodo_da ? `da definire: indica la tua disponibilità tra ${_fmtGiorno(e.periodo_da)} e ${_fmtGiorno(e.periodo_a)}` : 'da definire';
  return _notify('evento_invito', dest, d => ({
    subject: `Sei invitato/a: ${e.nome}`, titolo: e.nome,
    intro: `Ciao <strong>${_esc(d.full_name)}</strong>, <strong>${_esc(org)}</strong> ti ha invitato a un evento.`,
    citazione: e.descrizione, righe: [['Quando', quando], ['Dove', e.luogo], ['Organizza', org]],
    cta: link && { label: e.data ? 'Conferma la partecipazione' : 'Indica la tua disponibilità', url: link }
  }), { evento: e.nome, eventoId: eid });
}

const CONF_TEMI_LBL = { crescita: 'Crescita professionale', feedback: 'Feedback sul lavoro', organizzazione: 'Organizzazione e carichi di lavoro',
  progetti: 'Nuovi progetti', team: 'Feedback sul team', benessere: 'Benessere', altro: 'Altro' };
const CONF_PRI_LBL = { alta: 'Alta', media: 'Media', bassa: 'Bassa' };
async function _confronto(id){
  const [c] = await sql`SELECT c.id, c.tema, c.messaggio, c.argomenti, c.priorita, c.periodo_da::text AS periodo_da, c.periodo_a::text AS periodo_a,
                               c.durata_min, c.note, c.richiedente_id, r.full_name AS richiedente, r.email AS richiedente_email
                        FROM confronti c JOIN risorse r ON r.id = c.richiedente_id WHERE c.id=${id}`;
  return c;
}
const _cfLink = (id, box) => siteUrl() ? `${siteUrl()}/?tab=confronti&cf=${id}${box ? '&box=' + box : ''}` : null;
// Nuova richiesta: a ogni destinatario
async function _notifyConfrontoNuovo(id, ids){
  const [c, dest] = await Promise.all([_confronto(id), _people(ids)]);
  const periodo = c.periodo_da || c.periodo_a ? [c.periodo_da && 'dal ' + _fmtGiorno(c.periodo_da), c.periodo_a && 'al ' + _fmtGiorno(c.periodo_a)].filter(Boolean).join(' ') : null;
  return _notify('confronto_richiesta', dest, d => ({
    subject: `${c.richiedente} ti ha chiesto un confronto: ${CONF_TEMI_LBL[c.tema]}`, titolo: 'Nuova richiesta di confronto',
    intro: `Ciao <strong>${_esc(d.full_name)}</strong>, <strong>${_esc(c.richiedente)}</strong> vorrebbe confrontarsi con te.`,
    citazione: c.messaggio, elenco: c.argomenti || [],
    righe: [['Tema', CONF_TEMI_LBL[c.tema]], ['Priorità', CONF_PRI_LBL[c.priorita]], ['Periodo preferito', periodo], ['Durata', c.durata_min ? c.durata_min + ' minuti' : null], ['Note', c.note]],
    cta: _cfLink(id) && { label: 'Apri la richiesta', url: _cfLink(id) }
  }), { confrontoId: id, evento: 'richiesta' });
}
// Aggiornamento da parte di un destinatario: a chi ha fatto la richiesta
async function _notifyConfrontoUpdate(id, ctx, azione){
  const [c, [d]] = await Promise.all([_confronto(id),
    sql`SELECT r.full_name, d.data_incontro::text AS data_incontro, d.ora_incontro, d.luogo, d.risposta
        FROM confronto_destinatari d JOIN risorse r ON r.id = d.risorsa_id WHERE d.confronto_id=${id} AND d.risorsa_id=${ctx.id}`]);
  if (!c || !d) return { sent: 0, total: 0 };
  const chi = d.full_name, tema = CONF_TEMI_LBL[c.tema];
  const T = {
    pianifica: [`${chi} ha pianificato il confronto`, `<strong>${_esc(chi)}</strong> ha pianificato l'incontro per la tua richiesta di confronto.`, 'Confronto pianificato'],
    rispondi:  [`${chi} ha risposto alla tua richiesta di confronto`, `<strong>${_esc(chi)}</strong> ha risposto alla tua richiesta di confronto.`, 'Nuova risposta'],
    completa:  [`Confronto completato con ${chi}`, `<strong>${_esc(chi)}</strong> ha segnato il confronto come completato.`, 'Confronto completato'],
    rifiuta:   [`${chi} non può accettare la richiesta di confronto`, `<strong>${_esc(chi)}</strong> ha rifiutato la tua richiesta di confronto.`, 'Richiesta rifiutata'],
    riapri:    [`${chi} ha riaperto la richiesta di confronto`, `<strong>${_esc(chi)}</strong> ha riaperto la tua richiesta di confronto: l'incontro è di nuovo da pianificare.`, 'Richiesta riaperta']
  }[azione];
  const incontro = azione === 'pianifica' && d.data_incontro ? _fmtGiorno(d.data_incontro) + (d.ora_incontro ? ' alle ' + d.ora_incontro : '') : null;
  return _notify('confronto_aggiornamento', [{ email: c.richiedente_email, full_name: c.richiedente }], r => ({
    subject: `${T[0]} (${tema})`, titolo: T[2], intro: `Ciao <strong>${_esc(r.full_name)}</strong>, ${T[1]}`,
    citazione: ['pianifica', 'rispondi', 'rifiuta'].includes(azione) ? d.risposta : null,
    righe: [['Tema', tema], ['Quando', incontro], ['Dove', azione === 'pianifica' ? d.luogo : null], ['La tua richiesta', c.messaggio.length > 160 ? c.messaggio.slice(0, 157) + '…' : c.messaggio]],
    cta: _cfLink(id, 'inviate') && { label: 'Apri la richiesta', url: _cfLink(id, 'inviate') }
  }), { confrontoId: id, evento: azione, da: chi });
}

// ════════════════════════════════════════════════════════════════════════
//  Eventi: chi crea l'evento sceglie gli invitati; se la data non è fissata gli invitati indicano
//  la disponibilità giorno per giorno nel periodo proposto e l'organizzatore fissa la data.
//  Ogni invitato risponde "ci sono / non ci sono" con un commento facoltativo.
//  Vedono l'evento gli invitati, l'organizzatore e l'admin; lo gestiscono l'organizzatore e l'admin.
// ════════════════════════════════════════════════════════════════════════
const EV_MAX_GIORNI = 92;
const _dayDiff = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
async function _evento(id){
  const [e] = await sql`SELECT id, nome, descrizione, luogo, icona, data::text AS data, periodo_da::text AS periodo_da,
                               periodo_a::text AS periodo_a, creatore_id FROM eventi WHERE id=${V.id(id, 'Evento')}`;
  if (!e) throw new HttpError(404, 'Evento non trovato');
  return e;
}
const _evOwner = (ctx, e) => ctx.admin || (e.creatore_id != null && +e.creatore_id === ctx.id);
async function _evInvited(ctx, eid){
  if (!ctx.id) return false;
  return (await sql`SELECT 1 FROM evento_invitati WHERE evento_id=${eid} AND risorsa_id=${ctx.id}`).length > 0;
}
async function _mustSeeEvento(ctx, id){
  const e = await _evento(id);
  if (!_evOwner(ctx, e) && !(await _evInvited(ctx, e.id))) throw new HttpError(404, 'Evento non trovato');
  return e;
}
async function _mustOwnEvento(ctx, id){
  const e = await _mustSeeEvento(ctx, id);
  if (!_evOwner(ctx, e)) deny('Solo chi ha creato l\'evento può modificarlo');
  return e;
}
function _evFields(p){
  const data = p.data ? V.isoDate(p.data, 'Data evento') : null;
  let da = p.periodoDa ? V.isoDate(p.periodoDa, 'Inizio periodo') : null;
  let a  = p.periodoA  ? V.isoDate(p.periodoA, 'Fine periodo') : null;
  if (!data && (!da || !a)) throw new HttpError(400, 'Indica la data dell\'evento oppure il periodo in cui raccogliere le disponibilità');
  if (da && a) {
    const n = _dayDiff(da, a);
    if (n < 0) throw new HttpError(400, 'La fine del periodo è prima dell\'inizio');
    if (n >= EV_MAX_GIORNI) throw new HttpError(400, `Periodo troppo lungo: massimo ${EV_MAX_GIORNI} giorni`);
  } else { da = null; a = null; }
  const invitati = [...new Set(V.arr(p.invitati, 'Invitati', 1000).map(x => V.id(x, 'Invitato')))];
  // Icona: nome di un'icona Font Awesome scelta nel form (solo lettere minuscole, cifre e trattini)
  const icona = V.optText(p.icona, 'Icona', 40);
  if (icona && !/^[a-z0-9-]+$/.test(icona)) throw new HttpError(400, 'Icona non valida');
  return { nome: V.text(p.nome, 'Nome evento', 150), descrizione: V.optText(p.descrizione, 'Descrizione', 4000),
           luogo: V.optText(p.luogo, 'Luogo', 200), icona, data, da, a, invitati };
}

// Elenco: eventi visibili con riepilogo delle risposte e la risposta di chi chiede
async function getEventi(p, ctx){
  const me = ctx.id || 0, all = !!ctx.admin;
  return sql`
    SELECT e.id, e.nome, e.descrizione, e.luogo, e.icona, e.data::text AS data, e.periodo_da::text AS periodo_da,
           e.periodo_a::text AS periodo_a, e.creatore_id, c.full_name AS creatore,
           (${all}::boolean OR e.creatore_id = ${me}) AS owner,
           COUNT(i.risorsa_id)::int AS invitati,
           COUNT(*) FILTER (WHERE i.risposta = 'si')::int AS si,
           COUNT(*) FILTER (WHERE i.risposta = 'no')::int AS no,
           MAX(i.risposta) FILTER (WHERE i.risorsa_id = ${me}) AS mia_risposta,
           BOOL_OR(i.risorsa_id = ${me}) AS invitato
    FROM eventi e
    LEFT JOIN risorse c ON c.id = e.creatore_id
    LEFT JOIN evento_invitati i ON i.evento_id = e.id
    WHERE ${all}::boolean OR e.creatore_id = ${me}
       OR EXISTS (SELECT 1 FROM evento_invitati x WHERE x.evento_id = e.id AND x.risorsa_id = ${me})
    GROUP BY e.id, c.full_name
    ORDER BY COALESCE(e.data, e.periodo_da) DESC NULLS LAST, e.id DESC`;
}
async function getEvento(p, ctx){
  const e = await _mustSeeEvento(ctx, p.id);
  const [invitati, disp, [cr]] = await Promise.all([
    sql`SELECT i.risorsa_id, r.full_name, i.risposta, i.commento, i.risposto_at::text AS risposto_at
        FROM evento_invitati i JOIN risorse r ON r.id = i.risorsa_id
        WHERE i.evento_id = ${e.id} ORDER BY r.cognome, r.nome`,
    sql`SELECT risorsa_id, data::text AS data, stato FROM evento_disponibilita WHERE evento_id = ${e.id}`,
    sql`SELECT full_name FROM risorse WHERE id = ${e.creatore_id || 0}`
  ]);
  return { ...e, creatore: cr ? cr.full_name : (e.creatore_id ? null : 'Amministratore'), owner: _evOwner(ctx, e),
           invitato: invitati.some(i => +i.risorsa_id === ctx.id), invitati, disponibilita: disp };
}
// Crea o modifica. L'organizzatore (se è una risorsa) è sempre tra gli invitati.
async function saveEvento(p, ctx){
  const f = _evFields(p);
  if (ctx.id && !f.invitati.includes(ctx.id) && !p.id) f.invitati.push(ctx.id);
  if (!f.invitati.length) throw new HttpError(400, 'Aggiungi almeno un invitato');
  const ok = await sql`SELECT id FROM risorse WHERE id = ANY(${f.invitati}::int[])`;
  if (ok.length !== f.invitati.length) throw new HttpError(400, 'Uno o più invitati non esistono più');
  let id, prima = [];
  if (p.id) {
    const e = await _mustOwnEvento(ctx, p.id); id = e.id;
    prima = (await sql`SELECT risorsa_id FROM evento_invitati WHERE evento_id=${id}`).map(r => +r.risorsa_id);
    if (e.creatore_id && !f.invitati.includes(+e.creatore_id)) f.invitati.push(+e.creatore_id);
    await sql.transaction([
      sql`UPDATE eventi SET nome=${f.nome}, descrizione=${f.descrizione}, luogo=${f.luogo}, icona=${f.icona}, data=${f.data},
                 periodo_da=${f.da}, periodo_a=${f.a} WHERE id=${id}`,
      sql`DELETE FROM evento_invitati WHERE evento_id=${id} AND risorsa_id <> ALL(${f.invitati}::int[])`,
      sql`DELETE FROM evento_disponibilita WHERE evento_id=${id}
            AND (risorsa_id <> ALL(${f.invitati}::int[]) OR ${f.da}::date IS NULL OR data NOT BETWEEN ${f.da}::date AND ${f.a}::date)`,
      sql`INSERT INTO evento_invitati (evento_id, risorsa_id) SELECT ${id}, x FROM unnest(${f.invitati}::int[]) AS x ON CONFLICT DO NOTHING`
    ]);
  } else {
    const [r] = await sql`INSERT INTO eventi (nome, descrizione, luogo, icona, data, periodo_da, periodo_a, creatore_id)
                          VALUES (${f.nome}, ${f.descrizione}, ${f.luogo}, ${f.icona}, ${f.data}, ${f.da}, ${f.a}, ${ctx.id}) RETURNING id`;
    id = +r.id;
    await sql`INSERT INTO evento_invitati (evento_id, risorsa_id) SELECT ${id}, x FROM unnest(${f.invitati}::int[]) AS x ON CONFLICT DO NOTHING`;
  }
  const mail = await _notifyEvento(id, f.invitati.filter(x => !prima.includes(x)), ctx);
  return { id, mail };
}
async function deleteEvento(p, ctx){ const e = await _mustOwnEvento(ctx, p.id); await sql`DELETE FROM eventi WHERE id=${e.id}`; }
// L'organizzatore fissa (o toglie) la data, di solito scegliendola dal calendario delle disponibilità
async function setEventoData(p, ctx){
  const e = await _mustOwnEvento(ctx, p.id);
  const data = p.data ? V.isoDate(p.data, 'Data evento') : null;
  if (!data && !e.periodo_da) throw new HttpError(400, 'Senza periodo delle disponibilità la data non può essere tolta');
  await sql`UPDATE eventi SET data=${data} WHERE id=${e.id}`;
}
// Disponibilità e partecipazione: sempre a proprio nome, solo se invitati
async function _mustInvited(ctx, id){
  if (!ctx.id) deny('Solo gli invitati possono rispondere');
  const e = await _evento(id);
  if (!(await _evInvited(ctx, e.id))) throw new HttpError(404, 'Evento non trovato');
  return e;
}
async function setDisponibilita(p, ctx){
  const e = await _mustInvited(ctx, p.eventoId);
  if (e.data) throw new HttpError(409, 'La data dell\'evento è già stata fissata');
  if (!e.periodo_da) throw new HttpError(400, 'Questo evento non raccoglie disponibilità');
  const data = V.isoDate(p.data, 'Giorno');
  if (data < e.periodo_da || data > e.periodo_a) throw new HttpError(400, 'Giorno fuori dal periodo proposto');
  if (!p.stato) { await sql`DELETE FROM evento_disponibilita WHERE evento_id=${e.id} AND risorsa_id=${ctx.id} AND data=${data}`; return; }
  const stato = V.oneOf(p.stato, ['si', 'forse', 'no'], 'Disponibilità');
  await sql`INSERT INTO evento_disponibilita (evento_id, risorsa_id, data, stato) VALUES (${e.id}, ${ctx.id}, ${data}, ${stato})
            ON CONFLICT (evento_id, risorsa_id, data) DO UPDATE SET stato = EXCLUDED.stato`;
}
async function setPartecipazione(p, ctx){
  const e = await _mustInvited(ctx, p.eventoId);
  const risposta = p.risposta == null || p.risposta === '' ? null : V.oneOf(p.risposta, ['si', 'no'], 'Risposta');
  const commento = V.optText(p.commento, 'Commento', 500);
  await sql`UPDATE evento_invitati SET risposta=${risposta}, commento=${commento}, risposto_at=NOW()
            WHERE evento_id=${e.id} AND risorsa_id=${ctx.id}`;
}


// ════════════════════════════════════════════════════════════════════════
//  Confronto & Feedback: ogni risorsa chiede un confronto a una o più persone, indicando tema,
//  argomenti, motivi, priorità e preferenze. Ogni destinatario gestisce la propria copia:
//  pianifica l'incontro, risponde, lo segna come completato o rifiuta. Il richiedente vede
//  lo stato per ciascun destinatario e può ritirare la richiesta. L'admin non partecipa.
// ════════════════════════════════════════════════════════════════════════
const CONF_TEMI = ['crescita', 'feedback', 'organizzazione', 'progetti', 'team', 'benessere', 'altro'];
const CONF_AZIONI = { pianifica: 'pianificato', completa: 'completato', rifiuta: 'rifiutato', riapri: 'da_pianificare', rispondi: null };
async function getConfronti(p, ctx){
  mustPerson(ctx);
  const me = ctx.id;
  const [ricevute, inviate] = await Promise.all([
    sql`SELECT c.id, c.tema, c.messaggio, c.argomenti, c.priorita, c.periodo_da::text AS periodo_da, c.periodo_a::text AS periodo_a,
               c.durata_min, c.note, c.created_at::text AS created_at, c.richiedente_id, r.full_name AS richiedente,
               d.stato, d.data_incontro::text AS data_incontro, d.ora_incontro, d.luogo, d.risposta, d.updated_at::text AS updated_at,
               (SELECT COUNT(*)::int FROM confronto_destinatari x WHERE x.confronto_id = c.id) AS n_destinatari
        FROM confronto_destinatari d JOIN confronti c ON c.id = d.confronto_id JOIN risorse r ON r.id = c.richiedente_id
        WHERE d.risorsa_id = ${me} ORDER BY c.created_at DESC`,
    sql`SELECT c.id, c.tema, c.messaggio, c.argomenti, c.priorita, c.periodo_da::text AS periodo_da, c.periodo_a::text AS periodo_a,
               c.durata_min, c.note, c.created_at::text AS created_at,
               COALESCE((SELECT json_agg(json_build_object('risorsa_id', d.risorsa_id, 'full_name', r.full_name, 'stato', d.stato,
                         'data_incontro', d.data_incontro::text, 'ora_incontro', d.ora_incontro, 'luogo', d.luogo, 'risposta', d.risposta)
                         ORDER BY r.cognome, r.nome)
                         FROM confronto_destinatari d JOIN risorse r ON r.id = d.risorsa_id WHERE d.confronto_id = c.id), '[]'::json) AS destinatari
        FROM confronti c WHERE c.richiedente_id = ${me} ORDER BY c.created_at DESC`
  ]);
  return { ricevute, inviate };
}
async function saveConfronto(p, ctx){
  mustPerson(ctx);
  const dest = [...new Set(V.arr(p.destinatari, 'Destinatari', 200).map(x => V.id(x, 'Destinatario')))].filter(x => x !== ctx.id);
  if (!dest.length) throw new HttpError(400, 'Scegli almeno una persona con cui confrontarti');
  const ok = await sql`SELECT id FROM risorse WHERE id = ANY(${dest}::int[])`;
  if (ok.length !== dest.length) throw new HttpError(400, 'Una o più persone non esistono più');
  const tema = V.oneOf(p.tema, CONF_TEMI, 'Tema');
  const messaggio = V.text(p.messaggio, 'Motivo del confronto', 2000);
  const argomenti = V.arr(p.argomenti, 'Argomenti', 15).map(a => V.optText(a, 'Argomento', 200)).filter(Boolean);
  const priorita = V.oneOf(p.priorita || 'media', ['alta', 'media', 'bassa'], 'Priorità');
  const da = p.periodoDa ? V.isoDate(p.periodoDa, 'Periodo dal') : null, a = p.periodoA ? V.isoDate(p.periodoA, 'Periodo al') : null;
  if (da && a && a < da) throw new HttpError(400, 'La fine del periodo preferito è prima dell\'inizio');
  const durata = p.durata ? V.int(p.durata, 'Durata', 5, 480) : null;
  const note = V.optText(p.note, 'Note', 1000);
  const [r] = await sql`INSERT INTO confronti (richiedente_id, tema, messaggio, argomenti, priorita, periodo_da, periodo_a, durata_min, note)
                        VALUES (${ctx.id}, ${tema}, ${messaggio}, ${argomenti}::text[], ${priorita}, ${da}, ${a}, ${durata}, ${note}) RETURNING id`;
  await sql`INSERT INTO confronto_destinatari (confronto_id, risorsa_id) SELECT ${r.id}, x FROM unnest(${dest}::int[]) AS x`;
  const mail = await _notifyConfrontoNuovo(+r.id, dest);
  return { id: +r.id, mail };
}
// Solo il richiedente ritira la propria richiesta (sparisce per tutti i destinatari)
async function deleteConfronto(p, ctx){
  mustPerson(ctx);
  const id = V.id(p.id, 'Richiesta');
  const c = await _confronto(id);
  if (!c || +c.richiedente_id !== ctx.id) throw new HttpError(404, 'Richiesta non trovata');
  const dest = await sql`SELECT r.full_name, r.email FROM confronto_destinatari d JOIN risorse r ON r.id = d.risorsa_id
                         WHERE d.confronto_id=${id} AND d.stato IN ('da_pianificare', 'pianificato')`;
  await sql`DELETE FROM confronti WHERE id=${id} AND richiedente_id=${ctx.id}`;
  await _notify('confronto_aggiornamento', dest, d => ({
    subject: `${c.richiedente} ha ritirato la richiesta di confronto (${CONF_TEMI_LBL[c.tema]})`, titolo: 'Richiesta ritirata',
    intro: `Ciao <strong>${_esc(d.full_name)}</strong>, <strong>${_esc(c.richiedente)}</strong> ha ritirato la richiesta di confronto che ti aveva inviato: non serve più pianificare l'incontro.`,
    citazione: c.messaggio, righe: [['Tema', CONF_TEMI_LBL[c.tema]]]
  }), { confrontoId: id, evento: 'ritirata' });
}
// Il destinatario aggiorna solo la propria copia della richiesta
async function updateConfronto(p, ctx){
  mustPerson(ctx);
  const id = V.id(p.id, 'Richiesta');
  if (!Object.hasOwn(CONF_AZIONI, p.azione)) throw new HttpError(400, 'Azione non valida');
  const [d] = await sql`SELECT stato FROM confronto_destinatari WHERE confronto_id=${id} AND risorsa_id=${ctx.id}`;
  if (!d) throw new HttpError(404, 'Richiesta non trovata');
  const risposta = p.risposta === undefined ? undefined : V.optText(p.risposta, 'Risposta', 2000);
  if (p.azione === 'pianifica') {
    const data = V.isoDate(p.data, 'Data dell\'incontro'), ora = V.optTime(p.ora, 'Ora'), luogo = V.optText(p.luogo, 'Luogo o link', 300);
    await sql`UPDATE confronto_destinatari SET stato='pianificato', data_incontro=${data}, ora_incontro=${ora}, luogo=${luogo},
              risposta = CASE WHEN ${risposta === undefined}::boolean THEN risposta ELSE ${risposta ?? null} END, updated_at=NOW()
              WHERE confronto_id=${id} AND risorsa_id=${ctx.id}`;
    return { mail: await _notifyConfrontoUpdate(id, ctx, 'pianifica') };
  }
  if (p.azione === 'rispondi') {
    await sql`UPDATE confronto_destinatari SET risposta=${risposta ?? null}, updated_at=NOW() WHERE confronto_id=${id} AND risorsa_id=${ctx.id}`;
    return { mail: await _notifyConfrontoUpdate(id, ctx, 'rispondi') };
  }
  const stato = CONF_AZIONI[p.azione];
  // Riaprire toglie la data; rifiutare o completare la conserva come promemoria
  await sql`UPDATE confronto_destinatari SET stato=${stato},
            data_incontro = CASE WHEN ${stato === 'da_pianificare'}::boolean THEN NULL ELSE data_incontro END,
            ora_incontro  = CASE WHEN ${stato === 'da_pianificare'}::boolean THEN NULL ELSE ora_incontro END,
            risposta = CASE WHEN ${risposta === undefined}::boolean THEN risposta ELSE ${risposta ?? null} END, updated_at=NOW()
            WHERE confronto_id=${id} AND risorsa_id=${ctx.id}`;
  return { mail: await _notifyConfrontoUpdate(id, ctx, p.azione) };
}

// ── Benchmark per progetto (config benchmark_{progettoId}): FTE venduti, tempi medi dei ticket, Pyr.
//    Modificabile da chiunque; i campi vuoti restano null. ──
const BENCH_FIELDS = { fteTot: 'FTE venduti TOT', fteCr: 'FTE CR', fteTicket: 'FTE Ticket/Extra', tL1: 'Tempo L1 (h)', tL2: 'Tempo L2 (h)', tL3: 'Tempo L3 (h)', pyr: 'Pyr' };
function _benchNum(v, label){
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1000000) throw new Error(`${label}: inserisci un numero maggiore o uguale a zero`);
  return Math.round(n * 100) / 100;
}
async function saveBenchmark(p){
  const rows = Array.isArray(p.rows) ? p.rows : [];
  const ids = rows.map(r => +r.progettoId).filter(Boolean);
  const exist = new Set((await sql`SELECT id FROM progetti WHERE id = ANY(${ids}::int[])`).map(r => +r.id));
  const out = {};
  for (const r of rows) {
    const pid = +r.progettoId;
    if (!exist.has(pid)) throw new Error('Progetto non trovato');
    const v = {};
    Object.entries(BENCH_FIELDS).forEach(([k, label]) => { v[k] = _benchNum(r[k], label); });
    await sql`INSERT INTO config (chiave, valore) VALUES (${'benchmark_' + pid}, ${JSON.stringify(v)})
              ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
    out[pid] = v;
  }
  return out;
}

// ── WBS (stored in config as wbs_{risorsaId}_{anno}_{mese}) ──
async function saveWbs(p){
  const chiave = `wbs_${p.risorsaId}_${p.anno}_${p.mese}`;
  const valore = JSON.stringify(p.entries || []);
  await sql`INSERT INTO config (chiave, valore) VALUES (${chiave}, ${valore})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}
// ════════════════════════════════════════════════════════════════════════
//  Sollecito Forecast — invia email alle risorse con ore mancanti
// ════════════════════════════════════════════════════════════════════════

async function sollecitaForecast(p) {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
  const FROM_NAME  = process.env.FROM_NAME || 'Team Hours Tracker';
  const SITE_URL   = siteUrl();
  if (!GMAIL_USER || !GMAIL_PASS) return { sent: 0, reason: 'no_smtp' };

  const [manager] = await sql`SELECT full_name FROM risorse WHERE id = ${p.managerId}`;
  if (!manager) return { sent: 0, reason: 'no_manager' };
  const managerName = manager.full_name;

  // Mese filtrato nel pannello (mese 0-based, come ore_mensili)
  const anno = Number(p.anno), mese = Number(p.mese);
  if (!Number.isInteger(anno) || !Number.isInteger(mese) || mese < 0 || mese > 11)
    throw new Error('Mese di riferimento non valido');
  const meseLabel = `${_MESI_IT[mese]} ${anno}`;

  // Risorse del manager con email
  const teamIds = (await _teamOf(p.managerId)).team;
  const risorse = await sql`
    SELECT id, full_name, email FROM risorse
    WHERE id = ANY(${teamIds}::int[])
      AND email IS NOT NULL AND email <> ''
    ORDER BY cognome, nome`;

  if (!risorse.length) return { sent: 0, skipped: 0, reason: 'no_resources' };

  // Ore Forecast del solo mese filtrato
  const oreRows = await sql`
    SELECT risorsa_id, ore_q1, ore_q2
    FROM ore_mensili
    WHERE anno = ${anno} AND mese = ${mese}
      AND risorsa_id = ANY(${teamIds}::int[])`;
  const oreByRes = {};
  oreRows.forEach(r => { oreByRes[r.risorsa_id] = r; });

  // Da sollecitare: chi nel mese non ha compilato né la I né la II quindicina
  const empty = v => v === null || v === undefined;
  const toNotify = risorse.filter(r => {
    const row = oreByRes[r.id];
    return !row || (empty(row.ore_q1) && empty(row.ore_q2));
  });

  const skipped = risorse.length - toNotify.length;
  if (!toNotify.length) return { sent: 0, skipped, reason: 'all_complete' };

  const mailer  = _absenceTransporter();
  const subject = `URGENTE - Inserimento ore Forecast ${meseLabel}`;
  let sent = 0, failed = 0;
  const destinatari = [];

  for (const risorsa of toNotify) {
    const html = _buildForecastSollecitaHtml(risorsa.full_name, managerName, SITE_URL, meseLabel);
    const text = _buildForecastSollecitaText(risorsa.full_name, managerName, SITE_URL, meseLabel);
    const meta = { risorsa: risorsa.full_name, manager: managerName, anno, mese };
    try {
      const info     = await mailer.sendMail({ from: `${FROM_NAME} <${GMAIL_USER}>`, to: risorsa.email, subject, html, text });
      const rejected = info?.rejected || [];
      if (rejected.length) {
        failed++;
        await _logEmail('sollecito_forecast', risorsa.email, risorsa.full_name, subject, 'error',
                        'Destinatario rifiutato da SMTP', { ...meta, rejected });
      } else {
        sent++;
        destinatari.push(risorsa.full_name);
        await _logEmail('sollecito_forecast', risorsa.email, risorsa.full_name, subject, 'sent', null,
                        { ...meta, messageId: info?.messageId || null });
      }
    } catch (err) {
      failed++;
      await _logEmail('sollecito_forecast', risorsa.email, risorsa.full_name, subject, 'error',
                      err.message, { ...meta, code: err.code || null });
    }
  }

  return { sent, failed, skipped, destinatari, reason: 'ok' };
}

function _buildForecastSollecitaText(risorsa, manager, siteUrl, meseLabel) {
  return [
    `Ciao ${risorsa},`,
    '',
    `${manager} ti sta sollecitando per l'inserimento delle ore Forecast di ${meseLabel}.`,
    '',
    'Ti chiediamo di procedere con la compilazione delle ore di entrambe le quindicine accedendo al seguente link:',
    siteUrl,
    '',
    'Grazie.',
    '',
    '---',
    'Messaggio automatico generato da Team Hours Tracker.'
  ].join('\n');
}

function _buildForecastSollecitaHtml(risorsa, manager, siteUrl, meseLabel) {
  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Inserimento ore Forecast</title>
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
  .dm-text{color:#cccccc!important;}
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
        <td align="center" bgcolor="#A100FF" style="background-color:#A100FF;padding:28px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Team Hours Tracker</p>
          <p style="margin:6px 0 0;font-size:13px;color:#e8c4ff;font-family:Arial,Helvetica,sans-serif;">Inserimento ore Forecast</p>
        </td>
      </tr>
      <!-- BODY -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:32px 40px 24px;">
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:#111827;" class="dm-title">Ciao ${_esc(risorsa)},</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.6;" class="dm-text">
            <strong>${_esc(manager)}</strong> ti sta sollecitando per l'inserimento delle ore Forecast di <strong>${_esc(meseLabel)}</strong>.
          </p>
          <p style="margin:0 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.6;" class="dm-text">
            Ti chiediamo di procedere con la compilazione delle ore di entrambe le quindicine accedendo al seguente link:
          </p>
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
            href="${siteUrl}" style="height:44px;v-text-anchor:middle;width:260px;"
            arcsize="11%" stroke="f" fillcolor="#A100FF">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">
              INSERISCI LE ORE FORECAST
            </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="#A100FF" style="background-color:#A100FF;border-radius:5px;text-align:center;">
                <a href="${siteUrl}"
                   style="display:inline-block;padding:13px 32px;font-family:Arial,Helvetica,sans-serif;
                          font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:5px;">
                  INSERISCI LE ORE FORECAST
                </a>
              </td>
            </tr>
          </table>
          <!--<![endif]-->
          <p style="margin:28px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;" class="dm-text">Grazie.</p>
        </td>
      </tr>
      <!-- FOOTER -->
      <tr>
        <td class="dm-foot" style="background-color:#f8f8f8;padding:16px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;text-align:center;">
            Messaggio automatico generato da Team Hours Tracker.
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
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
  V.isoDate(p.data);
  V.optNum(p.ore, 'Ore', 0, 24);
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
// Consuntivo: admin tutto; manager il suo team; Team Lead di progetto le risorse staffate sui suoi progetti;
// gli altri solo le proprie ore (stesse regole della griglia nell'interfaccia)
async function getConsuntivo(p, ctx){
  const anno = V.anno(p.anno);
  const mese = V.mese(p.mese); // 0-based dal frontend → EXTRACT(MONTH) è 1-based
  const me = ctx.id || 0, all = !!ctx.admin, mgr = !!ctx.manager, tlPrj = [...ctx.tlPrj];
  const rows = await sql`
    SELECT dh.risorsa_id, dh.data::text AS data, dh.ore::float AS ore, r.full_name
    FROM daily_hours dh
    JOIN risorse r ON r.id = dh.risorsa_id
    WHERE EXTRACT(YEAR  FROM dh.data) = ${anno}
      AND EXTRACT(MONTH FROM dh.data) = ${mese + 1}
      AND (${all}::boolean OR dh.risorsa_id = ${me} OR (${mgr}::boolean AND dh.risorsa_id = ANY(${[...ctx.team]}::int[]))
           OR dh.risorsa_id IN (SELECT risorsa_id FROM allocazioni WHERE progetto_id = ANY(${tlPrj}::int[])))
    ORDER BY dh.risorsa_id, dh.data`;
  return rows;
}

// ════════════════════════════════════════════════════════════════════════
//  Andamento progetto — aree, ticket giornalieri L1/L2/L3, soglie e alert
//  Convenzione mese: 0-based (come ore_mensili/reperibilita).
// ════════════════════════════════════════════════════════════════════════

const _MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Data odierna in Europe/Rome come 'YYYY-MM-DD'
function _todayRome() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
}

function _isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

// Numero ticket: intero >= 0, altrimenti errore
function _ticketInt(v, label) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isInteger(n) || n < 0 || n > 100000)
    throw new Error(`Valore ${label} non valido: inserisci un numero intero non negativo`);
  return n;
}

// ── token link email (stesso segreto del reminder ore, tipo distinto 'tk') ──
function verifyTicketToken(token) {
  const SECRET = process.env.DAILY_TOKEN_SECRET;
  if (!SECRET) throw new Error('DAILY_TOKEN_SECRET non configurato');
  const dot = String(token || '').indexOf('.');
  if (dot < 1) throw new Error('Token malformato');
  const b64 = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(b64).digest('hex');
  let valid = false;
  try { valid = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch {}
  if (!valid) throw new Error('Firma token non valida');
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString()); }
  catch { throw new Error('Payload token non valido'); }
  if (payload.k !== 'tk' || !payload.r || !Array.isArray(payload.ds) || !payload.ds.length || !payload.e)
    throw new Error('Token campi mancanti');
  if (Math.floor(Date.now() / 1000) > payload.e) throw new Error('Token scaduto');
  return payload;
}

// ── aree (admin) ──
async function saveArea(p){
  const nome = (p.nome || '').trim();
  if (!nome) throw new Error('Nome area obbligatorio');
  if (!p.progettoId) throw new Error('Progetto obbligatorio');
  const tlId = p.teamLeadId || null;
  const attiva = p.attiva !== false;
  try {
    if (p.id) {
      await sql`UPDATE aree SET nome=${nome}, progetto_id=${p.progettoId}, team_lead_id=${tlId}, attiva=${attiva}
                WHERE id=${p.id}`;
      // La soglia d'area segue l'area se viene spostata su un altro progetto
      await sql`UPDATE soglie_ticket SET progetto_id=${p.progettoId} WHERE area_id=${p.id}`;
    } else {
      await sql`INSERT INTO aree (progetto_id, nome, team_lead_id, attiva)
                VALUES (${p.progettoId}, ${nome}, ${tlId}, ${attiva})`;
    }
  } catch (e) {
    if (String(e.message).includes('aree_progetto_id_nome_key')) throw new Error('Esiste già un\'area con questo nome nel progetto');
    throw e;
  }
}
// Eliminazione consentita solo se l'area non ha dati: lo storico ticket ed Extra Effort non va perso
async function deleteArea(p){
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM ticket_giornalieri WHERE area_id=${p.id}`;
  if (r.n > 0) throw new Error(`L'area ha ${r.n} registrazioni ticket: disattivala invece di eliminarla`);
  const [e] = await sql`SELECT COUNT(*)::int AS n FROM extra_effort WHERE area_id=${p.id}`;
  if (e.n > 0) throw new Error(`L'area ha ${e.n} attività di Extra Effort registrate: disattivala invece di eliminarla`);
  await sql`DELETE FROM aree WHERE id=${p.id}`;
}

// Primo e ultimo giorno di un mese (0-based) come 'YYYY-MM-DD'
function _monthRange(anno, mese) {
  return [new Date(Date.UTC(anno, mese, 1)).toISOString().slice(0, 10),
          new Date(Date.UTC(anno, mese + 1, 0)).toISOString().slice(0, 10)];
}

// ── lettura andamento: aggregati mensili per progetto+area (ticket ed Extra Effort),
//    dettaglio attività Extra Effort e alert del mese selezionato ──
// scope: [{ progettoId, areaIds }] — areaIds null = progetto intero, array = solo quelle aree (Team Lead d'area).
// progettoIds (formato precedente) equivale a scope con progetti interi.
async function getAndamento(p){
  const scope = Array.isArray(p.scope) ? p.scope : (p.progettoIds || []).map(id => ({ progettoId: id, areaIds: null }));
  const full = [], areas = [];
  scope.forEach(s => {
    const pid = +s.progettoId;
    if (!pid) return;
    if (Array.isArray(s.areaIds)) s.areaIds.map(Number).filter(Boolean).forEach(a => areas.push(a));
    else full.push(pid);
  });
  if (!full.length && !areas.length) return { tickets: [], ee: [], cr: [], eeDettaglio: [], alert: [], cls: [] };
  const anno = V.anno(p.anno), mese = V.mese(p.mese);   // mese 0-based
  const mesi = Math.min(Math.max(+p.mesi || 12, 1), 24);
  const from = new Date(Date.UTC(anno, mese - mesi + 1, 1)).toISOString().slice(0, 10);
  const [mFrom, to] = _monthRange(anno, mese);
  const [tickets, ee, cr, eeDettaglio, alertTk, alertEe, cls] = await Promise.all([
    sql`SELECT progetto_id, area_id,
               EXTRACT(YEAR FROM data)::int      AS anno,
               EXTRACT(MONTH FROM data)::int - 1 AS mese,
               SUM(l1)::int AS l1, SUM(l2)::int AS l2, SUM(l3)::int AS l3, SUM(totale)::int AS totale,
               COUNT(*)::int AS giorni, MAX(data)::text AS ultimo
        FROM ticket_giornalieri
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[]))
          AND data BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2, 3, 4`,
    sql`SELECT progetto_id, area_id,
               EXTRACT(YEAR FROM data)::int      AS anno,
               EXTRACT(MONTH FROM data)::int - 1 AS mese,
               SUM(ore)::float AS ore, COUNT(*)::int AS n
        FROM extra_effort
        WHERE tipo = 'extra' AND (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[]))
          AND data BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2, 3, 4`,
    sql`SELECT progetto_id, area_id,
               EXTRACT(YEAR FROM data)::int      AS anno,
               EXTRACT(MONTH FROM data)::int - 1 AS mese,
               SUM(md)::float AS md, COUNT(*)::int AS n
        FROM extra_effort
        WHERE tipo = 'cr' AND (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[]))
          AND data BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2, 3, 4`,
    sql`SELECT e.id, e.progetto_id, e.area_id, e.data::text AS data, e.attivita, e.tipo,
               e.ore::float AS ore, e.md::float AS md, r.full_name AS inserito_da
        FROM extra_effort e LEFT JOIN risorse r ON r.id = e.inserito_da
        WHERE (e.progetto_id = ANY(${full}::int[]) OR e.area_id = ANY(${areas}::int[]))
          AND e.data BETWEEN ${mFrom}::date AND ${to}::date
        ORDER BY e.data DESC, e.id`,
    sql`SELECT 'ticket' AS kind, progetto_id, area_id, soglia::float AS soglia, totale::float AS totale, stato,
               to_char(created_at, 'DD/MM/YYYY HH24:MI') AS quando
        FROM ticket_alert_log
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[])) AND anno=${anno} AND mese=${mese}`,
    sql`SELECT 'ee' AS kind, progetto_id, area_id, soglia::float AS soglia, totale::float AS totale, stato,
               to_char(created_at, 'DD/MM/YYYY HH24:MI') AS quando
        FROM ee_alert_log
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[])) AND anno=${anno} AND mese=${mese}`,
    sql`SELECT progetto_id, area_id, livello, categoria, attivita, SUM(n)::int AS n
        FROM ticket_classificazioni
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[]))
          AND data BETWEEN ${mFrom}::date AND ${to}::date
        GROUP BY 1, 2, 3, 4, 5`
  ]);
  return { tickets, ee, cr, eeDettaglio, alert: [...alertTk, ...alertEe], cls };
}

// Valore di soglia facoltativo: vuoto = non impostata
function _optThreshold(v, intOnly, label) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000 || (intOnly && !Number.isInteger(n)))
    throw new Error(`La soglia ${label} deve essere un numero ${intOnly ? 'intero ' : ''}maggiore di zero`);
  return intOnly ? n : Math.round(n * 100) / 100;
}

// ── soglie mensili (ticket + Extra Effort) di progetto o di area: inserimento/modifica/rimozione
//    + ricalcolo immediato del mese corrente. I campi non inviati restano invariati. ──
async function saveSoglia(p){
  if (!p.progettoId) throw new Error('Progetto obbligatorio');
  const pid = +p.progettoId;
  const areaId = p.areaId ? +p.areaId : null;
  if (areaId) {
    const [a] = await sql`SELECT progetto_id FROM aree WHERE id=${areaId}`;
    if (!a || +a.progetto_id !== pid) throw new Error('L\'area non appartiene al progetto indicato');
  }
  const [cur] = await sql`SELECT soglia, soglia_ee::float AS soglia_ee, attiva, destinatari FROM soglie_ticket
                          WHERE progetto_id=${pid} AND COALESCE(area_id, 0)=${areaId || 0}`;
  const soglia   = p.soglia   !== undefined ? _optThreshold(p.soglia, true, 'ticket')          : (cur ? cur.soglia : null);
  const sogliaEe = p.sogliaEe !== undefined ? _optThreshold(p.sogliaEe, false, 'Extra Effort') : (cur ? cur.soglia_ee : null);
  if (soglia === null && sogliaEe === null) {
    await sql`DELETE FROM soglie_ticket WHERE progetto_id=${pid} AND COALESCE(area_id, 0)=${areaId || 0}`;
    return { status: 'removed' };
  }
  const attiva = p.attiva !== undefined ? p.attiva !== false : (cur ? cur.attiva : true);
  const destinatari = p.destinatari !== undefined ? ((p.destinatari || '').trim() || null) : (cur ? cur.destinatari : null);
  await sql`INSERT INTO soglie_ticket (progetto_id, area_id, soglia, soglia_ee, attiva, destinatari, updated_by, updated_at)
            VALUES (${pid}, ${areaId}, ${soglia}, ${sogliaEe}, ${attiva}, ${destinatari}, ${p.risorsaId || null}, NOW())
            ON CONFLICT (progetto_id, (COALESCE(area_id, 0))) DO UPDATE SET soglia=EXCLUDED.soglia, soglia_ee=EXCLUDED.soglia_ee,
              attiva=EXCLUDED.attiva, destinatari=EXCLUDED.destinatari, updated_by=EXCLUDED.updated_by, updated_at=NOW()`;
  // Una nuova soglia già superata nel mese corrente va gestita subito
  const [y, m] = _todayRome().split('-').map(Number);
  let checks;
  try { checks = await _checkThresholds(pid, areaId, y, m - 1); }
  catch (err) { console.error('[threshold-alert]', err.message); checks = [{ kind: 'ticket', status: 'error', error: err.message }]; }
  return { status: 'saved', checks, check: checks.find(c => c.kind === 'ticket') || null };
}

// ── giornata ticket di un Team Lead: aree attive + valori già inseriti per le date richieste ──
// Aree attive su cui una risorsa può inserire dati: quelle di cui è TL e, se withProjectTL (inserimento
// dall'app), tutte le aree dei progetti di cui fa parte (TL di progetto o staffata), escluso il Manager.
// progettoId limita a un solo progetto.
function _editableAree(tlId, progettoId, withProjectTL){
  const pid = progettoId ? +progettoId : null;
  const inApp = !!withProjectTL;
  return sql`
    SELECT a.id, a.nome, a.progetto_id, p.nome AS progetto
    FROM aree a JOIN progetti p ON p.id = a.progetto_id
    WHERE a.attiva
      AND (a.team_lead_id=${tlId}
           OR (${inApp}::boolean AND a.progetto_id IN (SELECT progetto_id FROM progetto_team_leads WHERE risorsa_id=${tlId}
                                                       UNION SELECT progetto_id FROM allocazioni WHERE risorsa_id=${tlId})))
      AND (NOT ${inApp}::boolean OR NOT EXISTS (SELECT 1 FROM risorse WHERE id=${tlId} AND is_manager))
      AND (${pid}::int IS NULL OR a.progetto_id=${pid})
    ORDER BY p.nome, a.nome`;
}

async function _ticketDayForTL(tlId, dates, progettoId = null, withProjectTL = false){
  const [tl] = await sql`SELECT id, full_name FROM risorse WHERE id=${tlId}`;
  if (!tl) throw new Error('Risorsa non trovata');
  const aree = await _editableAree(tlId, progettoId, withProjectTL);
  const areaIds = aree.map(a => a.id);
  const [rows, eeRows, clsRows] = aree.length ? await Promise.all([
    sql`SELECT area_id, data::text AS data, l1, l2, l3, totale
        FROM ticket_giornalieri
        WHERE area_id = ANY(${areaIds}::int[]) AND data = ANY(${dates}::date[])`,
    sql`SELECT area_id, data::text AS data, attivita, tipo, ore::float AS ore, md::float AS md
        FROM extra_effort
        WHERE area_id = ANY(${areaIds}::int[]) AND data = ANY(${dates}::date[])
        ORDER BY id`,
    sql`SELECT area_id, data::text AS data, livello, categoria, attivita, n
        FROM ticket_classificazioni
        WHERE area_id = ANY(${areaIds}::int[]) AND data = ANY(${dates}::date[])
        ORDER BY id`
  ]) : [[], [], []];
  const entries = {}, ee = {}, cls = {};
  clsRows.forEach(r => {
    if (!cls[r.data]) cls[r.data] = {};
    (cls[r.data][r.area_id] = cls[r.data][r.area_id] || []).push({ livello: r.livello, categoria: r.categoria, attivita: r.attivita, n: r.n });
  });
  rows.forEach(r => {
    if (!entries[r.data]) entries[r.data] = {};
    entries[r.data][r.area_id] = { l1: r.l1, l2: r.l2, l3: r.l3, totale: r.totale };
  });
  eeRows.forEach(r => {
    if (!ee[r.data]) ee[r.data] = {};
    (ee[r.data][r.area_id] = ee[r.data][r.area_id] || []).push(r.tipo === 'cr'
      ? { tipo: 'cr', attivita: r.attivita, md: r.md }
      : { tipo: 'extra', attivita: r.attivita, ore: r.ore });
  });
  return { risorsaId: +tl.id, fullName: tl.full_name, dates, aree, entries, ee, cls, tree: TICKET_TREE };
}

// Classificazione dei ticket di un'area per una giornata. undefined = non inviata (classificazione invariata).
// Ogni voce deve esistere in TICKET_TREE; per livello la somma non può superare i ticket dichiarati.
function _clsRows(list, counts) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new Error('Formato classificazione ticket non valido');
  if (list.length > 200) throw new Error('Classificazione ticket: troppe voci');
  const merged = new Map(), perLv = { L1: 0, L2: 0, L3: 0 };
  for (const r of list) {
    const livello = String(r?.livello ?? ''), categoria = String(r?.categoria ?? ''), attivita = String(r?.attivita ?? '');
    if (!TICKET_TREE[livello]?.[categoria]?.includes(attivita))
      throw new Error(`Classificazione ticket non valida: ${livello} › ${categoria} › ${attivita}`);
    const n = Number(r?.n);
    if (!Number.isInteger(n) || n <= 0 || n > 100000)
      throw new Error(`Classificazione "${attivita}": il numero di ticket deve essere un intero maggiore di zero`);
    const key = `${livello}\u0000${categoria}\u0000${attivita}`;
    merged.set(key, { livello, categoria, attivita, n: (merged.get(key)?.n || 0) + n });
    perLv[livello] += n;
  }
  for (const lv of ['L1', 'L2', 'L3']) {
    const max = counts[lv.toLowerCase()];
    if (perLv[lv] > max)
      throw new Error(`Classificazione ${lv}: ${perLv[lv]} ticket classificati ma ne risultano ${max} dichiarati`);
  }
  return [...merged.values()];
}

// Righe Extra Effort di un'area per una giornata. undefined = non inviate (Extra Effort invariato).
function _eeRows(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new Error('Formato Extra Effort non valido');
  if (list.length > 50) throw new Error('Extra Effort: massimo 50 attività per area e giorno');
  // tipo assente = 'extra' (client precedenti): ore per le attività extra, Man Day (md) per le CR
  return list.map(r => {
    const attivita = String(r?.attivita ?? '').trim();
    if (!attivita) throw new Error('Extra Effort: indica la tipologia attività / dettaglio per ogni riga');
    if (attivita.length > 300) throw new Error('Extra Effort: descrizione troppo lunga (massimo 300 caratteri)');
    const tipo = r?.tipo === undefined || r?.tipo === null || r?.tipo === '' ? 'extra' : r.tipo;
    if (tipo !== 'extra' && tipo !== 'cr') throw new Error(`Extra Effort "${attivita}": tipologia non valida`);
    const raw = tipo === 'cr' ? r?.md : r?.ore, v = Number(raw);
    if (raw === '' || raw === null || raw === undefined || !Number.isFinite(v) || v <= 0 || v > 999)
      throw new Error(`Extra Effort "${attivita}": inserisci un numero di ${tipo === 'cr' ? 'MD (Man Day)' : 'ore'} maggiore di zero`);
    const val = Math.round(v * 100) / 100;
    return tipo === 'cr' ? { tipo, attivita, ore: null, md: val } : { tipo, attivita, ore: val, md: null };
  });
}

// Upsert dei ticket (e sostituzione delle attività Extra Effort) di una giornata per le aree del TL,
// in un'unica transazione; poi controllo soglie di progetti e aree coinvolti
async function _saveTicketEntries(tlId, data, entries, progettoId = null, withProjectTL = false){
  if (!_isIsoDate(data)) throw new Error('Data non valida');
  if (data > _todayRome()) throw new Error('Non è possibile inserire ticket per date future');
  if (!Array.isArray(entries) || !entries.length) throw new Error('Nessun dato da salvare');
  const own = await _editableAree(tlId, progettoId, withProjectTL);
  const prjByArea = {};
  own.forEach(a => { prjByArea[a.id] = a.progetto_id; });
  // Validazione completa prima di scrivere: o tutto o niente
  const clean = entries.map(e => {
    const areaId = +e.areaId;
    if (!prjByArea[areaId]) throw new Error('Area non assegnata a questo Team Lead o non attiva');
    const counts = { l1: _ticketInt(e.l1, 'L1'), l2: _ticketInt(e.l2, 'L2'), l3: _ticketInt(e.l3, 'L3') };
    return { areaId, progettoId: prjByArea[areaId], ...counts, ee: _eeRows(e.ee), cls: _clsRows(e.cls, counts) };
  });
  const queries = [];
  for (const e of clean) {
    queries.push(sql`INSERT INTO ticket_giornalieri (area_id, progetto_id, data, l1, l2, l3, inserito_da, updated_at)
              VALUES (${e.areaId}, ${e.progettoId}, ${data}::date, ${e.l1}, ${e.l2}, ${e.l3}, ${tlId}, NOW())
              ON CONFLICT (area_id, data) DO UPDATE SET l1=EXCLUDED.l1, l2=EXCLUDED.l2, l3=EXCLUDED.l3,
                inserito_da=EXCLUDED.inserito_da, updated_at=NOW()`);
    if (e.ee !== undefined) {
      queries.push(sql`DELETE FROM extra_effort WHERE area_id=${e.areaId} AND data=${data}::date`);
      for (const r of e.ee) {
        queries.push(sql`INSERT INTO extra_effort (area_id, progetto_id, data, attivita, tipo, ore, md, inserito_da)
                  VALUES (${e.areaId}, ${e.progettoId}, ${data}::date, ${r.attivita}, ${r.tipo}, ${r.ore}, ${r.md}, ${tlId})`);
      }
    }
    if (e.cls !== undefined) {
      queries.push(sql`DELETE FROM ticket_classificazioni WHERE area_id=${e.areaId} AND data=${data}::date`);
      for (const r of e.cls) {
        queries.push(sql`INSERT INTO ticket_classificazioni (area_id, progetto_id, data, livello, categoria, attivita, n, inserito_da)
                  VALUES (${e.areaId}, ${e.progettoId}, ${data}::date, ${r.livello}, ${r.categoria}, ${r.attivita}, ${r.n}, ${tlId})`);
      }
    }
  }
  await sql.transaction(queries);
  const [y, m] = data.split('-').map(Number);
  // Soglia di progetto per ogni progetto toccato + soglia d'area per ogni area toccata
  const scopes = [...new Set(clean.map(e => e.progettoId))].map(pid => [pid, null])
    .concat(clean.map(e => [e.progettoId, e.areaId]));
  const soglie = [];
  for (const [pid, aid] of scopes) {
    try { (await _checkThresholds(pid, aid, y, m - 1)).forEach(c => soglie.push(c)); }
    catch (err) { console.error('[threshold-alert]', err.message); soglie.push({ progettoId: pid, areaId: aid, status: 'error', error: err.message }); }
  }
  return { saved: clean.length, soglie };
}

// ── inserimento dall'app (dettaglio progetto): TL dell'area o TL del progetto ──
async function getTicketDay(p){
  if (!_isIsoDate(p.data)) throw new Error('Data non valida');
  return _ticketDayForTL(+p.risorsaId, [p.data], p.progettoId, true);
}
async function saveTickets(p){ return _saveTicketEntries(+p.risorsaId, p.data, p.entries, p.progettoId, true); }

// ── inserimento dal link email (nessun login: il token identifica TL e date) ──
async function getTicketsByToken(p){
  const { r, ds } = verifyTicketToken(p.token);
  return _ticketDayForTL(+r, ds);
}
async function saveTicketsByToken(p){
  const { r, ds } = verifyTicketToken(p.token);
  if (!ds.includes(p.data)) throw new Error('Data non coperta dal link ricevuto');
  return _saveTicketEntries(+r, p.data, p.entries);
}

// ════════════════════════════════════════════════════════════════════════
//  Controllo soglie + alert email (una sola volta per scope + mese + soglia)
//  Scope: progetto intero (areaId null) o singola area. Tipi: ticket (L1+L2+L3) ed Extra Effort (ore).
// ════════════════════════════════════════════════════════════════════════
const _r2 = n => Math.round(Number(n) * 100) / 100;
function _fmtOre(n) { return `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`; }

// Totali del mese per lo scope: area → righe dell'area, progetto → tutte le righe del progetto
async function _scopeMonthTotals(progettoId, areaId, anno, mese){
  const [from, to] = _monthRange(anno, mese);
  const aid = areaId || null;
  const [[t], [e]] = await Promise.all([
    sql`SELECT COALESCE(SUM(l1),0)::int AS l1, COALESCE(SUM(l2),0)::int AS l2,
               COALESCE(SUM(l3),0)::int AS l3, COALESCE(SUM(totale),0)::int AS totale
        FROM ticket_giornalieri
        WHERE ((${aid}::int IS NULL AND progetto_id=${progettoId}) OR area_id=${aid})
          AND data BETWEEN ${from}::date AND ${to}::date`,
    sql`SELECT COALESCE(SUM(ore),0)::float AS ore, COUNT(*)::int AS n
        FROM extra_effort
        WHERE tipo = 'extra' AND ((${aid}::int IS NULL AND progetto_id=${progettoId}) OR area_id=${aid})
          AND data BETWEEN ${from}::date AND ${to}::date`
  ]);
  return { ...t, ee_ore: _r2(e.ore), ee_n: e.n };
}

async function _checkThresholds(progettoId, areaId, anno, mese){
  const aid = areaId || null;
  const [cfg] = await sql`SELECT soglia, soglia_ee::float AS soglia_ee, attiva, destinatari FROM soglie_ticket
                          WHERE progetto_id=${progettoId} AND COALESCE(area_id, 0)=${aid || 0}`;
  if (!cfg || !cfg.attiva) return [];
  const tot = await _scopeMonthTotals(progettoId, aid, anno, mese);
  const scope = { progettoId, areaId: aid };
  const out = [];
  if (cfg.soglia)    out.push({ ...scope, kind: 'ticket', ...(await _claimAndAlert('ticket', scope, anno, mese, +cfg.soglia, tot, cfg.destinatari)) });
  if (cfg.soglia_ee) out.push({ ...scope, kind: 'ee',     ...(await _claimAndAlert('ee', scope, anno, mese, _r2(cfg.soglia_ee), tot, cfg.destinatari)) });
  return out;
}

async function _claimAndAlert(kind, scope, anno, mese, soglia, tot, extra){
  const totale = kind === 'ee' ? tot.ee_ore : tot.totale;
  if (totale < soglia) return { status: 'below', soglia, totale };
  const { progettoId, areaId } = scope;

  // "Prenota" l'invio: l'indice UNIQUE fa vincere un solo chiamante anche in caso di salvataggi concorrenti
  const [claim] = kind === 'ee'
    ? await sql`
        INSERT INTO ee_alert_log (progetto_id, area_id, anno, mese, soglia, totale, attivita)
        VALUES (${progettoId}, ${areaId}, ${anno}, ${mese}, ${soglia}, ${totale}, ${tot.ee_n})
        ON CONFLICT (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia) DO NOTHING
        RETURNING id`
    : await sql`
        INSERT INTO ticket_alert_log (progetto_id, area_id, anno, mese, soglia, totale, l1, l2, l3)
        VALUES (${progettoId}, ${areaId}, ${anno}, ${mese}, ${soglia}, ${totale}, ${tot.l1}, ${tot.l2}, ${tot.l3})
        ON CONFLICT (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia) DO NOTHING
        RETURNING id`;
  if (!claim) return { status: 'already_sent', soglia, totale };

  let res;
  try { res = await _sendThresholdAlert(kind, scope, anno, mese, soglia, tot, extra); }
  catch (err) { res = { sent: false, reason: 'error', error: err.message }; }
  if (res.sent) {
    if (kind === 'ee') await sql`UPDATE ee_alert_log SET stato='sent' WHERE id=${claim.id}`;
    else               await sql`UPDATE ticket_alert_log SET stato='sent' WHERE id=${claim.id}`;
  } else {
    // Invio non riuscito: rilascia la prenotazione così il prossimo salvataggio ritenta
    if (kind === 'ee') await sql`DELETE FROM ee_alert_log WHERE id=${claim.id}`;
    else               await sql`DELETE FROM ticket_alert_log WHERE id=${claim.id}`;
  }
  return { status: res.sent ? 'alert_sent' : 'alert_failed', reason: res.reason, soglia, totale };
}

async function _sendThresholdAlert(kind, scope, anno, mese, soglia, tot, extra){
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
  const FROM_NAME  = process.env.FROM_NAME || 'Team Hours Tracker';
  const SITE_URL   = siteUrl();
  const { progettoId, areaId } = scope;
  const isEe = kind === 'ee';
  const [prj] = await sql`SELECT nome FROM progetti WHERE id=${progettoId}`;
  const [area] = areaId ? await sql`SELECT nome FROM aree WHERE id=${areaId}` : [null];
  const progetto = prj ? prj.nome : `#${progettoId}`;
  const areaNome = area ? area.nome : null;
  const scopeLabel = areaNome ? `${progetto} / ${areaNome}` : progetto;
  const meseLabel = `${_MESI_IT[mese]} ${anno}`;
  const tipoLog = isEe ? 'alert_soglia_ee' : 'alert_soglia_ticket';
  const subject = `[Alert soglia ${isEe ? 'Extra Effort' : 'ticket'}] ${scopeLabel} — ${meseLabel}`;
  const meta = isEe
    ? { progetto, area: areaNome, anno, mese, soglia, totale: tot.ee_ore, attivita: tot.ee_n }
    : { progetto, area: areaNome, anno, mese, soglia, totale: tot.totale, l1: tot.l1, l2: tot.l2, l3: tot.l3 };
  if (!GMAIL_USER || !GMAIL_PASS) {
    await _logEmail(tipoLog, '—', scopeLabel, subject, 'skipped', 'SMTP non configurato', meta);
    return { sent: false, reason: 'no_smtp' };
  }

  // TO: Team Lead dell'area (o di tutte le aree attive, se soglia di progetto) + Team Lead del progetto.
  // CC: manager di questi TL + destinatari extra configurati sulla soglia
  const tls = areaId
    ? await sql`
        SELECT r.id, r.full_name, r.email, r.manager_id
        FROM risorse r
        WHERE r.id IN (SELECT team_lead_id FROM aree WHERE id=${areaId} AND team_lead_id IS NOT NULL
                       UNION SELECT risorsa_id FROM progetto_team_leads WHERE progetto_id=${progettoId})
          AND r.email IS NOT NULL AND r.email <> ''`
    : await sql`
        SELECT r.id, r.full_name, r.email, r.manager_id
        FROM risorse r
        WHERE r.id IN (SELECT team_lead_id FROM aree WHERE progetto_id=${progettoId} AND attiva AND team_lead_id IS NOT NULL
                       UNION SELECT risorsa_id FROM progetto_team_leads WHERE progetto_id=${progettoId})
          AND r.email IS NOT NULL AND r.email <> ''`;
  const mgrIds = [...new Set(tls.map(t => t.manager_id).filter(Boolean))];
  const mgrs = mgrIds.length ? await sql`
    SELECT email FROM risorse WHERE id = ANY(${mgrIds}::int[]) AND email IS NOT NULL AND email <> ''` : [];
  const norm = e => String(e).trim().toLowerCase();
  const to = [...new Set(tls.map(t => norm(t.email)))];
  const extraList = String(extra || '').split(/[,;\s]+/).map(norm).filter(e => e.includes('@'));
  const cc = [...new Set([...mgrs.map(m => norm(m.email)), ...extraList])].filter(e => !to.includes(e));
  if (!to.length && !cc.length) {
    await _logEmail(tipoLog, '—', scopeLabel, subject, 'skipped', 'Nessun destinatario con email configurato', meta);
    return { sent: false, reason: 'no_recipients' };
  }
  // Senza TL con email, i destinatari in CC diventano principali
  const toFinal = to.length ? to : cc;
  const ccFinal = to.length ? cc : [];

  const link = `${SITE_URL}/?tab=andamento&prj=${progettoId}${areaId ? `&area=${areaId}` : ''}`;
  const content = _thresholdAlertContent(isEe, progetto, areaNome, meseLabel, soglia, tot, link);
  const mailer = _absenceTransporter();
  const logTo = toFinal.join(', ');
  const fullMeta = { ...meta, to: toFinal, cc: ccFinal };
  try {
    const info = await mailer.sendMail({
      from: `${FROM_NAME} <${GMAIL_USER}>`, to: toFinal, cc: ccFinal.length ? ccFinal : undefined, subject,
      html: _buildThresholdAlertHtml(content),
      text: _buildThresholdAlertText(content)
    });
    const rejected = info?.rejected || [];
    const accepted = info?.accepted || [];
    if (!accepted.length) {
      await _logEmail(tipoLog, logTo, scopeLabel, subject, 'error', 'Destinatari rifiutati da SMTP', { ...fullMeta, rejected });
      return { sent: false, reason: 'error' };
    }
    await _logEmail(tipoLog, logTo, scopeLabel, subject, 'sent', null,
                    { ...fullMeta, rejected, messageId: info?.messageId || null });
    return { sent: true, reason: 'ok' };
  } catch (err) {
    await _logEmail(tipoLog, logTo, scopeLabel, subject, 'error', err.message,
                    { ...fullMeta, code: err.code || null, responseCode: err.responseCode || null });
    return { sent: false, reason: 'error', error: err.message };
  }
}

// Contenuto dell'alert, condiviso fra versione HTML e testo
function _thresholdAlertContent(isEe, progetto, areaNome, meseLabel, soglia, tot, link) {
  const totale = isEe ? tot.ee_ore : tot.totale;
  const diff = _r2(totale - soglia);
  const unit = v => isEe ? _fmtOre(v) : `${v} ticket`;
  const subjectText = areaNome ? `L'area ${areaNome} del progetto ${progetto}` : `Il progetto ${progetto}`;
  const subjectHtml = areaNome ? `L'area <strong>${_esc(areaNome)}</strong> del progetto <strong>${_esc(progetto)}</strong>`
                               : `Il progetto <strong>${_esc(progetto)}</strong>`;
  const what = isEe ? 'la soglia mensile di Extra Effort configurata' : 'la soglia mensile configurata';
  const rows = isEe
    ? [['Mese', meseLabel], ['Soglia', unit(soglia)], ['Extra Effort registrato', unit(totale), true], ['Attività registrate', `${tot.ee_n}`]]
    : [['Mese', meseLabel], ['Soglia', unit(soglia)], ['Ticket registrati', `${totale}`, true],
       ['L1', `${tot.l1}`], ['L2', `${tot.l2}`], ['L3', `${tot.l3}`]];
  return {
    heading: isEe ? 'Alert – Soglia Extra Effort raggiunta' : 'Alert – Soglia ticket raggiunta',
    introText: `${subjectText} ha raggiunto ${what}.`,
    introHtml: `${subjectHtml} ha raggiunto ${what}.`,
    title: areaNome ? `${progetto} / ${areaNome}` : progetto,
    rows,
    diffMsg: diff === 0 ? 'La soglia è stata raggiunta.' : `La soglia è stata superata di ${unit(diff)}.`,
    link
  };
}

function _buildThresholdAlertText(c) {
  return [
    c.heading,
    '',
    c.introText,
    '',
    ...c.rows.map(([label, value]) => `${label}: ${value}`),
    '',
    c.diffMsg,
    '',
    'Accedi alla sezione Andamento progetto per visualizzare il dettaglio:',
    c.link,
    '',
    '---',
    'Messaggio automatico generato da Team Hours Tracker.'
  ].join('\n');
}

function _buildThresholdAlertHtml(c) {
  const row = (label, value, strong) => `
            <tr>
              <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;" class="dm-label">${_esc(label)}</td>
              <td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;font-weight:${strong ? 700 : 600};" class="dm-value">${_esc(value)}</td>
            </tr>`;
  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${_esc(c.heading)} — ${_esc(c.title)}</title>
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
  .dm-label{color:#aaaaaa!important;}
  .dm-value{color:#ffffff!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dm-outer" style="background-color:#f0f2f5;">
  <tr><td align="center" valign="top" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="dm-card" style="max-width:600px;width:100%;background-color:#ffffff;">
      <!-- HEADER -->
      <tr>
        <td align="center" bgcolor="#A100FF" style="background-color:#A100FF;padding:28px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Team Hours Tracker</p>
          <p style="margin:6px 0 0;font-size:13px;color:#e8c4ff;font-family:Arial,Helvetica,sans-serif;">${_esc(c.heading)}</p>
        </td>
      </tr>
      <!-- INTRO -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:32px 40px 16px;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;color:#111827;" class="dm-title">
            ${c.introHtml}
          </p>
        </td>
      </tr>
      <!-- DATI -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:0 40px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
            ${c.rows.map(([label, value, strong]) => row(label, value, strong)).join('')}
          </table>
        </td>
      </tr>
      <!-- DIFFERENZA -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:16px 40px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fff1f2;border:1px solid #fecdd3;border-radius:6px;">
            <tr><td style="padding:12px 16px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#be123c;">&#9888;&#65039; ${_esc(c.diffMsg)}</p>
            </td></tr>
          </table>
        </td>
      </tr>
      <!-- PULSANTE -->
      <tr>
        <td align="center" class="dm-body" style="background-color:#ffffff;padding:0 40px 32px;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${c.link}" style="height:44px;v-text-anchor:middle;width:280px;" arcsize="11%" stroke="f" fillcolor="#A100FF">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">APRI ANDAMENTO PROGETTO</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td bgcolor="#A100FF" style="background-color:#A100FF;border-radius:5px;text-align:center;">
                <a href="${c.link}" style="display:inline-block;padding:13px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:5px;">APRI ANDAMENTO PROGETTO</a>
              </td>
            </tr>
          </table>
          <!--<![endif]-->
        </td>
      </tr>
      <!-- FOOTER -->
      <tr>
        <td align="center" class="dm-foot" style="background-color:#f8f9fc;padding:18px 40px;border-top:1px solid #eeeeee;">
          <p style="margin:0;font-size:12px;color:#aaaaaa;font-family:Arial,Helvetica,sans-serif;">
            Messaggio automatico generato da Team Hours Tracker.<br>Non rispondere a questa email.
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── routing: whitelist esplicita delle action consentite ──
// ════════════════════════════════════════════════════════════════════════
//  Sessione e permessi. Ogni richiesta autenticata ricarica dal DB identità e ruoli:
//  un cambio di ruolo o un reset password ha effetto immediato.
// ════════════════════════════════════════════════════════════════════════
const _unauth = () => new HttpError(401, 'Sessione scaduta o non valida: accedi di nuovo');
const _NO_ROLES = { tlPrj: new Set(), areaTlPrj: new Set(), team: new Set(), mgrPrj: new Set() };
// Team di un manager: i suoi riporti diretti. Se è Senior Manager anche i team dei suoi riporti
// (i manager associati), e così via finché nella catena c'è un Senior Manager.
// Riga (id, ps): ps = il manager di questa risorsa è Senior, quindi anche i suoi riporti fanno parte del team.
async function _teamOf(mid){
  mid = +mid || 0;
  const [r] = await sql`
    WITH RECURSIVE t(id, ps) AS (
      SELECT c.id, COALESCE((SELECT is_senior FROM risorse WHERE id = ${mid}), FALSE) FROM risorse c WHERE c.manager_id = ${mid}
      UNION
      SELECT c.id, p.is_senior FROM t JOIN risorse p ON p.id = t.id JOIN risorse c ON c.manager_id = t.id WHERE t.ps
    )
    SELECT ARRAY(SELECT DISTINCT id FROM t WHERE id <> ${mid}) AS team,
           ARRAY(SELECT DISTINCT progetto_id FROM allocazioni WHERE risorsa_id IN (SELECT id FROM t WHERE id <> ${mid})) AS prj`;
  return { team: (r.team || []).map(Number), prj: (r.prj || []).map(Number) };
}

async function loadCtx(token){
  const s = readSession(token);
  if (!s) throw _unauth();
  if (s.sub === 'admin') {
    const [r] = await sql`SELECT valore FROM config WHERE chiave='admin_pwd'`;
    if (!r || pwdVersion(r.valore) !== s.pv) throw _unauth();
    return { admin: true, id: null, manager: false, ..._NO_ROLES };
  }
  const [[r], tm] = await Promise.all([sql`
    SELECT r.id, r.is_manager, r.is_senior, u.pwd_hash,
           ARRAY(SELECT progetto_id FROM progetto_team_leads WHERE risorsa_id = r.id) AS tl,
           ARRAY(SELECT DISTINCT progetto_id FROM aree WHERE team_lead_id = r.id) AS atl
    FROM risorse r LEFT JOIN utenti_pwd u ON u.risorsa_id = r.id
    WHERE r.id = ${+s.sub || 0}`, _teamOf(s.sub)]);
  if (!r || !r.pwd_hash || pwdVersion(r.pwd_hash) !== s.pv) throw _unauth();
  const set = a => new Set((a || []).map(Number));
  return { admin: false, id: +r.id, manager: !!r.is_manager || !!r.is_senior, senior: !!r.is_senior,
           tlPrj: set(r.tl), areaTlPrj: set(r.atl), team: set(tm.team), mgrPrj: set(tm.prj) };
}

const _prjsOf = async rid => (await sql`SELECT progetto_id FROM allocazioni WHERE risorsa_id=${rid}`).map(r => +r.progetto_id);
async function _prjIdByName(nome){
  const [r] = await sql`SELECT id FROM progetti WHERE nome=${String(nome ?? '')}`;
  if (!r) throw new HttpError(404, 'Progetto non trovato: ' + nome);
  return +r.id;
}
// Dati di una risorsa: vedi canActOn (le allocazioni si leggono solo se servono, per i Team Lead)
async function mustActOn(ctx, rid){
  rid = V.id(rid, 'Risorsa');
  if (canActOn(ctx, rid) || canActOn(ctx, rid, await _prjsOf(rid))) return rid;
  deny('Non puoi modificare i dati di questa risorsa');
}
const mustAdmin    = ctx => { if (!ctx.admin) deny('Operazione riservata all\'amministratore'); };
const mustElevated = ctx => { if (!isElevated(ctx)) deny('Operazione riservata ad amministratore e manager'); };
const mustManage   = (ctx, pid) => { if (!canManageProject(ctx, pid)) deny('Non gestisci questo progetto'); };
// Anagrafica progetti: admin, oppure manager sui progetti delle sue risorse (come l'elenco in Admin)
const mustMgrPrj   = (ctx, pid) => { if (!ctx.admin && !(ctx.manager && ctx.mgrPrj.has(+pid))) deny('Non gestisci questo progetto'); };
async function _byManager(p, c, edit){
  const mid = +p.managerId;
  const ok = mid && (mid === c.id || (c.team.has(mid) && (await sql`SELECT 1 FROM risorse WHERE id=${mid} AND is_manager`).length));
  return { ...p, managerId: ok ? mid : c.id, isSenior: edit ? undefined : false, managerIds: [] };
}
const mustResAdmin = (ctx, rid) => { if (!canAdminResource(ctx, V.id(rid, 'Risorsa'))) deny('Puoi gestire solo le risorse del tuo team'); };
const mustPerson   = ctx => { if (ctx.admin) deny('Operazione non disponibile per l\'amministratore'); };
function _found(rows){
  if (!rows.length) throw new HttpError(404, 'Elemento non trovato (forse già eliminato)');
  return rows[0];
}

// Azioni senza login: accesso e link email (protetti dal proprio token firmato)
const PUBLIC = { loginLookup, login, requestInvite, inviteInfo, firstAccess, adminLogin, getTicketsByToken, saveTicketsByToken };

// Azioni con login: (payload, ctx). Il controllo dei permessi precede sempre l'esecuzione.
const ACTIONS = {
  bootstrap: (p, c) => bootstrap(c),
  session:   (p, c) => session(c),

  // ── dati personali ──
  saveOre:        async (p, c) => { await mustActOn(c, p.risorsaId); return saveOre(p); },
  deleteOre:      async (p, c) => { const o = _found(await sql`SELECT risorsa_id FROM ore_mensili WHERE id=${V.id(p.id)}`); await mustActOn(c, o.risorsa_id); return deleteOre(p); },
  saveFerie:      async (p, c) => { await mustActOn(c, p.risorsaId); return saveFerie(p); },
  deleteFerie:    async (p, c) => { const o = _found(await sql`SELECT risorsa_id FROM ferie WHERE id=${V.id(p.id)}`); await mustActOn(c, o.risorsa_id); return deleteFerie(p); },
  getPresenze:    (p, c) => getPresenze(p, c),
  savePresenza:   async (p, c) => { await mustActOn(c, p.risorsaId); return savePresenza(p); },
  deletePresenza: async (p, c) => { await mustActOn(c, p.risorsaId); return deletePresenza(p); },
  getConsuntivo:  (p, c) => getConsuntivo(p, c),
  saveConsuntivo: async (p, c) => { await mustActOn(c, p.risorsaId); return saveConsuntivo(p); },
  setDailyReminder: (p, c) => { const rid = V.id(p.risorsaId, 'Risorsa'); if (rid !== c.id) mustResAdmin(c, rid); return setDailyReminder(p); },

  // ── reperibilità: la risorsa, chi può agire su di lei, o chi gestisce il progetto ──
  getRepForProject: (p) => getRepForProject(p),
  saveRep: async (p, c) => { const pid = await _prjIdByName(p.progetto); if (!canManageProject(c, pid)) await mustActOn(c, p.risorsaId); return saveRep(p); },
  deleteRep: async (p, c) => {
    const o = _found(await sql`SELECT risorsa_id, progetto_id FROM reperibilita WHERE id=${V.id(p.id)}`);
    if (!canManageProject(c, o.progetto_id)) await mustActOn(c, o.risorsa_id);
    return deleteRep(p);
  },
  saveRepTipi:   (p, c) => { mustManage(c, V.id(p.id, 'Progetto')); return saveRepTipi(p); },
  // L'export è configurabile anche dalle risorse staffate sul progetto (card visibile nella loro Reperibilità)
  saveRepExport: async (p, c) => {
    const pid = V.id(p.id, 'Progetto');
    if (!canManageProject(c, pid) && !(c.id && (await _prjsOf(c.id)).includes(pid))) deny('Non fai parte di questo progetto');
    return saveRepExport(p);
  },

  // ── andamento progetto ──
  getAndamento: (p) => getAndamento(p),
  saveSoglia:   (p, c) => { mustManage(c, V.id(p.progettoId, 'Progetto')); return saveSoglia({ ...p, risorsaId: c.id }); },
  // Ticket ed Extra Effort si inseriscono sempre a proprio nome: la risorsa arriva dalla sessione
  getTicketDay: (p, c) => { mustPerson(c); return getTicketDay({ ...p, risorsaId: c.id }); },
  saveTickets:  (p, c) => { mustPerson(c); return saveTickets({ ...p, risorsaId: c.id }); },
  saveBenchmark: (p, c) => { mustElevated(c); return saveBenchmark(p); },   // admin, manager e Senior Manager
  saveArea:   (p, c) => { mustAdmin(c); return saveArea(p); },
  deleteArea: (p, c) => { mustAdmin(c); return deleteArea(p); },

  // ── team (admin e manager) ──
  saveWbs: (p, c) => { mustResAdmin(c, p.risorsaId); return saveWbs(p); },
  sollecitaForecast: (p, c) => { mustElevated(c); return sollecitaForecast({ ...p, managerId: c.admin ? p.managerId : c.id }); },
  userHasPwd:   (p, c) => { mustElevated(c); return userHasPwd(p); },
  resetUserPwd: (p, c) => { mustResAdmin(c, p.risorsaId); return resetUserPwd(p); },
  // Il manager aggiunge e modifica solo risorse del proprio team, di cui resta il manager
  // Il manager aggiunge e modifica solo risorse del proprio team: ne resta manager lui o, per il Senior Manager,
  // uno dei manager associati. Il ruolo Senior Manager e i manager associati li gestisce solo l'admin.
  addResource:    async (p, c) => { mustElevated(c); return addResource(c.admin ? p : await _byManager(p, c, false)); },
  saveEdit:       async (p, c) => { mustResAdmin(c, p.id); return saveEdit(c.admin ? p : await _byManager(p, c, true)); },
  deleteResource: (p, c) => { mustResAdmin(c, p.id); return deleteResource(p); },
  setResourceManager: (p, c) => { mustAdmin(c); return setResourceManager(p); },
  toggleIsManager:    (p, c) => { mustAdmin(c); return toggleIsManager(p); },

  // ── progetti ──
  addProject:      (p, c) => { mustElevated(c); return addProject(p); },
  deleteProject:   async (p, c) => { mustMgrPrj(c, await _prjIdByName(p.nome)); return deleteProject(p); },
  addProjectTL:    (p, c) => { mustMgrPrj(c, V.id(p.progettoId, 'Progetto')); return addProjectTL(p); },
  removeProjectTL: (p, c) => { mustMgrPrj(c, V.id(p.progettoId, 'Progetto')); return removeProjectTL(p); },
  saveProjectWbs:  (p, c) => { mustMgrPrj(c, V.id(p.id, 'Progetto')); return saveProjectWbs(p); },
  saveProjectLead: () => null,   // deprecata, mantenuta per compatibilità

  // ── eventi (permessi negli handler: invitati, organizzatore, admin) ──
  getEventi:         (p, c) => getEventi(p, c),
  getEvento:         (p, c) => getEvento(p, c),
  saveEvento:        (p, c) => saveEvento(p, c),
  deleteEvento:      (p, c) => deleteEvento(p, c),
  setEventoData:     (p, c) => setEventoData(p, c),
  setDisponibilita:  (p, c) => setDisponibilita(p, c),
  setPartecipazione: (p, c) => setPartecipazione(p, c),

  setTema: (p, c) => setTema(p, c),   // ognuno solo il proprio

  // ── confronto & feedback (solo risorse; permessi negli handler) ──
  getConfronti:    (p, c) => getConfronti(p, c),
  saveConfronto:   (p, c) => saveConfronto(p, c),
  deleteConfronto: (p, c) => deleteConfronto(p, c),
  updateConfronto: (p, c) => updateConfronto(p, c),

  // ── solo admin ──
  setAdminPwd: (p, c) => { mustAdmin(c); return setAdminPwd(p); },
  getEmailLog: (p, c) => { mustAdmin(c); return getEmailLog(p); }
};

// Errori: il dettaglio tecnico va nei log, al client un messaggio comprensibile
function _errorResponse(err, action){
  if (err instanceof HttpError) return { status: err.status, msg: err.message };
  if (err && typeof err.code === 'string' && /^[0-9A-Z]{5}$/.test(err.code)) {
    console.error(JSON.stringify({ level: 'error', action, kind: 'db', code: err.code, error: err.message }));
    if (err.code === '23505') return { status: 409, msg: 'Valore già esistente' };
    if (err.code === '23503') return { status: 409, msg: 'Operazione non possibile: il dato è collegato ad altri elementi o non esiste più' };
    if (['23514', '22P02', '22003', '22007', '22008'].includes(err.code)) return { status: 400, msg: 'Valore non valido' };
    if (err.code === '22001') return { status: 400, msg: 'Valore troppo lungo' };
    return { status: 500, msg: 'Errore del database: riprova tra poco' };
  }
  // I messaggi di validazione esistenti usano Error semplice; gli errori di programma (TypeError…) restano interni
  if (err && err.constructor === Error) return { status: 400, msg: err.message };
  console.error(JSON.stringify({ level: 'error', action, kind: 'internal', error: String((err && err.stack) || err) }));
  return { status: 500, msg: 'Errore interno del server' };
}

export async function handler(event){
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
  if(event.httpMethod !== 'POST') return reply(405, { error: 'Method Not Allowed' });
  let action, payload;
  try {
    const parsed = JSON.parse(event.body || '{}');
    action = parsed.action; payload = parsed.payload || {};
    if (typeof payload !== 'object' || Array.isArray(payload)) throw new Error();
  } catch {
    return reply(400, { error: 'Body JSON non valido' });
  }
  const pub = Object.hasOwn(PUBLIC, action) ? PUBLIC[action] : null;
  const fn  = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if(!pub && !fn) return reply(400, { error: 'Action sconosciuta: ' + action });
  const t0 = Date.now();
  try {
    await ensureSchema(sql);
    let result;
    if (pub) result = await pub(payload);
    else {
      const h = event.headers || {}, auth = String(h.authorization || h.Authorization || '');
      const ctx = await loadCtx(auth.startsWith('Bearer ') ? auth.slice(7) : '');
      result = await fn(payload, ctx);
    }
    return reply(200, { ok: true, data: result ?? null });
  } catch (err) {
    const { status, msg } = _errorResponse(err, action);
    if (status >= 400 && status < 500 && status !== 401) console.warn(JSON.stringify({ level: 'warn', action, status, error: msg, ms: Date.now() - t0 }));
    return reply(status, { error: msg });
  }
}
