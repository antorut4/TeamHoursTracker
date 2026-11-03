-- Tabelle di base create a mano su Neon all'avvio del progetto (non gestite dalle migrazioni):
-- ricostruite dalle query di db.mjs, servono solo ai test.
CREATE TABLE risorse (
  id         SERIAL PRIMARY KEY,
  nome       TEXT NOT NULL,
  cognome    TEXT NOT NULL,
  full_name  TEXT GENERATED ALWAYS AS (nome || ' ' || cognome) STORED,
  email      TEXT,
  manager_id INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
  is_manager BOOLEAN NOT NULL DEFAULT FALSE,
  load_cost  NUMERIC
);
CREATE TABLE progetti (
  id           SERIAL PRIMARY KEY,
  nome         TEXT NOT NULL UNIQUE,
  wbs          TEXT,
  team_lead_id INTEGER REFERENCES risorse(id) ON DELETE SET NULL
);
CREATE TABLE allocazioni (
  risorsa_id  INTEGER NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
  progetto_id INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
  PRIMARY KEY (risorsa_id, progetto_id)
);
CREATE TABLE ore_mensili (
  id         SERIAL PRIMARY KEY,
  risorsa_id INTEGER NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
  anno       INTEGER NOT NULL,
  mese       INTEGER NOT NULL,
  ore_q1     NUMERIC, note_q1 TEXT,
  ore_q2     NUMERIC, note_q2 TEXT,
  UNIQUE (risorsa_id, anno, mese)
);
CREATE TABLE ferie (
  id          SERIAL PRIMARY KEY,
  risorsa_id  INTEGER NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
  data_inizio DATE NOT NULL,
  data_fine   DATE NOT NULL,
  tipo        TEXT NOT NULL,
  note        TEXT
);
CREATE TABLE reperibilita (
  id           SERIAL PRIMARY KEY,
  risorsa_id   INTEGER NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
  progetto_id  INTEGER NOT NULL REFERENCES progetti(id) ON DELETE CASCADE,
  team_lead_id INTEGER REFERENCES risorse(id) ON DELETE SET NULL,
  anno         INTEGER NOT NULL,
  mese         INTEGER NOT NULL,
  giorni       JSONB NOT NULL DEFAULT '[]',
  UNIQUE (risorsa_id, progetto_id, anno, mese)
);
CREATE TABLE presenze (
  risorsa_id INTEGER NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
  data       DATE NOT NULL,
  UNIQUE (risorsa_id, data)
);
CREATE TABLE utenti_pwd (
  risorsa_id INTEGER PRIMARY KEY REFERENCES risorse(id) ON DELETE CASCADE,
  pwd_hash   TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE config (
  chiave TEXT PRIMARY KEY,
  valore TEXT
);
