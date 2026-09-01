// ════════════════════════════════════════════════════════════════════════
//  send-daily-reminder-background.mjs — Netlify Scheduled Background Function
//  Schedule: 0 8 * * 1-5  (08:00 UTC = 09:00 CET / 10:00 CEST)
//  Ogni mattina invia l'email per registrare le ore del giorno PRECEDENTE.
//  Lunedì → email per venerdì. Martedì-Venerdì → email per ieri.
// ════════════════════════════════════════════════════════════════════════
import { neon }       from '@neondatabase/serverless';
import { createHmac } from 'crypto';
import nodemailer      from 'nodemailer';

const sql       = neon(process.env.DATABASE_URL);
const SECRET    = process.env.DAILY_TOKEN_SECRET;
const SITE_URL  = (process.env.SITE_URL || '').replace(/\/$/, '');
const FROM_NAME = process.env.FROM_NAME || 'Team Hours Tracker';

const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

function getPreviousWorkday(today) {
  const date = new Date(today);
  const dow  = date.getUTCDay();
  const back = dow === 1 ? 3 : 1;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().split('T')[0];
}

// Token valido 48 ore — copre il gap lunedì→venerdì
function generateToken(risorsaId, data) {
  const exp = Math.floor(Date.now() / 1000) + 48 * 3600;
  const b64 = Buffer.from(JSON.stringify({ r: risorsaId, d: data, e: exp })).toString('base64url');
  const sig  = createHmac('sha256', SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

const _IT_DAYS   = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
const _IT_MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                    'luglio','agosto','settembre','ottobre','novembre','dicembre'];

// "Lunedì 31 agosto 2026"
function formatDateIT(iso) {
  const [y, m, d] = iso.split('-');
  const dt = new Date(`${iso}T12:00:00Z`);
  return `${_IT_DAYS[dt.getUTCDay()]} ${parseInt(d)} ${_IT_MONTHS[parseInt(m) - 1]} ${y}`;
}

// "02 settembre 2026"
function formatDateShortIT(date) {
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${d} ${_IT_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

async function sendEmail(risorsa, dataISO) {
  const token     = generateToken(+risorsa.id, dataISO);
  const dateLabel = formatDateIT(dataISO);
  const firstName = risorsa.full_name.split(' ')[0];
  const link      = `${SITE_URL}/daily-hours.html?token=${encodeURIComponent(token)}`;
  const expDate   = new Date(Date.now() + 48 * 3600 * 1000);
  const expLabel  = formatDateShortIT(expDate);

  await transporter.sendMail({
    from:    `${FROM_NAME} <${process.env.GMAIL_USER}>`,
    to:      risorsa.email,
    subject: `Ore di ieri — ${dateLabel}`,
    html:    buildEmailHtml(firstName, risorsa.full_name, dateLabel, link, expLabel),
    text:    buildEmailText(firstName, risorsa.full_name, dateLabel, link, expLabel)
  });
}

export const handler = async () => {
  const today = new Date();
  const dow   = today.getUTCDay();
  if (dow === 0 || dow === 6) {
    console.log('Weekend — nessuna email inviata');
    return { statusCode: 200, body: JSON.stringify({ ok: true, skipped: 'weekend' }) };
  }

  const dataISO = getPreviousWorkday(today);
  console.log(`Invio reminder per il giorno precedente: ${dataISO}`);

  const risorse = await sql`
    SELECT id, full_name, email
    FROM risorse
    WHERE email IS NOT NULL AND email <> ''
    ORDER BY cognome, nome`;

  const results = { sent: 0, errors: [] };
  for (const r of risorse) {
    try {
      await sendEmail(r, dataISO);
      results.sent++;
      console.log(`✓ ${r.email}`);
    } catch (err) {
      console.error(`✗ ${r.email}: ${err.message}`);
      results.errors.push({ email: r.email, error: err.message });
    }
  }

  console.log(`Fine: ${results.sent} inviate, ${results.errors.length} errori`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, dataISO, ...results }) };
};

// ── Versione testo puro (client senza HTML, screen reader, etc.) ──
function buildEmailText(firstName, fullName, dateLabel, link, expLabel) {
  return `Team Hours Tracker — Registrazione ore

Ciao ${firstName},

Quante ore hai lavorato ieri?

Data: ${dateLabel}

Inserisci le ore qui:
${link}

Link valido fino al: ${expLabel}

---
Messaggio automatico per ${fullName}. Non rispondere a questa email.`;
}

// ── Template HTML Outlook-safe ──
// Regole applicate:
//   - table layout ovunque (no flexbox, no grid)
//   - tutti i colori CSS inline (no classi esterne)
//   - pulsante con VML per Outlook + <a> fallback per tutti gli altri client
//   - bgcolor="" come attributo tabella (Outlook lo legge anche senza CSS)
//   - border-radius solo su client non-Outlook (Outlook lo ignora senza crash)
//   - nessun URL visibile nel body — solo testo ancora "Apri registrazione ore"
//   - dark mode via @media per Gmail e Apple Mail
//   - mso-color-alt per hint Outlook dark mode su testo critico
//   - xmlns:v e xmlns:o obbligatori per VML
function buildEmailHtml(firstName, fullName, dateLabel, link, expLabel) {
  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Team Hours Tracker</title>
<!--[if mso]>
<xml>
<o:OfficeDocumentSettings>
<o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
<style>
  table { border-collapse: collapse; }
</style>
<![endif]-->
<style>
/* Reset universale */
body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
img { border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }

/* Dark mode — Gmail e Apple Mail (Outlook ignora @media) */
@media (prefers-color-scheme: dark) {
  .dm-outer  { background-color: #1e1e2e !important; }
  .dm-card   { background-color: #2a2a3e !important; }
  .dm-body   { background-color: #2a2a3e !important; }
  .dm-footer { background-color: #222230 !important; border-top-color: #3a3a52 !important; }
  .dm-h1     { color: #ffffff !important; }
  .dm-sub    { color: #cccccc !important; }
  .dm-name   { color: #ffffff !important; }
  .dm-intro  { color: #cccccc !important; }
  .dm-badge  { background-color: #3d1f6e !important; }
  .dm-badge-text { color: #d8aaff !important; }
  .dm-valid  { color: #aaaaaa !important; }
  .dm-valid strong { color: #cccccc !important; }
  .dm-link-text { color: #d8aaff !important; }
  .dm-foot-text { color: #888888 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">

<!-- Tabella esterna: copre tutta la viewport e centra la card -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       class="dm-outer"
       style="background-color:#f0f2f5;width:100%;">
  <tr>
    <td align="center" valign="top" style="padding:40px 16px;">

      <!-- Card principale — max 600px -->
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
             class="dm-card"
             style="max-width:600px;width:100%;background-color:#ffffff;">

        <!-- ═══ HEADER ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#A100FF"
              style="background-color:#A100FF;padding:32px 40px;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#ffffff;
                      font-family:Arial,Helvetica,sans-serif;line-height:1.3;"
               class="dm-h1">Team Hours Tracker</p>
            <p style="margin:8px 0 0;font-size:13px;color:#e8c4ff;
                      font-family:Arial,Helvetica,sans-serif;line-height:1.4;"
               class="dm-sub">Registrazione ore</p>
          </td>
        </tr>

        <!-- ═══ CORPO ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#ffffff"
              class="dm-body"
              style="background-color:#ffffff;padding:40px 40px 28px;">

            <!-- Saluto -->
            <p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827;
                      font-family:Arial,Helvetica,sans-serif;line-height:1.3;"
               class="dm-name">Ciao ${firstName},</p>
            <p style="margin:0 0 32px;font-size:15px;color:#555555;
                      font-family:Arial,Helvetica,sans-serif;line-height:1.5;"
               class="dm-intro">Quante ore hai lavorato ieri?</p>

            <!-- Badge data — tabella per centratura cross-client -->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"
                   style="margin:0 auto 36px;">
              <tr>
                <td align="center" bgcolor="#f3e8ff"
                    class="dm-badge"
                    style="background-color:#f3e8ff;border-radius:6px;padding:10px 22px;">
                  <p style="margin:0;font-size:14px;font-weight:700;color:#7b00cc;
                            font-family:Arial,Helvetica,sans-serif;white-space:nowrap;"
                     class="dm-badge-text">&#128197; ${dateLabel}</p>
                </td>
              </tr>
            </table>

            <!-- ═══ PULSANTE ═══
                 VML per Outlook Desktop (ignorato dagli altri client).
                 <a> standard per Gmail, Apple Mail, Outlook Web. -->
            <!--[if mso]>
            <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
                         xmlns:w="urn:schemas-microsoft-com:office:word"
                         href="${link}"
                         style="height:52px;v-text-anchor:middle;width:280px;"
                         arcsize="7%"
                         strokecolor="#A100FF"
                         fillcolor="#A100FF">
              <w:anchorlock/>
              <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;
                             font-size:17px;font-weight:700;letter-spacing:0.5px;">
                INSERISCI LE ORE
              </center>
            </v:roundrect>
            <![endif]-->
            <!--[if !mso]><!-->
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center"
                   style="margin:0 auto;">
              <tr>
                <td align="center" bgcolor="#A100FF"
                    style="background-color:#A100FF;border-radius:6px;">
                  <a href="${link}"
                     style="display:inline-block;padding:16px 44px;font-family:Arial,Helvetica,sans-serif;
                            font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;
                            letter-spacing:0.3px;border-radius:6px;mso-hide:all;">
                    INSERISCI LE ORE
                  </a>
                </td>
              </tr>
            </table>
            <!--<![endif]-->

          </td>
        </tr>

        <!-- ═══ VALIDITÀ + LINK FALLBACK ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#ffffff"
              class="dm-body"
              style="background-color:#ffffff;padding:20px 40px 36px;">

            <p style="margin:0 0 14px;font-size:13px;color:#888888;
                      font-family:Arial,Helvetica,sans-serif;line-height:1.5;"
               class="dm-valid">
              Valido fino al:
              <strong style="color:#555555;mso-color-alt:windowtext;">${expLabel}</strong>
            </p>

            <!-- Fallback link testuale: nessun URL visibile,
                 Proofpoint riscriverà l'href ma il testo resta leggibile -->
            <p style="margin:0;font-size:13px;color:#888888;
                      font-family:Arial,Helvetica,sans-serif;line-height:1.6;"
               class="dm-valid">
              Problemi con il pulsante?<br>
              <a href="${link}"
                 style="color:#A100FF;text-decoration:underline;
                        font-family:Arial,Helvetica,sans-serif;"
                 class="dm-link-text">Apri registrazione ore</a>
            </p>

          </td>
        </tr>

        <!-- ═══ FOOTER ═══ -->
        <tr>
          <td align="center" valign="top" bgcolor="#f8f9fc"
              class="dm-footer"
              style="background-color:#f8f9fc;padding:20px 40px;
                     border-top:1px solid #eeeeee;">
            <p style="margin:0;font-size:12px;color:#aaaaaa;
                      font-family:Arial,Helvetica,sans-serif;line-height:1.6;"
               class="dm-foot-text">
              Messaggio automatico per ${fullName}.<br>
              Non rispondere a questa email.
            </p>
          </td>
        </tr>

      </table>
      <!-- Fine card -->

    </td>
  </tr>
</table>

</body>
</html>`;
}
