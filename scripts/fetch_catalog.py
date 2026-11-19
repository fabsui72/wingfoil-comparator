#!/usr/bin/env python3
"""Récupère le catalogue d'une marque et l'écrit dans data/<marque>/catalog.json.

Usage :
    python3 scripts/fetch_catalog.py gong
    python3 scripts/fetch_catalog.py gong --no-pages   # plus rapide : sans niveaux ni tableaux de tailles

La configuration de chaque marque est dans data/brands.json. Le travail est
découpé en deux parties :

  * un ADAPTATEUR par plateforme de vente (aujourd'hui : "shopify"), qui sait
    lister les produits bruts d'un marché (pays / langue / devise) et lire la
    page d'un produit ;
  * une partie COMMUNE, qui classe les produits (board, frontwing, stab, wing),
    fusionne les prix des différents marchés et applique les règles de niveau
    et de programme décrites dans brands.json.

Pour ajouter une marque sur une autre plateforme, il suffit d'écrire un nouvel
adaptateur (voir docs/ajouter-une-marque.md) : le format de sortie ne change pas.

Le script n'utilise que la bibliothèque standard.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
USER_AGENT = "wingfoil-comparator/0.2 (catalog fetcher)"
PAGE_LIMIT = 250
CATEGORIES = ("board", "frontwing", "stab", "wing")


def http_get(url: str, retries: int = 3) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.read()
        except OSError:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)
    raise RuntimeError("unreachable")


# --------------------------------------------------------------------------- #
# Adaptateur Shopify                                                           #
# --------------------------------------------------------------------------- #
class ShopifyAdapter:
    """Boutiques Shopify : /<locale>/collections/<collection>/products.json."""

    def __init__(self, brand: dict):
        self.brand = brand

    def base(self, locale: str | None) -> str:
        return f"{self.brand['baseUrl']}/{locale}" if locale else self.brand["baseUrl"]

    def list_products(self, locale: str | None) -> list[dict]:
        products, page = [], 1
        while True:
            url = f"{self.base(locale)}/collections/{self.brand['collection']}/products.json?limit={PAGE_LIMIT}&page={page}"
            batch = json.loads(http_get(url))["products"]
            products.extend(batch)
            if len(batch) < PAGE_LIMIT:
                return products
            page += 1

    def product_url(self, handle: str, locale: str | None) -> str:
        return f"{self.base(locale)}/products/{handle}"

    def product_page(self, handle: str, locale: str | None) -> str:
        return http_get(self.product_url(handle, locale)).decode("utf-8", errors="replace")


ADAPTERS = {"shopify": ShopifyAdapter}


# --------------------------------------------------------------------------- #
# Partie commune                                                               #
# --------------------------------------------------------------------------- #
def normalize_size(label: str) -> str:
    """Uniformise un libellé de taille : apostrophes typographiques, espaces."""
    s = label.strip().replace("’", "'").replace("′", "'").replace("”", '"')
    return re.sub(r"\s+", " ", s)


def option_value(product: dict, variant: dict, names: list[str]) -> str | None:
    for idx, opt in enumerate(product.get("options", []), start=1):
        if opt.get("name") in names:
            return variant.get(f"option{idx}")
    return None


def classify(product: dict, categories: dict[str, list[str]]) -> str | None:
    tags = set(product.get("tags", []))
    for category, wanted in categories.items():
        if tags.intersection(wanted):
            return category
    return None


def clean_title(title: str, brand: dict) -> str:
    return re.sub(rf"^{re.escape(brand['name'])}\s*\|\s*", "", title, flags=re.I).strip()


def sizes_of(product: dict, brand: dict) -> tuple[dict[str, dict], str | None]:
    """Tailles d'un produit : prix minimal, prix barré (promo) et disponibilité, par taille."""
    size_names = brand.get("sizeOptionNames", ["Size"])
    constr_names = brand.get("constructionOptionNames", [])
    sizes: dict[str, dict] = {}
    construction = None
    for v in product.get("variants", []):
        size = option_value(product, v, size_names)
        if not size:
            continue
        size = normalize_size(size)
        construction = construction or option_value(product, v, constr_names)
        price = float(v["price"])
        compare = float(v["compare_at_price"]) if v.get("compare_at_price") else None
        compare = compare if compare and compare > price else None
        entry = sizes.setdefault(size, {"price": price, "compareAt": compare, "available": False})
        if price < entry["price"] or (price == entry["price"] and compare and not entry["compareAt"]):
            entry["price"], entry["compareAt"] = price, compare
        entry["available"] = entry["available"] or bool(v.get("available"))
    return sizes, construction


