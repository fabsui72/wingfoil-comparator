// Rendu SVG des comparaisons à l'échelle (1 unité SVG = 1 cm).
//
//  - renderOverlay : vue de dessus (boards, ailes avant, stabs), trait ou photo ;
//  - renderProfile : profil des boards (épaisseur, rocker), trait ou photo ;
//  - renderFront   : vue de face des foils (photo à l'échelle de l'envergure).
//
// Mise à l'échelle des photos : les scripts d'extraction repèrent, dans chaque photo
// produit, la position de la vue utile (nez, arrière, axe, largeur max pour les boards ;
// cadre de l'aile pour les foils). La photo est ensuite étirée pour que ces repères
// tombent sur les cotes officielles de la taille choisie.

import { thumbnailUrl } from './data.js';
import { t } from './i18n.js';
import { boardPath, boardSidePath, boardSideProfile, frontWingPath } from './shapes.js';
import { formatNumber } from './units.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
let uid = 0;

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

function clipPath(defs, d) {
  const id = `clip${++uid}`;
  const clip = el('clipPath', { id });
  clip.append(typeof d === 'string' ? el('path', { d }) : d);
  defs.append(clip);
  return `url(#${id})`;
}

/** Photo produit, au format image SVG, avec une transformation donnée. */
function photoNode(url, attrs) {
  const node = el('image', { href: thumbnailUrl(url, 1500), preserveAspectRatio: 'none', ...attrs });
  // Photos JPG (fond blanc) : fusion « multiply » pour effacer le fond.
  if (/\.jpe?g$/i.test(url)) node.classList.add('photo-jpg');
  return node;
}

// --------------------------------------------------------------------------------- //
// Vue de dessus                                                                       //
// --------------------------------------------------------------------------------- //

/** Photo de dessus d'un foil exploitable pour cette entrée ? */
export function foilTopView(model) {
  return model.foilViews?.top ?? null;
}

/** Boîte englobante (cm) et chemin d'un élément sélectionné. */
function geometry(entry, fill) {
  const { model, size } = entry;
  const s = size.spec;
  if (model.category === 'board') {
    return { path: boardPath(s, model.outline, model.photoShape), width: s.widthCm, height: s.lengthCm };
  }
  const view = fill !== 'outline' ? foilTopView(model) : null;
  if (view) {
    // Photo de l'aile : largeur du cadre = envergure ; on garde l'aile, pas le mât.
    const k = s.spanCm / (view.bbox[2] - view.bbox[0]);
    const top = view.wing[0] - 0.01;
    return { photo: view, k, top, width: s.spanCm, height: k * (view.bbox[3] - top) };
  }
  const c0 = s.chordMm / 10;
  return { path: frontWingPath(s), width: s.spanCm, height: c0 * 1.45 };
}

/** Repère (en pixels) de la face choisie dans la photo d'une board. */
function boardFrame(photo, face) {
  return face === 'bottom' && photo.bottom ? { ...photo, ...photo.bottom } : photo;
}

/** Photo(s) de la board étirée(s) aux dimensions de la taille, découpée(s) selon le contour. */
function boardPhoto(defs, entry, path, fill, mode) {
  const { model, size } = entry;
  const photo = model.photoShape?.photo;
  if (!photo || !model.image) return null;
  const s = size.spec;
  const outlineClip = clipPath(defs, path);
  const place = (face) => {
    const f = boardFrame(photo, face);
    const sx = s.widthCm / 2 / f.halfPx;
    const sy = s.lengthCm / f.lengthPx;
    return photoNode(model.image, {
      x: -f.axisX * sx, y: -f.noseY * sy, width: photo.width * sx, height: photo.height * sy,
      'clip-path': outlineClip, class: mode === 'overlay' ? 'photo photo-overlay' : 'photo',
    });
  };
  if (fill !== 'half') return [place(fill === 'bottom' ? 'bottom' : 'top')];
  // Moitié gauche = dessus, moitié droite = dessous
  const half = (x) => {
    const g = el('g', { 'clip-path': clipPath(defs, el('rect', { x, y: -1, width: s.widthCm / 2 + 1, height: s.lengthCm + 2 })) });
    return g;
  };
  const left = half(-s.widthCm / 2 - 1);
  left.append(place('top'));
  const right = half(0);
  right.append(place('bottom'));
  return [left, right, el('line', { x1: 0, x2: 0, y1: 0, y2: s.lengthCm, class: 'half-line' })];
}

/** Photo de dessus d'un foil, cadrée sur l'aile. */
function foilPhoto(defs, entry, g, mode) {
  const { photo: v, k, top, width, height } = g;
  const cx = (v.bbox[0] + v.bbox[2]) / 2;
  const clip = clipPath(defs, el('rect', { x: -width / 2, y: 0, width, height }));
  return [photoNode(v.src, {
    x: -cx * k, y: -top * k, width: k, height: k * v.aspect,
    'clip-path': clip, class: mode === 'overlay' ? 'photo photo-overlay' : 'photo',
  })];
}

