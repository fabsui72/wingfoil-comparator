// Chargement et fusion des données : catalogue (prix, tailles, liens, niveau) + specs (dimensions).

import { feetInchesToCm, parseNumericSize, sizeSortKey } from './units.js';

/** Catégories affichées. `overlay` : silhouette à l'échelle disponible. */
export const CATEGORIES = {
  board: { overlay: true },
  frontwing: { overlay: true },
  stab: { overlay: true },
  wing: { overlay: false },
};

/** Ordre d'affichage des niveaux dans la liste. */
export const LEVELS = ['beginner', 'advanced', 'pro'];

/** Lignes du tableau comparatif, par catégorie (libellés : clé `f.<key>` dans i18n.js). */
export const SPEC_FIELDS = {
  board: [
    { key: 'volumeL', unit: 'L' },
    { key: 'lengthCm', unit: 'cm' },
    { key: 'widthCm', unit: 'cm' },
    { key: 'thicknessCm', unit: 'cm' },
    { key: 'ofoNoseCm', unit: 'cm' },
    { key: 'ofoTailCm', unit: 'cm' },
    { key: 'rockerCm', unit: 'cm' },
    { key: 'weightKg', unit: 'kg' },
    { key: 'litersPerMeter', unit: 'L/m', derived: true },
  ],
  frontwing: [
    { key: 'areaCm2', unit: 'cm²' },
    { key: 'spanCm', unit: 'cm' },
    { key: 'chordMm', unit: 'mm' },
    { key: 'thicknessMm', unit: 'mm' },
    { key: 'aspectRatio', unit: '' },
    { key: 'meanChordMm', unit: 'mm', derived: true },
  ],
  stab: [
    { key: 'areaCm2', unit: 'cm²' },
    { key: 'spanCm', unit: 'cm' },
    { key: 'chordMm', unit: 'mm' },
    { key: 'thicknessMm', unit: 'mm' },
    { key: 'aspectRatio', unit: '' },
    { key: 'fuselageLengthCm', unit: 'cm' },
  ],
  wing: [
    { key: 'areaM2', unit: 'm²' },
    { key: 'weightKg', unit: 'kg' },
    { key: 'spanCm', unit: 'cm' },
    { key: 'boomLengthCm', unit: 'cm', extra: 'boomSize' },
    { key: 'wind', unit: 'kts', range: ['windMinKts', 'windMaxKts'] },
    { key: 'chordCm', unit: 'cm' },
    { key: 'aspectRatio', unit: '' },
    { key: 'pressurePsi', unit: 'psi' },
    { key: 'weightPerM2', unit: 'kg/m²', derived: true },
    { key: 'pricePerM2', unit: 'price/m²', derived: true },
  ],
};

async function getJson(url, { optional = false } = {}) {
  const res = await fetch(url);
  if (!res.ok) {
    if (optional && res.status === 404) return null;
    throw new Error(`${url} (${res.status})`);
  }
  return res.json();
}

/** Ajoute les valeurs dérivées et celles déductibles du libellé de taille. */
export function enrichSpec(category, size, spec = {}) {
  const s = { ...spec };
  if (category === 'board') {
    const cm = feetInchesToCm(size);
    s.lengthCm ??= cm !== null ? Math.round(cm * 10) / 10 : undefined;
    if (s.volumeL && s.lengthCm) s.litersPerMeter = Math.round((s.volumeL / s.lengthCm) * 1000) / 10;
  } else if (category === 'frontwing' || category === 'stab') {
    if (/cm²/i.test(size)) s.areaCm2 ??= parseNumericSize(size);
    if (s.areaCm2 && s.spanCm) s.meanChordMm = Math.round((s.areaCm2 / s.spanCm) * 10);
  } else if (category === 'wing') {
    s.areaM2 ??= parseNumericSize(size);
    if (s.weightKg && s.areaM2) s.weightPerM2 = Math.round((s.weightKg / s.areaM2) * 100) / 100;
  }
  return s;
}

/** Le profil latéral est dessinable si la photo et l'épaisseur sont connues. */
export function canDrawSide(model, size) {
  return model.category === 'board' && Boolean(model.photoShape && size.spec.lengthCm && size.spec.thicknessCm);
}

/** Une silhouette est dessinable si les cotes indispensables sont connues. */
export function canDraw(item) {
  const s = item.spec;
  if (item.category === 'board') return Boolean(s.lengthCm && s.widthCm);
  if (item.category === 'frontwing' || item.category === 'stab') return Boolean(s.spanCm && s.chordMm);
  return false;
}

/** Retire le préfixe de catégorie redondant : "Wing Foil Board Mint FSP 2X" -> "Mint FSP 2X". */
export function shortTitle(title) {
  return title.replace(/^(wing\s*foil\s+board|foil\s+front\s+wing|foil\s+stab|foil\s+tail\s+wing|wing)\s+/i, '').trim() || title;
}

