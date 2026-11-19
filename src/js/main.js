// Point d'entrée : état de l'application, interactions et synchronisation avec l'URL.

import { CATEGORIES, LEVELS, canDraw, canDrawSide, indexSizes, loadAll, maxDiscount, thumbnailUrl } from './data.js';
import { LANGS, detectLang, setLang, t, translateDom } from './i18n.js';
import { describeOverlay, renderFront, renderOverlay, renderProfile } from './overlay.js';
import { renderTable } from './table.js';
import { setNumberLocale } from './units.js';

const MAX_SELECTION = 6;
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const NUMBER_LOCALES = { fr: 'fr-CH', en: 'en-GB' };

const state = {
  category: 'board',
  selection: [], // ids de tailles, dans l'ordre (le premier = référence)
  hidden: [], // ids masqués dans les dessins (clic sur la légende)
  query: '',
  specsOnly: true,
  level: 'all',
  program: 'all',
  year: 'all',
  saleOnly: false,
  brand: 'all',
  mode: 'overlay',
  align: 'tail',
  exaggeration: 2,
  fill: 'outline',
  currency: 'CHF',
  lang: 'fr',
};

let models = [];
let brands = [];
let currencies = [];
let index = new Map();
const $ = (sel) => document.querySelector(sel);

// ---- Préférences (langue, devise) : mémorisées dans ce navigateur si possible --------
const prefs = {
  get(key) {
    try { return localStorage.getItem(`wfc.${key}`); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(`wfc.${key}`, value); } catch { /* navigation privée */ }
  },
};

// ---- URL <-> état (permet de partager une comparaison) ---------------------------
function readHash() {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get('c') in CATEGORIES) state.category = params.get('c');
  state.selection = (params.get('s') ?? '').split(',').filter((id) => index.has(id)).slice(0, MAX_SELECTION);
  if (params.get('m') === 'side') state.mode = 'side';
  if (['tail', 'center', 'nose'].includes(params.get('a'))) state.align = params.get('a');
  if (['1', '2', '3'].includes(params.get('z'))) state.exaggeration = Number(params.get('z'));
  const f = params.get('f') === 'photo' ? 'top' : params.get('f');
  if (['outline', 'top', 'bottom', 'half'].includes(f)) state.fill = f;
  state.hidden = (params.get('h') ?? '').split(',').filter((id) => state.selection.includes(id));
  const cur = params.get('cur') ?? prefs.get('currency');
  if (currencies.includes(cur)) state.currency = cur;
  state.lang = detectLang(params.get('l'), prefs.get('lang'));
}

function writeHash() {
  const params = new URLSearchParams({
    c: state.category, s: state.selection.join(','), m: state.mode, a: state.align,
    z: state.exaggeration, f: state.fill, cur: state.currency, l: state.lang,
    ...(state.hidden.length ? { h: state.hidden.join(',') } : {}),
  });
  history.replaceState(null, '', `#${params}`);
}

// ---- Actions ----------------------------------------------------------------------
function toggle(id) {
  const i = state.selection.indexOf(id);
  if (i >= 0) {
    state.selection.splice(i, 1);
    state.hidden = state.hidden.filter((h) => h !== id);
  } else if (state.selection.length < MAX_SELECTION) state.selection.push(id);
  else return announce(t('maxReached', { n: MAX_SELECTION }));
  render();
}

function toggleHidden(id) {
  const i = state.hidden.indexOf(id);
  if (i >= 0) state.hidden.splice(i, 1);
  else state.hidden.push(id);
  render();
}

function setCategory(category) {
  if (category === state.category) return;
  state.category = category;
  state.selection = [];
  state.hidden = [];
  state.program = 'all';
  render();
}

function applyLang(lang) {
  state.lang = lang;
  setLang(lang);
  setNumberLocale(NUMBER_LOCALES[lang]);
  prefs.set('lang', lang);
  translateDom();
}

function announce(message) {
  $('#status').textContent = message;
}

// ---- Rendu --------------------------------------------------------------------------
function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function selectedEntries() {
  return state.selection.map((id, i) => ({ ...index.get(id), color: PALETTE[i % PALETTE.length] }));
}

