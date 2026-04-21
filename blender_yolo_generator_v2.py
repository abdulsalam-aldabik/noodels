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
import time

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
PIN_RENDER_RADIUS_PX = 11
PIN_POLYGON_SIDES = 10
RENDER_PIN_HELPERS_IN_RGB = False
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
PLACEMENT_RADIUS_BOARD_HALF_RATIO = 0.58
MAX_TILT_DEGREES = 5.0
MAX_PLACEMENT_RETRIES = 260

# ---- Overlap / visibility ----
ALLOW_SMALL_OVERLAP = True
MAX_ALLOWED_OVERLAP_RATIO = 0.015
MIN_VISIBLE_PIECES_PER_IMAGE = 1
# Placement retries become progressively more permissive on later stages:
# (frame_margin_scale, retries_scale, overlap_scale)
PLACEMENT_RETRY_STAGES = (
    (1.00, 1.0, 1.0),
    (0.45, 2.0, 2.0),
    (0.00, 3.0, 4.0),
)
PLACEMENT_LAYOUT_ATTEMPTS = 5
PLACEMENT_LAYOUT_EARLY_EXIT_RATIO = 0.90
FORCE_ALL_REQUESTED_PIECES = False
STRICT_ALL_PIECES_ATTEMPTS = 7
STRICT_ALL_RADIUS_SCALE = 1.10
STRICT_ALL_MARGIN_SCALE = 0.85
STRICT_ALL_RETRY_SCALE = 1.25

# Random composition complexity control: dense scenes are expensive and can be
# physically hard to pack without heavy overlap, so bias toward lower counts.
MAX_RANDOM_PIECES_PER_IMAGE = 8
RANDOM_PIECE_COUNT_DECAY = 1.35
MASK_RENDER_IO_RETRIES = 3
MASK_RENDER_RETRY_DELAY_SEC = 0.06

# Limit repetitive RGB-fallback logging in long Blender runs.
MASK_FALLBACK_VERBOSE_LIMIT_PER_GROUP = 3
MASK_FALLBACK_SUMMARY_EVERY = 200

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
# Guard against accidental helper meshes (e.g., narrow strips) being used as
# class-11 board labels. If manual board_inner fails these checks, we fall back
# to board + erosion.
BOARD_LABEL_MIN_MANUAL_INNER_AREA_RATIO = 0.35
BOARD_LABEL_MIN_MANUAL_INNER_MIN_DIM_RATIO = 0.55

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


def _piece_names_by_descending_footprint(piece_names):
    def footprint(name):
        obj = bpy.data.objects.get(name)
        if not obj:
            return 0.0
        return _footprint_area(obj)

    return sorted(piece_names, key=footprint, reverse=True)


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
        # Children parented to obj (e.g. pin_NN empties on the board) were placed
        # in world space to sit on specific mesh features. The mesh just shifted
        # by -local_center in parent-local coords, so each child must shift the
        # same way or it detaches from the feature it was attached to.
        for child in obj.children:
            child.location -= local_center

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


def resolve_piece_placement_radius():
    """Scale placement radius to board size so multi-piece scenes remain feasible."""
    board_obj = bpy.data.objects.get(BOARD_NAME)
    if not board_obj:
        return PLACEMENT_RADIUS

    try:
        bounds = get_object_world_bounds(board_obj)
        board_half_extent = 0.5 * max(
            bounds["max_x"] - bounds["min_x"],
            bounds["max_y"] - bounds["min_y"],
        )
        return max(PLACEMENT_RADIUS, board_half_extent * PLACEMENT_RADIUS_BOARD_HALF_RATIO)
    except Exception:
        return PLACEMENT_RADIUS


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


def is_overlapping(box1, box2, max_overlap_ratio=MAX_ALLOWED_OVERLAP_RATIO):
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
    return inter / min(a1, a2) > max_overlap_ratio


def _is_inside_frame(bbox, margin):
    return (bbox[0] >= margin and bbox[2] <= 1.0 - margin and
            bbox[1] >= margin and bbox[3] <= 1.0 - margin)


