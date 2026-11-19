// Conversions et formatage — fonctions pures, sans dépendance au DOM.

export const CM_PER_INCH = 2.54;
export const OFO_CM = 30.48; // "One Foot Off" : mesure prise à 1 pied (30,48 cm) du nez / de l'arrière

/** "5'4" -> 162.56 cm ; renvoie null si le libellé n'est pas au format pieds'pouces. */
export function feetInchesToCm(label) {
  const m = /^\s*(\d+)\s*['’′]\s*(\d+(?:[.,]\d+)?)?\s*(?:["”″])?\s*$/.exec(String(label));
  if (!m) return null;
  const feet = Number(m[1]);
  const inches = m[2] ? Number(m[2].replace(',', '.')) : 0;
  return (feet * 12 + inches) * CM_PER_INCH;
}

/** "4,5 m²" -> 4.5 ; "480 cm²" -> 480 ; "M" -> null */
export function parseNumericSize(label) {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(m²|cm²|m2|cm2)?\s*$/i.exec(String(label));
  return m ? Number(m[1].replace(',', '.')) : null;
}

const LETTER_ORDER = ['5XS', '4XS', '3XS', 'XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL'];

/** Clé de tri commune pour toutes les tailles (pieds, lettres, nombres). */
export function sizeSortKey(label) {
  const cm = feetInchesToCm(label);
  if (cm !== null) return cm;
  const idx = LETTER_ORDER.indexOf(String(label).trim().toUpperCase());
  if (idx >= 0) return idx;
  const n = parseNumericSize(label);
  return n ?? Number.POSITIVE_INFINITY;
}

let locale = 'fr-CH';
let nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

/** Change la langue de formatage des nombres (ex. 'fr-CH', 'en-GB'). */
export function setNumberLocale(value) {
  locale = value;
  nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
}

export function formatNumber(value, unit = '') {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return unit ? `${nf.format(value)} ${unit}` : nf.format(value);
}

export function formatPrice(value, currency = 'CHF') {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

/** Écart relatif signé en % ; null si la référence est absente ou nulle. */
export function relativeDelta(value, reference) {
  if (value == null || reference == null || reference === 0) return null;
  return ((value - reference) / reference) * 100;
}
