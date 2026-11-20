#!/usr/bin/env python3
"""Repère, parmi les photos produit des ailes avant et des stabs, la vue de DESSUS et
la vue de FACE -> data/<marque>/foilviews.json.

Les marques ne numérotent pas leurs photos de façon fiable : on classe donc chaque
photo d'après la forme de l'objet détouré :
  * photo d'ambiance (fond non uni)                 -> ignorée
  * objet symétrique, très plat (hauteur < 13 % de la largeur) -> vue de face
  * objet symétrique, plus haut                      -> vue de dessus
  * objet non symétrique (vue 3/4)                   -> ignorée

Pour chaque vue retenue on enregistre l'URL et le cadre de l'aile dans l'image, en
fractions de la largeur / hauteur (indépendant de la résolution demandée au CDN).
Le site met ensuite la photo à l'échelle : la largeur du cadre = envergure officielle.

Usage :
    python3 scripts/extract_foil_views.py gong [--debug DOSSIER]
Dépendances : Pillow, numpy.
"""
from __future__ import annotations

import argparse
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WORK_WIDTH = 600  # résolution d'analyse (le CDN Shopify redimensionne avec ?width=)
FRONT_MAX_RATIO = 0.13
MIN_SYMMETRY = 0.8


def fetch_image(url: str) -> Image.Image:
    sep = "&" if "?" in url else "?"
    req = urllib.request.Request(f"{url}{sep}width={WORK_WIDTH}", headers={"User-Agent": "wingfoil-comparator/0.2"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return Image.open(io.BytesIO(resp.read()))


def object_mask(img: Image.Image) -> np.ndarray | None:
    """Masque de l'objet ; None pour une photo d'ambiance (bord de l'image non uni)."""
    rgba = np.asarray(img.convert("RGBA")).astype(np.int16)
    alpha = rgba[..., 3]
    if (alpha < 250).mean() > 0.2:  # PNG détouré
        mask = alpha > 128
    else:  # JPG sur fond blanc
        lum = rgba[..., :3].mean(axis=2)
        mask = lum < 225
    border = np.concatenate([mask[0], mask[-1], mask[:, 0], mask[:, -1]])
    if border.mean() > 0.03:
        return None
    return mask


def largest_component(mask: np.ndarray) -> np.ndarray | None:
    """Plus grande composante connexe (élimine le texte « M 87 FLUID » des photos).
    None si l'image contient plusieurs objets comparables (photo de gamme)."""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    best, best_size, current = 0, 0, 0
    sizes: list[int] = []
    for sy, sx in zip(*np.nonzero(mask)):
        if labels[sy, sx]:
            continue
        current += 1
        stack, size = [(sy, sx)], 0
        labels[sy, sx] = current
        while stack:
            y, x = stack.pop()
            size += 1
            for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not labels[ny, nx]:
                    labels[ny, nx] = current
                    stack.append((ny, nx))
        sizes.append(size)
        if size > best_size:
            best, best_size = current, size
    if sorted(sizes)[-2:-1] and sorted(sizes)[-2] > 0.2 * best_size:
        return None
    return labels == best


OUTLINE_POINTS = 81


def rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    half = max(1, window // 2)
    padded = np.pad(values, half, mode="edge")
    return np.array([np.median(padded[i:i + 2 * half + 1]) for i in range(len(values))])


def trace_outline(crop: np.ndarray) -> dict:
    """Contour de l'aile vue de dessus : bord d'attaque (haut) et bord de fuite (bas)
    pour chaque colonne. Le moignon de mât / fuselage (étroit, au centre) est retiré
    par une médiane glissante : on ne garde que les écarts « vers l'intérieur »."""
    h, w = crop.shape
    le = np.full(w, np.nan)
    te = np.full(w, np.nan)
    for x in range(w):
        ys = np.nonzero(crop[:, x])[0]
        if len(ys):
            le[x], te[x] = ys[0], ys[-1]  # premier / dernier pixel : insensible aux reflets
    valid = ~np.isnan(le)
    xs = np.arange(w)
    le = np.interp(xs, xs[valid], le[valid])
    te = np.interp(xs, xs[valid], te[valid])
    # Mât et fuselage : pics étroits qui dépassent nettement de la courbe voisine.
    # On les repère par rapport à une médiane large, puis on les remplace par une
    # interpolation entre les colonnes saines (la vraie courbure est conservée).
    win = max(9, int(w * 0.3))
    tol = w * 0.012
    stub = (le < rolling_median(le, win) - tol) | (te > rolling_median(te, win) + tol)
    stub[:int(w * 0.25)] = stub[-int(w * 0.25):] = False  # seulement au centre
    if stub.any():
        idx = np.nonzero(stub)[0]
        lo, hi = max(idx.min() - 2, 0), min(idx.max() + 2, w - 1)
        stub[lo:hi + 1] = True
        ok = ~stub
        le[stub] = np.interp(xs[stub], xs[ok], le[ok])
        te[stub] = np.interp(xs[stub], xs[ok], te[ok])
    sample = np.linspace(0, w - 1, OUTLINE_POINTS)
    le_s, te_s = np.interp(sample, xs, le), np.interp(sample, xs, te)
    top = le_s.min()
    # Aux saumons, bords d'attaque et de fuite se rejoignent.
    mid = (le_s[[0, -1]] + te_s[[0, -1]]) / 2
    le_s[[0, -1]] = te_s[[0, -1]] = mid
    return {
        # ordonnées en fraction de la largeur (envergure) de l'aile dans la photo
        "le": [round(float(v), 4) for v in (le_s - top) / w],
        "te": [round(float(v), 4) for v in (te_s - top) / w],
        "topY": float(top),  # pixels, dans le recadrage
    }


def classify(img: Image.Image) -> dict | None:
    mask = object_mask(img)
    if mask is None or not mask.any():
        return None
    mask = largest_component(mask)
    if mask is None:
        return None
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    crop = mask[y0:y1, x0:x1]
    symmetry = (crop & crop[:, ::-1]).sum() / max(1, (crop | crop[:, ::-1]).sum())
    if symmetry < MIN_SYMMETRY:
        return None
    ratio = (y1 - y0) / (x1 - x0)
    h, w = mask.shape
    # Bande de l'aile : lignes où l'objet couvre plus de la moitié de l'envergure
    # (exclut le moignon de mât / fuselage qui dépasse au centre).
    widths = crop.sum(axis=1)
    band = np.nonzero(widths > 0.5 * (x1 - x0))[0]
    wing_top, wing_bottom = y0 + band[0], y0 + band[-1] + 1
    # Photo de gamme (plusieurs ailes empilées qui se touchent) : objet presque carré
    # et « large » sur presque toute sa hauteur.
    if ratio > 0.5 and len(band) > 0.4 * (y1 - y0):
        return None
    view = "front" if ratio < FRONT_MAX_RATIO else "top"
    outline = trace_outline(crop) if view == "top" else None
    return {
        "view": view,
        **({"outline": {"le": outline["le"], "te": outline["te"],
                        "topY": round((y0 + outline["topY"]) / h, 4)}} if outline else {}),
        "bbox": [round(x0 / w, 4), round(y0 / h, 4), round(x1 / w, 4), round(y1 / h, 4)],
        "wing": [round(wing_top / h, 4), round(wing_bottom / h, 4)],  # bande de l'aile (haut, bas)
        "aspect": round(h / w, 4),  # hauteur / largeur de l'image entière
        "symmetry": round(float(symmetry), 3),
    }


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("brand")
    parser.add_argument("--debug", type=Path)
    args = parser.parse_args(argv)

    sys.path.insert(0, str(Path(__file__).parent))
    import fetch_catalog as fc  # adaptateurs et configuration partagés

    brand = {b["id"]: b for b in json.loads((DATA / "brands.json").read_text())["brands"]}[args.brand]
    adapter = fc.ADAPTERS[brand["adapter"]](brand)
    primary = next((m for m in brand["markets"] if m.get("primary")), brand["markets"][0])
    raw = {p["handle"]: p for p in adapter.list_all(primary.get("locale"))[0]}
    catalog = json.loads((DATA / brand["id"] / "catalog.json").read_text())

    out: dict[str, dict] = {}
    for item in catalog["products"]:
        if item["category"] not in ("frontwing", "stab"):
            continue
        product = raw.get(item["handle"])
        if not product:
            continue
        views: dict[str, dict] = {}
        for image in product.get("images", [])[:10]:
            url = image["src"].split("?")[0]
            try:
                info = classify(fetch_image(url))
            except Exception as exc:  # une image illisible ne bloque pas les autres
                print(f"  erreur {item['handle']} : {exc}")
                continue
            time.sleep(0.1)
            if not info:
                continue
            kind = info.pop("view")
            # on garde, pour chaque vue, la photo la plus symétrique
            if kind not in views or info["symmetry"] > views[kind]["symmetry"]:
                views[kind] = {"src": url, **info}
                if args.debug:
                    args.debug.mkdir(parents=True, exist_ok=True)
                    fetch_image(url).convert("RGB").save(args.debug / f"{item['handle']}-{kind}.jpg")
        if views:
            out[item["handle"]] = views
        print(f"  {item['handle']}: {', '.join(sorted(views)) or '-'}")

    path = DATA / brand["id"] / "foilviews.json"
    path.write_text(json.dumps({"_comment": "Généré par scripts/extract_foil_views.py", "foils": out}, indent=1) + "\n")
    print(f"{len(out)} produits avec au moins une vue -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
