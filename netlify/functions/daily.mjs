// ════════════════════════════════════════════════════════════════════════
//  daily.mjs — API token-based per registrazione ore giornaliere
//  Nessun login richiesto. Il token HMAC-SHA256 identifica utente + giorno.
//  POST /api/daily  { action, payload }
//  Actions: getByToken, saveByToken
// ════════════════════════════════════════════════════════════════════════
import { neon } from '@neondatabase/serverless';
import { createHmac, timingSafeEqual } from 'crypto';

const sql    = neon(process.env.DATABASE_URL);
const SECRET = process.env.DAILY_TOKEN_SECRET;

// ── Token: payload = {r: risorsaId, d: 'YYYY-MM-DD', e: unixExpiry} ──
function generateToken(risorsaId, data) {
  const exp = Math.floor(Date.now() / 1000) + 36 * 3600; // valido 36 ore
  const b64 = Buffer.from(JSON.stringify({ r: risorsaId, d: data, e: exp })).toString('base64url');
  const sig = createHmac('sha256', SECRET).update(b64).digest('hex');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!SECRET) throw new Error('DAILY_TOKEN_SECRET non configurato');
  const dot = token.indexOf('.');
  if (dot < 1) throw new Error('Token malformato');
  const b64      = token.slice(0, dot);
  const sig      = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(b64).digest('hex');
  let valid = false;
  try { valid = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch {}
  if (!valid) throw new Error('Firma token non valida');
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString()); }
  catch { throw new Error('Payload token non valido'); }
  if (!payload.r || !payload.d || !payload.e) throw new Error('Token campi mancanti');
  if (Math.floor(Date.now() / 1000) > payload.e) throw new Error('Token scaduto');
  return payload;
}

// ── getByToken: valida token, restituisce risorsa + ore già inserite ──
async function getByToken(p) {
  const { r: risorsaId, d: data } = verifyToken(p.token);
  const [risorsa] = await sql`SELECT id, full_name FROM risorse WHERE id=${risorsaId}`;
  if (!risorsa) throw new Error('Risorsa non trovata');
  const [entry] = await sql`
    SELECT ore::float AS ore
    FROM daily_hours
    WHERE risorsa_id=${risorsaId} AND data=${data}::date`;
  return {
    risorsaId: +risorsa.id,
    data,
    fullName: risorsa.full_name,
    ore: entry != null ? entry.ore : null
  };
}

// ── saveByToken: upsert daily_hours → trigger aggiorna ore_mensili ──
async function saveByToken(p) {
  const { r: risorsaId, d: data } = verifyToken(p.token);
  const ore = parseFloat(p.ore);
  if (isNaN(ore) || ore < 0 || ore > 24) throw new Error('Valore ore non valido (0–24)');
  const [row] = await sql`
    INSERT INTO daily_hours (risorsa_id, data, ore, updated_at)
    VALUES (${risorsaId}, ${data}::date, ${ore}, NOW())
    ON CONFLICT (risorsa_id, data)
    DO UPDATE SET ore=${ore}, updated_at=NOW()
    RETURNING id, ore::float AS ore`;
  return { id: row.id, ore: row.ore };
}

// ── routing ──
const ACTIONS = { getByToken, saveByToken };

export async function handler(event) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers };
  if (event.httpMethod !== 'POST')
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };

  let action, payload;
  try {
    const parsed = JSON.parse(event.body || '{}');
    action = parsed.action; payload = parsed.payload || {};
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body JSON non valido' }) };
  }

  const fn = ACTIONS[action];
  if (!fn)
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action sconosciuta: ' + action }) };

  try {
    const result = await fn(payload);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: result }) };
  } catch (err) {
    const status = (err.message.includes('scaduto') || err.message.includes('firma')) ? 401 : 500;
    return { statusCode: status, headers, body: JSON.stringify({ error: err.message }) };
  }
}