function renderTopbar() {
  const langs = $('#lang');
  langs.replaceChildren(...LANGS.map((l) => {
    const b = el('button', { type: 'button', textContent: l.toUpperCase() });
    b.setAttribute('aria-pressed', String(l === state.lang));
    b.addEventListener('click', () => { applyLang(l); render(); });
    return b;
  }));
  const cur = $('#currency');
  if (cur.options.length !== currencies.length) cur.replaceChildren(...currencies.map((c) => el('option', { value: c, textContent: c })));
  cur.value = state.currency;
}

function renderTabs() {
  const tabs = $('#tabs');
  tabs.replaceChildren();
  for (const key of Object.keys(CATEGORIES)) {
    const count = models.filter((m) => m.category === key).length;
    const btn = el('button', { type: 'button', textContent: `${t(`cat.${key}`)} (${count})` });
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(key === state.category));
    btn.addEventListener('click', () => setCategory(key));
    tabs.append(btn);
  }
}

function renderFilters() {
  // Niveau : boutons segmentés
  const levels = $('#level-filter');
  levels.replaceChildren(...['all', ...LEVELS].map((lv) => {
    const b = el('button', { type: 'button', textContent: lv === 'all' ? t('allLevels') : t(`level.${lv}`) });
    b.setAttribute('aria-pressed', String(state.level === lv));
    b.addEventListener('click', () => { state.level = lv; renderPicker(); renderFilters(); });
    return b;
  }));
  // Programme : seulement ceux présents dans la catégorie
  const programs = [...new Set(models.filter((m) => m.category === state.category).flatMap((m) => m.programs))];
  const prog = $('#program-filter');
  prog.replaceChildren(el('option', { value: 'all', textContent: t('allPrograms') }),
    ...programs.map((p) => el('option', { value: p, textContent: t(`program.${p}`) })));
  prog.value = programs.includes(state.program) ? state.program : 'all';
  $('#program-wrap').hidden = programs.length === 0;
  // Année : seulement celles présentes dans la catégorie, la plus récente d'abord
  const years = [...new Set(models.filter((m) => m.category === state.category && m.year).map((m) => m.year))].sort((a, b) => b - a);
  const yearSel = $('#year-filter');
  yearSel.replaceChildren(el('option', { value: 'all', textContent: t('allYears') }),
    ...years.map((y) => el('option', { value: String(y), textContent: String(y) })));
  yearSel.value = years.includes(Number(state.year)) ? state.year : 'all';
  $('#year-wrap').hidden = years.length < 2;
  // Marque : n'apparaît que s'il y a plusieurs marques (interface inchangée avec une seule)
  const brandSel = $('#brand-filter');
  $('#brand-wrap').hidden = brands.length < 2;
  brandSel.replaceChildren(el('option', { value: 'all', textContent: t('allBrands') }),
    ...brands.map((b) => el('option', { value: b.id, textContent: b.name })));
  brandSel.value = state.brand;
}

function visibleModels() {
  const q = state.query.trim().toLowerCase();
  return models.filter((m) =>
    m.category === state.category &&
    (!state.specsOnly || m.hasSpecs) &&
    (state.level === 'all' || m.level === state.level) &&
    (state.program === 'all' || m.programs.includes(state.program)) &&
    (state.year === 'all' || String(m.year) === state.year) &&
    (!state.saleOnly || maxDiscount(m, state.currency) != null) &&
    (state.brand === 'all' || m.brandId === state.brand) &&
    (!q || `${m.brandName} ${m.title} ${m.construction ?? ''} ${m.series ?? ''}`.toLowerCase().includes(q)));
}

function modelItem(model) {
  const li = el('li', { className: 'model' });
  const img = model.image
    ? el('img', { className: 'thumb', src: thumbnailUrl(model.image, 160), alt: '', loading: 'lazy', decoding: 'async' })
    : el('span', { className: 'thumb' });
  const title = el('span', { className: 'model-title', textContent: model.title });
  const meta = el('span', { className: 'model-meta', textContent: [brands.length > 1 ? model.brandName : null, model.year, model.series, model.construction].filter(Boolean).join(' · ') });
  const head = el('div', { className: 'model-head' }, img, el('div', { className: 'model-text' }, title, meta));
  const discount = maxDiscount(model, state.currency);
  if (discount != null) head.append(el('span', { className: 'sale', textContent: `${t('sale')} −${discount} %` }));
  if (!model.hasSpecs) head.append(el('span', { className: 'badge', textContent: t('noSpecs') }));
  const sizes = el('div', { className: 'sizes' });
  for (const size of model.sizes) {
    const btn = el('button', { type: 'button', className: 'chip', textContent: size.size, title: `${model.title} ${size.size}` });
    const pos = state.selection.indexOf(size.id);
    btn.setAttribute('aria-pressed', String(pos >= 0));
    if (pos >= 0) btn.style.setProperty('--c', PALETTE[pos % PALETTE.length]);
    btn.addEventListener('click', () => toggle(size.id));
    sizes.append(btn);
  }
  li.append(head, sizes);
  return li;
}

