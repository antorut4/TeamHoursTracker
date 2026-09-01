-- ════════════════════════════════════════════════════════════════════════
--  Team Hours Tracker — Migration: Daily Hours Reminder
--  Eseguire UNA SOLA VOLTA su Neon Console → SQL Editor
-- ════════════════════════════════════════════════════════════════════════

-- 1. Tabella ore giornaliere (fonte dati consuntivo — separata da ore_mensili/forecast)
CREATE TABLE IF NOT EXISTS daily_hours (
    id         BIGSERIAL    PRIMARY KEY,
    risorsa_id INTEGER      NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
    data       DATE         NOT NULL,
    ore        NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP    DEFAULT NOW(),
    updated_at TIMESTAMP    DEFAULT NOW(),
    UNIQUE (risorsa_id, data)
);

-- 2. Rimuovi trigger di sincronizzazione (forecast e consuntivo sono separati)
DROP TRIGGER IF EXISTS trg_sync_ore_mensili ON daily_hours;
DROP FUNCTION IF EXISTS sync_ore_mensili_from_daily();

SELECT 'Migration completata' AS status;
