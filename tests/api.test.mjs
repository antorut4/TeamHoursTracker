// Test end-to-end dell'handler /api/db su un Postgres in-process: login, sessioni, permessi,
// validazione, inviti, visibilità dei dati, migrazioni. Nessun accesso a Neon; le email finiscono in `mails`.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, caller } from './helpers/db.mjs';

process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.DAILY_TOKEN_SECRET = 'test-daily-secret';
delete process.env.GMAIL_USER; delete process.env.GMAIL_APP_PASSWORD; delete process.env.SESSION_SECRET;

process.env.SITE_URL = 'https://app.test';

const db = await import('../netlify/functions/db.mjs');
const { legacyHash, hashPassword } = await import('../netlify/lib/auth.mjs');
const { claimDailyRun } = await import('../netlify/lib/jobs.mjs');
const { SCHEMA_VERSION } = await import('../netlify/lib/migrations.mjs');
const { sql } = await createDb();
db._setSqlForTests(sql);
const call = caller(db.handler);
const mails = [];
const fakeMailer = { sendMail: async m => { mails.push(m); return { messageId: 'm' + mails.length }; } };
db._setMailerForTests(fakeMailer);
const inviteFromMail = m => decodeURIComponent(m.text.match(/\?invite=([^\s]+)/)[1]);

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
    await sql`INSERT INTO utenti_pwd (risorsa_id, pwd_hash) VALUES (${ID[n]}, ${await hashPassword(PASS)})`;
    const r = await call('login', { risorsaId: ID[n], password: PASS });
    assert.equal(r.data.ok, true, n);
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

