// Tableau comparatif des specs. La première colonne sélectionnée sert de référence
// pour les écarts en %.

import { SPEC_FIELDS } from './data.js';
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
  span.title = 'Écart par rapport à la référence (1re colonne)';
  return span;
}

/**
 * @param {HTMLTableElement} table
 * @param {string} category
 * @param {Array<{model, size, color}>} entries
 * @param {(id: string) => void} onRemove
 */
export function renderTable(table, category, entries, onRemove) {
  table.replaceChildren();
  if (!entries.length) return;

  const thead = table.createTHead();
  const head = thead.insertRow();
  head.append(cell('th', 'Caractéristique', 'row-head'));
  entries.forEach(({ model, size, color }, i) => {
    const th = cell('th');
    th.scope = 'col';
    th.style.setProperty('--c', color);
    const name = cell('a', model.title, 'col-title');
    name.href = model.url;
    name.target = '_blank';
    name.rel = 'noopener';
    const meta = cell('div', `${model.brandName} · ${size.size}${i === 0 ? ' · référence' : ''}`, 'col-meta');
    const remove = cell('button', '×', 'remove');
    remove.type = 'button';
    remove.setAttribute('aria-label', `Retirer ${model.title} ${size.size}`);
    remove.addEventListener('click', () => onRemove(size.id));
    th.append(cell('span', '', 'swatch'), name, meta, remove);
    head.append(th);
  });

  const body = table.createTBody();
  const ref = entries[0];

  const priceRow = body.insertRow();
  priceRow.append(cell('th', 'Prix', 'row-head'));
  entries.forEach(({ model, size }) => {
    const td = cell('td', formatPrice(size.price, model.currency));
    if (size.price != null) {
      const badge = deltaBadge(size.price, ref.size.price);
      if (badge) td.append(' ', badge);
      if (!size.available) td.append(cell('div', 'rupture / non listé', 'muted'));
    }
    priceRow.append(td);
  });

  const constrRow = body.insertRow();
  constrRow.append(cell('th', 'Construction', 'row-head'));
  entries.forEach(({ model }) => constrRow.append(cell('td', model.construction ?? '—')));

  for (const field of SPEC_FIELDS[category]) {
    const values = entries.map((e) => e.size.spec[field.key]);
    if (values.every((v) => v == null)) continue;
    const row = body.insertRow();
    const th = cell('th', field.label, 'row-head');
    if (field.derived) th.append(cell('span', ' (calculé)', 'muted'));
    row.append(th);
    values.forEach((v) => {
      const td = cell('td', formatNumber(v, field.unit));
      const badge = deltaBadge(v, values[0]);
      if (badge) td.append(' ', badge);
      row.append(td);
    });
  }
}
