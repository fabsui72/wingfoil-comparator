# Wingfoil Comparator

Outil web pour comparer des **boards**, des **foils (ailes avant)**, des **stabs** et des **wings** de wingfoil :

- **superposition à l'échelle** des formes (vue de dessus), en mode superposé ou côte à côte, avec alignement sur l'arrière / le centre / le nez pour les boards ;
- **profil des boards** (épaisseur, rocker, creux du pont), avec exagération des hauteurs ×1, ×2 ou ×3 ;
- **tableau de specs** côte à côte, avec l'écart en % par rapport à la première taille choisie (la référence) ;
- **wings** : poids, envergure, longueur de bôme, plage de vent conseillée, prix, prix et poids par m² ;
- modèles **rangés par niveau** (débutant, avancé, pro), filtrables par programme (freeride, vague, petit temps…), avec **photo** ;
- prix en **CHF, € ou $** (prix réels de chaque boutique, pas une conversion) ; interface en **français ou anglais** ;
- jusqu'à 6 éléments comparés ; la comparaison (devise et langue comprises) est stockée dans l'URL, ce qui permet de la partager.

**Site en ligne : https://fabsui72.github.io/wingfoil-comparator/**

Première marque intégrée : [Gong](https://www.gong-galaxy.com/fr-ch/collections/wing-foil). L'architecture est prévue pour en ajouter d'autres (voir [docs/ajouter-une-marque.md](docs/ajouter-une-marque.md)) ; le filtre par marque n'apparaît qu'à partir de deux marques.

## Lancer le site

Site statique, sans dépendance ni étape de build. Il faut simplement le servir en HTTP (les modules ES et `fetch` ne marchent pas en `file://`) :

```bash
cd wingfoil-comparator
python3 -m http.server 8000      # ou : npm start
# puis ouvrir http://localhost:8000
```

Il peut être publié tel quel sur n'importe quel hébergement statique (GitHub Pages, Netlify…).

## Publication automatique (GitHub Actions + GitHub Pages)

Le workflow `.github/workflows/update-and-deploy.yml` :

1. récupère le catalogue Gong (`fetch_catalog.py`) et recalcule les formes des boards (`extract_board_outlines.py`) ;
2. lance les tests (la publication est bloquée s'ils échouent) ;
3. enregistre dans le dépôt les données qui ont changé (commit `Mise à jour automatique des données`), ce qui garde l'historique des prix et des modèles ;
4. publie le site sur GitHub Pages.

Il se déclenche à chaque push sur `main`, chaque lundi matin, et à la demande (onglet **Actions** → *Mise à jour des données et publication* → **Run workflow**). Si le site de la marque est indisponible, le site est publié avec les données existantes et un avertissement apparaît dans le run.

Réglage à faire une seule fois : **Settings → Pages → Build and deployment → Source : GitHub Actions**.

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
│       ├── i18n.js          # traductions FR / EN
│       └── units.js         # conversions pieds/cm, formatage (fonctions pures)
├── data/
│   ├── brands.json          # configuration des marques (source, catégories…)
│   └── gong/
│       ├── catalog.json     # GÉNÉRÉ : produits, tailles, prix, liens, tableaux de tailles
│       ├── outlines.json    # GÉNÉRÉ : formes des boards extraites des photos
│       └── specs.json       # SAISI : dimensions transcrites des tableaux de tailles
├── scripts/
│   ├── fetch_catalog.py           # récupère le catalogue d'une marque (Python stdlib)
│   └── extract_board_outlines.py  # extrait les formes des photos (Pillow + numpy)
├── docs/ajouter-une-marque.md
└── tests/
```

### D'où viennent les données ?

| Donnée | Source | Fichier |
|---|---|---|
| Modèles, tailles, prix (CHF, €, $), disponibilité, liens, photo | API publique Shopify (`/collections/<x>/products.json`), un appel par boutique (CH, UE, US) | `catalog.json` (généré) |
| Niveau, série, programmes | Catégories de chaque page produit (« Planches débutants », « Pro Team Series », « Freeride »…) | `catalog.json` (généré) |
| Dimensions (volume, largeur, envergure, surface…) | Tableaux de tailles officiels, **publiés uniquement sous forme d'images** | `specs.json` (transcrit) |
| Forme des boards (contour, profil) | Photos produits (vues de dessus et de profil) | `outlines.json` (généré) |

Comme les dimensions n'existent qu'en image, elles sont transcrites dans `specs.json`. L'URL du tableau d'origine (`sourceChart`) y est conservée pour chaque modèle afin de pouvoir vérifier les valeurs.

### Silhouettes : ce qui est exact et ce qui est estimé

Les marques ne publient pas de plan de forme. Les silhouettes sont donc **reconstruites** :

- **Boards, vue de dessus** : le contour vient de la photo produit (vue du pont). Il est mis à l'échelle sur la longueur et la largeur officielles, puis légèrement corrigé pour passer exactement par les largeurs à 1 pied du nez et de l'arrière (OFO). Avant correction, la photo s'écarte déjà de moins de 2 % des cotes officielles. Sans photo exploitable, le contour est interpolé entre les cotes (`outline.nose` / `outline.tail` donnent l'allure du nez et de l'arrière).
- **Boards, profil** : il vient de la vue latérale de la photo, mis à l'échelle sur la longueur et recalé pour que l'épaisseur max soit l'épaisseur officielle (la photo s'en écarte de 3 à 8 % avant recalage). Les straps sont retirés automatiquement. Le rocker affiché est celui de la photo, à environ ±1 cm près ; la valeur officielle est dans le tableau.
- **Ailes avant et stabs** : envergure et corde sont exactes. Le contour est une super-ellipse dont l'exposant est calculé pour retrouver exactement la surface publiée. La flèche des saumons est uniquement visuelle.

## Mettre à jour les données

```bash
python3 scripts/fetch_catalog.py gong   # ou : npm run fetch:gong (≈ 3 min : lit chaque page produit)
```

Le script met à jour `data/gong/catalog.json` : prix dans les trois devises, niveau, série, programmes et URLs des tableaux de tailles de chaque produit. Il ne touche jamais à `specs.json`.

Puis, pour les formes des boards :

```bash
pip install -r requirements.txt
python3 scripts/extract_board_outlines.py gong --debug /tmp/controle
```

`--debug` écrit, pour chaque board, la photo avec les contours extraits dessinés par-dessus (rouge : contour et pont, vert : dessous) pour contrôle visuel.

### Ajouter les dimensions d'un modèle

1. Ouvrir l'URL du tableau de tailles (champ `sizeCharts` du produit dans `catalog.json`).
2. Ajouter un modèle dans `specs.json > models`, avec les **mêmes libellés de taille** que le catalogue (`"5'4"`, `"M"`…).
3. Relier le ou les produits dans `specs.json > products` (`"<handle>": "<clé du modèle>"`). Plusieurs produits peuvent pointer vers le même modèle (ex. versions Perf et Team d'une aile, si les cotes sont identiques).
4. Lancer `npm test`.

Champs : voir [docs/ajouter-une-marque.md](docs/ajouter-une-marque.md#4-saisir-les-dimensions-specsjson).

### Ajouter une marque

Voir [docs/ajouter-une-marque.md](docs/ajouter-une-marque.md) : une entrée dans `data/brands.json`, éventuellement un adaptateur si la boutique n'est pas sur Shopify, puis les dimensions dans `data/<marque>/specs.json`. L'interface n'a pas à être modifiée.

### Niveaux

Le niveau vient du classement de la marque : « débutant » si le produit est dans une catégorie débutants, « pro » s'il est dans la gamme Pro Team, « avancé » sinon. Les règles sont dans `data/brands.json` (`levels`, `defaultLevel`).

## Données Gong intégrées (au 19.11.2026)

- Catalogue : 45 boards, 33 ailes avant, 28 stabs, 21 wings.
- Dimensions saisies pour tous les produits dont Gong publie un tableau de tailles (121 produits, 108 modèles). Restent sans dimensions, faute de tableau publié : HIPE Pro, Sirus V3 (non Atmo) et les ailes avant Ypra V3 non Atmo.
- Longueur de bôme : tableau « Boom GFS V3 » (XXS 81 cm … L 105,5 cm), taille de bôme par surface de wing selon les tableaux Gong.
