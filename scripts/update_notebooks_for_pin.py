"""
One-shot migration: update training notebooks 03/04/05 from the 13-class
(pieces + board + hinge) scheme to 14-class (+ pin = class 13), and add a
pin-coverage validator to notebook 03.

Cells are targeted by their stable `id` field. Running after it's applied is
a no-op (each transform checks for a marker string before rewriting).

Run from project root:  python scripts/update_notebooks_for_pin.py
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Callable

ROOT = Path(__file__).resolve().parent.parent
NOTEBOOKS = ROOT / "notebooks"


def load(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def save(path: Path, nb: dict) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as f:
        json.dump(nb, f, indent=1, ensure_ascii=False)
        f.write("\n")


def cell_src(cell: dict) -> str:
    return "".join(cell.get("source", []))


def set_cell_src(cell: dict, text: str) -> None:
    cell["source"] = text.splitlines(keepends=True)


def edit(nb: dict, cell_id: str, new_source: str, marker: str) -> bool:
    """Replace the cell with matching id if the marker is absent (idempotent)."""
    for cell in nb["cells"]:
        if cell.get("id") != cell_id:
            continue
        if cell.get("cell_type") != "code":
            return False
        if marker in cell_src(cell):
            return False  # already migrated
        set_cell_src(cell, new_source)
        return True
    raise KeyError(f"cell id {cell_id!r} not found")


# ----------------------------------------------------------------------------
# Notebook 03 — prepare_real_data
# ----------------------------------------------------------------------------

NB03_SETUP = '''# Core imports
import shutil
from pathlib import Path
from collections import Counter

import yaml

# -- Project root --------------------------------------------------------------
NOTEBOOK_DIR = Path.cwd()
PROJECT_ROOT = Path("..") if NOTEBOOK_DIR.name == "notebooks" else Path(".")
print(f"Project root: {PROJECT_ROOT}")

# -- Paths (all under data/) ---------------------------------------------------
DATA_DIR       = PROJECT_ROOT / "data"
FINETUNE_DIR   = DATA_DIR / "noodles_finetune_dataset"

# -- Shared constants (14 classes: 0-10 pieces, 11 board, 12 hinge, 13 pin) ---
PIECE_LABELS    = list("ABCDEFGHIJK")                              # piece classes 0-10
ALL_CLASS_NAMES = PIECE_LABELS + ["board", "hinge", "pin"]         # classes 11, 12, 13
NUM_CLASSES     = len(ALL_CLASS_NAMES)                             # 14
PIN_CLASS_ID    = 13
EXPECTED_PINS_PER_IMAGE = 21

PIECE_COLORS = {
    'A': ('Yellow',      (0xF9, 0xD6, 0x5E)),
    'B': ('SkyBlue',     (0x08, 0xA7, 0xE8)),
    'C': ('DarkBlue',    (0x20, 0x6D, 0xD9)),
    'D': ('Green',       (0x1F, 0xA1, 0x5B)),
    'E': ('Red',         (0xEE, 0x39, 0x4F)),
    'F': ('Teal',        (0x85, 0xDA, 0xBB)),
    'G': ('Pink',        (0xEC, 0x71, 0xA8)),
    'H': ('Purple',      (0xC7, 0x78, 0xB9)),
    'I': ('Orange',      (0xFC, 0x69, 0x0C)),
    'J': ('DarkRed',     (0xB6, 0x30, 0x48)),
    'K': ('YellowGreen', (0x95, 0xD4, 0x50)),
}

# Build unified class mapping (all 14 classes)
UNIFIED_NAMES = {
    i: f"{label}_{PIECE_COLORS[label][0]}"
    for i, label in enumerate(PIECE_LABELS)
}
UNIFIED_NAMES[11] = 'board'
UNIFIED_NAMES[12] = 'hinge'
UNIFIED_NAMES[13] = 'pin'

print(f"\\nSetup complete - {NUM_CLASSES} classes")
print(f"   Fine-tune dir: {FINETUNE_DIR}")
'''

NB03_PREPARE = '''FINETUNE_DIR.mkdir(parents=True, exist_ok=True)

stats = {
    'copied': 0,
    'skipped_lines': 0,
    'total_files': 0,
    'total_images': 0,
    'images_skipped_partial_pins': 0,
}
# Per-image pin count for the "all 21 or skip" gate.
pins_per_image = {}

for split_name, rf_split in [('train', 'train'), ('val', 'valid'), ('val', 'val')]:
    rf_img_dir = REAL_DATA_DIR / rf_split / 'images'
    rf_lbl_dir = REAL_DATA_DIR / rf_split / 'labels'

    if not rf_img_dir.exists() or not rf_lbl_dir.exists():
        continue

    out_img_dir = FINETUNE_DIR / 'images' / split_name
    out_lbl_dir = FINETUNE_DIR / 'labels' / split_name
    out_img_dir.mkdir(parents=True, exist_ok=True)
    out_lbl_dir.mkdir(parents=True, exist_ok=True)

    label_files = list(rf_lbl_dir.glob('*.txt'))
    print(f"\\n{rf_split} → {split_name}: {len(label_files)} label files")

    for lbl_file in label_files:
        valid_lines = []
        pin_count = 0
        with open(lbl_file) as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) < 5:
                    stats['skipped_lines'] += 1
                    continue
                cls_id = int(parts[0])
                n_vals = len(parts) - 1

                if cls_id < 0 or cls_id >= NUM_CLASSES:
                    stats['skipped_lines'] += 1
                    continue

                # Validate format per class type:
                # - Pieces (0-10) and board (11): segmentation polygon (>=6 coords, even count)
                # - Hinge (12) and pin (13): bounding box (exactly 4 values: cx cy w h)
                if cls_id in (12, PIN_CLASS_ID):
                    if n_vals == 4:
                        valid_lines.append(line.strip())
                        stats['copied'] += 1
                        if cls_id == PIN_CLASS_ID:
                            pin_count += 1
                    else:
                        stats['skipped_lines'] += 1
                else:
                    if n_vals >= 6 and n_vals % 2 == 0:
                        valid_lines.append(line.strip())
                        stats['copied'] += 1
                    else:
                        stats['skipped_lines'] += 1

        pins_per_image[lbl_file.stem] = pin_count

        # "All 21 pins or skip" gate. Partial pin annotations teach the model
        # that un-annotated pins are background, which tanks recall. 0 pins is
        # fine (image may have the board fully out of frame); 1..20 is dropped.
        if 0 < pin_count < EXPECTED_PINS_PER_IMAGE:
            stats['images_skipped_partial_pins'] += 1
            continue

        out_lbl = out_lbl_dir / lbl_file.name
        with open(out_lbl, 'w') as f:
            f.write('\\n'.join(valid_lines) + '\\n' if valid_lines else '')
        stats['total_files'] += 1

        img_stem = lbl_file.stem
        for ext in ['.jpg', '.jpeg', '.png', '.JPG', '.JPEG', '.PNG']:
            src_img = rf_img_dir / (img_stem + ext)
            if src_img.exists():
                dst_img = out_img_dir / src_img.name
                if not dst_img.exists():
                    shutil.copy2(src_img, dst_img)
                stats['total_images'] += 1
                break

print(f"\\n{'='*50}")
print(f"✅ Dataset prepared — {NUM_CLASSES} classes!")
print(f"   Label files: {stats['total_files']}")
print(f"   Images:      {stats['total_images']}")
print(f"   Annotations: {stats['copied']}")
if stats['skipped_lines']:
    print(f"   ⚠️  Skipped lines:                   {stats['skipped_lines']}")
if stats['images_skipped_partial_pins']:
    print(f"   ⚠️  Images dropped (partial pins):   {stats['images_skipped_partial_pins']}")

# Pin-coverage histogram: every image with pins should have exactly 21.
pin_hist = Counter(pins_per_image.values())
print("\\nPin-count histogram (how many images have N pins annotated):")
for n in sorted(pin_hist.keys()):
    if n == EXPECTED_PINS_PER_IMAGE:
        flag = '  ← expected'
    elif n == 0:
        flag = '  ← empty (no pins annotated)'
    else:
        flag = '  ⚠️  partial — dropped'
    print(f"  {n:2d} pins: {pin_hist[n]:4d} images{flag}")
'''

NB03_YAML = '''finetune_yaml_content = f"""# IQ Noodles Fine-Tune Dataset - Real Photos (Phase 2)
# 14 classes: pieces A-K (0-10), board (11), hinge (12), pin (13)

