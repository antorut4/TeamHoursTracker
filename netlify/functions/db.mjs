// ════════════════════════════════════════════════════════════════════════
//  Team Hours Tracker — proxy serverless verso Neon Postgres
//  Netlify Function. La connection string vive SOLO qui (env var DATABASE_URL),
//  mai nel browser. Il client invia { action, payload }; ogni action esegue
//  query SQL FISSE e PARAMETRIZZATE: niente SQL arbitrario dal client.
//  Le tabelle utenti_pwd/config sono accessibili solo da qui (le password
//  non escono mai: i check ritornano un boolean, mai l'hash).
// ════════════════════════════════════════════════════════════════════════
import { neon }    from '@neondatabase/serverless';
import nodemailer   from 'nodemailer';
import { createHmac, timingSafeEqual } from 'crypto';

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
  await sql`ALTER TABLE ferie ADD COLUMN IF NOT EXISTS ora_inizio TEXT`;
  await sql`ALTER TABLE ferie ADD COLUMN IF NOT EXISTS ora_fine TEXT`;
  await sql`ALTER TABLE ferie DROP CONSTRAINT IF EXISTS ferie_tipo_check`;
  await sql`ALTER TABLE ferie ADD CONSTRAINT ferie_tipo_check CHECK (tipo IN ('Ferie', 'Malattia', 'Permesso/ROL'))`;
  await sql`ALTER TABLE reperibilita ADD COLUMN IF NOT EXISTS etichetta TEXT DEFAULT ''`;
  await sql`ALTER TABLE reperibilita DROP CONSTRAINT IF EXISTS reperibilita_risorse_id_progetto_id_anno_mese_key`;
  await sql`ALTER TABLE reperibilita DROP CONSTRAINT IF EXISTS reperibilita_risorsa_id_progetto_id_anno_mese_key`;
  await sql`DROP INDEX IF EXISTS reperibilita_risorse_id_progetto_id_anno_mese_key`;
  await sql`DROP INDEX IF EXISTS reperibilita_risorsa_id_progetto_id_anno_mese_key`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS rep_unique_per_turno ON reperibilita (risorsa_id, progetto_id, anno, mese, COALESCE(etichetta,''))`;
  await sql`CREATE TABLE IF NOT EXISTS daily_hours (
    id         BIGSERIAL    PRIMARY KEY,
    risorsa_id INTEGER      NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
    data       DATE         NOT NULL,
    ore        NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP    DEFAULT NOW(),
    updated_at TIMESTAMP    DEFAULT NOW(),
    UNIQUE (risorsa_id, data)
  )`;
  await sql`CREATE TABLE IF NOT EXISTS email_log (
    id           BIGSERIAL PRIMARY KEY,
    tipo         TEXT NOT NULL,
    destinatario TEXT NOT NULL,
    nome         TEXT,
    oggetto      TEXT,
    stato        TEXT NOT NULL,
    errore       TEXT,
    meta         JSONB,
    created_at   TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC)`;
  // Reminder giornaliero: attivo di default per tutti (anche per le righe già esistenti)
  await sql`ALTER TABLE risorse ADD COLUMN IF NOT EXISTS daily_reminder BOOLEAN NOT NULL DEFAULT TRUE`;
  await ensureTicketSchema();

  const [progetti, risorse, allocazioni, ore, ferie, rep, wbsRows, repTipiRows, aree, soglie] = await Promise.all([
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
    sql`SELECT id, nome, cognome, full_name, email, manager_id, is_manager, load_cost, daily_reminder FROM risorse ORDER BY cognome, nome`,
    sql`SELECT risorsa_id, progetto_id FROM allocazioni`,
    sql`SELECT id, risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2 FROM ore_mensili`,
    sql`SELECT id, risorsa_id, data_inizio, data_fine, tipo, note, ora_inizio, ora_fine FROM ferie`,
    sql`SELECT id, risorsa_id, progetto_id, team_lead_id, anno, mese, giorni, etichetta FROM reperibilita`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 4) = 'wbs_'`,
    sql`SELECT chiave, valore FROM config WHERE left(chiave, 9) = 'rep_tipi_'`,
    sql`SELECT id, progetto_id, nome, team_lead_id, attiva FROM aree ORDER BY nome`,
    sql`SELECT progetto_id, area_id, soglia, soglia_ee::float AS soglia_ee, attiva, destinatari FROM soglie_ticket`
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
  return { progetti, risorse, allocazioni, ore, ferie, rep, wbs, repTipi, aree, soglie };
}

