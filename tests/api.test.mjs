// Test end-to-end dell'handler /api/db su un Postgres in-process: login, sessioni, permessi,
// validazione, migrazioni. Nessun accesso a Neon e nessuna email inviata (SMTP non configurato).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, caller } from './helpers/db.mjs';

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.DAILY_TOKEN_SECRET = 'test-daily-secret';
delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD; delete process.env.SESSION_SECRET;

const db = await import('../netlify/functions/db.mjs');
const { legacyHash } = await import('../netlify/lib/auth.mjs');
const { SCHEMA_VERSION } = await import('../netlify/lib/migrations.mjs');
const { sql } = await createDb();
db._setSqlForTests(sql);
const call = caller(db.handler);

const T = {};          // token per utente
const ID = {};         // id risorse
const PASS = 'password1';

before(async () => {
  // La prima richiesta applica le migrazioni
  assert.equal((await call('loginLookup', { email: 'nessuno@x.it' })).status, 200);
  await sql`INSERT INTO progetti (nome) VALUES ('Alfa'), ('Beta')`;
  const rows = await sql`INSERT INTO risorse (nome, cognome, email, is_manager, load_cost) VALUES
    ('Mario', 'Rossi', 'mario@x.it', TRUE, 500),
    ('Anna', 'Bianchi', 'anna@x.it', FALSE, 300),
    ('Luca', 'Verdi', 'luca@x.it', FALSE, 350),
    ('Sara', 'Neri', 'Sara@X.it', FALSE, 200),
    ('Piero', 'Gialli', 'piero@x.it', FALSE, NULL) RETURNING id, nome`;
  rows.forEach(r => { ID[r.nome.toLowerCase()] = r.id; });
  await sql`UPDATE risorse SET manager_id=${ID.mario} WHERE id=${ID.anna}`;
  // Anna e Luca su Alfa (Luca è TL di Alfa), Sara su Beta
  await sql`INSERT INTO allocazioni (risorsa_id, progetto_id) VALUES (${ID.anna}, 1), (${ID.luca}, 1), (${ID.sara}, 2)`;
  await sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id) VALUES (1, ${ID.luca})`;
  // Admin e Piero hanno ancora l'hash legacy calcolato nel browser
  await sql`INSERT INTO config (chiave, valore) VALUES ('admin_pwd', ${legacyHash('adminpass')})`;
  await sql`INSERT INTO utenti_pwd (risorsa_id, pwd_hash) VALUES (${ID.piero}, ${legacyHash('vecchia1')})`;
  for (const n of ['mario', 'anna', 'luca', 'sara']) {
    const r = await call('firstAccess', { risorsaId: ID[n], password: PASS });
    assert.equal(r.status, 200, n);
    T[n] = r.data.token;
  }
  T.admin = (await call('adminLogin', { password: 'adminpass' })).data.token;
});

// ── migrazioni ──
test('migrazioni: tutte applicate una volta sola', async () => {
  const v = await sql`SELECT version FROM schema_migrations ORDER BY version`;
  assert.deepEqual(v.map(r => r.version), Array.from({ length: SCHEMA_VERSION }, (_, i) => i + 1));
  const { migrate } = await import('../netlify/lib/migrations.mjs');
  assert.deepEqual(await migrate(sql), [], 'nessuna migrazione da riapplicare');
});

test('migrazioni: la baseline è idempotente su un database già aggiornato a mano', async () => {
  const { createDb: fresh } = await import('./helpers/db.mjs');
  const { migrate, MIGRATIONS } = await import('../netlify/lib/migrations.mjs');
  const { sql: s2 } = await fresh();
  // Simula Neon oggi: schema già creato dal vecchio bootstrap, senza tabella schema_migrations
  await s2.transaction(MIGRATIONS[0].up(s2));
  assert.deepEqual(await migrate(s2), MIGRATIONS.map(m => m.version));
  // Due avvii concorrenti non vanno in errore
  const { sql: s3 } = await fresh();
  await Promise.all([migrate(s3), migrate(s3)]);
});

// ── senza login non si accede a niente ──
test('senza token: dati e azioni amministrative rifiutate con 401', async () => {
  for (const [a, p] of [['bootstrap', {}], ['setAdminPwd', { password: 'hacked123' }], ['deleteResource', { id: 2 }],
                        ['resetUserPwd', { risorsaId: 2 }], ['getEmailLog', {}], ['saveOre', { risorsaId: 2, anno: 2026, mese: 1 }]]) {
    const r = await call(a, p);
    assert.equal(r.status, 401, a);
  }
  assert.equal((await call('bootstrap', {}, 'token.falso')).status, 401);
  // Le vecchie azioni che accettavano hash dal client non esistono più
  for (const a of ['checkAdminPwd', 'checkUserPwd', 'setUserPwd']) assert.equal((await call(a, { hash: 'x' })).status, 400, a);
});

// ── login ──
test('loginLookup: email case-insensitive, nessun dato sensibile', async () => {
  const r = await call('loginLookup', { email: 'sara@x.IT' });
  assert.deepEqual(r.data, { risorsaId: ID.sara, fullName: 'Sara Neri', hasPwd: true });
  assert.equal((await call('loginLookup', { email: 'ignoto@x.it' })).data, null);
  assert.equal((await call('loginLookup', { email: 'non-una-email' })).status, 400);
});

test('login: password errata, corretta, primo accesso non ripetibile', async () => {
  assert.equal((await call('login', { risorsaId: ID.anna, password: 'sbagliata' })).data.ok, false);
  const ok = await call('login', { risorsaId: ID.anna, password: PASS });
  assert.equal(ok.data.ok, true);
  assert.ok(ok.data.token);
  const again = await call('firstAccess', { risorsaId: ID.anna, password: 'rubata123' });
  assert.equal(again.status, 409);
  assert.equal((await call('firstAccess', { risorsaId: ID.anna, password: '123' })).status, 400);
});

test('hash legacy: login riuscito e password riscritta in scrypt', async () => {
  const r = await call('login', { risorsaId: ID.piero, password: 'vecchia1' });
  assert.equal(r.data.ok, true);
  const [u] = await sql`SELECT pwd_hash FROM utenti_pwd WHERE risorsa_id=${ID.piero}`;
  assert.match(u.pwd_hash, /^s1\$/);
  assert.equal((await call('login', { risorsaId: ID.piero, password: 'vecchia1' })).data.ok, true, 'funziona anche dopo la riscrittura');
  const [a] = await sql`SELECT valore FROM config WHERE chiave='admin_pwd'`;
  assert.match(a.valore, /^s1\$/, 'anche la password admin è stata riscritta');
});

test('blocco dopo 10 tentativi falliti', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await call('login', { risorsaId: ID.piero, password: 'no' + i })).data.ok, false);
  const r = await call('login', { risorsaId: ID.piero, password: 'vecchia1' });
  assert.equal(r.status, 429);
  await sql`DELETE FROM login_attempts`;
});

// ── permessi ──
test('collaboratore: solo i propri dati', async () => {
  const mine = await call('saveOre', { risorsaId: ID.sara, anno: 2026, mese: 9, ore_q1: 80, ore_q2: 88 }, T.sara);
  assert.equal(mine.status, 200);
  const other = await call('saveOre', { risorsaId: ID.anna, anno: 2026, mese: 9, ore_q1: 1 }, T.sara);
  assert.equal(other.status, 403);
  const [o] = await sql`SELECT id FROM ore_mensili WHERE risorsa_id=${ID.sara}`;
  assert.equal((await call('deleteOre', { id: o.id }, T.anna)).status, 403, 'non può cancellare ore altrui');
  for (const [a, p] of [['getEmailLog', {}], ['saveArea', { progettoId: 1, nome: 'X' }], ['addProject', { nome: 'Gamma' }],
                        ['deleteResource', { id: ID.anna }], ['setAdminPwd', { password: 'hacked123' }],
                        ['resetUserPwd', { risorsaId: ID.anna }], ['userHasPwd', { risorsaId: ID.anna }]]) {
    assert.equal((await call(a, p, T.sara)).status, 403, a);
  }
  assert.equal((await call('deleteOre', { id: o.id }, T.sara)).status, 200);
});

test('bootstrap: load cost delle altre risorse nascosto ai collaboratori', async () => {
  const mine = (await call('bootstrap', {}, T.sara)).data.risorse;
  assert.equal(+mine.find(r => r.id === ID.sara).load_cost, 200, 'il proprio resta visibile');
  assert.equal(mine.find(r => r.id === ID.anna).load_cost, null);
  const mgr = (await call('bootstrap', {}, T.mario)).data.risorse;
  assert.equal(+mgr.find(r => r.id === ID.anna).load_cost, 300);
});

test('manager: gestisce solo il proprio team', async () => {
  const edit = await call('saveEdit', { id: ID.anna, nome: 'Anna', cognome: 'Bianchi', email: 'anna@x.it', progetti: ['Alfa'], managerId: null, loadCost: 310 }, T.mario);
  assert.equal(edit.status, 200);
  const [a] = await sql`SELECT manager_id, load_cost FROM risorse WHERE id=${ID.anna}`;
  assert.equal(a.manager_id, ID.mario, 'il manager non può sganciare la risorsa dal proprio team');
  assert.equal(+a.load_cost, 310);
  assert.equal((await call('saveEdit', { id: ID.sara, nome: 'Sara', cognome: 'Neri' }, T.mario)).status, 403);
  assert.equal((await call('saveOre', { risorsaId: ID.anna, anno: 2026, mese: 8, ore_q1: 40 }, T.mario)).status, 200);
  assert.equal((await call('saveOre', { risorsaId: ID.sara, anno: 2026, mese: 8, ore_q1: 40 }, T.mario)).status, 403);
  assert.equal((await call('saveProjectWbs', { id: 1, wbs: 'WBS-A' }, T.mario)).status, 200, 'Alfa: progetto di una sua risorsa');
  assert.equal((await call('saveProjectWbs', { id: 2, wbs: 'WBS-B' }, T.mario)).status, 403, 'Beta: nessuna sua risorsa');
  const add = await call('addResource', { nome: 'Nuovo', cognome: 'Arrivato', email: 'nuovo@x.it', managerId: ID.sara }, T.mario);
  assert.equal(add.status, 200);
  const [n] = await sql`SELECT manager_id FROM risorse WHERE email='nuovo@x.it'`;
  assert.equal(n.manager_id, ID.mario, 'la nuova risorsa entra nel team di chi la crea');
});

test('Team Lead di progetto: reperibilità e soglie del proprio progetto', async () => {
  const rep = { progetto: 'Alfa', risorsaId: ID.anna, anno: 2026, mese: 9, giorni: [3, 4], etichetta: '' };
  assert.equal((await call('saveRep', rep, T.luca)).status, 200);
  assert.equal((await call('saveRep', { ...rep, progetto: 'Beta', risorsaId: ID.sara }, T.luca)).status, 403);
  assert.equal((await call('saveSoglia', { progettoId: 1, soglia: 50 }, T.luca)).status, 200);
  assert.equal((await call('saveSoglia', { progettoId: 2, soglia: 50 }, T.luca)).status, 403);
  const [s] = await sql`SELECT updated_by FROM soglie_ticket WHERE progetto_id=1`;
  assert.equal(s.updated_by, ID.luca, 'updated_by viene dalla sessione');
  assert.equal((await call('saveConsuntivo', { risorsaId: ID.anna, data: '2026-10-01', ore: 8 }, T.luca)).status, 200);
  assert.equal((await call('saveConsuntivo', { risorsaId: ID.sara, data: '2026-10-01', ore: 8 }, T.luca)).status, 403);
});

test('ticket: la risorsa arriva dalla sessione, non dal payload', async () => {
  await sql`INSERT INTO aree (progetto_id, nome, team_lead_id) VALUES (2, 'Beta Ops', ${ID.sara})`;
  const asSara = await call('getTicketDay', { risorsaId: ID.luca, data: '2026-10-01' }, T.sara);
  assert.equal(asSara.status, 200);
  assert.equal(asSara.data.risorsaId, ID.sara);
  assert.deepEqual(asSara.data.aree.map(a => a.nome), ['Beta Ops']);
  assert.equal((await call('getTicketDay', { data: '2026-10-01' }, T.admin)).status, 403);
});

test('admin: accesso completo; il cambio password invalida le altre sessioni', async () => {
  assert.equal((await call('getEmailLog', {}, T.admin)).status, 200);
  assert.equal((await call('addProject', { nome: 'Gamma', teamLeadNames: ['Luca Verdi'] }, T.admin)).status, 200);
  assert.equal((await call('addProject', { nome: 'Gamma' }, T.admin)).status, 409, 'nome duplicato');
  const other = (await call('adminLogin', { password: 'adminpass' })).data.token;
  const r = await call('setAdminPwd', { password: 'nuovaAdmin1' }, T.admin);
  assert.equal(r.status, 200);
  assert.equal((await call('bootstrap', {}, other)).status, 401, 'la sessione vecchia decade');
  assert.equal((await call('bootstrap', {}, r.data.token)).status, 200, 'il nuovo token funziona');
  T.admin = r.data.token;
});

test('reset password: le sessioni della risorsa decadono', async () => {
  const anna = (await call('login', { risorsaId: ID.anna, password: PASS })).data.token;
  assert.equal((await call('resetUserPwd', { risorsaId: ID.anna }, T.mario)).status, 200);
  assert.equal((await call('bootstrap', {}, anna)).status, 401);
  assert.equal((await call('loginLookup', { email: 'anna@x.it' })).data.hasPwd, false);
  assert.equal((await call('firstAccess', { risorsaId: ID.anna, password: PASS })).status, 200);
});

// ── validazione ed errori ──
test('validazione dei payload', async () => {
  const cases = [
    ['saveOre', { risorsaId: ID.sara, anno: 2026, mese: 12, ore_q1: 10 }, /Mese/],
    ['saveOre', { risorsaId: ID.sara, anno: 2026, mese: 1, ore_q1: -5 }, /Ore I quindicina/],
    ['saveFerie', { risorsaId: ID.sara, start: '2026-02-30', end: '2026-03-01', tipo: 'Ferie' }, /Data inizio/],
    ['saveFerie', { risorsaId: ID.sara, start: '2026-03-05', end: '2026-03-01', tipo: 'Ferie' }, /precede/],
    ['saveFerie', { risorsaId: ID.sara, start: '2026-03-01', end: '2026-03-01', tipo: 'Vacanza' }, /Tipo assenza/],
    ['saveConsuntivo', { risorsaId: ID.sara, data: '2026-03-01', ore: 30 }, /Ore/],
    ['savePresenza', { risorsaId: ID.sara, data: 'ieri' }, /Data/],
    ['getAndamento', { scope: [{ progettoId: 2 }], anno: 'x', mese: 1 }, /Anno/]
  ];
  for (const [a, p, msg] of cases) {
    const r = await call(a, p, T.sara);
    assert.equal(r.status, 400, a + ' ' + JSON.stringify(p));
    assert.match(r.error, msg);
  }
  const ok = await call('saveFerie', { risorsaId: ID.sara, start: '2026-03-02', end: '2026-03-03', tipo: 'Ferie' }, T.sara);
  assert.equal(ok.status, 200);
});

test('richieste malformate', async () => {
  assert.equal((await db.handler({ httpMethod: 'GET' })).statusCode, 405);
  assert.equal((await db.handler({ httpMethod: 'POST', body: '{' })).statusCode, 400);
  assert.equal((await db.handler({ httpMethod: 'POST', body: '{"action":"bootstrap","payload":[1]}' })).statusCode, 400);
  assert.equal((await call('toString', {}, T.admin)).status, 400, 'niente accesso a proprietà ereditate');
});