def try_place_piece(scene, cam, obj, placed_boxes, x_range, y_range, z_value,
                    max_tilt_degrees, frame_margin, max_retries, allow_flip=True,
                    max_overlap_ratio=MAX_ALLOWED_OVERLAP_RATIO):
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
        if any(is_overlapping(bbox, pb, max_overlap_ratio) for pb in placed_boxes):
            continue

        placed_boxes.append(bbox)
        return True
    return False


def _capture_piece_state(piece_names):
    snapshot = {}
    for name in piece_names:
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        snapshot[name] = {
            "location": obj.location.copy(),
            "rotation_euler": obj.rotation_euler.copy(),
            "hide_render": obj.hide_render,
            "hide_viewport": obj.hide_viewport,
        }
    return snapshot


def _restore_piece_state(snapshot):
    for name, state in snapshot.items():
        obj = bpy.data.objects.get(name)
        if not obj:
            continue
        obj.location = state["location"]
        obj.rotation_euler = state["rotation_euler"]
        obj.hide_render = state["hide_render"]
        obj.hide_viewport = state["hide_viewport"]
    bpy.context.view_layer.update()


def _piece_order_for_layout_attempt(piece_names, attempt_idx):
    if attempt_idx == 0:
        return _piece_names_by_descending_footprint(piece_names)

    scored = []
    for name in piece_names:
        obj = bpy.data.objects.get(name)
        area = _footprint_area(obj) if obj else 0.0
        # Keep large-first behavior but inject jitter to escape local minima.
        jitter = random.uniform(0.75, 1.25)
        scored.append((-area * jitter, random.random(), name))
    scored.sort()
    return [name for _, _, name in scored]


def _resolve_layout_attempts(target_count):
    max_attempts = max(1, PLACEMENT_LAYOUT_ATTEMPTS)
    if target_count >= 7:
        return max_attempts
    if target_count >= 5:
        return min(max_attempts, 4)
    if target_count >= 3:
        return min(max_attempts, 3)
    return min(max_attempts, 2)


def _resolve_retry_budget(max_retries, target_count):
    # Keep dense scenes at full budget; trim easy scenes for speed.
    density = min(max(target_count, 1), len(PIECE_NAMES)) / max(len(PIECE_NAMES), 1)
    scale = 0.70 + 0.30 * density
    return max(80, int(round(max_retries * scale)))


