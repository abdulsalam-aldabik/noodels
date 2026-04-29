#!/usr/bin/env python3
"""
IQ Noodles — Dataset Viewer
=============================
Usage:
  python dataset_viewer.py                         # balance chart + interactive browser
  python dataset_viewer.py --class board           # jump straight to a class
  python dataset_viewer.py --class 0               # by class ID
  python dataset_viewer.py --class hinge --n 12    # show 12 samples
  python dataset_viewer.py --split val             # val split only
  python dataset_viewer.py --dataset data/yolo_dataset  # different dataset path
"""

import argparse
import random
from pathlib import Path

import cv2
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib.patches import Polygon
import numpy as np
import yaml

# ── Defaults ──────────────────────────────────────────────────────────────────
PROJECT_ROOT     = Path(__file__).parent
DEFAULT_DATASET  = PROJECT_ROOT / 'yolo_dataset'

# Piece colors (match game colors) + metadata classes (board/hinge/pin)
PALETTE = [
    (249, 214,  94),  # 0  A Yellow
    (  8, 167, 232),  # 1  B SkyBlue
    ( 32, 109, 217),  # 2  C DarkBlue
    ( 31, 161,  91),  # 3  D Green
    (238,  57,  79),  # 4  E Red
    (133, 218, 187),  # 5  F Teal
    (236, 113, 168),  # 6  G Pink
    (199, 120, 185),  # 7  H Purple
    (252, 105,  12),  # 8  I Orange
    (182,  48,  72),  # 9  J DarkRed
    (149, 212,  80),  # 10 K YellowGreen
    (255, 255, 255),  # 11 board  — white
    ( 80, 220, 255),  # 12 hinge  — cyan
    (255, 196,  64),  # 13 pin    — amber
]


# ── Helpers ───────────────────────────────────────────────────────────────────
def color_f(cid: int):
    """Return (r, g, b) floats 0-1 for a class ID."""
    if cid < len(PALETTE):
        r, g, b = PALETTE[cid]
        return r/255, g/255, b/255
    return 1.0, 1.0, 1.0


def load_config(dataset_dir: Path) -> dict:
    yaml_path = dataset_dir / 'dataset.yaml'
    assert yaml_path.exists(), f"dataset.yaml not found at {yaml_path}"
    with open(yaml_path) as f:
        cfg = yaml.safe_load(f)
    names = cfg.get('names', {})
    if isinstance(names, list):
        return {i: n for i, n in enumerate(names)}
    return {int(k): v for k, v in names.items()}


def scan_dataset(dataset_dir: Path, names: dict):
    """
    Returns:
      stats       — {split: {class_id: instance_count}}
      class_imgs  — {class_id: [(img_path, lbl_path, split), ...]}
    """
    stats      = {'train': {}, 'val': {}}
    class_imgs = {cid: [] for cid in names}

    for split in ['train', 'val']:
        lbl_dir = dataset_dir / 'labels' / split
        img_dir = dataset_dir / 'images' / split
        if not lbl_dir.exists():
            continue

        for lbl_file in sorted(lbl_dir.glob('*.txt')):
            img_file = None
            for ext in ('.png', '.jpg', '.jpeg'):
                c = img_dir / (lbl_file.stem + ext)
                if c.exists():
                    img_file = c
                    break
            if img_file is None:
                continue

            with open(lbl_file) as f:
                lines = [l.strip() for l in f if l.strip()]

            seen = set()
            for line in lines:
                parts = line.split()
                if not parts:
                    continue
                cid = int(parts[0])
                stats[split][cid] = stats[split].get(cid, 0) + 1
                seen.add(cid)

            for cid in seen:
                if cid in class_imgs:
                    class_imgs[cid].append((img_file, lbl_file, split))

    return stats, class_imgs


def resolve_class(query: str, names: dict):
    """Accept an integer string or a class-name substring (case-insensitive)."""
    q = query.strip()
    try:
        cid = int(q)
        return cid if cid in names else None
    except ValueError:
        q_low = q.lower()
        for cid, name in names.items():
            if q_low in name.lower():
                return cid
    return None