path: .
train: images/train
val: images/val

nc: {NUM_CLASSES}

names:
"""
for idx, name in UNIFIED_NAMES.items():
    finetune_yaml_content += f"  {idx}: {name}\\n"

finetune_yaml_path = FINETUNE_DIR / 'dataset.yaml'
with open(finetune_yaml_path, 'w') as f:
    f.write(finetune_yaml_content)

print(f"Fine-tune dataset YAML: {finetune_yaml_path}")
print(finetune_yaml_content)
'''

NB03_VALIDATE = '''def validate_labels(dataset_dir, split='train'):
    """Check label files for correctness (14 classes, mixed seg+bbox)."""
    lbl_dir = Path(dataset_dir) / 'labels' / split
    img_dir = Path(dataset_dir) / 'images' / split

    label_files = sorted(lbl_dir.glob('*.txt'))
    image_files = sorted(img_dir.glob('*'))
    image_stems = {f.stem for f in image_files}

    print(f"  Images: {len(image_files)}  |  Labels: {len(label_files)}")

    class_counts = Counter()
    orphan_labels = []
    bad_lines = []
    partial_pin_images = []
    total_annotations = 0

    for lf in label_files:
        if lf.stem not in image_stems:
            orphan_labels.append(lf.name)

        pin_count_this_file = 0
        with open(lf) as f:
            for line_no, line in enumerate(f, 1):
                parts = line.strip().split()
                if not parts:
                    continue
                cls_id = int(parts[0])
                n_vals = len(parts) - 1

                if cls_id < 0 or cls_id >= NUM_CLASSES:
                    bad_lines.append(f"{lf.name}:{line_no} class_id={cls_id} out of range [0,{NUM_CLASSES-1}]")
                elif cls_id in (12, 13):
                    # Hinge (12) and pin (13): bbox format (cx cy w h).
                    name = 'hinge' if cls_id == 12 else 'pin'
                    if n_vals != 4:
                        bad_lines.append(f"{lf.name}:{line_no} {name} bbox expects 4 values, got {n_vals}")
                    else:
                        coords = [float(x) for x in parts[1:]]
                        if any(c < 0 or c > 1 for c in coords):
                            bad_lines.append(f"{lf.name}:{line_no} {name} bbox coords outside [0,1]")
                    if cls_id == 13:
                        pin_count_this_file += 1
                else:
                    # Pieces + board: polygon (>=6 coords, even count).
                    if n_vals < 6 or n_vals % 2 != 0:
                        bad_lines.append(f"{lf.name}:{line_no} invalid polygon ({n_vals} coords)")
                    else:
                        coords = [float(x) for x in parts[1:]]
                        if any(c < 0 or c > 1 for c in coords):
                            bad_lines.append(f"{lf.name}:{line_no} coords outside [0,1]")

                class_counts[cls_id] += 1
                total_annotations += 1

        # Pin-coverage per image: 0 or 21 are acceptable; anything else is a bug.
        if 0 < pin_count_this_file < 21:
            partial_pin_images.append(f"{lf.name} ({pin_count_this_file} pins)")

    print(f"  Total annotations: {total_annotations}")
    print(f"  Class distribution:")
    for cls_id in sorted(class_counts.keys()):
        name = UNIFIED_NAMES.get(cls_id, f"UNKNOWN_{cls_id}")
        print(f"    {cls_id:2d} ({name}): {class_counts[cls_id]}")

    if orphan_labels:
        print(f"\\n  ⚠️  {len(orphan_labels)} label files without matching image")
    if partial_pin_images:
        print(f"\\n  ❌ {len(partial_pin_images)} images with partial pin annotation (expected 0 or 21):")
        for p in partial_pin_images[:10]:
            print(f"    {p}")
    if bad_lines:
        print(f"\\n  ❌ {len(bad_lines)} problematic lines:")
        for bl in bad_lines[:10]:
            print(f"    {bl}")

    all_ok = not bad_lines and not partial_pin_images
    if all_ok:
        print(f"\\n  ✅ All labels valid!")
    return all_ok

print("=== Train split ===")
train_ok = validate_labels(FINETUNE_DIR, 'train')
print("\\n=== Val split ===")
val_ok = validate_labels(FINETUNE_DIR, 'val')

if train_ok and val_ok:
    print(f"\\n✅ All labels validated — {NUM_CLASSES} classes, ready for fine-tuning!")
else:
    print("\\n⚠️  Fix label issues above before proceeding")
'''


# ----------------------------------------------------------------------------
# Notebook 04 — train_phase2_finetune
# ----------------------------------------------------------------------------

NB04_SETUP = '''# Core imports
import shutil
import random
from pathlib import Path
from collections import Counter

import yaml

# -- Project root --------------------------------------------------------------
NOTEBOOK_DIR = Path.cwd()
PROJECT_ROOT = Path("..") if NOTEBOOK_DIR.name == "notebooks" else Path(".")
print(f"Project root: {PROJECT_ROOT}")

# -- Paths (all under data/) ---------------------------------------------------
DATA_DIR       = PROJECT_ROOT / "data"
FINETUNE_DIR   = DATA_DIR / "noodles_finetune_dataset"
TRAINING_DIR   = DATA_DIR / "noodles_training"

# -- Shared constants (14 classes: 0-10 pieces, 11 board, 12 hinge, 13 pin) ---
PIECE_LABELS     = list("ABCDEFGHIJK")                              # piece classes 0-10
ALL_CLASS_NAMES  = PIECE_LABELS + ["board", "hinge", "pin"]         # classes 11, 12, 13
NUM_CLASSES      = len(ALL_CLASS_NAMES)                             # 14

PIECE_COLORS = {
    'A': ('Yellow',      (0xF9, 0xD6, 0x5E)),
    'B': ('SkyBlue',     (0x08, 0xA7, 0xE8)),
    'C': ('DarkBlue',    (0x20, 0x6D, 0xD9)),
    'D': ('Green',       (0x1F, 0xA1, 0x5B)),
    'E': ('Red',         (0xEE, 0x39, 0x4F)),
    'F': ('Teal',        (0x85, 0xDA, 0xBB)),
    'G': ('Pink',        (0xEC, 0x71, 0xA8)),
    'H': ('Purple',      (0xC7, 0x78, 0xB9)),
    'I': ('Orange',      (0xFC, 0x69, 0x0C)),
    'J': ('DarkRed',     (0xB6, 0x30, 0x48)),
    'K': ('YellowGreen', (0x95, 0xD4, 0x50)),
}

# Verify Phase 1 weights and files are available
p1_best = TRAINING_DIR / 'phase1_synthetic' / 'weights' / 'best.pt'
finetune_yaml = FINETUNE_DIR / 'dataset.yaml'

print(f"\\n  Phase 1 best: {p1_best} {'OK' if p1_best.exists() else 'missing'}")
print(f"  Fine-tune YAML: {finetune_yaml} {'OK' if finetune_yaml.exists() else 'missing'}")
'''


# ----------------------------------------------------------------------------
# Notebook 05 — export_and_evaluate
# ----------------------------------------------------------------------------

NB05_SETUP = '''# Core imports
import shutil
import zipfile
from pathlib import Path

# -- Project root --------------------------------------------------------------
NOTEBOOK_DIR = Path.cwd()
PROJECT_ROOT = Path("..") if NOTEBOOK_DIR.name == "notebooks" else Path(".")
print(f"Project root: {PROJECT_ROOT}")

# -- Paths (all under data/) ---------------------------------------------------
DATA_DIR       = PROJECT_ROOT / "data"
TRAINING_DIR   = DATA_DIR / "noodles_training"
FINETUNE_DIR   = DATA_DIR / "noodles_finetune_dataset"
DATASET_DIR    = DATA_DIR / "noodles_seg_dataset"
MODELS_DIR     = PROJECT_ROOT / "models" / "piece_segmentor"

# -- Shared constants (14 classes: 0-10 pieces, 11 board, 12 hinge, 13 pin) ---
PIECE_LABELS     = list("ABCDEFGHIJK")                              # piece classes 0-10
ALL_CLASS_NAMES  = PIECE_LABELS + ["board", "hinge", "pin"]         # classes 11, 12, 13
NUM_CLASSES      = len(ALL_CLASS_NAMES)                             # 14

PIECE_COLORS = {
    'A': ('Yellow',      (0xF9, 0xD6, 0x5E)),
    'B': ('SkyBlue',     (0x08, 0xA7, 0xE8)),
    'C': ('DarkBlue',    (0x20, 0x6D, 0xD9)),
    'D': ('Green',       (0x1F, 0xA1, 0x5B)),
    'E': ('Red',         (0xEE, 0x39, 0x4F)),
    'F': ('Teal',        (0x85, 0xDA, 0xBB)),
    'G': ('Pink',        (0xEC, 0x71, 0xA8)),
    'H': ('Purple',      (0xC7, 0x78, 0xB9)),
    'I': ('Orange',      (0xFC, 0x69, 0x0C)),
    'J': ('DarkRed',     (0xB6, 0x30, 0x48)),
    'K': ('YellowGreen', (0x95, 0xD4, 0x50)),
}

print(f"  Training dir: {TRAINING_DIR}")
print(f"  Models dir:   {MODELS_DIR}")
'''

NB05_DEPLOY = '''# ── Auto-deploy: copy best.onnx to webapp-v4 ──────────────────────────────────
import shutil
from pathlib import Path

ONNX_SRC  = TRAINING_DIR / "phase2_finetune" / "weights" / "best.onnx"
ONNX_DEST = PROJECT_ROOT / "webapp-v4" / "public" / "models" / "yolo26n-seg.onnx"

if not ONNX_SRC.exists():
    # fallback to phase1 if phase2 not available
    ONNX_SRC = TRAINING_DIR / "phase1_synthetic" / "weights" / "best.onnx"

if ONNX_SRC.exists():
    ONNX_DEST.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ONNX_SRC, ONNX_DEST)
    print(f"✅ Deployed: {ONNX_SRC.name} → {ONNX_DEST}")
    print(f"   Size: {ONNX_DEST.stat().st_size / 1024 / 1024:.1f} MB")
else:
    print("⚠️  No ONNX model found. Run export step first.")
'''


# ----------------------------------------------------------------------------
# Driver
# ----------------------------------------------------------------------------


def main() -> None:
    ops: list[tuple[str, list[tuple[str, str, str]]]] = [
        ("03_prepare_real_data.ipynb", [
            ("s0-setup",    NB03_SETUP,    'ALL_CLASS_NAMES = PIECE_LABELS + ["board", "hinge", "pin"]'),
            ("s3-prepare",  NB03_PREPARE,  'images_skipped_partial_pins'),
            ("s4-yaml",     NB03_YAML,     'pin (13)'),
            ("s5-validate", NB03_VALIDATE, '14 classes, mixed seg+bbox'),
        ]),
        ("04_train_phase2_finetune.ipynb", [
            ("s0-setup", NB04_SETUP, 'ALL_CLASS_NAMES  = PIECE_LABELS + ["board", "hinge", "pin"]'),
        ]),
        ("05_export_and_evaluate.ipynb", [
            ("s0-setup", NB05_SETUP, 'ALL_CLASS_NAMES  = PIECE_LABELS + ["board", "hinge", "pin"]'),
            # The auto-deploy cell has id "25f3251d" in the current notebook.
            ("25f3251d", NB05_DEPLOY, 'webapp-v4" / "public" / "models" / "yolo26n-seg.onnx'),
        ]),
    ]

    for nb_name, edits in ops:
        nb_path = NOTEBOOKS / nb_name
        nb = load(nb_path)
        changed = 0
        for cell_id, new_src, marker in edits:
            if edit(nb, cell_id, new_src, marker):
                changed += 1
                print(f"  {nb_name}:{cell_id} updated")
        if changed:
            save(nb_path, nb)
        print(f"{nb_name}: {changed} cells changed")


if __name__ == "__main__":
    main()