def build_catalog(markets: dict[str, list[dict]], brand: dict, primary: str) -> list[dict]:
    """Fusionne les produits des différents marchés (prix par devise)."""
    exclude = re.compile(brand["excludeTitlePattern"]) if brand.get("excludeTitlePattern") else None
    by_market = {cur: {p["handle"]: p for p in prods} for cur, prods in markets.items()}
    out, seen = [], set()
    for p in markets[primary]:
        if p["handle"] in seen or (exclude and exclude.search(p["title"])):
            continue
        category = classify(p, brand["categories"])
        if not category:
            continue
        seen.add(p["handle"])
        sizes, construction = sizes_of(p, brand)
        if not sizes:
            continue
        prices_by_cur = {}
        for cur, index in by_market.items():
            other = index.get(p["handle"])
            if other:
                prices_by_cur[cur] = sizes_of(other, brand)[0]
        images = p.get("images") or []
        image = images[0]["src"].split("?")[0] if images else None
        out.append({
            "handle": p["handle"],
            "title": clean_title(p["title"], brand),
            "category": category,
            "construction": construction,
            "image": image,
            "year": model_year(p["handle"], image, brand),
            "sizes": [
                {
                    "size": label,
                    "prices": {cur: s[label]["price"] for cur, s in prices_by_cur.items() if label in s},
                    "compareAt": {cur: s[label]["compareAt"] for cur, s in prices_by_cur.items()
                                  if label in s and s[label]["compareAt"]},
                    "available": info["available"],
                }
                for label, info in sizes.items()
            ],
        })
    out.sort(key=lambda i: (CATEGORIES.index(i["category"]), i["title"]))
    return out


def model_year(handle: str, image: str | None, brand: dict) -> int | None:
    """Année du modèle : d'abord dans l'adresse produit (Gong : "-27"), sinon code de
    collection en tête du nom de la photo ("26-1500-..." ou "00-1500-25-...")."""
    rules = brand.get("year", {})
    m = re.search(rules["handlePattern"], handle) if rules.get("handlePattern") else None
    if not m and image and rules.get("imagePattern"):
        m = re.search(rules["imagePattern"], image.rsplit("/", 1)[-1])
    return 2000 + int(m.group(1)) if m else None


def parse_product_page(html: str, rules: dict) -> dict:
    """Catégories du site (pour niveau / programme / série) et tableaux de tailles."""
    cats: list[str] = []
    m = re.search(rules.get("categoriesPattern", r"(?!)"), html)
    if m:
        try:
            cats = json.loads("[" + m.group(1) + "]")
        except json.JSONDecodeError:
            cats = []
    prefix = rules.get("categoryPrefix")
    if prefix:
        cats = [c for c in cats if c.startswith(prefix)]
    charts = sorted({"https://" + c for c in re.findall(rules.get("sizeChartPattern", r"(?!)"), html)})
    ignore = rules.get("ignoreChartPattern")
    if ignore:
        charts = [c for c in charts if not re.search(ignore, c)]
    return {"siteCategories": cats, "sizeCharts": charts}


def classify_level(site_categories: list[str], brand: dict) -> dict:
    """Niveau (beginner / advanced / pro), série et programmes, d'après les catégories du site."""
    text = " | ".join(site_categories)
    level = next((r["level"] for r in brand.get("levels", []) if r["match"] in text), brand.get("defaultLevel"))
    series = next((r["series"] for r in brand.get("series", []) if r["match"] in text), None)
    programs = [key for key, pattern in brand.get("programs", {}).items() if re.search(pattern, text, re.I)]
    return {"level": level, "series": series, "programs": programs}


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("brand", help="identifiant de la marque (voir data/brands.json)")
    parser.add_argument("--no-pages", action="store_true", help="ne pas lire les pages produit (pas de niveaux ni de tableaux de tailles)")
    args = parser.parse_args(argv)

    brands = {b["id"]: b for b in json.loads((DATA / "brands.json").read_text())["brands"]}
    if args.brand not in brands:
        parser.error(f"marque inconnue : {args.brand} (disponibles : {', '.join(brands)})")
    brand = brands[args.brand]
    if brand["adapter"] not in ADAPTERS:
        parser.error(f"adaptateur non supporté : {brand['adapter']}")
    adapter = ADAPTERS[brand["adapter"]](brand)

    markets = brand["markets"]
    primary = next((m for m in markets if m.get("primary")), markets[0])
    raw = {m["currency"]: adapter.list_products(m.get("locale")) for m in markets}
    catalog = build_catalog(raw, brand, primary["currency"])

    for item in catalog:
        item["url"] = adapter.product_url(item["handle"], primary.get("locale"))
        item["urls"] = {m["currency"]: adapter.product_url(item["handle"], m.get("locale")) for m in markets}
        if not args.no_pages and brand.get("productPage"):
            page = parse_product_page(adapter.product_page(item["handle"], primary.get("locale")), brand["productPage"])
            item.update(page)
            item.update(classify_level(page["siteCategories"], brand))
            del item["siteCategories"]
            time.sleep(0.2)  # rester poli avec le serveur

    out_dir = DATA / brand["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "brand": brand["id"],
        "brandName": brand["name"],
        "currencies": [m["currency"] for m in markets],
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "products": catalog,
    }
    (out_dir / "catalog.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
    counts: dict[str, int] = {}
    for item in catalog:
        counts[item["category"]] = counts.get(item["category"], 0) + 1
    print(f"{len(raw[primary['currency']])} produits bruts -> {len(catalog)} retenus {counts} -> {out_dir / 'catalog.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
