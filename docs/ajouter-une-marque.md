# Ajouter une marque

L'interface n'a pas besoin d'être modifiée : dès que `data/brands.json` contient plus d'une marque, un filtre **Marque** apparaît dans la liste des modèles et le nom de la marque s'affiche sous chaque modèle. Avec une seule marque, ces éléments restent masqués.

Une marque, ce sont trois fichiers dans `data/<id>/` :

| Fichier | Contenu | Comment il est produit |
|---|---|---|
| `catalog.json` | modèles, tailles, prix par devise, liens, photo, niveau, programmes | **généré** par `scripts/fetch_catalog.py <id>` |
| `specs.json` | dimensions (volume, largeur, envergure, surface, poids…) | **saisi** depuis les tableaux de tailles officiels |
| `outlines.json` | forme des boards tirée des photos | **généré** par `scripts/extract_board_outlines.py <id>` (facultatif) |

## 1. Déclarer la marque dans `data/brands.json`

```jsonc
{
  "id": "exemple",                    // nom du dossier data/exemple/
  "name": "Exemple",
  "adapter": "shopify",               // plateforme de vente, voir § 3
  "baseUrl": "https://www.exemple.com",
  "collection": "wingfoil",           // collection qui contient boards, foils et wings
  "markets": [                        // un marché par devise
    { "locale": "fr-ch", "currency": "CHF", "primary": true },
    { "locale": "en", "currency": "EUR" },
    { "locale": "en-us", "currency": "USD" }
  ],
  "categories": {                     // tags du site -> catégories du comparateur
    "board": ["..."], "frontwing": ["..."], "stab": ["..."], "wing": ["..."]
  },
  "excludeTitlePattern": "(?i)pack|leash",
  "sizeOptionNames": ["Size", "Taille"],
  "constructionOptionNames": ["Construction"],
  "productPage": {                    // facultatif : lecture de la page produit
    "categoriesPattern": "...",       // pour le niveau et les programmes
    "sizeChartPattern": "..."         // pour retrouver les tableaux de tailles
  },
  "levels": [{ "match": "beginner", "level": "beginner" }, { "match": "Pro", "level": "pro" }],
  "defaultLevel": "advanced",
  "programs": { "freeride": "Freeride", "wave": "Wave" }
}
```

Les niveaux possibles sont `beginner`, `advanced` et `pro`. Ils sont déduits des catégories du site de la marque. Si une marque ne publie pas de niveau, on peut le fixer à la main dans `specs.json` (voir § 4).

## 2. Récupérer le catalogue

```bash
python3 scripts/fetch_catalog.py exemple
python3 scripts/extract_board_outlines.py exemple   # seulement si les photos s'y prêtent
```

Puis ajouter la commande dans `.github/workflows/update-and-deploy.yml` pour que la mise à jour soit automatique.

## 3. Marque qui n'utilise pas Shopify

Écrire un adaptateur dans `scripts/fetch_catalog.py` et l'enregistrer dans `ADAPTERS`. Il doit fournir trois méthodes :

```python
class MonAdapter:
    def __init__(self, brand: dict): ...
    def list_products(self, locale: str | None) -> list[dict]:
        """Produits au format Shopify : handle, title, tags, options, variants (option1..3, price, available), images."""
    def product_url(self, handle: str, locale: str | None) -> str: ...
    def product_page(self, handle: str, locale: str | None) -> str: ...
```

Le plus simple est de convertir les données de la marque vers ce format. Toute la suite (classement, fusion des prix, niveaux) reste commune.

## 4. Saisir les dimensions (`specs.json`)

```jsonc
{
  "models": {
    "mon-modele": {
      "category": "board",
      "sourceChart": "https://… (image du tableau officiel)",
      "sizes": [{ "size": "5'4", "lengthCm": 162.6, "widthCm": 64, "thicknessCm": 14.7, "volumeL": 95,
                  "ofoNoseCm": 53, "ofoTailCm": 53.9, "rockerCm": 16.2, "weightKg": 6.6 }]
    }
  },
  "products": { "<handle du produit>": "mon-modele" }
}
```

Les libellés de taille doivent être identiques à ceux du catalogue. Champs par catégorie :

- **board** : `lengthCm, widthCm, thicknessCm, volumeL, ofoNoseCm, ofoTailCm, rockerCm, weightKg`
- **frontwing** : `spanCm, chordMm, thicknessMm, aspectRatio, areaCm2`
- **stab** : idem + `fuselageLengthCm`
- **wing** : `areaM2, spanCm, chordCm, weightKg, pressurePsi, windMinKts, windMaxKts, boomSize, boomLengthCm` (+ `aspectRatio` au niveau du modèle)

Lancer ensuite `npm test` : les tests vérifient que chaque silhouette respecte les cotes saisies.
