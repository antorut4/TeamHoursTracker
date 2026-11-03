// ════════════════════════════════════════════════════════════════════════
//  Protezione dei job schedulati (reminder email). Le background function possono essere
//  raggiungibili anche via URL e la richiesta non permette di distinguere con certezza
//  lo scheduler di Netlify da un estraneo: per questo ogni job parte al massimo una volta
//  al giorno e solo nella fascia oraria della sua schedulazione (08:00 UTC, lun-ven).
//  Nel caso peggiore un estraneo anticipa l'invio legittimo, ma non può ripeterlo.
// ════════════════════════════════════════════════════════════════════════
export const JOB_WINDOW_UTC = [6, 11];   // ore UTC ammesse, estremi inclusi

// { ok: true } se il job può partire; altrimenti { ok: false, reason }
export async function claimDailyRun(sql, job, now = new Date()) {
  const h = now.getUTCHours();
  if (h < JOB_WINDOW_UTC[0] || h > JOB_WINDOW_UTC[1])
    return { ok: false, reason: `Fuori fascia oraria (${JOB_WINDOW_UTC[0]}-${JOB_WINDOW_UTC[1]} UTC): esecuzione rifiutata` };
  const giorno = now.toISOString().slice(0, 10);
  const rows = await sql`INSERT INTO job_runs (job, giorno) VALUES (${job}, ${giorno}::date)
                         ON CONFLICT (job, giorno) DO NOTHING RETURNING job`;
  return rows.length ? { ok: true } : { ok: false, reason: 'Già eseguito oggi: esecuzione duplicata rifiutata' };
}
