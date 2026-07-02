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
  // Crea la join table dei TL multipli se non esiste + migrazione one-time
  await sql`CREATE TABLE IF NOT EXISTS progetto_team_leads (
    progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    risorsa_id  INTEGER NOT NULL REFERENCES risorse(id)  ON DELETE CASCADE,
    PRIMARY KEY (progetto_id, risorsa_id)
  )`;
  await sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id)
    SELECT id, team_lead_id FROM progetti WHERE team_lead_id IS NOT NULL
    ON CONFLICT DO NOTHING`;

  const [progetti, risorse, allocazioni, ore, ferie, rep, wbsRows, repTipiRows] = await Promise.all([
    sql`SELECT p.id, p.nome, p.wbs,
          COALESCE(
            ARRAY_AGG(r.full_name ORDER BY r.cognome, r.nome)
            FILTER (WHERE r.id IS NOT NULL),
            ARRAY[]::TEXT[]
          ) AS team_lead_names
        FROM progetti p
        LEFT JOIN progetto_team_leads ptl ON p.id = ptl.progetto_id
        LEFT JOIN risorse r ON ptl.risorsa_id = r.id
        GROUP BY p.id, p.nome, p.wbs
        ORDER BY p.nome`,
    sql`SELECT id, nome, cognome, full_name, email, manager_id, is_manager, load_cost FROM risorse ORDER BY cognome, nome`,
    sql`SELECT risorsa_id, progetto_id FROM allocazioni`,
    sql`SELECT id, risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2 FROM ore_mensili`,
    sql`SELECT id, risorsa_id, data_inizio, data_fine, tipo, note FROM ferie`,
    sql`SELECT id, risorsa_id, progetto_id, team_lead_id, anno, mese, giorni FROM reperibilita`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 4) = 'wbs_'`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 9) = 'rep_tipi_'`
  ]);
  const wbs = {};
  wbsRows.forEach(r => {
    const key = r.chiave.substring(4); // strip 'wbs_' prefix → '{risorsaId}_{anno}_{mese}'
    try { wbs[key] = JSON.parse(r.valore); } catch {}
  });
  const repTipi = {};
  repTipiRows.forEach(r => {
    const pid = r.chiave.substring(9); // strip 'rep_tipi_' prefix → progetto_id
    try { repTipi[pid] = JSON.parse(r.valore); } catch {}
  });
  return { progetti, risorse, allocazioni, ore, ferie, rep, wbs, repTipi };
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
async function deleteOre(p){ await sql`DELETE FROM ore_mensili WHERE id=${p.id}`; }

// ── ferie ──
async function saveFerie(p){
  await sql`INSERT INTO ferie (risorsa_id, data_inizio, data_fine, tipo, note)
            VALUES (${p.risorsaId}, ${p.start}, ${p.end}, ${p.tipo}, ${p.note})`;
}
async function deleteFerie(p){ await sql`DELETE FROM ferie WHERE id=${p.id}`; }

// ── progetti (la DELETE sfrutta ON DELETE CASCADE sulle allocazioni) ──
async function addProject(p){
  const wbs = p.wbs || null;
  const [proj] = await sql`INSERT INTO progetti (nome, wbs) VALUES (${p.nome}, ${wbs}) RETURNING id`;
  for(const name of (p.teamLeadNames || [])){
    const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${name}`;
    if(tl) await sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id) VALUES (${proj.id}, ${tl.id}) ON CONFLICT DO NOTHING`;
  }
}
async function addProjectTL(p){
  const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.tlName}`;
  if(!tl) throw new Error('Risorsa non trovata: ' + p.tlName);
  await sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id) VALUES (${p.progettoId}, ${tl.id}) ON CONFLICT DO NOTHING`;
}
async function removeProjectTL(p){
  const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.tlName}`;
  if(!tl) return;
  await sql`DELETE FROM progetto_team_leads WHERE progetto_id=${p.progettoId} AND risorsa_id=${tl.id}`;
}
async function saveProjectLead(p){ /* mantenuto per compatibilità — usa addProjectTL/removeProjectTL */ }
async function saveProjectWbs(p){
  await sql`UPDATE progetti SET wbs=${p.wbs||null} WHERE id=${p.id}`;
}
async function deleteProject(p){ await sql`DELETE FROM progetti WHERE nome=${p.nome}`; }

