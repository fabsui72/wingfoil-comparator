// Point d'entrée : état de l'application, interactions et synchronisation avec l'URL.

import { CATEGORIES, LEVELS, inCategory, canDraw, canDrawSide, indexSizes, loadAll, maxDiscount, thumbnailUrl } from './data.js';
import { LANGS, detectLang, setLang, t, translateDom } from './i18n.js';
import { describeOverlay, renderFront, renderOverlay, renderProfile } from './overlay.js';
import { renderTable } from './table.js';
import { setNumberLocale } from './units.js';

const MAX_SELECTION = 6;
const PALETTE = ['var(--c1)', 'var(--c2)', 'var(--c3)', 'var(--c4)', 'var(--c5)', 'var(--c6)'];
const NUMBER_LOCALES = { fr: 'fr-CH', en: 'en-GB' };
const mobileQuery = window.matchMedia('(max-width: 860px)');

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
  alpha: 50, // opacité des formes superposées (%)
  bg: 'auto', // fond des dessins : auto | light | gray | dark
  stroke: 2, // épaisseur des traits (px)
  focus: null, // modèle ouvert depuis la barre de sélection
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
  const c = params.get('c') === 'pump' ? 'pumpfront' : params.get('c'); // anciens liens
  if (c in CATEGORIES) state.category = c;
  state.selection = (params.get('s') ?? '').split(',').filter((id) => index.has(id)).slice(0, MAX_SELECTION);
  if (params.get('m') === 'side') state.mode = 'side';
  if (['tail', 'center', 'nose'].includes(params.get('a'))) state.align = params.get('a');
  if (['1', '2', '3'].includes(params.get('z'))) state.exaggeration = Number(params.get('z'));
  const f = params.get('f') === 'photo' ? 'top' : params.get('f');
  if (['outline', 'top', 'bottom', 'half'].includes(f)) state.fill = f;
  if (['auto', 'light', 'gray', 'dark'].includes(params.get('bg') ?? prefs.get('bg'))) state.bg = params.get('bg') ?? prefs.get('bg');
  const sw = Number(params.get('w') ?? prefs.get('stroke'));
  if (sw >= 1 && sw <= 8) state.stroke = sw;
  const o = Number(params.get('o'));
  if (o >= 10 && o <= 100) state.alpha = o;
  state.hidden = (params.get('h') ?? '').split(',').filter((id) => state.selection.includes(id));
  const cur = params.get('cur') ?? prefs.get('currency');
  if (currencies.includes(cur)) state.currency = cur;
  state.lang = detectLang(params.get('l'), prefs.get('lang'));
}

