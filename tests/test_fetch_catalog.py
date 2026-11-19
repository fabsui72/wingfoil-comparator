"""Tests hors-ligne du script de récupération (aucun appel réseau)."""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import fetch_catalog as fc  # noqa: E402

BRAND = {
    "year": {"handlePattern": "-(2\\d)(?:[a-z]{0,6})?$", "imagePattern": "^(?:\\d\\d-)?(?:1500-)?(2\\d)-"},
    "id": "gong", "name": "Gong", "baseUrl": "https://example.com",
    "categories": {"board": ["main_collection:boards"], "wing": ["main_collection:wings"]},
    "excludeTitlePattern": "(?i)^(gong \\| )?pack",
    "sizeOptionNames": ["Taille"], "constructionOptionNames": ["Type"],
    "levels": [{"match": "débutants", "level": "beginner"}, {"match": "Pro Team Series", "level": "pro"}],
    "defaultLevel": "advanced",
    "series": [{"match": "Pro Team Series", "series": "Pro Team"}, {"match": "Team Series", "series": "Team"}],
    "programs": {"freeride": "Freeride", "wave": "Wave ?riding|Waveriding"},
}


def product(handle, title, tags, variants, options=None):
    return {
        "handle": handle, "title": title, "tags": tags, "images": [{"src": "https://cdn/x.png?v=1"}],
        "options": options or [{"name": "Type"}, {"name": "Taille"}, {"name": "Couleur"}],
        "variants": variants,
    }


def mint(price_a, price_b, compare_b=None):
    return product("mint-27", "GONG | Board Mint", ["main_collection:boards"], [
        {"option1": "FSP", "option2": "5’4", "option3": "Blue", "price": price_a, "available": False},
        {"option1": "FSP", "option2": "5’4", "option3": "Red", "price": price_b, "available": True,
         "compare_at_price": compare_b},
        {"option1": "FSP", "option2": "5'6", "option3": "Blue", "price": price_a, "available": False},
    ])


class FetchCatalogTest(unittest.TestCase):
    def test_build_catalog_merges_markets_and_filters(self):
        markets = {
            "CHF": [mint("733.00", "700.00"), product("pack", "GONG | Pack Wing", ["main_collection:boards"], []),
                    product("leash", "GONG | Leash", ["other"], [])],
            "EUR": [mint("799.00", "640.00", compare_b="799.00")],
        }
        catalog = fc.build_catalog(markets, BRAND, "CHF")
        self.assertEqual(len(catalog), 1)
        item = catalog[0]
        self.assertEqual(item["title"], "Board Mint")
        self.assertEqual(item["construction"], "FSP")
        self.assertEqual(item["image"], "https://cdn/x.png")
        self.assertEqual(item["year"], 2027)
        self.assertEqual(item["sizes"], [
            {"size": "5'4", "prices": {"CHF": 700.0, "EUR": 640.0}, "compareAt": {"EUR": 799.0}, "available": True},
            {"size": "5'6", "prices": {"CHF": 733.0, "EUR": 799.0}, "compareAt": {}, "available": False},
        ])

    def test_model_year(self):
        self.assertEqual(fc.model_year("gong-wing-droid-26nhnb", None, BRAND), 2026)
        self.assertEqual(fc.model_year("gong-foil-front-wing-fluid-h", "https://c/00-1500-25-FOIL.png", BRAND), 2025)
        self.assertEqual(fc.model_year("gong-foil-front-wing-fluid-atmo", "https://c/00-26-1500-FOIL.png", BRAND), 2026)
        self.assertIsNone(fc.model_year("x", None, BRAND))

    def test_parse_product_page(self):
        html = ('Categories: ["LOWKITE > X","WING FOIL > Planches | Planches débutants","WING FOIL > Planches | Perf Series"],'
                ' src="https://cdn.x.com/products/A-SIZE_CHART-B.webp?v=1" cdn.x.com/products/ACCESS-SIZE_CHART-C.webp')
        rules = {"categoriesPattern": r"Categories: \[(.*?)\]", "categoryPrefix": "WING FOIL",
                 "sizeChartPattern": r"cdn\.x\.com/products/[^\"'?\s]*SIZE_CHART[^\"'?\s]*", "ignoreChartPattern": "ACCESS"}
        page = fc.parse_product_page(html, rules)
        self.assertEqual(page["siteCategories"], ["WING FOIL > Planches | Planches débutants", "WING FOIL > Planches | Perf Series"])
        self.assertEqual(page["sizeCharts"], ["https://cdn.x.com/products/A-SIZE_CHART-B.webp"])

    def test_classify_level(self):
        self.assertEqual(fc.classify_level(["WING FOIL > Planches | Planches débutants", "Planches Freeride"], BRAND),
                         {"level": "beginner", "series": None, "programs": ["freeride"]})
        self.assertEqual(fc.classify_level(["Front wings | Pro Team Series", "Front Wings | Wave riding"], BRAND),
                         {"level": "pro", "series": "Pro Team", "programs": ["wave"]})
        self.assertEqual(fc.classify_level([], BRAND)["level"], "advanced")


if __name__ == "__main__":
    unittest.main()
