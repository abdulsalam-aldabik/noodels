"""Draw YOLO-seg polygons on smoke-dataset images.

This script is segmentation-aware (class + polygon points), unlike bbox-only viewers.
It writes class-colored overlays so annotations can be checked quickly.

Usage examples:
  python automation/vision-rebuild/overlay_smoke_labels.py
  python automation/vision-rebuild/overlay_smoke_labels.py debug-output/smoke-yolo-dataset --limit 10
    python automation/vision-rebuild/overlay_smoke_labels.py yolo_dataset --limit 10 --require-board-pin --skip-suspicious
"""

from __future__ import annotations

import argparse
import glob
import os
from pathlib import Path

from PIL import Image, ImageDraw


CLASS_NAMES = {
    0: "A",
    1: "B",
    2: "C",
    3: "D",
    4: "E",
    5: "F",
    6: "G",
    7: "H",
    8: "I",
    9: "J",
    10: "K",
    11: "board",
    12: "hinge",
    13: "pin",
}

CLASS_COLORS = {
    0: (249, 214, 94),
    1: (8, 167, 232),
    2: (32, 109, 217),
    3: (31, 161, 91),
    4: (238, 57, 79),
    5: (133, 218, 187),
    6: (236, 113, 168),
    7: (199, 120, 185),
    8: (252, 105, 12),
    9: (182, 48, 72),
    10: (149, 212, 80),
    11: (255, 255, 255),
    12: (255, 0, 255),
    13: (0, 255, 0),
}

PIECE_CLASS_IDS = set(range(0, 11))
FULLFRAME_EPS = 1e-3


def _read_seg_labels(label_path: Path):
    items = []
    if not label_path.exists():
        return items
    with open(label_path, "r", encoding="utf-8") as f:
        for line in f:
            parts = line.strip().split()
            if len(parts) < 7:
                continue
            try:
                cid = int(parts[0])
            except ValueError:
                continue
            coords = parts[1:]
            if len(coords) % 2 != 0:
                continue
            pts = []
            valid = True
            for i in range(0, len(coords), 2):
                try:
                    x = float(coords[i])
                    y = float(coords[i + 1])
                except ValueError:
                    valid = False
                    break
                pts.append((x, y))
            if valid and len(pts) >= 3:
                items.append((cid, pts))
    return items


def _is_fullframe_polygon(norm_pts):
    xs = [p[0] for p in norm_pts]
    ys = [p[1] for p in norm_pts]
    return (
        len(norm_pts) == 4
        and min(xs) <= FULLFRAME_EPS
        and min(ys) <= FULLFRAME_EPS
        and max(xs) >= (1.0 - FULLFRAME_EPS)
        and max(ys) >= (1.0 - FULLFRAME_EPS)
    )


def _label_meta(label_path: Path):
    labels = _read_seg_labels(label_path)
    class_ids = {cid for cid, _ in labels}
    has_fullframe_piece = any(
        cid in PIECE_CLASS_IDS and _is_fullframe_polygon(norm_pts)
        for cid, norm_pts in labels
    )
    return {
        "class_ids": class_ids,
        "has_board_pin": 11 in class_ids and 13 in class_ids,
        "has_fullframe_piece": has_fullframe_piece,
    }


def _to_pixel_points(norm_pts, width, height):
    out = []
    for x, y in norm_pts:
        px = int(round(max(0.0, min(1.0, x)) * width))
        py = int(round(max(0.0, min(1.0, y)) * height))
        out.append((px, py))
    return out


def draw_overlay(image_path: Path, label_path: Path, out_path: Path):
    image = Image.open(image_path).convert("RGBA")
    w, h = image.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer, "RGBA")

    class_counts = {}
    for cid, norm_pts in _read_seg_labels(label_path):
        class_counts[cid] = class_counts.get(cid, 0) + 1
        rgb = CLASS_COLORS.get(cid, (255, 255, 0))
        px_pts = _to_pixel_points(norm_pts, w, h)

        fill_alpha = 90
        outline_alpha = 255
        if cid == 11:
            fill_alpha = 30
        if cid == 13:
            fill_alpha = 120

        draw.polygon(px_pts, fill=(rgb[0], rgb[1], rgb[2], fill_alpha), outline=(rgb[0], rgb[1], rgb[2], outline_alpha))

        anchor = px_pts[0]
        label = CLASS_NAMES.get(cid, str(cid))
        draw.text((anchor[0] + 3, anchor[1] + 3), label, fill=(rgb[0], rgb[1], rgb[2], 255))

    composed = Image.alpha_composite(image, layer).convert("RGB")
    composed.save(out_path)

    summary = ", ".join(f"{CLASS_NAMES.get(k, k)}:{v}" for k, v in sorted(class_counts.items()))
    print(f"{image_path.name}: {summary}")


def _parse_args():
    parser = argparse.ArgumentParser(description="Draw segmentation overlays for smoke dataset")
    parser.add_argument(
        "root",
        nargs="?",
        default=os.path.join("debug-output", "smoke-yolo-dataset"),
        help="Dataset root containing images/ and labels/",
    )
    parser.add_argument("--limit", type=int, default=10, help="Maximum number of images to overlay")
    parser.add_argument(
        "--out-dir",
        type=str,
        default="annotated-overlays",
        help="Output folder name under dataset root",
    )
    parser.add_argument(
        "--require-board-pin",
        action="store_true",
        help="Only render labels that contain both class 11 (board) and class 13 (pin)",
    )
    parser.add_argument(
        "--skip-suspicious",
        action="store_true",
        help="Skip labels that contain full-frame polygons assigned to piece classes",
    )
    return parser.parse_args()


def main():
    args = _parse_args()
    root = Path(args.root).resolve()
    out_dir = root / args.out_dir
    out_dir.mkdir(parents=True, exist_ok=True)

    rendered = 0
    skipped = 0
    limit = max(1, int(args.limit))

    for split in ("train", "val"):
        img_paths = sorted(glob.glob(str(root / "images" / split / "*.png")))
        for image_str in img_paths:
            if rendered >= limit:
                break
            image_path = Path(image_str)
            stem = image_path.stem
            label_path = root / "labels" / split / f"{stem}.txt"
            if not label_path.exists():
                continue

            meta = _label_meta(label_path)
            if args.require_board_pin and not meta["has_board_pin"]:
                skipped += 1
                continue
            if args.skip_suspicious and meta["has_fullframe_piece"]:
                skipped += 1
                continue

            out_path = out_dir / f"{split}_{stem}_overlay.png"
            draw_overlay(image_path, label_path, out_path)
            rendered += 1
        if rendered >= limit:
            break

    print(f"Wrote {rendered} overlay images to {out_dir}")
    if skipped:
        print(f"Skipped {skipped} images due to active filters")


if __name__ == "__main__":
    main()
