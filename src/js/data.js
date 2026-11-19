// Chargement et fusion des données : catalogue (prix, tailles, liens) + specs (dimensions).

import { feetInchesToCm, parseNumericSize, sizeSortKey } from './units.js';

export const CATEGORIES = {
  board: { label: 'Boards', overlay: true },
  frontwing: { label: 'Foils (ailes avant)', overlay: true },
  wing: { label: 'Wings', overlay: false },
};

/** Lignes du tableau comparatif, par catégorie. */
export const SPEC_FIELDS = {
  board: [
    { key: 'volumeL', label: 'Volume', unit: 'L' },
    { key: 'lengthCm', label: 'Longueur', unit: 'cm' },
    { key: 'widthCm', label: 'Largeur', unit: 'cm' },
    { key: 'thicknessCm', label: 'Épaisseur', unit: 'cm' },
    { key: 'ofoNoseCm', label: 'Largeur à 1 pied du nez', unit: 'cm' },
    { key: 'ofoTailCm', label: "Largeur à 1 pied de l'arrière", unit: 'cm' },
    { key: 'rockerCm', label: 'Rocker total', unit: 'cm' },
    { key: 'weightKg', label: 'Poids (sans pad)', unit: 'kg' },
    { key: 'litersPerMeter', label: 'Volume par mètre de longueur', unit: 'L/m', derived: true },
  ],
  frontwing: [
    { key: 'areaCm2', label: 'Surface', unit: 'cm²' },
    { key: 'spanCm', label: 'Envergure', unit: 'cm' },
    { key: 'chordMm', label: 'Corde', unit: 'mm' },
    { key: 'thicknessMm', label: 'Épaisseur', unit: 'mm' },
    { key: 'aspectRatio', label: 'Allongement (AR)', unit: '' },
    { key: 'meanChordMm', label: 'Corde moyenne (S/b)', unit: 'mm', derived: true },
  ],
  wing: [{ key: 'areaM2', label: 'Surface', unit: 'm²' }],
};

async function getJson(url, { optional = false } = {}) {
  const res = await fetch(url);
  if (!res.ok) {
    if (optional && res.status === 404) return null;
    throw new Error(`Chargement impossible : ${url} (${res.status})`);
  }
  return res.json();
}

/** Ajoute les valeurs dérivées et celles déductibles du libellé de taille. */
export function enrichSpec(category, size, spec = {}) {
  const s = { ...spec };
  if (category === 'board') {
    s.lengthCm ??= feetInchesToCm(size) !== null ? Math.round(feetInchesToCm(size) * 10) / 10 : undefined;
    if (s.volumeL && s.lengthCm) s.litersPerMeter = Math.round((s.volumeL / s.lengthCm) * 1000) / 10;
  } else if (category === 'frontwing') {
    if (/cm²/i.test(size)) s.areaCm2 ??= parseNumericSize(size);
    if (s.areaCm2 && s.spanCm) s.meanChordMm = Math.round((s.areaCm2 / s.spanCm) * 10);
  } else if (category === 'wing') {
    s.areaM2 ??= parseNumericSize(size);
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
  if (item.category === 'frontwing') return Boolean(s.spanCm && s.chordMm);
  return false;
}

/** Retire le préfixe de catégorie redondant : "Wing Foil Board Mint FSP 2X" -> "Mint FSP 2X". */
export function shortTitle(title) {
  return title.replace(/^(wing\s*foil\s+board|foil\s+front\s+wing|wing)\s+/i, '').trim() || title;
}

/** Construit la liste des modèles (produit + ses tailles enrichies) pour une marque. */
export function mergeBrand(brand, catalog, specs, outlines = null) {
  const models = specs?.models ?? {};
  const photos = outlines?.boards ?? {};
  const productMap = specs?.products ?? {};
  return catalog.products.map((product) => {
    const modelKey = productMap[product.handle];
    const model = modelKey ? models[modelKey] : null;
    const specBySize = new Map((model?.sizes ?? []).map((s) => [s.size, s]));
    const sizeLabels = new Set(product.sizes.map((s) => s.size));
    // Tailles présentes uniquement dans le tableau officiel (ex. hors stock en ligne).
    for (const label of specBySize.keys()) sizeLabels.add(label);
    const priceBySize = new Map(product.sizes.map((s) => [s.size, s]));

    const sizes = [...sizeLabels]
      .sort((a, b) => sizeSortKey(a) - sizeSortKey(b))
      .map((size) => ({
        id: `${brand.id}:${product.handle}:${size}`,
        size,
        price: priceBySize.get(size)?.price ?? null,
        available: priceBySize.get(size)?.available ?? false,
        spec: enrichSpec(product.category, size, specBySize.get(size)),
      }));

    return {
      key: `${brand.id}:${product.handle}`,
      brandId: brand.id,
      brandName: brand.name,
      handle: product.handle,
      title: shortTitle(product.title),
      fullTitle: product.title,
      category: product.category,
      construction: product.construction,
      url: product.url,
      image: product.image,
      currency: product.currency ?? brand.currency,
      outline: model?.outline ?? {},
      photoShape: photos[product.handle] ?? null,
      sourceChart: model?.sourceChart ?? null,
      hasSpecs: Boolean(model),
      sizes,
    };
  });
}

/** Charge toutes les marques déclarées dans data/brands.json. */
export async function loadAll(base = 'data') {
  const { brands } = await getJson(`${base}/brands.json`);
  const perBrand = await Promise.all(
    brands.map(async (brand) => {
      const catalog = await getJson(`${base}/${brand.id}/catalog.json`, { optional: true });
      if (!catalog) return [];
      const [specs, outlines] = await Promise.all([
        getJson(`${base}/${brand.id}/specs.json`, { optional: true }),
        getJson(`${base}/${brand.id}/outlines.json`, { optional: true }),
      ]);
      return mergeBrand(brand, catalog, specs, outlines);
    }),
  );
  return { brands, models: perBrand.flat() };
}

/** Index id de taille -> { model, size } pour retrouver une sélection. */
export function indexSizes(models) {
  const index = new Map();
  for (const model of models) for (const size of model.sizes) index.set(size.id, { model, size });
  return index;
}
