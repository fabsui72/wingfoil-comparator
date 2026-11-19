# Wingfoil Comparator

Outil web pour comparer des **boards**, des **foils (ailes avant)** et des **wings** de wingfoil :

- **superposition à l'échelle** des formes (vue de dessus, grille de 10 cm), en mode superposé ou côte à côte, avec alignement sur l'arrière / le centre / le nez pour les boards ;
- **tableau de specs** côte à côte, avec l'écart en % par rapport à la première taille choisie (la référence) ;
- jusqu'à 6 éléments comparés ; la comparaison est stockée dans l'URL, ce qui permet de la partager.

Première marque intégrée : [Gong](https://www.gong-galaxy.com/fr-ch/collections/wing-foil) (prix en CHF). L'architecture est prévue pour en ajouter d'autres.

## Lancer le site

Site statique, sans dépendance ni étape de build. Il faut simplement le servir en HTTP (les modules ES et `fetch` ne marchent pas en `file://`) :

```bash
cd wingfoil-comparator
python3 -m http.server 8000      # ou : npm start
# puis ouvrir http://localhost:8000
```

Il peut être publié tel quel sur n'importe quel hébergement statique (GitHub Pages, Netlify…).

## Tests

```bash
npm test     # Node ≥ 20 (node:test) + Python 3 (unittest), aucune dépendance
```

Les tests vérifient notamment que chaque silhouette dessinée respecte les cotes publiées (longueur, largeur max, largeurs à 1 pied) et que la forme de chaque aile retrouve la surface officielle.

## Structure

```
wingfoil-comparator/
├── index.html               # page unique, HTML sémantique et accessible
├── src/
│   ├── css/styles.css       # thème clair/sombre, responsive
│   └── js/
│       ├── main.js          # état, interactions, synchronisation avec l'URL
│       ├── data.js          # chargement + fusion catalogue/specs, champs comparés
│       ├── shapes.js        # géométrie des silhouettes (fonctions pures)
│       ├── overlay.js       # rendu SVG à l'échelle (1 unité = 1 cm)
│       ├── table.js         # tableau comparatif
│       └── units.js         # conversions pieds/cm, formatage (fonctions pures)
├── data/
│   ├── brands.json          # configuration des marques (source, catégories…)
│   └── gong/
│       ├── catalog.json     # GÉNÉRÉ : produits, tailles, prix, liens, tableaux de tailles
│       └── specs.json       # SAISI : dimensions transcrites des tableaux de tailles
├── scripts/fetch_catalog.py # récupère le catalogue d'une marque (Python stdlib)
└── tests/
```

### D'où viennent les données ?

| Donnée | Source | Fichier |
|---|---|---|
| Modèles, tailles, prix, disponibilité, liens | API publique Shopify (`/collections/<x>/products.json`) | `catalog.json` (généré) |
| Dimensions (volume, largeur, envergure, surface…) | Tableaux de tailles officiels, **publiés uniquement sous forme d'images** | `specs.json` (transcrit) |

Comme les dimensions n'existent qu'en image, elles sont transcrites dans `specs.json`. L'URL du tableau d'origine (`sourceChart`) y est conservée pour chaque modèle afin de pouvoir vérifier les valeurs.

### Silhouettes : ce qui est exact et ce qui est estimé

Les marques ne publient pas de plan de forme. Les silhouettes sont donc **reconstruites** :

- **Boards** : longueur, largeur max et largeurs à 1 pied du nez et de l'arrière (OFO) sont exactes. Entre ces points, la courbe est une interpolation monotone (sans dépassement). La forme du nez et de l'arrière (`outline.nose` / `outline.tail` : `round`/`pointed`, `square`/`diamond`/`squash`) est indiquée à la main.
- **Ailes avant** : envergure et corde sont exactes. Le contour est une super-ellipse dont l'exposant est calculé pour retrouver exactement la surface publiée. La flèche des saumons est uniquement visuelle.

## Mettre à jour les données

```bash
python3 scripts/fetch_catalog.py gong --with-charts   # ou : npm run fetch:gong
```

Le script met à jour `data/gong/catalog.json`, y compris les URLs des tableaux de tailles de chaque produit. Il ne touche jamais à `specs.json`.

### Ajouter les dimensions d'un modèle

1. Ouvrir l'URL du tableau de tailles (champ `sizeCharts` du produit dans `catalog.json`).
2. Ajouter un modèle dans `specs.json > models`, avec les **mêmes libellés de taille** que le catalogue (`"5'4"`, `"M"`…).
3. Relier le ou les produits dans `specs.json > products` (`"<handle>": "<clé du modèle>"`). Plusieurs produits peuvent pointer vers le même modèle (ex. versions Perf et Team d'une aile, si les cotes sont identiques).
4. Lancer `npm test`.

Champs : boards `lengthCm, widthCm, thicknessCm, volumeL, ofoNoseCm, ofoTailCm, rockerCm, weightKg` ; ailes avant `spanCm, chordMm, thicknessMm, aspectRatio, areaCm2`.

### Ajouter une marque

1. Ajouter une entrée dans `data/brands.json` (adaptateur `shopify` : `baseUrl`, `locale`, `collection`, correspondance tags → catégories, noms des options de taille).
2. `python3 scripts/fetch_catalog.py <id>`
3. Créer `data/<id>/specs.json` (facultatif : sans ce fichier, les produits sont listés avec leurs prix mais ne sont pas dessinés).

Pour une marque qui n'utilise pas Shopify, il faudra ajouter un adaptateur dans `fetch_catalog.py`. Le format de sortie (`catalog.json`) reste le même.

## Données Gong intégrées (au 19.11.2026)

- Catalogue : 45 boards, 33 ailes avant, 11 wings.
- Dimensions saisies : boards Mint, Lemon, Lance et Zuma FSP 2X, Cruzader Diamond et Stunt FSP Pro ; ailes avant X-Over, Ascent, Curve, Fluid, Veloce et Sirus V3 Atmo (Perf Series).
