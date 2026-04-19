"""
IQ Noodles — Synthetic YOLO Segmentation Dataset Generator (Blender)
====================================================================
Generates training/validation images with per-piece segmentation polygons
using Blender renders. Outputs YOLO-format labels for 14 classes:
  0–10  pieces A–K
  11    board polygon
  12    hinge (yaml-only, NOT generated in synthetic data)
  13    pin (camera-projected disc polygons from board_inner bounds)

Run inside Blender:  blender scene.blend --background --python blender_yolo_generator_v2.py
"""

import bpy
import bpy_extras
import mathutils
import math
import random
import os
import glob
import urllib.request
import sys
import re
import subprocess

import numpy as np

# Auto-install OpenCV if missing in Blender's bundled Python
try:
    import cv2
except ImportError:
    print("OpenCV not found — installing into Blender's Python …")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "opencv-python"])
    import cv2
    print("OpenCV installed successfully.")


# ═══════════════════════════════════════════════════════════════════════════════
# §1  CONFIGURATION / CONSTANTS
# ═══════════════════════════════════════════════════════════════════════════════

# ---- Dataset sizing ----
TOTAL_TRAIN_IMAGES = 1920
TOTAL_VAL_IMAGES = 480
TOTAL_IMAGES = TOTAL_TRAIN_IMAGES + TOTAL_VAL_IMAGES
IMAGES_PER_PIECE_ALONE = 50

# ---- Image resolution ----
RES_X, RES_Y = 1024, 1024

# ---- Output paths (relative to .blend file) ----
OUTPUT_DIR = bpy.path.abspath("//yolo_dataset")
IMAGES_DIR = os.path.join(OUTPUT_DIR, "images")
LABELS_DIR = os.path.join(OUTPUT_DIR, "labels")

# ---- Piece identity mapping (class 0–10) ----
PIECE_COLORS = {
    "piece_A": ("A_Yellow",      (0xF9, 0xD6, 0x5E)),   # 0
    "piece_B": ("B_SkyBlue",     (0x08, 0xA7, 0xE8)),   # 1
    "piece_C": ("C_DarkBlue",    (0x20, 0x6D, 0xD9)),   # 2
    "piece_D": ("D_Green",       (0x1F, 0xA1, 0x5B)),   # 3
    "piece_E": ("E_Red",         (0xEE, 0x39, 0x4F)),   # 4
    "piece_F": ("F_Teal",        (0x85, 0xDA, 0xBB)),   # 5
    "piece_G": ("G_Pink",        (0xEC, 0x71, 0xA8)),   # 6
    "piece_H": ("H_Purple",      (0xC7, 0x78, 0xB9)),   # 7
    "piece_I": ("I_Orange",      (0xFC, 0x69, 0x0C)),   # 8
    "piece_J": ("J_DarkRed",     (0xB6, 0x30, 0x48)),   # 9
    "piece_K": ("K_YellowGreen", (0x95, 0xD4, 0x50)),   # 10
}
PIECE_NAMES = list(PIECE_COLORS.keys())  # piece_A … piece_K
CLASS_MAP = {name: i for i, name in enumerate(PIECE_NAMES)}

# ---- STL object name mapping ----
MANUAL_STL_PIECE_ORDER = [
    "IQ-Noodles.012",  # A
    "IQ-Noodles.009",  # B
    "IQ-Noodles.004",  # C
    "IQ-Noodles.008",  # D
    "IQ-Noodles.011",  # E
    "IQ-Noodles.014",  # F
    "IQ-Noodles.010",  # G
    "IQ-Noodles.005",  # H
    "IQ-Noodles.013",  # I
    "IQ-Noodles.006",  # J
    "IQ-Noodles.007",  # K
]
MANUAL_STL_BOARD_NAME = "IQ-Noodles.003"

AUTO_REMAP_STL_NAMES = True
STL_OBJECT_NAME_REGEX = r"^IQ[-_ ]?Noodles?(?:\.\d+)?$"

# ---- Board / scene constants ----
BOARD_NAME = "board"
BOARD_COLOR = (40, 42, 45)
HINGE_NAME = "hinge"
CLASS_BOARD = 11
CLASS_HINGE = 12
CLASS_PIN = 13

# ---- Pin label (class 13) ----
# Pins are camera-projected from canonical board_inner-local positions.
# 21 pins sit at 2x2-cell-block centers of the 14x14 grid (per the engine's
# POSITIONS_AROUND_PINS definition). We duplicate the grid-corner math here so
# the generator stays self-contained and doesn't import webapp engine code.
# Each synthetic pin label is a fixed-radius disc polygon in render-space.
PIN_RENDER_RADIUS_PX = 7.0
PIN_POLYGON_SIDES = 10
# (row, col) grid-corner for each of the 21 pins, derived once from
# POSITIONS_AROUND_PINS in the engine: pin center sits at (min_row+1, min_col+1)
# of each 2x2 cell block.
PIN_GRID_CORNERS = [
    (1, 5), (1, 9),
    (3, 3), (3, 7), (3, 11),
    (5, 1), (5, 5), (5, 9), (5, 13),
    (7, 3), (7, 7), (7, 11),
    (9, 1), (9, 5), (9, 9), (9, 13),
    (11, 3), (11, 7), (11, 11),
    (13, 5), (13, 9),
]
# When board is visible but a pin projects near a piece, still emit the label —
# real pins remain partially visible through/beside threading rope, and YOLO
# handles mild occlusion fine. Skip only on full-frame clipping.

DYNAMIC_PIECE_TARGET_SIZE = 1.0
DYNAMIC_BOARD_TARGET_SIZE = 12.0
# Keep STL/import proportions by default. Set False to normalize sizes to targets above.
PRESERVE_IMPORTED_OBJECT_SCALE = True

# ---- Camera framing ----
CAMERA_LENS_MM = 35.0
CAMERA_FRAMING_MARGIN = 1.20
PLACEMENT_RADIUS = 3.5
MAX_TILT_DEGREES = 5.0
MAX_PLACEMENT_RETRIES = 500

# ---- Overlap / visibility ----
ALLOW_SMALL_OVERLAP = True
MAX_ALLOWED_OVERLAP_RATIO = 0.015
MIN_VISIBLE_PIECES_PER_IMAGE = 1