def place_active_pieces(scene, cam, active_pieces, x_range, y_range, z_value,
                        max_tilt_degrees, frame_margin, require_all=False,
                        max_retries=MAX_PLACEMENT_RETRIES, context_label="random",
                        allow_flip=True):
    valid_active_pieces = [name for name in active_pieces if bpy.data.objects.get(name)]
    if not valid_active_pieces:
        hide_all_pieces()
        return []

    target_count = len(valid_active_pieces)
    layout_attempts = _resolve_layout_attempts(target_count)
    retry_budget = _resolve_retry_budget(max_retries, target_count)

    best_placed = []
    best_skipped = list(valid_active_pieces)
    best_snapshot = None

    for attempt_idx in range(layout_attempts):
        hide_all_pieces()
        placed_boxes = []
        placed = []
        skipped = []
        hard_fail = False

        ordered_active_pieces = _piece_order_for_layout_attempt(valid_active_pieces, attempt_idx)

        for name in ordered_active_pieces:
            obj = bpy.data.objects.get(name)
            if not obj:
                continue
            obj.hide_render = False
            obj.hide_viewport = False

            ok = False
            for margin_scale, retry_scale, overlap_scale in PLACEMENT_RETRY_STAGES:
                stage_margin = max(0.0, frame_margin * margin_scale)
                stage_retries = max(1, int(round(retry_budget * retry_scale)))
                stage_overlap = MAX_ALLOWED_OVERLAP_RATIO * overlap_scale
                ok = try_place_piece(
                    scene, cam, obj, placed_boxes, x_range, y_range, z_value,
                    max_tilt_degrees, stage_margin, stage_retries, allow_flip,
                    max_overlap_ratio=stage_overlap,
                )
                if ok:
                    break

            if not ok:
                obj.hide_render = True
                obj.hide_viewport = True
                if require_all:
                    hard_fail = True
                    break
                skipped.append(name)
                continue

            placed.append(name)

        if hard_fail:
            skipped = [n for n in ordered_active_pieces if n not in placed]

        # Guarantee at least one visible piece
        if (not require_all and ordered_active_pieces
                and len(placed) < MIN_VISIBLE_PIECES_PER_IMAGE):
            remaining = [n for n in ordered_active_pieces if n not in placed]
            for name in remaining:
                obj = bpy.data.objects.get(name)
                if not obj:
                    continue
                obj.hide_render = False
                obj.hide_viewport = False
                ok = try_place_piece(scene, cam, obj, placed_boxes, x_range, y_range,
                                     z_value, max_tilt_degrees,
                                     max(0.0, frame_margin * 0.25),
                                     retry_budget * 2, allow_flip,
                                     max_overlap_ratio=MAX_ALLOWED_OVERLAP_RATIO * 4.0)
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

        if len(placed) > len(best_placed):
            best_placed = placed[:]
            best_skipped = [n for n in valid_active_pieces if n not in best_placed]
            best_snapshot = _capture_piece_state(valid_active_pieces)

        if len(placed) == target_count:
            break

        if not require_all:
            early_target = max(
                MIN_VISIBLE_PIECES_PER_IMAGE,
                int(math.ceil(target_count * PLACEMENT_LAYOUT_EARLY_EXIT_RATIO)),
            )
            if len(placed) >= early_target:
                break

    if best_snapshot:
        _restore_piece_state(best_snapshot)
    else:
        hide_all_pieces()

    if require_all and len(best_placed) < target_count:
        return []

    if best_skipped:
        skipped_names = ", ".join(best_skipped)
        print(f"  INFO ({context_label}) Skipped {len(best_skipped)} piece(s): {skipped_names}")
    if target_count > 1 and len(best_placed) < target_count and layout_attempts > 1:
        print(
            f"  INFO ({context_label}) Placement best={len(best_placed)}/{target_count} "
            f"after {layout_attempts} layout attempts."
        )

    return best_placed


def _force_place_pieces_ring(active_pieces, z_value, base_radius):
    """Force-place all pieces in a ring as a last-resort smoke fallback."""
    hide_all_pieces()
    valid_active_pieces = [name for name in active_pieces if bpy.data.objects.get(name)]
    target_count = len(valid_active_pieces)
    if target_count == 0:
        return []

    ring_radius = max(4.0, float(base_radius) * 0.58)
    placed = []
    for idx, name in enumerate(valid_active_pieces):
        obj = bpy.data.objects.get(name)
        if not obj:
            continue

        rot_mat = auto_scale_and_flatten(obj, target_size=DYNAMIC_PIECE_TARGET_SIZE)
        yaw = math.radians((360.0 * idx / target_count) + random.uniform(-12.0, 12.0))
        yaw_mat = mathutils.Euler((0.0, 0.0, yaw)).to_matrix()
        obj.rotation_euler = (yaw_mat @ rot_mat).to_euler()

        theta = (2.0 * math.pi * idx) / target_count
        obj.location = (
            ring_radius * math.cos(theta),
            ring_radius * math.sin(theta),
            z_value,
        )
        obj.hide_render = False
        obj.hide_viewport = False
        placed.append(name)

    bpy.context.view_layer.update()
    return placed


