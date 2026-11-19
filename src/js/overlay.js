// Rendu SVG de la superposition à l'échelle (1 unité SVG = 1 cm).

import { boardPath, boardSidePath, boardSideProfile, frontWingPath } from './shapes.js';
import { thumbnailUrl } from './data.js';
import { t } from './i18n.js';
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
    return { path: boardPath(s, model.outline, model.photoShape), width: s.widthCm, height: s.lengthCm };
  }
  // Aile avant ou stab : hauteur = corde + flèche (approx.)
  const c0 = s.chordMm / 10;
  return { path: frontWingPath(s), width: s.spanCm, height: c0 * 1.45 };
}

/**
 * @param {SVGSVGElement} svg
 * @param {Array<{model, size, color}>} entries éléments dessinables
 * @param {{ mode: 'overlay'|'side', align: 'tail'|'center'|'nose', fill: 'outline'|'photo' }} options
 *   fill 'photo' : la photo produit (vue de dessus), étirée aux dimensions de la taille choisie
 */
export function renderOverlay(svg, entries, { mode = 'overlay', align = 'tail', fill = 'outline' } = {}) {
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

  // Grille : 10 cm (boards, ailes avant) ou 2 cm (stabs, plus petits)
  const step = maxW < 60 ? 2 : 10;
  const major = step * 5;
  svg.dataset.grid = String(step);
  const grid = el('g', { class: 'grid', 'aria-hidden': 'true' });
  const x0 = -totalW / 2 - pad, x1 = totalW / 2 + pad;
  for (let y = 0; y <= maxH + 0.1; y += step) {
    grid.append(el('line', { x1: x0, x2: x1, y1: y, y2: y, class: y % major === 0 ? 'major' : '' }));
  }
  for (let x = 0; x <= x1; x += step) {
    for (const sx of x === 0 ? [0] : [x, -x]) {
      grid.append(el('line', { x1: sx, x2: sx, y1: -pad, y2: maxH + pad, class: x % major === 0 ? 'major' : '' }));
    }
  }
  svg.append(grid);

  // Échelle : barre de 50 cm (boards), 20 cm (ailes avant) ou 10 cm (stabs)
  const scaleLen = maxH > 120 ? 50 : maxW > 60 ? 20 : 10;
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
    group.append(title);
    const photo = fill === 'photo' ? photoImage(entry, g.path, i, mode) : null;
    if (photo) {
      group.classList.add('has-photo');
      group.append(...photo);
    }
    group.append(el('path', { d: g.path }));
    if (mode === 'side') {
      group.append(el('text', { x: 0, y: -pad * 0.5, 'text-anchor': 'middle', class: 'label' }, `${entry.size.size}${entry.model.year ? ` · ${entry.model.year}` : ''}`));
    }
    svg.append(group);
  });
}

/**
 * Photo produit placée à l'échelle : la vue de dessus de la photo (repérée par
 * extract_board_outlines.py) est étirée pour que son nez, son arrière et sa largeur
 * max tombent sur les cotes de la taille choisie, puis découpée selon le contour.
 * La photo ne montre souvent qu'une taille : pour les autres, c'est une mise à l'échelle.
 */
function photoImage(entry, path, i, mode) {
  const { model, size } = entry;
  const frame = model.photoShape?.photo;
  if (model.category !== 'board' || !frame || !model.image) return null;
  const s = size.spec;
  const sx = s.widthCm / 2 / frame.halfPx;
  const sy = s.lengthCm / frame.lengthPx;
  const id = `clip-${i}-${Math.random().toString(36).slice(2, 8)}`;
  const clip = el('clipPath', { id });
  clip.append(el('path', { d: path }));
  const img = el('image', {
    href: thumbnailUrl(model.image, 1200),
    x: -frame.axisX * sx,
    y: -frame.noseY * sy,
    width: frame.width * sx,
    height: frame.height * sy,
    preserveAspectRatio: 'none',
    'clip-path': `url(#${id})`,
    class: mode === 'overlay' ? 'photo photo-overlay' : 'photo',
  });
  return [clip, img];
}

/** Résumé textuel accessible de la superposition. */
export function describeOverlay(entries) {
  return entries
    .map(({ model, size }) => {
      const s = size.spec;
      return model.category === 'board'
        ? `${model.title} ${size.size}: ${formatNumber(s.lengthCm, 'cm')} × ${formatNumber(s.widthCm, 'cm')}`
        : `${model.title} ${size.size}: ${t('span')} ${formatNumber(s.spanCm, 'cm')}, ${t('chord')} ${formatNumber(s.chordMm, 'mm')}`;
    })
    .join(' ; ');
}

/**
 * Profils latéraux (épaisseur, rocker) des boards, nez à droite, à l'échelle.
 * @param {{ align: 'tail'|'center'|'nose', exaggeration: number }} options
 *   exaggeration : facteur appliqué à la hauteur seulement (1 = échelle réelle)
 */
export function renderProfile(svg, entries, { align = 'tail', exaggeration = 1 } = {}) {
  svg.replaceChildren();
  const sides = entries.map((e) => ({ entry: e, side: boardSideProfile(e.size.spec, e.model.photoShape) })).filter((x) => x.side);
  if (!sides.length) return;
  const maxL = Math.max(...sides.map(({ entry }) => entry.size.spec.lengthCm));
  const maxZ = Math.max(...sides.map(({ side }) => side.height)) * exaggeration;
  const pad = 6;
  const vbW = maxL + 2 * pad;
  const vbH = maxZ + 2 * pad + 6;
  svg.setAttribute('viewBox', `${-pad} ${-maxZ - pad} ${vbW} ${vbH}`);
  svg.style.aspectRatio = `${vbW} / ${vbH}`;
  svg.style.setProperty('--font', `${Math.max(3, vbW * 0.014)}px`);

  const grid = el('g', { class: 'grid', 'aria-hidden': 'true' });
  for (let x = 0; x <= maxL + 0.1; x += 10) {
    grid.append(el('line', { x1: x, x2: x, y1: -maxZ - pad, y2: pad, class: x % 50 === 0 ? 'major' : '' }));
  }
  for (let z = 0; z <= maxZ / exaggeration + 0.1; z += 5) {
    const y = -z * exaggeration;
    grid.append(el('line', { x1: -pad, x2: maxL + pad, y1: y, y2: y, class: z % 10 === 0 ? 'major' : '' }));
  }
  svg.append(grid);

  const scale = el('g', { class: 'scale' });
  scale.append(el('line', { x1: 0, x2: 20, y1: pad * 0.6, y2: pad * 0.6 }));
  scale.append(el('text', { x: 22, y: pad * 0.6, 'dominant-baseline': 'middle' },
    exaggeration === 1 ? '20 cm' : `20 cm · ${t('heightsX', { n: exaggeration })}`));
  svg.append(scale);

  for (const { entry, side } of sides) {
    const L = entry.size.spec.lengthCm;
    // Le nez est à droite : aligner sur l'arrière = x de départ 0.
    const dx = align === 'tail' ? 0 : align === 'center' ? (maxL - L) / 2 : maxL - L;
    const group = el('g', { class: 'shape', 'data-id': entry.size.id, transform: `translate(${dx} 0) scale(1 ${exaggeration})`, style: `--c:${entry.color}` });
    group.append(el('title', {}, `${entry.model.title} ${entry.size.size}`), el('path', { d: boardSidePath(side) }));
    svg.append(group);
  }
}
