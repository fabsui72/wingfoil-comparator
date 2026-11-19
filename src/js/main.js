// Point d'entrée : état de l'application, interactions et synchronisation avec l'URL.

import { CATEGORIES, canDraw, canDrawSide, indexSizes, loadAll } from './data.js';
import { describeOverlay, renderOverlay, renderProfile } from './overlay.js';
import { renderTable } from './table.js';

const MAX_SELECTION = 6;
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];

const state = {
  category: 'board',
  selection: [], // ids de tailles, dans l'ordre (le premier = référence)
  query: '',
  specsOnly: true,
  mode: 'overlay',
  align: 'tail',
  exaggeration: 2,
};

let models = [];
let index = new Map();
const $ = (sel) => document.querySelector(sel);

// ---- URL <-> état (permet de partager une comparaison) ---------------------------
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('c') in CATEGORIES) state.category = params.get('c');
  state.selection = (params.get('s') ?? '').split(',').filter((id) => index.has(id)).slice(0, MAX_SELECTION);
  if (params.get('m') === 'side') state.mode = 'side';
  if (['tail', 'center', 'nose'].includes(params.get('a'))) state.align = params.get('a');
  if (['1', '2', '3'].includes(params.get('z'))) state.exaggeration = Number(params.get('z'));
}

function writeHash() {
  const params = new URLSearchParams({ c: state.category, s: state.selection.join(','), m: state.mode, a: state.align, z: state.exaggeration });
  history.replaceState(null, '', `#${params}`);
}

// ---- Actions ----------------------------------------------------------------------
function toggle(id) {
  const i = state.selection.indexOf(id);
  if (i >= 0) state.selection.splice(i, 1);
  else if (state.selection.length < MAX_SELECTION) state.selection.push(id);
  else return announce(`Maximum ${MAX_SELECTION} éléments à comparer.`);
  render();
}

function setCategory(category) {
  if (category === state.category) return;
  state.category = category;
  state.selection = [];
  render();
}

function announce(message) {
  $('#status').textContent = message;
}

// ---- Rendu --------------------------------------------------------------------------
function selectedEntries() {
  return state.selection.map((id, i) => ({ ...index.get(id), color: PALETTE[i % PALETTE.length] }));
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.replaceChildren();
  for (const [key, { label }] of Object.entries(CATEGORIES)) {
    const count = models.filter((m) => m.category === key).length;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.role = 'tab';
    btn.textContent = `${label} (${count})`;
    btn.setAttribute('aria-selected', String(key === state.category));
    btn.addEventListener('click', () => setCategory(key));
    tabs.append(btn);
  }
}

function renderPicker() {
  const list = $('#model-list');
  list.replaceChildren();
  const q = state.query.trim().toLowerCase();
  const visible = models.filter(
    (m) =>
      m.category === state.category &&
      (!state.specsOnly || m.hasSpecs || state.category === 'wing') &&
      (!q || `${m.brandName} ${m.title} ${m.construction ?? ''}`.toLowerCase().includes(q)),
  );
  $('#specs-only-wrap').hidden = state.category === 'wing';
  if (!visible.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Aucun modèle ne correspond.';
    list.append(li);
    return;
  }
  for (const model of visible) {
    const li = document.createElement('li');
    li.className = 'model';
    const head = document.createElement('div');
    head.className = 'model-head';
    const title = document.createElement('span');
    title.className = 'model-title';
    title.textContent = model.title;
    head.append(title);
    if (!model.hasSpecs && model.category !== 'wing') {
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = 'specs à saisir';
      head.append(badge);
    }
    const sizes = document.createElement('div');
    sizes.className = 'sizes';
    for (const size of model.sizes) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
      btn.textContent = size.size;
      const pos = state.selection.indexOf(size.id);
      btn.setAttribute('aria-pressed', String(pos >= 0));
      if (pos >= 0) btn.style.setProperty('--c', PALETTE[pos % PALETTE.length]);
      btn.title = `${model.title} ${size.size}`;
      btn.addEventListener('click', () => toggle(size.id));
      sizes.append(btn);
    }
    li.append(head, sizes);
    list.append(li);
  }
}

