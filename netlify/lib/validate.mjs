// ════════════════════════════════════════════════════════════════════════
//  Validazione minima dei payload: tipi e intervalli prima di arrivare alle query.
//  Ogni errore è un 400 con un messaggio leggibile per l'utente.
// ════════════════════════════════════════════════════════════════════════
import { HttpError } from './auth.mjs';

const bad = msg => { throw new HttpError(400, msg); };
const empty = v => v === null || v === undefined || v === '';

// Id numerico positivo (obbligatorio)
export function id(v, label = 'id') {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) bad(`${label} non valido`);
  return n;
}

export function int(v, label, min, max) {
  const n = Number(v);
  if (empty(v) || !Number.isInteger(n) || n < min || n > max) bad(`${label} non valido`);
  return n;
}

export const anno = v => int(v, 'Anno', 2000, 2100);
export const mese = v => int(v, 'Mese', 0, 11);   // 0-based, come nel client

// Numero facoltativo (vuoto = null) in [min, max]
export function optNum(v, label, min, max) {
  if (empty(v)) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) bad(`${label}: inserisci un numero tra ${min} e ${max}`);
  return n;
}

export function isoDate(v, label = 'Data') {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad(`${label} non valida`);
  const d = new Date(v + 'T00:00:00Z');
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) bad(`${label} non valida`);
  return v;
}

// Testo facoltativo (vuoto = null), tagliato e con lunghezza massima
export function optText(v, label, max) {
  if (empty(v)) return null;
  if (typeof v !== 'string' && typeof v !== 'number') bad(`${label} non valido`);
  const s = String(v).trim();
  if (s.length > max) bad(`${label}: massimo ${max} caratteri`);
  return s || null;
}

export function text(v, label, max) {
  const s = optText(v, label, max);
  if (!s) bad(`${label} obbligatorio`);
  return s;
}

export function optEmail(v) {
  const s = optText(v, 'Email', 254);
  if (s && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) bad('Email non valida');
  return s ? s.toLowerCase() : null;
}

export function oneOf(v, list, label) {
  if (!list.includes(v)) bad(`${label} non valido`);
  return v;
}

export function optTime(v, label) {
  if (empty(v)) return null;
  if (typeof v !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v)) bad(`${label} non valida (formato HH:MM)`);
  return v;
}

export function arr(v, label, max) {
  if (empty(v)) return [];
  if (!Array.isArray(v)) bad(`${label} non valido`);
  if (v.length > max) bad(`${label}: massimo ${max} elementi`);
  return v;
}
