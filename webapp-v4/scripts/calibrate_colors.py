#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

"""
calibrate_colors.py — Extract per-piece color measurements from phone-debug captures.

Mirrors the exact sampling algorithm of ColorCellClassifier.ts:
  • White-balance correction using MISSING_POSITIONS dark plastic cells
  • Top-20% chromatic pixels (sat×lum ranked) → channel-wise median
  • CIE Lab distance comparison against current reference colors

Usage
-----
  # Sample all *_ok-* folders automatically (newest 10):
  python calibrate_colors.py

  # Specific folders:
  python calibrate_colors.py phone-debug/2026-05-06T10-58-38-857Z_ok-9

  # Scan every cell in a capture (for manually locating a missing piece):
  python calibrate_colors.py --all-cells phone-debug/2026-05-06T10-58-38-857Z_ok-9

Output
------
  Comparison table: current ref hex/Lab vs measured hex/Lab, ΔE, sample count.
  Suggested assets.ts lines for pieces with ΔE > 10.
"""

import sys
import os
import json
import math
import glob
from collections import defaultdict

import numpy as np
from PIL import Image

# ── Board geometry ─────────────────────────────────────────────────────────────
# Must match gridGeometry.ts exactly.

BOARD_EDGE_MIN = -1.5
BOARD_EDGE_SPAN = 16.0   # −1.5 to 14.5
BOARD_WIDTH    = 14
BOARD_HEIGHT   = 14

def board_to_canvas(col: int, row: int, canvas_size: int = 960) -> tuple[int, int]:
    s = canvas_size / BOARD_EDGE_SPAN
    return int(round((col - BOARD_EDGE_MIN) * s)), int(round((row - BOARD_EDGE_MIN) * s))

# ── MISSING_POSITIONS (from engine/constants.ts) ────────────────────────────
# These are the board corner cutouts — guaranteed to show dark plastic frame,
# no piece can ever occupy them. Used for white-balance anchor sampling.

MISSING_POSITIONS: set[int] = {
    0, 1, 2, 3, 6, 7, 10, 11, 12, 13,
    14, 15, 16, 17, 20, 21, 24, 25, 26, 27,
    28, 29, 32, 33, 36, 37, 40, 41,
    42, 43, 46, 47, 50, 51, 54, 55,
    58, 59, 62, 63, 66, 67,
    72, 73, 76, 77, 80, 81,
    84, 85, 88, 89, 92, 93, 96, 97,
    98, 99, 102, 103, 106, 107, 110, 111,
    114, 115, 118, 119, 122, 123,
    128, 129, 132, 133, 136, 137,
    140, 141, 144, 145, 148, 149, 152, 153,
    154, 155, 158, 159, 162, 163, 166, 167,
    168, 169, 170, 171, 174, 175, 178, 179, 180, 181,
    182, 183, 184, 185, 188, 189, 192, 193, 194, 195,
}

# ── Current reference colors (keep in sync with assets.ts) ──────────────────

PIECE_ASSETS = [
    {"pieceId":  0, "key": "J", "colorName": "DarkRed",     "colorRgb": (0x62, 0x24, 0x34)},
    {"pieceId":  1, "key": "C", "colorName": "DarkBlue",    "colorRgb": (0x0d, 0x36, 0x8e)},
    {"pieceId":  2, "key": "H", "colorName": "Purple",      "colorRgb": (0x5b, 0x43, 0x82)},
    {"pieceId":  3, "key": "B", "colorName": "SkyBlue",     "colorRgb": (0x0a, 0x61, 0x9d)},
    {"pieceId":  4, "key": "A", "colorName": "Yellow",      "colorRgb": (0x8b, 0x8b, 0x1a)},
    {"pieceId":  5, "key": "K", "colorName": "YellowGreen", "colorRgb": (0x4c, 0x7c, 0x30)},
    {"pieceId":  6, "key": "I", "colorName": "Orange",      "colorRgb": (0x96, 0x52, 0x12)},
    {"pieceId":  7, "key": "G", "colorName": "Pink",        "colorRgb": (0x6b, 0x3d, 0x6e)},
    {"pieceId":  8, "key": "D", "colorName": "Green",       "colorRgb": (0x11, 0x68, 0x45)},
    {"pieceId":  9, "key": "F", "colorName": "Teal",        "colorRgb": (0x56, 0x80, 0x8a)},
    {"pieceId": 10, "key": "E", "colorName": "Red",         "colorRgb": (0x5e, 0x0d, 0x0f)},
]
ASSETS_BY_ID = {a["pieceId"]: a for a in PIECE_ASSETS}