# ---- Board pose randomization ----
BOARD_VISIBILITY_PROB = 0.50
BOARD_BASE_Z = -5.0
BOARD_POS_JITTER_XY = 0.45
BOARD_POS_JITTER_Z = 0.30
BOARD_YAW_JITTER_DEGREES = 12.0
BOARD_TILT_DEGREES = 4.5

# ---- Board label (class 11) ----
# Kept for the class-11 board-mask rendering pipeline (see render_board_mask /
# resolve_board_label_object_name). This is NOT used for any solved-board layout.
MANUAL_BOARD_INNER_OBJECT_NAME = "board_inner"
BOARD_LABEL_USE_INNER_MASK = True
BOARD_INNER_INSET_RATIO = 0.025
BOARD_INNER_MIN_INSET_PX = 2

RANDOM_PIECE_Z = 5.0
RANDOM_EDGE_MARGIN = 0.05

# ---- HDRI backgrounds ----
HDRI_DIR = bpy.path.abspath("//hdri_env")
AUTO_DOWNLOAD_HDRIS = [
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/small_empty_room_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/billiard_hall_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/autoshop_01_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/music_hall_01_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/carpentry_shop_02_1k.hdr",
]


# ═══════════════════════════════════════════════════════════════════════════════
# §2  BLENDER HELPERS (naming, scaling, materials)
# ═══════════════════════════════════════════════════════════════════════════════

def hex_to_rgb(hex_tuple):
    return [(c / 255.0) ** 2.2 for c in hex_tuple] + [1.0]


def _local_bbox_dims(obj):
    pts = [mathutils.Vector(v) for v in obj.bound_box]
    return (
        max(p.x for p in pts) - min(p.x for p in pts),
        max(p.y for p in pts) - min(p.y for p in pts),
        max(p.z for p in pts) - min(p.z for p in pts),
    )


def _footprint_area(obj):
    dx, dy, _ = _local_bbox_dims(obj)
    return max(dx * dy, 1e-9)


def _suffix_index(name):
    m = re.search(r"\.(\d+)$", name)
    return int(m.group(1)) if m else 0


def _natural_stl_sort_key(obj):
    return (_suffix_index(obj.name), obj.name.lower())


def _rename_object_safe(obj, target_name):
    if not obj or obj.name == target_name:
        return
    existing = bpy.data.objects.get(target_name)
    if existing and existing != obj:
        existing.name = f"{target_name}__old"
    obj.name = target_name


def _select_piece_objects(piece_pool, piece_count):
    if len(piece_pool) <= piece_count:
        return sorted(piece_pool, key=_natural_stl_sort_key)
    areas = [_footprint_area(obj) for obj in piece_pool]
    median_area = max(float(np.median(areas)), 1e-9)
    ranked = sorted(
        piece_pool,
        key=lambda obj: abs(math.log(max(_footprint_area(obj), 1e-9) / median_area)),
    )
    return sorted(ranked[:piece_count], key=_natural_stl_sort_key)


def auto_remap_stl_object_names():
    """Map combined STL names (IQ-Noodles.NNN) → canonical piece_A…piece_K + board."""
    if not AUTO_REMAP_STL_NAMES:
        return

    # Already mapped?
    if all(bpy.data.objects.get(n) for n in PIECE_NAMES) and bpy.data.objects.get(BOARD_NAME):
        print("Objects already have canonical names — skipping remap.")
        return

    mesh_objs = [obj for obj in bpy.data.objects if obj.type == "MESH"]
    if not mesh_objs:
        print("WARNING: No MESH objects in scene — cannot remap.")
        return

    print(f"Scene objects before remap: {[o.name for o in bpy.data.objects if o.type == 'MESH']}")

    # --- Manual mapping path (preferred) ---
    if MANUAL_STL_PIECE_ORDER and len(MANUAL_STL_PIECE_ORDER) == len(PIECE_NAMES):
        missing = [n for n in MANUAL_STL_PIECE_ORDER if not bpy.data.objects.get(n)]
        if not missing:
            # IMPORTANT: Grab direct object references BEFORE any renames.
            # Blender can reassign .NNN suffixes when names become available,
            # so we resolve all source objects while names are still stable.
            board_src = bpy.data.objects.get(MANUAL_STL_BOARD_NAME) if MANUAL_STL_BOARD_NAME else None
            piece_srcs = []
            for src_name in MANUAL_STL_PIECE_ORDER:
                obj = bpy.data.objects.get(src_name)
                piece_srcs.append(obj)

            if not board_src:
                fallback = [o for o in mesh_objs if o.name not in MANUAL_STL_PIECE_ORDER]
                board_src = max(fallback, key=_footprint_area) if fallback else None

            # Rename board first
            if board_src:
                print(f"  board <= {board_src.name}")
                _rename_object_safe(board_src, BOARD_NAME)

            # Rename pieces using saved references (not by name lookup!)
            print("Using MANUAL_STL_PIECE_ORDER remap:")
            for canonical, src_obj in zip(PIECE_NAMES, piece_srcs):
                if src_obj:
                    print(f"  {canonical} <= {src_obj.name}")
                    _rename_object_safe(src_obj, canonical)
                else:
                    print(f"  WARNING: No object for {canonical}")

            # Verify
            ok = True
            for name in PIECE_NAMES:
                if not bpy.data.objects.get(name):
                    print(f"  VERIFY FAIL: '{name}' not found after remap!")
                    ok = False
            if not bpy.data.objects.get(BOARD_NAME):
                print(f"  VERIFY FAIL: '{BOARD_NAME}' not found after remap!")
                ok = False
            if ok:
                print("  Remap verified: all pieces + board present.")
            print(f"Scene objects after remap: {[o.name for o in bpy.data.objects if o.type == 'MESH']}")
            return
        else:
            print(f"WARNING: Manual STL names not found in scene: {missing}")
            print(f"  Available: {[o.name for o in mesh_objs]}")

    # --- Auto-detect fallback ---
    pattern = re.compile(STL_OBJECT_NAME_REGEX, re.IGNORECASE)
    grouped = [obj for obj in mesh_objs if pattern.match(obj.name)]
    if len(grouped) < len(PIECE_NAMES) + 1:
        print(f"WARNING: Only {len(grouped)} IQ-Noodles objects found (need {len(PIECE_NAMES) + 1}).")
        return

    board_obj = bpy.data.objects.get(BOARD_NAME) or max(grouped, key=_footprint_area)
    piece_pool = [o for o in grouped if o != board_obj and o.name != HINGE_NAME]
    if len(piece_pool) < len(PIECE_NAMES):
        piece_pool = [o for o in mesh_objs if o != board_obj and o.name != HINGE_NAME]
    if len(piece_pool) < len(PIECE_NAMES):
        print(f"WARNING: Only {len(piece_pool)} piece candidates found — cannot auto-remap.")
        return

    selected = _select_piece_objects(piece_pool, len(PIECE_NAMES))
    _rename_object_safe(board_obj, BOARD_NAME)
    print("Auto remapping combined STL object names:")
    for canonical, src in zip(PIECE_NAMES, selected):
        print(f"  {canonical} <= {src.name}")
        _rename_object_safe(src, canonical)
    print("WARNING: Verify A..K identity if semantic class order is critical.")