/**
 * @param {SVGSVGElement} svg
 * @param {Array<{model, size, color}>} entries éléments dessinables
 * @param {{ mode: 'overlay'|'side', align: 'tail'|'center'|'nose', fill: 'outline'|'top'|'bottom'|'half' }} options
 */
export function renderOverlay(svg, entries, { mode = 'overlay', align = 'tail', fill = 'outline' } = {}) {
  svg.replaceChildren();
  if (!entries.length) return;
  const defs = el('defs');
  svg.append(defs);

  const geos = entries.map((e) => geometry(e, fill));
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
    group.append(el('title', {}, `${entry.model.title} ${entry.size.size}`));
    let photo = null;
    if (fill !== 'outline') {
      photo = entry.model.category === 'board' ? boardPhoto(defs, entry, g.path, fill, mode) : g.photo ? foilPhoto(defs, entry, g, mode) : null;
    }
    if (photo) {
      group.classList.add('has-photo');
      group.append(...photo);
    }
    if (g.path) group.append(el('path', { d: g.path }));
    else group.append(el('rect', { x: -g.width / 2, y: 0, width: g.width, height: g.height, class: 'frame' }));
    if (mode === 'side') {
      group.append(el('text', { x: 0, y: -pad * 0.5, 'text-anchor': 'middle', class: 'label' },
        `${entry.size.size}${entry.model.year ? ` · ${entry.model.year}` : ''}`));
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
        ? `${model.title} ${size.size}: ${formatNumber(s.lengthCm, 'cm')} × ${formatNumber(s.widthCm, 'cm')}`
        : `${model.title} ${size.size}: ${t('span')} ${formatNumber(s.spanCm, 'cm')}, ${t('chord')} ${formatNumber(s.chordMm, 'mm')}`;
    })
    .join(' ; ');
}

// --------------------------------------------------------------------------------- //
// Profil des boards                                                                   //
// --------------------------------------------------------------------------------- //

/**
 * Photo de profil placée sur le profil : dans la photo, la board est verticale (nez en
 * haut, pont à gauche). Une rotation la couche, nez à droite, pont en haut ; les échelles
 * sont celles du profil (longueur officielle, épaisseur officielle).
 */
function sidePhoto(defs, entry, side, path) {
  const { model, size } = entry;
  const photo = model.photoShape?.photo;
  const shape = model.photoShape;
  if (!photo?.side || !model.image) return null;
  const L = size.spec.lengthCm;
  const n = photo.side.lengthPx;
  const maxT = Math.max(...shape.deck.map((d, i) => d - shape.bottom[i]));
  const sx = L / n; // cm par pixel le long de la board
  const sz = size.spec.thicknessCm / (maxT * n); // cm par pixel dans l'épaisseur
  // X = L - (py - noseY)·sx ; Y (SVG, vers le bas) = (px - refX)·sz
  const m = [0, sz, -sx, 0, L + photo.side.noseY * sx, -photo.side.refX * sz];
  // La découpe est posée sur un groupe : sur l'image elle-même, elle serait
  // interprétée dans le repère tourné de l'image.
  const g = el('g', { 'clip-path': clipPath(defs, path) });
  g.append(photoNode(model.image, {
    x: 0, y: 0, width: photo.width, height: photo.height, transform: `matrix(${m.join(' ')})`, class: 'photo',
  }));
  return g;
}

/**
 * Profils latéraux (épaisseur, rocker) des boards, nez à droite, à l'échelle.
 * @param {{ align: 'tail'|'center'|'nose', exaggeration: number, photo: boolean }} options
 *   exaggeration : facteur appliqué à la hauteur seulement (1 = échelle réelle)
 */
