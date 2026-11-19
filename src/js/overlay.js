// Rendu SVG de la superposition à l'échelle (1 unité SVG = 1 cm).

import { boardPath, frontWingPath } from './shapes.js';
import { formatNumber } from './units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Boîte englobante (cm) et chemin d'un élément sélectionné. */
function geometry(entry) {
  const { model, size } = entry;
  const s = size.spec;
  if (model.category === 'board') {
    return { path: boardPath(s, model.outline), width: s.widthCm, height: s.lengthCm };
  }
  // Aile avant : hauteur = corde + flèche (approx.)
  const c0 = s.chordMm / 10;
  return { path: frontWingPath(s), width: s.spanCm, height: c0 * 1.45 };
}

/**
 * @param {SVGSVGElement} svg
 * @param {Array<{model, size, color}>} entries éléments dessinables
 * @param {{ mode: 'overlay'|'side', align: 'tail'|'center'|'nose' }} options
 */
export function renderOverlay(svg, entries, { mode = 'overlay', align = 'tail' } = {}) {
  svg.replaceChildren();
  if (!entries.length) return;

  const geos = entries.map(geometry);
  const gap = 12;
  const maxW = Math.max(...geos.map((g) => g.width));
  const maxH = Math.max(...geos.map((g) => g.height));
  const totalW = mode === 'side' ? geos.reduce((a, g) => a + g.width, 0) + gap * (geos.length - 1) : maxW;
  const pad = Math.max(8, maxH * 0.06);
  const labelSpace = mode === 'side' ? pad * 1.6 : 0;
  const vbW = totalW + 2 * pad;
  const vbH = maxH + 2 * pad + labelSpace;
  svg.setAttribute('viewBox', `${-totalW / 2 - pad} ${-pad - labelSpace} ${vbW} ${vbH}`);
  svg.style.aspectRatio = `${vbW} / ${vbH}`;
  svg.style.setProperty('--font', `${Math.max(vbW, vbH) * 0.016}px`);

  // Grille de 10 cm
  const grid = el('g', { class: 'grid', 'aria-hidden': 'true' });
  const x0 = -totalW / 2 - pad, x1 = totalW / 2 + pad;
  for (let y = 0; y <= maxH + 0.1; y += 10) {
    grid.append(el('line', { x1: x0, x2: x1, y1: y, y2: y, class: y % 50 === 0 ? 'major' : '' }));
  }
  for (let x = 0; x <= x1; x += 10) {
    for (const sx of x === 0 ? [0] : [x, -x]) {
      grid.append(el('line', { x1: sx, x2: sx, y1: -pad, y2: maxH + pad, class: x % 50 === 0 ? 'major' : '' }));
    }
  }
  svg.append(grid);

  // Échelle : barre de 50 cm (ou 20 cm pour les foils)
  const scaleLen = maxH > 120 ? 50 : 20;
  const scale = el('g', { class: 'scale' });
  const sy = maxH + pad * 0.55;
  scale.append(el('line', { x1: x0 + pad * 0.3, x2: x0 + pad * 0.3 + scaleLen, y1: sy, y2: sy }));
  scale.append(el('text', { x: x0 + pad * 0.3 + scaleLen + 2, y: sy, 'dominant-baseline': 'middle' }, `${scaleLen} cm`));
  svg.append(scale);

  let cursor = -totalW / 2;
  entries.forEach((entry, i) => {
    const g = geos[i];
    let dx = 0;
    if (mode === 'side') {
      dx = cursor + g.width / 2;
      cursor += g.width + gap;
    }
    let dy = 0;
    if (entry.model.category === 'board') {
      if (align === 'tail') dy = maxH - g.height;
      else if (align === 'center') dy = (maxH - g.height) / 2;
    }
    const group = el('g', { class: 'shape', 'data-id': entry.size.id, transform: `translate(${dx} ${dy})`, style: `--c:${entry.color}` });
    const title = el('title', {}, `${entry.model.title} ${entry.size.size}`);
    group.append(title, el('path', { d: g.path }));
    if (mode === 'side') {
      group.append(el('text', { x: 0, y: -pad * 0.5, 'text-anchor': 'middle', class: 'label' }, `${entry.size.size}`));
    }
    svg.append(group);
  });
}

/** Résumé textuel accessible de la superposition. */
export function describeOverlay(entries) {
  return entries
    .map(({ model, size }) => {
      const s = size.spec;
      return model.category === 'board'
        ? `${model.title} ${size.size} : ${formatNumber(s.lengthCm, 'cm')} × ${formatNumber(s.widthCm, 'cm')}`
        : `${model.title} ${size.size} : envergure ${formatNumber(s.spanCm, 'cm')}, corde ${formatNumber(s.chordMm, 'mm')}`;
    })
    .join(' ; ');
}
