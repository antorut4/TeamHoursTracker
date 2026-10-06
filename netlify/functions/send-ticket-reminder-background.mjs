// ════════════════════════════════════════════════════════════════════════
//  send-ticket-reminder-background.mjs — Netlify Scheduled Background Function
//  Schedule: 0 8 * * 1-5  (08:00 UTC = 09:00 CET / 10:00 CEST)
//  Ogni mattina chiede ai Team Lead delle aree attive i ticket aperti il giorno
//  PRECEDENTE. Lunedì → venerdì, sabato e domenica (i ticket arrivano anche nel weekend).
//  Una sola email per TL con tutte le sue aree; TL già in regola non ricevono nulla.
// ════════════════════════════════════════════════════════════════════════
import { neon }       from '@neondatabase/serverless';
import { createHmac } from 'crypto';
import nodemailer      from 'nodemailer';

const sql       = neon(process.env.DATABASE_URL);
const SECRET    = process.env.DAILY_TOKEN_SECRET;
const SITE_URL  = (process.env.SITE_URL || '').replace(/\/$/, '');
const FROM_NAME = process.env.FROM_NAME || 'Team Hours Tracker';
const TOKEN_HOURS = 72;

const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// Scrive una riga in email_log. Errori silenziati: il log non deve rompere l'invio.
async function logEmail(destinatario, nome, oggetto, stato, errore, meta) {
  try {
    await sql`INSERT INTO email_log (tipo, destinatario, nome, oggetto, stato, errore, meta)
              VALUES ('ticket_reminder', ${destinatario}, ${nome || null}, ${oggetto || null},
                      ${stato}, ${errore || null}, ${meta ? JSON.stringify(meta) : null})`;
  } catch (e) { console.error('[email_log]', e.message); }
}

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Date di riferimento: lunedì → [ven, sab, dom], altrimenti → [ieri]
function getReferenceDates(today) {
  const dow  = today.getUTCDay();
  const back = dow === 1 ? [3, 2, 1] : [1];
  return back.map(n => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().split('T')[0];
  });
}

