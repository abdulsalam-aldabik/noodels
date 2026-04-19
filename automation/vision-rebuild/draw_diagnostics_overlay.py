"""
Draw per-piece + pin overlay on solved-diagnostics attempt PNGs.

Reads `report.json` produced by blender_solved_diagnostics.py and renders
an annotated copy of each attempt_XX.png:
  - 21 pins (green circles + index labels): where the solver says a piece
    endpoint should thread through.
  - Per-piece expected cell centers (colored dots connected by a polyline):
    where the solved-layout logic says each cell of that piece should sit.
  - Per-piece actual bbox center (colored X): where the placed mesh actually is.
  - Thin white line from actual -> expected anchor: the error vector.
  - Label: piece letter + "rN" (rotation_steps) and "M" suffix if mirrored.

Runs with the system Python (PIL only), not Blender.

Usage:
  python automation/vision-rebuild/draw_diagnostics_overlay.py [folder]

If no folder is given, uses the newest `debug-output/solved-diagnostics-*`.
"""
import glob
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont


PIECE_COLORS = {
    "piece_A": (255,  99,  71),
    "piece_B": (100, 149, 237),
    "piece_C": (255, 215,   0),
    "piece_D": (186,  85, 211),
    "piece_E": ( 60, 179, 113),
    "piece_F": (255, 140,   0),
    "piece_G": ( 30, 144, 255),
    "piece_H": (220,  20,  60),
    "piece_I": (127, 255, 212),
    "piece_J": (255, 105, 180),
    "piece_K": (154, 205,  50),
}


def _load_font(size=14):
    for name in ("arial.ttf", "Arial.ttf", "DejaVuSans.ttf", "LiberationSans-Regular.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except (OSError, IOError):
            continue
    return ImageFont.load_default()


def _to_px(x, y, width, height):
    """Blender normalized coords (origin bottom-left, Y up) -> pixel (top-left, Y down)."""
    return int(round(x * width)), int(round((1.0 - y) * height))


def _draw_cross(draw, cx, cy, size, color, width=3):
    draw.line([(cx - size, cy - size), (cx + size, cy + size)], fill=color, width=width)
    draw.line([(cx + size, cy - size), (cx - size, cy + size)], fill=color, width=width)


def draw_overlay(png_path, attempt, out_path, font_sm, font_md):
    img = Image.open(png_path).convert("RGB")
    W, H = img.size
    draw = ImageDraw.Draw(img, "RGBA")

    pts = attempt.get("overlay_points")
    if not pts:
        img.save(out_path)
        return

    # 21 pins - green circles + index
    for p in pts.get("pins", []):
        if p.get("depth", 0) <= 0:
            continue
        px, py = _to_px(p["x"], p["y"], W, H)
        r = 7
        draw.ellipse([px - r, py - r, px + r, py + r], outline=(0, 230, 0, 255), width=2)
        draw.text((px + r + 2, py - r - 2), str(p["pin_index"]), fill=(0, 230, 0, 255), font=font_sm)

    # Per-piece expected cells (colored dots + polyline) and actual center (colored X)
    for pname, pdata in pts.get("pieces", {}).items():
        color = PIECE_COLORS.get(pname, (255, 255, 255))

        centers = []
        for c in pdata.get("expected_cells", []):
            if c.get("depth", 0) <= 0:
                continue
            px, py = _to_px(c["x"], c["y"], W, H)
            centers.append((px, py))

        if len(centers) > 1:
            draw.line(centers + [centers[0]], fill=color + (200,), width=1)
        for (px, py) in centers:
            r = 3
            draw.ellipse([px - r, py - r, px + r, py + r], fill=color + (255,))

        ac = pdata.get("actual_center")
        exp_anchor = pdata.get("expected_anchor")

        if ac and ac.get("depth", 0) > 0:
            ax, ay = _to_px(ac["x"], ac["y"], W, H)
            _draw_cross(draw, ax, ay, 9, color + (255,), width=3)

            # White error line: actual -> expected anchor
            if exp_anchor and exp_anchor.get("depth", 0) > 0:
                ex, ey = _to_px(exp_anchor["x"], exp_anchor["y"], W, H)
                draw.line([(ax, ay), (ex, ey)], fill=(255, 255, 255, 220), width=1)

            # Label
            letter = pname.replace("piece_", "")
            ori = f"r{pdata.get('rotation_steps', '?')}"
            if pdata.get("mirrored"):
                ori += "M"
            draw.text((ax + 11, ay + 4), f"{letter} {ori}", fill=color + (255,), font=font_md)

    img.save(out_path)


def _resolve_folder(arg):
    if arg:
        return arg
    folders = sorted(glob.glob(os.path.join("debug-output", "solved-diagnostics-*")))
    if not folders:
        raise SystemExit("No debug-output/solved-diagnostics-* folder found.")
    return folders[-1]


def main():
    folder = _resolve_folder(sys.argv[1] if len(sys.argv) > 1 else None)
    report_path = os.path.join(folder, "report.json")
    if not os.path.exists(report_path):
        raise SystemExit(f"report.json not found in {folder}")

    with open(report_path, "r", encoding="utf-8") as f:
        report = json.load(f)

    font_sm = _load_font(11)
    font_md = _load_font(14)

    count_ok = 0
    count_skipped = 0
    for attempt in report.get("attempts", []):
        png_name = attempt.get("image")
        if not png_name:
            continue
        png_path = os.path.join(folder, png_name)
        if not os.path.exists(png_path):
            continue

        out_name = png_name.replace(".png", "_overlay.png")
        out_path = os.path.join(folder, out_name)

        if not attempt.get("overlay_points"):
            count_skipped += 1
            continue

        draw_overlay(png_path, attempt, out_path, font_sm, font_md)
        count_ok += 1

    print(f"Wrote {count_ok} overlays to {folder} (skipped {count_skipped} without overlay_points).")


if __name__ == "__main__":
    main()