# ── CIE Lab conversion (matches ColorCellClassifier.ts) ──────────────────────

def _srgb_linear(c: int) -> float:
    s = c / 255.0
    return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4

def rgb_to_lab(r: int, g: int, b: int) -> tuple[float, float, float]:
    rl, gl, bl = _srgb_linear(r), _srgb_linear(g), _srgb_linear(b)
    x = 0.4124564*rl + 0.3575761*gl + 0.1804375*bl
    y = 0.2126729*rl + 0.7151522*gl + 0.0721750*bl
    z = 0.0193339*rl + 0.1191920*gl + 0.9503041*bl
    xn, yn, zn = 0.95047, 1.0, 1.08883
    def f(t): return t ** (1/3) if t > 0.008856 else 7.787*t + 16/116
    fx, fy, fz = f(x/xn), f(y/yn), f(z/zn)
    return 116*fy - 16, 500*(fx - fy), 200*(fy - fz)

def lab_distance(a: tuple, b: tuple) -> float:
    return math.sqrt(sum((x - y)**2 for x, y in zip(a, b)))

# ── White-balance correction (matches whiteBalanceRectifiedCanvas) ───────────

BOARD_RGB = (40, 42, 45)

def apply_white_balance(pixels: np.ndarray) -> np.ndarray:
    """Apply the same per-channel scale the TS code applies. Mutates a copy."""
    h, w = pixels.shape[:2]
    cell_spacing = w / BOARD_EDGE_SPAN
    pr = max(2, int(cell_spacing * 0.3))

    patches = []
    for idx in MISSING_POSITIONS:
        row_c, col_c = idx // BOARD_WIDTH, idx % BOARD_WIDTH
        cx, cy = board_to_canvas(col_c, row_c, w)
        y1, y2 = max(0, cy - pr), min(h, cy + pr + 1)
        x1, x2 = max(0, cx - pr), min(w, cx + pr + 1)
        if y2 > y1 and x2 > x1:
            patches.append(pixels[y1:y2, x1:x2, :3].reshape(-1, 3))

    if not patches:
        return pixels.copy()

    combined = np.concatenate(patches, axis=0).astype(float)
    mean = combined.mean(axis=0)
    mean_lum = mean.mean()

    if mean_lum > 90 or mean_lum < 5:
        return pixels.copy()

    scale = np.clip(np.array(BOARD_RGB, dtype=float) / np.maximum(1.0, mean), 0.5, 2.0)

    result = pixels.astype(float)
    result[:, :, :3] = np.clip(result[:, :, :3] * scale, 0, 255)
    return result.astype(np.uint8)

# ── Cell color sampling (matches classifyCellsByColor) ───────────────────────

HIGHLIGHT_MAX_LUM      = 245
HIGHLIGHT_MIN_CHANNEL  = 240
TOP_PERCENT            = 0.20