def place_active_pieces_strict_all(scene, cam, active_pieces, base_radius, z_value,
                                   max_tilt_degrees, frame_margin,
                                   context_label="random"):
    """Require all requested pieces to be placed; raise if impossible."""
    valid_active_pieces = [name for name in active_pieces if bpy.data.objects.get(name)]
    target_count = len(valid_active_pieces)
    if target_count == 0:
        hide_all_pieces()
        return []

    radius = max(4.0, float(base_radius))
    margin = max(0.0, float(frame_margin))
    retry_budget = max(1, MAX_PLACEMENT_RETRIES)

    for strict_idx in range(STRICT_ALL_PIECES_ATTEMPTS):
        placed = place_active_pieces(
            scene, cam, valid_active_pieces,
            (-radius, radius), (-radius, radius),
            z_value, max_tilt_degrees, margin,
            require_all=True,
            max_retries=retry_budget,
            context_label=f"{context_label}:strict{strict_idx + 1}",
        )
        if len(placed) == target_count:
            return placed

        radius *= STRICT_ALL_RADIUS_SCALE
        margin *= STRICT_ALL_MARGIN_SCALE
        retry_budget = int(round(retry_budget * STRICT_ALL_RETRY_SCALE))

    print(
        f"WARNING: Strict all-piece placement failed for {target_count} pieces after "
        f"{STRICT_ALL_PIECES_ATTEMPTS} attempts; forcing ring fallback layout."
    )
    placed = _force_place_pieces_ring(valid_active_pieces, z_value, base_radius)
    if len(placed) < target_count:
        raise RuntimeError(
            f"Unable to force-place all requested pieces ({len(placed)}/{target_count})"
        )
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


def set_pin_helper_visibility(visible):
    """Pin helper objects provide positions only and are hidden in renders by default."""
    for i in range(21):
        pin_obj = bpy.data.objects.get(PIN_OBJECT_NAME_TEMPLATE.format(i))
        if pin_obj:
            pin_obj.hide_render = not visible
            # Keep helpers evaluable in depsgraph even when visually hidden.
            # In background renders, hidden viewport objects can yield stale
            # matrix_world under parent motion, which collapses pin labels.
            pin_obj.hide_viewport = False


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

        # Derive world-space transform from current parent transform explicitly.
        # This is robust even if helper objects are hidden in viewport.
        if obj.parent is not None:
            world_mat = obj.parent.matrix_world @ obj.matrix_local
            positions.append(world_mat.translation.copy())
        else:
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
    # Use a decaying distribution so low/medium density scenes are more common.
    remaining = random_budget - len(plan)
    max_piece_count = min(MAX_RANDOM_PIECES_PER_IMAGE, len(PIECE_NAMES))
    buckets = list(range(2, max_piece_count + 1))
    if buckets and remaining > 0:
        weights = [1.0 / (pc ** RANDOM_PIECE_COUNT_DECAY) for pc in buckets]
        for _ in range(remaining):
            pc = random.choices(buckets, weights=weights, k=1)[0]
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
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
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
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.view_settings.view_transform = rgb_view_transform
    if scene.world:
        scene.world.use_nodes = True


_MASK_FALLBACK_LOG_COUNTS = {}


def _log_mask_fallback(label_tag, alpha_ratio, rgb_ratio):
    group = label_tag.split(":", 1)[0]
    count = _MASK_FALLBACK_LOG_COUNTS.get(group, 0) + 1
    _MASK_FALLBACK_LOG_COUNTS[group] = count

    if count <= MASK_FALLBACK_VERBOSE_LIMIT_PER_GROUP:
        print(
            f"INFO: {label_tag} mask switched to RGB fallback "
            f"(alpha_coverage={alpha_ratio:.3f}, rgb_coverage={rgb_ratio:.3f})"
        )
        if count == MASK_FALLBACK_VERBOSE_LIMIT_PER_GROUP:
            print(
                f"INFO: {group} fallback logs suppressed after "
                f"{MASK_FALLBACK_VERBOSE_LIMIT_PER_GROUP} messages; "
                f"showing every {MASK_FALLBACK_SUMMARY_EVERY} occurrences."
            )
    elif count % MASK_FALLBACK_SUMMARY_EVERY == 0:
        print(f"INFO: {group} RGB fallback count={count}")


