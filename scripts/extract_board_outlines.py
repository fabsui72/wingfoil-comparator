#!/usr/bin/env python3
"""Extrait la forme des boards depuis les photos produits -> data/<marque>/outlines.json.

Les photos "TB" de Gong montrent, sur fond transparent, de gauche à droite :
la vue de dessus (deck, au premier plan), la vue de dessous (en retrait, donc
plus petite à cause de la perspective) et la vue de profil.

On extrait, en coordonnées normalisées (indépendantes de la taille) :
  - top  : demi-largeur / demi-largeur max, en N stations du nez (s=0) à l'arrière (s=1),
           à partir du rail gauche de la vue de dessus (jamais masqué) et de l'axe
           donné par la pointe du nez ;
  - side : pont et dessous, en fraction de la longueur, depuis la vue de profil
           (les straps qui dépassent du pont sont filtrés).

Le site recale ensuite ces profils sur les cotes officielles (longueur, largeur,
largeurs à 1 pied, épaisseur).

Usage :
    python3 scripts/extract_board_outlines.py gong [--debug DOSSIER]

Dépendances : Pillow, numpy (uniquement pour ce script).
"""
from __future__ import annotations

import argparse
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
STATIONS = 101  # résolution des profils normalisés
ALPHA_MIN = 128