def sample_cell(pixels: np.ndarray, col: int, row: int) -> tuple[int, int, int] | None:
    """
    Return the (R, G, B) representative color of a cell using the same
    top-20% chromatic pixel median as ColorCellClassifier.ts.
    Returns None if the patch is empty.
    """
    h, w = pixels.shape[:2]
    cx, cy = board_to_canvas(col, row, w)
    pr = max(4, int((w / BOARD_EDGE_SPAN) * 0.4))

    y1, y2 = max(0, cy - pr), min(h, cy + pr + 1)
    x1, x2 = max(0, cx - pr), min(w, cx + pr + 1)
    if y2 <= y1 or x2 <= x1:
        return None

    patch = pixels[y1:y2, x1:x2, :3].reshape(-1, 3).astype(np.int32)
    if len(patch) == 0:
        return None

    max_c = patch.max(axis=1)
    min_c = patch.min(axis=1)
    lum   = (max_c + min_c) / 2.0
    sat   = np.where(max_c > 0, (max_c - min_c) / max_c.astype(float), 0.0)

    highlight = (lum > HIGHLIGHT_MAX_LUM) | (patch.min(axis=1) > HIGHLIGHT_MIN_CHANNEL)
    pool = patch[~highlight]
    if len(pool) == 0:
        pool = patch  # fallback

    pool_max = pool.max(axis=1)
    pool_min = pool.min(axis=1)
    pool_lum = (pool_max + pool_min) / 2.0
    pool_sat = np.where(pool_max > 0, (pool_max - pool_min) / pool_max.astype(float), 0.0)
    scores   = pool_sat * pool_lum

    top_n = max(3, int(len(pool) * TOP_PERCENT))
    top   = pool[np.argsort(scores)[::-1][:top_n]]

    return (
        int(np.median(top[:, 0])),
        int(np.median(top[:, 1])),
        int(np.median(top[:, 2])),
    )

# ── Process one debug folder ──────────────────────────────────────────────────

def process_folder(folder: str, verbose: bool = False) -> dict[int, tuple[int, int, int]]:
    """Return {classId: (r, g, b)} for every piece found in report.json."""
    rectified = os.path.join(folder, "rectified.png")
    report_p  = os.path.join(folder, "report.json")

    if not os.path.exists(rectified) or not os.path.exists(report_p):
        if verbose:
            print(f"  [skip] missing rectified.png or report.json — {os.path.basename(folder)}")
        return {}

    with open(report_p) as f:
        report = json.load(f)

    pieces = report.get("mapping", {}).get("pieces", [])
    if not pieces:
        return {}

    img    = Image.open(rectified).convert("RGB")
    pixels = apply_white_balance(np.array(img))

    results: dict[int, tuple[int, int, int]] = {}
    for piece in pieces:
        cid  = piece["classId"]
        cell = piece["cell"]
        color = sample_cell(pixels, cell["col"], cell["row"])
        if color is not None:
            results[cid] = color

    if verbose:
        names = [ASSETS_BY_ID[k]["colorName"] for k in sorted(results) if k in ASSETS_BY_ID]
        print(f"  {os.path.basename(folder)}: {len(results)} pieces -> {', '.join(names)}")

    return results

# ── All-cells scan mode ───────────────────────────────────────────────────────

def scan_all_cells(folder: str) -> None:
    """Print every non-missing cell's sampled color — useful for locating
    a piece that wasn't placed by the pipeline."""
    rectified = os.path.join(folder, "rectified.png")
    if not os.path.exists(rectified):
        print(f"No rectified.png in {folder}")
        return

    img    = Image.open(rectified).convert("RGB")
    pixels = apply_white_balance(np.array(img))

    ref_labs = {a["pieceId"]: rgb_to_lab(*a["colorRgb"]) for a in PIECE_ASSETS}

    print(f"\nAll-cell scan: {os.path.basename(folder)}\n")
    print(f"{'row,col':>7}  {'hex':>8}  {'L':>6} {'a':>6} {'b':>6}  {'best match':<14}  {'ΔE':>6}")
    print("-" * 65)

    for row in range(BOARD_HEIGHT):
        for col in range(BOARD_WIDTH):
            cell_idx = row * BOARD_WIDTH + col
            if cell_idx in MISSING_POSITIONS:
                continue

            color = sample_cell(pixels, col, row)
            if color is None:
                continue

            r, g, b = color
            lab  = rgb_to_lab(r, g, b)
            hex_ = f"#{r:02X}{g:02X}{b:02X}"

            if lab[0] < 16:
                continue  # board/empty

            best_id, best_de = min(
                ((pid, lab_distance(lab, ref_labs[pid])) for pid in ref_labs),
                key=lambda x: x[1],
            )
            best_name = ASSETS_BY_ID[best_id]["colorName"]

            print(f"  {row:>3},{col:<3}  {hex_:>8}  {lab[0]:>6.1f} {lab[1]:>6.1f} {lab[2]:>6.1f}"
                  f"  {best_name:<14}  {best_de:>6.1f}")

# ── Main ──────────────────────────────────────────────────────────────────────