// ── schema Andamento progetto (idempotente, eseguito a ogni bootstrap) ──
async function ensureTicketSchema(){
  // Aree: ogni area appartiene a un solo progetto, con un Team Lead responsabile
  await sql`CREATE TABLE IF NOT EXISTS aree (
    id           SERIAL  PRIMARY KEY,
    progetto_id  INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    nome         TEXT    NOT NULL,
    team_lead_id INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
    attiva       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP DEFAULT NOW(),
    UNIQUE (progetto_id, nome)
  )`;
  // Ticket giornalieri: dato originale, mai sostituito dagli aggregati.
  // progetto_id è denormalizzato: lo storico resta sul progetto anche se l'area viene spostata.
  await sql`CREATE TABLE IF NOT EXISTS ticket_giornalieri (
    id          BIGSERIAL PRIMARY KEY,
    area_id     INTEGER NOT NULL REFERENCES aree(id) ON DELETE CASCADE,
    progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    data        DATE    NOT NULL,
    l1          INTEGER NOT NULL CHECK (l1 >= 0),
    l2          INTEGER NOT NULL CHECK (l2 >= 0),
    l3          INTEGER NOT NULL CHECK (l3 >= 0),
    totale      INTEGER GENERATED ALWAYS AS (l1 + l2 + l3) STORED,
    inserito_da INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
    created_at  TIMESTAMP DEFAULT NOW(),
    updated_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE (area_id, data)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS ticket_giornalieri_prj_data_idx ON ticket_giornalieri (progetto_id, data)`;
  // Soglia mensile per progetto (sul totale L1+L2+L3). destinatari = email extra in CC, separate da virgola
  await sql`CREATE TABLE IF NOT EXISTS soglie_ticket (
    progetto_id INTEGER PRIMARY KEY REFERENCES progetti(id) ON DELETE CASCADE,
    soglia      INTEGER NOT NULL CHECK (soglia > 0),
    attiva      BOOLEAN NOT NULL DEFAULT TRUE,
    destinatari TEXT,
    updated_by  INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
    updated_at  TIMESTAMP DEFAULT NOW()
  )`;
  // Registro alert: il vincolo UNIQUE garantisce un solo invio per progetto + mese + soglia
  await sql`CREATE TABLE IF NOT EXISTS ticket_alert_log (
    id          BIGSERIAL PRIMARY KEY,
    progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    anno        INTEGER NOT NULL,
    mese        INTEGER NOT NULL,
    soglia      INTEGER NOT NULL,
    totale      INTEGER NOT NULL,
    l1          INTEGER NOT NULL,
    l2          INTEGER NOT NULL,
    l3          INTEGER NOT NULL,
    stato       TEXT    NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE (progetto_id, anno, mese, soglia)
  )`;

  // ── Soglie per area + soglia Extra Effort ──
  // soglie_ticket diventa la tabella unica delle soglie: area_id NULL = soglia di progetto,
  // area_id valorizzato = soglia della singola area (progetti con più aree).
  // soglia (ticket) e soglia_ee (ore Extra Effort) sono entrambe facoltative, una delle due è richiesta.
  await sql`ALTER TABLE soglie_ticket ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES aree(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE soglie_ticket ADD COLUMN IF NOT EXISTS soglia_ee NUMERIC(8,2) CHECK (soglia_ee > 0)`;
  await sql`ALTER TABLE soglie_ticket ALTER COLUMN soglia DROP NOT NULL`;
  await sql`ALTER TABLE soglie_ticket DROP CONSTRAINT IF EXISTS soglie_ticket_pkey`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS soglie_ticket_scope_uq ON soglie_ticket (progetto_id, (COALESCE(area_id, 0)))`;
  // Alert ticket anche per area: la deduplicazione include l'area (0 = livello progetto)
  await sql`ALTER TABLE ticket_alert_log ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES aree(id) ON DELETE CASCADE`;
  await sql`ALTER TABLE ticket_alert_log DROP CONSTRAINT IF EXISTS ticket_alert_log_progetto_id_anno_mese_soglia_key`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ticket_alert_log_scope_uq ON ticket_alert_log (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia)`;

  // Extra Effort: più attività per area e giorno, ognuna con descrizione e ore.
  // Come per i ticket, progetto_id è denormalizzato per conservare lo storico.
  await sql`CREATE TABLE IF NOT EXISTS extra_effort (
    id          BIGSERIAL PRIMARY KEY,
    area_id     INTEGER NOT NULL REFERENCES aree(id) ON DELETE CASCADE,
    progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    data        DATE    NOT NULL,
    attivita    TEXT    NOT NULL,
    ore         NUMERIC(6,2) NOT NULL CHECK (ore > 0),
    inserito_da INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
    created_at  TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE INDEX IF NOT EXISTS extra_effort_prj_data_idx ON extra_effort (progetto_id, data)`;
  await sql`CREATE INDEX IF NOT EXISTS extra_effort_area_data_idx ON extra_effort (area_id, data)`;
  // Registro alert Extra Effort: un solo invio per scope + mese + soglia
  await sql`CREATE TABLE IF NOT EXISTS ee_alert_log (
    id          BIGSERIAL PRIMARY KEY,
    progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    area_id     INTEGER REFERENCES aree(id) ON DELETE CASCADE,
    anno        INTEGER NOT NULL,
    mese        INTEGER NOT NULL,
    soglia      NUMERIC(8,2) NOT NULL,
    totale      NUMERIC(8,2) NOT NULL,
    attivita    INTEGER NOT NULL,
    stato       TEXT    NOT NULL DEFAULT 'pending',
    created_at  TIMESTAMP DEFAULT NOW()
  )`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS ee_alert_log_scope_uq ON ee_alert_log (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia)`;

  // Classificazione facoltativa dei ticket del giorno secondo TICKET_TREE (livello › categoria › attività).
  // Si affianca a ticket_giornalieri senza modificarlo: per livello, la somma di n non supera i ticket dichiarati.
  await sql`CREATE TABLE IF NOT EXISTS ticket_classificazioni (
    id          BIGSERIAL PRIMARY KEY,
    area_id     INTEGER NOT NULL REFERENCES aree(id) ON DELETE CASCADE,
    progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
    data        DATE    NOT NULL,
    livello     TEXT    NOT NULL CHECK (livello IN ('L1','L2','L3')),
    categoria   TEXT    NOT NULL,
    attivita    TEXT    NOT NULL,
    n           INTEGER NOT NULL CHECK (n > 0),
    inserito_da INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
    created_at  TIMESTAMP DEFAULT NOW(),
    UNIQUE (area_id, data, livello, categoria, attivita)
  )`;
  await sql`CREATE INDEX IF NOT EXISTS ticket_class_prj_data_idx ON ticket_classificazioni (progetto_id, data)`;
}

// Alberatura AMS per la classificazione dei ticket: unica fonte, inviata ai client e usata per validare
const TICKET_TREE = {
  L1: {
    'OPERATION': ['Recupero / Ripristino', 'Riavvio', 'Rerun / Riesecuzione', 'Monitoraggio', 'Gestione alert', 'Controllo esito elaborazione', 'Verifica disponibilità servizio'],
    'CONFIGURAZIONE': ['Gestione utenze', 'Gestione accessi', 'Abilitazione / Disabilitazione', 'Parametrizzazione standard', 'Setup standard'],
    'DATA OPERATION': ['Controllo dati', 'Estrazione standard', 'Caricamento standard', 'Controllo file', 'Controllo flussi', 'Recupero elaborazione'],
    'SUPPORTO': ['How-to', 'Supporto utente', 'Check funzionale', 'Raccolta evidenze', 'Verifica segnalazione', 'Escalation']
  },
  L2: {
    'TROUBLESHOOTING': ['Analisi anomalia applicativa', 'Analisi errore tecnico', 'Analisi log', 'Analisi integrazione', 'Analisi performance', 'Analisi dipendenze', 'Identificazione causa'],
    'OPERATION SPECIALISTICA': ['Recovery specialistico', 'Rerun con gestione dipendenze', 'Ripristino flusso', 'Gestione batch', 'Gestione job', 'Sblocco elaborazione', 'Remediation operativa'],
    'CONFIGURAZIONE': ['Configurazione applicativa', 'Parametrizzazione avanzata', 'Configurazione integrazione', 'Configurazione schedulazione', 'Configurazione autorizzazioni', 'Configurazione ambiente'],
    'DATA MANAGEMENT': ['Bonifica dati', 'Correzione dati', 'Rielaborazione dati', 'Allineamento dati', 'Analisi inconsistenze', 'Riconciliazione dati'],
    'INTEGRATION': ['Analisi flusso', 'Analisi interfaccia', 'Analisi API', 'Analisi errore integrazione', 'Gestione messaggi / code', 'Ripristino integrazione'],
    'PROBLEM ANALYSIS': ['Analisi incident ricorrenti', 'Root Cause Analysis', 'Analisi impatto', 'Individuazione workaround', 'Identificazione remediation', 'Escalation L3']
  },
  L3: {
    'MANUTENZIONE CORRETTIVA': ['Bug fixing', 'Correzione codice', 'Correzione query / procedure', 'Correzione pipeline', 'Correzione interfaccia', 'Correzione logica applicativa', 'Hotfix'],
    'MANUTENZIONE EVOLUTIVA': ['Modifica funzionalità', 'Nuova funzionalità', 'Enhancement', 'Modifica logica applicativa', 'Modifica logica dati', 'Estensione integrazione'],
    'CONFIGURAZIONE AVANZATA': ['Modifica configurazione strutturale', 'Modifica componenti', 'Modifica integrazione', 'Modifica security / permission', 'Modifica schedulazione complessa', 'Modifica configurazione ambiente'],
    'DATA & DATABASE': ['Modifica schema', 'Modifica data model', 'Modifica procedure', 'Modifica query', 'Ottimizzazione performance', 'Intervento strutturale sui dati'],
    'INTEGRATION & PIPELINE': ['Modifica API / interfaccia', 'Modifica pipeline', 'Modifica flusso', 'Refactoring integrazione', 'Nuova integrazione', 'Re-engineering flusso'],
    'ARCHITETTURA': ['Refactoring', 'Re-engineering', 'Migrazione', 'Modifica architetturale', 'Upgrade tecnologico', 'Introduzione nuovo componente'],
    'RELEASE & DEPLOYMENT': ['Deployment', 'Patch', 'Hotfix release', 'Rollback', 'Supporto UAT', 'Verifica post-release', 'Hypercare']
  }
};

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
  const oraInizio = (p.tipo === 'Permesso/ROL' && p.oraInizio) ? p.oraInizio : null;
  const oraFine   = (p.tipo === 'Permesso/ROL' && p.oraFine)   ? p.oraFine   : null;
  await sql`INSERT INTO ferie (risorsa_id, data_inizio, data_fine, tipo, note, ora_inizio, ora_fine)
            VALUES (${p.risorsaId}, ${p.start}, ${p.end}, ${p.tipo}, ${p.note}, ${oraInizio}, ${oraFine})`;
  // Notifica email ai TL — awaited, errori catturati per non bloccare il salvataggio
  let notifica = { sent: 0, reason: 'ok' };
  try { notifica = await sendAbsenceNotification(p); }
  catch (err) { console.error('[absence-notify]', err.message); notifica = { sent: 0, reason: 'error', error: err.message }; }
  return notifica;
}
async function deleteFerie(p){ await sql`DELETE FROM ferie WHERE id=${p.id}`; }

// ════════════════════════════════════════════════════════════════════════
//  Notifica assenza — invia email ai TL dei progetti della risorsa
// ════════════════════════════════════════════════════════════════════════

// Scrive una riga in email_log. Non deve mai far fallire l'invio: errori silenziati.
async function _logEmail(tipo, destinatario, nome, oggetto, stato, errore, meta) {
  try {
    await sql`INSERT INTO email_log (tipo, destinatario, nome, oggetto, stato, errore, meta)
              VALUES (${tipo}, ${destinatario}, ${nome || null}, ${oggetto || null},
                      ${stato}, ${errore || null}, ${meta ? JSON.stringify(meta) : null})`;
  } catch (e) { console.error('[email_log]', e.message); }
}

function _absenceTransporter() {
  return nodemailer.createTransport({
    host:   'smtp.gmail.com',
    port:   587,
    secure: false,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_APP_PASSWORD }
  });
}

// "2026-09-01" → "01/09/2026"
function _fmtDateIT(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// Tipo → colori email
function _tipoColor(tipo) {
  if (tipo === 'Ferie')        return { bg: '#dbeafe', text: '#1d4ed8', border: '#93c5fd' };
  if (tipo === 'Malattia')     return { bg: '#fee2e2', text: '#dc2626', border: '#fca5a5' };
  return                              { bg: '#fef3c7', text: '#d97706', border: '#fcd34d' }; // Permesso/ROL
}

// Espande [start, end] in array di ISO date
function _expandDays(start, end) {
  const days = [];
  let cur = new Date(start + 'T12:00:00Z');
  const fin = new Date(end   + 'T12:00:00Z');
  while (cur <= fin) { days.push(cur.toISOString().split('T')[0]); cur.setUTCDate(cur.getUTCDate() + 1); }
  return days;
}

// Costruisce mappa overlap: { progetto → { isoDay → [{name, tipo}] } }
// La nuova assenza (newName/tipo) appare in ogni giorno dove c'è almeno un collega
function _buildOverlapMap(newName, tipo, start, end, overlaps) {
  const days = _expandDays(start, end);
  const map  = {};
  overlaps.forEach(ov => {
    const ovS = new Date(ov.data_inizio + 'T12:00:00Z');
    const ovE = new Date(ov.data_fine   + 'T12:00:00Z');
    days.forEach(day => {
      const d = new Date(day + 'T12:00:00Z');
      if (d < ovS || d > ovE) return;
      if (!map[ov.progetto])       map[ov.progetto] = {};
      if (!map[ov.progetto][day])  map[ov.progetto][day] = [{ name: newName, tipo }];
      if (!map[ov.progetto][day].some(x => x.name === ov.full_name))
        map[ov.progetto][day].push({ name: ov.full_name, tipo: ov.tipo });
    });
  });
  return map;
}

async function sendAbsenceNotification(p) {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
  const FROM_NAME  = process.env.FROM_NAME || 'Team Hours Tracker';
  if (!GMAIL_USER || !GMAIL_PASS) return { sent: 0, reason: 'no_smtp' };

  // 1. Risorsa che ha salvato l'assenza
  const [risorsa] = await sql`SELECT full_name FROM risorse WHERE id = ${p.risorsaId}`;
  if (!risorsa) return { sent: 0, reason: 'no_resource' };
  const personName = risorsa.full_name;

  // 2. TL dei progetti della risorsa (esclusa la risorsa stessa, con email valida)
  const tlRows = await sql`
    SELECT DISTINCT r.full_name, r.email, proj.nome AS progetto
    FROM allocazioni a
    JOIN progetti proj ON proj.id = a.progetto_id
    JOIN progetto_team_leads ptl ON ptl.progetto_id = proj.id
    JOIN risorse r ON r.id = ptl.risorsa_id
    WHERE a.risorsa_id = ${p.risorsaId}
      AND ptl.risorsa_id != ${p.risorsaId}
      AND r.email IS NOT NULL AND r.email <> ''
    ORDER BY r.email, proj.nome`;
  if (!tlRows.length) {
    await _logEmail('assenza', '—', personName, `[Nuova assenza] ${personName}`, 'skipped',
                    'Nessun Team Leader con email sui progetti della risorsa',
                    { risorsa: personName, tipo: p.tipo, dal: p.start, al: p.end });
    return { sent: 0, reason: 'no_tl' };
  }

  // 3. Progetti della risorsa
  const projRows = await sql`
    SELECT proj.nome
    FROM allocazioni a
    JOIN progetti proj ON proj.id = a.progetto_id
    WHERE a.risorsa_id = ${p.risorsaId}
    ORDER BY proj.nome`;
  const progetti = projRows.map(r => r.nome);

  // 4. Sovrapposizioni con altri colleghi sugli stessi progetti
  const overlapRows = await sql`
    SELECT DISTINCT
      f.risorsa_id, r.full_name, f.data_inizio::text AS data_inizio,
      f.data_fine::text AS data_fine, f.tipo, proj.nome AS progetto
    FROM ferie f
    JOIN risorse r      ON r.id   = f.risorsa_id
    JOIN allocazioni a  ON a.risorsa_id = f.risorsa_id
    JOIN progetti proj  ON proj.id = a.progetto_id
    WHERE f.risorsa_id != ${p.risorsaId}
      AND a.progetto_id IN (
        SELECT progetto_id FROM allocazioni WHERE risorsa_id = ${p.risorsaId}
      )
      AND f.data_fine   >= ${p.start}::date
      AND f.data_inizio <= ${p.end}::date
    ORDER BY progetto, data_inizio, full_name`;

  const overlapMap = _buildOverlapMap(personName, p.tipo, p.start, p.end, overlapRows);
  const hasOverlap = Object.keys(overlapMap).length > 0;

  // 5. Deduplicazione TL per email
  const tlByEmail = {};
  tlRows.forEach(tl => {
    if (!tlByEmail[tl.email]) tlByEmail[tl.email] = { name: tl.full_name, email: tl.email };
  });

  // 6. Invio email
  const mailer  = _absenceTransporter();
  const subject = `[Nuova assenza] ${personName}`;
  const html    = buildAbsenceEmailHtml(personName, p, progetti, overlapMap, hasOverlap);
  const text    = buildAbsenceEmailText(personName, p, progetti, overlapMap, hasOverlap);

  const meta = { risorsa: personName, tipo: p.tipo, dal: p.start, al: p.end, progetti, overlap: hasOverlap };
  let sent = 0, failed = 0;
  const destinatari = [];
  for (const tl of Object.values(tlByEmail)) {
    try {
      const info = await mailer.sendMail({
        from: `${FROM_NAME} <${GMAIL_USER}>`,
        to:   tl.email,
        subject, html, text
      });
      const rejected = info?.rejected || [];
      const infoMeta = { ...meta, messageId: info?.messageId || null,
                         response: info?.response || null, rejected };
      if (rejected.length) {
        // sendMail risolve anche con destinatari rifiutati
        failed++;
        console.error(`[absence-notify] ✗ ${tl.email}: rifiutato — ${info?.response || ''}`);
        await _logEmail('assenza', tl.email, tl.name, subject, 'error', 'Destinatario rifiutato da SMTP', infoMeta);
      } else {
        sent++;
        destinatari.push(tl.name);
        console.log(`[absence-notify] ✓ ${tl.email} — ${personName} ${p.tipo} ${p.start}→${p.end}`);
        await _logEmail('assenza', tl.email, tl.name, subject, 'sent', null, infoMeta);
      }
    } catch (err) {
      failed++;
      console.error(`[absence-notify] ✗ ${tl.email}: ${err.message}`);
      await _logEmail('assenza', tl.email, tl.name, subject, 'error', err.message,
                      { ...meta, code: err.code || null, responseCode: err.responseCode || null });
    }
  }
  return { sent, failed, destinatari, reason: failed && !sent ? 'error' : 'ok' };
}

function buildAbsenceEmailText(personName, p, progetti, overlapMap, hasOverlap) {
  const col = _tipoColor(p.tipo);
  let t = `Team Hours Tracker — Nuova assenza\n\n`;
  t += `${personName} ha inserito una nuova assenza.\n\n`;
  t += `Tipo: ${p.tipo}\n`;
  t += `Periodo: ${_fmtDateIT(p.start)} - ${_fmtDateIT(p.end)}\n`;
  t += `\nProgetti coinvolti:\n${progetti.map(n => `- ${n}`).join('\n')}\n`;
  if (hasOverlap) {
    t += `\n⚠️ SONO PRESENTI ASSENZE CONTEMPORANEE:\n\n`;
    Object.entries(overlapMap).forEach(([prog, byDay]) => {
      t += `${prog}\n`;
      Object.entries(byDay).sort(([a],[b])=>a.localeCompare(b)).forEach(([day, people]) => {
        t += `  ${_fmtDateIT(day)}\n`;
        people.forEach(x => { t += `  - ${x.name} (${x.tipo})\n`; });
      });
      t += '\n';
    });
  } else {
    t += `\nNessuna sovrapposizione rilevata.\n`;
  }
  t += `\n---\nMessaggio automatico generato da Team Hours Tracker.`;
  return t;
}

function buildAbsenceEmailHtml(personName, p, progetti, overlapMap, hasOverlap) {
  const col    = _tipoColor(p.tipo);
  const period = p.start === p.end
    ? _fmtDateIT(p.start)
    : `${_fmtDateIT(p.start)} — ${_fmtDateIT(p.end)}`;

  // ── sezione sovrapposizioni ──
  let overlapHtml = '';
  if (hasOverlap) {
    let ovBody = '';
    Object.entries(overlapMap).forEach(([prog, byDay]) => {
      ovBody += `
        <tr><td colspan="2" style="padding:10px 0 4px;font-family:Arial,Helvetica,sans-serif;
            font-size:13px;font-weight:700;color:#92400e;">${prog}</td></tr>`;
      Object.entries(byDay).sort(([a],[b]) => a.localeCompare(b)).forEach(([day, people]) => {
        ovBody += `
        <tr><td colspan="2" style="padding:4px 0 2px;font-family:Arial,Helvetica,sans-serif;
            font-size:12px;color:#78350f;font-weight:600;">${_fmtDateIT(day)}</td></tr>`;
        people.forEach(x => {
          const pc = _tipoColor(x.tipo);
          ovBody += `
        <tr>
          <td style="padding:2px 0 2px 12px;font-family:Arial,Helvetica,sans-serif;
              font-size:12px;color:#451a03;">• ${x.name}</td>
          <td style="padding:2px 0;font-family:Arial,Helvetica,sans-serif;font-size:11px;">
            <span style="background:${pc.bg};color:${pc.text};border-radius:3px;
                padding:1px 6px;font-weight:600;">${x.tipo}</span>
          </td>
        </tr>`;
        });
      });
    });
    overlapHtml = `
      <tr>
        <td style="padding:0 40px 32px;background-color:#ffffff;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background-color:#fffbeb;border:1px solid #fde68a;border-radius:6px;overflow:hidden;">
            <tr>
              <td bgcolor="#fef3c7" style="background-color:#fef3c7;padding:12px 16px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;
                   font-weight:700;color:#92400e;">&#9888;&#65039; Sono presenti assenze contemporanee</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 16px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                  ${ovBody}
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  } else {
    overlapHtml = `
      <tr>
        <td style="padding:0 40px 32px;background-color:#ffffff;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
                 style="background-color:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;">
            <tr>
              <td style="padding:12px 16px;">
                <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;
                   color:#166534;">&#10003; Nessuna sovrapposizione rilevata.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }

  // ── progetti list ──
  const progettiHtml = progetti.map(n =>
    `<tr><td style="padding:2px 0 2px 0;font-family:Arial,Helvetica,sans-serif;
       font-size:13px;color:#374151;">• ${n}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Nuova assenza — ${personName}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>table{border-collapse:collapse;}</style>
<![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
@media(prefers-color-scheme:dark){
  .dm-outer{background-color:#1e1e2e!important;}
  .dm-card{background-color:#2a2a3e!important;}
  .dm-body{background-color:#2a2a3e!important;}
  .dm-foot{background-color:#222230!important;}
  .dm-title{color:#e8e8e8!important;}
  .dm-sub{color:#bbbbbb!important;}
  .dm-label{color:#aaaaaa!important;}
  .dm-value{color:#ffffff!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       class="dm-outer" style="background-color:#f0f2f5;">
  <tr><td align="center" valign="top" style="padding:40px 16px;">

    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
           class="dm-card" style="max-width:600px;width:100%;background-color:#ffffff;">

      <!-- HEADER -->
      <tr>
        <td align="center" bgcolor="#A100FF"
            style="background-color:#A100FF;padding:28px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;
                    font-family:Arial,Helvetica,sans-serif;">Team Hours Tracker</p>
          <p style="margin:6px 0 0;font-size:13px;color:#e8c4ff;
                    font-family:Arial,Helvetica,sans-serif;">Notifica assenza</p>
        </td>
      </tr>

      <!-- INTRO -->
      <tr>
        <td align="left" bgcolor="#ffffff" class="dm-body"
            style="background-color:#ffffff;padding:32px 40px 20px;">
          <p style="margin:0;font-size:16px;font-weight:600;color:#111827;
                    font-family:Arial,Helvetica,sans-serif;" class="dm-title">
            ${personName} ha inserito una nuova assenza.
          </p>
        </td>
      </tr>

      <!-- TIPO + PERIODO -->
      <tr>
        <td bgcolor="#ffffff" class="dm-body"
            style="background-color:#ffffff;padding:0 40px 24px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-right:24px;vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6b7280;
                          text-transform:uppercase;letter-spacing:.06em;
                          font-family:Arial,Helvetica,sans-serif;" class="dm-label">Tipo</p>
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td bgcolor="${col.bg}" style="background-color:${col.bg};border:1px solid ${col.border};
                        border-radius:4px;padding:5px 14px;">
                      <p style="margin:0;font-size:13px;font-weight:700;color:${col.text};
                                font-family:Arial,Helvetica,sans-serif;">${p.tipo}</p>
                    </td>
                  </tr>
                </table>
              </td>
              <td style="vertical-align:top;">
                <p style="margin:0 0 4px;font-size:11px;font-weight:700;color:#6b7280;
                          text-transform:uppercase;letter-spacing:.06em;
                          font-family:Arial,Helvetica,sans-serif;" class="dm-label">Periodo</p>
                <p style="margin:0;font-size:14px;font-weight:600;color:#111827;
                          font-family:Arial,Helvetica,sans-serif;" class="dm-value">${period}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- PROGETTI -->
      <tr>
        <td bgcolor="#ffffff" class="dm-body"
            style="background-color:#ffffff;padding:0 40px 28px;">
          <p style="margin:0 0 8px;font-size:11px;font-weight:700;color:#6b7280;
                    text-transform:uppercase;letter-spacing:.06em;
                    font-family:Arial,Helvetica,sans-serif;" class="dm-label">Progetti coinvolti</p>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            ${progettiHtml}
          </table>
        </td>
      </tr>

      <!-- SOVRAPPOSIZIONI -->
      ${overlapHtml}

      <!-- FOOTER -->
      <tr>
        <td align="center" bgcolor="#f8f9fc" class="dm-foot"
            style="background-color:#f8f9fc;padding:18px 40px;border-top:1px solid #eeeeee;">
          <p style="margin:0;font-size:12px;color:#aaaaaa;
                    font-family:Arial,Helvetica,sans-serif;">
            Messaggio automatico generato da Team Hours Tracker.<br>
            Non rispondere a questa email.
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>

</body>
</html>`;
}

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

