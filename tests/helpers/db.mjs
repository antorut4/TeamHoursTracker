// Database Postgres in-process (PGlite) con la stessa interfaccia del client Neon usata in db.mjs:
// sql`...` (tagged template, ritorna le righe) e sql.transaction([query, ...]).
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'fs';

const BASE = readFileSync(new URL('../fixtures/base-schema.sql', import.meta.url), 'utf8');

export async function createDb() {
  const pg = new PGlite();
  await pg.exec(BASE);
  // Le query sono pigre come in Neon: partono solo quando vengono attese o passate a transaction()
  const sql = (strings, ...values) => {
    const text = strings.reduce((acc, s, i) => acc + (i ? '$' + i : '') + s, '');
    const run = runner => runner.query(text, values).then(r => r.rows);
    return { _run: run, then: (ok, ko) => run(pg).then(ok, ko) };
  };
  sql.transaction = queries => pg.transaction(async tx => {
    const out = [];
    for (const q of queries) out.push(await q._run(tx));
    return out;
  });
  return { pg, sql };
}

// Richiesta all'handler come la invierebbe il browser
export function caller(handler) {
  return async (action, payload = {}, token = null) => {
    const headers = token ? { authorization: 'Bearer ' + token } : {};
    const res = await handler({ httpMethod: 'POST', headers, body: JSON.stringify({ action, payload }) });
    return { status: res.statusCode, ...JSON.parse(res.body) };
  };
}
