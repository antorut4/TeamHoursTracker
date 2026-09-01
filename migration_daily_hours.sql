-- ════════════════════════════════════════════════════════════════════════
--  Team Hours Tracker — Migration: Daily Hours Reminder
--  Eseguire UNA SOLA VOLTA su Neon Console → SQL Editor
-- ════════════════════════════════════════════════════════════════════════

-- 1. Tabella ore giornaliere
CREATE TABLE IF NOT EXISTS daily_hours (
    id         BIGSERIAL    PRIMARY KEY,
    risorsa_id INTEGER      NOT NULL REFERENCES risorse(id) ON DELETE CASCADE,
    data       DATE         NOT NULL,
    ore        NUMERIC(5,2) NOT NULL,
    created_at TIMESTAMP    DEFAULT NOW(),
    updated_at TIMESTAMP    DEFAULT NOW(),
    UNIQUE (risorsa_id, data)
);

-- 2. Funzione trigger: ricalcola ore_q1/ore_q2 in ore_mensili
CREATE OR REPLACE FUNCTION sync_ore_mensili_from_daily()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
    v_risorsa_id INTEGER;
    v_anno       INTEGER;
    v_mese       INTEGER;
    v_ore_q1     NUMERIC;
    v_ore_q2     NUMERIC;
BEGIN
    IF TG_OP = 'DELETE' THEN
        v_risorsa_id := OLD.risorsa_id;
        v_anno       := EXTRACT(YEAR  FROM OLD.data)::INTEGER;
        v_mese       := EXTRACT(MONTH FROM OLD.data)::INTEGER;
    ELSE
        v_risorsa_id := NEW.risorsa_id;
        v_anno       := EXTRACT(YEAR  FROM NEW.data)::INTEGER;
        v_mese       := EXTRACT(MONTH FROM NEW.data)::INTEGER;
    END IF;

    -- Ricalcolo completo e idempotente per l'intero mese
    SELECT
        COALESCE(SUM(CASE WHEN EXTRACT(DAY FROM data) <= 15 THEN ore ELSE 0 END), 0),
        COALESCE(SUM(CASE WHEN EXTRACT(DAY FROM data) >  15 THEN ore ELSE 0 END), 0)
    INTO v_ore_q1, v_ore_q2
    FROM daily_hours
    WHERE risorsa_id = v_risorsa_id
      AND EXTRACT(YEAR  FROM data) = v_anno
      AND EXTRACT(MONTH FROM data) = v_mese;

    -- Upsert: note_q1 e note_q2 non vengono mai toccate
    INSERT INTO ore_mensili (risorsa_id, anno, mese, ore_q1, note_q1, ore_q2, note_q2)
    VALUES (v_risorsa_id, v_anno, v_mese, v_ore_q1, NULL, v_ore_q2, NULL)
    ON CONFLICT (risorsa_id, anno, mese)
    DO UPDATE SET
        ore_q1 = EXCLUDED.ore_q1,
        ore_q2 = EXCLUDED.ore_q2;

    RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3. Trigger (idempotente)
DROP TRIGGER IF EXISTS trg_sync_ore_mensili ON daily_hours;
CREATE TRIGGER trg_sync_ore_mensili
AFTER INSERT OR UPDATE OR DELETE ON daily_hours
FOR EACH ROW EXECUTE FUNCTION sync_ore_mensili_from_daily();

SELECT 'Migration completata' AS status;
