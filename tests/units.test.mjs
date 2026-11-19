import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feetInchesToCm, parseNumericSize, sizeSortKey, relativeDelta } from '../src/js/units.js';

test('feetInchesToCm convertit les tailles de board', () => {
  assert.equal(feetInchesToCm("5'4").toFixed(1), '162.6');
  assert.equal(feetInchesToCm("4’11").toFixed(1), '149.9');
  assert.equal(feetInchesToCm("6'0").toFixed(1), '182.9');
  assert.equal(feetInchesToCm('M'), null);
});

test('parseNumericSize lit les surfaces', () => {
  assert.equal(parseNumericSize('4,5 m²'), 4.5);
  assert.equal(parseNumericSize('480 cm²'), 480);
  assert.equal(parseNumericSize('XL'), null);
});

test('sizeSortKey ordonne lettres et pieds', () => {
  const letters = ['XL', '3XS', 'M', 'XXS', '3XL'].sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
  assert.deepEqual(letters, ['3XS', 'XXS', 'M', 'XL', '3XL']);
  const feet = ["5'10", "5'2", "4'11"].sort((a, b) => sizeSortKey(a) - sizeSortKey(b));
  assert.deepEqual(feet, ["4'11", "5'2", "5'10"]);
});

test('relativeDelta', () => {
  assert.equal(relativeDelta(110, 100), 10);
  assert.equal(relativeDelta(5, 0), null);
  assert.equal(relativeDelta(null, 3), null);
});
