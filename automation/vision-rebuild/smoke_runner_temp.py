"""Temporary smoke dataset runner for blender_yolo_generator_v2."""

import importlib.util
import json
import os
import shutil

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


def main():
    repo_root = bpy.path.abspath("//")
    mod, generator_path = _load_generator_module(repo_root)

    mod.TOTAL_TRAIN_IMAGES = 6
    mod.TOTAL_VAL_IMAGES = 2
    mod.TOTAL_IMAGES = mod.TOTAL_TRAIN_IMAGES + mod.TOTAL_VAL_IMAGES
    mod.OUTPUT_DIR = os.path.join(repo_root, "debug-output", "smoke-yolo-dataset")
    mod.IMAGES_DIR = os.path.join(mod.OUTPUT_DIR, "images")
    mod.LABELS_DIR = os.path.join(mod.OUTPUT_DIR, "labels")
    mod.BOARD_VISIBILITY_PROB = 1.0

    if os.path.isdir(mod.OUTPUT_DIR):
        shutil.rmtree(mod.OUTPUT_DIR)
    os.makedirs(mod.OUTPUT_DIR, exist_ok=True)

    print(
        "SMOKE_RUNNER_CONFIG="
        + json.dumps(
            {
                "generator_path": generator_path,
                "TOTAL_TRAIN_IMAGES": mod.TOTAL_TRAIN_IMAGES,
                "TOTAL_VAL_IMAGES": mod.TOTAL_VAL_IMAGES,
                "TOTAL_IMAGES": mod.TOTAL_IMAGES,
                "OUTPUT_DIR": mod.OUTPUT_DIR,
                "IMAGES_DIR": mod.IMAGES_DIR,
                "LABELS_DIR": mod.LABELS_DIR,
                "BOARD_VISIBILITY_PROB": mod.BOARD_VISIBILITY_PROB,
            }
        )
    )

    mod.generate_dataset()
    print(f"SMOKE_OUTPUT_DIR={mod.OUTPUT_DIR}")


if __name__ == "__main__":
    main()