// Token di tipo 'tk' (ticket): distinto dal token ore, non intercambiabile
function generateToken(risorsaId, dates) {
  const exp = Math.floor(Date.now() / 1000) + TOKEN_HOURS * 3600;
  const b64 = Buffer.from(JSON.stringify({ k: 'tk', r: risorsaId, ds: dates, e: exp })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

const _IT_DAYS   = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
const _IT_MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                    'luglio','agosto','settembre','ottobre','novembre','dicembre'];

// "Lunedì 5 ottobre 2026"
function formatDateIT(iso) {
  const [y, m, d] = iso.split('-');
  const dt = new Date(`${iso}T12:00:00Z`);
  return `${_IT_DAYS[dt.getUTCDay()]} ${parseInt(d)} ${_IT_MONTHS[parseInt(m) - 1]} ${y}`;
}

export const handler = async () => {
  const today = new Date();
  const dow   = today.getUTCDay();
  const RUN   = '(sistema)';

  if (dow === 0 || dow === 6) {
    await logEmail(RUN, null, null, 'skipped', 'Weekend — esecuzione saltata',
                   { giorno: today.toISOString().split('T')[0], dow });
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'weekend' }) };
  }

  const dates = getReferenceDates(today);
  await logEmail(RUN, null, null, 'run_start', null, { giorni: dates });

  try {
    // Tabelle create dal bootstrap dell'app: se mancano non c'è ancora nessuna area configurata
    const [reg] = await sql`SELECT to_regclass('public.aree') IS NOT NULL AS ok`;
    if (!reg.ok) {
      await logEmail(RUN, null, null, 'run_end', null, { giorni: dates, destinatari: 0, inviate: 0, errori: 0 });
      return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'no_schema' }) };
    }

    const rows = await sql`
      SELECT r.id AS tl_id, r.full_name, r.email, a.id AS area_id, a.nome AS area, p.nome AS progetto,
             (SELECT COUNT(*)::int FROM ticket_giornalieri t
               WHERE t.area_id = a.id AND t.data = ANY(${dates}::date[])) AS inseriti,
             (SELECT COUNT(*)::int FROM aree a2 WHERE a2.progetto_id = a.progetto_id) AS n_aree
      FROM aree a
      JOIN progetti p ON p.id = a.progetto_id
      JOIN risorse r  ON r.id = a.team_lead_id
      WHERE a.attiva AND r.email IS NOT NULL AND r.email <> ''
      ORDER BY r.cognome, r.nome, p.nome, a.nome`;

    // Extra Effort già registrato per le date di riferimento: precompila la tabella nell'email
    const [eeReg] = await sql`SELECT to_regclass('public.extra_effort') IS NOT NULL AS ok`;
    const eeRows = eeReg.ok && rows.length ? await sql`
      SELECT area_id, attivita, ore::float AS ore FROM extra_effort
      WHERE area_id = ANY(${rows.map(r => r.area_id)}::int[]) AND data = ANY(${dates}::date[])
      ORDER BY data, id` : [];
    const eeByArea = {};
    eeRows.forEach(e => { (eeByArea[e.area_id] = eeByArea[e.area_id] || []).push({ attivita: e.attivita, ore: e.ore }); });

    // Raggruppa per TL; salta chi ha già inserito tutte le date per tutte le aree.
    // L'Extra Effort è facoltativo: non conta fra gli inserimenti mancanti.
    const byTL = {};
    rows.forEach(r => {
      if (!byTL[r.tl_id]) byTL[r.tl_id] = { id: +r.tl_id, full_name: r.full_name, email: r.email, aree: [], mancanti: 0 };
      byTL[r.tl_id].aree.push({ progetto: r.progetto, area: r.area, multi: r.n_aree > 1, ee: eeByArea[r.area_id] || [] });
      byTL[r.tl_id].mancanti += dates.length - r.inseriti;
    });
    const tls = Object.values(byTL);
    const toSend = tls.filter(t => t.mancanti > 0);

    const results = { sent: 0, errors: [], skipped: tls.length - toSend.length };
    for (const tl of toSend) {
      const subject = dates.length > 1
        ? `Ticket ed Extra Effort — da ${formatDateIT(dates[0])} a ${formatDateIT(dates[dates.length - 1])}`
        : `Ticket ed Extra Effort di ieri — ${formatDateIT(dates[0])}`;
      const meta = { giorni: dates, aree: tl.aree.map(a => `${a.progetto} / ${a.area}`) };
      try {
        const token = generateToken(tl.id, dates);
        const link  = `${SITE_URL}/ticket-entry.html?token=${encodeURIComponent(token)}`;
        const firstName = tl.full_name.split(' ')[0];
        const info = await transporter.sendMail({
          from: `${FROM_NAME} <${process.env.GMAIL_USER}>`,
          to:   tl.email,
          subject,
          html: buildEmailHtml(firstName, tl.full_name, tl.aree, dates, link),
          text: buildEmailText(firstName, tl.full_name, tl.aree, dates, link)
        });
        const rejected = info?.rejected || [];
        if (rejected.length) {
          results.errors.push({ email: tl.email, error: 'destinatario rifiutato da SMTP' });
          await logEmail(tl.email, tl.full_name, subject, 'error', 'Destinatario rifiutato da SMTP',
                         { ...meta, response: info?.response || null, rejected });
        } else {
          results.sent++;
          await logEmail(tl.email, tl.full_name, subject, 'sent', null,
                         { ...meta, messageId: info?.messageId || null, response: info?.response || null });
        }
      } catch (err) {
        console.error(`✗ ${tl.email}: ${err.message}`);
        results.errors.push({ email: tl.email, error: err.message });
        await logEmail(tl.email, tl.full_name, subject, 'error', err.message,
                       { ...meta, code: err.code || null, responseCode: err.responseCode || null });
      }
    }

    await logEmail(RUN, null, null, 'run_end', null, {
      giorni: dates, destinatari: toSend.length, inviate: results.sent,
      errori: results.errors.length, gia_inseriti: results.skipped
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, dates, ...results }) };

  } catch (err) {
    console.error('[ticket-reminder] crash:', err.message);
    await logEmail(RUN, null, null, 'run_error', err.message, { giorni: dates });
    return { statusCode: 500, body: JSON.stringify({ ok: false, dates, error: err.message }) };
  }
};

function fmtOre(n) {
  return Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 });
}

// [[progetto, [aree...]], ...] mantenendo l'ordine della query
function groupByProject(aree) {
  const m = new Map();
  aree.forEach(a => { if (!m.has(a.progetto)) m.set(a.progetto, []); m.get(a.progetto).push(a); });
  return [...m.entries()];
}

// Area da mostrare come sottotitolo solo se il progetto è suddiviso in più aree
const showArea = (list) => list.length > 1 || list[0].multi;

function buildEeText(aree) {
  return groupByProject(aree).map(([progetto, list]) => {
    let t = `${progetto}\n`;
    let tot = 0;
    list.forEach(a => {
      if (showArea(list)) t += `  Area: ${a.area}\n`;
      t += `  Tipologia attività / Dettaglio | Extra Effort (ore)\n`;
      if (a.ee.length) a.ee.forEach(e => { t += `  - ${e.attivita} | ${fmtOre(e.ore)}\n`; tot += e.ore; });
      else t += `  - (da compilare) | —\n`;
    });
    t += `  Totale Extra Effort ${progetto}: ${tot ? fmtOre(tot) + ' ore' : '—'}\n`;
    return t;
  }).join('\n');
}