function renderPicker() {
  const list = $('#model-list');
  list.replaceChildren();
  const visible = visibleModels();
  if (!visible.length) {
    list.append(el('li', { className: 'empty', textContent: t('noMatch') }));
    return;
  }
  // Regroupement par niveau (débutant, avancé, pro, autres)
  const groups = [...LEVELS, null];
  for (const lv of groups) {
    // Dans chaque niveau : modèles les plus récents d'abord
    const items = visible.filter((m) => (lv ? m.level === lv : !LEVELS.includes(m.level)))
      .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    if (!items.length) continue;
    const group = el('li', { className: 'group' });
    group.append(el('h3', { className: `group-title level-${lv ?? 'other'}`, textContent: `${t(`level.${lv ?? 'other'}`)} · ${items.length}` }));
    group.append(el('ul', { className: 'group-list' }, ...items.map(modelItem)));
    list.append(group);
  }
}

function renderComparison() {
  const entries = selectedEntries();
  const hasSelection = entries.length > 0;
  $('#empty-state').hidden = hasSelection;
  $('#comparison').hidden = !hasSelection;
  $('#selection-count').textContent = `${entries.length}/${MAX_SELECTION}`;
  if (!hasSelection) return;

  // Légende : un clic affiche / masque la forme dans les dessins (pas dans le tableau)
  const isBoard = state.category === 'board';
  const photoMode = state.fill !== 'outline';
  const hasPhoto = (m) => (m.category === 'board' ? Boolean(m.photoShape?.photo) : Boolean(m.foilViews?.top));
  const legend = $('#legend');
  legend.replaceChildren();
  for (const { model, size, color } of entries) {
    const name = `${model.title}${model.year ? ` ${model.year}` : ''} — ${size.size}`;
    const hidden = state.hidden.includes(size.id);
    const btn = el('button', { type: 'button', className: 'legend-item' }, el('span', { className: 'swatch' }), name);
    btn.setAttribute('aria-pressed', String(!hidden));
    btn.title = t(hidden ? 'show' : 'hide', { name });
    if (CATEGORIES[model.category].overlay && !canDraw({ category: model.category, spec: size.spec })) {
      btn.append(el('span', { className: 'muted', textContent: t('notDrawn') }));
    } else if (photoMode && CATEGORIES[model.category].overlay && !hasPhoto(model)) {
      btn.append(el('span', { className: 'muted', textContent: t('noPhoto') }));
    }
    btn.addEventListener('click', () => toggleHidden(size.id));
    btn.addEventListener('mouseenter', () => highlight(size.id));
    btn.addEventListener('mouseleave', () => highlight(null));
    const li = el('li', {}, btn);
    li.style.setProperty('--c', color);
    li.classList.toggle('is-hidden', hidden);
    legend.append(li);
  }
  $('#legend-hint').hidden = entries.length < 2;
  const shown = entries.filter((e) => !state.hidden.includes(e.size.id));

  // Vue de dessus
  const overlayCard = $('#overlay-card');
  const drawable = shown.filter((e) => canDraw({ category: e.model.category, spec: e.size.spec }));
  overlayCard.hidden = !CATEGORIES[state.category].overlay;
  $('#align-wrap').hidden = !isBoard;
  // Dessous et moitié-moitié : boards seulement (photos de foils = dessus uniquement)
  for (const opt of $('#fill').options) opt.hidden = !isBoard && (opt.value === 'bottom' || opt.value === 'half');
  const fill = !isBoard && (state.fill === 'bottom' || state.fill === 'half') ? 'top' : state.fill;
  $('#fill').value = fill;
  for (const input of document.querySelectorAll('input[name="mode"]')) input.checked = input.value === state.mode;
  $('#align').value = state.align;
  const svg = $('#overlay');
  renderOverlay(svg, drawable, { mode: state.mode, align: state.align, fill });
  svg.setAttribute('aria-label', drawable.length ? `${t('shapes')}: ${describeOverlay(drawable)}` : t('nothingDrawable'));
  $('#overlay-empty').hidden = drawable.length > 0 || entries.length > shown.length;
  const g = svg.dataset.grid ?? '10';
  const fromPhoto = drawable.filter((e) => e.model.photoShape).length;
  let note = !isBoard
    ? t('noteFoil', { g })
    : fromPhoto === drawable.length ? t('noteBoardPhoto', { g }) : t('noteBoardMixed', { g, a: fromPhoto, b: drawable.length });
  if (photoMode && isBoard) {
    const sizes = [...new Set(drawable.filter((e) => e.model.photoShape?.photo)
      .map((e) => `${e.model.title} ${e.model.year ?? ''} : ${e.model.photoShape.photoSize ?? '?'}`))].join(', ');
    note += ` ${t('notePhoto', { sizes })}`;
  } else if (photoMode) {
    note = `${t('notePhotoFoil')} ${drawable.some((e) => !e.model.foilViews?.top) ? t('noteFoil', { g }) : ''}`;
  }
  $('#overlay-note').textContent = note;

  // Vue de face (ailes avant, stabs)
  const frontCard = $('#front-card');
  frontCard.hidden = !(state.category === 'frontwing' || state.category === 'stab');
  if (!frontCard.hidden) {
    const n = renderFront($('#front'), shown);
    $('#front').hidden = n === 0;
    $('#front-empty').hidden = n > 0;
    $('#front').setAttribute('aria-label', t('frontView'));
    frontCard.querySelector('.note').textContent = t('frontNote', { g: shown.some((e) => e.size.spec.spanCm >= 60) ? 10 : 2 });
  }

  // Profil latéral (boards)
  const sides = shown.filter((e) => canDrawSide(e.model, e.size));
  $('#profile-card').hidden = !isBoard;
  $('#exaggeration').value = String(state.exaggeration);
  renderProfile($('#profile'), sides, { align: state.align, exaggeration: state.exaggeration, photo: photoMode });
  $('#profile').setAttribute('aria-label', `${t('profile')}: ${sides.map((e) => `${e.model.title} ${e.size.size}`).join(', ')}`);
  $('#profile-empty').hidden = sides.length > 0 || entries.length > shown.length;
  $('#profile-card').querySelector('.note').textContent = t('profileNote') + (photoMode ? ` ${t('profilePhotoNote')}` : '');

  renderTable($('#spec-table'), state.category, entries, { currency: state.currency, onRemove: toggle });
}