def hide_unmapped_objects():
    """Hide any MESH objects that are NOT mapped to a canonical name.

    After remap, objects like IQ-Noodles (base), .001, .002 still exist with
    their original transforms and are never touched by hide_all_pieces().
    If they're large (box lid, duplicate board, etc.) they occlude everything.
    """
    keep = set(PIECE_NAMES) | {BOARD_NAME, HINGE_NAME}
    if MANUAL_BOARD_INNER_OBJECT_NAME:
        keep.add(MANUAL_BOARD_INNER_OBJECT_NAME)
    # Keep camera + any user-placed pin markers (pin_00..pin_20).
    keep.add("Camera")
    keep.update(PIN_OBJECT_NAME_TEMPLATE.format(i) for i in range(21))

    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name not in keep:
            obj.hide_render = True
            obj.hide_viewport = True
            print(f"  Hiding unmapped object: '{obj.name}'")


def center_origins_to_geometry():
    # Force depsgraph evaluation so bound_box is valid (critical in --background mode)
    bpy.context.view_layer.update()

    for name in PIECE_NAMES + [BOARD_NAME]:
        obj = bpy.data.objects.get(name)
        if not obj or obj.type != "MESH":
            continue
        local_center = sum((mathutils.Vector(b) for b in obj.bound_box), mathutils.Vector()) / 8.0
        for v in obj.data.vertices:
            v.co -= local_center
        obj.data.update()  # Mark mesh dirty so bound_box is recomputed
        obj.location += obj.matrix_world.to_3x3() @ local_center

    # Update again after all origins moved
    bpy.context.view_layer.update()


def apply_color_to_obj(obj, color):
    mat_name = f"Mat_{obj.name}"
    mat = bpy.data.materials.get(mat_name)
    if not mat:
        mat = bpy.data.materials.new(name=mat_name)
        mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = hex_to_rgb(color)
        bsdf.inputs["Roughness"].default_value = 0.8
        bsdf.inputs["Specular IOR Level"].default_value = 0.1
    if len(obj.data.materials) == 0:
        obj.data.materials.append(mat)
    else:
        obj.data.materials[0] = mat


def setup_materials():
    for name, (_, color) in PIECE_COLORS.items():
        obj = bpy.data.objects.get(name)
        if obj:
            apply_color_to_obj(obj, color)
    board = bpy.data.objects.get(BOARD_NAME)
    if board:
        apply_color_to_obj(board, BOARD_COLOR)


def auto_scale_and_flatten(obj, target_size):
    dx, dy, dz = _local_bbox_dims(obj)
    max_dim = max(dx, dy, dz)
    if not PRESERVE_IMPORTED_OBJECT_SCALE and max_dim > 1e-4:
        s = target_size / max_dim
        obj.scale = (s, s, s)
    min_dim = min(dx, dy, dz)
    if min_dim == dx:
        base_rot = mathutils.Euler((0, math.radians(90), 0))
    elif min_dim == dy:
        base_rot = mathutils.Euler((math.radians(90), 0, 0))
    else:
        base_rot = mathutils.Euler((0, 0, 0))
    return base_rot.to_matrix()


def configure_capture_camera(cam, scene):
    """Configure perspective camera to avoid over-zoomed captures.

    Fits camera distance from expected XY footprint using current lens + scene objects.
    """
    cam.data.type = "PERSP"
    cam.data.lens = CAMERA_LENS_MM
    cam.rotation_euler = (0, 0, 0)

    # Start from intended random placement spread.
    target_half_extent = PLACEMENT_RADIUS + 0.5

    board_obj = bpy.data.objects.get(BOARD_NAME)
    if board_obj:
        bounds = get_object_world_bounds(board_obj)
        board_half_extent = 0.5 * max(
            bounds["max_x"] - bounds["min_x"],
            bounds["max_y"] - bounds["min_y"],
        )
        target_half_extent = max(target_half_extent, board_half_extent + 0.25)

    sensor_width = cam.data.sensor_width if cam.data.sensor_width > 0 else 36.0
    hfov = 2.0 * math.atan(sensor_width / (2.0 * cam.data.lens))
    hfov = max(hfov, math.radians(5.0))

    required_depth = (target_half_extent * CAMERA_FRAMING_MARGIN) / math.tan(hfov * 0.5)
    cam.location = (0, 0, RANDOM_PIECE_Z + required_depth)
    cam.data.clip_start = 0.1
    cam.data.clip_end = max(200.0, cam.location.z + 100.0)

    print(
        f"Camera configured: lens={cam.data.lens:.1f}mm z={cam.location.z:.2f} "
        f"target_half_extent={target_half_extent:.2f}"
    )


# ═══════════════════════════════════════════════════════════════════════════════
# §5  PLACEMENT HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def hide_all_pieces():
    for name in PIECE_NAMES:
        obj = bpy.data.objects.get(name)
        if obj:
            obj.hide_render = True
            obj.hide_viewport = True


def show_only_piece_set(visible_piece_names):
    visible = set(visible_piece_names)
    for name in PIECE_NAMES:
        obj = bpy.data.objects.get(name)
        if obj:
            obj.hide_render = name not in visible
            obj.hide_viewport = name not in visible


def get_2d_bounding_box(scene, cam, obj):
    min_x = min_y = 1.0
    max_x = max_y = 0.0
    valid = False
    for v in obj.bound_box:
        co3d = obj.matrix_world @ mathutils.Vector(v)
        co2d = bpy_extras.object_utils.world_to_camera_view(scene, cam, co3d)
        if co2d.z > 0:
            min_x = min(min_x, co2d.x)
            max_x = max(max_x, co2d.x)
            min_y = min(min_y, co2d.y)
            max_y = max(max_y, co2d.y)
            valid = True
    return (min_x, min_y, max_x, max_y) if valid else None


