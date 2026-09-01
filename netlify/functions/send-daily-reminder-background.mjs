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

// ── Nodemailer: connessione Gmail SMTP ──
const transporter = nodemailer.createTransport({
  host:   'smtp.gmail.com',
  port:   587,
  secure: false,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD
  }
});

// ── calcola il giorno lavorativo precedente ──
// Lunedì (1) → torna al venerdì scorso (-3 giorni)
// Martedì-Venerdì (2-5) → ieri (-1 giorno)
function getPreviousWorkday(today) {
  const date = new Date(today);
  const dow  = date.getUTCDay();
  const back = dow === 1 ? 3 : 1;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().split('T')[0];
}

// ── genera token valido 48 ore (copre anche il caso lunedì→venerdì) ──
function generateToken(risorsaId, data) {
  const exp = Math.floor(Date.now() / 1000) + 48 * 3600;
  const b64 = Buffer.from(JSON.stringify({ r: risorsaId, d: data, e: exp })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function formatDateIT(iso) {
  const DAYS   = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];
  const MONTHS = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                  'luglio','agosto','settembre','ottobre','novembre','dicembre'];
  const [y, m, d] = iso.split('-');
  const dt = new Date(`${iso}T12:00:00Z`);
  return `${DAYS[dt.getUTCDay()]} ${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`;
}

async function sendEmail(risorsa, dataISO) {
  const token     = generateToken(+risorsa.id, dataISO);
  const dateLabel = formatDateIT(dataISO);
  const firstName = risorsa.full_name.split(' ')[0];
  const link      = `${SITE_URL}/daily-hours.html?token=${encodeURIComponent(token)}`;

  await transporter.sendMail({
    from:    `${FROM_NAME} <${process.env.GMAIL_USER}>`,
    to:      risorsa.email,
    subject: `Ore di ieri — ${dateLabel}`,
    html:    buildEmailHtml(firstName, risorsa.full_name, dateLabel, link)
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

function buildEmailHtml(firstName, fullName, dateLabel, link) {
  return `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;padding:0;background:#f4f6f9;
       font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif}
  .w{max-width:600px;margin:40px auto;background:#fff;border-radius:12px;
     overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08)}
  .hd{background:#A100FF;padding:32px 40px;text-align:center}
  .hd h1{margin:0;color:#fff;font-size:22px;font-weight:600}
  .hd p{margin:4px 0 0;color:rgba(255,255,255,.8);font-size:13px}
  .bd{padding:36px 40px}
  .name{font-size:20px;font-weight:700;color:#111827;margin:0 0 6px}
  .sub{font-size:15px;color:#555;margin:0 0 24px}
  .badge{display:inline-block;background:#f3e8ff;color:#7b00cc;
         padding:8px 16px;border-radius:6px;font-size:14px;font-weight:700;margin-bottom:28px}
  .btn{display:block;text-align:center;background:#A100FF;color:#fff;
       text-decoration:none;padding:16px 32px;border-radius:8px;
       font-size:16px;font-weight:700;max-width:260px;margin:0 auto}
  .note{margin:24px 0 0;font-size:13px;color:#888;text-align:center}
  .note a{color:#A100FF;word-break:break-all}
  .ft{background:#f8f9fc;padding:18px 40px;text-align:center;border-top:1px solid #eee}
  .ft p{margin:0;font-size:12px;color:#aaa}
</style>
</head>
<body>
<div class="w">
  <div class="hd">
    <h1>Team Hours Tracker</h1>
    <p>Registrazione ore</p>
  </div>
  <div class="bd">
    <p class="name">Ciao ${firstName}!</p>
    <p class="sub">Quante ore hai lavorato ieri?</p>
    <div class="badge">📅 ${dateLabel}</div><br>
    <a href="${link}" class="btn">Inserisci le ore →</a>
    <p class="note">
      Il link è personale e valido per 48 ore.<br>
      Se il pulsante non funziona, copia questo URL:<br>
      <a href="${link}">${link}</a>
    </p>
  </div>
  <div class="ft">
    <p>Messaggio automatico per ${fullName}. Non rispondere a questa email.</p>
  </div>
</div>
</body>
</html>`;
}
