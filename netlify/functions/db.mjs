// ════════════════════════════════════════════════════════════════════════
//  Team Hours Tracker — proxy serverless verso Neon Postgres
//  Netlify Function. La connection string vive SOLO qui (env var DATABASE_URL),
//  mai nel browser. Il client invia { action, payload }; ogni action esegue
//  query SQL FISSE e PARAMETRIZZATE: niente SQL arbitrario dal client.
//  Le tabelle utenti_pwd/config sono accessibili solo da qui (le password
//  non escono mai: i check ritornano un boolean, mai l'hash).
// ════════════════════════════════════════════════════════════════════════
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// ── letture: un'unica bootstrap che restituisce tutto lo stato ──
async function bootstrap(){
  const [progetti, risorse, allocazioni, ore, ferie, rep] = await Promise.all([
    sql`SELECT id, nome FROM progetti ORDER BY nome`,
    sql`SELECT id, nome, cognome, full_name, team_lead FROM risorse ORDER BY cognome, nome`,
    sql`SELECT risorsa_id, progetto_id, team_lead_id FROM allocazioni`,
    sql`SELECT id, risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2 FROM ore_mensili`,
    sql`SELECT id, risorsa_id, data_inizio, data_fine, tipo, note FROM ferie`,
    sql`SELECT id, risorsa_id, progetto_id, team_lead_id, anno, mese, giorni FROM reperibilita`
  ]);
  return { progetti, risorse, allocazioni, ore, ferie, rep };
}

// ── ore (upsert sul vincolo UNIQUE risorsa_id,anno,mese) ──
async function saveOre(p){
  await sql`
    INSERT INTO ore_mensili (risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2)
    VALUES (${p.risorsaId}, ${p.anno}, ${p.mese}, ${p.ore_q1}, ${p.note_q1}, ${p.ore_q2}, ${p.note_q2})
    ON CONFLICT (risorsa_id, anno, mese)
    DO UPDATE SET ore_q1=EXCLUDED.ore_q1, note_q1=EXCLUDED.note_q1,
                  ore_q2=EXCLUDED.ore_q2, note_q2=EXCLUDED.note_q2
  `;
}

// ── ferie ──
async function saveFerie(p){
  await sql`INSERT INTO ferie (risorsa_id, data_inizio, data_fine, tipo, note)
            VALUES (${p.risorsaId}, ${p.start}, ${p.end}, ${p.tipo}, ${p.note})`;
}
async function deleteFerie(p){ await sql`DELETE FROM ferie WHERE id=${p.id}`; }

// ── progetti (la DELETE sfrutta ON DELETE CASCADE sulle allocazioni) ──
async function addProject(p){ await sql`INSERT INTO progetti (nome) VALUES (${p.nome})`; }
async function deleteProject(p){ await sql`DELETE FROM progetti WHERE nome=${p.nome}`; }

// ── risorse + allocazioni (full_name lo genera il trigger; team_lead è testo) ──
async function addResource(p){
  const [r] = await sql`INSERT INTO risorse (nome, cognome, team_lead)
                        VALUES (${p.nome}, ${p.cognome}, ${p.teamLead || null}) RETURNING id`;
  for(const nome of (p.progetti || [])){
    const tlName = p.progettiLeads?.[nome] || null;
    let tlId = null;
    if(tlName){
      const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${tlName}`;
      tlId = tl ? tl.id : null;
    }
    await sql`INSERT INTO allocazioni (risorsa_id, progetto_id, team_lead_id)
              SELECT ${r.id}, id, ${tlId} FROM progetti WHERE nome=${nome}`;
  }
}
async function saveEdit(p){
  await sql`UPDATE risorse SET nome=${p.nome}, cognome=${p.cognome}, team_lead=${p.teamLead || null}
            WHERE id=${p.id}`;
  await sql`DELETE FROM allocazioni WHERE risorsa_id=${p.id}`;
  for(const nome of (p.progetti || [])){
    const tlName = p.progettiLeads?.[nome] || null;
    let tlId = null;
    if(tlName){
      const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${tlName}`;
      tlId = tl ? tl.id : null;
    }
    await sql`INSERT INTO allocazioni (risorsa_id, progetto_id, team_lead_id)
              SELECT ${p.id}, id, ${tlId} FROM progetti WHERE nome=${nome}`;
  }
}
async function deleteResource(p){ await sql`DELETE FROM risorse WHERE id=${p.id}`; } // CASCADE

// ── reperibilità (lookup nomi -> id; upsert su UNIQUE risorsa_id,progetto_id,anno,mese) ──
async function saveRep(p){
  const [proj] = await sql`SELECT id FROM progetti WHERE nome=${p.progetto}`;
  if(!proj) throw new Error('Progetto non trovato: ' + p.progetto);
  let tlId = null;
  if(p.teamLead){
    const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.teamLead}`;
    tlId = tl ? tl.id : null;
  }
  await sql`
    INSERT INTO reperibilita (risorsa_id, progetto_id, team_lead_id, anno, mese, giorni)
    VALUES (${p.risorsaId}, ${proj.id}, ${tlId}, ${p.anno}, ${p.mese}, ${JSON.stringify(p.giorni || [])}::jsonb)
    ON CONFLICT (risorsa_id, progetto_id, anno, mese)
    DO UPDATE SET team_lead_id=EXCLUDED.team_lead_id, giorni=EXCLUDED.giorni
  `;
}
async function deleteRep(p){ await sql`DELETE FROM reperibilita WHERE id=${p.id}`; }

// ── password: l'hash entra, ma non esce mai (ritorniamo solo boolean/void) ──
async function userHasPwd(p){
  const [r] = await sql`SELECT 1 FROM utenti_pwd WHERE risorsa_id=${p.risorsaId}`;
  return !!r;
}
async function checkUserPwd(p){
  const [r] = await sql`SELECT 1 FROM utenti_pwd WHERE risorsa_id=${p.risorsaId} AND pwd_hash=${p.hash}`;
  return !!r;
}
async function setUserPwd(p){
  await sql`INSERT INTO utenti_pwd (risorsa_id, pwd_hash) VALUES (${p.risorsaId}, ${p.hash})
            ON CONFLICT (risorsa_id) DO UPDATE SET pwd_hash=EXCLUDED.pwd_hash, updated_at=NOW()`;
}
async function resetUserPwd(p){ await sql`DELETE FROM utenti_pwd WHERE risorsa_id=${p.risorsaId}`; }
async function checkAdminPwd(p){
  const [r] = await sql`SELECT 1 FROM config WHERE chiave='admin_pwd' AND valore=${p.hash}`;
  return !!r;
}
async function setAdminPwd(p){
  await sql`INSERT INTO config (chiave, valore) VALUES ('admin_pwd', ${p.hash})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}

// ── routing: whitelist esplicita delle action consentite ──
const ACTIONS = {
  bootstrap, saveOre, saveFerie, deleteFerie, addProject, deleteProject,
  addResource, saveEdit, deleteResource, saveRep, deleteRep,
  userHasPwd, checkUserPwd, setUserPwd, resetUserPwd, checkAdminPwd, setAdminPwd
};

export async function handler(event){
  const headers = { 'Content-Type': 'application/json' };
  if(event.httpMethod !== 'POST'){
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }
  let action, payload;
  try {
    const parsed = JSON.parse(event.body || '{}');
    action = parsed.action; payload = parsed.payload || {};
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Body JSON non valido' }) };
  }
  const fn = ACTIONS[action];
  if(!fn){
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action sconosciuta: ' + action }) };
  }
  try {
    const result = await fn(payload);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: result ?? null }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
}