export function renderProfile(svg, entries, { align = 'tail', exaggeration = 1, photo = false } = {}) {
  svg.replaceChildren();
  const sides = entries.map((e) => ({ entry: e, side: boardSideProfile(e.size.spec, e.model.photoShape) })).filter((x) => x.side);
  if (!sides.length) return;
  const defs = el('defs');
  svg.append(defs);
  const maxL = Math.max(...sides.map(({ entry }) => entry.size.spec.lengthCm));
  const maxZ = Math.max(...sides.map(({ side }) => side.height)) * exaggeration;
  const pad = 6;
  const stacked = photo && sides.length > 1; // photos : une ligne par board
  const rowH = maxZ + pad;
  const vbW = maxL + 2 * pad;
  const vbH = (stacked ? rowH * sides.length : maxZ) + 2 * pad + 6;
  svg.setAttribute('viewBox', `${-pad} ${-maxZ - pad} ${vbW} ${vbH}`);
  svg.style.aspectRatio = `${vbW} / ${vbH}`;
  svg.style.setProperty('--font', `${Math.max(3, vbW * 0.014)}px`);

  const bottomY = stacked ? rowH * (sides.length - 1) : 0;
  const grid = el('g', { class: 'grid', 'aria-hidden': 'true' });
  for (let x = 0; x <= maxL + 0.1; x += 10) {
    grid.append(el('line', { x1: x, x2: x, y1: -maxZ - pad, y2: bottomY + pad, class: x % 50 === 0 ? 'major' : '' }));
  }
  for (let r = 0; r < (stacked ? sides.length : 1); r++) {
    for (let z = 0; z <= maxZ / exaggeration + 0.1; z += 5) {
      const y = r * rowH - z * exaggeration;
      grid.append(el('line', { x1: -pad, x2: maxL + pad, y1: y, y2: y, class: z % 10 === 0 ? 'major' : '' }));
    }
  }
  svg.append(grid);

  const scale = el('g', { class: 'scale' });
  const sy = bottomY + pad * 0.6;
  scale.append(el('line', { x1: 0, x2: 20, y1: sy, y2: sy }));
  scale.append(el('text', { x: 22, y: sy, 'dominant-baseline': 'middle' },
    exaggeration === 1 ? '20 cm' : `20 cm · ${t('heightsX', { n: exaggeration })}`));
  svg.append(scale);

  sides.forEach(({ entry, side }, r) => {
    const L = entry.size.spec.lengthCm;
    // Le nez est à droite : aligner sur l'arrière = x de départ 0.
    const dx = align === 'tail' ? 0 : align === 'center' ? (maxL - L) / 2 : maxL - L;
    const dyRow = stacked ? r * rowH : 0;
    const group = el('g', { class: 'shape', 'data-id': entry.size.id, transform: `translate(${dx} ${dyRow}) scale(1 ${exaggeration})`, style: `--c:${entry.color}` });
    const d = boardSidePath(side);
    group.append(el('title', {}, `${entry.model.title} ${entry.size.size}`));
    const img = photo ? sidePhoto(defs, entry, side, d) : null;
    if (img) {
      group.classList.add('has-photo');
      group.append(img);
    }
    group.append(el('path', { d }));
    svg.append(group);
  });
}

// --------------------------------------------------------------------------------- //
// Vue de face des foils                                                               //
// --------------------------------------------------------------------------------- //

/**
 * Photos de face des ailes, à l'échelle de l'envergure, une ligne par aile (centrées).
 * @returns {number} nombre de foils dessinés
 */
export function renderFront(svg, entries) {
  svg.replaceChildren();
  const rows = entries.filter((e) => e.model.foilViews?.front);
  if (!rows.length) return 0;
  const defs = el('defs');
  svg.append(defs);
  const items = rows.map((entry) => {
    const v = entry.model.foilViews.front;
    const k = entry.size.spec.spanCm / (v.bbox[2] - v.bbox[0]);
    return { entry, v, k, h: k * (v.bbox[3] - v.bbox[1]) };
  });
  const maxW = Math.max(...items.map((x) => x.entry.size.spec.spanCm));
  const gap = Math.max(4, maxW * 0.04);
  const pad = Math.max(4, maxW * 0.03);
  const labelH = maxW * 0.03;
  const totalH = items.reduce((a, x) => a + x.h + labelH + gap, 0);
  const vbW = maxW + 2 * pad;
  const vbH = totalH + 2 * pad;
  svg.setAttribute('viewBox', `${-maxW / 2 - pad} ${-pad} ${vbW} ${vbH}`);
  svg.style.aspectRatio = `${vbW} / ${vbH}`;
  svg.style.setProperty('--font', `${labelH * 0.6}px`);

  const step = maxW < 60 ? 2 : 10;
  const grid = el('g', { class: 'grid', 'aria-hidden': 'true' });
  for (let x = 0; x <= maxW / 2 + pad; x += step) {
    for (const gx of x === 0 ? [0] : [x, -x]) {
      grid.append(el('line', { x1: gx, x2: gx, y1: -pad, y2: totalH + pad, class: x % (step * 5) === 0 ? 'major' : '' }));
    }
  }
  svg.append(grid);

  let y = 0;
  for (const { entry, v, k, h } of items) {
    const span = entry.size.spec.spanCm;
    const group = el('g', { class: 'shape', 'data-id': entry.size.id, style: `--c:${entry.color}` });
    group.append(el('text', { x: -span / 2, y: y + labelH * 0.75, class: 'label' },
      `${entry.model.title} ${entry.size.size} · ${formatNumber(span, 'cm')}`));
    const top = y + labelH;
    const cx = (v.bbox[0] + v.bbox[2]) / 2;
    const clip = clipPath(defs, el('rect', { x: -span / 2, y: top, width: span, height: h }));
    group.append(photoNode(v.src, { x: -cx * k, y: top - v.bbox[1] * k, width: k, height: k * v.aspect, 'clip-path': clip, class: 'photo' }));
    group.append(el('line', { x1: -span / 2, x2: span / 2, y1: top + h + 1, y2: top + h + 1, class: 'span-bar' }));
    svg.append(group);
    y += h + labelH + gap;
  }
  return rows.length;
}
