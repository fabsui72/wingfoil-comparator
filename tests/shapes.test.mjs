import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boardHalfWidthProfile, boardPath, frontWingPath, solvePlanformExponent } from '../src/js/shapes.js';
import { OFO_CM } from '../src/js/units.js';

const specs = JSON.parse(readFileSync(new URL('../data/gong/specs.json', import.meta.url)));

/** Demi-largeur interpolée à la position y. */
function halfWidthAt(profile, y) {
  for (let i = 1; i < profile.length; i++) {
    const [y0, x0] = profile[i - 1];
    const [y1, x1] = profile[i];
    if ((y0 <= y && y <= y1) && y1 !== y0) return x0 + ((x1 - x0) * (y - y0)) / (y1 - y0);
  }
  return null;
}

test('la silhouette des boards respecte les cotes publiées', () => {
  for (const [key, model] of Object.entries(specs.models)) {
    if (model.category !== 'board') continue;
    for (const s of model.sizes) {
      const profile = boardHalfWidthProfile(s, model.outline);
      const maxHalf = Math.max(...profile.map(([, x]) => x));
      const ys = profile.map(([y]) => y);
      assert.ok(Math.abs(maxHalf * 2 - s.widthCm) < 0.5, `${key} ${s.size} largeur ${maxHalf * 2} vs ${s.widthCm}`);
      assert.ok(Math.abs(Math.max(...ys) - s.lengthCm) < 0.01, `${key} ${s.size} longueur`);
      assert.ok(Math.abs(halfWidthAt(profile, OFO_CM) * 2 - s.ofoNoseCm) < 1, `${key} ${s.size} OFO nez`);
      assert.ok(Math.abs(halfWidthAt(profile, s.lengthCm - OFO_CM) * 2 - s.ofoTailCm) < 1, `${key} ${s.size} OFO arrière`);
      assert.match(boardPath(s, model.outline), /^M[\d.,\- L]+Z$/);
    }
  }
});

test("la superellipse du foil retrouve la surface publiée", () => {
  for (const [key, model] of Object.entries(specs.models)) {
    if (model.category !== 'frontwing') continue;
    for (const s of model.sizes) {
      const c0 = s.chordMm / 10;
      const p = solvePlanformExponent(s.spanCm, c0, s.areaCm2);
      // intégration numérique de la corde le long de l'envergure
      const n = 2000;
      let area = 0;
      for (let i = 0; i < n; i++) {
        const t = -1 + (2 * (i + 0.5)) / n;
        area += c0 * Math.pow(1 - Math.pow(Math.abs(t), p), 1 / p) * (s.spanCm / n);
      }
      const target = Math.min(Math.max(s.areaCm2, 0), s.spanCm * c0);
      const tolerance = p === 1 ? 0.25 : 0.02; // p borné à 1 : surface publiée < losange
      assert.ok(Math.abs(area - target) / target < tolerance, `${key} ${s.size}: ${area.toFixed(0)} vs ${target}`);
      assert.match(frontWingPath(s), /^M[\d.,\- L]+Z$/);
    }
  }
});

test('chaque produit relié pointe vers un modèle existant', () => {
  for (const [handle, key] of Object.entries(specs.products)) {
    assert.ok(specs.models[key], `${handle} -> ${key} introuvable`);
  }
});