# ── Drawing ───────────────────────────────────────────────────────────────────
def draw_annotations(ax, img_rgb, lbl_path: Path, names: dict):
    h, w = img_rgb.shape[:2]
    ax.imshow(img_rgb)

    if not lbl_path.exists():
        ax.axis('off')
        return

    with open(lbl_path) as f:
        lines = [l.strip() for l in f if l.strip()]

    for line in lines:
        parts = line.split()
        if not parts:
            continue
        cid   = int(parts[0])
        vals  = list(map(float, parts[1:]))
        color = color_f(cid)
        label = names.get(cid, str(cid))

        if len(vals) == 4:
            # YOLO bbox: cx cy w h normalised
            cx, cy, bw, bh = vals
            x1 = (cx - bw/2) * w
            y1 = (cy - bh/2) * h
            rect = patches.Rectangle(
                (x1, y1), bw*w, bh*h,
                linewidth=2, edgecolor=color, facecolor='none'
            )
            ax.add_patch(rect)
            ax.text(x1, max(y1 - 6, 0), label, color=color, fontsize=8,
                    weight='bold', bbox=dict(facecolor='black', alpha=0.55, pad=1))

        elif len(vals) >= 6:
            # YOLO segmentation polygon
            pts = np.array(vals).reshape(-1, 2)
            pts[:, 0] *= w
            pts[:, 1] *= h
            poly = Polygon(pts, closed=True,
                           facecolor=(*color, 0.22), edgecolor=color, linewidth=1.5)
            ax.add_patch(poly)
            ax.text(pts[:, 0].mean(), max(pts[:, 1].min() - 8, 0), label,
                    color=color, fontsize=8, weight='bold', ha='center',
                    bbox=dict(facecolor='black', alpha=0.55, pad=1))

    ax.axis('off')


# ── Plots ─────────────────────────────────────────────────────────────────────
def plot_balance(stats: dict, names: dict):
    all_ids     = sorted(names.keys())
    labels      = [names[c] for c in all_ids]
    train_cnts  = [stats['train'].get(c, 0) for c in all_ids]
    val_cnts    = [stats['val'].get(c, 0)   for c in all_ids]
    colors      = [color_f(c) for c in all_ids]

    x     = np.arange(len(all_ids))
    width = 0.4
    fig, ax = plt.subplots(figsize=(max(11, len(all_ids)), 5))

    bars_t = ax.bar(x - width/2, train_cnts, width, label='train',
                    color=colors, alpha=0.90)
    bars_v = ax.bar(x + width/2, val_cnts,   width, label='val',
                    color=colors, alpha=0.42, edgecolor='white', linewidth=0.6)

    for bar in list(bars_t) + list(bars_v):
        v = int(bar.get_height())
        if v:
            ax.text(bar.get_x() + bar.get_width()/2, v + 0.4, str(v),
                    ha='center', va='bottom', fontsize=7)

    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=38, ha='right', fontsize=9)
    ax.set_ylabel('Label instances in dataset')
    ax.set_title('Class balance  —  train (solid)  /  val (faded)')
    ax.legend()
    ax.grid(axis='y', alpha=0.25)
    plt.tight_layout()
    plt.show()


def plot_class_samples(class_imgs: dict, cid: int, names: dict,
                       n: int = 9, split_filter: str = None):
    entries = class_imgs.get(cid, [])
    if split_filter:
        entries = [e for e in entries if e[2] == split_filter]

    if not entries:
        print(f"  No images found for class {cid} ({names.get(cid, '?')})"
              + (f" in split '{split_filter}'" if split_filter else ""))
        return

    sample = random.sample(entries, min(n, len(entries)))
    cols   = min(3, len(sample))
    rows   = (len(sample) + cols - 1) // cols

    fig, axes = plt.subplots(rows, cols, figsize=(5 * cols, 4.2 * rows))
    axes = np.array(axes).flatten() if rows * cols > 1 else [axes]

    for idx, (img_path, lbl_path, split) in enumerate(sample):
        img     = cv2.imread(str(img_path))
        img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
        draw_annotations(axes[idx], img_rgb, lbl_path, names)
        axes[idx].set_title(f"{img_path.name}  [{split}]", fontsize=7)

    for ax in axes[len(sample):]:
        ax.axis('off')

    split_note = f" — {split_filter}" if split_filter else ""
    fig.suptitle(
        f"Class {cid}: {names.get(cid, '?')}   "
        f"({len(entries)} images total{split_note})",
        fontsize=13, weight='bold'
    )
    plt.tight_layout()
    plt.show()