function writeHash() {
  const params = new URLSearchParams({
    c: state.category, s: state.selection.join(','), m: state.mode, a: state.align,
    z: state.exaggeration, f: state.fill, o: state.alpha, bg: state.bg, w: state.stroke, cur: state.currency, l: state.lang,
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
    // Plus aucune taille de ce modèle : on referme sa fiche dans la barre de sélection
    if (state.focus && !state.selection.some((s) => index.get(s).model.key === state.focus)) state.focus = null;
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
    const count = models.filter((m) => inCategory(m, key)).length;
    const label = t(`${mobileQuery.matches ? 'short' : 'cat'}.${key}`);
    const btn = el('button', { type: 'button', textContent: `${label} (${count})`, title: t(`cat.${key}`) });
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(key === state.category));
    btn.addEventListener('click', () => setCategory(key));
    tabs.append(btn);
  }
  // Sur mobile, l'onglet actif reste visible dans la barre défilante
  tabs.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
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
  const programs = [...new Set(models.filter((m) => inCategory(m, state.category)).flatMap((m) => m.programs))];
  const prog = $('#program-filter');
  prog.replaceChildren(el('option', { value: 'all', textContent: t('allPrograms') }),
    ...programs.map((p) => el('option', { value: p, textContent: t(`program.${p}`) })));
  prog.value = programs.includes(state.program) ? state.program : 'all';
  $('#program-wrap').hidden = programs.length === 0;
  // Année : seulement celles présentes dans la catégorie, la plus récente d'abord
  const years = [...new Set(models.filter((m) => inCategory(m, state.category) && m.year).map((m) => m.year))].sort((a, b) => b - a);
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
    inCategory(m, state.category) &&
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
  const type = CATEGORIES[state.category]?.includes?.length > 1 ? t(`type.${model.category}`) : null;
  const meta = el('span', { className: 'model-meta', textContent: [type, brands.length > 1 ? model.brandName : null, model.year, model.series, model.construction].filter(Boolean).join(' · ') });
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

/** Rappel de la sélection sous « Choisir les modèles » : un clic ouvre le modèle
 * juste en dessous pour ajouter une taille ou retirer une taille déjà choisie. */
function renderSelectionBar() {
  const bar = $('#selection-bar');
  const byModel = new Map();
  state.selection.forEach((id, i) => {
    const { model, size } = index.get(id);
    if (!byModel.has(model.key)) byModel.set(model.key, { model, sizes: [], color: PALETTE[i % PALETTE.length] });
    byModel.get(model.key).sizes.push(size.size);
  });
  bar.replaceChildren(...[...byModel.values()].map(({ model, sizes, color }) => {
    const chip = el('button', { type: 'button', className: 'sel-chip', title: t('selectionHint') },
      el('span', { className: 'swatch' }), `${model.title}${model.year ? ` ${model.year}` : ''} · ${sizes.join(', ')}`);
    chip.style.setProperty('--c', color);
    chip.setAttribute('aria-expanded', String(state.focus === model.key));
    chip.addEventListener('click', () => {
      state.focus = state.focus === model.key ? null : model.key;
      renderSelectionBar();
    });
    return chip;
  }));
  if (state.focus && !byModel.has(state.focus) && !models.some((m) => m.key === state.focus && inCategory(m, state.category))) state.focus = null;
  const focus = $('#focus');
  const model = state.focus && models.find((m) => m.key === state.focus);
  focus.hidden = !model;
  if (!model) return focus.replaceChildren();
  const close = el('button', { type: 'button', className: 'focus-close', textContent: '×', title: t('closeFocus') });
  close.setAttribute('aria-label', t('closeFocus'));
  close.addEventListener('click', () => { state.focus = null; renderSelectionBar(); });
  focus.replaceChildren(el('ul', { className: 'group-list' }, modelItem(model)), close);
}

function renderPicker() {
  renderSelectionBar();
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
  $('#opacity-wrap').hidden = state.mode !== 'overlay';
  $('#opacity').value = String(state.alpha);
  $('#fill').value = fill;
  for (const input of document.querySelectorAll('input[name="mode"]')) input.checked = input.value === state.mode;
  $('#align').value = state.align;
  const svg = $('#overlay');
  applyDisplayOptions();
  renderOverlay(svg, drawable, { mode: state.mode, align: state.align, fill });
  svg.setAttribute('aria-label', drawable.length ? `${t('shapes')}: ${describeOverlay(drawable)}` : t('nothingDrawable'));
  $('#overlay-empty').hidden = drawable.length > 0 || entries.length > shown.length;
  const g = svg.dataset.grid ?? '10';
  const fromPhoto = drawable.filter((e) => e.model.photoShape).length;
  const traced = drawable.filter((e) => e.model.foilViews?.top?.outline).length;
  let note = !isBoard
    ? (traced === 0 ? t('noteFoil', { g }) : traced === drawable.length ? t('noteFoilAllTraced', { g }) : t('noteFoilTraced', { g, a: traced, b: drawable.length }))
    : fromPhoto === drawable.length ? t('noteBoardPhoto', { g }) : t('noteBoardMixed', { g, a: fromPhoto, b: drawable.length });
  if (photoMode && isBoard) {
    const sizes = [...new Set(drawable.filter((e) => e.model.photoShape?.photo)
      .map((e) => `${e.model.title} ${e.model.year ?? ''} : ${e.model.photoShape.photoSize ?? '?'}`))].join(', ');
    note += ` ${t('notePhoto', { sizes })}`;
  } else if (photoMode) {
    note += ` ${t('notePhotoFoil')}`;
  }
  $('#overlay-note').textContent = note;

  // Vue de face (ailes avant, stabs)
  const frontCard = $('#front-card');
  frontCard.hidden = !['frontwing', 'stab', 'pumpfront', 'pumpstab'].includes(state.category);
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

/** Fond et épaisseur de trait des dessins (auto : sombre pour les boards, clair sinon). */
function applyDisplayOptions() {
  const bg = state.bg === 'auto' ? (state.category === 'board' ? 'dark' : 'light') : state.bg;
  const box = $('#comparison');
  box.dataset.bg = bg;
  box.style.setProperty('--stroke', `${state.stroke}px`);
  box.style.setProperty('--alpha', String(state.alpha / 100));
  $('#bg').value = state.bg;
  $('#stroke').value = String(state.stroke);
}

function highlight(id) {
  for (const node of document.querySelectorAll('.drawing .shape')) {
    node.classList.toggle('dim', id !== null && node.dataset.id !== id);
  }
}

// ---- Version mobile : deux vues (« Modèles » / « Comparer ») --------------------------
function setView(view) {
  document.body.dataset.view = view;
  for (const b of document.querySelectorAll('#mobile-nav button')) {
    b.toggleAttribute('aria-current', b.dataset.view === view);
    if (b.dataset.view === view) b.setAttribute('aria-current', 'page');
  }
  if (mobileQuery.matches) window.scrollTo({ top: 0 });
}

function updateNav() {
  $('#nav-count').textContent = state.selection.length ? String(state.selection.length) : '';
}

/** Sur petit écran, filtres et réglages sont repliés par défaut ; toujours ouverts sinon. */
function syncCollapsibles() {
  for (const d of document.querySelectorAll('#filters-box, #draw-settings')) d.open = !mobileQuery.matches;
}

function render() {
  renderTopbar();
  renderTabs();
  renderFilters();
  renderPicker();
  renderComparison();
  updateNav();
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
  $('#opacity').addEventListener('input', (e) => {
    state.alpha = Number(e.target.value);
    applyDisplayOptions();
    writeHash();
  });
  $('#stroke').addEventListener('input', (e) => {
    state.stroke = Number(e.target.value);
    prefs.set('stroke', String(state.stroke));
    applyDisplayOptions();
    writeHash();
  });
  $('#bg').addEventListener('change', (e) => {
    state.bg = e.target.value;
    prefs.set('bg', state.bg);
    applyDisplayOptions();
    writeHash();
  });
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
  for (const b of document.querySelectorAll('#mobile-nav button')) b.addEventListener('click', () => setView(b.dataset.view));
  mobileQuery.addEventListener('change', () => { syncCollapsibles(); renderTabs(); });
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
  syncCollapsibles();
  setView(state.selection.length ? 'compare' : 'pick');
  render();
}

init();