def is_overlapping(box1, box2):
    if box1[0] > box2[2] or box2[0] > box1[2]:
        return False
    if box1[1] > box2[3] or box2[1] > box1[3]:
        return False
    if not ALLOW_SMALL_OVERLAP:
        return True
    ix1 = max(box1[0], box2[0])
    iy1 = max(box1[1], box2[1])
    ix2 = min(box1[2], box2[2])
    iy2 = min(box1[3], box2[3])
    inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
    a1 = max(1e-9, (box1[2] - box1[0]) * (box1[3] - box1[1]))
    a2 = max(1e-9, (box2[2] - box2[0]) * (box2[3] - box2[1]))
    return inter / min(a1, a2) > MAX_ALLOWED_OVERLAP_RATIO


def _is_inside_frame(bbox, margin):
    return (bbox[0] >= margin and bbox[2] <= 1.0 - margin and
            bbox[1] >= margin and bbox[3] <= 1.0 - margin)


def try_place_piece(scene, cam, obj, placed_boxes, x_range, y_range, z_value,
                    max_tilt_degrees, frame_margin, max_retries, allow_flip=True):
    base_rot_matrix = auto_scale_and_flatten(obj, target_size=DYNAMIC_PIECE_TARGET_SIZE)
    for _ in range(max_retries):
        yaw = mathutils.Euler((0, 0, random.uniform(0, 2 * math.pi))).to_matrix()
        tx = math.radians(random.uniform(-max_tilt_degrees, max_tilt_degrees))
        ty = math.radians(random.uniform(-max_tilt_degrees, max_tilt_degrees))
        tilt = mathutils.Euler((tx, ty, 0)).to_matrix()
        if allow_flip and random.random() > 0.5:
            flip = mathutils.Euler((math.pi, 0, 0)).to_matrix()
        else:
            flip = mathutils.Matrix.Identity(3)

        obj.rotation_euler = (yaw @ tilt @ flip @ base_rot_matrix).to_euler()
        obj.location.x = random.uniform(x_range[0], x_range[1])
        obj.location.y = random.uniform(y_range[0], y_range[1])
        obj.location.z = z_value
        bpy.context.view_layer.update()

        bbox = get_2d_bounding_box(scene, cam, obj)
        if not bbox:
            continue
        if not _is_inside_frame(bbox, frame_margin):
            continue
        if any(is_overlapping(bbox, pb) for pb in placed_boxes):
            continue

        placed_boxes.append(bbox)
        return True
    return False


def place_active_pieces(scene, cam, active_pieces, x_range, y_range, z_value,
                        max_tilt_degrees, frame_margin, require_all=False,
                        max_retries=MAX_PLACEMENT_RETRIES, context_label="random",
                        allow_flip=True):
    hide_all_pieces()
    placed_boxes = []
    placed = []

    for name in active_pieces:
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        obj.hide_render = False
        obj.hide_viewport = False
        ok = try_place_piece(scene, cam, obj, placed_boxes, x_range, y_range,
                             z_value, max_tilt_degrees, frame_margin, max_retries,
                             allow_flip)
        if not ok:
            obj.hide_render = True
            obj.hide_viewport = True
            if require_all:
                for n in placed:
                    p = bpy.data.objects.get(n)
                    if p:
                        p.hide_render = True
                        p.hide_viewport = True
                return []
            print(f"  INFO ({context_label}) Could not place '{name}', skipping.")
            continue
        placed.append(name)

    # Guarantee at least one visible piece
    if active_pieces and len(placed) < MIN_VISIBLE_PIECES_PER_IMAGE:
        remaining = [n for n in active_pieces if n not in placed]
        for name in remaining:
            obj = bpy.data.objects.get(name)
            if not obj:
                continue
            obj.hide_render = False
            obj.hide_viewport = False
            ok = try_place_piece(scene, cam, obj, placed_boxes, x_range, y_range,
                                 z_value, max_tilt_degrees,
                                 max(0.0, frame_margin * 0.25),
                                 max_retries * 2, allow_flip)
            if ok:
                placed.append(name)
                break
            # Last resort: center the piece
            rot_mat = auto_scale_and_flatten(obj, target_size=DYNAMIC_PIECE_TARGET_SIZE)
            obj.rotation_euler = rot_mat.to_euler()
            obj.location = (0.0, 0.0, z_value)
            bpy.context.view_layer.update()
            placed.append(name)
            break

    return placed


# ═══════════════════════════════════════════════════════════════════════════════
# §6  BOARD POSE HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def set_board_pose(board):
    """Apply a randomized pose to the board object."""
    board_rot_matrix = auto_scale_and_flatten(board, target_size=DYNAMIC_BOARD_TARGET_SIZE)
    yaw_deg = random.choice([0, 90, 180, 270]) + random.uniform(-BOARD_YAW_JITTER_DEGREES, BOARD_YAW_JITTER_DEGREES)
    tilt_x = random.uniform(-BOARD_TILT_DEGREES, BOARD_TILT_DEGREES)
    tilt_y = random.uniform(-BOARD_TILT_DEGREES, BOARD_TILT_DEGREES)
    jxy = BOARD_POS_JITTER_XY
    jz = BOARD_POS_JITTER_Z

    yaw_mat = mathutils.Euler((0, 0, math.radians(yaw_deg))).to_matrix()
    tilt_mat = mathutils.Euler((math.radians(tilt_x), math.radians(tilt_y), 0)).to_matrix()
    board.rotation_euler = (yaw_mat @ tilt_mat @ board_rot_matrix).to_euler()
    board.location = (
        random.uniform(-jxy, jxy),
        random.uniform(-jxy, jxy),
        BOARD_BASE_Z + random.uniform(-jz, jz),
    )


def get_object_world_bounds(obj):
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return {
        "min_x": min(xs), "max_x": max(xs),
        "min_y": min(ys), "max_y": max(ys),
        "min_z": min(zs), "max_z": max(zs),
    }


def capture_relative_transform(parent_obj, child_obj):
    """Capture the child's transform relative to the parent (used for board_inner)."""
    if not parent_obj or not child_obj:
        return None
    bpy.context.view_layer.update()
    return parent_obj.matrix_world.inverted() @ child_obj.matrix_world