def _select_mask_from_alpha_rgb(alpha_mask, rgb_mask, label_tag="mask"):
    alpha_ratio = float(np.mean(alpha_mask))
    rgb_ratio = float(np.mean(rgb_mask))

    use_rgb = (
        (alpha_ratio > 0.98 and 0.0001 < rgb_ratio < 0.98)
        or (alpha_ratio < 0.0001 and rgb_ratio > 0.0001)
    )

    if use_rgb:
        _log_mask_fallback(label_tag, alpha_ratio, rgb_ratio)
        return rgb_mask

    if alpha_ratio > 0.98 and rgb_ratio > 0.98:
        print(
            f"WARNING: {label_tag} mask appears full-frame "
            f"(alpha_coverage={alpha_ratio:.3f}, rgb_coverage={rgb_ratio:.3f})"
        )
    return alpha_mask


def _mask_from_rgba_pixels(pix_rgba, res_x, res_y, label_tag="mask"):
    """Build a binary mask from rendered RGBA pixels with Blender-version fallback.

    In some Blender builds, Workbench + transparent film can still produce
    alpha=1 across the full frame. Prefer alpha in normal cases, but fall back
    to RGB luminance when alpha is clearly invalid (full-frame or empty).
    """
    rgba = pix_rgba.reshape(res_y, res_x, 4)
    alpha_mask = rgba[:, :, 3] > 0.5
    rgb_mask = np.max(rgba[:, :, :3], axis=2) > 0.2
    mask = _select_mask_from_alpha_rgb(alpha_mask, rgb_mask, label_tag=label_tag)
    return np.flipud(mask)


def _mask_from_png_file(temp_path, res_x, res_y, label_tag="mask"):
    expected_px = res_x * res_y * 4
    blender_err = None
    bimg = None

    # Prefer Blender image loading first to preserve existing orientation behavior.
    try:
        bimg = bpy.data.images.load(temp_path, check_existing=False)
        if len(bimg.pixels) != expected_px:
            raise RuntimeError(
                f"unexpected pixel buffer size {len(bimg.pixels)} (expected {expected_px})"
            )
        pix = np.zeros(expected_px, dtype=np.float32)
        bimg.pixels.foreach_get(pix)
        return _mask_from_rgba_pixels(pix, res_x, res_y, label_tag=label_tag)
    except Exception as exc:
        blender_err = exc
    finally:
        if bimg:
            try:
                bpy.data.images.remove(bimg)
            except Exception:
                pass

    # Fallback to OpenCV disk read for occasional Blender PNG read/cache glitches.
    try:
        arr = cv2.imread(temp_path, cv2.IMREAD_UNCHANGED)
        if arr is None:
            raise RuntimeError("cv2.imread returned None")

        if arr.ndim == 2:
            arr = cv2.cvtColor(arr, cv2.COLOR_GRAY2BGRA)
        elif arr.ndim != 3:
            raise RuntimeError(f"invalid image ndim: {arr.ndim}")

        if arr.shape[2] == 3:
            alpha = np.full((arr.shape[0], arr.shape[1], 1), 255, dtype=np.uint8)
            arr = np.concatenate([arr, alpha], axis=2)
        elif arr.shape[2] != 4:
            raise RuntimeError(f"invalid channel count: {arr.shape[2]}")

        if arr.shape[0] != res_y or arr.shape[1] != res_x:
            raise RuntimeError(
                f"unexpected image size {arr.shape[1]}x{arr.shape[0]} (expected {res_x}x{res_y})"
            )

        rgba = arr.astype(np.float32) / 255.0
        alpha_mask = rgba[:, :, 3] > 0.5
        rgb_mask = np.max(rgba[:, :, :3], axis=2) > 0.2
        print(f"INFO: {label_tag} mask read via OpenCV fallback ({blender_err})")
        return _select_mask_from_alpha_rgb(alpha_mask, rgb_mask, label_tag=label_tag)
    except Exception as cv_err:
        print(
            f"WARNING: Failed to read {label_tag} mask from {temp_path} "
            f"(blender_error={blender_err}; cv_error={cv_err})"
        )
        return None


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
    orig_file_format = scene.render.image_settings.file_format
    orig_color_mode = scene.render.image_settings.color_mode
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

    for target_name in active_pieces:
        # Hide all active pieces, show only target
        for name in active_pieces:
            obj = bpy.data.objects.get(name)
            if obj:
                obj.hide_render = (name != target_name)

        _enter_workbench_mask_mode(scene)
        mask = None
        for attempt in range(1, MASK_RENDER_IO_RETRIES + 1):
            temp_path = os.path.join(
                bpy.path.abspath("//"),
                f"__mask_{target_name}_{random.getrandbits(32):08x}.png",
            )
            scene.render.filepath = temp_path
            bpy.ops.render.render(write_still=True)

            mask = _mask_from_png_file(temp_path, res_x, res_y, label_tag=f"piece:{target_name}")
            try:
                os.remove(temp_path)
            except OSError:
                pass

            if mask is not None:
                break
            if attempt < MASK_RENDER_IO_RETRIES:
                time.sleep(MASK_RENDER_RETRY_DELAY_SEC)

        if mask is None:
            print(
                f"WARNING: piece:{target_name} mask unreadable after "
                f"{MASK_RENDER_IO_RETRIES} render attempts; piece omitted from labels this frame."
            )
            continue
        masks[target_name] = mask

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
    scene.render.image_settings.file_format = orig_file_format
    scene.render.image_settings.color_mode = orig_color_mode
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


