"""Tests hors-ligne du script de récupération (aucun appel réseau)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_catalog as fc  # noqa: E402

BRAND = {
    "id": "gong", "name": "Gong", "baseUrl": "https://example.com", "locale": "fr-ch", "currency": "CHF",
    "categories": {"board": ["main_collection:boards"], "wing": ["main_collection:wings"]},
    "excludeTitlePattern": "(?i)^pack",
    "sizeOptionNames": ["Taille"], "constructionOptionNames": ["Type"],
}


def product(handle, title, tags, variants, options=None):
    return {
        "handle": handle, "title": title, "tags": tags, "images": [{"src": "https://cdn/x.png?v=1"}],
        "options": options or [{"name": "Type"}, {"name": "Taille"}, {"name": "Couleur"}],
        "variants": variants,
    }


class FetchCatalogTest(unittest.TestCase):
    def test_build_catalog_filters_and_merges_variants(self):
        raw = [
            product("mint", "GONG | Board Mint", ["main_collection:boards"], [
                {"option1": "FSP", "option2": "5’4", "option3": "Blue", "price": "733.00", "available": False},
                {"option1": "FSP", "option2": "5’4", "option3": "Red", "price": "700.00", "available": True},
                {"option1": "FSP", "option2": "5'6", "option3": "Blue", "price": "733.00", "available": False},
            ]),
            product("pack", "Pack Wing", ["main_collection:boards"], []),
            product("leash", "GONG | Leash", ["other"], []),
        ]
        catalog = fc.build_catalog(raw, BRAND)
        self.assertEqual(len(catalog), 1)
        item = catalog[0]
        self.assertEqual(item["title"], "Board Mint")
        self.assertEqual(item["construction"], "FSP")
        self.assertEqual(item["image"], "https://cdn/x.png")
        self.assertEqual(item["url"], "https://example.com/fr-ch/products/mint")
        self.assertEqual(item["sizes"], [
            {"size": "5'4", "price": 700.0, "available": True},
            {"size": "5'6", "price": 733.0, "available": False},
        ])

    def test_find_size_charts(self):
        html = 'src="https://cdn.x.com/products/A-SIZE_CHART-B.webp?v=1" x cdn.x.com/products/A-SIZE_CHART-B.webp'
        self.assertEqual(fc.find_size_charts(html, r"cdn\.x\.com/products/[^\"'?\s]*SIZE_CHART[^\"'?\s]*"),
                         ["https://cdn.x.com/products/A-SIZE_CHART-B.webp"])


if __name__ == "__main__":
    unittest.main()