function renderComparison() {
  const entries = selectedEntries();
  const hasSelection = entries.length > 0;
  $('#empty-state').hidden = hasSelection;
  $('#comparison').hidden = !hasSelection;
  $('#selection-count').textContent = `${entries.length}/${MAX_SELECTION}`;
  if (!hasSelection) return;

  // Légende
  const legend = $('#legend');
  legend.replaceChildren();
  for (const { model, size, color } of entries) {
    const li = document.createElement('li');
    li.style.setProperty('--c', color);
    li.dataset.id = size.id;
    li.innerHTML = '<span class="swatch"></span>';
    li.append(`${model.title} — ${size.size}`);
    if (!canDraw({ category: model.category, spec: size.spec })) {
      const note = document.createElement('span');
      note.className = 'muted';
      note.textContent = ' (dimensions inconnues, non dessiné)';
      li.append(note);
    }
    li.addEventListener('mouseenter', () => highlight(size.id));
    li.addEventListener('mouseleave', () => highlight(null));
    legend.append(li);
  }

  // Superposition
  const overlayCard = $('#overlay-card');
  const drawable = entries.filter((e) => canDraw({ category: e.model.category, spec: e.size.spec }));
  overlayCard.hidden = !CATEGORIES[state.category].overlay;
  $('#align-wrap').hidden = state.category !== 'board';
  for (const input of document.querySelectorAll('input[name="mode"]')) input.checked = input.value === state.mode;
  $('#align').value = state.align;
  const svg = $('#overlay');
  renderOverlay(svg, drawable, { mode: state.mode, align: state.align });
  svg.setAttribute('aria-label', drawable.length ? `Superposition à l'échelle : ${describeOverlay(drawable)}` : 'Aucune silhouette dessinable');
  $('#overlay-empty').hidden = drawable.length > 0;
  const fromPhoto = drawable.filter((e) => e.model.photoShape).length;
  $('#overlay-note').textContent = state.category === 'board'
    ? `Grille de 10 cm. ${fromPhoto === drawable.length ? 'Contours' : `${fromPhoto} contour(s) sur ${drawable.length}`} tirés des photos produits (vue de dessus) et recalés sur les cotes officielles : longueur, largeur max et largeurs à 1 pied du nez et de l'arrière sont exactes.${fromPhoto < drawable.length ? ' Les autres sont estimés à partir des seules cotes.' : ''}`
    : "Grille de 10 cm. Contours reconstruits à partir de l'envergure, de la corde et de la surface officielles (forme exacte en surface, dessin des saumons approximatif).";

  // Profil latéral (boards)
  const profileCard = $('#profile-card');
  const sides = entries.filter((e) => canDrawSide(e.model, e.size));
  profileCard.hidden = state.category !== 'board';
  $('#exaggeration').value = String(state.exaggeration);
  renderProfile($('#profile'), sides, { align: state.align, exaggeration: state.exaggeration });
  $('#profile').setAttribute('aria-label', `Profils latéraux : ${sides.map((e) => `${e.model.title} ${e.size.size}`).join(', ')}`);
  $('#profile-empty').hidden = sides.length > 0;

  renderTable($('#spec-table'), state.category, entries, toggle);
}

function highlight(id) {
  for (const g of document.querySelectorAll('.drawing .shape')) {
    g.classList.toggle('dim', id !== null && g.dataset.id !== id);
  }
}

function render() {
  renderTabs();
  renderPicker();
  renderComparison();
  writeHash();
}

// ---- Démarrage ----------------------------------------------------------------------
function bindControls() {
  $('#search').addEventListener('input', (e) => {
    state.query = e.target.value;
    renderPicker();
  });
  $('#specs-only').addEventListener('change', (e) => {
    state.specsOnly = e.target.checked;
    renderPicker();
  });
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener('change', (e) => {
      state.mode = e.target.value;
      render();
    });
  }
  $('#align').addEventListener('change', (e) => {
    state.align = e.target.value;
    render();
  });
  $('#exaggeration').addEventListener('change', (e) => {
    state.exaggeration = Number(e.target.value);
    render();
  });
  $('#clear').addEventListener('click', () => {
    state.selection = [];
    render();
  });
  $('#share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      announce('Lien de la comparaison copié.');
    } catch {
      announce("Copie impossible : utilisez l'URL de la barre d'adresse.");
    }
  });
}

async function init() {
  try {
    const data = await loadAll();
    models = data.models;
    index = indexSizes(models);
  } catch (err) {
    $('#app-error').hidden = false;
    $('#app-error').textContent = `${err.message}. Lancez le site via un serveur local (voir README).`;
    return;
  }
  readHash();
  $('#specs-only').checked = state.specsOnly;
  bindControls();
  render();
}

init();