def apply_relative_transform(parent_obj, child_obj, rel_matrix):
    """Re-attach child's transform to parent using captured relative matrix."""
    if parent_obj and child_obj and rel_matrix is not None:
        child_obj.matrix_world = parent_obj.matrix_world @ rel_matrix


PIN_OBJECT_NAME_TEMPLATE = "pin_{:02d}"  # pin_00 .. pin_20


def compute_pin_world_positions(board_inner_obj=None):
    """Return 21 pin centers in world space.

    Preferred path: 21 Empty (or mesh) objects named pin_00..pin_20, manually
    placed in the scene at each physical pin's world position. These are
    parented to the board so they inherit pose randomization automatically.
    The generator just reads their world locations per frame.

    The board_inner_obj argument is kept for call-site compatibility but
    unused on this path.
    """
    bpy.context.view_layer.update()
    positions = []
    for i in range(21):
        name = PIN_OBJECT_NAME_TEMPLATE.format(i)
        obj = bpy.data.objects.get(name)
        if obj is None:
            return []  # partial setup — bail; caller skips pin labels this frame
        positions.append(obj.matrix_world.translation.copy())
    return positions


def _project_world_to_image_norm(scene, cam, world_pt):
    """Project a world-space point to normalized image coords (top-left origin).

    Returns (x, y) in [0, 1] if the point is in front of the camera and inside
    the frame; None otherwise.
    """
    co = bpy_extras.object_utils.world_to_camera_view(scene, cam, world_pt)
    if co.z <= 0.0:
        return None
    x = co.x
    y = 1.0 - co.y  # Blender NDC y is bottom-up; YOLO coords are top-down
    if not (0.0 <= x <= 1.0 and 0.0 <= y <= 1.0):
        return None
    return (x, y)


def _disc_polygon_norm(cx, cy, radius_px, res_x, res_y, n_sides=PIN_POLYGON_SIDES):
    """Build an n-gon approximating a disc, in normalized YOLO coords.

    Clamped to [0, 1] so edge-adjacent pins still emit valid polygon labels.
    """
    rx = radius_px / float(res_x)
    ry = radius_px / float(res_y)
    pts = []
    for i in range(n_sides):
        theta = 2.0 * math.pi * i / n_sides
        x = cx + rx * math.cos(theta)
        y = cy + ry * math.sin(theta)
        pts.append((max(0.0, min(1.0, x)), max(0.0, min(1.0, y))))
    return pts


def build_pin_label_polygons(scene, cam, pin_world_positions, res_x, res_y):
    """Project pin positions to image and emit per-pin disc polygon labels.

    Returns a list of polygons (each a list of (x, y) tuples in [0,1]); pins
    that project behind the camera or outside the frame are dropped.
    """
    polygons = []
    for world_pt in pin_world_positions:
        projected = _project_world_to_image_norm(scene, cam, world_pt)
        if projected is None:
            continue
        cx, cy = projected
        polygons.append(_disc_polygon_norm(cx, cy, PIN_RENDER_RADIUS_PX, res_x, res_y))
    return polygons


# ═══════════════════════════════════════════════════════════════════════════════
# §7  GENERATION PLAN
# ═══════════════════════════════════════════════════════════════════════════════