_BOARD_LABEL_INNER_WARNING_SHOWN = False


def _manual_board_inner_sanity(board_obj, inner_obj):
    """Return (ok, reason) for using manual board_inner as class-11 label source."""
    if not board_obj or board_obj.type != "MESH":
        return False, "board object missing/non-mesh"
    if not inner_obj or inner_obj.type != "MESH":
        return False, "manual inner object missing/non-mesh"

    board_area = _footprint_area(board_obj)
    inner_area = _footprint_area(inner_obj)
    area_ratio = inner_area / max(board_area, 1e-9)

    bdx, bdy, _ = _local_bbox_dims(board_obj)
    idx, idy, _ = _local_bbox_dims(inner_obj)
    board_min_dim = max(min(bdx, bdy), 1e-9)
    inner_min_dim = min(idx, idy)
    min_dim_ratio = inner_min_dim / board_min_dim

    if area_ratio < BOARD_LABEL_MIN_MANUAL_INNER_AREA_RATIO:
        return False, f"area_ratio={area_ratio:.3f}"
    if min_dim_ratio < BOARD_LABEL_MIN_MANUAL_INNER_MIN_DIM_RATIO:
        return False, f"min_dim_ratio={min_dim_ratio:.3f}"
    return True, "ok"


def resolve_board_label_object_name():
    global _BOARD_LABEL_INNER_WARNING_SHOWN

    if MANUAL_BOARD_INNER_OBJECT_NAME:
        obj = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME)
        board_obj = bpy.data.objects.get(BOARD_NAME)
        ok, reason = _manual_board_inner_sanity(board_obj, obj)
        if ok:
            return MANUAL_BOARD_INNER_OBJECT_NAME
        if obj and not _BOARD_LABEL_INNER_WARNING_SHOWN:
            print(
                f"WARNING: Manual board label object '{MANUAL_BOARD_INNER_OBJECT_NAME}' "
                f"failed sanity check ({reason}); falling back to '{BOARD_NAME}'."
            )
            _BOARD_LABEL_INNER_WARNING_SHOWN = True
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
    orig_file_format = scene.render.image_settings.file_format
    orig_color_mode = scene.render.image_settings.color_mode
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
    mask = None
    for attempt in range(1, MASK_RENDER_IO_RETRIES + 1):
        temp_path = os.path.join(
            bpy.path.abspath("//"),
            f"__mask_board_{random.getrandbits(32):08x}.png",
        )
        scene.render.filepath = temp_path
        bpy.ops.render.render(write_still=True)

        mask = _mask_from_png_file(temp_path, res_x, res_y, label_tag="board")
        try:
            os.remove(temp_path)
        except OSError:
            pass

        if mask is not None:
            break
        if attempt < MASK_RENDER_IO_RETRIES:
            time.sleep(MASK_RENDER_RETRY_DELAY_SEC)

    # ── Restore state ──
    for obj in bpy.data.objects:
        if obj.type == "MESH" and obj.name in orig_hide:
            obj.hide_render = orig_hide[obj.name]

    scene.render.engine = orig_engine
    scene.render.film_transparent = orig_transparent
    scene.view_settings.view_transform = orig_view_transform
    scene.render.filepath = orig_filepath
    scene.render.image_settings.file_format = orig_file_format
    scene.render.image_settings.color_mode = orig_color_mode
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

    if mask is None:
        print(f"WARNING: board mask unreadable after {MASK_RENDER_IO_RETRIES} render attempts")
        return None

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

    # Pin markers are geometry helpers only; keep them out of RGB/mask renders.
    set_pin_helper_visibility(RENDER_PIN_HELPERS_IN_RGB)

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
    set_pin_helper_visibility(RENDER_PIN_HELPERS_IN_RGB)

    board_ref = bpy.data.objects.get(BOARD_NAME)
    board_inner_obj = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME) if MANUAL_BOARD_INNER_OBJECT_NAME else None
    board_inner_rel = None
    if board_ref and board_inner_obj:
        board_inner_rel = capture_relative_transform(board_ref, board_inner_obj)

    label_obj_name = resolve_board_label_object_name()
    if label_obj_name == MANUAL_BOARD_INNER_OBJECT_NAME:
        print(f"Using manual inner-board label object: {MANUAL_BOARD_INNER_OBJECT_NAME}")
    else:
        print(f"Using board-mask label pipeline with object: {label_obj_name}")

    hdri_images = glob.glob(os.path.join(HDRI_DIR, "*.exr")) + glob.glob(os.path.join(HDRI_DIR, "*.hdr"))
    piece_placement_radius = resolve_piece_placement_radius()
    print(f"Piece placement radius resolved to {piece_placement_radius:.2f}")
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
        if FORCE_ALL_REQUESTED_PIECES:
            active_pieces = place_active_pieces_strict_all(
                scene, cam, active_pieces,
                piece_placement_radius,
                RANDOM_PIECE_Z, MAX_TILT_DEGREES, RANDOM_EDGE_MARGIN,
                context_label="random",
            )
        else:
            active_pieces = place_active_pieces(
                scene, cam, active_pieces,
                (-piece_placement_radius, piece_placement_radius),
                (-piece_placement_radius, piece_placement_radius),
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
        img_split_dir = os.path.join(IMAGES_DIR, split)
        lbl_split_dir = os.path.join(LABELS_DIR, split)
        os.makedirs(img_split_dir, exist_ok=True)
        os.makedirs(lbl_split_dir, exist_ok=True)

        img_path = os.path.join(img_split_dir, img_filename)
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
        lbl_path = os.path.join(lbl_split_dir, f"{i:06d}.txt")
        os.makedirs(os.path.dirname(lbl_path), exist_ok=True)
        with open(lbl_path, "w") as f:
            if board_poly:
                coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in board_poly)
                f.write(f"{CLASS_BOARD} {coords}\n")
            # Class 12 (hinge) is NOT labelled in synthetic data.
            for pin_poly in pin_polys:
                coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in pin_poly)
                f.write(f"{CLASS_PIN} {coords}\n")

            # Keep pieces last so debug viewers that paint in file order show
            # piece masks above board/pin overlays.
            for name, poly in polygons.items():
                if poly is None:
                    continue
                coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in poly)
                f.write(f"{CLASS_MAP[name]} {coords}\n")

        print(f"[{i + 1}/{TOTAL_IMAGES}] ({mode}) {split}/{img_filename}")

    print("Dataset generation complete.")


if __name__ == "__main__":
    generate_dataset()
