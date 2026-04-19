"""
Blender solved-placement diagnostics for IQ Noodles generator.

Run from repo root:
  blender scene.blend --background --python automation/vision-rebuild/blender_solved_diagnostics.py

Output:
  debug-output/solved-diagnostics-<timestamp>/
    - report.json
    - summary.md
    - attempt_00.png ...
"""

import bpy
import bpy_extras
import glob
import importlib.util
import json
import math
import os
from datetime import datetime

import mathutils


def _load_generator_module(repo_root):
    gen_path = os.path.join(repo_root, "blender_yolo_generator_v2.py")
    if not os.path.exists(gen_path):
        raise FileNotFoundError(f"Generator not found: {gen_path}")

    spec = importlib.util.spec_from_file_location("noodles_gen_v2", gen_path)
    if not spec or not spec.loader:
        raise RuntimeError("Failed to load generator module spec")

    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod, gen_path


def _ensure_camera(scene):
    cam = scene.camera
    if cam:
        return cam
    cam_data = bpy.data.cameras.new(name="Camera")
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.collection.objects.link(cam)
    scene.camera = cam
    return cam


def _pair_overlap_stats(mod, scene, cam, piece_names):
    bboxes = {}
    for name in piece_names:
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        bbox = mod.get_2d_bounding_box(scene, cam, obj)
        if bbox:
            bboxes[name] = bbox

    names = list(bboxes.keys())
    overlap_sum = 0.0
    max_pair = 0.0
    pair_count = 0

    for i in range(len(names)):
        b1 = bboxes[names[i]]
        a1 = max(1e-9, (b1[2] - b1[0]) * (b1[3] - b1[1]))
        for j in range(i + 1, len(names)):
            b2 = bboxes[names[j]]
            inter = mod._bbox_intersection_area(b1, b2)
            if inter <= 0.0:
                continue
            a2 = max(1e-9, (b2[2] - b2[0]) * (b2[3] - b2[1]))
            ratio = inter / min(a1, a2)
            overlap_sum += ratio
            if ratio > max_pair:
                max_pair = ratio
            pair_count += 1

    return {
        "piece_count_with_bbox": len(names),
        "overlap_sum": overlap_sum,
        "max_pair_overlap": max_pair,
        "overlap_pair_count": pair_count,
    }


def _project_to_image(scene, cam, world_vec):
    co2d = bpy_extras.object_utils.world_to_camera_view(scene, cam, world_vec)
    return {"x": float(co2d.x), "y": float(co2d.y), "depth": float(co2d.z)}


def _compute_overlay_points(mod, scene, cam, solver_layout):
    """Collect projected image coords for pins, per-piece expected cells, and actual centers.

    Grid coords: cell (col, row) center is at (col+0.5, row+0.5); pin between cells
    has gx = avg_col + 0.5, gy = avg_row + 0.5. LAST_SOLVED_GRID_TO_WORLD maps
    (gx, gy) to world-space Vector.
    """
    g2w = getattr(mod, "LAST_SOLVED_GRID_TO_WORLD", None)
    if g2w is None:
        return None

    pins = []
    for i in range(len(mod.POSITIONS_AROUND_PINS)):
        avg_xy = mod._pin_board_xy(i)
        if avg_xy is None:
            continue
        avg_col, avg_row = avg_xy
        world = g2w(avg_col + 0.5, avg_row + 0.5)
        proj = _project_to_image(scene, cam, world)
        pins.append({
            "pin_index": i,
            "cell_avg": [float(avg_col), float(avg_row)],
            **proj,
        })

    pieces = {}
    for pname, meta in solver_layout.items():
        cells_xy = meta.get("cells_xy") or []
        expected_cells = []
        for (col, row) in cells_xy:
            world = g2w(float(col) + 0.5, float(row) + 0.5)
            proj = _project_to_image(scene, cam, world)
            expected_cells.append({"cell": [int(col), int(row)], **proj})

        expected_anchor = None
        if cells_xy:
            xs = [c for c, _ in cells_xy]
            ys = [r for _, r in cells_xy]
            cx = 0.5 * (min(xs) + max(xs)) + 0.5
            cy = 0.5 * (min(ys) + max(ys)) + 0.5
            world = g2w(cx, cy)
            expected_anchor = _project_to_image(scene, cam, world)

        obj = bpy.data.objects.get(pname)
        actual_center = None
        if obj:
            local_center = mathutils.Vector((0.0, 0.0, 0.0))
            for v in obj.bound_box:
                local_center += mathutils.Vector(v)
            local_center /= 8.0
            world_center = obj.matrix_world @ local_center
            actual_center = _project_to_image(scene, cam, world_center)

        pieces[pname] = {
            "expected_cells": expected_cells,
            "expected_anchor": expected_anchor,
            "actual_center": actual_center,
            "rotation_steps": int(meta.get("rotation_steps", 0)),
            "mirrored": bool(meta.get("mirrored", False)),
            "orientation_index": int(meta.get("orientation_index", 0)),
        }

    return {"pins": pins, "pieces": pieces}


