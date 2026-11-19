import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingKeys, t, setLang } from '../src/js/i18n.js';

globalThis.document ??= { documentElement: {} };

test('toutes les clés existent en français et en anglais', () => {
  assert.deepEqual(missingKeys(), []);
});

test('t() remplace les variables et change de langue', () => {
  setLang('en');
  assert.equal(t('maxReached', { n: 6 }), 'You can compare up to 6 items.');
  setLang('fr');
  assert.equal(t('maxReached', { n: 6 }), 'Maximum 6 éléments à comparer.');
  assert.equal(t('cle.inconnue'), 'cle.inconnue');
});
