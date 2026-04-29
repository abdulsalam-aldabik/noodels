"""Temporary smoke dataset runner for blender_yolo_generator_v2.

Usage from repo root:
    blender scene.blend --background --python automation/vision-rebuild/smoke_runner_temp.py -- --total 10

Defaults:
    - total images: 10
    - split: 80/20 train/val
    - output dir: debug-output/smoke-yolo-dataset
"""

import argparse
import importlib.util
import json
import math
import os
import shutil
import sys
import random

import bpy


def _load_generator_module(repo_root):
    gen_path = os.path.join(repo_root, "blender_yolo_generator_v2.py")
    if not os.path.exists(gen_path):
        raise FileNotFoundError(f"Generator not found: {gen_path}")

    spec = importlib.util.spec_from_file_location("noodles_gen_v2_smoke", gen_path)
    if not spec or not spec.loader:
        raise RuntimeError("Failed to load generator module spec")

    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, gen_path


def _parse_args():
    parser = argparse.ArgumentParser(description="Run a small synthetic smoke dataset build")
    parser.add_argument("--total", type=int, default=10, help="Total image count for smoke run")
    parser.add_argument("--train", type=int, default=None, help="Override train image count")
    parser.add_argument("--val", type=int, default=None, help="Override val image count")
    parser.add_argument(
        "--output-dir",
        type=str,
        default=os.path.join("debug-output", "smoke-yolo-dataset"),
        help="Output directory (absolute or repo-relative)",
    )
    parser.add_argument(
        "--board-visibility",
        type=float,
        default=1.0,
        help="Probability [0,1] that board is shown in each image",
    )
    parser.add_argument(
        "--keep-output",
        action="store_true",
        help="Do not delete existing output directory before generating",
    )
    parser.add_argument(
        "--all-pieces",
        action="store_true",
        help="Force each generated sample to request all pieces",
    )

    # Blender passes script args after "--"
    argv = []
    if "--" in sys.argv:
        argv = sys.argv[sys.argv.index("--") + 1 :]
    return parser.parse_args(argv)


def _resolve_split_counts(total, train_override, val_override):
    total = max(1, int(total))

    if train_override is not None and val_override is not None:
        train = max(0, int(train_override))
        val = max(0, int(val_override))
    elif train_override is not None:
        train = max(0, int(train_override))
        val = max(0, total - train)
    elif val_override is not None:
        val = max(0, int(val_override))
        train = max(0, total - val)
    else:
        train = int(math.ceil(total * 0.8))
        train = min(train, total)
        val = total - train

    if train + val <= 0:
        raise ValueError("Requested split produces zero images")
    return train, val


def main():
    args = _parse_args()
    repo_root = bpy.path.abspath("//")
    mod, generator_path = _load_generator_module(repo_root)

    train_count, val_count = _resolve_split_counts(args.total, args.train, args.val)
    output_dir = args.output_dir
    if not os.path.isabs(output_dir):
        output_dir = os.path.join(repo_root, output_dir)
    output_dir = os.path.normpath(output_dir)

    board_visibility = max(0.0, min(1.0, float(args.board_visibility)))

    mod.TOTAL_TRAIN_IMAGES = train_count
    mod.TOTAL_VAL_IMAGES = val_count
    mod.TOTAL_IMAGES = mod.TOTAL_TRAIN_IMAGES + mod.TOTAL_VAL_IMAGES
    mod.OUTPUT_DIR = output_dir
    mod.IMAGES_DIR = os.path.join(mod.OUTPUT_DIR, "images")
    mod.LABELS_DIR = os.path.join(mod.OUTPUT_DIR, "labels")
    mod.BOARD_VISIBILITY_PROB = board_visibility

    if args.all_pieces:
        all_piece_names = list(mod.PIECE_NAMES)
        mod.FORCE_ALL_REQUESTED_PIECES = True

        def _build_split_plan_all_pieces(split_name, split_total):
            plan = []
            for _ in range(split_total):
                pieces = random.sample(all_piece_names, len(all_piece_names))
                plan.append({"split": split_name, "mode": "random", "pieces": pieces})
            stats = {
                "total_count": split_total,
                "random_count": split_total,
                "single_per_piece": 0,
            }
            return plan, stats

        mod._build_split_plan = _build_split_plan_all_pieces

    if os.path.isdir(mod.OUTPUT_DIR) and not args.keep_output:
        shutil.rmtree(mod.OUTPUT_DIR)
    os.makedirs(mod.OUTPUT_DIR, exist_ok=True)

    config = {
        "generator_path": generator_path,
        "TOTAL_TRAIN_IMAGES": mod.TOTAL_TRAIN_IMAGES,
        "TOTAL_VAL_IMAGES": mod.TOTAL_VAL_IMAGES,
        "TOTAL_IMAGES": mod.TOTAL_IMAGES,
        "OUTPUT_DIR": mod.OUTPUT_DIR,
        "IMAGES_DIR": mod.IMAGES_DIR,
        "LABELS_DIR": mod.LABELS_DIR,
        "BOARD_VISIBILITY_PROB": mod.BOARD_VISIBILITY_PROB,
        "ALL_PIECES_MODE": bool(args.all_pieces),
        "FORCE_ALL_REQUESTED_PIECES": bool(getattr(mod, "FORCE_ALL_REQUESTED_PIECES", False)),
        "expected_counts": {"train": mod.TOTAL_TRAIN_IMAGES, "val": mod.TOTAL_VAL_IMAGES},
    }
    with open(os.path.join(mod.OUTPUT_DIR, "smoke-config.json"), "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    print(
        "SMOKE_RUNNER_CONFIG="
        + json.dumps(config)
    )

    mod.generate_dataset()
    print(f"SMOKE_OUTPUT_DIR={mod.OUTPUT_DIR}")


if __name__ == "__main__":
    main()