def _build_split_plan(split_name, split_total):
    """Build a split plan consisting entirely of random-placement scenes.

    Solved-board modes were removed; their former allocation is redistributed
    here into the `random` bucket so TOTAL_TRAIN_IMAGES / TOTAL_VAL_IMAGES
    remain unchanged.
    """
    random_budget = split_total
    plan = []

    # One-piece quota
    single_per = min(IMAGES_PER_PIECE_ALONE, random_budget // len(PIECE_NAMES))
    for piece in PIECE_NAMES:
        for _ in range(single_per):
            plan.append({"split": split_name, "mode": "random", "pieces": [piece]})

    # Mixed piece-count buckets fill the remainder of the random budget.
    remaining = random_budget - len(plan)
    buckets = list(range(2, len(PIECE_NAMES) + 1))
    if buckets and remaining > 0:
        per = remaining // len(buckets)
        extra = remaining % len(buckets)
        for idx, pc in enumerate(buckets):
            quota = per + (1 if idx < extra else 0)
            for _ in range(quota):
                plan.append({"split": split_name, "mode": "random",
                             "pieces": random.sample(PIECE_NAMES, pc)})
    elif remaining > 0:
        for _ in range(remaining):
            plan.append({"split": split_name, "mode": "random",
                         "pieces": [random.choice(PIECE_NAMES)]})

    random.shuffle(plan)
    if len(plan) != split_total:
        raise RuntimeError(f"Plan mismatch for '{split_name}': {len(plan)} != {split_total}")

    stats = {
        "total_count": split_total,
        "random_count": split_total,
        "single_per_piece": single_per,
    }
    return plan, stats


def build_generation_plan():
    tp, ts = _build_split_plan("train", TOTAL_TRAIN_IMAGES)
    vp, vs = _build_split_plan("val", TOTAL_VAL_IMAGES)
    plan = tp + vp
    return plan, {
        "total_count": len(plan),
        "random_count": ts["random_count"] + vs["random_count"],
        "split_stats": {"train": ts, "val": vs},
    }


# ═══════════════════════════════════════════════════════════════════════════════
# §8  RENDER-STATE GUARD
# ═══════════════════════════════════════════════════════════════════════════════


def _enter_workbench_mask_mode(scene):
    """Switch to Workbench for single-object white-on-transparent mask rendering."""
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Raw"
    if scene.world:
        scene.world.use_nodes = False
    try:
        sh = scene.display.shading
        sh.light = "FLAT"
        sh.color_type = "SINGLE"
        sh.single_color = (1, 1, 1)
        sh.background_type = "VIEWPORT"
        sh.background_color = (0, 0, 0)
        scene.display.render_aa = "OFF"
    except Exception:
        pass


def _available_render_engines(scene):
    try:
        return {item.identifier for item in scene.render.bl_rna.properties["engine"].enum_items}
    except Exception:
        return {scene.render.engine}


def resolve_rgb_render_engine(scene):
    current = scene.render.engine
    if current != "BLENDER_WORKBENCH":
        return current
    for candidate in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        if candidate in _available_render_engines(scene):
            print(f"INFO: RGB engine auto-switched from WORKBENCH to {candidate}")
            return candidate
    return current


def resolve_rgb_view_transform(scene):
    current = scene.view_settings.view_transform
    if current != "Raw":
        return current
    try:
        available = [item.identifier for item in scene.view_settings.bl_rna.properties["view_transform"].enum_items]
    except Exception:
        available = []
    for candidate in ("AgX", "Filmic", "Standard"):
        if candidate in available:
            print(f"INFO: RGB view transform auto-switched from Raw to {candidate}")
            return candidate
    return current


def ensure_rgb_render_state(scene, rgb_engine, rgb_view_transform):
    """Force the scene back into proper RGB rendering mode."""
    scene.render.engine = rgb_engine
    scene.render.film_transparent = False
    scene.view_settings.view_transform = rgb_view_transform
    if scene.world:
        scene.world.use_nodes = True


# ═══════════════════════════════════════════════════════════════════════════════
# §9  SEGMENTATION MASK EXTRACTION
# ═══════════════════════════════════════════════════════════════════════════════

def render_piece_masks(active_pieces, scene, res_x, res_y):
    """Render per-piece masks with self-contained state save/restore.

    Only hides/shows the active pieces and board/hinge — does NOT touch
    other mesh objects.  Fully restores render engine, view transform,
    shading, and object visibility before returning.
    """
    # ── Save state ──
    orig_engine = scene.render.engine
    orig_transparent = scene.render.film_transparent
    orig_view_transform = scene.view_settings.view_transform
    orig_filepath = scene.render.filepath
    world = scene.world
    orig_world_nodes = world.use_nodes if world else True

    orig_hide = {}
    for name in active_pieces:
        obj = bpy.data.objects.get(name)
        if obj:
            orig_hide[name] = obj.hide_render
    board_obj = bpy.data.objects.get(BOARD_NAME)
    orig_board_hide = board_obj.hide_render if board_obj else True
    if board_obj:
        board_obj.hide_render = True
    hinge_obj = bpy.data.objects.get(HINGE_NAME)
    orig_hinge_hide = hinge_obj.hide_render if hinge_obj else True
    if hinge_obj:
        hinge_obj.hide_render = True
    bi_obj = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME) if MANUAL_BOARD_INNER_OBJECT_NAME else None
    orig_bi_hide = bi_obj.hide_render if bi_obj else True
    if bi_obj:
        bi_obj.hide_render = True

    orig_shading = {}
    try:
        sh = scene.display.shading
        orig_shading = {
            "light": sh.light,
            "color_type": sh.color_type,
            "single_color": sh.single_color[:] if hasattr(sh, "single_color") else (0.8, 0.8, 0.8),
            "background_type": sh.background_type,
            "background_color": sh.background_color[:],
            "render_aa": scene.display.render_aa,
        }
    except Exception:
        pass

    # ── Render each piece mask ──
    masks = {}
    pix = np.zeros(res_x * res_y * 4, dtype=np.float32)

    for target_name in active_pieces:
        # Hide all active pieces, show only target
        for name in active_pieces:
            obj = bpy.data.objects.get(name)
            if obj:
                obj.hide_render = (name != target_name)

        _enter_workbench_mask_mode(scene)

        temp_path = os.path.join(bpy.path.abspath("//"), f"__mask_{target_name}__.png")
        scene.render.filepath = temp_path
        bpy.ops.render.render(write_still=True)

        bimg = bpy.data.images.load(temp_path, check_existing=False)
        bimg.pixels.foreach_get(pix)
        masks[target_name] = np.flipud(pix.reshape(res_y, res_x, 4)[:, :, 3] > 0.5)
        bpy.data.images.remove(bimg)
        try:
            os.remove(temp_path)
        except OSError:
            pass

    # ── Restore state ──
    for name in active_pieces:
        obj = bpy.data.objects.get(name)
        if obj and name in orig_hide:
            obj.hide_render = orig_hide[name]
    if board_obj:
        board_obj.hide_render = orig_board_hide
    if hinge_obj:
        hinge_obj.hide_render = orig_hinge_hide
    if bi_obj:
        bi_obj.hide_render = orig_bi_hide

    scene.render.engine = orig_engine
    scene.render.film_transparent = orig_transparent
    scene.view_settings.view_transform = orig_view_transform
    scene.render.filepath = orig_filepath
    if world:
        world.use_nodes = orig_world_nodes

    if orig_shading:
        try:
            sh = scene.display.shading
            sh.light = orig_shading["light"]
            sh.color_type = orig_shading["color_type"]
            sh.single_color = orig_shading["single_color"]
            sh.background_type = orig_shading["background_type"]
            sh.background_color = orig_shading["background_color"]
            scene.display.render_aa = orig_shading["render_aa"]
        except Exception:
            pass

    return masks


def extract_polygon_from_mask(mask):
    mask_u8 = (mask.astype(np.uint8)) * 255
    cnts, _ = cv2.findContours(mask_u8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_KCOS)
    if not cnts:
        return None
    cnt = max(cnts, key=cv2.contourArea)
    if len(cnt) < 3:
        return None
    h, w = mask.shape
    eps = 0.002 * cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, eps, True)
    pts = approx.reshape(-1, 2).astype(float)
    return [(x / w, y / h) for x, y in pts]


def compute_board_inner_inset_px(mask):
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any() or not cols.any():
        return 0
    y_idx = np.nonzero(rows)[0]
    x_idx = np.nonzero(cols)[0]
    bh = int(y_idx[-1] - y_idx[0] + 1)
    bw = int(x_idx[-1] - x_idx[0] + 1)
    inset = int(round(min(bw, bh) * BOARD_INNER_INSET_RATIO))
    return max(BOARD_INNER_MIN_INSET_PX, inset)


def extract_inner_polygon_from_mask(mask):
    inset = compute_board_inner_inset_px(mask)
    if inset <= 0:
        return extract_polygon_from_mask(mask)
    mask_u8 = (mask.astype(np.uint8)) * 255
    ksz = max(3, inset * 2 + 1)
    eroded = cv2.erode(mask_u8, np.ones((ksz, ksz), np.uint8), iterations=1)
    if not np.any(eroded):
        return extract_polygon_from_mask(mask)
    return extract_polygon_from_mask(eroded > 0)