// ── reminder giornaliero on/off per risorsa ──
async function setDailyReminder(p){
  await sql`UPDATE risorse SET daily_reminder=${!!p.value} WHERE id=${p.risorsaId}`;
}

async function saveRep(p){
  const [proj] = await sql`SELECT id FROM progetti WHERE nome=${p.progetto}`;
  if(!proj) throw new Error('Progetto non trovato: ' + p.progetto);
  let tlId = null;
  if(p.teamLead){
    const [tl] = await sql`SELECT id FROM risorse WHERE full_name=${p.teamLead}`;
    tlId = tl ? tl.id : null;
  }
  const etichetta = p.etichetta || '';
  await sql`DELETE FROM reperibilita WHERE risorsa_id=${p.risorsaId} AND progetto_id=${proj.id} AND anno=${p.anno} AND mese=${p.mese} AND COALESCE(etichetta,'')=${etichetta}`;
  if(p.giorni && p.giorni.length > 0){
    const [row] = await sql`INSERT INTO reperibilita (risorsa_id, progetto_id, team_lead_id, anno, mese, giorni, etichetta) VALUES (${p.risorsaId}, ${proj.id}, ${tlId}, ${p.anno}, ${p.mese}, ${JSON.stringify(p.giorni)}::jsonb, ${etichetta}) RETURNING id, giorni`;
    return {id: row.id, giorni: row.giorni};
  }
  return {giorni: []};
}
async function deleteRep(p){ await sql`DELETE FROM reperibilita WHERE id=${p.id}`; }
async function getRepForProject(p){
  const [proj] = await sql`SELECT id FROM progetti WHERE nome=${p.progetto}`;
  if(!proj) return [];
  const rows = await sql`SELECT id, risorsa_id, anno, mese, giorni, etichetta FROM reperibilita WHERE progetto_id=${proj.id} AND anno=${p.anno} AND mese=${p.mese}`;
  return rows.map(r=>({id:r.id, risorsaId:+r.risorsa_id, anno:+r.anno, mese:+r.mese, giorni:Array.isArray(r.giorni)?r.giorni.map(Number):[], etichetta:r.etichetta||''}));
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

// ════════════════════════════════════════════════════════════════════════
//  Sollecito Forecast — invia email alle risorse con ore mancanti
// ════════════════════════════════════════════════════════════════════════

async function sollecitaForecast(p) {
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
  const FROM_NAME  = process.env.FROM_NAME || 'Team Hours Tracker';
  const SITE_URL   = (process.env.SITE_URL || '').replace(/\/$/, '');
  if (!GMAIL_USER || !GMAIL_PASS) return { sent: 0, reason: 'no_smtp' };

  const [manager] = await sql`SELECT full_name FROM risorse WHERE id = ${p.managerId}`;
  if (!manager) return { sent: 0, reason: 'no_manager' };
  const managerName = manager.full_name;

  // Mese filtrato nel pannello (mese 0-based, come ore_mensili)
  const anno = Number(p.anno), mese = Number(p.mese);
  if (!Number.isInteger(anno) || !Number.isInteger(mese) || mese < 0 || mese > 11)
    throw new Error('Mese di riferimento non valido');
  const meseLabel = `${_MESI_IT[mese]} ${anno}`;

  // Risorse del manager con email
  const risorse = await sql`
    SELECT id, full_name, email FROM risorse
    WHERE manager_id = ${p.managerId}
      AND email IS NOT NULL AND email <> ''
    ORDER BY cognome, nome`;

  if (!risorse.length) return { sent: 0, skipped: 0, reason: 'no_resources' };

  // Ore Forecast del solo mese filtrato
  const oreRows = await sql`
    SELECT risorsa_id, ore_q1, ore_q2
    FROM ore_mensili
    WHERE anno = ${anno} AND mese = ${mese}
      AND risorsa_id IN (SELECT id FROM risorse WHERE manager_id = ${p.managerId})`;
  const oreByRes = {};
  oreRows.forEach(r => { oreByRes[r.risorsa_id] = r; });

  // Da sollecitare: chi nel mese non ha compilato né la I né la II quindicina
  const empty = v => v === null || v === undefined;
  const toNotify = risorse.filter(r => {
    const row = oreByRes[r.id];
    return !row || (empty(row.ore_q1) && empty(row.ore_q2));
  });

  const skipped = risorse.length - toNotify.length;
  if (!toNotify.length) return { sent: 0, skipped, reason: 'all_complete' };

  const mailer  = _absenceTransporter();
  const subject = `URGENTE - Inserimento ore Forecast ${meseLabel}`;
  let sent = 0, failed = 0;
  const destinatari = [];

  for (const risorsa of toNotify) {
    const html = _buildForecastSollecitaHtml(risorsa.full_name, managerName, SITE_URL, meseLabel);
    const text = _buildForecastSollecitaText(risorsa.full_name, managerName, SITE_URL, meseLabel);
    const meta = { risorsa: risorsa.full_name, manager: managerName, anno, mese };
    try {
      const info     = await mailer.sendMail({ from: `${FROM_NAME} <${GMAIL_USER}>`, to: risorsa.email, subject, html, text });
      const rejected = info?.rejected || [];
      if (rejected.length) {
        failed++;
        await _logEmail('sollecito_forecast', risorsa.email, risorsa.full_name, subject, 'error',
                        'Destinatario rifiutato da SMTP', { ...meta, rejected });
      } else {
        sent++;
        destinatari.push(risorsa.full_name);
        await _logEmail('sollecito_forecast', risorsa.email, risorsa.full_name, subject, 'sent', null,
                        { ...meta, messageId: info?.messageId || null });
      }
    } catch (err) {
      failed++;
      await _logEmail('sollecito_forecast', risorsa.email, risorsa.full_name, subject, 'error',
                      err.message, { ...meta, code: err.code || null });
    }
  }

  return { sent, failed, skipped, destinatari, reason: 'ok' };
}

function _buildForecastSollecitaText(risorsa, manager, siteUrl, meseLabel) {
  return [
    `Ciao ${risorsa},`,
    '',
    `${manager} ti sta sollecitando per l'inserimento delle ore Forecast di ${meseLabel}.`,
    '',
    'Ti chiediamo di procedere con la compilazione delle ore di entrambe le quindicine accedendo al seguente link:',
    siteUrl,
    '',
    'Grazie.',
    '',
    '---',
    'Messaggio automatico generato da Team Hours Tracker.'
  ].join('\n');
}

function _buildForecastSollecitaHtml(risorsa, manager, siteUrl, meseLabel) {
  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>Inserimento ore Forecast</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>table{border-collapse:collapse;}</style>
<![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
@media(prefers-color-scheme:dark){
  .dm-outer{background-color:#1e1e2e!important;}
  .dm-card{background-color:#2a2a3e!important;}
  .dm-body{background-color:#2a2a3e!important;}
  .dm-foot{background-color:#222230!important;}
  .dm-title{color:#e8e8e8!important;}
  .dm-text{color:#cccccc!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"
       class="dm-outer" style="background-color:#f0f2f5;">
  <tr><td align="center" valign="top" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"
           class="dm-card" style="max-width:600px;width:100%;background-color:#ffffff;">
      <!-- HEADER -->
      <tr>
        <td align="center" bgcolor="#A100FF" style="background-color:#A100FF;padding:28px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Team Hours Tracker</p>
          <p style="margin:6px 0 0;font-size:13px;color:#e8c4ff;font-family:Arial,Helvetica,sans-serif;">Inserimento ore Forecast</p>
        </td>
      </tr>
      <!-- BODY -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:32px 40px 24px;">
          <p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:600;color:#111827;" class="dm-title">Ciao ${risorsa},</p>
          <p style="margin:0 0 20px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.6;" class="dm-text">
            <strong>${manager}</strong> ti sta sollecitando per l'inserimento delle ore Forecast di <strong>${_esc(meseLabel)}</strong>.
          </p>
          <p style="margin:0 0 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;line-height:1.6;" class="dm-text">
            Ti chiediamo di procedere con la compilazione delle ore di entrambe le quindicine accedendo al seguente link:
          </p>
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml"
            href="${siteUrl}" style="height:44px;v-text-anchor:middle;width:260px;"
            arcsize="11%" stroke="f" fillcolor="#A100FF">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">
              INSERISCI LE ORE FORECAST
            </center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td bgcolor="#A100FF" style="background-color:#A100FF;border-radius:5px;text-align:center;">
                <a href="${siteUrl}"
                   style="display:inline-block;padding:13px 32px;font-family:Arial,Helvetica,sans-serif;
                          font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:5px;">
                  INSERISCI LE ORE FORECAST
                </a>
              </td>
            </tr>
          </table>
          <!--<![endif]-->
          <p style="margin:28px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#374151;" class="dm-text">Grazie.</p>
        </td>
      </tr>
      <!-- FOOTER -->
      <tr>
        <td class="dm-foot" style="background-color:#f8f8f8;padding:16px 40px;border-top:1px solid #e5e7eb;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9ca3af;text-align:center;">
            Messaggio automatico generato da Team Hours Tracker.
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── email log: ultime N righe, filtrabili per tipo/stato ──
async function getEmailLog(p){
  const limit = Math.min(+p.limit || 100, 500);
  const tipo  = p.tipo  || null;
  const stato = p.stato || null;
  const rows = await sql`
    SELECT id, tipo, destinatario, nome, oggetto, stato, errore, meta,
           to_char(created_at, 'DD/MM/YYYY HH24:MI') AS quando
    FROM email_log
    WHERE (${tipo}::text  IS NULL OR tipo  = ${tipo})
      AND (${stato}::text IS NULL OR stato = ${stato})
    ORDER BY created_at DESC
    LIMIT ${limit}`;
  return rows;
}

// ── consuntivo: scrittura ore giornaliere su daily_hours ──
// ore null/0/'': cancella la riga; altrimenti upsert
async function saveConsuntivo(p){
  const ore=(p.ore!==null&&p.ore!==''&&!isNaN(+p.ore)&&+p.ore>0)?+p.ore:null;
  if(ore===null){
    await sql`DELETE FROM daily_hours WHERE risorsa_id=${p.risorsaId} AND data=${p.data}`;
  }else{
    await sql`INSERT INTO daily_hours (risorsa_id, data, ore, updated_at)
              VALUES (${p.risorsaId}, ${p.data}, ${ore}, NOW())
              ON CONFLICT (risorsa_id, data) DO UPDATE SET ore=EXCLUDED.ore, updated_at=NOW()`;
  }
}

// ── consuntivo: lettura ore giornaliere da daily_hours (sola lettura) ──
async function getConsuntivo(p){
  const anno = +p.anno;
  const mese = +p.mese; // 0-based dal frontend → EXTRACT(MONTH) è 1-based
  const rows = await sql`
    SELECT dh.risorsa_id, dh.data::text AS data, dh.ore::float AS ore, r.full_name
    FROM daily_hours dh
    JOIN risorse r ON r.id = dh.risorsa_id
    WHERE EXTRACT(YEAR  FROM dh.data) = ${anno}
      AND EXTRACT(MONTH FROM dh.data) = ${mese + 1}
    ORDER BY dh.risorsa_id, dh.data`;
  return rows;
}

// ════════════════════════════════════════════════════════════════════════
//  Andamento progetto — aree, ticket giornalieri L1/L2/L3, soglie e alert
//  Convenzione mese: 0-based (come ore_mensili/reperibilita).
// ════════════════════════════════════════════════════════════════════════

const _MESI_IT = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
                  'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];

function _esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

// Data odierna in Europe/Rome come 'YYYY-MM-DD'
function _todayRome() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Rome' });
}

function _isIsoDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }

// Numero ticket: intero >= 0, altrimenti errore
function _ticketInt(v, label) {
  const n = Number(v);
  if (v === '' || v === null || v === undefined || !Number.isInteger(n) || n < 0 || n > 100000)
    throw new Error(`Valore ${label} non valido: inserisci un numero intero non negativo`);
  return n;
}

// ── token link email (stesso segreto del reminder ore, tipo distinto 'tk') ──
function verifyTicketToken(token) {
  const SECRET = process.env.DAILY_TOKEN_SECRET;
  if (!SECRET) throw new Error('DAILY_TOKEN_SECRET non configurato');
  const dot = String(token || '').indexOf('.');
  if (dot < 1) throw new Error('Token malformato');
  const b64 = token.slice(0, dot), sig = token.slice(dot + 1);
  const expected = createHmac('sha256', SECRET).update(b64).digest('hex');
  let valid = false;
  try { valid = timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex')); } catch {}
  if (!valid) throw new Error('Firma token non valida');
  let payload;
  try { payload = JSON.parse(Buffer.from(b64, 'base64url').toString()); }
  catch { throw new Error('Payload token non valido'); }
  if (payload.k !== 'tk' || !payload.r || !Array.isArray(payload.ds) || !payload.ds.length || !payload.e)
    throw new Error('Token campi mancanti');
  if (Math.floor(Date.now() / 1000) > payload.e) throw new Error('Token scaduto');
  return payload;
}

// ── aree (admin) ──
async function saveArea(p){
  const nome = (p.nome || '').trim();
  if (!nome) throw new Error('Nome area obbligatorio');
  if (!p.progettoId) throw new Error('Progetto obbligatorio');
  const tlId = p.teamLeadId || null;
  const attiva = p.attiva !== false;
  try {
    if (p.id) {
      await sql`UPDATE aree SET nome=${nome}, progetto_id=${p.progettoId}, team_lead_id=${tlId}, attiva=${attiva}
                WHERE id=${p.id}`;
      // La soglia d'area segue l'area se viene spostata su un altro progetto
      await sql`UPDATE soglie_ticket SET progetto_id=${p.progettoId} WHERE area_id=${p.id}`;
    } else {
      await sql`INSERT INTO aree (progetto_id, nome, team_lead_id, attiva)
                VALUES (${p.progettoId}, ${nome}, ${tlId}, ${attiva})`;
    }
  } catch (e) {
    if (String(e.message).includes('aree_progetto_id_nome_key')) throw new Error('Esiste già un\'area con questo nome nel progetto');
    throw e;
  }
}
// Eliminazione consentita solo se l'area non ha dati: lo storico ticket ed Extra Effort non va perso
async function deleteArea(p){
  const [r] = await sql`SELECT COUNT(*)::int AS n FROM ticket_giornalieri WHERE area_id=${p.id}`;
  if (r.n > 0) throw new Error(`L'area ha ${r.n} registrazioni ticket: disattivala invece di eliminarla`);
  const [e] = await sql`SELECT COUNT(*)::int AS n FROM extra_effort WHERE area_id=${p.id}`;
  if (e.n > 0) throw new Error(`L'area ha ${e.n} attività di Extra Effort registrate: disattivala invece di eliminarla`);
  await sql`DELETE FROM aree WHERE id=${p.id}`;
}

// Primo e ultimo giorno di un mese (0-based) come 'YYYY-MM-DD'
function _monthRange(anno, mese) {
  return [new Date(Date.UTC(anno, mese, 1)).toISOString().slice(0, 10),
          new Date(Date.UTC(anno, mese + 1, 0)).toISOString().slice(0, 10)];
}

// ── lettura andamento: aggregati mensili per progetto+area (ticket ed Extra Effort),
//    dettaglio attività Extra Effort e alert del mese selezionato ──
// scope: [{ progettoId, areaIds }] — areaIds null = progetto intero, array = solo quelle aree (Team Lead d'area).
// progettoIds (formato precedente) equivale a scope con progetti interi.
async function getAndamento(p){
  const scope = Array.isArray(p.scope) ? p.scope : (p.progettoIds || []).map(id => ({ progettoId: id, areaIds: null }));
  const full = [], areas = [];
  scope.forEach(s => {
    const pid = +s.progettoId;
    if (!pid) return;
    if (Array.isArray(s.areaIds)) s.areaIds.map(Number).filter(Boolean).forEach(a => areas.push(a));
    else full.push(pid);
  });
  if (!full.length && !areas.length) return { tickets: [], ee: [], eeDettaglio: [], alert: [], cls: [] };
  const anno = +p.anno, mese = +p.mese;               // mese 0-based
  const mesi = Math.min(Math.max(+p.mesi || 12, 1), 24);
  const from = new Date(Date.UTC(anno, mese - mesi + 1, 1)).toISOString().slice(0, 10);
  const [mFrom, to] = _monthRange(anno, mese);
  const [tickets, ee, eeDettaglio, alertTk, alertEe, cls] = await Promise.all([
    sql`SELECT progetto_id, area_id,
               EXTRACT(YEAR FROM data)::int      AS anno,
               EXTRACT(MONTH FROM data)::int - 1 AS mese,
               SUM(l1)::int AS l1, SUM(l2)::int AS l2, SUM(l3)::int AS l3, SUM(totale)::int AS totale,
               COUNT(*)::int AS giorni, MAX(data)::text AS ultimo
        FROM ticket_giornalieri
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[]))
          AND data BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2, 3, 4`,
    sql`SELECT progetto_id, area_id,
               EXTRACT(YEAR FROM data)::int      AS anno,
               EXTRACT(MONTH FROM data)::int - 1 AS mese,
               SUM(ore)::float AS ore, COUNT(*)::int AS n
        FROM extra_effort
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[]))
          AND data BETWEEN ${from}::date AND ${to}::date
        GROUP BY 1, 2, 3, 4`,
    sql`SELECT e.id, e.progetto_id, e.area_id, e.data::text AS data, e.attivita, e.ore::float AS ore,
               r.full_name AS inserito_da
        FROM extra_effort e LEFT JOIN risorse r ON r.id = e.inserito_da
        WHERE (e.progetto_id = ANY(${full}::int[]) OR e.area_id = ANY(${areas}::int[]))
          AND e.data BETWEEN ${mFrom}::date AND ${to}::date
        ORDER BY e.data DESC, e.id`,
    sql`SELECT 'ticket' AS kind, progetto_id, area_id, soglia::float AS soglia, totale::float AS totale, stato,
               to_char(created_at, 'DD/MM/YYYY HH24:MI') AS quando
        FROM ticket_alert_log
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[])) AND anno=${anno} AND mese=${mese}`,
    sql`SELECT 'ee' AS kind, progetto_id, area_id, soglia::float AS soglia, totale::float AS totale, stato,
               to_char(created_at, 'DD/MM/YYYY HH24:MI') AS quando
        FROM ee_alert_log
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[])) AND anno=${anno} AND mese=${mese}`,
    sql`SELECT progetto_id, area_id, livello, categoria, attivita, SUM(n)::int AS n
        FROM ticket_classificazioni
        WHERE (progetto_id = ANY(${full}::int[]) OR area_id = ANY(${areas}::int[]))
          AND data BETWEEN ${mFrom}::date AND ${to}::date
        GROUP BY 1, 2, 3, 4, 5`
  ]);
  return { tickets, ee, eeDettaglio, alert: [...alertTk, ...alertEe], cls };
}

// Valore di soglia facoltativo: vuoto = non impostata
function _optThreshold(v, intOnly, label) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000 || (intOnly && !Number.isInteger(n)))
    throw new Error(`La soglia ${label} deve essere un numero ${intOnly ? 'intero ' : ''}maggiore di zero`);
  return intOnly ? n : Math.round(n * 100) / 100;
}

// ── soglie mensili (ticket + Extra Effort) di progetto o di area: inserimento/modifica/rimozione
//    + ricalcolo immediato del mese corrente. I campi non inviati restano invariati. ──
async function saveSoglia(p){
  if (!p.progettoId) throw new Error('Progetto obbligatorio');
  const pid = +p.progettoId;
  const areaId = p.areaId ? +p.areaId : null;
  if (areaId) {
    const [a] = await sql`SELECT progetto_id FROM aree WHERE id=${areaId}`;
    if (!a || +a.progetto_id !== pid) throw new Error('L\'area non appartiene al progetto indicato');
  }
  const [cur] = await sql`SELECT soglia, soglia_ee::float AS soglia_ee, attiva, destinatari FROM soglie_ticket
                          WHERE progetto_id=${pid} AND COALESCE(area_id, 0)=${areaId || 0}`;
  const soglia   = p.soglia   !== undefined ? _optThreshold(p.soglia, true, 'ticket')          : (cur ? cur.soglia : null);
  const sogliaEe = p.sogliaEe !== undefined ? _optThreshold(p.sogliaEe, false, 'Extra Effort') : (cur ? cur.soglia_ee : null);
  if (soglia === null && sogliaEe === null) {
    await sql`DELETE FROM soglie_ticket WHERE progetto_id=${pid} AND COALESCE(area_id, 0)=${areaId || 0}`;
    return { status: 'removed' };
  }
  const attiva = p.attiva !== undefined ? p.attiva !== false : (cur ? cur.attiva : true);
  const destinatari = p.destinatari !== undefined ? ((p.destinatari || '').trim() || null) : (cur ? cur.destinatari : null);
  await sql`INSERT INTO soglie_ticket (progetto_id, area_id, soglia, soglia_ee, attiva, destinatari, updated_by, updated_at)
            VALUES (${pid}, ${areaId}, ${soglia}, ${sogliaEe}, ${attiva}, ${destinatari}, ${p.risorsaId || null}, NOW())
            ON CONFLICT (progetto_id, (COALESCE(area_id, 0))) DO UPDATE SET soglia=EXCLUDED.soglia, soglia_ee=EXCLUDED.soglia_ee,
              attiva=EXCLUDED.attiva, destinatari=EXCLUDED.destinatari, updated_by=EXCLUDED.updated_by, updated_at=NOW()`;
  // Una nuova soglia già superata nel mese corrente va gestita subito
  const [y, m] = _todayRome().split('-').map(Number);
  let checks;
  try { checks = await _checkThresholds(pid, areaId, y, m - 1); }
  catch (err) { console.error('[threshold-alert]', err.message); checks = [{ kind: 'ticket', status: 'error', error: err.message }]; }
  return { status: 'saved', checks, check: checks.find(c => c.kind === 'ticket') || null };
}

// ── giornata ticket di un Team Lead: aree attive + valori già inseriti per le date richieste ──
// Aree attive su cui una risorsa può inserire dati: quelle di cui è TL e, se withProjectTL,
// tutte le aree dei progetti di cui è TL di progetto. progettoId limita a un solo progetto.
function _editableAree(tlId, progettoId, withProjectTL){
  const pid = progettoId ? +progettoId : null;
  return sql`
    SELECT a.id, a.nome, a.progetto_id, p.nome AS progetto
    FROM aree a JOIN progetti p ON p.id = a.progetto_id
    WHERE a.attiva
      AND (a.team_lead_id=${tlId}
           OR (${!!withProjectTL}::boolean AND a.progetto_id IN (SELECT progetto_id FROM progetto_team_leads WHERE risorsa_id=${tlId})))
      AND (${pid}::int IS NULL OR a.progetto_id=${pid})
    ORDER BY p.nome, a.nome`;
}

async function _ticketDayForTL(tlId, dates, progettoId = null, withProjectTL = false){
  const [tl] = await sql`SELECT id, full_name FROM risorse WHERE id=${tlId}`;
  if (!tl) throw new Error('Risorsa non trovata');
  const aree = await _editableAree(tlId, progettoId, withProjectTL);
  const areaIds = aree.map(a => a.id);
  const [rows, eeRows, clsRows] = aree.length ? await Promise.all([
    sql`SELECT area_id, data::text AS data, l1, l2, l3, totale
        FROM ticket_giornalieri
        WHERE area_id = ANY(${areaIds}::int[]) AND data = ANY(${dates}::date[])`,
    sql`SELECT area_id, data::text AS data, attivita, ore::float AS ore
        FROM extra_effort
        WHERE area_id = ANY(${areaIds}::int[]) AND data = ANY(${dates}::date[])
        ORDER BY id`,
    sql`SELECT area_id, data::text AS data, livello, categoria, attivita, n
        FROM ticket_classificazioni
        WHERE area_id = ANY(${areaIds}::int[]) AND data = ANY(${dates}::date[])
        ORDER BY id`
  ]) : [[], [], []];
  const entries = {}, ee = {}, cls = {};
  clsRows.forEach(r => {
    if (!cls[r.data]) cls[r.data] = {};
    (cls[r.data][r.area_id] = cls[r.data][r.area_id] || []).push({ livello: r.livello, categoria: r.categoria, attivita: r.attivita, n: r.n });
  });
  rows.forEach(r => {
    if (!entries[r.data]) entries[r.data] = {};
    entries[r.data][r.area_id] = { l1: r.l1, l2: r.l2, l3: r.l3, totale: r.totale };
  });
  eeRows.forEach(r => {
    if (!ee[r.data]) ee[r.data] = {};
    (ee[r.data][r.area_id] = ee[r.data][r.area_id] || []).push({ attivita: r.attivita, ore: r.ore });
  });
  return { risorsaId: +tl.id, fullName: tl.full_name, dates, aree, entries, ee, cls, tree: TICKET_TREE };
}

// Classificazione dei ticket di un'area per una giornata. undefined = non inviata (classificazione invariata).
// Ogni voce deve esistere in TICKET_TREE; per livello la somma non può superare i ticket dichiarati.
function _clsRows(list, counts) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new Error('Formato classificazione ticket non valido');
  if (list.length > 200) throw new Error('Classificazione ticket: troppe voci');
  const merged = new Map(), perLv = { L1: 0, L2: 0, L3: 0 };
  for (const r of list) {
    const livello = String(r?.livello ?? ''), categoria = String(r?.categoria ?? ''), attivita = String(r?.attivita ?? '');
    if (!TICKET_TREE[livello]?.[categoria]?.includes(attivita))
      throw new Error(`Classificazione ticket non valida: ${livello} › ${categoria} › ${attivita}`);
    const n = Number(r?.n);
    if (!Number.isInteger(n) || n <= 0 || n > 100000)
      throw new Error(`Classificazione "${attivita}": il numero di ticket deve essere un intero maggiore di zero`);
    const key = `${livello}\u0000${categoria}\u0000${attivita}`;
    merged.set(key, { livello, categoria, attivita, n: (merged.get(key)?.n || 0) + n });
    perLv[livello] += n;
  }
  for (const lv of ['L1', 'L2', 'L3']) {
    const max = counts[lv.toLowerCase()];
    if (perLv[lv] > max)
      throw new Error(`Classificazione ${lv}: ${perLv[lv]} ticket classificati ma ne risultano ${max} dichiarati`);
  }
  return [...merged.values()];
}

// Righe Extra Effort di un'area per una giornata. undefined = non inviate (Extra Effort invariato).
function _eeRows(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new Error('Formato Extra Effort non valido');
  if (list.length > 50) throw new Error('Extra Effort: massimo 50 attività per area e giorno');
  return list.map(r => {
    const attivita = String(r?.attivita ?? '').trim();
    if (!attivita) throw new Error('Extra Effort: indica la tipologia attività / dettaglio per ogni riga');
    if (attivita.length > 300) throw new Error('Extra Effort: descrizione troppo lunga (massimo 300 caratteri)');
    const ore = Number(r?.ore);
    if (r?.ore === '' || r?.ore === null || !Number.isFinite(ore) || ore <= 0 || ore > 999)
      throw new Error(`Extra Effort "${attivita}": inserisci un numero di ore maggiore di zero`);
    return { attivita, ore: Math.round(ore * 100) / 100 };
  });
}

// Upsert dei ticket (e sostituzione delle attività Extra Effort) di una giornata per le aree del TL,
// in un'unica transazione; poi controllo soglie di progetti e aree coinvolti
async function _saveTicketEntries(tlId, data, entries, progettoId = null, withProjectTL = false){
  if (!_isIsoDate(data)) throw new Error('Data non valida');
  if (data > _todayRome()) throw new Error('Non è possibile inserire ticket per date future');
  if (!Array.isArray(entries) || !entries.length) throw new Error('Nessun dato da salvare');
  const own = await _editableAree(tlId, progettoId, withProjectTL);
  const prjByArea = {};
  own.forEach(a => { prjByArea[a.id] = a.progetto_id; });
  // Validazione completa prima di scrivere: o tutto o niente
  const clean = entries.map(e => {
    const areaId = +e.areaId;
    if (!prjByArea[areaId]) throw new Error('Area non assegnata a questo Team Lead o non attiva');
    const counts = { l1: _ticketInt(e.l1, 'L1'), l2: _ticketInt(e.l2, 'L2'), l3: _ticketInt(e.l3, 'L3') };
    return { areaId, progettoId: prjByArea[areaId], ...counts, ee: _eeRows(e.ee), cls: _clsRows(e.cls, counts) };
  });
  const queries = [];
  for (const e of clean) {
    queries.push(sql`INSERT INTO ticket_giornalieri (area_id, progetto_id, data, l1, l2, l3, inserito_da, updated_at)
              VALUES (${e.areaId}, ${e.progettoId}, ${data}::date, ${e.l1}, ${e.l2}, ${e.l3}, ${tlId}, NOW())
              ON CONFLICT (area_id, data) DO UPDATE SET l1=EXCLUDED.l1, l2=EXCLUDED.l2, l3=EXCLUDED.l3,
                inserito_da=EXCLUDED.inserito_da, updated_at=NOW()`);
    if (e.ee !== undefined) {
      queries.push(sql`DELETE FROM extra_effort WHERE area_id=${e.areaId} AND data=${data}::date`);
      for (const r of e.ee) {
        queries.push(sql`INSERT INTO extra_effort (area_id, progetto_id, data, attivita, ore, inserito_da)
                  VALUES (${e.areaId}, ${e.progettoId}, ${data}::date, ${r.attivita}, ${r.ore}, ${tlId})`);
      }
    }
    if (e.cls !== undefined) {
      queries.push(sql`DELETE FROM ticket_classificazioni WHERE area_id=${e.areaId} AND data=${data}::date`);
      for (const r of e.cls) {
        queries.push(sql`INSERT INTO ticket_classificazioni (area_id, progetto_id, data, livello, categoria, attivita, n, inserito_da)
                  VALUES (${e.areaId}, ${e.progettoId}, ${data}::date, ${r.livello}, ${r.categoria}, ${r.attivita}, ${r.n}, ${tlId})`);
      }
    }
  }
  await sql.transaction(queries);
  const [y, m] = data.split('-').map(Number);
  // Soglia di progetto per ogni progetto toccato + soglia d'area per ogni area toccata
  const scopes = [...new Set(clean.map(e => e.progettoId))].map(pid => [pid, null])
    .concat(clean.map(e => [e.progettoId, e.areaId]));
  const soglie = [];
  for (const [pid, aid] of scopes) {
    try { (await _checkThresholds(pid, aid, y, m - 1)).forEach(c => soglie.push(c)); }
    catch (err) { console.error('[threshold-alert]', err.message); soglie.push({ progettoId: pid, areaId: aid, status: 'error', error: err.message }); }
  }
  return { saved: clean.length, soglie };
}

// ── inserimento dall'app (dettaglio progetto): TL dell'area o TL del progetto ──
async function getTicketDay(p){
  if (!_isIsoDate(p.data)) throw new Error('Data non valida');
  return _ticketDayForTL(+p.risorsaId, [p.data], p.progettoId, true);
}
async function saveTickets(p){ return _saveTicketEntries(+p.risorsaId, p.data, p.entries, p.progettoId, true); }

// ── inserimento dal link email (nessun login: il token identifica TL e date) ──
async function getTicketsByToken(p){
  const { r, ds } = verifyTicketToken(p.token);
  return _ticketDayForTL(+r, ds);
}
async function saveTicketsByToken(p){
  const { r, ds } = verifyTicketToken(p.token);
  if (!ds.includes(p.data)) throw new Error('Data non coperta dal link ricevuto');
  return _saveTicketEntries(+r, p.data, p.entries);
}

// ════════════════════════════════════════════════════════════════════════
//  Controllo soglie + alert email (una sola volta per scope + mese + soglia)
//  Scope: progetto intero (areaId null) o singola area. Tipi: ticket (L1+L2+L3) ed Extra Effort (ore).
// ════════════════════════════════════════════════════════════════════════
const _r2 = n => Math.round(Number(n) * 100) / 100;
function _fmtOre(n) { return `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })} h`; }

// Totali del mese per lo scope: area → righe dell'area, progetto → tutte le righe del progetto
async function _scopeMonthTotals(progettoId, areaId, anno, mese){
  const [from, to] = _monthRange(anno, mese);
  const aid = areaId || null;
  const [[t], [e]] = await Promise.all([
    sql`SELECT COALESCE(SUM(l1),0)::int AS l1, COALESCE(SUM(l2),0)::int AS l2,
               COALESCE(SUM(l3),0)::int AS l3, COALESCE(SUM(totale),0)::int AS totale
        FROM ticket_giornalieri
        WHERE ((${aid}::int IS NULL AND progetto_id=${progettoId}) OR area_id=${aid})
          AND data BETWEEN ${from}::date AND ${to}::date`,
    sql`SELECT COALESCE(SUM(ore),0)::float AS ore, COUNT(*)::int AS n
        FROM extra_effort
        WHERE ((${aid}::int IS NULL AND progetto_id=${progettoId}) OR area_id=${aid})
          AND data BETWEEN ${from}::date AND ${to}::date`
  ]);
  return { ...t, ee_ore: _r2(e.ore), ee_n: e.n };
}

async function _checkThresholds(progettoId, areaId, anno, mese){
  const aid = areaId || null;
  const [cfg] = await sql`SELECT soglia, soglia_ee::float AS soglia_ee, attiva, destinatari FROM soglie_ticket
                          WHERE progetto_id=${progettoId} AND COALESCE(area_id, 0)=${aid || 0}`;
  if (!cfg || !cfg.attiva) return [];
  const tot = await _scopeMonthTotals(progettoId, aid, anno, mese);
  const scope = { progettoId, areaId: aid };
  const out = [];
  if (cfg.soglia)    out.push({ ...scope, kind: 'ticket', ...(await _claimAndAlert('ticket', scope, anno, mese, +cfg.soglia, tot, cfg.destinatari)) });
  if (cfg.soglia_ee) out.push({ ...scope, kind: 'ee',     ...(await _claimAndAlert('ee', scope, anno, mese, _r2(cfg.soglia_ee), tot, cfg.destinatari)) });
  return out;
}

async function _claimAndAlert(kind, scope, anno, mese, soglia, tot, extra){
  const totale = kind === 'ee' ? tot.ee_ore : tot.totale;
  if (totale < soglia) return { status: 'below', soglia, totale };
  const { progettoId, areaId } = scope;

  // "Prenota" l'invio: l'indice UNIQUE fa vincere un solo chiamante anche in caso di salvataggi concorrenti
  const [claim] = kind === 'ee'
    ? await sql`
        INSERT INTO ee_alert_log (progetto_id, area_id, anno, mese, soglia, totale, attivita)
        VALUES (${progettoId}, ${areaId}, ${anno}, ${mese}, ${soglia}, ${totale}, ${tot.ee_n})
        ON CONFLICT (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia) DO NOTHING
        RETURNING id`
    : await sql`
        INSERT INTO ticket_alert_log (progetto_id, area_id, anno, mese, soglia, totale, l1, l2, l3)
        VALUES (${progettoId}, ${areaId}, ${anno}, ${mese}, ${soglia}, ${totale}, ${tot.l1}, ${tot.l2}, ${tot.l3})
        ON CONFLICT (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia) DO NOTHING
        RETURNING id`;
  if (!claim) return { status: 'already_sent', soglia, totale };

  let res;
  try { res = await _sendThresholdAlert(kind, scope, anno, mese, soglia, tot, extra); }
  catch (err) { res = { sent: false, reason: 'error', error: err.message }; }
  if (res.sent) {
    if (kind === 'ee') await sql`UPDATE ee_alert_log SET stato='sent' WHERE id=${claim.id}`;
    else               await sql`UPDATE ticket_alert_log SET stato='sent' WHERE id=${claim.id}`;
  } else {
    // Invio non riuscito: rilascia la prenotazione così il prossimo salvataggio ritenta
    if (kind === 'ee') await sql`DELETE FROM ee_alert_log WHERE id=${claim.id}`;
    else               await sql`DELETE FROM ticket_alert_log WHERE id=${claim.id}`;
  }
  return { status: res.sent ? 'alert_sent' : 'alert_failed', reason: res.reason, soglia, totale };
}

async function _sendThresholdAlert(kind, scope, anno, mese, soglia, tot, extra){
  const GMAIL_USER = process.env.GMAIL_USER;
  const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;
  const FROM_NAME  = process.env.FROM_NAME || 'Team Hours Tracker';
  const SITE_URL   = (process.env.SITE_URL || '').replace(/\/$/, '');
  const { progettoId, areaId } = scope;
  const isEe = kind === 'ee';
  const [prj] = await sql`SELECT nome FROM progetti WHERE id=${progettoId}`;
  const [area] = areaId ? await sql`SELECT nome FROM aree WHERE id=${areaId}` : [null];
  const progetto = prj ? prj.nome : `#${progettoId}`;
  const areaNome = area ? area.nome : null;
  const scopeLabel = areaNome ? `${progetto} / ${areaNome}` : progetto;
  const meseLabel = `${_MESI_IT[mese]} ${anno}`;
  const tipoLog = isEe ? 'alert_soglia_ee' : 'alert_soglia_ticket';
  const subject = `[Alert soglia ${isEe ? 'Extra Effort' : 'ticket'}] ${scopeLabel} — ${meseLabel}`;
  const meta = isEe
    ? { progetto, area: areaNome, anno, mese, soglia, totale: tot.ee_ore, attivita: tot.ee_n }
    : { progetto, area: areaNome, anno, mese, soglia, totale: tot.totale, l1: tot.l1, l2: tot.l2, l3: tot.l3 };
  if (!GMAIL_USER || !GMAIL_PASS) {
    await _logEmail(tipoLog, '—', scopeLabel, subject, 'skipped', 'SMTP non configurato', meta);
    return { sent: false, reason: 'no_smtp' };
  }

  // TO: Team Lead dell'area (o di tutte le aree attive, se soglia di progetto) + Team Lead del progetto.
  // CC: manager di questi TL + destinatari extra configurati sulla soglia
  const tls = areaId
    ? await sql`
        SELECT r.id, r.full_name, r.email, r.manager_id
        FROM risorse r
        WHERE r.id IN (SELECT team_lead_id FROM aree WHERE id=${areaId} AND team_lead_id IS NOT NULL
                       UNION SELECT risorsa_id FROM progetto_team_leads WHERE progetto_id=${progettoId})
          AND r.email IS NOT NULL AND r.email <> ''`
    : await sql`
        SELECT r.id, r.full_name, r.email, r.manager_id
        FROM risorse r
        WHERE r.id IN (SELECT team_lead_id FROM aree WHERE progetto_id=${progettoId} AND attiva AND team_lead_id IS NOT NULL
                       UNION SELECT risorsa_id FROM progetto_team_leads WHERE progetto_id=${progettoId})
          AND r.email IS NOT NULL AND r.email <> ''`;
  const mgrIds = [...new Set(tls.map(t => t.manager_id).filter(Boolean))];
  const mgrs = mgrIds.length ? await sql`
    SELECT email FROM risorse WHERE id = ANY(${mgrIds}::int[]) AND email IS NOT NULL AND email <> ''` : [];
  const norm = e => String(e).trim().toLowerCase();
  const to = [...new Set(tls.map(t => norm(t.email)))];
  const extraList = String(extra || '').split(/[,;\s]+/).map(norm).filter(e => e.includes('@'));
  const cc = [...new Set([...mgrs.map(m => norm(m.email)), ...extraList])].filter(e => !to.includes(e));
  if (!to.length && !cc.length) {
    await _logEmail(tipoLog, '—', scopeLabel, subject, 'skipped', 'Nessun destinatario con email configurato', meta);
    return { sent: false, reason: 'no_recipients' };
  }
  // Senza TL con email, i destinatari in CC diventano principali
  const toFinal = to.length ? to : cc;
  const ccFinal = to.length ? cc : [];

  const link = `${SITE_URL}/?tab=andamento&prj=${progettoId}${areaId ? `&area=${areaId}` : ''}`;
  const content = _thresholdAlertContent(isEe, progetto, areaNome, meseLabel, soglia, tot, link);
  const mailer = _absenceTransporter();
  const logTo = toFinal.join(', ');
  const fullMeta = { ...meta, to: toFinal, cc: ccFinal };
  try {
    const info = await mailer.sendMail({
      from: `${FROM_NAME} <${GMAIL_USER}>`, to: toFinal, cc: ccFinal.length ? ccFinal : undefined, subject,
      html: _buildThresholdAlertHtml(content),
      text: _buildThresholdAlertText(content)
    });
    const rejected = info?.rejected || [];
    const accepted = info?.accepted || [];
    if (!accepted.length) {
      await _logEmail(tipoLog, logTo, scopeLabel, subject, 'error', 'Destinatari rifiutati da SMTP', { ...fullMeta, rejected });
      return { sent: false, reason: 'error' };
    }
    await _logEmail(tipoLog, logTo, scopeLabel, subject, 'sent', null,
                    { ...fullMeta, rejected, messageId: info?.messageId || null });
    return { sent: true, reason: 'ok' };
  } catch (err) {
    await _logEmail(tipoLog, logTo, scopeLabel, subject, 'error', err.message,
                    { ...fullMeta, code: err.code || null, responseCode: err.responseCode || null });
    return { sent: false, reason: 'error', error: err.message };
  }
}

// Contenuto dell'alert, condiviso fra versione HTML e testo
function _thresholdAlertContent(isEe, progetto, areaNome, meseLabel, soglia, tot, link) {
  const totale = isEe ? tot.ee_ore : tot.totale;
  const diff = _r2(totale - soglia);
  const unit = v => isEe ? _fmtOre(v) : `${v} ticket`;
  const subjectText = areaNome ? `L'area ${areaNome} del progetto ${progetto}` : `Il progetto ${progetto}`;
  const subjectHtml = areaNome ? `L'area <strong>${_esc(areaNome)}</strong> del progetto <strong>${_esc(progetto)}</strong>`
                               : `Il progetto <strong>${_esc(progetto)}</strong>`;
  const what = isEe ? 'la soglia mensile di Extra Effort configurata' : 'la soglia mensile configurata';
  const rows = isEe
    ? [['Mese', meseLabel], ['Soglia', unit(soglia)], ['Extra Effort registrato', unit(totale), true], ['Attività registrate', `${tot.ee_n}`]]
    : [['Mese', meseLabel], ['Soglia', unit(soglia)], ['Ticket registrati', `${totale}`, true],
       ['L1', `${tot.l1}`], ['L2', `${tot.l2}`], ['L3', `${tot.l3}`]];
  return {
    heading: isEe ? 'Alert – Soglia Extra Effort raggiunta' : 'Alert – Soglia ticket raggiunta',
    introText: `${subjectText} ha raggiunto ${what}.`,
    introHtml: `${subjectHtml} ha raggiunto ${what}.`,
    title: areaNome ? `${progetto} / ${areaNome}` : progetto,
    rows,
    diffMsg: diff === 0 ? 'La soglia è stata raggiunta.' : `La soglia è stata superata di ${unit(diff)}.`,
    link
  };
}

function _buildThresholdAlertText(c) {
  return [
    c.heading,
    '',
    c.introText,
    '',
    ...c.rows.map(([label, value]) => `${label}: ${value}`),
    '',
    c.diffMsg,
    '',
    'Accedi alla sezione Andamento progetto per visualizzare il dettaglio:',
    c.link,
    '',
    '---',
    'Messaggio automatico generato da Team Hours Tracker.'
  ].join('\n');
}

function _buildThresholdAlertHtml(c) {
  const row = (label, value, strong) => `
            <tr>
              <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#6b7280;" class="dm-label">${_esc(label)}</td>
              <td align="right" style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111827;font-weight:${strong ? 700 : 600};" class="dm-value">${_esc(value)}</td>
            </tr>`;
  return `<!DOCTYPE html>
<html lang="it" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${_esc(c.heading)} — ${_esc(c.title)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<style>table{border-collapse:collapse;}</style>
<![endif]-->
<style>
body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;}
table,td{mso-table-lspace:0pt;mso-table-rspace:0pt;}
@media(prefers-color-scheme:dark){
  .dm-outer{background-color:#1e1e2e!important;}
  .dm-card{background-color:#2a2a3e!important;}
  .dm-body{background-color:#2a2a3e!important;}
  .dm-foot{background-color:#222230!important;}
  .dm-title{color:#e8e8e8!important;}
  .dm-label{color:#aaaaaa!important;}
  .dm-value{color:#ffffff!important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:#f0f2f5;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" class="dm-outer" style="background-color:#f0f2f5;">
  <tr><td align="center" valign="top" style="padding:40px 16px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="dm-card" style="max-width:600px;width:100%;background-color:#ffffff;">
      <!-- HEADER -->
      <tr>
        <td align="center" bgcolor="#A100FF" style="background-color:#A100FF;padding:28px 40px;">
          <p style="margin:0;font-size:20px;font-weight:700;color:#ffffff;font-family:Arial,Helvetica,sans-serif;">Team Hours Tracker</p>
          <p style="margin:6px 0 0;font-size:13px;color:#e8c4ff;font-family:Arial,Helvetica,sans-serif;">${_esc(c.heading)}</p>
        </td>
      </tr>
      <!-- INTRO -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:32px 40px 16px;">
          <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;color:#111827;" class="dm-title">
            ${c.introHtml}
          </p>
        </td>
      </tr>
      <!-- DATI -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:0 40px 8px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;">
            ${c.rows.map(([label, value, strong]) => row(label, value, strong)).join('')}
          </table>
        </td>
      </tr>
      <!-- DIFFERENZA -->
      <tr>
        <td class="dm-body" style="background-color:#ffffff;padding:16px 40px 28px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fff1f2;border:1px solid #fecdd3;border-radius:6px;">
            <tr><td style="padding:12px 16px;">
              <p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:700;color:#be123c;">&#9888;&#65039; ${_esc(c.diffMsg)}</p>
            </td></tr>
          </table>
        </td>
      </tr>
      <!-- PULSANTE -->
      <tr>
        <td align="center" class="dm-body" style="background-color:#ffffff;padding:0 40px 32px;">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
            href="${c.link}" style="height:44px;v-text-anchor:middle;width:280px;" arcsize="11%" stroke="f" fillcolor="#A100FF">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;">APRI ANDAMENTO PROGETTO</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
            <tr>
              <td bgcolor="#A100FF" style="background-color:#A100FF;border-radius:5px;text-align:center;">
                <a href="${c.link}" style="display:inline-block;padding:13px 32px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:5px;">APRI ANDAMENTO PROGETTO</a>
              </td>
            </tr>
          </table>
          <!--<![endif]-->
        </td>
      </tr>
      <!-- FOOTER -->
      <tr>
        <td align="center" class="dm-foot" style="background-color:#f8f9fc;padding:18px 40px;border-top:1px solid #eeeeee;">
          <p style="margin:0;font-size:12px;color:#aaaaaa;font-family:Arial,Helvetica,sans-serif;">
            Messaggio automatico generato da Team Hours Tracker.<br>Non rispondere a questa email.
          </p>
        </td>
      </tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── routing: whitelist esplicita delle action consentite ──
const ACTIONS = {
  bootstrap, saveOre, deleteOre, saveFerie, deleteFerie, addProject, deleteProject, saveProjectLead, saveProjectWbs,
  addProjectTL, removeProjectTL,
  addResource, saveEdit, deleteResource, saveRep, deleteRep, getRepForProject,
  getPresenze, savePresenza, deletePresenza,
  userHasPwd, checkUserPwd, setUserPwd, resetUserPwd, checkAdminPwd, setAdminPwd,
  saveWbs, setResourceManager, toggleIsManager, saveRepTipi,
  getConsuntivo, saveConsuntivo, getEmailLog, setDailyReminder, sollecitaForecast,
  saveArea, deleteArea, getAndamento, saveSoglia, getTicketDay, saveTickets,
  getTicketsByToken, saveTicketsByToken
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