PHONE_DEBUG_ROOT = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "phone-debug")
)

def main() -> None:
    args = sys.argv[1:]

    # --all-cells mode
    if args and args[0] == "--all-cells":
        for folder in args[1:] or []:
            scan_all_cells(folder)
        return

    # Resolve folder list
    if args:
        folders = [
            os.path.normpath(a) if os.path.isabs(a)
            else os.path.normpath(os.path.join(os.getcwd(), a))
            for a in args
        ]
    else:
        all_folders = sorted(
            glob.glob(os.path.join(PHONE_DEBUG_ROOT, "*_ok-*")),
            reverse=True,
        )
        folders = all_folders[:15]
        print(f"Auto-discovered {len(folders)} debug folders (newest first)\n")

    # Collect measurements
    measurements: dict[int, list[tuple[int, int, int]]] = defaultdict(list)

    print("Sampling folders:")
    for folder in folders:
        results = process_folder(folder, verbose=True)
        for cid, rgb in results.items():
            measurements[cid].append(rgb)

    # Build comparison table
    print()
    print("=" * 96)
    print(f"{'ID':>3} {'Key':>4} {'Name':<14}  "
          f"{'CURRENT HEX':>10}  {'Lc':>6} {'ac':>6} {'bc':>6}  "
          f"{'MEASURED HEX':>12}  {'Lm':>6} {'am':>6} {'bm':>6}  "
          f"{'dE':>6}  {'n':>3}")
    print("-" * 96)

    suggestions: list[tuple] = []

    for asset in PIECE_ASSETS:
        pid      = asset["pieceId"]
        ref_rgb  = asset["colorRgb"]
        ref_lab  = rgb_to_lab(*ref_rgb)
        ref_hex  = "#{:02X}{:02X}{:02X}".format(*ref_rgb)

        samples  = measurements.get(pid, [])

        if not samples:
            print(f"{pid:>3} {asset['key']:>4} {asset['colorName']:<14}  "
                  f"{ref_hex:>10}  {ref_lab[0]:>6.1f} {ref_lab[1]:>6.1f} {ref_lab[2]:>6.1f}  "
                  f"{'(no data)':>12}")
            continue

        # Average measured RGB, then convert to Lab
        avg_r = int(round(sum(s[0] for s in samples) / len(samples)))
        avg_g = int(round(sum(s[1] for s in samples) / len(samples)))
        avg_b = int(round(sum(s[2] for s in samples) / len(samples)))
        meas_lab = rgb_to_lab(avg_r, avg_g, avg_b)
        meas_hex = "#{:02X}{:02X}{:02X}".format(avg_r, avg_g, avg_b)
        delta_e  = lab_distance(ref_lab, meas_lab)
        flag     = "  <<<" if delta_e > 15 else ""

        print(f"{pid:>3} {asset['key']:>4} {asset['colorName']:<14}  "
              f"{ref_hex:>10}  {ref_lab[0]:>6.1f} {ref_lab[1]:>6.1f} {ref_lab[2]:>6.1f}  "
              f"{meas_hex:>12}  {meas_lab[0]:>6.1f} {meas_lab[1]:>6.1f} {meas_lab[2]:>6.1f}  "
              f"{delta_e:>6.1f}  {len(samples):>3}{flag}")

        if delta_e > 10:
            suggestions.append((pid, avg_r, avg_g, avg_b, asset))

    # Suggested assets.ts lines
    if suggestions:
        print()
        print("=" * 96)
        print("SUGGESTED assets.ts UPDATES  (ΔE > 10)\n")
        for pid, r, g, b, asset in suggestions:
            hex_str = "#{:02X}{:02X}{:02X}".format(r, g, b)
            print(
                f'  {{ pieceId: {pid:>2}, index: {pid:>2}, key: "{asset["key"]}", '
                f'colorName: "{asset["colorName"]}", '
                f'colorRgb: [0x{r:02x}, 0x{g:02x}, 0x{b:02x}], '
                f'colorHex: "{hex_str}", '
                f'objUrl: "/models/piece_{asset["key"]}.obj" }},'
            )
    else:
        print("\nAll references within ΔE ≤ 10 — no updates needed.")

    print()

if __name__ == "__main__":
    main()