def resolve_board_label_object_name():
    if MANUAL_BOARD_INNER_OBJECT_NAME:
        obj = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME)
        if obj and obj.type == "MESH":
            return MANUAL_BOARD_INNER_OBJECT_NAME
    return BOARD_NAME


def render_board_mask(scene, res_x, res_y):
    """Render board mask with self-contained state save/restore."""
    label_obj_name = resolve_board_label_object_name()
    label_obj = bpy.data.objects.get(label_obj_name)
    if not label_obj:
        return None

    # ── Save state ──
    orig_engine = scene.render.engine
    orig_transparent = scene.render.film_transparent
    orig_view_transform = scene.view_settings.view_transform
    orig_filepath = scene.render.filepath
    world = scene.world
    orig_world_nodes = world.use_nodes if world else True

    # Save visibility for ALL mesh objects
    orig_hide = {}
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            orig_hide[obj.name] = obj.hide_render

    orig_shading = {}
    try:
        sh = scene.display.shading
        orig_shading = {
            "light": sh.light,
            "color_type": sh.color_type,
            "single_color": sh.single_color[:] if hasattr(sh, "single_color") else (0.8, 0.8, 0.8),
            "background_type": sh.background_type,
            "background_color": sh.background_color[:],
            "render_aa": scene.display.render_aa,
        }
    except Exception:
        pass

    # ── Hide everything, show only label object ──
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.hide_render = True
    label_obj.hide_render = False

    _enter_workbench_mask_mode(scene)

    temp_path = os.path.join(bpy.path.abspath("//"), f"__mask_board__.png")
    scene.render.filepath = temp_path
    bpy.ops.render.render(write_still=True)

    bimg = bpy.data.images.load(temp_path, check_existing=False)
    pix = np.zeros(res_x * res_y * 4, dtype=np.float32)
    bimg.pixels.foreach_get(pix)
    mask = np.flipud(pix.reshape(res_y, res_x, 4)[:, :, 3] > 0.5)
    bpy.data.images.remove(bimg)
    try:
        os.remove(temp_path)
    except OSError:
        pass

    # ── Restore state ──
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name in orig_hide:
            obj.hide_render = orig_hide[obj.name]

    scene.render.engine = orig_engine
    scene.render.film_transparent = orig_transparent
    scene.view_settings.view_transform = orig_view_transform
    scene.render.filepath = orig_filepath
    if world:
        world.use_nodes = orig_world_nodes

    if orig_shading:
        try:
            sh = scene.display.shading
            sh.light = orig_shading["light"]
            sh.color_type = orig_shading["color_type"]
            sh.single_color = orig_shading["single_color"]
            sh.background_type = orig_shading["background_type"]
            sh.background_color = orig_shading["background_color"]
            scene.display.render_aa = orig_shading["render_aa"]
        except Exception:
            pass

    # ── Extract polygon ──
    if label_obj_name == BOARD_NAME and BOARD_LABEL_USE_INNER_MASK:
        return extract_inner_polygon_from_mask(mask)
    return extract_polygon_from_mask(mask)


# ═══════════════════════════════════════════════════════════════════════════════
# §10  HDRI / WORLD SETUP
# ═══════════════════════════════════════════════════════════════════════════════

def download_hdris_if_missing():
    os.makedirs(HDRI_DIR, exist_ok=True)
    existing = glob.glob(os.path.join(HDRI_DIR, "*.exr")) + glob.glob(os.path.join(HDRI_DIR, "*.hdr"))
    if len(existing) >= len(AUTO_DOWNLOAD_HDRIS):
        return
    print("Downloading HDRI environments …")
    for url in AUTO_DOWNLOAD_HDRIS:
        filename = url.split("/")[-1]
        filepath = os.path.join(HDRI_DIR, filename)
        if not os.path.exists(filepath):
            try:
                urllib.request.urlretrieve(url, filepath)
            except Exception as e:
                print(f"  Failed: {url}: {e}")


def prepare_hdri_background(use_board, hdri_images, board_inner_rel=None):
    scene = bpy.context.scene
    world = bpy.data.worlds.get("World")
    if not world:
        world = bpy.data.worlds.new("World")
    # Always bind this world to the active scene so node edits affect renders.
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes.clear()

    bg = world.node_tree.nodes.new("ShaderNodeBackground")
    out = world.node_tree.nodes.new("ShaderNodeOutputWorld")
    world.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])

    board = bpy.data.objects.get(BOARD_NAME)
    if board:
        board.hide_render = not use_board
        board.hide_viewport = not use_board
        if use_board:
            set_board_pose(board)

    # Keep board_inner hidden in RGB renders
    bi = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME) if MANUAL_BOARD_INNER_OBJECT_NAME else None
    if board and bi and board_inner_rel is not None:
        apply_relative_transform(board, bi, board_inner_rel)
    if bi:
        bi.hide_render = True
        bi.hide_viewport = True

    # Hinge is NOT rendered in synthetic data
    hinge = bpy.data.objects.get(HINGE_NAME)
    if hinge:
        hinge.hide_render = True
        hinge.hide_viewport = True

    if hdri_images:
        env = world.node_tree.nodes.new("ShaderNodeTexEnvironment")
        world.node_tree.links.new(env.outputs["Color"], bg.inputs["Color"])
        env.image = bpy.data.images.load(random.choice(hdri_images), check_existing=True)
        tc = world.node_tree.nodes.new("ShaderNodeTexCoord")
        mp = world.node_tree.nodes.new("ShaderNodeMapping")
        mp.inputs["Rotation"].default_value = (
            random.uniform(0, 6.28),
            random.uniform(0, 6.28),
            random.uniform(0, 6.28),
        )
        world.node_tree.links.new(tc.outputs["Generated"], mp.inputs["Vector"])
        world.node_tree.links.new(mp.outputs["Vector"], env.inputs["Vector"])


# ═══════════════════════════════════════════════════════════════════════════════
# §11  DATASET YAML + DIRECTORY CREATION
# ═══════════════════════════════════════════════════════════════════════════════

