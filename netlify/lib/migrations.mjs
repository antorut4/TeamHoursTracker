// ════════════════════════════════════════════════════════════════════════
//  Migrazioni dello schema, versionate in schema_migrations.
//  Prima giravano a ogni bootstrap (~30 DDL per ogni apertura dell'app); ora ogni versione
//  viene applicata una sola volta, in transazione, con un advisory lock che serializza
//  eventuali avvii concorrenti. Le istruzioni restano idempotenti: rieseguirle è innocuo.
//  Per una modifica di schema: aggiungere una nuova voce in fondo, mai modificare quelle esistenti.
// ════════════════════════════════════════════════════════════════════════

const LOCK_ID = 724001;

export const MIGRATIONS = [
  {
    version: 1,
    name: 'baseline: schema creato in passato da bootstrap/ensureTicketSchema',
    up: sql => [
      sql`CREATE TABLE IF NOT EXISTS progetto_team_leads (
        progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
        risorsa_id  INTEGER NOT NULL REFERENCES risorse(id)  ON DELETE CASCADE,
        PRIMARY KEY (progetto_id, risorsa_id)
      )`,
      sql`INSERT INTO progetto_team_leads (progetto_id, risorsa_id)
        SELECT id, team_lead_id FROM progetti WHERE team_lead_id IS NOT NULL
        ON CONFLICT DO NOTHING`,
      sql`ALTER TABLE ferie ADD COLUMN IF NOT EXISTS ora_inizio TEXT`,
      sql`ALTER TABLE ferie ADD COLUMN IF NOT EXISTS ora_fine TEXT`,
      sql`ALTER TABLE ferie DROP CONSTRAINT IF EXISTS ferie_tipo_check`,
      sql`ALTER TABLE ferie ADD CONSTRAINT ferie_tipo_check CHECK (tipo IN ('Ferie', 'Malattia', 'Permesso/ROL'))`,
      sql`ALTER TABLE reperibilita ADD COLUMN IF NOT EXISTS etichetta TEXT DEFAULT ''`,
      sql`ALTER TABLE reperibilita DROP CONSTRAINT IF EXISTS reperibilita_risorse_id_progetto_id_anno_mese_key`,
      sql`ALTER TABLE reperibilita DROP CONSTRAINT IF EXISTS reperibilita_risorsa_id_progetto_id_anno_mese_key`,
      sql`DROP INDEX IF EXISTS reperibilita_risorse_id_progetto_id_anno_mese_key`,
      sql`DROP INDEX IF EXISTS reperibilita_risorsa_id_progetto_id_anno_mese_key`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS rep_unique_per_turno ON reperibilita (risorsa_id, progetto_id, anno, mese, COALESCE(etichetta,''))`,
      sql`CREATE TABLE IF NOT EXISTS daily_hours (
        id         BIGSERIAL    PRIMARY KEY,
        risorsa_id INTEGER      NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
        data       DATE         NOT NULL,
        ore        NUMERIC(5,2) NOT NULL,
        created_at TIMESTAMP    DEFAULT NOW(),
        updated_at TIMESTAMP    DEFAULT NOW(),
        UNIQUE (risorsa_id, data)
      )`,
      sql`CREATE TABLE IF NOT EXISTS email_log (
        id           BIGSERIAL PRIMARY KEY,
        tipo         TEXT NOT NULL,
        destinatario TEXT NOT NULL,
        nome         TEXT,
        oggetto      TEXT,
        stato        TEXT NOT NULL,
        errore       TEXT,
        meta         JSONB,
        created_at   TIMESTAMP DEFAULT NOW()
      )`,
      sql`CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC)`,
      // Reminder giornaliero: attivo di default per tutti (anche per le righe già esistenti)
      sql`ALTER TABLE risorse ADD COLUMN IF NOT EXISTS daily_reminder BOOLEAN NOT NULL DEFAULT TRUE`,
      // Employee number aziendale (facoltativo), usato nell'export Excel della reperibilità
      sql`ALTER TABLE risorse ADD COLUMN IF NOT EXISTS employee_id TEXT`,

      // ── Andamento progetto ──
      // Aree: ogni area appartiene a un solo progetto, con un Team Lead responsabile
      sql`CREATE TABLE IF NOT EXISTS aree (
        id           SERIAL  PRIMARY KEY,
        progetto_id  INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
        nome         TEXT    NOT NULL,
        team_lead_id INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
        attiva       BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMP DEFAULT NOW(),
        UNIQUE (progetto_id, nome)
      )`,
      // Ticket giornalieri: dato originale, mai sostituito dagli aggregati.
      // progetto_id è denormalizzato: lo storico resta sul progetto anche se l'area viene spostata.
      sql`CREATE TABLE IF NOT EXISTS ticket_giornalieri (
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
      )`,
      sql`CREATE INDEX IF NOT EXISTS ticket_giornalieri_prj_data_idx ON ticket_giornalieri (progetto_id, data)`,
      // Soglia mensile per progetto (sul totale L1+L2+L3). destinatari = email extra in CC, separate da virgola
      sql`CREATE TABLE IF NOT EXISTS soglie_ticket (
        progetto_id INTEGER PRIMARY KEY REFERENCES progetti(id) ON DELETE CASCADE,
        soglia      INTEGER NOT NULL CHECK (soglia > 0),
        attiva      BOOLEAN NOT NULL DEFAULT TRUE,
        destinatari TEXT,
        updated_by  INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
        updated_at  TIMESTAMP DEFAULT NOW()
      )`,
      // Registro alert: il vincolo UNIQUE garantisce un solo invio per progetto + mese + soglia
      sql`CREATE TABLE IF NOT EXISTS ticket_alert_log (
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
      )`,
      // soglie_ticket diventa la tabella unica delle soglie: area_id NULL = soglia di progetto,
      // area_id valorizzato = soglia della singola area. soglia (ticket) e soglia_ee (ore) sono facoltative.
      sql`ALTER TABLE soglie_ticket ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES aree(id) ON DELETE CASCADE`,
      sql`ALTER TABLE soglie_ticket ADD COLUMN IF NOT EXISTS soglia_ee NUMERIC(8,2) CHECK (soglia_ee > 0)`,
      sql`ALTER TABLE soglie_ticket ALTER COLUMN soglia DROP NOT NULL`,
      sql`ALTER TABLE soglie_ticket DROP CONSTRAINT IF EXISTS soglie_ticket_pkey`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS soglie_ticket_scope_uq ON soglie_ticket (progetto_id, (COALESCE(area_id, 0)))`,
      // Alert ticket anche per area: la deduplicazione include l'area (0 = livello progetto)
      sql`ALTER TABLE ticket_alert_log ADD COLUMN IF NOT EXISTS area_id INTEGER REFERENCES aree(id) ON DELETE CASCADE`,
      sql`ALTER TABLE ticket_alert_log DROP CONSTRAINT IF EXISTS ticket_alert_log_progetto_id_anno_mese_soglia_key`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS ticket_alert_log_scope_uq ON ticket_alert_log (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia)`,
      // Extra Effort: più attività per area e giorno, ognuna con descrizione e ore (progetto_id denormalizzato)
      sql`CREATE TABLE IF NOT EXISTS extra_effort (
        id          BIGSERIAL PRIMARY KEY,
        area_id     INTEGER NOT NULL REFERENCES aree(id) ON DELETE CASCADE,
        progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
        data        DATE    NOT NULL,
        attivita    TEXT    NOT NULL,
        ore         NUMERIC(6,2) NOT NULL CHECK (ore > 0),
        inserito_da INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
        created_at  TIMESTAMP DEFAULT NOW()
      )`,
      // Tipologia: 'extra' = ore (colonna ore); 'cr' = CR da scalare a Plafond in Man Day (colonna md)
      sql`ALTER TABLE extra_effort ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'extra'`,
      sql`ALTER TABLE extra_effort ADD COLUMN IF NOT EXISTS md NUMERIC(6,2) CHECK (md > 0)`,
      sql`ALTER TABLE extra_effort ALTER COLUMN ore DROP NOT NULL`,
      sql`ALTER TABLE extra_effort DROP CONSTRAINT IF EXISTS extra_effort_tipo_ck`,
      sql`ALTER TABLE extra_effort ADD CONSTRAINT extra_effort_tipo_ck CHECK (
        (tipo = 'extra' AND ore IS NOT NULL AND md IS NULL) OR (tipo = 'cr' AND md IS NOT NULL AND ore IS NULL))`,
      sql`CREATE INDEX IF NOT EXISTS extra_effort_prj_data_idx ON extra_effort (progetto_id, data)`,
      sql`CREATE INDEX IF NOT EXISTS extra_effort_area_data_idx ON extra_effort (area_id, data)`,
      // Registro alert Extra Effort: un solo invio per scope + mese + soglia
      sql`CREATE TABLE IF NOT EXISTS ee_alert_log (
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
      )`,
      sql`CREATE UNIQUE INDEX IF NOT EXISTS ee_alert_log_scope_uq ON ee_alert_log (progetto_id, (COALESCE(area_id, 0)), anno, mese, soglia)`,
      // Classificazione facoltativa dei ticket del giorno (livello › categoria › attività)
      sql`CREATE TABLE IF NOT EXISTS ticket_classificazioni (
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
      )`,
      sql`CREATE INDEX IF NOT EXISTS ticket_class_prj_data_idx ON ticket_classificazioni (progetto_id, data)`
    ]
  },
  {
    version: 2,
    name: 'login_attempts: limite ai tentativi di login falliti',
    up: sql => [
      sql`CREATE TABLE IF NOT EXISTS login_attempts (
        id         BIGSERIAL PRIMARY KEY,
        chiave     TEXT      NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`,
      sql`CREATE INDEX IF NOT EXISTS login_attempts_chiave_idx ON login_attempts (chiave, created_at)`
    ]
  },
  {
    version: 3,
    name: 'password: colonne VARCHAR troppo corte per gli hash scrypt (~116 caratteri) portate a TEXT',
    // Su Neon utenti_pwd.pwd_hash era VARCHAR(50), sufficiente solo per il vecchio hash del browser.
    // Si convertono solo le colonne VARCHAR: se sono già TEXT non cambia nulla.
    up: sql => [
      sql`DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                   AND table_name = 'utenti_pwd' AND column_name = 'pwd_hash' AND data_type = 'character varying') THEN
          ALTER TABLE utenti_pwd ALTER COLUMN pwd_hash TYPE TEXT;
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema()
                   AND table_name = 'config' AND column_name = 'valore' AND data_type = 'character varying') THEN
          ALTER TABLE config ALTER COLUMN valore TYPE TEXT;
        END IF;
      END $$`
    ]
  },
  {
    version: 4,
    name: 'job_runs: al massimo un\'esecuzione al giorno per i reminder schedulati',
    up: sql => [
      sql`CREATE TABLE IF NOT EXISTS job_runs (
        job        TEXT      NOT NULL,
        giorno     DATE      NOT NULL,
        started_at TIMESTAMP NOT NULL DEFAULT NOW(),
        PRIMARY KEY (job, giorno)
      )`
    ]
  },
  {
    version: 5,
    name: 'password_invites: primo accesso e reset solo tramite link monouso via email',
    up: sql => [
      sql`CREATE TABLE IF NOT EXISTS password_invites (
        risorsa_id INTEGER   PRIMARY KEY REFERENCES risorse(id) ON DELETE CASCADE,
        nonce      TEXT      NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )`
    ]
  },
  {
    version: 6,
    name: 'risorse.is_senior: Senior Manager, eredita i team dei manager associati',
    up: sql => [
      sql`ALTER TABLE risorse ADD COLUMN IF NOT EXISTS is_senior BOOLEAN NOT NULL DEFAULT FALSE`,
      sql`UPDATE risorse SET is_manager = TRUE WHERE is_senior AND NOT is_manager`
    ]
  }
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

// Applica le migrazioni mancanti; ritorna le versioni applicate
export async function migrate(sql) {
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER   PRIMARY KEY,
    name       TEXT      NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`;
  const done = new Set((await sql`SELECT version FROM schema_migrations`).map(r => +r.version));
  const applied = [];
  for (const m of MIGRATIONS) {
    if (done.has(m.version)) continue;
    await sql.transaction([
      sql`SELECT pg_advisory_xact_lock(${LOCK_ID})`,
      ...m.up(sql),
      sql`INSERT INTO schema_migrations (version, name) VALUES (${m.version}, ${m.name}) ON CONFLICT (version) DO NOTHING`
    ]);
    applied.push(m.version);
  }
  return applied;
}

// Una sola verifica per istanza della function (cold start); in caso di errore si ritenta alla richiesta successiva
let _ready = null;
export function ensureSchema(sql) {
  if (!_ready) _ready = migrate(sql).catch(e => { _ready = null; throw e; });
  return _ready;
}
