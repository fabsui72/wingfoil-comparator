// Tableau comparatif des specs. La première colonne sélectionnée sert de référence
// pour les écarts en %.

import { SPEC_FIELDS, compareAtIn, discountPct, priceIn, thumbnailUrl } from './data.js';
import { t } from './i18n.js';
import { formatNumber, formatPrice, relativeDelta } from './units.js';

function cell(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function deltaBadge(value, reference) {
  const d = relativeDelta(value, reference);
  if (d === null || Math.abs(d) < 0.05) return null;
  const span = cell('span', `${d > 0 ? '+' : '−'}${formatNumber(Math.abs(d))} %`, 'delta');
  span.title = t('deltaTitle');
  return span;
}

/** Valeur numérique comparée et texte affiché d'un champ, pour une taille. */
function fieldValue(field, spec, ctx) {
  if (field.range) {
    const [lo, hi] = field.range.map((k) => spec[k]);
    if (lo == null) return { value: null, text: '—' };
    const unit = t('u.kts');
    return { value: lo, text: hi == null ? `${formatNumber(lo)} → max ${unit}` : `${formatNumber(lo)}–${formatNumber(hi)} ${unit}` };
  }
  if (field.key === 'pricePerM2') {
    const price = priceIn(ctx.size, ctx.currency);
    const v = price != null && spec.areaM2 ? Math.round(price / spec.areaM2) : null;
    return { value: v, text: v == null ? '—' : `${formatPrice(v, ctx.currency)}/m²` };
  }
  const v = spec[field.key];
  let text = formatNumber(v, field.unit);
  if (field.extra && spec[field.extra] && v != null) text += ` (${spec[field.extra]})`;
  return { value: v ?? null, text };
}

/**
 * @param {HTMLTableElement} table
 * @param {string} category
 * @param {Array<{model, size, color}>} entries
 * @param {{ currency: string, onRemove: (id: string) => void }} options
 */
export function renderTable(table, category, entries, { currency, onRemove }) {
  table.replaceChildren();
  if (!entries.length) return;

  const thead = table.createTHead();
  const head = thead.insertRow();
  head.append(cell('th', t('feature'), 'row-head'));
  entries.forEach(({ model, size, color }, i) => {
    const th = cell('th');
    th.scope = 'col';
    th.style.setProperty('--c', color);
    if (model.image) {
      const img = cell('img', undefined, 'col-photo');
      img.src = thumbnailUrl(model.image, 360);
      img.alt = '';
      img.decoding = 'async';
      th.append(img);
    }
    const name = cell('a', model.title, 'col-title');
    name.href = model.urls?.[currency] ?? model.url;
    name.target = '_blank';
    name.rel = 'noopener';
    const meta = cell('div', `${model.brandName}${model.year ? ` ${model.year}` : ''} · ${size.size}${i === 0 ? ` · ${t('reference')}` : ''}`, 'col-meta');
    const remove = cell('button', '×', 'remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', t('remove', { name: `${model.title} ${size.size}` }));
    remove.addEventListener('click', () => onRemove(size.id));
    th.append(name, meta, remove);
    head.append(th);
  });

  const body = table.createTBody();
  const addRow = (label, cells, note) => {
    const row = body.insertRow();
    const th = cell('th', label, 'row-head');
    if (note) th.append(cell('span', note, 'muted'));
    row.append(th);
    for (const c of cells) row.append(c);
  };

  // Prix
  const refPrice = priceIn(entries[0].size, currency);
  addRow(t('price'), entries.map(({ size }) => {
    const price = priceIn(size, currency);
    const td = cell('td', formatPrice(price, currency));
    if (price != null) {
      const before = compareAtIn(size, currency);
      if (before) {
        td.prepend(cell('span', `−${discountPct(size, currency)} %`, 'sale'), ' ');
        td.append(' ', cell('s', formatPrice(before, currency), 'muted'));
      }
      const badge = deltaBadge(price, refPrice);
      if (badge) td.append(' ', badge);
      if (!size.available) td.append(cell('div', t('unavailable'), 'muted'));
    }
    return td;
  }));

  // Niveau, série, construction
  const levelCells = entries.map(({ model }) => {
    const td = cell('td');
    if (model.level) td.append(cell('span', t(`level.${model.level}`), `level level-${model.level}`));
    else td.textContent = '—';
    return td;
  });
  addRow(t('level'), levelCells);
  addRow(t('year'), entries.map(({ model }) => cell('td', model.year ?? '—')));
  if (entries.some((e) => e.model.series)) addRow(t('series'), entries.map(({ model }) => cell('td', model.series ?? '—')));
  addRow(t('construction'), entries.map(({ model }) => cell('td', model.construction ?? '—')));
  if (entries.some((e) => e.model.programs.length)) {
    addRow(t('program'), entries.map(({ model }) => cell('td', model.programs.map((p) => t(`program.${p}`)).join(', ') || '—')));
  }

  // Dimensions
  for (const field of SPEC_FIELDS[category]) {
    const vals = entries.map(({ size }) => fieldValue(field, size.spec, { size, currency }));
    if (vals.every((v) => v.value == null)) continue;
    addRow(t(`f.${field.key}`), vals.map((v) => {
      const td = cell('td', v.text);
      const badge = field.range ? null : deltaBadge(v.value, vals[0].value);
      if (badge) td.append(' ', badge);
      return td;
    }), field.derived ? t('computed') : undefined);
  }

  if (category === 'board') {
    addRow(t('shapeSource'), entries.map(({ model }) => cell('td', model.photoShape ? t('shapePhoto') : t('shapeEstimated'))));
  }
  if (entries.some((e) => e.model.sourceChart)) {
    addRow(t('sourceChart'), entries.map(({ model }) => {
      const td = cell('td');
      if (model.sourceChart) {
        const a = cell('a', t('openChart'));
        a.href = model.sourceChart;
        a.target = '_blank';
        a.rel = 'noopener';
        td.append(a);
      } else td.textContent = '—';
      return td;
    }));
  }
}
