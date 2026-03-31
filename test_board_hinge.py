"""
test_board_hinge.py — Quick board + hinge annotation test
==========================================================
Renders 5 frames with board visible (no pieces), checks that board polygon
and hinge bbox are extracted correctly, saves annotated previews.

Run from project root:
  blender --background scene.blend --python test_board_hinge.py

Output: test_output/
  test_frame_NN_raw.png        — plain render (board + hinge, no overlay)
  test_frame_NN_annotated.png  — board polygon (green) + hinge bbox (cyan)
"""

import sys
import os
import math

import bpy

# Derive project root from the .blend file location — reliable inside Blender
PROJECT_ROOT = os.path.dirname(bpy.data.filepath)
sys.path.insert(0, PROJECT_ROOT)
import mathutils
import numpy as np
import cv2
import glob as _glob

# ── Import generator (side effects: creates yolo_dataset/ dirs + writes yaml — harmless)
import blender_yolo_generator as gen

# ── Config ─────────────────────────────────────────────────────────────────────
N_FRAMES       = 5
YAWS           = [0, 90, 180, 270, 45]          # one per frame
TEST_DIR       = os.path.join(PROJECT_ROOT, 'test_output')
os.makedirs(TEST_DIR, exist_ok=True)


# ── Drawing helpers ────────────────────────────────────────────────────────────
def draw_polygon(img, polygon, color_bgr, label):
    h, w = img.shape[:2]
    pts = np.array([[int(x * w), int(y * h)] for x, y in polygon], np.int32)
    overlay = img.copy()
    cv2.fillPoly(overlay, [pts], color_bgr)
    cv2.addWeighted(overlay, 0.25, img, 0.75, 0, img)
    cv2.polylines(img, [pts], True, color_bgr, 2)
    cv2.putText(img, label, (pts[0][0], max(pts[0][1] - 8, 14)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, color_bgr, 2)

def draw_bbox(img, bbox, color_bgr, label):
    h, w = img.shape[:2]
    cx, cy, bw, bh = bbox
    x1 = int((cx - bw / 2) * w);  y1 = int((cy - bh / 2) * h)
    x2 = int((cx + bw / 2) * w);  y2 = int((cy + bh / 2) * h)
    cv2.rectangle(img, (x1, y1), (x2, y2), color_bgr, 3)
    cv2.putText(img, label, (x1, max(y1 - 8, 14)),
                cv2.FONT_HERSHEY_SIMPLEX, 0.65, color_bgr, 2)


# ── Main test ──────────────────────────────────────────────────────────────────
def run():
    print("\n" + "=" * 62)
    print("  Board + Hinge Quick Test")
    print("=" * 62)

    scene = bpy.context.scene
    scene.render.resolution_x        = gen.RES_X
    scene.render.resolution_y        = gen.RES_Y
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'

    # Camera
    cam = scene.camera
    if not cam:
        cd  = bpy.data.cameras.new('Camera')
        cam = bpy.data.objects.new('Camera', cd)
        bpy.context.collection.objects.link(cam)
        scene.camera = cam
    cam.location        = (0, 0, 15.0)
    cam.rotation_euler  = (0, 0, 0)
    cam.data.type       = 'PERSP'
    cam.data.lens       = 65.0

    # Board check
    board = bpy.data.objects.get(gen.BOARD_NAME)
    if not board:
        print(f"\nFAIL: board object '{gen.BOARD_NAME}' not found in scene.")
        return

    # One-time setup
    gen.download_hdris_if_missing()
    gen.center_origins_to_geometry()
    gen.setup_materials()
    gen.hide_all_pieces()
    scene.use_nodes = False

    # ── Print board local dimensions ──────────────────────────────────────────
    bb           = board.bound_box
    lx_min, lx_max = min(c[0] for c in bb), max(c[0] for c in bb)
    ly_min, ly_max = min(c[1] for c in bb), max(c[1] for c in bb)
    lz_min, lz_max = min(c[2] for c in bb), max(c[2] for c in bb)
    local_width  = lx_max - lx_min
    local_height = ly_max - ly_min

    print(f"\n[Board local bbox]")
    print(f"  X : {lx_min:9.2f} → {lx_max:9.2f}   width  = {local_width:.2f}")
    print(f"  Y : {ly_min:9.2f} → {ly_max:9.2f}   height = {local_height:.2f}")
    print(f"  Z : {lz_min:9.2f} → {lz_max:9.2f}   depth  = {lz_max - lz_min:.2f}")
    print(f"\n[Hinge dimensions (from fractions)]")
    print(f"  radius = {local_width * gen.HINGE_RADIUS_FRAC:.3f}  "
          f"({gen.HINGE_RADIUS_FRAC*100:.0f}% of width)")
    print(f"  depth  = {local_width * gen.HINGE_DEPTH_FRAC:.3f}  "
          f"({gen.HINGE_DEPTH_FRAC*100:.0f}% of width)")

    # ── Create hinge (standalone, not parented) ─────────────────────────────
    gen.create_or_get_hinge()
    hinge = bpy.data.objects.get(gen.HINGE_NAME)
    if not hinge:
        print("\nFAIL: hinge object was not created.")
        return
    print(f"\n[Hinge object created — will be positioned per-frame in world space]")

    # HDRI list for background
    hdri_images = (
        _glob.glob(os.path.join(gen.HDRI_DIR, "*.exr")) +
        _glob.glob(os.path.join(gen.HDRI_DIR, "*.hdr"))
    )

    # ── Per-frame loop ────────────────────────────────────────────────────────
    results = []
    for fi in range(N_FRAMES):
        yaw_deg = YAWS[fi % len(YAWS)]
        print(f"\n── Frame {fi+1}/{N_FRAMES}  (yaw = {yaw_deg}°) " + "─" * 30)

        # Apply board transform
        rot_m = gen.auto_scale_and_flatten(board, target_size=gen.DYNAMIC_BOARD_TARGET_SIZE)
        yaw_m = mathutils.Euler((0, 0, math.radians(yaw_deg))).to_matrix()
        board.rotation_euler = (yaw_m @ rot_m).to_euler()
        board.location       = (0, 0, -5.0)
        board.hide_render    = False;  board.hide_viewport  = False

        # Position hinge in world space using the board's actual world bbox
        gen.position_hinge_on_board(board)
        bpy.context.view_layer.update()

        # Print hinge world position after transform
        hinge_world = hinge.matrix_world.translation
        print(f"  Hinge world pos  : ({hinge_world.x:.3f}, {hinge_world.y:.3f}, {hinge_world.z:.3f})")
        print(f"  Hinge world scale: ({hinge.scale.x:.3f}, {hinge.scale.y:.3f}, {hinge.scale.z:.3f})")

        # ── Render main image (color, for visual inspection) ──────────────────
        raw_path = os.path.join(TEST_DIR, f"test_frame_{fi:02d}_raw.png")
        scene.render.filepath = raw_path
        bpy.ops.render.render(write_still=True)

        # ── Board mask → polygon ──────────────────────────────────────────────
        board_poly = gen.render_board_mask(scene, gen.RES_X, gen.RES_Y)
        board_ok   = board_poly is not None and len(board_poly) >= 3
        if board_ok:
            print(f"  board  (cls 11) : ✓  {len(board_poly)} polygon points")
        else:
            print(f"  board  (cls 11) : ✗  mask empty")

        # ── Hinge mask → bbox ─────────────────────────────────────────────────
        hinge_bb = gen.render_hinge_bbox(scene, gen.RES_X, gen.RES_Y)
        hinge_ok = hinge_bb is not None
        if hinge_ok:
            cx, cy, bw, bh = hinge_bb
            print(f"  hinge  (cls 12) : ✓  cx={cx:.3f}  cy={cy:.3f}  "
                  f"w={bw:.3f}  h={bh:.3f}")
        else:
            print(f"  hinge  (cls 12) : ✗  mask empty — hinge not visible in render")

        # ── Annotated preview ─────────────────────────────────────────────────
        img = cv2.imread(raw_path)
        if img is not None:
            if board_ok:
                draw_polygon(img, board_poly, (0, 220, 80),   f"board (cls 11)")
            if hinge_ok:
                draw_bbox(img, hinge_bb,     (255, 220, 0),  f"hinge (cls 12)")

            ann_path = os.path.join(TEST_DIR, f"test_frame_{fi:02d}_annotated.png")
            cv2.imwrite(ann_path, img)
            print(f"  annotated saved : {os.path.basename(ann_path)}")

        results.append(dict(frame=fi, yaw=yaw_deg, board=board_ok, hinge=hinge_ok))

    # ── Summary ───────────────────────────────────────────────────────────────
    n_board = sum(r['board'] for r in results)
    n_hinge = sum(r['hinge'] for r in results)

    print("\n" + "=" * 62)
    print("  SUMMARY")
    print("=" * 62)
    print(f"  {'Frame':<8}  {'Yaw':>5}   Board   Hinge")
    print(f"  {'-'*8}  {'-'*5}   {'-'*5}   {'-'*5}")
    for r in results:
        b = "✓" if r['board'] else "✗"
        h = "✓" if r['hinge'] else "✗"
        print(f"  {r['frame']+1:<8}  {r['yaw']:>4}°     {b}       {h}")
    print(f"\n  Board  passed : {n_board}/{N_FRAMES}")
    print(f"  Hinge  passed : {n_hinge}/{N_FRAMES}")
    print(f"\n  Previews : {TEST_DIR}/")

    if n_hinge == 0:
        print("\n  ✗ Hinge not detected in any frame.")
        print("    1. Open test_frame_00_raw.png — is a cylinder visible at the board edge?")
        print("       If NO cylinder is visible at all → parenting or creation failed.")
        print("       If a tiny dot is visible → increase HINGE_RADIUS_FRAC in the generator.")
        print("    2. If the cylinder is at the WRONG edge → swap min↔max for")
        print("       local_top_y in create_or_get_hinge() and re-run this test.")
    elif n_hinge < N_FRAMES:
        print(f"\n  ⚠  Hinge missing in {N_FRAMES - n_hinge} frame(s) — check annotated images.")
    else:
        print("\n  ✓ All checks passed — safe to run the full dataset generation.")

    print("=" * 62 + "\n")


if __name__ == "__main__":
    run()
