import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canDraw, mergeBrand, modelYear, priceIn, shortTitle } from '../src/js/data.js';

const read = (p) => JSON.parse(readFileSync(new URL(`../data/${p}`, import.meta.url)));
const brand = read('brands.json').brands[0];
const models = mergeBrand(brand, read('gong/catalog.json'), read('gong/specs.json'), read('gong/outlines.json'));

test('chaque produit avec specs est dessinable ou complet pour toutes ses tailles publiées', () => {
  const problems = [];
  for (const m of models.filter((x) => x.hasSpecs)) {
    for (const s of m.sizes) {
      const missing = m.category === 'wing' ? !s.spec.spanCm : !canDraw({ category: m.category, spec: s.spec });
      if (missing) problems.push(`${m.handle} ${s.size}`);
    }
  }
  // Une seule taille vendue sans tableau publié (stab Ypra Surf-Freestyle XS).
  assert.ok(problems.length <= 1, problems.join(', '));
});

test('les prix existent dans les trois devises', () => {
  for (const cur of ['CHF', 'EUR', 'USD']) {
    const priced = models.flatMap((m) => m.sizes).filter((s) => priceIn(s, cur) != null).length;
    assert.ok(priced > 300, `${cur}: ${priced}`);
  }
});

test('niveaux et wings : longueur de bôme et vent', () => {
  assert.ok(models.every((m) => ['beginner', 'advanced', 'pro'].includes(m.level)));
  const droid = models.find((m) => m.handle === 'gong-wing-droid-27');
  const s5 = droid.sizes.find((s) => s.size === '5 m²');
  assert.equal(s5.spec.boomLengthCm, 105.5);
  assert.equal(s5.spec.windMinKts, 11);
  assert.equal(s5.spec.aspectRatio, undefined); // recopié seulement par loadAll
});

test('utilitaires', () => {
  assert.equal(shortTitle('Foil Stab Fluid V3 Atmo - Perf Series'), 'Fluid V3 Atmo - Perf Series');
  assert.equal(modelYear('gong-wing-neutra-26nhnb'), 2026);
  assert.equal(modelYear('gong-foil-front-wing-fluid-atmo'), null);
});
