// Génération de silhouettes vectorielles à l'échelle (unité : cm).
// Les marques ne publient pas de plan de forme : on reconstruit une silhouette
// plausible à partir des cotes publiées. Les dimensions clés (longueur, largeur,
// largeurs à 1 pied, envergure, corde, surface) sont respectées ; le dessin entre
// ces points est une interpolation lissée, donc approximative.

import { OFO_CM } from './units.js';

/**
 * Demi-largeurs d'une board le long de son axe (y = 0 au nez, y = L à l'arrière).
 * @returns {Array<[number, number]>} liste de points [y, demiLargeur]
 */
export function boardHalfWidthProfile({ lengthCm, widthCm, ofoNoseCm, ofoTailCm }, outline = {}) {
  const L = lengthCm;
  const W = widthCm / 2;
  // Sans cotes OFO, on prend des valeurs typiques de boards de wingfoil.
  const nose = (ofoNoseCm ?? widthCm * 0.82) / 2;
  const tail = (ofoTailCm ?? widthCm * 0.84) / 2;
  const pointed = outline.nose === 'pointed';
  const tailShape = outline.tail ?? 'square';
  const tailEnd = tailShape === 'diamond' ? tail * 0.3 : tailShape === 'squash' ? tail * 0.75 : tail * 0.85;
  const wideAt = L * 0.52; // point le plus large, proche du milieu

  // Points de contrôle (y croissant). Les cotes publiées sont exactes ; les points
  // intermédiaires du nez et de l'arrière donnent l'arrondi.
  const pts = [
    [0, 0],
    [OFO_CM * (pointed ? 0.1 : 0.06), nose * (pointed ? 0.38 : 0.55)],
    [OFO_CM * 0.4, nose * (pointed ? 0.8 : 0.88)],
    [OFO_CM, nose],
    [wideAt, W],
    [L - OFO_CM, tail],
    [L - OFO_CM * 0.25, (tail + tailEnd) / 2 + (tail - tailEnd) * 0.25],
    [L, tailEnd],
  ];
  // L'interpolation monotone ne dépasse jamais les points : la largeur max reste W.
  return monotoneCubic(pts, 24);
}

/**
 * Interpolation cubique monotone (Fritsch–Carlson) de x = f(y).
 * Pas d'oscillation ni de dépassement entre les points de contrôle.
 */
export function monotoneCubic(points, samplesPerSegment = 16) {
  const n = points.length;
  const ys = points.map((p) => p[0]);
  const xs = points.map((p) => p[1]);
  const h = [], d = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(ys[i + 1] - ys[i]);
    d.push((xs[i + 1] - xs[i]) / h[i]);
  }
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  const out = [];
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < samplesPerSegment; k++) {
      const t = k / samplesPerSegment, t2 = t * t, t3 = t2 * t;
      const x = (2 * t3 - 3 * t2 + 1) * xs[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
        + (-2 * t3 + 3 * t2) * xs[i + 1] + (t3 - t2) * h[i] * m[i + 1];
      out.push([ys[i] + t * h[i], x]);
    }
  }
  out.push(points[n - 1]);
  return out;
}

/** Chemin SVG fermé d'une board, nez en haut, centré sur x = 0. */
export function boardPath(spec, outline) {
  const half = boardHalfWidthProfile(spec, outline);
  const right = half.map(([y, x]) => `${x.toFixed(2)},${y.toFixed(2)}`);
  const left = [...half].reverse().map(([y, x]) => `${(-x).toFixed(2)},${y.toFixed(2)}`);
  return `M${right.join(' L')} L${left.join(' L')} Z`;
}

/**
 * Exposant p de la superellipse c(y) = c0·(1 − |2y/b|^p)^(1/p) qui donne la
 * surface publiée. p = 2 → ellipse (surface = π/4·b·c0).
 */
export function solvePlanformExponent(spanCm, rootChordCm, areaCm2) {
  const target = areaCm2 / (spanCm * rootChordCm);
  const fraction = (p) => {
    const n = 400;
    let s = 0;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      s += Math.pow(1 - Math.pow(t, p), 1 / p);
    }
    return s / n;
  };
  let lo = 1, hi = 30;
  if (target <= fraction(lo)) return lo;
  if (target >= fraction(hi)) return hi;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (fraction(mid) < target) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Chemin SVG d'une aile avant vue de dessus (bord d'attaque en haut), centrée sur x = 0.
 * spanCm, chordMm (corde à l'emplanture), areaCm2.
 */
export function frontWingPath({ spanCm, chordMm, areaCm2 }) {
  const b = spanCm;
  const c0 = chordMm / 10;
  const p = areaCm2 ? solvePlanformExponent(b, c0, areaCm2) : 2;
  const sweep = c0 * 0.35; // flèche visuelle des saumons (n'affecte pas la surface)
  const n = 60;
  const le = [], te = [];
  for (let i = 0; i <= n; i++) {
    const t = -1 + (2 * i) / n; // −1 .. 1 sur l'envergure
    const chord = c0 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), p)), 1 / p);
    const offset = sweep * t * t;
    const x = (t * b) / 2;
    le.push([x, offset + (c0 - chord) * 0.3]);
    te.push([x, offset + (c0 - chord) * 0.3 + chord]);
  }
  const fmt = ([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`;
  return `M${le.map(fmt).join(' L')} L${te.reverse().map(fmt).join(' L')} Z`;
}