def create_output_dirs_and_yaml():
    for split in ("train", "val"):
        os.makedirs(os.path.join(IMAGES_DIR, split), exist_ok=True)
        os.makedirs(os.path.join(LABELS_DIR, split), exist_ok=True)

    yaml_path = os.path.join(OUTPUT_DIR, "dataset.yaml")
    with open(yaml_path, "w") as f:
        f.write(f"path: {OUTPUT_DIR}\n")
        f.write("train: images/train\n")
        f.write("val: images/val\n\n")
        f.write("names:\n")
        for i, name in enumerate(PIECE_NAMES):
            f.write(f"  {i}: {PIECE_COLORS[name][0]}\n")
        f.write(f"  {CLASS_BOARD}: board\n")
        f.write(f"  {CLASS_HINGE}: hinge\n")
        f.write(f"  {CLASS_PIN}: pin\n")
    print(f"dataset.yaml written to {yaml_path}")


# ═══════════════════════════════════════════════════════════════════════════════
# §12  MAIN GENERATION LOOP
# ═══════════════════════════════════════════════════════════════════════════════

def generate_dataset():
    scene = bpy.context.scene

    # Resolve and lock the RGB render engine/view-transform once
    rgb_engine = resolve_rgb_render_engine(scene)
    rgb_view_transform = resolve_rgb_view_transform(scene)

    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    scene.render.resolution_percentage = 100

    # Disable shadows for speed
    if hasattr(scene, "eevee"):
        for attr, val in [("use_soft_shadows", False), ("use_shadows", False),
                          ("shadow_cascade_size", "64"), ("shadow_method", "NONE")]:
            try:
                setattr(scene.eevee, attr, val)
            except Exception:
                pass

    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.visible_shadow = False

    # Ensure camera
    cam = scene.camera
    if not cam:
        cam_data = bpy.data.cameras.new(name="Camera")
        cam = bpy.data.objects.new("Camera", cam_data)
        bpy.context.collection.objects.link(cam)
        scene.camera = cam
    cam.location = (0, 0, 15.0)
    cam.rotation_euler = (0, 0, 0)
    cam.data.type = "PERSP"
    cam.data.lens = CAMERA_LENS_MM

    # Remap STL names → canonical piece/board names
    auto_remap_stl_object_names()
    hide_unmapped_objects()

    missing = [p for p in PIECE_NAMES if not bpy.data.objects.get(p)]
    if missing:
        print(f"\nCRITICAL: Missing pieces: {missing}\n")
        return
    if not bpy.data.objects.get(BOARD_NAME):
        print(f"\nCRITICAL: Board '{BOARD_NAME}' not found\n")
        return

    # Setup
    create_output_dirs_and_yaml()
    download_hdris_if_missing()
    center_origins_to_geometry()
    setup_materials()
    configure_capture_camera(cam, scene)

    scene.use_nodes = False
    hide_all_pieces()

    board_ref = bpy.data.objects.get(BOARD_NAME)
    board_inner_obj = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME) if MANUAL_BOARD_INNER_OBJECT_NAME else None
    board_inner_rel = None
    if board_ref and board_inner_obj:
        board_inner_rel = capture_relative_transform(board_ref, board_inner_obj)
        print(f"Using manual inner-board label object: {MANUAL_BOARD_INNER_OBJECT_NAME}")

    hdri_images = glob.glob(os.path.join(HDRI_DIR, "*.exr")) + glob.glob(os.path.join(HDRI_DIR, "*.hdr"))
    plan, stats = build_generation_plan()

    # Print plan summary
    ts = stats["split_stats"]["train"]
    vs = stats["split_stats"]["val"]
    print(f"\nGeneration plan: {stats['total_count']} images (all random placements)")
    print(f"  Train: {ts['total_count']} (random={ts['random_count']}, "
          f"single/piece={ts['single_per_piece']})")
    print(f"  Val:   {vs['total_count']} (random={vs['random_count']}, "
          f"single/piece={vs['single_per_piece']})")

    for i, sample in enumerate(plan):
        split = sample["split"]
        mode = sample["mode"]
        active_pieces = list(sample["pieces"])

        # Only random mode remains; solved-board modes were dropped.
        use_board = random.random() < BOARD_VISIBILITY_PROB
        prepare_hdri_background(use_board, hdri_images, board_inner_rel=board_inner_rel)
        active_pieces = place_active_pieces(
            scene, cam, active_pieces,
            (-PLACEMENT_RADIUS, PLACEMENT_RADIUS),
            (-PLACEMENT_RADIUS, PLACEMENT_RADIUS),
            RANDOM_PIECE_Z, MAX_TILT_DEGREES, RANDOM_EDGE_MARGIN,
            context_label="random")

        scene.frame_set(i)

        # 1. Render per-piece segmentation masks (self-contained save/restore)
        masks = render_piece_masks(active_pieces, scene, RES_X, RES_Y)
        polygons = {name: extract_polygon_from_mask(m) for name, m in masks.items()}

        # 2. Render final RGB image
        #    Force RGB state to be absolutely sure we're not in Workbench mode.
        ensure_rgb_render_state(scene, rgb_engine, rgb_view_transform)
        bpy.context.view_layer.update()

        img_filename = f"{i:06d}.png"
        img_path = os.path.join(IMAGES_DIR, split, img_filename)
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGB"
        scene.render.filepath = img_path
        bpy.ops.render.render(write_still=True)

        # 3. Board polygon mask (class 11) — rendered AFTER the RGB image
        #    so its Workbench pass can't contaminate the final render.
        board_poly = None
        pin_polys = []
        if use_board:
            board_poly = render_board_mask(scene, RES_X, RES_Y)
            pin_world = compute_pin_world_positions(board_inner_obj)
            if pin_world:
                pin_polys = build_pin_label_polygons(scene, cam, pin_world, RES_X, RES_Y)

        # 4. Write YOLO label file
        lbl_path = os.path.join(LABELS_DIR, split, f"{i:06d}.txt")
        with open(lbl_path, "w") as f:
            for name, poly in polygons.items():
                if poly is None:
                    continue
                coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in poly)
                f.write(f"{CLASS_MAP[name]} {coords}\n")

            if board_poly:
                coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in board_poly)
                f.write(f"{CLASS_BOARD} {coords}\n")
            # Class 12 (hinge) is NOT labelled in synthetic data.
            for pin_poly in pin_polys:
                coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in pin_poly)
                f.write(f"{CLASS_PIN} {coords}\n")

        print(f"[{i + 1}/{TOTAL_IMAGES}] ({mode}) {split}/{img_filename}")

    print("Dataset generation complete.")


if __name__ == "__main__":
    generate_dataset()