function highlight(id) {
  for (const node of document.querySelectorAll('.drawing .shape')) {
    node.classList.toggle('dim', id !== null && node.dataset.id !== id);
  }
}

function render() {
  renderTopbar();
  renderTabs();
  renderFilters();
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
  $('#program-filter').addEventListener('change', (e) => {
    state.program = e.target.value;
    renderPicker();
  });
  $('#year-filter').addEventListener('change', (e) => {
    state.year = e.target.value;
    renderPicker();
  });
  $('#sale-only').addEventListener('change', (e) => {
    state.saleOnly = e.target.checked;
    renderPicker();
  });
  $('#brand-filter').addEventListener('change', (e) => {
    state.brand = e.target.value;
    renderPicker();
  });
  $('#currency').addEventListener('change', (e) => {
    state.currency = e.target.value;
    prefs.set('currency', state.currency);
    render();
  });
  for (const input of document.querySelectorAll('input[name="mode"]')) {
    input.addEventListener('change', (e) => {
      state.mode = e.target.value;
      render();
    });
  }
  $('#fill').addEventListener('change', (e) => {
    state.fill = e.target.value;
    render();
  });
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
    state.hidden = [];
    render();
  });
  $('#share').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      announce(t('linkCopied'));
    } catch {
      announce(t('copyFailed'));
    }
  });
}

async function init() {
  applyLang(detectLang(new URLSearchParams(location.hash.slice(1)).get('l'), prefs.get('lang')));
  try {
    const data = await loadAll();
    models = data.models;
    brands = data.brands;
    currencies = data.currencies;
    index = indexSizes(models);
  } catch (err) {
    $('#app-error').hidden = false;
    $('#app-error').textContent = t('loadError', { msg: err.message });
    return;
  }
  readHash();
  applyLang(state.lang);
  $('#specs-only').checked = state.specsOnly;
  bindControls();
  render();
}

init();