def load_rgba(url: str) -> np.ndarray:
    req = urllib.request.Request(url, headers={"User-Agent": "wingfoil-comparator/0.1"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return np.asarray(Image.open(io.BytesIO(resp.read())).convert("RGBA"))


def column_segments(mask: np.ndarray, min_width: int = 20) -> list[tuple[int, int]]:
    """Groupes de colonnes contenant des pixels opaques (séparés par du vide)."""
    cols = mask.any(axis=0)
    segs, start = [], None
    for x, c in enumerate(np.append(cols, False)):
        if c and start is None:
            start = x
        elif not c and start is not None:
            if x - start >= min_width:
                segs.append((start, x))
            start = None
    return segs


def resample(values: np.ndarray, n: int = STATIONS) -> np.ndarray:
    src = np.linspace(0.0, 1.0, len(values))
    return np.interp(np.linspace(0.0, 1.0, n), src, values)


def normalized(values: np.ndarray) -> np.ndarray:
    return values / values.max()


def rolling_median(values: np.ndarray, window: int) -> np.ndarray:
    half = max(1, window // 2)
    padded = np.pad(values, half, mode="edge")
    return np.array([np.median(padded[i:i + 2 * half + 1]) for i in range(len(values))])


def first_run(row: np.ndarray) -> tuple[int, int]:
    """Première série contiguë de pixels opaques d'une ligne : (début, fin incluse)."""
    xs = np.where(row)[0]
    gaps = np.where(np.diff(xs) > 1)[0]
    return int(xs[0]), int(xs[gaps[0]] if len(gaps) else xs[-1])


def trace_deck_ends(mask: np.ndarray, rows: np.ndarray) -> tuple[int, int]:
    """Nez et arrière du deck, en suivant la série la plus à gauche depuis la ligne la plus large.

    La vue de dessous, en retrait, peut dépasser plus haut ou plus bas que le deck :
    on s'arrête dès que la série la plus à gauche ne touche plus celle de la ligne voisine.
    """
    lefts = {y: first_run(mask[y]) for y in rows}
    widest = min(lefts, key=lambda y: lefts[y][0])

    def walk(step: int) -> int:
        y, (a, b) = widest, lefts[widest]
        while (y + step) in lefts:
            na, nb = lefts[y + step]
            if na > b or nb < a:  # plus de recouvrement : on a quitté le deck
                break
            y, a, b = y + step, na, nb
        return y

    return walk(-1), walk(1)


def top_profile(mask: np.ndarray) -> dict:
    """Demi-largeur normalisée depuis la vue de dessus (premier groupe de colonnes)."""
    rows = np.where(mask.any(axis=1))[0]
    nose, tail = trace_deck_ends(mask, rows)
    # Axe : centre de la pointe du nez du deck (les premières lignes sont symétriques).
    tip = range(nose, nose + max(3, (tail - nose) // 150))
    axis = float(np.median([sum(first_run(mask[y])) / 2 for y in tip]))
    left = np.array([first_run(mask[y])[0] for y in range(nose, tail + 1)], dtype=float)
    half = np.clip(axis - left, 0, None)
    return {
        "nose": int(nose),
        "axis": axis,
        "lengthPx": int(tail - nose + 1),
        "maxHalfPx": float(half.max()),
        "half": normalized(resample(half)),
    }


def bottom_frame(mask: np.ndarray, top: dict) -> dict | None:
    """Vue de dessous (derrière la vue de dessus, décalée à droite) : seul son rail droit
    est entièrement visible. On repère nez, arrière, axe et demi-largeur max."""
    h = mask.shape[0]
    nose, L, axis, half_px = top["nose"], top["lengthPx"], top["axis"], top["maxHalfPx"]
    deck_half = np.interp(np.arange(h), nose + np.linspace(0, L - 1, len(top["half"])), np.array(top["half"]) * half_px,
                          left=0, right=0)
    right = np.full(h, -1.0)
    for y in np.where(mask.any(axis=1))[0]:
        right[y] = np.where(mask[y])[0][-1]
    beyond = right > axis + deck_half + 3
    beyond &= right >= 0
    rows = np.where(beyond)[0]
    if len(rows) < L * 0.5:
        return None
    b_nose, b_tail = int(rows[0]), int(rows[-1])
    tip = range(b_nose, b_nose + max(3, (b_tail - b_nose) // 150))
    centers = []
    for y in tip:
        xs = np.where(mask[y])[0]
        gaps = np.where(np.diff(xs) > 1)[0]
        start = xs[gaps[-1] + 1] if len(gaps) else xs[0]
        centers.append((start + xs[-1]) / 2)
    b_axis = float(np.median(centers))
    b_half = float(max(right[y] - b_axis for y in rows))
    return {"noseY": b_nose, "lengthPx": b_tail - b_nose + 1, "axisX": round(b_axis, 1), "halfPx": round(b_half, 1)}


def side_profile(mask: np.ndarray) -> dict:
    """Pont et dessous depuis la vue de profil (dernier groupe de colonnes)."""
    rows = np.where(mask.any(axis=1))[0]
    nose, tail = rows[0], rows[-1]
    n = tail - nose + 1
    # Les straps forment des boucles qui dépassent du pont, avec du vide à l'intérieur :
    # on garde la série de pixels qui contient le dessous (la plus à droite), puis une
    # médiane courte efface les points d'ancrage des straps.
    deck = np.empty(n)
    bottom = np.empty(n)
    for i, y in enumerate(range(nose, tail + 1)):
        xs = np.where(mask[y])[0]
        gaps = np.where(np.diff(xs) > 1)[0]
        deck[i] = xs[gaps[-1] + 1] if len(gaps) else xs[0]
        bottom[i] = xs[-1]
    deck = rolling_median(deck, max(5, int(n * 0.05)))
    # Strap fermé (sans vide) : bosse vers l'extérieur (x plus petit). On ne corrige que
    # ces bosses, pour garder le creux réel du pont au niveau du pad.
    wide = rolling_median(deck, max(9, int(n * 0.22)))
    start = int(n * 0.15)
    tol = n * 0.002
    bump = deck[start:] < wide[start:] - tol
    deck[start:][bump] = wide[start:][bump]
    bottom = rolling_median(bottom, 5)
    ref = bottom.max()  # point le plus bas du dessous = référence du rocker
    return {
        "nose": int(nose),
        "ref": float(ref),
        "lengthPx": int(n),
        # hauteurs au-dessus du point bas, en fraction de la longueur
        "deck": resample((ref - deck) / n),
        "bottom": resample((ref - bottom) / n),
    }


def extract(url: str, debug_dir: Path | None = None, name: str = "") -> dict | None:
    img = load_rgba(url)
    mask = img[..., 3] >= ALPHA_MIN
    segs = column_segments(mask)
    if len(segs) < 2:
        return None  # mise en page inattendue (ex. photo d'ambiance)
    top_seg, side_seg = segs[0], segs[-1]
    top = top_profile(mask[:, top_seg[0]:top_seg[1]])
    side = side_profile(mask[:, side_seg[0]:side_seg[1]])
    width_ratio = 2 * top["maxHalfPx"] / top["lengthPx"]
    bottom = bottom_frame(mask[:, top_seg[0]:top_seg[1]], top)
    if debug_dir:
        save_debug(debug_dir / f"{name}.png", img, top, side, top_seg, side_seg)
    return {
        "source": url,
        "widthToLength": round(width_ratio, 4),
        "top": [round(v, 4) for v in top["half"]],
        "deck": [round(v, 5) for v in side["deck"]],
        "bottom": [round(v, 5) for v in side["bottom"]],
        # Position de la vue de dessus dans la photo (pixels), pour afficher la photo
        # elle-même à l'échelle : nez, longueur, axe et demi-largeur max.
        "photo": {
            "width": int(img.shape[1]),
            "height": int(img.shape[0]),
            "noseY": top["nose"],
            "lengthPx": top["lengthPx"],
            "axisX": round(top_seg[0] + top["axis"], 1),
            "halfPx": round(top["maxHalfPx"], 1),
            # vue de dessous (rail droit visible) et vue de profil (pour le profil photo)
            "bottom": None if bottom is None else {**bottom, "axisX": round(top_seg[0] + bottom["axisX"], 1)},
            "side": {"noseY": side["nose"], "lengthPx": side["lengthPx"], "refX": round(side_seg[0] + side["ref"], 1)},
        },
    }


def save_debug(path: Path, img: np.ndarray, top: dict, side: dict, top_seg, side_seg) -> None:
    """Superpose les profils extraits sur la photo pour contrôle visuel."""
    from PIL import ImageDraw
    canvas = Image.fromarray(img).convert("RGBA")
    bg = Image.new("RGBA", canvas.size, (255, 255, 255, 255))
    bg.alpha_composite(canvas)
    draw = ImageDraw.Draw(bg)
    axis, nose, L = top_seg[0] + top["axis"], top["nose"], top["lengthPx"]
    for sign in (-1, 1):
        pts = [(axis + sign * h * top["maxHalfPx"], nose + i / (STATIONS - 1) * (L - 1)) for i, h in enumerate(top["half"])]
        draw.line(pts, fill=(255, 0, 0, 255), width=3)
    ref, sn, n = side_seg[0] + side["ref"], side["nose"], side["lengthPx"]
    for key, color in (("deck", (255, 0, 0, 255)), ("bottom", (0, 160, 0, 255))):
        pts = [(ref - v * n, sn + i / (STATIONS - 1) * (n - 1)) for i, v in enumerate(side[key])]
        draw.line(pts, fill=color, width=3)
    path.parent.mkdir(parents=True, exist_ok=True)
    bg.convert("RGB").save(path)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("brand")
    parser.add_argument("--debug", type=Path, help="dossier où écrire les images de contrôle")
    args = parser.parse_args(argv)

    catalog = json.loads((DATA / args.brand / "catalog.json").read_text())
    out: dict[str, dict] = {}
    for product in catalog["products"]:
        if product["category"] != "board" or not product.get("image"):
            continue
        # Seules les photos "TB" (dessus/dessous/profil) ont la bonne mise en page.
        if not re.search(r"-TB(_[0-9a-f-]+)?\.png$", product["image"], re.I):
            print(f"  ignoré (photo non exploitable) : {product['handle']}")
            continue
        try:
            outline = extract(product["image"], args.debug, product["handle"])
        except Exception as exc:  # une photo défaillante ne doit pas bloquer les autres
            print(f"  erreur {product['handle']} : {exc}")
            continue
        if outline:
            # Taille photographiée, lue dans le nom de fichier (ex. "...-MINT-5_4-GONGWING-TB.png").
            m = re.search(r"-(\d)_(\d{1,2})-", product["image"])
            outline["photoSize"] = f"{m.group(1)}'{m.group(2)}" if m else None
            out[product["handle"]] = outline
            print(f"  ok {product['handle']}  largeur/longueur photo = {outline['widthToLength']}")
    path = DATA / args.brand / "outlines.json"
    path.write_text(json.dumps({"_comment": "Généré par scripts/extract_board_outlines.py", "boards": out}, separators=(",", ":")) + "\n")
    print(f"{len(out)} silhouettes -> {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
