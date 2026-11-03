import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DAILY_TOKEN_SECRET = 'test-daily-secret';
const A = await import('../netlify/lib/auth.mjs');

// Copia della funzione che il client usava prima (app.js): gli hash già salvati devono restare verificabili
function clientSimpleHash(str){let h=5381;for(let i=0;i<str.length;i++)h=((h<<5)+h)+str.charCodeAt(i);return(h>>>0).toString(36);}

test('legacyHash coincide con il vecchio hash del client', () => {
  for (const s of ['', 'a', 'password123', 'Pàssw0rd€!', 'x'.repeat(300)]) assert.equal(A.legacyHash(s), clientSimpleHash(s));
});

test('scrypt: hash salato, verifica corretta ed errata', async () => {
  const h1 = await A.hashPassword('segreta1'), h2 = await A.hashPassword('segreta1');
  assert.match(h1, /^s1\$/);
  assert.notEqual(h1, h2, 'due hash della stessa password devono differire (salt)');
  assert.deepEqual(await A.verifyPassword(h1, 'segreta1'), { ok: true, legacy: false });
  assert.deepEqual(await A.verifyPassword(h1, 'segreta2'), { ok: false, legacy: false });
});

test('hash legacy riconosciuto e segnalato per la riscrittura', async () => {
  const legacy = clientSimpleHash('vecchia');
  assert.deepEqual(await A.verifyPassword(legacy, 'vecchia'), { ok: true, legacy: true });
  assert.equal((await A.verifyPassword(legacy, 'altra')).ok, false);
  assert.equal((await A.verifyPassword(null, 'x')).ok, false);
});

test('policy password', () => {
  assert.throws(() => A.checkPwdPolicy('12345'), /almeno 6/);
  assert.throws(() => A.checkPwdPolicy(undefined), /almeno 6/);
  A.checkPwdPolicy('123456');
});

test('sessione: firma, scadenza, manomissione', () => {
  const t = A.signSession(7, 's1$abc');
  const p = A.readSession(t);
  assert.equal(p.sub, 7);
  assert.equal(p.pv, A.pwdVersion('s1$abc'));
  // payload manomesso (sub cambiato) con la vecchia firma
  const [, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...p, sub: 'admin' })).toString('base64url') + '.' + sig;
  assert.equal(A.readSession(forged), null);
  assert.equal(A.readSession('garbage'), null);
  assert.equal(A.readSession(''), null);
  // scaduto
  assert.equal(A.readSession(t, Date.now() + (A.SESSION_TTL + 5) * 1000), null);
});

test('i token dei link email non valgono come sessione', async () => {
  const { createHmac } = await import('crypto');
  const b64 = Buffer.from(JSON.stringify({ k: 'tk', r: 1, ds: ['2026-01-01'], e: 9999999999 })).toString('base64url');
  const emailToken = b64 + '.' + createHmac('sha256', process.env.DAILY_TOKEN_SECRET).update(b64).digest('hex');
  assert.equal(A.readSession(emailToken), null);
});

test('regole di accesso', () => {
  const base = { admin: false, id: 1, manager: false, tlPrj: new Set(), areaTlPrj: new Set(), team: new Set(), mgrPrj: new Set() };
  const admin = { ...base, admin: true, id: null };
  const mgr = { ...base, id: 2, manager: true, team: new Set([3]), mgrPrj: new Set([10]) };
  const tl = { ...base, id: 4, tlPrj: new Set([10]) };
  assert.ok(A.canActOn(base, 1));
  assert.ok(!A.canActOn(base, 3));
  assert.ok(A.canActOn(admin, 3));
  assert.ok(A.canActOn(mgr, 3));
  assert.ok(!A.canActOn(mgr, 5));
  assert.ok(A.canActOn(tl, 5, [10]));
  assert.ok(!A.canActOn(tl, 5, [11]));
  assert.ok(A.canManageProject(mgr, 10) && !A.canManageProject(mgr, 11));
  assert.ok(!A.canManageProject({ ...base, id: 9, mgrPrj: new Set([10]) }, 10), 'mgrPrj vale solo per i manager');
  assert.ok(A.canAdminResource(mgr, 3) && !A.canAdminResource(tl, 5) && A.canAdminResource(admin, 5));
});