# ── Summary text ──────────────────────────────────────────────────────────────
def print_summary(stats: dict, names: dict, class_imgs: dict):
    all_train_imgs = {p for entries in class_imgs.values() for p, _, s in entries if s == 'train'}
    all_val_imgs   = {p for entries in class_imgs.values() for p, _, s in entries if s == 'val'}

    print("\n" + "=" * 58)
    print("  DATASET SUMMARY")
    print("=" * 58)
    print(f"  Train images : {len(all_train_imgs)}")
    print(f"  Val   images : {len(all_val_imgs)}")
    print(f"  Train label instances : {sum(stats['train'].values())}")
    print(f"  Val   label instances : {sum(stats['val'].values())}")
    print()
    print(f"  {'ID':<4}  {'Class':<22}  {'Train':>7}  {'Val':>6}  {'Total':>7}")
    print(f"  {'-'*4}  {'-'*22}  {'-'*7}  {'-'*6}  {'-'*7}")
    for cid in sorted(names.keys()):
        tr  = stats['train'].get(cid, 0)
        va  = stats['val'].get(cid, 0)
        note = "  ← no data yet" if (tr + va) == 0 else ""
        print(f"  {cid:<4}  {names[cid]:<22}  {tr:>7}  {va:>6}  {tr+va:>7}{note}")
    print("=" * 58 + "\n")


# ── Interactive loop ──────────────────────────────────────────────────────────
def interactive_loop(dataset_dir: Path, names: dict, n: int):
    name_hint = ", ".join(f"{k}:{v}" for k, v in sorted(names.items()))
    print(f"Classes: {name_hint}")
    print("Commands:")
    print("  <name or id>            — 9 random samples (all splits)")
    print("  <name or id> train/val  — filter by split")
    print("  balance                 — redraw balance chart")
    print("  q                       — quit\n")

    while True:
        try:
            raw = input("View class > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        if not raw:
            continue

        if raw.lower() in ('q', 'quit', 'exit'):
            break

        if raw.lower() == 'balance':
            stats, class_imgs = scan_dataset(dataset_dir, names)
            plot_balance(stats, names)
            continue

        # optional split suffix
        parts        = raw.split()
        split_filter = None
        if len(parts) >= 2 and parts[-1].lower() in ('train', 'val'):
            split_filter = parts[-1].lower()
            query        = ' '.join(parts[:-1])
        else:
            query = raw

        cid = resolve_class(query, names)
        if cid is None:
            print(f"  Unknown class '{query}' — try a number or name substring.")
            continue

        # re-scan so we always have fresh data
        _, class_imgs = scan_dataset(dataset_dir, names)
        plot_class_samples(class_imgs, cid, names, n=n, split_filter=split_filter)


# ── Entry point ───────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description='IQ Noodles YOLO dataset viewer — balance chart + image browser'
    )
    parser.add_argument(
        '--dataset', default=str(DEFAULT_DATASET),
        help=f'Dataset root directory (default: {DEFAULT_DATASET})'
    )
    parser.add_argument(
        '--class', dest='cls', default=None,
        help='Jump straight to a class (name substring or integer ID)'
    )
    parser.add_argument(
        '--split', default=None, choices=['train', 'val'],
        help='Filter samples to one split'
    )
    parser.add_argument(
        '--n', type=int, default=9,
        help='Number of sample images to display (default: 9)'
    )
    parser.add_argument(
        '--no-balance', action='store_true',
        help='Skip the balance chart on startup'
    )
    args = parser.parse_args()

    dataset_dir = Path(args.dataset)
    print(f"Dataset: {dataset_dir.resolve()}")

    names               = load_config(dataset_dir)
    stats, class_imgs   = scan_dataset(dataset_dir, names)

    print_summary(stats, names, class_imgs)

    if not args.no_balance:
        plot_balance(stats, names)

    if args.cls:
        cid = resolve_class(args.cls, names)
        if cid is None:
            print(f"Unknown class '{args.cls}'")
        else:
            plot_class_samples(class_imgs, cid, names, n=args.n, split_filter=args.split)
    else:
        interactive_loop(dataset_dir, names, n=args.n)


if __name__ == '__main__':
    main()