def _serialize_piece_state(mod, scene, cam, piece_names):
    out = {}
    for name in piece_names:
        obj = bpy.data.objects.get(name)
        if not obj:
            out[name] = {"exists": False}
            continue
        bbox2d = mod.get_2d_bounding_box(scene, cam, obj)
        out[name] = {
            "exists": True,
            "visible_render": not obj.hide_render,
            "location": [float(obj.location.x), float(obj.location.y), float(obj.location.z)],
            "rotation_euler": [
                float(obj.rotation_euler.x),
                float(obj.rotation_euler.y),
                float(obj.rotation_euler.z),
            ],
            "bbox2d": [float(v) for v in bbox2d] if bbox2d else None,
        }
    return out


def main():
    scene = bpy.context.scene
    repo_root = bpy.path.abspath("//")
    mod, generator_path = _load_generator_module(repo_root)

    # Diagnostic assumptions requested by user: board_inner should define solved grid.
    mod.USE_BOARD_INNER_FOR_SOLVED_GRID = True
    mod.SOLVED_GRID_AUTO_CALIBRATE = True

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(repo_root, "debug-output", f"solved-diagnostics-{ts}")
    os.makedirs(out_dir, exist_ok=True)

    rgb_engine = mod.resolve_rgb_render_engine(scene)
    rgb_view = mod.resolve_rgb_view_transform(scene)

    scene.render.resolution_x = mod.RES_X
    scene.render.resolution_y = mod.RES_Y
    scene.render.resolution_percentage = 100

    cam = _ensure_camera(scene)
    cam.location = (0, 0, 15.0)
    cam.rotation_euler = (0, 0, 0)
    cam.data.type = "PERSP"
    cam.data.lens = mod.CAMERA_LENS_MM

    mod.auto_remap_stl_object_names()
    mod.hide_unmapped_objects()

    missing_pieces = [p for p in mod.PIECE_NAMES if not bpy.data.objects.get(p)]
    board_obj = bpy.data.objects.get(mod.BOARD_NAME)
    board_inner_obj = (
        bpy.data.objects.get(mod.MANUAL_BOARD_INNER_OBJECT_NAME)
        if mod.MANUAL_BOARD_INNER_OBJECT_NAME
        else None
    )

    if missing_pieces:
        raise RuntimeError(f"Missing canonical piece objects: {missing_pieces}")
    if not board_obj:
        raise RuntimeError(f"Missing board object: {mod.BOARD_NAME}")

    mod.download_hdris_if_missing()
    mod.center_origins_to_geometry()
    mod.setup_materials()
    mod.configure_capture_camera(cam, scene)

    board_inner_rel = None
    if board_inner_obj:
        board_inner_rel = mod.capture_relative_transform(board_obj, board_inner_obj)

    solver_result = mod.solve_noodles_full()
    if not solver_result.get("solved"):
        raise RuntimeError("Solver failed in diagnostic run")

    solver_layout = mod.build_solver_layout_metadata(solver_result)
    if len(solver_layout) != len(mod.PIECE_NAMES):
        raise RuntimeError(
            f"Solver layout metadata incomplete: {len(solver_layout)}/{len(mod.PIECE_NAMES)}"
        )

    hdri_images = glob.glob(os.path.join(mod.HDRI_DIR, "*.exr")) + glob.glob(
        os.path.join(mod.HDRI_DIR, "*.hdr")
    )

    attempts = []
    total_attempts = 12

    for i in range(total_attempts):
        mod.prepare_hdri_background(
            True,
            hdri_images,
            board_pose_mode="solved",
            board_inner_rel=board_inner_rel,
        )

        placed = mod.apply_solver_solved_layout(board_obj, solver_layout)
        mod.show_only_piece_set(mod.PIECE_NAMES)
        bpy.context.view_layer.update()

        inside = mod.all_pieces_inside_frame(scene, cam, mod.PIECE_NAMES, mod.SOLVED_EDGE_MARGIN)
        score, overlap_sum, spread = mod.evaluate_current_solved_layout_score(scene, cam, mod.PIECE_NAMES)
        pair_stats = _pair_overlap_stats(mod, scene, cam, mod.PIECE_NAMES)

        mod.ensure_rgb_render_state(scene, rgb_engine, rgb_view)
        bpy.context.view_layer.update()

        img_name = f"attempt_{i:02d}.png"
        img_path = os.path.join(out_dir, img_name)
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.filepath = img_path
        bpy.ops.render.render(write_still=True)

        accepted_gate = (
            len(placed) == len(mod.PIECE_NAMES)
            and inside
            and overlap_sum <= mod.SOLVED_ACCEPT_MAX_OVERLAP_SUM
        )

        overlay_points = _compute_overlay_points(mod, scene, cam, solver_layout)

        attempts.append(
            {
                "attempt": i,
                "image": img_name,
                "placed_count": len(placed),
                "inside_frame": bool(inside),
                "score": float(score),
                "overlap_sum": float(overlap_sum),
                "spread": float(spread),
                "pair_overlap": pair_stats,
                "accepted_by_current_gate": bool(accepted_gate),
                "piece_state": _serialize_piece_state(mod, scene, cam, mod.PIECE_NAMES),
                "overlay_points": overlay_points,
                "image_size": [int(scene.render.resolution_x), int(scene.render.resolution_y)],
            }
        )

    accepted = [a for a in attempts if a["accepted_by_current_gate"]]

    report = {
        "timestamp": ts,
        "repo_root": repo_root,
        "generator_path": generator_path,
        "scene_file": bpy.data.filepath,
        "config": {
            "USE_BOARD_INNER_FOR_SOLVED_GRID": bool(mod.USE_BOARD_INNER_FOR_SOLVED_GRID),
            "SOLVED_GRID_AUTO_CALIBRATE": bool(mod.SOLVED_GRID_AUTO_CALIBRATE),
            "SOLVED_GRID_INSET_CANDIDATES": list(mod.SOLVED_GRID_INSET_CANDIDATES),
            "SOLVED_ACCEPT_MAX_OVERLAP_SUM": float(mod.SOLVED_ACCEPT_MAX_OVERLAP_SUM),
            "SOLVED_EDGE_MARGIN": float(mod.SOLVED_EDGE_MARGIN),
        },
        "objects": {
            "board_exists": bool(board_obj),
            "board_inner_exists": bool(board_inner_obj),
            "board_name": mod.BOARD_NAME,
            "board_inner_name": mod.MANUAL_BOARD_INNER_OBJECT_NAME,
            "missing_pieces": missing_pieces,
        },
        "bounds": {
            "board": mod.get_object_world_bounds(board_obj) if board_obj else None,
            "board_inner": mod.get_object_world_bounds(board_inner_obj) if board_inner_obj else None,
        },
        "solver": {
            "solved": bool(solver_result.get("solved")),
            "states": int(solver_result.get("states", 0)),
            "layout_piece_count": len(solver_layout),
        },
        "summary": {
            "attempt_count": total_attempts,
            "accepted_count": len(accepted),
            "best_overlap_sum": min(a["overlap_sum"] for a in attempts),
            "best_score": min(a["score"] for a in attempts),
        },
        "attempts": attempts,
    }

    report_path = os.path.join(out_dir, "report.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)

    summary_md = os.path.join(out_dir, "summary.md")
    with open(summary_md, "w", encoding="utf-8") as f:
        f.write("# Solved Diagnostics Summary\n\n")
        f.write(f"- Output folder: {out_dir}\n")
        f.write(f"- Generator: {generator_path}\n")
        f.write(f"- Scene: {bpy.data.filepath}\n")
        f.write(f"- board_inner used as solved grid: {mod.USE_BOARD_INNER_FOR_SOLVED_GRID}\n")
        f.write(f"- Attempts: {total_attempts}\n")
        f.write(f"- Accepted by current gate: {len(accepted)}\n")
        f.write(f"- Best overlap_sum: {report['summary']['best_overlap_sum']:.6f}\n")
        f.write("\n## Attempts\n\n")
        f.write("| Attempt | Placed | Inside | Overlap Sum | Score | Accepted | Image |\n")
        f.write("|---|---:|---|---:|---:|---|---|\n")
        for a in attempts:
            f.write(
                f"| {a['attempt']} | {a['placed_count']} | {str(a['inside_frame']).lower()} "
                f"| {a['overlap_sum']:.6f} | {a['score']:.6f} "
                f"| {str(a['accepted_by_current_gate']).lower()} | {a['image']} |\n"
            )

    print(f"Diagnostics complete. Output: {out_dir}")
    print(f"Report JSON: {report_path}")
    print(f"Summary MD: {summary_md}")


if __name__ == "__main__":
    main()