test('migrazioni: colonne password portate a TEXT (su Neon erano VARCHAR(50))', async () => {
  const cols = await sql`SELECT table_name, data_type FROM information_schema.columns
                         WHERE (table_name, column_name) IN (('utenti_pwd', 'pwd_hash'), ('config', 'valore')) ORDER BY 1`;
  assert.deepEqual(cols.map(c => c.table_name + ':' + c.data_type), ['config:text', 'utenti_pwd:text']);
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

test('login: password errata e corretta', async () => {
  assert.equal((await call('login', { risorsaId: ID.anna, password: 'sbagliata' })).data.ok, false);
  const ok = await call('login', { risorsaId: ID.anna, password: PASS });
  assert.equal(ok.data.ok, true);
  assert.ok(ok.data.token);
});

// ── primo accesso solo tramite invito via email ──
test('invito: la password si imposta solo dal link ricevuto', async () => {
  const [g] = await sql`INSERT INTO risorse (nome, cognome, email) VALUES ('Gino', 'Blu', 'gino@x.it') RETURNING id`;
  // Prima bastava conoscere l'email: ora senza link non si imposta niente
  assert.equal((await call('firstAccess', { risorsaId: g.id, password: 'rubata123' })).status, 400);
  const r = await call('requestInvite', { risorsaId: g.id });
  assert.equal(r.status, 200);
  assert.equal(r.data.email, 'gi***@x.it');
  const m = mails.at(-1);
  assert.equal(m.to, 'gino@x.it');
  assert.match(m.text, /https:\/\/app\.test\/\?invite=/);
  const token = inviteFromMail(m);
  assert.equal((await call('inviteInfo', { token })).data.fullName, 'Gino Blu');
  assert.equal((await call('firstAccess', { token, password: '123' })).status, 400, 'policy password');
  const fa = await call('firstAccess', { token, password: 'nuova1234' });
  assert.equal(fa.status, 200);
  assert.equal((await call('bootstrap', {}, fa.data.token)).status, 200);
  assert.equal((await call('firstAccess', { token, password: 'altra12345' })).status, 400, 'il link è monouso');
  assert.equal((await call('requestInvite', { risorsaId: g.id })).status, 409, 'password già impostata');
  assert.equal((await call('login', { risorsaId: g.id, password: 'nuova1234' })).data.ok, true);
});

test('invito: un nuovo link annulla il precedente; limite richieste; nome escapato nell\'email', async () => {
  const [e] = await sql`INSERT INTO risorse (nome, cognome, email) VALUES ('Eva<img src=x>', 'Ros', 'eva@x.it') RETURNING id`;
  await call('requestInvite', { risorsaId: e.id });
  const first = inviteFromMail(mails.at(-1));
  assert.match(mails.at(-1).html, /Eva&lt;img src=x&gt;/);
  assert.doesNotMatch(mails.at(-1).html, /<img src=x>/);
  await call('requestInvite', { risorsaId: e.id });
  const second = inviteFromMail(mails.at(-1));
  assert.equal((await call('inviteInfo', { token: first })).status, 400, 'il link precedente non vale più');
  assert.equal((await call('inviteInfo', { token: second })).status, 200);
  assert.equal((await call('requestInvite', { risorsaId: e.id })).status, 200);
  assert.equal((await call('requestInvite', { risorsaId: e.id })).status, 429, 'massimo 3 richieste ogni 15 minuti');
  const forged = second.slice(0, -3) + (second.endsWith('AAA') ? 'BBB' : 'AAA');
  assert.equal((await call('inviteInfo', { token: forged })).status, 400);
  assert.equal((await call('bootstrap', {}, second)).status, 401, 'un invito non vale come sessione');
});

test('invito: senza SMTP configurato risponde 503', async () => {
  const [n] = await sql`INSERT INTO risorse (nome, cognome, email) VALUES ('Nino', 'Mail', 'nino@x.it') RETURNING id`;
  db._setMailerForTests(null);
  try { assert.equal((await call('requestInvite', { risorsaId: n.id })).status, 503); }
  finally { db._setMailerForTests(fakeMailer); }
  const [s0] = await sql`INSERT INTO risorse (nome, cognome) VALUES ('Senza', 'Email') RETURNING id`;
  assert.equal((await call('requestInvite', { risorsaId: s0.id })).status, 400);
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

// ── ripresa della sessione (refresh della pagina) ──
test('session: identità e token rinnovato', async () => {
  const me = await call('session', {}, T.sara);
  assert.equal(me.status, 200);
  assert.equal(me.data.admin, false);
  assert.equal(me.data.risorsaId, ID.sara);
  assert.equal(me.data.fullName, 'Sara Neri');
  assert.equal((await call('bootstrap', {}, me.data.token)).status, 200, 'il token rinnovato è valido');
  const adm = await call('session', {}, T.admin);
  assert.deepEqual([adm.data.admin, adm.data.fullName], [true, 'ADMIN']);
  assert.equal((await call('session', {})).status, 401);
  assert.equal((await call('session', {}, 'scaduto.x')).status, 401);
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
  assert.equal((await call('requestInvite', { risorsaId: ID.anna })).status, 200);
  const fa = await call('firstAccess', { token: inviteFromMail(mails.at(-1)), password: PASS });
  assert.equal(fa.status, 200);
  T.anna = fa.data.token;
});

// ── visibilità dei dati personali ──
test('dati personali filtrati per ruolo: ore, note, malattia, email, consuntivo, presenze', async () => {
  const [mal] = await sql`INSERT INTO ferie (risorsa_id, data_inizio, data_fine, tipo, note) VALUES (${ID.anna}, '2026-10-05', '2026-10-06', 'Malattia', 'visita medica') RETURNING id`;
  await sql`INSERT INTO ore_mensili (risorsa_id, anno, mese, ore_q1) VALUES (${ID.anna}, 2026, 9, 80) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO config (chiave, valore) VALUES (${'wbs_' + ID.anna + '_2026_9'}, '[]')`;
  await sql`INSERT INTO presenze (risorsa_id, data) VALUES (${ID.anna}, '2026-10-07'), (${ID.sara}, '2026-10-07')`;
  const anna = d => d.ferie.find(f => f.id === mal.id);
  const sara = (await call('bootstrap', {}, T.sara)).data;
  const fs = anna(sara);
  assert.equal(fs.tipo, 'Assenza', 'la malattia di un collega non viene inviata');
  assert.equal(fs.note, null);
  assert.ok(!sara.ore.some(o => o.risorsa_id === ID.anna), 'niente ore altrui');
  assert.ok(!Object.keys(sara.wbs).some(k => k.startsWith(ID.anna + '_')));
  assert.equal(sara.risorse.find(r => r.id === ID.anna).email, null);
  assert.equal(sara.risorse.find(r => r.id === ID.sara).email, 'Sara@X.it', 'la propria email resta');
  const mario = (await call('bootstrap', {}, T.mario)).data;   // manager di Anna
  assert.equal(anna(mario).tipo, 'Malattia');
  assert.equal(anna(mario).note, 'visita medica');
  assert.ok(mario.ore.some(o => o.risorsa_id === ID.anna));
  const luca = (await call('bootstrap', {}, T.luca)).data;     // TL del progetto di Anna, non suo manager
  assert.equal(anna(luca).tipo, 'Assenza');
  assert.ok(!luca.ore.some(o => o.risorsa_id === ID.anna));
  const cons = async t => (await call('getConsuntivo', { anno: 2026, mese: 9 }, t)).data.map(r => r.risorsa_id);
  assert.ok((await cons(T.luca)).includes(ID.anna), 'il TL vede il consuntivo delle risorse del suo progetto');
  assert.ok(!(await cons(T.sara)).includes(ID.anna));
  assert.ok((await cons(T.admin)).includes(ID.anna));
  const pres = async t => (await call('getPresenze', { from: '2026-10-05', to: '2026-10-09' }, t)).data.map(r => r.risorsa_id);
  assert.deepEqual(await pres(T.sara), [ID.sara], 'Sara non ha colleghi di progetto');
  assert.ok((await pres(T.luca)).includes(ID.anna) && !(await pres(T.luca)).includes(ID.sara));
  assert.equal((await pres(T.admin)).length, 2);
});

// ── reminder schedulati: una sola esecuzione al giorno, nella fascia prevista ──
test('job schedulati: fascia oraria e una sola esecuzione al giorno', async () => {
  assert.equal((await claimDailyRun(sql, 'test-job', new Date('2026-11-03T03:00:00Z'))).ok, false, 'di notte no');
  assert.equal((await claimDailyRun(sql, 'test-job', new Date('2026-11-03T08:00:05Z'))).ok, true);
  assert.equal((await claimDailyRun(sql, 'test-job', new Date('2026-11-03T08:30:00Z'))).ok, false, 'seconda volta no');
  assert.equal((await claimDailyRun(sql, 'altro-job', new Date('2026-11-03T08:00:05Z'))).ok, true, 'job diversi indipendenti');
  assert.equal((await claimDailyRun(sql, 'test-job', new Date('2026-11-04T08:00:05Z'))).ok, true, 'il giorno dopo sì');
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

// ── Senior Manager: eredita i team dei manager associati ──
test('senior manager: associazione dei manager, permessi ereditati, niente cicli', async () => {
  const mgrOf = async id => (await sql`SELECT manager_id FROM risorse WHERE id=${id}`)[0].manager_id;
  // L'admin crea la Senior Manager e le associa Mario (manager di Anna)
  const add = await call('addResource', { nome: 'Silvia', cognome: 'Alti', email: 'silvia@x.it', progetti: [], isSenior: true, managerIds: [ID.mario] }, T.admin);
  assert.equal(add.status, 200, add.error);
  const [sv] = await sql`SELECT id, is_manager, is_senior FROM risorse WHERE email='silvia@x.it'`;
  assert.equal(sv.is_senior, true);
  assert.equal(sv.is_manager, true, 'il Senior Manager è anche manager');
  assert.equal(await mgrOf(ID.mario), sv.id);
  await sql`INSERT INTO utenti_pwd (risorsa_id, pwd_hash) VALUES (${sv.id}, ${await hashPassword(PASS)})`;
  const ts = (await call('login', { risorsaId: sv.id, password: PASS })).data.token;

  // Vede e gestisce le risorse di Mario come se fosse il loro manager, e Mario stesso
  assert.equal((await call('setDailyReminder', { risorsaId: ID.anna, value: true }, ts)).status, 200);
  assert.equal((await call('setDailyReminder', { risorsaId: ID.mario, value: true }, ts)).status, 200);
  assert.equal((await call('setDailyReminder', { risorsaId: ID.sara, value: true }, ts)).status, 403, 'Sara non è nel suo team');
  await sql`INSERT INTO ore_mensili (risorsa_id, anno, mese, ore_q1) VALUES (${ID.anna}, 2026, 11, 80), (${ID.sara}, 2026, 11, 80) ON CONFLICT DO NOTHING`;
  const boot = (await call('bootstrap', {}, ts)).data;
  assert.ok(boot.ore.some(o => o.risorsa_id === ID.anna && o.mese === 11), 'vede le ore delle risorse ereditate');
  assert.ok(!boot.ore.some(o => o.risorsa_id === ID.sara), 'non quelle di chi è fuori dal suo team');
  await sql`INSERT INTO presenze (risorsa_id, data) VALUES (${ID.anna}, '2026-12-01'), (${ID.sara}, '2026-12-01')`;
  const pres = (await call('getPresenze', { from: '2026-12-01', to: '2026-12-01' }, ts)).data.map(r => r.risorsa_id);
  assert.deepEqual(pres, [ID.anna]);
  await sql`INSERT INTO daily_hours (risorsa_id, data, ore) VALUES (${ID.anna}, '2026-12-01', 8)`;
  assert.deepEqual((await call('getConsuntivo', { anno: 2026, mese: 11 }, ts)).data.map(r => r.risorsa_id), [ID.anna]);
  // Mario resta un manager normale: non gestisce la sua Senior Manager
  assert.equal((await call('setDailyReminder', { risorsaId: sv.id, value: true }, T.mario)).status, 403);

  // Nuova risorsa: la Senior Manager può assegnarla a un suo manager, non a una risorsa qualsiasi
  await call('addResource', { nome: 'Nuovo', cognome: 'Uno', email: 'n1@x.it', progetti: [], managerId: ID.mario }, ts);
  await call('addResource', { nome: 'Nuovo', cognome: 'Due', email: 'n2@x.it', progetti: [], managerId: ID.anna, isSenior: true }, ts);
  const [n1] = await sql`SELECT manager_id, is_senior FROM risorse WHERE email='n1@x.it'`;
  const [n2] = await sql`SELECT manager_id, is_senior FROM risorse WHERE email='n2@x.it'`;
  assert.equal(n1.manager_id, ID.mario);
  assert.equal(n2.manager_id, sv.id, 'Anna non è manager: la risorsa resta alla Senior Manager');
  assert.equal(n2.is_senior, false, 'solo l\'admin assegna il ruolo Senior Manager');

  // Ciclo: Mario non può diventare Senior Manager di chi gli sta sopra
  const cyc = await call('saveEdit', { id: ID.mario, nome: 'Mario', cognome: 'Rossi', email: 'mario@x.it', progetti: [], managerId: sv.id, isManager: true, isSenior: true, managerIds: [sv.id] }, T.admin);
  assert.equal(cyc.status, 400);
  assert.match(cyc.error, /sopra/);

  // Tolto Mario dall'elenco, la Senior Manager perde il suo team
  const rm = await call('saveEdit', { id: sv.id, nome: 'Silvia', cognome: 'Alti', email: 'silvia@x.it', progetti: [], isManager: true, isSenior: true, managerIds: [] }, T.admin);
  assert.equal(rm.status, 200, rm.error);
  assert.equal(await mgrOf(ID.mario), null);
  assert.equal((await call('setDailyReminder', { risorsaId: ID.anna, value: true }, ts)).status, 403);
});

// ── link nelle email: SITE_URL sbagliato (es. il server SMTP) non finisce nei link ──
test('siteUrl: indirizzo non valido sostituito da quello di Netlify', async () => {
  const { siteUrl } = await import('../netlify/lib/site.mjs');
  const keep = { s: process.env.SITE_URL, u: process.env.URL };
  try {
    process.env.URL = 'https://team.netlify.app';
    for (const bad of ['smtp.gmail.com', 'https://smtp.gmail.com', 'tuosito.netlify.app', '']) {
      process.env.SITE_URL = bad;
      assert.equal(siteUrl(), 'https://team.netlify.app', bad);
    }
    process.env.SITE_URL = ' https://ore.example.com/ ';
    assert.equal(siteUrl(), 'https://ore.example.com');
  } finally {
    process.env.SITE_URL = keep.s;
    if (keep.u === undefined) delete process.env.URL; else process.env.URL = keep.u;
  }
});

// ── Benchmark: modificabile solo da admin, manager e Senior Manager ──
test('benchmark: salvataggio riservato ad admin e manager', async () => {
  const rows = [{ progettoId: 1, fteTot: '2' }];
  assert.equal((await call('saveBenchmark', { rows }, T.anna)).status, 403, 'collaboratore');
  assert.equal((await call('saveBenchmark', { rows }, T.luca)).status, 403, 'Team Lead di progetto');
  assert.equal((await call('saveBenchmark', { rows }, T.mario)).status, 200, 'manager');
  assert.equal((await call('saveBenchmark', { rows }, T.admin)).status, 200, 'admin');
});

// ── Eventi: inviti, disponibilità, data, partecipazione ──
test('eventi: creazione, visibilità, disponibilità, data fissata e partecipazione', async () => {
  // Validazione: serve la data oppure il periodo
  assert.equal((await call('saveEvento', { nome: 'X', invitati: [ID.anna] }, T.luca)).status, 400);
  assert.equal((await call('saveEvento', { nome: 'X', periodoDa: '2026-12-10', periodoA: '2026-12-01', invitati: [ID.anna] }, T.luca)).status, 400);
  // Luca organizza, invita Anna e Sara; lui è aggiunto in automatico
  const cr = await call('saveEvento', { nome: 'Team Building', descrizione: 'Giornata insieme', luogo: 'Firenze',
    periodoDa: '2026-12-14', periodoA: '2026-12-18', invitati: [ID.anna, ID.sara] }, T.luca);
  assert.equal(cr.status, 200, cr.error);
  const id = cr.data.id;
  const ev = (await call('getEvento', { id }, T.anna)).data;
  assert.deepEqual(ev.invitati.map(i => i.risorsa_id).sort(), [ID.anna, ID.luca, ID.sara].sort());
  assert.equal(ev.owner, false);
  assert.equal(ev.creatore, 'Luca Verdi');
  // Chi non è invitato non lo vede; l'admin sì
  assert.equal((await call('getEvento', { id }, T.mario)).status, 404);
  assert.ok(!(await call('getEventi', {}, T.mario)).data.some(e => e.id === id));
  assert.equal((await call('getEvento', { id }, T.admin)).data.owner, true);

  // Disponibilità: solo a proprio nome, solo nel periodo
  assert.equal((await call('setDisponibilita', { eventoId: id, data: '2026-12-15', stato: 'si' }, T.anna)).status, 200);
  assert.equal((await call('setDisponibilita', { eventoId: id, data: '2026-12-15', stato: 'forse' }, T.sara)).status, 200);
  assert.equal((await call('setDisponibilita', { eventoId: id, data: '2026-12-20', stato: 'si' }, T.anna)).status, 400, 'fuori periodo');
  assert.equal((await call('setDisponibilita', { eventoId: id, data: '2026-12-15', stato: 'si' }, T.mario)).status, 404, 'non invitato');
  assert.equal((await call('setDisponibilita', { eventoId: id, data: '2026-12-15', stato: 'boh' }, T.anna)).status, 400);
  const disp = (await call('getEvento', { id }, T.luca)).data.disponibilita;
  assert.deepEqual(disp.map(d => d.risorsa_id + ':' + d.stato).sort(), [ID.anna + ':si', ID.sara + ':forse'].sort());

  // Solo l'organizzatore (o l'admin) fissa la data e modifica l'evento
  assert.equal((await call('setEventoData', { id, data: '2026-12-15' }, T.anna)).status, 403);
  assert.equal((await call('saveEvento', { id, nome: 'Rubato', data: '2026-12-15', invitati: [ID.anna] }, T.anna)).status, 403);
  assert.equal((await call('setEventoData', { id, data: '2026-12-15' }, T.luca)).status, 200);
  assert.equal((await call('getEvento', { id }, T.sara)).data.data, '2026-12-15');
  assert.equal((await call('setDisponibilita', { eventoId: id, data: '2026-12-16', stato: 'si' }, T.anna)).status, 409, 'data già fissata');

  // Partecipazione con commento
  assert.equal((await call('setPartecipazione', { eventoId: id, risposta: 'si', commento: 'Porto la torta' }, T.anna)).status, 200);
  assert.equal((await call('setPartecipazione', { eventoId: id, risposta: 'no', commento: 'In ferie' }, T.sara)).status, 200);
  assert.equal((await call('setPartecipazione', { eventoId: id, risposta: 'forse' }, T.sara)).status, 400);
  assert.equal((await call('setPartecipazione', { eventoId: id, risposta: 'si' }, T.admin)).status, 403, 'l\'admin non è un invitato');
  const ls = (await call('getEventi', {}, T.anna)).data.find(e => e.id === id);
  assert.equal(ls.si, 1); assert.equal(ls.no, 1); assert.equal(ls.invitati, 3); assert.equal(ls.mia_risposta, 'si');
  const anna = (await call('getEvento', { id }, T.luca)).data.invitati.find(i => i.risorsa_id === ID.anna);
  assert.equal(anna.commento, 'Porto la torta');

  // Modifica: Sara tolta dagli invitati (sparisce anche la sua disponibilità), l'organizzatore resta
  const up = await call('saveEvento', { id, nome: 'Team Building', periodoDa: '2026-12-14', periodoA: '2026-12-18', invitati: [ID.anna] }, T.luca);
  assert.equal(up.status, 200, up.error);
  const ev2 = (await call('getEvento', { id }, T.luca)).data;
  assert.deepEqual(ev2.invitati.map(i => i.risorsa_id).sort(), [ID.anna, ID.luca].sort());
  assert.ok(!ev2.disponibilita.some(d => d.risorsa_id === ID.sara));
  assert.equal((await call('getEvento', { id }, T.sara)).status, 404);

  // Eliminazione: solo organizzatore o admin
  assert.equal((await call('deleteEvento', { id }, T.anna)).status, 403);
  assert.equal((await call('deleteEvento', { id }, T.luca)).status, 200);
  assert.equal((await call('getEvento', { id }, T.luca)).status, 404);
});

test('eventi: icona salvata, modificata e validata', async () => {
  const bad = await call('saveEvento', { nome: 'Icona', data: '2026-12-01', icona: 'x" onclick="1', invitati: [ID.anna] }, T.luca);
  assert.equal(bad.status, 400);
  const { data: { id } } = await call('saveEvento', { nome: 'Partita', data: '2026-12-01', icona: 'futbol', invitati: [ID.anna] }, T.luca);
  assert.equal((await call('getEvento', { id }, T.anna)).data.icona, 'futbol');
  assert.equal((await call('getEventi', {}, T.anna)).data.find(e => e.id === id).icona, 'futbol');
  await call('saveEvento', { id, nome: 'Birra', data: '2026-12-01', icona: 'beer-mug-empty', invitati: [ID.anna] }, T.luca);
  assert.equal((await call('getEvento', { id }, T.anna)).data.icona, 'beer-mug-empty');
  await call('deleteEvento', { id }, T.luca);
});

// ── Confronto & Feedback ──
test('confronti: richiesta a più persone, gestione per destinatario, visibilità', async () => {
  // Validazione
  assert.equal((await call('saveConfronto', { destinatari: [ID.anna], tema: 'crescita' }, T.sara)).status, 400, 'motivo obbligatorio');
  assert.equal((await call('saveConfronto', { destinatari: [ID.sara], tema: 'crescita', messaggio: 'x' }, T.sara)).status, 400, 'non a sé stessi');
  assert.equal((await call('saveConfronto', { destinatari: [ID.anna], tema: 'boh', messaggio: 'x' }, T.sara)).status, 400, 'tema');
  assert.equal((await call('saveConfronto', { destinatari: [ID.anna], tema: 'crescita', messaggio: 'x' }, T.admin)).status, 403, 'admin escluso');
  // Sara chiede un confronto a Mario e Luca
  const cr = await call('saveConfronto', { destinatari: [ID.mario, ID.luca], tema: 'crescita', messaggio: 'Vorrei parlare del mio percorso',
    argomenti: ['Percorso di crescita', '', 'Nuove responsabilità'], priorita: 'alta', periodoDa: '2026-12-01', periodoA: '2026-12-15', durata: 30, note: 'Anche in pausa pranzo' }, T.sara);
  assert.equal(cr.status, 200, cr.error);
  const id = cr.data.id;
  const rm = (await call('getConfronti', {}, T.mario)).data.ricevute.find(r => r.id === id);
  assert.equal(rm.richiedente, 'Sara Neri');
  assert.deepEqual(rm.argomenti, ['Percorso di crescita', 'Nuove responsabilità']);
  assert.equal(rm.stato, 'da_pianificare'); assert.equal(rm.n_destinatari, 2); assert.equal(rm.durata_min, 30);
  assert.ok(!(await call('getConfronti', {}, T.anna)).data.ricevute.some(r => r.id === id), 'Anna non è destinataria');

  // Mario pianifica e risponde; Luca rifiuta. Ognuno tocca solo la propria copia
  assert.equal((await call('updateConfronto', { id, azione: 'pianifica', data: '2026-12-03', ora: '10:30', luogo: 'Teams', risposta: 'Volentieri!' }, T.mario)).status, 200);
  assert.equal((await call('updateConfronto', { id, azione: 'rifiuta', risposta: 'Meglio con il tuo manager' }, T.luca)).status, 200);
  assert.equal((await call('updateConfronto', { id, azione: 'pianifica', data: '2026-12-03' }, T.anna)).status, 404, 'non destinataria');
  assert.equal((await call('updateConfronto', { id, azione: 'pianifica', ora: '10:30' }, T.mario)).status, 400, 'data obbligatoria');
  assert.equal((await call('updateConfronto', { id, azione: 'cancella' }, T.mario)).status, 400);
  const inv = (await call('getConfronti', {}, T.sara)).data.inviate.find(r => r.id === id);
  const st = Object.fromEntries(inv.destinatari.map(d => [d.full_name, d.stato + '|' + (d.data_incontro || '') + '|' + (d.risposta || '')]));
  assert.deepEqual(st, { 'Mario Rossi': 'pianificato|2026-12-03|Volentieri!', 'Luca Verdi': 'rifiutato||Meglio con il tuo manager' });

  // Completato, poi riaperto (la data si azzera)
  await call('updateConfronto', { id, azione: 'completa' }, T.mario);
  assert.equal((await call('getConfronti', {}, T.mario)).data.ricevute.find(r => r.id === id).stato, 'completato');
  await call('updateConfronto', { id, azione: 'riapri' }, T.mario);
  const ri = (await call('getConfronti', {}, T.mario)).data.ricevute.find(r => r.id === id);
  assert.equal(ri.stato, 'da_pianificare'); assert.equal(ri.data_incontro, null); assert.equal(ri.risposta, 'Volentieri!');

  // Solo il richiedente ritira la richiesta
  assert.equal((await call('deleteConfronto', { id }, T.mario)).status, 404);
  assert.equal((await call('deleteConfronto', { id }, T.sara)).status, 200);
  assert.ok(!(await call('getConfronti', {}, T.mario)).data.ricevute.some(r => r.id === id));
});
