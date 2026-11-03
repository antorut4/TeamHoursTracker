// ════════════════════════════════════════════════════════════════════════
//  Autenticazione: password (scrypt), sessioni firmate (HMAC) e regole di accesso.
//  Modulo puro (nessun accesso al DB): db.mjs carica i dati e chiede qui il permesso.
// ════════════════════════════════════════════════════════════════════════
import { createHmac, createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';

// ── password ──
// Formato salvato: s1$<salt base64>$<hash base64>. Le password precedenti sono l'hash djb2
// calcolato nel browser (legacy): vengono riconosciute e riscritte in scrypt al primo login.
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;
export const MIN_PWD = 6;

function _scrypt(pwd, salt) {
  return new Promise((res, rej) => scrypt(pwd, salt, KEYLEN, SCRYPT, (e, k) => e ? rej(e) : res(k)));
}

// Stessa funzione usata in passato dal client (app.js): serve solo a verificare gli hash legacy
export function legacyHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function checkPwdPolicy(pwd) {
  if (typeof pwd !== 'string' || pwd.length < MIN_PWD) throw new HttpError(400, `La password deve avere almeno ${MIN_PWD} caratteri`);
  if (pwd.length > 200) throw new HttpError(400, 'Password troppo lunga (massimo 200 caratteri)');
}

export async function hashPassword(pwd) {
  const salt = randomBytes(16);
  const key = await _scrypt(pwd, salt);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

// { ok, legacy }: legacy = l'hash salvato va riscritto in scrypt
export async function verifyPassword(stored, pwd) {
  if (!stored || typeof pwd !== 'string') return { ok: false, legacy: false };
  if (stored.startsWith('s1$')) {
    const [, s, h] = stored.split('$');
    const expected = Buffer.from(h || '', 'base64');
    if (!expected.length) return { ok: false, legacy: false };
    const key = await _scrypt(pwd, Buffer.from(s, 'base64'));
    return { ok: key.length === expected.length && timingSafeEqual(key, expected), legacy: false };
  }
  const a = Buffer.from(legacyHash(pwd)), b = Buffer.from(String(stored));
  return { ok: a.length === b.length && timingSafeEqual(a, b), legacy: true };
}

// ── sessioni ──
// Token: base64url(JSON {k:'s', sub, pv, e}) + '.' + HMAC-SHA256.
// sub = id risorsa oppure 'admin'; pv = impronta dell'hash password: cambiandola o resettandola
// tutte le sessioni precedenti decadono; e = scadenza (secondi).
export const SESSION_TTL = 12 * 3600;

function _sessionKey() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  // Senza un segreto dedicato si deriva una chiave distinta da DAILY_TOKEN_SECRET:
  // i token dei link email e quelli di sessione non sono mai intercambiabili.
  const base = process.env.DAILY_TOKEN_SECRET;
  if (!base) throw new Error('SESSION_SECRET (o DAILY_TOKEN_SECRET) non configurato');
  return createHmac('sha256', base).update('team-hours-session-v1').digest();
}

export function pwdVersion(storedHash) {
  return createHash('sha256').update(String(storedHash || '')).digest('hex').slice(0, 16);
}

export function signSession(sub, storedHash, now = Date.now()) {
  const b64 = Buffer.from(JSON.stringify({ k: 's', sub, pv: pwdVersion(storedHash), e: Math.floor(now / 1000) + SESSION_TTL })).toString('base64url');
  return b64 + '.' + createHmac('sha256', _sessionKey()).update(b64).digest('base64url');
}

// Ritorna il payload oppure null (firma errata, scaduto, malformato)
export function readSession(token, now = Date.now()) {
  const t = String(token || ''), dot = t.indexOf('.');
  if (dot < 1) return null;
  const b64 = t.slice(0, dot), sig = Buffer.from(t.slice(dot + 1));
  const exp = Buffer.from(createHmac('sha256', _sessionKey()).update(b64).digest('base64url'));
  if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) return null;
  let p;
  try { p = JSON.parse(Buffer.from(b64, 'base64url').toString()); } catch { return null; }
  if (!p || p.k !== 's' || !p.sub || !p.pv || !p.e) return null;
  if (Math.floor(now / 1000) > p.e) return null;
  return p;
}

// ── errori con stato HTTP (il messaggio arriva al client) ──
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const deny = (msg = 'Operazione non consentita per il tuo profilo') => { throw new HttpError(403, msg); };

// ── regole di accesso ──
// ctx = { admin, id, manager, tlPrj:Set, areaTlPrj:Set, team:Set, mgrPrj:Set }
//   tlPrj     progetti di cui è Team Lead
//   areaTlPrj progetti in cui è Team Lead di almeno un'area
//   team      risorse di cui è manager
//   mgrPrj    progetti su cui sono allocate le risorse del suo team
export const isElevated = ctx => ctx.admin || ctx.manager;

// Gestione di un progetto (soglie, tipi reperibilità, export): stesse regole dell'interfaccia
export function canManageProject(ctx, pid) {
  pid = +pid;
  return ctx.admin || ctx.tlPrj.has(pid) || ctx.areaTlPrj.has(pid) || (ctx.manager && ctx.mgrPrj.has(pid));
}

// Dati di una singola risorsa (ore, ferie, presenze, consuntivo, reperibilità):
// la risorsa stessa, l'admin, il suo manager o un Team Lead di un progetto su cui è allocata.
export function canActOn(ctx, targetId, targetProjects = []) {
  targetId = +targetId;
  if (ctx.admin || ctx.id === targetId) return true;
  if (ctx.manager && ctx.team.has(targetId)) return true;
  return targetProjects.some(p => ctx.tlPrj.has(+p) || ctx.areaTlPrj.has(+p));
}

// Anagrafica di una risorsa (modifica, eliminazione, reset password): admin o suo manager
export function canAdminResource(ctx, targetId) {
  return ctx.admin || (ctx.manager && ctx.team.has(+targetId));
}