function buildEmailText(firstName, fullName, aree, dates, link) {
  return `Team Hours Tracker — Inserimento ticket ed Extra Effort

Buongiorno ${firstName},
inserisci i ticket aperti ${dates.length > 1 ? 'nei giorni indicati' : 'ieri'} per le tue aree e l'eventuale Extra Effort.

Data di riferimento: ${dates.map(formatDateIT).join(', ')}

Aree:
${aree.map(a => `- Progetto: ${a.progetto} — Area: ${a.area}`).join('\n')}

Extra Effort per progetto (una riga per attività):
${buildEeText(aree)}
Inserisci il numero di ticket aperti suddividendoli per livello (L1, L2, L3) e compila la tabella Extra Effort:
${link}

Link valido ${TOKEN_HOURS} ore.

---
Messaggio automatico per ${fullName}. Non rispondere a questa email.`;
}

// Template Outlook-safe: stesse regole dell'email del reminder ore
function buildEmailHtml(firstName, fullName, aree, dates, link) {
  const areeHtml = aree.map(a => `
                <tr>
                  <td style="padding:7px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;border-bottom:1px solid #eeeeee;" class="dm-intro">${_esc(a.progetto)}</td>
                  <td style="padding:7px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#111827;border-bottom:1px solid #eeeeee;" class="dm-name">${_esc(a.area)}</td>
                </tr>`).join('');
  const datesHtml = dates.map(d => `
              <tr>
                <td align="center" bgcolor="#f3e8ff" class="dm-badge" style="background-color:#f3e8ff;border-radius:6px;padding:8px 18px;">
                  <p style="margin:0;font-size:14px;font-weight:700;color:#7b00cc;font-family:Arial,Helvetica,sans-serif;white-space:nowrap;" class="dm-badge-text">&#128197; ${formatDateIT(d)}</p>
                </td>
              </tr>
              <tr><td style="height:6px;line-height:6px;font-size:6px;">&nbsp;</td></tr>`).join('');
  // Tabella Extra Effort per progetto: righe già registrate, oppure righe vuote da compilare dal link
  const cell = 'padding:7px 12px;font-family:Arial,Helvetica,sans-serif;font-size:13px;border-bottom:1px solid #eeeeee;text-align:left;';
  const head = 'padding:7px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;background-color:#f8f9fc;text-align:left;';
  const eeHtml = groupByProject(aree).map(([progetto, list]) => {
    let tot = 0;
    const body = list.map(a => {
      const sub = showArea(list) ? `
                <tr><td colspan="2" style="${cell}font-size:12px;font-weight:700;color:#7b00cc;" class="dm-name">Area: ${_esc(a.area)}</td></tr>` : '';
      const rowsHtml = a.ee.length
        ? a.ee.map(e => { tot += e.ore; return `
                <tr>
                  <td style="${cell}color:#111827;" class="dm-name">${_esc(e.attivita)}</td>
                  <td style="${cell}color:#111827;font-weight:700;text-align:right;white-space:nowrap;" class="dm-name">${fmtOre(e.ore)}</td>
                </tr>`; }).join('')
        : [1, 2, 3].map(() => `
                <tr>
                  <td style="${cell}color:#9ca3af;" class="dm-valid">Attività / dettaglio</td>
                  <td style="${cell}color:#9ca3af;text-align:right;" class="dm-valid">—</td>
                </tr>`).join('');
      return `${sub}
                <tr><td style="${head}">Tipologia attività / Dettaglio</td><td style="${head}text-align:right;white-space:nowrap;">Extra Effort (ore)</td></tr>${rowsHtml}`;
    }).join('');
    return `
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;border:1px solid #eeeeee;border-radius:6px;">
              <tr><td colspan="2" bgcolor="#f3e8ff" class="dm-badge" style="padding:9px 12px;background-color:#f3e8ff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#7b00cc;text-align:left;"><span class="dm-badge-text">${_esc(progetto)}</span></td></tr>${body}
              <tr>
                <td style="${cell}border-bottom:none;font-weight:700;color:#111827;" class="dm-name">Totale Extra Effort ${_esc(progetto)}</td>
                <td style="${cell}border-bottom:none;font-weight:700;color:#111827;text-align:right;white-space:nowrap;" class="dm-name">${tot ? `${fmtOre(tot)} ore` : '—'}</td>
              </tr>
            </table>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Team Hours Tracker</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>table { border-collapse: collapse; }</style>
<![endif]-->
<style>
body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
@media (prefers-color-scheme: dark) {
  .dm-outer  { background-color: #1e1e2e !important; }
  .dm-card   { background-color: #2a2a3e !important; }
  .dm-body   { background-color: #2a2a3e !important; }
  .dm-footer { background-color: #222230 !important; border-top-color: #3a3a52 !important; }
  .dm-name   { color: #ffffff !important; }
  .dm-intro  { color: #cccccc !important; }
  .dm-badge  { background-color: #3d1f6e !important; }
  .dm-badge-text { color: #d8aaff !important; }
  .dm-valid  { color: #aaaaaa !important; }
  .dm-link-text { color: #d8aaff !important; }
  .dm-foot-text { color: #888888 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dm-outer" style="background-color:#f0f2f5;width:100%;">
  <tr>
    <td align="center" valign="top" style="padding:40px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="dm-card" style="max-width:600px;width:100%;background-color:#ffffff;">

        <!-- ═══ HEADER ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#A100FF" style="background-color:#A100FF;padding:32px 40px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;line-height:1.3;">Team Hours Tracker</p>
            <p style="margin:8px 0 0;font-size:13px;color:#e8c4ff;font-family:Arial,Helvetica,sans-serif;line-height:1.4;">Inserimento ticket ed Extra Effort</p>
          </td>
        </tr>

        <!-- ═══ CORPO ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#ffffff" class="dm-body" style="background-color:#ffffff;padding:40px 40px 20px;">
            <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;line-height:1.3;" class="dm-name">Buongiorno ${_esc(firstName)},</p>
            <p style="margin:0 0 24px;font-size:15px;color:#555555;font-family:Arial,Helvetica,sans-serif;line-height:1.5;" class="dm-intro">
              inserisci i ticket aperti ${dates.length > 1 ? 'nei giorni indicati' : 'ieri'} per ${aree.length > 1 ? 'le tue aree' : 'la tua area'}, suddividendoli per livello L1, L2 e L3, e l'eventuale Extra Effort.
            </p>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto 18px;">
              ${datesHtml}
            </table>
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 30px;border:1px solid #eeeeee;border-radius:6px;">
              <tr>
                <td style="padding:7px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;background-color:#f8f9fc;">Progetto</td>
                <td style="padding:7px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;background-color:#f8f9fc;">Area</td>
              </tr>
              ${areeHtml}
            </table>

            <p style="margin:0 0 6px;font-size:15px;font-weight:700;color:#111827;font-family:Arial,Helvetica,sans-serif;text-align:left;" class="dm-name">Extra Effort</p>
            <p style="margin:0 0 14px;font-size:13px;color:#555555;font-family:Arial,Helvetica,sans-serif;line-height:1.5;text-align:left;" class="dm-intro">
              Per ogni progetto indica le attività di Extra Effort svolte: una riga per attività, con tipologia/dettaglio e ore. La tabella si compila dal pulsante qui sotto (puoi aggiungere tutte le righe necessarie).
            </p>
            ${eeHtml}
            <div style="height:14px;line-height:14px;font-size:14px;">&nbsp;</div>

            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
                         href="${link}" style="height:52px;v-text-anchor:middle;width:360px;" arcsize="7%"
                         strokecolor="#A100FF" fillcolor="#A100FF">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;letter-spacing:0.5px;">INSERISCI TICKET ED EXTRA EFFORT</center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
              <tr>
                <td align="center" bgcolor="#A100FF" style="background-color:#A100FF;border-radius:6px;">
                  <a href="${link}" style="display:inline-block;padding:16px 44px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.3px;border-radius:6px;mso-hide:all;">INSERISCI TICKET ED EXTRA EFFORT</a>
                </td>
              </tr>
            </table>
            <!--<![endif]-->
          </td>
        </tr>

        <!-- ═══ VALIDITÀ + LINK FALLBACK ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#ffffff" class="dm-body" style="background-color:#ffffff;padding:16px 40px 36px;">
            <p style="margin:0 0 14px;font-size:13px;color:#888888;font-family:Arial,Helvetica,sans-serif;line-height:1.5;" class="dm-valid">Link valido ${TOKEN_HOURS} ore.</p>
            <p style="margin:0;font-size:13px;color:#888888;font-family:Arial,Helvetica,sans-serif;line-height:1.6;" class="dm-valid">
              Problemi con il pulsante?<br>
              <a href="${link}" style="color:#A100FF;text-decoration:underline;font-family:Arial,Helvetica,sans-serif;" class="dm-link-text">Apri inserimento ticket ed Extra Effort</a>
            </p>
          </td>
        </tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#f8f9fc" class="dm-footer" style="background-color:#f8f9fc;padding:20px 40px;border-top:1px solid #eeeeee;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;font-family:Arial,Helvetica,sans-serif;line-height:1.6;" class="dm-foot-text">
              Messaggio automatico per ${_esc(fullName)}.<br>Non rispondere a questa email.
            </p>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
