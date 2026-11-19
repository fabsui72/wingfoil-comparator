#!/usr/bin/env python3
"""Récupère le catalogue d'une marque et l'écrit dans data/<marque>/catalog.json.

Usage :
    python3 scripts/fetch_catalog.py gong
    python3 scripts/fetch_catalog.py gong --with-charts   # + URLs des tableaux de tailles

La configuration de chaque marque est dans data/brands.json. Seul l'adaptateur
"shopify" existe pour l'instant (la plupart des marques de wingfoil utilisent
Shopify, qui expose /collections/<handle>/products.json).

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
USER_AGENT = "wingfoil-comparator/0.1 (catalog fetcher)"
PAGE_LIMIT = 250


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


def normalize_size(label: str) -> str:
    """Uniformise un libellé de taille : apostrophes typographiques, espaces, '3,5 m²'."""
    s = label.strip().replace("’", "'").replace("′", "'").replace("”", '"')
    s = re.sub(r"\s+", " ", s)
    return s


def option_values(product: dict, variant: dict, names: list[str]) -> str | None:
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


def shape_product(product: dict, brand: dict, category: str) -> dict:
    """Transforme un produit Shopify brut en entrée de catalogue compacte."""
    size_names = brand.get("sizeOptionNames", ["Size"])
    constr_names = brand.get("constructionOptionNames", [])
    sizes: dict[str, dict] = {}
    construction = None
    for v in product.get("variants", []):
        size = option_values(product, v, size_names)
        if not size:
            continue
        size = normalize_size(size)
        construction = construction or option_values(product, v, constr_names)
        price = float(v["price"])
        entry = sizes.setdefault(size, {"size": size, "price": price, "available": False})
        entry["price"] = min(entry["price"], price)
        entry["available"] = entry["available"] or bool(v.get("available"))
    images = product.get("images") or []
    base = f"{brand['baseUrl']}/{brand['locale']}" if brand.get("locale") else brand["baseUrl"]
    return {
        "handle": product["handle"],
        "title": product["title"].replace(f"{brand['name'].upper()} | ", "").strip(),
        "category": category,
        "construction": construction,
        "url": f"{base}/products/{product['handle']}",
        "image": images[0]["src"].split("?")[0] if images else None,
        "currency": brand.get("currency"),
        "sizes": list(sizes.values()),
    }


def fetch_shopify(brand: dict) -> list[dict]:
    base = f"{brand['baseUrl']}/{brand['locale']}" if brand.get("locale") else brand["baseUrl"]
    products, page = [], 1
    while True:
        url = f"{base}/collections/{brand['collection']}/products.json?limit={PAGE_LIMIT}&page={page}"
        batch = json.loads(http_get(url))["products"]
        products.extend(batch)
        if len(batch) < PAGE_LIMIT:
            return products
        page += 1


def build_catalog(raw_products: list[dict], brand: dict) -> list[dict]:
    exclude = re.compile(brand["excludeTitlePattern"]) if brand.get("excludeTitlePattern") else None
    seen, out = set(), []
    for p in raw_products:
        title = p["title"].replace(f"{brand['name'].upper()} | ", "")
        if exclude and exclude.search(title):
            continue
        category = classify(p, brand["categories"])
        if not category or p["handle"] in seen:
            continue
        seen.add(p["handle"])
        item = shape_product(p, brand, category)
        if item["sizes"]:
            out.append(item)
    out.sort(key=lambda i: (i["category"], i["title"]))
    return out


def find_size_charts(page_html: str, pattern: str) -> list[str]:
    return sorted({"https://" + m for m in re.findall(pattern, page_html)})


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("brand", help="identifiant de la marque (voir data/brands.json)")
    parser.add_argument("--with-charts", action="store_true", help="récupérer les URLs des tableaux de tailles (1 requête par produit)")
    args = parser.parse_args(argv)

    brands = {b["id"]: b for b in json.loads((DATA / "brands.json").read_text())["brands"]}
    if args.brand not in brands:
        parser.error(f"marque inconnue : {args.brand} (disponibles : {', '.join(brands)})")
    brand = brands[args.brand]
    if brand["adapter"] != "shopify":
        parser.error(f"adaptateur non supporté : {brand['adapter']}")

    raw = fetch_shopify(brand)
    catalog = build_catalog(raw, brand)

    if args.with_charts and brand.get("sizeChartPattern"):
        for item in catalog:
            html = http_get(item["url"]).decode("utf-8", errors="replace")
            item["sizeCharts"] = find_size_charts(html, brand["sizeChartPattern"])
            time.sleep(0.3)  # rester poli avec le serveur

    out_dir = DATA / brand["id"]
    out_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "brand": brand["id"],
        "brandName": brand["name"],
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "products": catalog,
    }
    (out_dir / "catalog.json").write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n")
    counts = {}
    for item in catalog:
        counts[item["category"]] = counts.get(item["category"], 0) + 1
    print(f"{len(raw)} produits bruts -> {len(catalog)} retenus {counts} -> {out_dir / 'catalog.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