/** Vignette : demande au CDN une image réduite quand il le permet (Shopify : ?width=). */
export function thumbnailUrl(url, width = 240) {
  if (!url) return null;
  return /cdn\.shopify\.com|\/cdn\/shop\//.test(url) ? `${url}${url.includes('?') ? '&' : '?'}width=${width}` : url;
}

/** Année du modèle quand le handle la contient (Gong : "...-27" = 2027, "...-26nhnb" = 2026). */
export function modelYear(handle) {
  const m = /-(2\d)(?:[a-z]{0,6})?$/.exec(handle ?? '');
  return m ? 2000 + Number(m[1]) : null;
}

/** Prix d'une taille dans la devise demandée (null si la marque ne vend pas dans cette devise). */
export function priceIn(size, currency) {
  return size.prices?.[currency] ?? null;
}

/** Prix avant promotion (prix barré), ou null si la taille n'est pas en promo dans cette devise. */
export function compareAtIn(size, currency) {
  const before = size.compareAt?.[currency] ?? null;
  const now = priceIn(size, currency);
  return before != null && now != null && before > now ? before : null;
}

/** Remise en % (arrondie) d'une taille, ou null. */
export function discountPct(size, currency) {
  const before = compareAtIn(size, currency);
  return before ? Math.round((1 - priceIn(size, currency) / before) * 100) : null;
}

/** Plus forte remise parmi les tailles d'un modèle (null si aucune). */
export function maxDiscount(model, currency) {
  const d = model.sizes.map((s) => discountPct(s, currency)).filter((x) => x != null);
  return d.length ? Math.max(...d) : null;
}

/** Construit la liste des modèles (produit + ses tailles enrichies) pour une marque. */
export function mergeBrand(brand, catalog, specs, outlines = null, foilviews = null) {
  const models = specs?.models ?? {};
  const productMap = specs?.products ?? {};
  const photos = outlines?.boards ?? {};
  const views = foilviews?.foils ?? {};
  return catalog.products.map((product) => {
    const modelKey = productMap[product.handle];
    const model = modelKey ? models[modelKey] : null;
    const specBySize = new Map((model?.sizes ?? []).map((s) => [s.size, s]));
    const catalogBySize = new Map(product.sizes.map((s) => [s.size, s]));
    // Seules les tailles vendues sont proposées ; les specs complètent.
    const sizes = [...catalogBySize.keys()]
      .sort((a, b) => sizeSortKey(a) - sizeSortKey(b))
      .map((size) => {
        const c = catalogBySize.get(size);
        const prices = c.prices ?? (c.price != null ? { [catalog.currency ?? brand.currency ?? 'CHF']: c.price } : {});
        const spec = enrichSpec(product.category, size, specBySize.get(size));
        return { id: `${brand.id}:${product.handle}:${size}`, size, prices, compareAt: c.compareAt ?? {}, available: Boolean(c.available), spec };
      });

    return {
      key: `${brand.id}:${product.handle}`,
      brandId: brand.id,
      brandName: brand.name,
      handle: product.handle,
      title: shortTitle(product.title),
      fullTitle: product.title,
      category: product.category,
      construction: product.construction,
      level: product.level ?? null,
      series: product.series ?? null,
      year: product.year ?? modelYear(product.handle),
      programs: product.programs ?? [],
      url: product.url,
      urls: product.urls ?? {},
      image: product.image,
      outline: model?.outline ?? {},
      photoShape: photos[product.handle] ?? null,
      foilViews: views[product.handle] ?? null,
      sourceChart: model?.sourceChart ?? null,
      aspectRatio: model?.aspectRatio ?? null,
      hasSpecs: Boolean(model),
      sizes,
    };
  });
}

/** Champs de spec portés par le modèle (ex. allongement d'une wing) recopiés sur chaque taille. */
function spreadModelFields(models) {
  for (const m of models) {
    if (m.aspectRatio != null) for (const s of m.sizes) s.spec.aspectRatio ??= m.aspectRatio;
  }
  return models;
}

/** Charge toutes les marques déclarées dans data/brands.json. */
export async function loadAll(base = 'data') {
  const { brands } = await getJson(`${base}/brands.json`);
  const perBrand = await Promise.all(
    brands.map(async (brand) => {
      const catalog = await getJson(`${base}/${brand.id}/catalog.json`, { optional: true });
      if (!catalog) return [];
      const [specs, outlines, foilviews] = await Promise.all([
        getJson(`${base}/${brand.id}/specs.json`, { optional: true }),
        getJson(`${base}/${brand.id}/outlines.json`, { optional: true }),
        getJson(`${base}/${brand.id}/foilviews.json`, { optional: true }),
      ]);
      return mergeBrand(brand, catalog, specs, outlines, foilviews);
    }),
  );
  const currencies = [...new Set(brands.flatMap((b) => (b.markets ?? [{ currency: b.currency }]).map((m) => m.currency)))];
  return { brands, currencies, models: spreadModelFields(perBrand.flat()) };
}

/** Index id de taille -> { model, size } pour retrouver une sélection. */
export function indexSizes(models) {
  const index = new Map();
  for (const model of models) for (const size of model.sizes) index.set(size.id, { model, size });
  return index;
}
