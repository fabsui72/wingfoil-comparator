// Génération de silhouettes vectorielles à l'échelle (unité : cm).
// Les marques ne publient pas de plan de forme. Deux sources possibles :
//  - boards : la forme extraite des photos produits (scripts/extract_board_outlines.py),
//    recalée sur les cotes officielles (longueur, largeur, largeurs à 1 pied, épaisseur) ;
//  - sinon : une forme reconstruite par interpolation entre les cotes publiées.
// Les cotes publiées sont toujours respectées ; le reste est une estimation.

import { OFO_CM } from './units.js';

/**
 * Demi-largeurs d'une board le long de son axe (y = 0 au nez, y = L à l'arrière).
 * @returns {Array<[number, number]>} liste de points [y, demiLargeur]
 */
export function boardHalfWidthProfile(spec, outline = {}, photo = null) {
  if (photo?.top?.length) return photoHalfWidthProfile(spec, photo);
  return estimatedHalfWidthProfile(spec, outline);
}

/** Valeur interpolée linéairement d'un profil échantillonné régulièrement sur [0, 1]. */
export function sampleAt(values, t) {
  const i = Math.min(Math.max(t, 0), 1) * (values.length - 1);
  const k = Math.min(Math.floor(i), values.length - 2);
  const f = i - k;
  return values[k] * (1 - f) + values[k + 1] * f;
}

/**
 * Forme issue de la photo, mise à l'échelle (longueur, largeur max) puis recalée pour
 * passer exactement par les largeurs à 1 pied publiées : on multiplie la photo par un
 * facteur de correction qui vaut 1 au maître-bau et varie doucement vers le nez et l'arrière.
 */
export function photoHalfWidthProfile({ lengthCm: L, widthCm, ofoNoseCm, ofoTailCm }, photo) {
  const W = widthCm / 2;
  const top = photo.top;
  const sWide = top.indexOf(Math.max(...top)) / (top.length - 1);
  const sNose = OFO_CM / L;
  const sTail = 1 - OFO_CM / L;
  const rNose = ofoNoseCm ? ofoNoseCm / 2 / (sampleAt(top, sNose) * W) : 1;
  const rTail = ofoTailCm ? ofoTailCm / 2 / (sampleAt(top, sTail) * W) : 1;
  const corr = monotoneCubic([[0, rNose], [sNose, rNose], [sWide, 1], [sTail, rTail], [1, rTail]], 40);
  return top.map((h, i) => {
    const s = i / (top.length - 1);
    const y = s * L;
    return [y, Math.min(h * W * interpolateY(corr, s), W)];
  });
}

/** Ordonnée d'une polyligne [[x, y]...] (x croissant) à l'abscisse x. */
function interpolateY(points, x) {
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/**
 * Profil latéral (pont et dessous) depuis la photo, en cm : x = distance depuis le nez,
 * z = hauteur au-dessus du point le plus bas. L'échelle verticale est recalée pour que
 * l'épaisseur maximale soit exactement l'épaisseur publiée.
 * @returns {{ deck: Array<[number, number]>, bottom: Array<[number, number]>, height: number } | null}
 */
export function boardSideProfile({ lengthCm: L, thicknessCm }, photo) {
  if (!photo?.deck?.length || !thicknessCm) return null;
  const t = photo.deck.map((d, i) => d - photo.bottom[i]);
  const k = thicknessCm / (Math.max(...t) * L);
  const n = photo.deck.length - 1;
  const deck = photo.deck.map((v, i) => [(i / n) * L, v * L * k]);
  const bottom = photo.bottom.map((v, i) => [(i / n) * L, v * L * k]);
  return { deck, bottom, height: Math.max(...deck.map(([, z]) => z)) };
}

/** Chemin SVG fermé du profil latéral, nez à droite, pont en haut (z vers le haut = y négatif). */
export function boardSidePath(side) {
  const fmt = ([x, z]) => `${x.toFixed(2)},${(-z).toFixed(2)}`;
  // x = 0 au nez -> on retourne pour avoir le nez à droite
  const L = side.deck[side.deck.length - 1][0];
  const flip = ([x, z]) => [L - x, z];
  const top = side.deck.map(flip);
  const bot = [...side.bottom].reverse().map(flip);
  return `M${top.map(fmt).join(' L')} L${bot.map(fmt).join(' L')} Z`;
}

/** Forme estimée à partir des seules cotes (sans photo). */
export function estimatedHalfWidthProfile({ lengthCm, widthCm, ofoNoseCm, ofoTailCm }, outline = {}) {
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
export function boardPath(spec, outline, photo = null) {
  const half = boardHalfWidthProfile(spec, outline, photo);
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
  let lo = 0.6, hi = 30; // p < 1 : bords concaves (ailes très effilées)
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