// ── risorse + allocazioni (full_name lo genera il trigger; team_lead è testo) ──
async function addResource(p){
  const managerId = p.managerId || null;
  const isManager = !!p.isManager;
  const email = p.email || null;
  const loadCost = (p.loadCost != null && p.loadCost !== '') ? +p.loadCost : null;
  const [r] = await sql`INSERT INTO risorse (nome, cognome, email, manager_id, is_manager, load_cost) VALUES (${p.nome}, ${p.cognome}, ${email}, ${managerId}, ${isManager}, ${loadCost}) RETURNING id`;
  for(const nome of (p.progetti || [])){
    await sql`INSERT INTO allocazioni (risorsa_id, progetto_id)
              SELECT ${r.id}, id FROM progetti WHERE nome=${nome}`;
  }
}
async function saveEdit(p){
  const managerId = p.managerId || null;
  const isManager = !!p.isManager;
  const email = p.email || null;
  const loadCost = (p.loadCost != null && p.loadCost !== '') ? +p.loadCost : null;
  await sql`UPDATE risorse SET nome=${p.nome}, cognome=${p.cognome}, email=${email}, manager_id=${managerId}, is_manager=${isManager}, load_cost=${loadCost} WHERE id=${p.id}`;
  await sql`DELETE FROM allocazioni WHERE risorsa_id=${p.id}`;
  for(const nome of (p.progetti || [])){
    await sql`INSERT INTO allocazioni (risorsa_id, progetto_id)
              SELECT ${p.id}, id FROM progetti WHERE nome=${nome}`;
  }
}
async function deleteResource(p){ await sql`DELETE FROM risorse WHERE id=${p.id}`; } // CASCADE

// ── manager assignment (separata dall'edit per aggiornamenti rapidi inline) ──
async function setResourceManager(p){
  const managerId = p.managerId || null;
  await sql`UPDATE risorse SET manager_id=${managerId} WHERE id=${p.risorsaId}`;
}
async function toggleIsManager(p){
  await sql`UPDATE risorse SET is_manager=${!!p.value} WHERE id=${p.risorsaId}`;
}

async function saveRep(p){
  const [proj] = await sql`SELECT id FROM progetti WHERE nome=${p.progetto}`;
  if(!proj) throw new Error('Progetto non trovato: ' + p.progetto);
  let tlId = null;
  if(p.teamLead){
    const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.teamLead}`;
    tlId = tl ? tl.id : null;
  }
  await sql`DELETE FROM reperibilita WHERE risorsa_id=${p.risorsaId} AND progetto_id=${proj.id} AND anno=${p.anno} AND mese=${p.mese}`;
  if(p.giorni && p.giorni.length > 0){
    const [row] = await sql`INSERT INTO reperibilita (risorsa_id, progetto_id, team_lead_id, anno, mese, giorni) VALUES (${p.risorsaId}, ${proj.id}, ${tlId}, ${p.anno}, ${p.mese}, ${JSON.stringify(p.giorni)}::jsonb) RETURNING id, giorni`;
    return {id: row.id, giorni: row.giorni};
  }
  return {giorni: []};
}
async function deleteRep(p){ await sql`DELETE FROM reperibilita WHERE id=${p.id}`; }
async function getRepForProject(p){
  const [proj] = await sql`SELECT id FROM progetti WHERE nome=${p.progetto}`;
  if(!proj) return [];
  const rows = await sql`SELECT id, risorsa_id, anno, mese, giorni FROM reperibilita WHERE progetto_id=${proj.id} AND anno=${p.anno} AND mese=${p.mese}`;
  return rows.map(r=>({id:r.id, risorsaId:+r.risorsa_id, anno:+r.anno, mese:+r.mese, giorni:Array.isArray(r.giorni)?r.giorni.map(Number):[]}));
}

// ── presenze in ufficio ──
async function getPresenze(p){
  const rows = await sql`SELECT risorsa_id, data::text AS data FROM presenze WHERE data BETWEEN ${p.from}::date AND ${p.to}::date ORDER BY data`;
  return rows;
}
async function savePresenza(p){
  await sql`INSERT INTO presenze (risorsa_id, data) VALUES (${p.risorsaId}, ${p.data}) ON CONFLICT (risorsa_id, data) DO NOTHING`;
}
async function deletePresenza(p){
  await sql`DELETE FROM presenze WHERE risorsa_id=${p.risorsaId} AND data=${p.data}`;
}

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

// ── rep tipi (stored in config as rep_tipi_{progetto_id}) ──
async function saveRepTipi(p){
  const chiave = `rep_tipi_${p.id}`;
  const valore = JSON.stringify(p.tipi || []);
  await sql`INSERT INTO config (chiave, valore) VALUES (${chiave}, ${valore})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}

// ── WBS (stored in config as wbs_{risorsaId}_{anno}_{mese}) ──
async function saveWbs(p){
  const chiave = `wbs_${p.risorsaId}_${p.anno}_${p.mese}`;
  const valore = JSON.stringify(p.entries || []);
  await sql`INSERT INTO config (chiave, valore) VALUES (${chiave}, ${valore})
            ON CONFLICT (chiave) DO UPDATE SET valore=EXCLUDED.valore`;
}
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
  bootstrap, saveOre, deleteOre, saveFerie, deleteFerie, addProject, deleteProject, saveProjectLead, saveProjectWbs,
  addProjectTL, removeProjectTL,
  addResource, saveEdit, deleteResource, saveRep, deleteRep, getRepForProject,
  getPresenze, savePresenza, deletePresenza,
  userHasPwd, checkUserPwd, setUserPwd, resetUserPwd, checkAdminPwd, setAdminPwd,
  saveWbs, setResourceManager, toggleIsManager, saveRepTipi
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
