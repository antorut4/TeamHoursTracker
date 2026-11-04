// Indirizzo pubblico del sito, usato per i link nelle email (inviti, reminder, solleciti, alert).
// SITE_URL deve essere un indirizzo web completo (https://…); se manca o non è valido
// (per esempio il server SMTP incollato per errore) si usa URL, fornito da Netlify.
export function siteUrl() {
  const clean = v => String(v || '').trim().replace(/\/+$/, '');
  const ok = v => /^https?:\/\/[^\s/]+/i.test(v) && !/^https?:\/\/smtp\./i.test(v);
  const custom = clean(process.env.SITE_URL);
  if (ok(custom)) return custom;
  if (custom) console.warn(JSON.stringify({ level: 'warn', error: 'SITE_URL non valido, uso URL di Netlify', siteUrl: custom }));
  const netlify = clean(process.env.URL);
  return ok(netlify) ? netlify : '';
}
