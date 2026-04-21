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
import numpy as np

import subprocess

# Auto-install OpenCV if it's missing in Blender's Python environment
try:
    import cv2
except ImportError:
    print("OpenCV not found. Auto-installing into Blender's Python environment...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", "opencv-python"])
    import cv2
    print("OpenCV installed successfully.")

# ================= Configuration =================
TOTAL_TRAIN_IMAGES = 1920
TOTAL_VAL_IMAGES = 480
TOTAL_IMAGES = TOTAL_TRAIN_IMAGES + TOTAL_VAL_IMAGES
IMAGES_PER_PIECE_ALONE = 50

RES_X, RES_Y = 1024, 1024

OUTPUT_DIR = bpy.path.abspath("//yolo_dataset")
IMAGES_DIR = os.path.join(OUTPUT_DIR, "images")
LABELS_DIR = os.path.join(OUTPUT_DIR, "labels")

# Piece definitions
PIECE_COLORS = {
    'piece_A': ('A_Yellow',      (0xF9, 0xD6, 0x5E)),  # 0
    'piece_B': ('B_SkyBlue',     (0x08, 0xA7, 0xE8)),  # 1
    'piece_C': ('C_DarkBlue',    (0x20, 0x6D, 0xD9)),  # 2
    'piece_D': ('D_Green',       (0x1F, 0xA1, 0x5B)),  # 3
    'piece_E': ('E_Red',         (0xEE, 0x39, 0x4F)),  # 4
    'piece_F': ('F_Teal',        (0x85, 0xDA, 0xBB)),  # 5
    'piece_G': ('G_Pink',        (0xEC, 0x71, 0xA8)),  # 6
    'piece_H': ('H_Purple',      (0xC7, 0x78, 0xB9)),  # 7
    'piece_I': ('I_Orange',      (0xFC, 0x69, 0x0C)),  # 8
    'piece_J': ('J_DarkRed',     (0xB6, 0x30, 0x48)),  # 9
    'piece_K': ('K_YellowGreen', (0x95, 0xD4, 0x50)),  # 10
}
PIECE_NAMES = list(PIECE_COLORS.keys())
CLASS_MAP = {name: i for i, name in enumerate(PIECE_NAMES)}

# Optional manual remap when using a single imported STL that names meshes
# like IQ-Noodles.001, IQ-Noodles.002, etc.
# Fill this with 11 object names in A..K order if you want full control.
MANUAL_STL_PIECE_ORDER = [
    "IQ-Noodles.012",  # A: yellow
    "IQ-Noodles.009",  # B: sky blue
    "IQ-Noodles.004",  # C: dark blue
    "IQ-Noodles.008",  # D: green
    "IQ-Noodles.011",  # E: red
    "IQ-Noodles.014",  # F: teal
    "IQ-Noodles.010",  # G: pink
    "IQ-Noodles.005",  # H: purple
    "IQ-Noodles.013",  # I: orange
    "IQ-Noodles.006",  # J: dark red
    "IQ-Noodles.007",  # K: yellow green
]
MANUAL_STL_BOARD_NAME = "IQ-Noodles.003"

# Auto remap support for combined STL imports.
AUTO_REMAP_STL_NAMES = True
STL_OBJECT_NAME_REGEX = r"^IQ[-_ ]?Noodles?(?:\.\d+)?$"

BOARD_NAME = "board"
BOARD_COLOR = (40, 42, 45) 
DYNAMIC_PIECE_TARGET_SIZE = 1.0  
DYNAMIC_BOARD_TARGET_SIZE = 12.0 
PLACEMENT_RADIUS = 3.5
MAX_TILT_DEGREES = 5.0
MAX_PLACEMENT_RETRIES = 500

# Placement robustness
ALLOW_SMALL_OVERLAP = True
MAX_ALLOWED_OVERLAP_RATIO = 0.015
MIN_VISIBLE_PIECES_PER_IMAGE = 1

# Board-focused quality controls
BOARD_VISIBILITY_PROB = 0.50
BOARD_BASE_Z = -5.0
BOARD_POS_JITTER_XY = 0.45
BOARD_POS_JITTER_Z = 0.30
BOARD_YAW_JITTER_DEGREES = 12.0
BOARD_TILT_DEGREES = 4.5

# 15% of total scenes are grid-correct solved-board scenes (partial + full).
SOLVED_GRID_SCENE_RATIO = 0.15
PARTIAL_SOLVED_SCENE_RATIO_WITHIN_SOLVED = 0.65
PARTIAL_SOLVED_MIN_PIECES = 3
PARTIAL_SOLVED_MAX_PIECES = 9

SOLVED_LAYOUT_MAX_ATTEMPTS = 18
SOLVED_MAX_TILT_DEGREES = 1.5
SOLVED_BOARD_INSET_FRAC = 0.10
SOLVED_PIECE_Z_LIFT = 0.08
SOLVED_EDGE_MARGIN_RELAXED = 0.01
SOLVED_STATIC_FALLBACK_ATTEMPTS = 2

# Board label configuration (class 11): keep segmentation and prefer inner board area.
# Optional: if you create a mesh named `board_inner`, that exact mesh is used for
# board segmentation labels instead of auto-insetting `board`.
MANUAL_BOARD_INNER_OBJECT_NAME = "board_inner"
BOARD_LABEL_USE_INNER_MASK = True
BOARD_INNER_INSET_RATIO = 0.025
BOARD_INNER_MIN_INSET_PX = 2

# Prefer using the true solved layout already present in the STL scene.
# This keeps solved samples aligned to board logic/grid instead of random packing.
USE_REFERENCE_SOLVED_LAYOUT = True

RANDOM_PIECE_Z = 5.0
RANDOM_EDGE_MARGIN = 0.05
SOLVED_EDGE_MARGIN = 0.03

HINGE_NAME          = "hinge"
CLASS_BOARD         = 11
CLASS_HINGE         = 12
# Fractions of the board's local X width — scale-independent so they work
# regardless of how large the board mesh is in scene.blend.
HINGE_RADIUS_FRAC   = 0.04   # cylinder radius = 4% of board width  (~0.48 wu when board = 12)
HINGE_DEPTH_FRAC    = 0.05   # protrusion past board edge = 5% of board width

HDRI_DIR = bpy.path.abspath("//hdri_env")  
AUTO_DOWNLOAD_HDRIS = [
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/brown_photostudio_02_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/small_empty_room_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/billiard_hall_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/autoshop_01_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/music_hall_01_1k.hdr",
    "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/carpentry_shop_02_1k.hdr"
]

for split in ['train', 'val']:
    os.makedirs(os.path.join(IMAGES_DIR, split), exist_ok=True)
    os.makedirs(os.path.join(LABELS_DIR, split), exist_ok=True)

# Generate Dataset YAML seamlessly
with open(os.path.join(OUTPUT_DIR, "dataset.yaml"), "w") as f:
    f.write(f"path: {OUTPUT_DIR}\n")
    f.write("train: images/train\n")
    f.write("val: images/val\n\n")
    f.write("names:\n")
    for i, name in enumerate(PIECE_NAMES):
        label_class = PIECE_COLORS[name][0]
        f.write(f"  {i}: {label_class}\n")
    f.write(f"  {CLASS_BOARD}: board\n")
    f.write(f"  {CLASS_HINGE}: hinge\n")

# ================= Setup HDRI =================
def download_hdris_if_missing():
    os.makedirs(HDRI_DIR, exist_ok=True)
    existing = glob.glob(os.path.join(HDRI_DIR, "*.exr")) + glob.glob(os.path.join(HDRI_DIR, "*.hdr"))
    if len(existing) < 7:
        print("Downloading 7 INDOOR High-Quality HDRI environments into project folder...")
        for url in AUTO_DOWNLOAD_HDRIS:
            filename = url.split('/')[-1]
            filepath = os.path.join(HDRI_DIR, filename)
            if not os.path.exists(filepath):
                try: urllib.request.urlretrieve(url, filepath)
                except Exception as e: print(f"Failed to download {url}: {e}")

# ================= Helper Functions =================
def hex_to_rgb(hex_tuple):
    return [(c / 255.0)**2.2 for c in hex_tuple] + [1.0]


def _local_bbox_dims(obj):
    pts = [mathutils.Vector(v) for v in obj.bound_box]
    min_x = min(p.x for p in pts); max_x = max(p.x for p in pts)
    min_y = min(p.y for p in pts); max_y = max(p.y for p in pts)
    min_z = min(p.z for p in pts); max_z = max(p.z for p in pts)
    return (max_x - min_x, max_y - min_y, max_z - min_z)


def _footprint_area(obj):
    dx, dy, _ = _local_bbox_dims(obj)
    return max(dx * dy, 1e-9)


def _suffix_index(name):
    m = re.search(r"\.(\d+)$", name)
    if not m:
        return 0
    return int(m.group(1))


def _natural_stl_sort_key(obj):
    return (_suffix_index(obj.name), obj.name.lower())


def _rename_object_safe(obj, target_name):
    if not obj or obj.name == target_name:
        return
    existing = bpy.data.objects.get(target_name)
    if existing and existing != obj:
        existing.name = f"{target_name}__old"
    obj.name = target_name


# ================= IQ NOODLES SOLVER (PYTHON) =================
BOARD_WIDTH = 14
BOARD_HEIGHT = 14
BIG_GRID_WIDTH = 40

MISSING_POSITIONS = {
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

IQ_PIECE_BIG_POSITIONS = [
    [4, 44, 82, 83, 122, 123],
    [44, 45, 48, 49, 86, 87],
    [9, 49, 90, 130, 168, 169],
    [91, 131, 172, 173, 212, 213, 250, 251],
    [126, 127, 164, 165, 204, 205, 243, 283],
    [160, 161, 200, 201, 242, 282, 320, 321],
    [208, 209, 246, 247, 286, 287, 324, 325],
    [290, 291, 332, 333, 372, 373, 410, 411],
    [328, 329, 364, 365, 368, 369, 406, 407],
    [360, 361, 402, 403, 442, 443, 484, 485, 524, 525],
    [446, 447, 450, 451, 488, 489, 528, 529],
]


def _normalize_xy(points):
    min_x = min(x for x, _ in points)
    min_y = min(y for _, y in points)
    return sorted((x - min_x, y - min_y) for x, y in points)


def _transform_xy(points, rotation_steps, mirrored):
    transformed = []
    for x, y in points:
        tx = -x if mirrored else x
        ty = y
        if rotation_steps == 0:
            rx, ry = tx, ty
        elif rotation_steps == 1:
            rx, ry = -ty, tx
        elif rotation_steps == 2:
            rx, ry = -tx, -ty
        else:
            rx, ry = ty, -tx
        transformed.append((rx, ry))
    return transformed


def _big_positions_to_xy(big_positions):
    return [(p % BIG_GRID_WIDTH, p // BIG_GRID_WIDTH) for p in big_positions]


def find_all_piece_orientations(piece_id):
    base_xy = _big_positions_to_xy(IQ_PIECE_BIG_POSITIONS[piece_id])
    unique = []
    seen = set()

    for mirrored in (False, True):
        for r in (0, 1, 2, 3):
            pts = _transform_xy(base_xy, r, mirrored)
            norm = tuple(_normalize_xy(pts))
            if norm in seen:
                continue
            seen.add(norm)
            unique.append(list(norm))

    return unique


def generate_placements_for_piece(piece_id):
    placements = []
    orientations = find_all_piece_orientations(piece_id)

    for orient in orientations:
        max_x = max(x for x, _ in orient)
        max_y = max(y for _, y in orient)

        for dy in range(BOARD_HEIGHT - max_y):
            for dx in range(BOARD_WIDTH - max_x):
                cells = []
                ok = True
                for x, y in orient:
                    idx = BOARD_WIDTH * (y + dy) + (x + dx)
                    if idx in MISSING_POSITIONS:
                        ok = False
                        break
                    cells.append(idx)
                if ok:
                    placements.append(tuple(sorted(cells)))

    return placements


def solve_noodles_full():
    num_pieces = len(IQ_PIECE_BIG_POSITIONS)
    all_placements = {pid: generate_placements_for_piece(pid) for pid in range(num_pieces)}

    valid_cells = [i for i in range(BOARD_WIDTH * BOARD_HEIGHT) if i not in MISSING_POSITIONS]
    cell_coverage = {cell: [] for cell in valid_cells}

    for pid in range(num_pieces):
        for placement in all_placements[pid]:
            for cell in placement:
                if cell in cell_coverage:
                    cell_coverage[cell].append((pid, placement))

    occupied = set()
    remaining = set(range(num_pieces))
    solution = dict.fromkeys(range(num_pieces), None)
    states = 0

    def backtrack():
        nonlocal states
        if not remaining:
            return True
        states += 1

        best_options = None
        best_count = 10 ** 9

        for cell in valid_cells:
            if cell in occupied:
                continue

            options = []
            for pid, placement in cell_coverage[cell]:
                if pid not in remaining:
                    continue
                if all(c not in occupied for c in placement):
                    options.append((pid, placement))

            if not options:
                return False

            if len(options) < best_count:
                best_count = len(options)
                best_options = options
                if best_count == 1:
                    break

        if best_options is None:
            return False

        random.shuffle(best_options)
        for pid, placement in best_options:
            for c in placement:
                occupied.add(c)
            remaining.remove(pid)
            solution[pid] = placement

            if backtrack():
                return True

            solution[pid] = None
            remaining.add(pid)
            for c in placement:
                occupied.remove(c)

        return False

    solved = backtrack()
    return {
        'solved': solved,
        'states': states,
        'solution': solution,
        'all_placements': all_placements,
    }


def sample_partial_piece_ids(piece_pool=None):
    pool = list(piece_pool) if piece_pool else list(PIECE_NAMES)
    if not pool:
        return []
    count = random.randint(PARTIAL_SOLVED_MIN_PIECES, PARTIAL_SOLVED_MAX_PIECES)
    count = max(1, min(count, len(pool)))
    return random.sample(pool, count)


def show_only_piece_set(visible_piece_names):
    visible = set(visible_piece_names)
    for p_name in PIECE_NAMES:
        obj = bpy.data.objects.get(p_name)
        if not obj:
            continue
        is_visible = p_name in visible
        obj.hide_render = not is_visible
        obj.hide_viewport = not is_visible


def _select_piece_objects(piece_pool, piece_count):
    if len(piece_pool) <= piece_count:
        return sorted(piece_pool, key=_natural_stl_sort_key)

    areas = [_footprint_area(obj) for obj in piece_pool]
    median_area = float(np.median(areas)) if areas else 1.0
    median_area = max(median_area, 1e-9)

    # Keep objects closest to the typical piece footprint and reject outliers.
    ranked = sorted(
        piece_pool,
        key=lambda obj: abs(math.log(max(_footprint_area(obj), 1e-9) / median_area)),
    )
    selected = ranked[:piece_count]
    return sorted(selected, key=_natural_stl_sort_key)


def auto_remap_stl_object_names():
    """Map combined STL object names to canonical piece_A..piece_K + board names."""
    if not AUTO_REMAP_STL_NAMES:
        return

    has_all_pieces = all(bpy.data.objects.get(name) for name in PIECE_NAMES)
    has_board = bpy.data.objects.get(BOARD_NAME) is not None
    if has_all_pieces and has_board:
        return

    mesh_objs = [obj for obj in bpy.data.objects if obj.type == 'MESH']
    if not mesh_objs:
        return

    # Manual mapping path: safest when you know exact STL object order.
    if MANUAL_STL_PIECE_ORDER:
        if len(MANUAL_STL_PIECE_ORDER) != len(PIECE_NAMES):
            print(
                f"WARNING: MANUAL_STL_PIECE_ORDER has {len(MANUAL_STL_PIECE_ORDER)} entries; "
                f"expected {len(PIECE_NAMES)}. Ignoring manual mapping."
            )
        else:
            missing_manual = [name for name in MANUAL_STL_PIECE_ORDER if not bpy.data.objects.get(name)]
            if missing_manual:
                print(f"WARNING: Manual STL piece names not found: {missing_manual}. Ignoring manual mapping.")
            else:
                board_obj = bpy.data.objects.get(MANUAL_STL_BOARD_NAME) if MANUAL_STL_BOARD_NAME else None
                if not board_obj:
                    fallback_pool = [obj for obj in mesh_objs if obj.name not in MANUAL_STL_PIECE_ORDER]
                    board_obj = max(fallback_pool, key=_footprint_area) if fallback_pool else None

                if board_obj:
                    _rename_object_safe(board_obj, BOARD_NAME)

                print("Using MANUAL_STL_PIECE_ORDER remap:")
                for canonical_name, src_name in zip(PIECE_NAMES, MANUAL_STL_PIECE_ORDER):
                    src_obj = bpy.data.objects.get(src_name)
                    if src_obj:
                        print(f"  {canonical_name} <= {src_obj.name}")
                        _rename_object_safe(src_obj, canonical_name)
                return

    pattern = re.compile(STL_OBJECT_NAME_REGEX, re.IGNORECASE)
    grouped = [obj for obj in mesh_objs if pattern.match(obj.name)]

    if len(grouped) < len(PIECE_NAMES) + 1:
        return

    board_obj = bpy.data.objects.get(BOARD_NAME)
    if not board_obj:
        board_obj = max(grouped, key=_footprint_area)

    piece_pool = [obj for obj in grouped if obj != board_obj and obj.name != HINGE_NAME]
    if len(piece_pool) < len(PIECE_NAMES):
        piece_pool = [obj for obj in mesh_objs if obj != board_obj and obj.name != HINGE_NAME]

    if len(piece_pool) < len(PIECE_NAMES):
        print(
            f"WARNING: Could not auto-remap STL objects. Found only {len(piece_pool)} piece candidates."
        )
        return

    selected_pieces = _select_piece_objects(piece_pool, len(PIECE_NAMES))
    mapping_preview = [(canonical, src.name) for canonical, src in zip(PIECE_NAMES, selected_pieces)]

    if board_obj:
        _rename_object_safe(board_obj, BOARD_NAME)

    print("Auto remapping combined STL object names to canonical piece labels:")
    for canonical_name, src_name in mapping_preview:
        print(f"  {canonical_name} <= {src_name}")

    for canonical_name, src_obj in zip(PIECE_NAMES, selected_pieces):
        _rename_object_safe(src_obj, canonical_name)

    print(
        "WARNING: STL auto-remap preserves pipeline compatibility, but verify A..K identity once "
        "if semantic class order is critical."
    )

def center_origins_to_geometry():
    for name in PIECE_NAMES + [BOARD_NAME]:
        obj = bpy.data.objects.get(name)
        if not obj or obj.type != 'MESH': continue
        local_center = sum((mathutils.Vector(b) for b in obj.bound_box), mathutils.Vector()) / 8.0
        for v in obj.data.vertices: v.co -= local_center
        obj.location += obj.matrix_world.to_3x3() @ local_center

def apply_color_to_obj(obj, color):
    mat = bpy.data.materials.get(f"Mat_{obj.name}")
    if not mat:
        mat = bpy.data.materials.new(name=f"Mat_{obj.name}")
        mat.use_nodes = True
    
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs['Base Color'].default_value = hex_to_rgb(color)
        bsdf.inputs['Roughness'].default_value = 0.8
        bsdf.inputs['Specular IOR Level'].default_value = 0.1
    
    if len(obj.data.materials) == 0: obj.data.materials.append(mat)
    else: obj.data.materials[0] = mat

def setup_materials():
    for name, data in PIECE_COLORS.items():
        color = data[1]
        obj = bpy.data.objects.get(name)
        if obj: apply_color_to_obj(obj, color)
            
    board = bpy.data.objects.get(BOARD_NAME)
    if board: apply_color_to_obj(board, BOARD_COLOR)

def auto_scale_and_flatten(obj, target_size):
    pts = [mathutils.Vector(v) for v in obj.bound_box]
    min_x = min(p.x for p in pts); max_x = max(p.x for p in pts)
    min_y = min(p.y for p in pts); max_y = max(p.y for p in pts)
    min_z = min(p.z for p in pts); max_z = max(p.z for p in pts)
    dims = mathutils.Vector((max_x - min_x, max_y - min_y, max_z - min_z))
    
    max_dim = max(dims.x, dims.y, dims.z)
    if max_dim > 0.0001:
        s = target_size / max_dim
        obj.scale = (s, s, s)
        
    min_dim = min(dims.x, dims.y, dims.z)
    base_rot = mathutils.Euler((0, 0, 0)) 
    
    if min_dim == dims.x:
        base_rot = mathutils.Euler((0, math.radians(90), 0))
    elif min_dim == dims.y:
        base_rot = mathutils.Euler((math.radians(90), 0, 0))
        
    return base_rot.to_matrix()

def get_2d_bounding_box(scene, cam, obj):
    """Fast Bound Box projection for placement collision testing only."""
    min_x, min_y = 1.0, 1.0; max_x, max_y = 0.0, 0.0; valid = False
    for v in obj.bound_box:
        co3d = obj.matrix_world @ mathutils.Vector(v)
        co2d = bpy_extras.object_utils.world_to_camera_view(scene, cam, co3d)
        if co2d.z > 0:
            min_x = min(min_x, co2d.x); max_x = max(max_x, co2d.x)
            min_y = min(min_y, co2d.y); max_y = max(max_y, co2d.y)
            valid = True
    if not valid: return None
    return (min_x, min_y, max_x, max_y)

def is_overlapping(box1, box2):
    margin = 0.0
    if box1[0] > box2[2] + margin or box2[0] > box1[2] + margin:
        return False
    if box1[1] > box2[3] + margin or box2[1] > box1[3] + margin:
        return False

    if not ALLOW_SMALL_OVERLAP:
        return True

    inter_x1 = max(box1[0], box2[0])
    inter_y1 = max(box1[1], box2[1])
    inter_x2 = min(box1[2], box2[2])
    inter_y2 = min(box1[3], box2[3])
    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h

    area1 = max(1e-9, (box1[2] - box1[0]) * (box1[3] - box1[1]))
    area2 = max(1e-9, (box2[2] - box2[0]) * (box2[3] - box2[1]))
    overlap_ratio = inter_area / min(area1, area2)
    return overlap_ratio > MAX_ALLOWED_OVERLAP_RATIO

def hide_all_pieces():
    for name in PIECE_NAMES:
        obj = bpy.data.objects.get(name)
        if obj:
            obj.hide_render = True; obj.hide_viewport = True


def set_board_pose(board, pose_mode='random'):
    """Apply board transform with optional stronger randomization for board quality."""
    board_rot_matrix = auto_scale_and_flatten(board, target_size=DYNAMIC_BOARD_TARGET_SIZE)

    if pose_mode == 'solved':
        # Keep solved-board scenes stable so all pieces can be packed reliably.
        yaw_deg = random.choice([0, 90, 180, 270])
        tilt_x_deg = 0.0
        tilt_y_deg = 0.0
        jitter_xy = BOARD_POS_JITTER_XY * 0.35
        jitter_z = BOARD_POS_JITTER_Z * 0.35
    else:
        yaw_deg = random.choice([0, 90, 180, 270]) + random.uniform(-BOARD_YAW_JITTER_DEGREES, BOARD_YAW_JITTER_DEGREES)
        tilt_x_deg = random.uniform(-BOARD_TILT_DEGREES, BOARD_TILT_DEGREES)
        tilt_y_deg = random.uniform(-BOARD_TILT_DEGREES, BOARD_TILT_DEGREES)
        jitter_xy = BOARD_POS_JITTER_XY
        jitter_z = BOARD_POS_JITTER_Z

    yaw_matrix = mathutils.Euler((0, 0, math.radians(yaw_deg))).to_matrix()
    tilt_matrix = mathutils.Euler((math.radians(tilt_x_deg), math.radians(tilt_y_deg), 0)).to_matrix()

    board.rotation_euler = (yaw_matrix @ tilt_matrix @ board_rot_matrix).to_euler()
    board.location = (
        random.uniform(-jitter_xy, jitter_xy),
        random.uniform(-jitter_xy, jitter_xy),
        BOARD_BASE_Z + random.uniform(-jitter_z, jitter_z),
    )


def get_object_world_bounds(obj):
    bpy.context.view_layer.update()
    corners = [obj.matrix_world @ mathutils.Vector(c) for c in obj.bound_box]
    xs = [c.x for c in corners]
    ys = [c.y for c in corners]
    zs = [c.z for c in corners]
    return {
        'min_x': min(xs), 'max_x': max(xs),
        'min_y': min(ys), 'max_y': max(ys),
        'min_z': min(zs), 'max_z': max(zs),
    }


def capture_reference_solved_layout(board_obj):
    """Capture piece transforms relative to board for logic-faithful solved scenes."""
    if not board_obj:
        return None

    bpy.context.view_layer.update()
    board_inv = board_obj.matrix_world.inverted()
    rel_transforms = {}
    missing = []

    for p_name in PIECE_NAMES:
        obj = bpy.data.objects.get(p_name)
        if not obj:
            missing.append(p_name)
            continue
        rel_transforms[p_name] = board_inv @ obj.matrix_world

    if missing:
        print(f"WARNING: Cannot capture reference solved layout; missing pieces: {missing}")
        return None

    return rel_transforms


def capture_relative_transform(parent_obj, child_obj):
    if not parent_obj or not child_obj:
        return None
    bpy.context.view_layer.update()
    return parent_obj.matrix_world.inverted() @ child_obj.matrix_world


def apply_relative_transform(parent_obj, child_obj, rel_matrix):
    if not parent_obj or not child_obj or rel_matrix is None:
        return
    child_obj.matrix_world = parent_obj.matrix_world @ rel_matrix


def apply_reference_solved_layout(board_obj, rel_transforms):
    """Apply captured solved transforms so pieces stay valid with board pose changes."""
    if not board_obj or not rel_transforms:
        return []

    hide_all_pieces()
    placed = []
    for p_name in PIECE_NAMES:
        obj = bpy.data.objects.get(p_name)
        rel = rel_transforms.get(p_name)
        if not obj or rel is None:
            continue

        obj.matrix_world = board_obj.matrix_world @ rel
        obj.hide_render = False
        obj.hide_viewport = False
        placed.append(p_name)

    return placed


def all_pieces_inside_frame(scene, cam, piece_names, frame_margin):
    for p_name in piece_names:
            obj = bpy.data.objects.get(p_name)
            if not obj:
                return False
        
            bbox_fast = get_2d_bounding_box(scene, cam, obj)
            if not bbox_fast:
                return False
        
            min_x, min_y, max_x, max_y = bbox_fast
            if min_x < frame_margin or max_x > (1.0 - frame_margin) or min_y < frame_margin or max_y > (1.0 - frame_margin):
                return False
        
        return True


def _available_render_engines(scene):
    try:
        enum_items = scene.render.bl_rna.properties['engine'].enum_items
        return {item.identifier for item in enum_items}
    except Exception:
        return {scene.render.engine}


def resolve_rgb_render_engine(scene):
    current = scene.render.engine
    if current != 'BLENDER_WORKBENCH':
        return current

    available = _available_render_engines(scene)
    for candidate in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        if candidate in available:
            print(
                f"INFO: RGB render engine auto-switched from BLENDER_WORKBENCH to {candidate} "
                "to avoid flat single-color output."
            )
            return candidate

    return current


def resolve_rgb_view_transform(scene):
    current = scene.view_settings.view_transform
    if current != 'Raw':
        return current

    try:
        enum_items = scene.view_settings.bl_rna.properties['view_transform'].enum_items
        available = [item.identifier for item in enum_items]
    except Exception:
        available = []

    for candidate in ('AgX', 'Filmic', 'Standard'):
        if candidate in available:
            print(f"INFO: RGB view transform auto-switched from Raw to {candidate}.")
            return candidate

    return current


def ensure_rgb_render_state(scene, rgb_engine, rgb_view_transform):
    scene.render.engine = rgb_engine
    scene.render.film_transparent = False
    scene.view_settings.view_transform = rgb_view_transform

    if scene.world:
        scene.world.use_nodes = True


def try_place_piece(
    scene,
    cam,
    obj,
    placed_boxes_fast,
    x_range,
    y_range,
    z_value,
    max_tilt_degrees,
    frame_margin,
    max_retries,
    allow_flip=True,
):
        base_rot_matrix = auto_scale_and_flatten(obj, target_size=DYNAMIC_PIECE_TARGET_SIZE)
    
        for _ in range(max_retries):
            yaw_matrix = mathutils.Euler((0, 0, random.uniform(0, 2 * math.pi))).to_matrix()
            t_x = math.radians(random.uniform(-max_tilt_degrees, max_tilt_degrees))
            t_y = math.radians(random.uniform(-max_tilt_degrees, max_tilt_degrees))
            tilt_matrix = mathutils.Euler((t_x, t_y, 0)).to_matrix()
        
            if allow_flip and random.random() > 0.5:
                flip_matrix = mathutils.Euler((math.pi, 0, 0)).to_matrix()
            else:
                flip_matrix = mathutils.Matrix.Identity(3)

        obj.rotation_euler = (yaw_matrix @ tilt_matrix @ flip_matrix @ base_rot_matrix).to_euler()

        obj.location.x = random.uniform(x_range[0], x_range[1])
        obj.location.y = random.uniform(y_range[0], y_range[1])
        obj.location.z = z_value

        bpy.context.view_layer.update()

        bbox_fast = get_2d_bounding_box(scene, cam, obj)
        if not bbox_fast:
            continue

        min_x, min_y, max_x, max_y = bbox_fast
        if min_x < frame_margin or max_x > (1.0 - frame_margin) or min_y < frame_margin or max_y > (1.0 - frame_margin):
            continue

        overlap = False
        for p_box in placed_boxes_fast:
            if is_overlapping(bbox_fast, p_box):
                overlap = True
                break

        if overlap:
            continue

        placed_boxes_fast.append(bbox_fast)
        return True

    return False


def place_active_pieces(
    scene,
    cam,
    active_pieces,
    x_range,
    y_range,
    z_value,
    max_tilt_degrees,
    frame_margin,
    require_all=False,
    max_retries=MAX_PLACEMENT_RETRIES,
    context_label='random',
    allow_flip=True,
):
    hide_all_pieces()
    placed_boxes_fast = []
    successfully_placed = []

    for p_name in active_pieces:
        obj = bpy.data.objects.get(p_name)
        if not obj:
            continue

        obj.hide_render = False
        obj.hide_viewport = False

        placed = try_place_piece(
            scene,
            cam,
            obj,
            placed_boxes_fast,
            x_range,
            y_range,
            z_value,
            max_tilt_degrees,
            frame_margin,
            max_retries,
            allow_flip,
        )

        if not placed:
            obj.hide_render = True
            obj.hide_viewport = True

            if require_all:
                for placed_name in successfully_placed:
                    p_obj = bpy.data.objects.get(placed_name)
                    if p_obj:
                        p_obj.hide_render = True
                        p_obj.hide_viewport = True
                return []

            print(f"  INFO ({context_label}) Could not place '{p_name}', rendering without it.")
            continue

        successfully_placed.append(p_name)

    if active_pieces and len(successfully_placed) < MIN_VISIBLE_PIECES_PER_IMAGE:
        remaining = [p for p in active_pieces if p not in successfully_placed]
        for p_name in remaining:
            obj = bpy.data.objects.get(p_name)
            if not obj:
                continue

            obj.hide_render = False
            obj.hide_viewport = False

            placed = try_place_piece(
                scene,
                cam,
                obj,
                placed_boxes_fast,
                x_range,
                y_range,
                z_value,
                max_tilt_degrees,
                max(0.0, frame_margin * 0.25),
                max_retries * 2,
                allow_flip,
            )

            if placed:
                successfully_placed.append(p_name)
                break

            # Last resort: keep one piece visible so the frame is never pure background.
            base_rot_matrix = auto_scale_and_flatten(obj, target_size=DYNAMIC_PIECE_TARGET_SIZE)
            obj.rotation_euler = base_rot_matrix.to_euler()
            obj.location.x = 0.0
            obj.location.y = 0.0
            obj.location.z = z_value
            obj.hide_render = False
            obj.hide_viewport = False
            bpy.context.view_layer.update()
            successfully_placed.append(p_name)
            break

    return successfully_placed


def place_solved_board_pieces(scene, cam, active_pieces, board_obj):
    bounds = get_object_world_bounds(board_obj)
    board_w = bounds['max_x'] - bounds['min_x']
    board_h = bounds['max_y'] - bounds['min_y']

    inset_x = board_w * SOLVED_BOARD_INSET_FRAC
    inset_y = board_h * SOLVED_BOARD_INSET_FRAC

    x_min = bounds['min_x'] + inset_x
    x_max = bounds['max_x'] - inset_x
    y_min = bounds['min_y'] + inset_y
    y_max = bounds['max_y'] - inset_y

    if x_max <= x_min or y_max <= y_min:
        return []

    z_value = bounds['max_z'] + SOLVED_PIECE_Z_LIFT
    return place_active_pieces(
        scene,
        cam,
        active_pieces,
        (x_min, x_max),
        (y_min, y_max),
        z_value,
        SOLVED_MAX_TILT_DEGREES,
        SOLVED_EDGE_MARGIN,
        require_all=True,
        max_retries=MAX_PLACEMENT_RETRIES * 3,
        context_label='solved',
        allow_flip=False,
    )


def _compute_mode_counts(image_total):
    solved_total = int(round(image_total * SOLVED_GRID_SCENE_RATIO))
    solved_total = max(0, min(solved_total, image_total))

    solved_partial = int(round(solved_total * PARTIAL_SOLVED_SCENE_RATIO_WITHIN_SOLVED))
    solved_partial = max(0, min(solved_partial, solved_total))
    solved_full = solved_total - solved_partial

    return {
        'total_count': image_total,
        'random_count': image_total - solved_total,
        'solved_total_count': solved_total,
        'solved_full_count': solved_full,
        'solved_partial_count': solved_partial,
    }


def _build_split_generation_plan(split_name, split_total, partial_piece_pool=None):
    mode_counts = _compute_mode_counts(split_total)
    random_budget = mode_counts['random_count']

    split_plan = []
    single_per_piece = min(IMAGES_PER_PIECE_ALONE, random_budget // len(PIECE_NAMES))

    for piece in PIECE_NAMES:
        for _ in range(single_per_piece):
            split_plan.append({'split': split_name, 'mode': 'random', 'pieces': [piece]})

    remaining_random = random_budget - len(split_plan)
    piece_count_buckets = list(range(2, len(PIECE_NAMES) + 1))

    if piece_count_buckets and remaining_random > 0:
        per_bucket = remaining_random // len(piece_count_buckets)
        remainder = remaining_random % len(piece_count_buckets)

        for idx, piece_count in enumerate(piece_count_buckets):
            quota = per_bucket + (1 if idx < remainder else 0)
            for _ in range(quota):
                split_plan.append({
                    'split': split_name,
                    'mode': 'random',
                    'pieces': random.sample(PIECE_NAMES, piece_count),
                })
    elif remaining_random > 0:
        for _ in range(remaining_random):
            split_plan.append({
                'split': split_name,
                'mode': 'random',
                'pieces': [random.choice(PIECE_NAMES)],
            })

    for _ in range(mode_counts['solved_full_count']):
        split_plan.append({'split': split_name, 'mode': 'solved_full', 'pieces': list(PIECE_NAMES)})

    for _ in range(mode_counts['solved_partial_count']):
        split_plan.append({
            'split': split_name,
            'mode': 'solved_partial',
            'pieces': sample_partial_piece_ids(partial_piece_pool),
        })

    random.shuffle(split_plan)

    if len(split_plan) != split_total:
        raise RuntimeError(
            f"Split planning mismatch for '{split_name}': got {len(split_plan)} samples, expected {split_total}."
        )

    split_stats = dict(mode_counts)
    split_stats['single_per_piece'] = single_per_piece
    return split_plan, split_stats


def build_generation_plan(partial_piece_pool=None):
    train_plan, train_stats = _build_split_generation_plan('train', TOTAL_TRAIN_IMAGES, partial_piece_pool)
    val_plan, val_stats = _build_split_generation_plan('val', TOTAL_VAL_IMAGES, partial_piece_pool)

    plan = train_plan + val_plan
    return plan, {
        'total_count': len(plan),
        'random_count': train_stats['random_count'] + val_stats['random_count'],
        'solved_total_count': train_stats['solved_total_count'] + val_stats['solved_total_count'],
        'solved_full_count': train_stats['solved_full_count'] + val_stats['solved_full_count'],
        'solved_partial_count': train_stats['solved_partial_count'] + val_stats['solved_partial_count'],
        'split_stats': {
            'train': train_stats,
            'val': val_stats,
        },
    }


def _available_render_engines(scene):
    try:
        enum_items = scene.render.bl_rna.properties['engine'].enum_items
        return {item.identifier for item in enum_items}
    except Exception:
        return {scene.render.engine}


def resolve_rgb_render_engine(scene):
    current = scene.render.engine
    if current != 'BLENDER_WORKBENCH':
        return current

    available = _available_render_engines(scene)
    for candidate in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
        if candidate in available:
            print(
                f"INFO: RGB render engine auto-switched from BLENDER_WORKBENCH to {candidate} "
                "to avoid flat single-color output."
            )
            return candidate

    return current


def resolve_rgb_view_transform(scene):
    current = scene.view_settings.view_transform
    if current != 'Raw':
        return current

    try:
        enum_items = scene.view_settings.bl_rna.properties['view_transform'].enum_items
        available = [item.identifier for item in enum_items]
    except Exception:
        available = []

    for candidate in ('AgX', 'Filmic', 'Standard'):
        if candidate in available:
            print(f"INFO: RGB view transform auto-switched from Raw to {candidate}.")
            return candidate

    return current


def ensure_rgb_render_state(scene, rgb_engine, rgb_view_transform):
    scene.render.engine = rgb_engine
    scene.render.film_transparent = False
    scene.view_settings.view_transform = rgb_view_transform

    if scene.world:
        scene.world.use_nodes = True

def prepare_hdri_background(use_board, hdri_images, board_pose_mode='random', board_inner_rel=None):
    world = bpy.data.worlds.get("World")
    if not world:
        world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
        
    world.use_nodes = True
    world.node_tree.nodes.clear() 
    
    bg_node = world.node_tree.nodes.new("ShaderNodeBackground")
    out_node = world.node_tree.nodes.new("ShaderNodeOutputWorld")
    world.node_tree.links.new(bg_node.outputs['Background'], out_node.inputs['Surface'])
    
    board = bpy.data.objects.get(BOARD_NAME)
    if board:
        board.hide_render = not use_board; board.hide_viewport = not use_board
        if use_board:
            set_board_pose(board, pose_mode=board_pose_mode)

    # Keep manual board-inner helper hidden in RGB renders.
    board_inner = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME) if MANUAL_BOARD_INNER_OBJECT_NAME else None
    if board and board_inner and board_inner_rel is not None:
        apply_relative_transform(board, board_inner, board_inner_rel)
    if board_inner:
        board_inner.hide_render = True
        board_inner.hide_viewport = True

    # Hinge is NOT rendered in synthetic data — it doesn't look realistic enough.
    # Hinge annotations come from real photos only (Roboflow fine-tuning data).
    hinge = bpy.data.objects.get(HINGE_NAME)
    if hinge:
        hinge.hide_render   = True
        hinge.hide_viewport = True
    
    if hdri_images:
        env_node = world.node_tree.nodes.new('ShaderNodeTexEnvironment')
        world.node_tree.links.new(env_node.outputs['Color'], bg_node.inputs['Color'])
        
        hdri_path = random.choice(hdri_images)
        env_node.image = bpy.data.images.load(hdri_path, check_existing=True)
        
        tex_coord = world.node_tree.nodes.new("ShaderNodeTexCoord")
        mapping = world.node_tree.nodes.new("ShaderNodeMapping")
        mapping.inputs['Rotation'].default_value[0] = random.uniform(0, 6.28) 
        mapping.inputs['Rotation'].default_value[1] = random.uniform(0, 6.28) 
        mapping.inputs['Rotation'].default_value[2] = random.uniform(0, 6.28) 
        world.node_tree.links.new(tex_coord.outputs['Generated'], mapping.inputs['Vector'])
        world.node_tree.links.new(mapping.outputs['Vector'], env_node.inputs['Vector'])

# ================= WORKBENCH SEGMENTATION EXTRACTION =================
def render_piece_masks(active_pieces, scene, res_x, res_y):
    orig_hide = {p_name: bpy.data.objects.get(p_name).hide_render for p_name in active_pieces}
    orig_filepath = scene.render.filepath
    orig_engine = scene.render.engine
    orig_transparent = scene.render.film_transparent
    orig_view_transform = scene.view_settings.view_transform
    
    # Hide board, hinge, and HDRI
    if bpy.data.objects.get(BOARD_NAME):
        orig_board_hide = bpy.data.objects.get(BOARD_NAME).hide_render
        bpy.data.objects.get(BOARD_NAME).hide_render = True
    hinge_obj = bpy.data.objects.get(HINGE_NAME)
    if hinge_obj:
        orig_hinge_hide = hinge_obj.hide_render
        hinge_obj.hide_render = True
    
    world = scene.world
    orig_world_nodes = world.use_nodes
    world.use_nodes = False
    
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Raw'
    
    try:
        shading = scene.display.shading
        orig_light = shading.light
        orig_color = shading.color_type
        orig_bg = shading.background_type
        orig_bg_col = shading.background_color[:]
        orig_aa = scene.display.render_aa
        
        shading.light = 'FLAT'
        shading.color_type = 'SINGLE'
        shading.single_color = (1, 1, 1) # White
        shading.background_type = 'VIEWPORT'
        shading.background_color = (0, 0, 0)
        scene.display.render_aa = 'OFF'
    except Exception: pass

    masks = {}
    pix = np.zeros(res_x * res_y * 4, dtype=np.float32)

    for i, target_p_name in enumerate(active_pieces):
        for t_name in active_pieces:
            bpy.data.objects.get(t_name).hide_render = (t_name != target_p_name)

        temp_path = os.path.join(bpy.path.abspath("//"), f"__mask_{i}__.png")
        scene.render.filepath = temp_path
        bpy.ops.render.render(write_still=True)

        bimg = bpy.data.images.load(temp_path, check_existing=False)
        bimg.pixels.foreach_get(pix)
        px = pix.reshape(res_y, res_x, 4)
        
        masks[target_p_name] = np.flipud(px[:, :, 3] > 0.5)

        bpy.data.images.remove(bimg)
        os.remove(temp_path)

    # Restore Rendering Settings
    for p_name in active_pieces:
        bpy.data.objects.get(p_name).hide_render = orig_hide[p_name]
        
    scene.render.filepath = orig_filepath
    scene.render.engine = orig_engine
    scene.render.film_transparent = orig_transparent
    scene.view_settings.view_transform = orig_view_transform
    world.use_nodes = orig_world_nodes
    if bpy.data.objects.get(BOARD_NAME):
        bpy.data.objects.get(BOARD_NAME).hide_render = orig_board_hide
    if hinge_obj:
        hinge_obj.hide_render = orig_hinge_hide
    
    try:
        shading = scene.display.shading
        shading.light = orig_light
        shading.color_type = orig_color
        shading.background_type = orig_bg
        shading.background_color = orig_bg_col
        scene.display.render_aa = orig_aa
    except Exception: pass

    return masks

def extract_polygon_from_mask(mask):
    """Extract exact contour polygon using cv2.findContours."""
    mask_uint8 = (mask.astype(np.uint8)) * 255
    cnts, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_TC89_KCOS)
    if not cnts: return None
    cnt = max(cnts, key=cv2.contourArea)
    if len(cnt) < 3: return None
    
    h, w = mask.shape
    epsilon = 0.002 * cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, epsilon, True)
    
    pts = approx.reshape(-1, 2).astype(float)
    return [(x / w, y / h) for x, y in pts]


def compute_board_inner_inset_px(mask):
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any() or not cols.any():
        return 0

    y_idx = np.nonzero(rows)[0]
    x_idx = np.nonzero(cols)[0]
    board_h = int(y_idx[-1] - y_idx[0] + 1)
    board_w = int(x_idx[-1] - x_idx[0] + 1)

    inset_px = int(round(min(board_w, board_h) * BOARD_INNER_INSET_RATIO))
    return max(BOARD_INNER_MIN_INSET_PX, inset_px)


def extract_inner_polygon_from_mask(mask):
    inset_px = compute_board_inner_inset_px(mask)
    if inset_px <= 0:
        return extract_polygon_from_mask(mask)

    mask_uint8 = (mask.astype(np.uint8)) * 255
    kernel_size = max(3, inset_px * 2 + 1)
    kernel = np.ones((kernel_size, kernel_size), dtype=np.uint8)
    eroded = cv2.erode(mask_uint8, kernel, iterations=1)

    if not np.any(eroded):
        # Fallback to original board contour if erosion was too aggressive.
        return extract_polygon_from_mask(mask)

    return extract_polygon_from_mask(eroded > 0)


def resolve_board_label_object_name():
    if not MANUAL_BOARD_INNER_OBJECT_NAME:
        return BOARD_NAME

    manual_obj = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME)
    if manual_obj and manual_obj.type == 'MESH':
        return MANUAL_BOARD_INNER_OBJECT_NAME

    return BOARD_NAME

def create_or_get_hinge():
    """Create the hinge cylinder mesh (standalone, NOT parented to board).

    The hinge is positioned in world space each frame by position_hinge_on_board()
    after the board's auto_scale_and_flatten + yaw rotation are applied. This avoids
    the problem of auto_scale_and_flatten's flatten rotation scrambling the hinge's
    local-space position.

    The cylinder is created at the world origin with unit dimensions — it gets
    repositioned and rescaled every frame.
    """
    if bpy.data.objects.get(HINGE_NAME):
        return  # Already exists

    bpy.ops.mesh.primitive_cylinder_add(
        radius=1.0, depth=1.0, vertices=16, location=(0, 0, 0)
    )
    hinge = bpy.context.active_object
    hinge.name = HINGE_NAME

    apply_color_to_obj(hinge, BOARD_COLOR)
    hinge.hide_render   = True
    hinge.hide_viewport = True


def position_hinge_on_board(board_obj):
    """Position + scale the hinge in world space using the board's current world bbox.

    Call AFTER board.location / rotation_euler / scale are set for this frame.
    Reads the board's 8 world-space bounding-box corners to find:
      - the actual world width (extent perpendicular to the top edge)
      - the top edge centre (minimum Y in world-space = top of image)
      - the board surface Z (maximum Z = closest to camera)
    Then places the hinge cylinder along that edge.
    """
    hinge = bpy.data.objects.get(HINGE_NAME)
    if not hinge:
        return

    bpy.context.view_layer.update()  # ensure matrix_world is current

    # Board world-space corners
    corners = [board_obj.matrix_world @ mathutils.Vector(c) for c in board_obj.bound_box]
    wx = [c.x for c in corners]
    wy = [c.y for c in corners]
    wz = [c.z for c in corners]

    board_w     = max(wx) - min(wx)          # world width along X
    board_h     = max(wy) - min(wy)          # world height along Y
    board_top_y = min(wy)                    # min Y = top of image (camera looks -Z)
    board_ctr_x = (min(wx) + max(wx)) / 2.0
    board_surf_z = max(wz)                   # top surface (closest to camera)

    hinge_radius = board_w * HINGE_RADIUS_FRAC
    hinge_len    = board_w  # spans full board width

    # Place hinge: centred on board X, at top Y edge, just above surface
    hinge.location = (board_ctr_x, board_top_y - hinge_radius, board_surf_z + hinge_radius)
    # Scale: unit cylinder (radius=1, depth=1) → desired size
    hinge.scale = (hinge_len / 2.0, hinge_radius, hinge_radius)
    # Rotate cylinder so its length axis is along world X (perpendicular to camera-up)
    hinge.rotation_euler = (math.radians(90), 0, 0)

    hinge.hide_render   = False
    hinge.hide_viewport = False


def _render_single_object_mask(obj_name, scene, res_x, res_y):
    """Render one mesh object in isolation using Workbench. Returns a boolean mask or None."""
    obj = bpy.data.objects.get(obj_name)
    if not obj:
        return None

    # Save visibility state for all mesh objects
    orig_hide = {o.name: o.hide_render for o in bpy.data.objects if o.type == 'MESH'}
    orig_filepath      = scene.render.filepath
    orig_engine        = scene.render.engine
    orig_transparent   = scene.render.film_transparent
    orig_view_transform = scene.view_settings.view_transform
    world = scene.world
    orig_world_nodes   = world.use_nodes

    # Hide every mesh object, then reveal only the target
    for o in bpy.data.objects:
        if o.type == 'MESH':
            o.hide_render = True
    obj.hide_render  = False
    world.use_nodes  = False

    scene.render.engine          = 'BLENDER_WORKBENCH'
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Raw'

    orig_shading = {}
    try:
        shading = scene.display.shading
        orig_shading = {
            'light': shading.light, 'color_type': shading.color_type,
            'background_type': shading.background_type,
            'background_color': shading.background_color[:],
            'render_aa': scene.display.render_aa,
        }
        shading.light            = 'FLAT'
        shading.color_type       = 'SINGLE'
        shading.single_color     = (1, 1, 1)
        shading.background_type  = 'VIEWPORT'
        shading.background_color = (0, 0, 0)
        scene.display.render_aa  = 'OFF'
    except Exception:
        pass

    temp_path = os.path.join(bpy.path.abspath("//"), f"__mask_{obj_name}__.png")
    scene.render.filepath = temp_path
    bpy.ops.render.render(write_still=True)

    bimg = bpy.data.images.load(temp_path, check_existing=False)
    pix  = np.zeros(res_x * res_y * 4, dtype=np.float32)
    bimg.pixels.foreach_get(pix)
    px   = pix.reshape(res_y, res_x, 4)
    mask = np.flipud(px[:, :, 3] > 0.5)
    bpy.data.images.remove(bimg)
    os.remove(temp_path)

    # Restore all state
    for o in bpy.data.objects:
        if o.type == 'MESH' and o.name in orig_hide:
            o.hide_render = orig_hide[o.name]
    scene.render.filepath               = orig_filepath
    scene.render.engine                 = orig_engine
    scene.render.film_transparent       = orig_transparent
    scene.view_settings.view_transform  = orig_view_transform
    world.use_nodes                     = orig_world_nodes
    try:
        if orig_shading:
            shading = scene.display.shading
            shading.light            = orig_shading['light']
            shading.color_type       = orig_shading['color_type']
            shading.background_type  = orig_shading['background_type']
            shading.background_color = orig_shading['background_color']
            scene.display.render_aa  = orig_shading['render_aa']
    except Exception:
        pass

    return mask


def render_board_mask(scene, res_x, res_y):
    """Return a YOLO segmentation polygon for board class 11."""
    label_obj_name = resolve_board_label_object_name()
    mask = _render_single_object_mask(label_obj_name, scene, res_x, res_y)
    if mask is None:
        return None

    if label_obj_name == BOARD_NAME and BOARD_LABEL_USE_INNER_MASK:
        return extract_inner_polygon_from_mask(mask)

    return extract_polygon_from_mask(mask)


def render_hinge_bbox(scene, res_x, res_y):
    """Return normalised YOLO bbox (cx, cy, w, h) for the hinge, or None."""
    mask = _render_single_object_mask(HINGE_NAME, scene, res_x, res_y)
    if mask is None:
        return None
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any() or not cols.any():
        return None
    y1, y2 = np.where(rows)[0][[0, -1]]
    x1, x2 = np.where(cols)[0][[0, -1]]
    cx = (x1 + x2) / (2.0 * res_x)
    cy = (y1 + y2) / (2.0 * res_y)
    w  = (x2 - x1) / float(res_x)
    h  = (y2 - y1) / float(res_y)
    return (cx, cy, w, h)


# ================= Main Generator =================
def generate_dataset():
    scene = bpy.context.scene

    rgb_engine = resolve_rgb_render_engine(scene)
    rgb_view_transform = resolve_rgb_view_transform(scene)
    
    scene.render.resolution_x = RES_X
    scene.render.resolution_y = RES_Y
    scene.render.resolution_percentage = 100
    
    if hasattr(scene, "eevee"):
        try: scene.eevee.use_soft_shadows = False
        except: pass
        try: scene.eevee.use_shadows = False
        except: pass
        try: scene.eevee.shadow_cascade_size = '64'
        except: pass
        try: scene.eevee.shadow_method = 'NONE'
        except: pass

    for obj in bpy.data.objects:
        if obj.type == 'MESH':
            obj.visible_shadow = False 
    
    cam = scene.camera
    if not cam:
        cam_data = bpy.data.cameras.new(name='Camera')
        cam = bpy.data.objects.new('Camera', cam_data)
        bpy.context.collection.objects.link(cam)
        scene.camera = cam
    
    cam.location = (0, 0, 15.0)
    cam.rotation_euler = (0, 0, 0)
    cam.data.type = 'PERSP'
    cam.data.lens = 65.0

    # Support scenes where pieces come from a single STL import and are named
    # like IQ-Noodles.001 instead of piece_A..piece_K.
    auto_remap_stl_object_names()
        
    missing_pieces = [p for p in PIECE_NAMES if not bpy.data.objects.get(p)]
    if missing_pieces:
        print(f"\nCRITICAL ERROR: MISSING PIECES FROM OUTLINER: {missing_pieces}\n")
        return

    if not bpy.data.objects.get(BOARD_NAME):
        print(f"\nCRITICAL ERROR: BOARD OBJECT '{BOARD_NAME}' NOT FOUND IN OUTLINER.\n")
        return

    download_hdris_if_missing()
    center_origins_to_geometry()
    setup_materials()

    # Hinge is not used in synthetic data (only in real photo annotations).
    # create_or_get_hinge() is available for test_board_hinge.py but not called here.

    scene.use_nodes = False
    hide_all_pieces()

    board_ref = bpy.data.objects.get(BOARD_NAME)
    reference_board_matrix = board_ref.matrix_world.copy() if board_ref else None
    board_inner_rel = None
    board_inner_obj = bpy.data.objects.get(MANUAL_BOARD_INNER_OBJECT_NAME) if MANUAL_BOARD_INNER_OBJECT_NAME else None
    if board_ref and board_inner_obj:
        board_inner_rel = capture_relative_transform(board_ref, board_inner_obj)

    reference_solved_layout = None
    if USE_REFERENCE_SOLVED_LAYOUT:
        reference_solved_layout = capture_reference_solved_layout(board_ref)
        if reference_solved_layout:
            print("Captured reference solved layout from scene objects.")
        else:
            print("WARNING: Reference solved layout unavailable. Solved-grid scenes will fail until a valid solved layout is present in scene.")

    if board_inner_obj and board_inner_rel is not None:
        print(f"Using manual inner-board label object: {MANUAL_BOARD_INNER_OBJECT_NAME}")

    solver_result = solve_noodles_full()
    if not solver_result['solved']:
        raise RuntimeError("IQ Noodles full solver failed. Cannot generate logically solved/partial scenes.")

    solver_piece_pool = [
        PIECE_NAMES[pid]
        for pid in sorted(solver_result['solution'].keys())
        if solver_result['solution'][pid] is not None
    ]
    if len(solver_piece_pool) != len(PIECE_NAMES):
        solver_piece_pool = list(PIECE_NAMES)

    print(
        f"Solver ready: solved={solver_result['solved']} "
        f"states={solver_result['states']} pieces={len(solver_piece_pool)}"
    )
    
    hdri_images = glob.glob(os.path.join(HDRI_DIR, "*.exr")) + glob.glob(os.path.join(HDRI_DIR, "*.hdr"))

    plan, plan_stats = build_generation_plan(solver_piece_pool)
    train_stats = plan_stats['split_stats']['train']
    val_stats = plan_stats['split_stats']['val']

    print(f"Starting Generation: {plan_stats['total_count']} images.")
    print(f"  Random scenes: {plan_stats['random_count']}")
    print(
        f"  Solved-grid scenes: {plan_stats['solved_total_count']} "
        f"(full={plan_stats['solved_full_count']}, partial={plan_stats['solved_partial_count']})"
    )
    print(
        f"  Train split: total={train_stats['total_count']} random={train_stats['random_count']} "
        f"solved={train_stats['solved_total_count']} "
        f"(full={train_stats['solved_full_count']}, partial={train_stats['solved_partial_count']}) "
        f"single_per_piece={train_stats['single_per_piece']}"
    )
    print(
        f"  Val split: total={val_stats['total_count']} random={val_stats['random_count']} "
        f"solved={val_stats['solved_total_count']} "
        f"(full={val_stats['solved_full_count']}, partial={val_stats['solved_partial_count']}) "
        f"single_per_piece={val_stats['single_per_piece']}"
    )

    solved_requested = 0
    solved_success = 0

    for i, sample in enumerate(plan):
        split = sample['split']

        mode = sample['mode']
        active_pieces = list(sample['pieces'])
        use_board = False

        if mode in {'solved_full', 'solved_partial'}:
            solved_requested += 1
            use_board = True
            board = bpy.data.objects.get(BOARD_NAME)
            solved_ok = False

            if mode == 'solved_full':
                target_visible = list(PIECE_NAMES)
            else:
                target_visible = list(dict.fromkeys(active_pieces))

            if not reference_solved_layout:
                raise RuntimeError(
                    "Solved-grid scenes require a valid reference solved layout in the .blend scene. "
                    "Place pieces on the board in a real solved state, then rerun generation."
                )

            def attempt_solved_frame(frame_margin, attempts, use_fixed_board_pose=False):
                for _ in range(attempts):
                    prepare_hdri_background(True, hdri_images, board_pose_mode='solved', board_inner_rel=board_inner_rel)

                    if use_fixed_board_pose and board and reference_board_matrix is not None:
                        board.matrix_world = reference_board_matrix.copy()
                        if board_inner_obj and board_inner_rel is not None:
                            apply_relative_transform(board, board_inner_obj, board_inner_rel)
                        bpy.context.view_layer.update()

                    placed = apply_reference_solved_layout(board, reference_solved_layout)
                    if len(placed) != len(PIECE_NAMES):
                        continue

                    show_only_piece_set(target_visible)
                    bpy.context.view_layer.update()

                    if all_pieces_inside_frame(scene, cam, target_visible, frame_margin):
                        return True

                return False

            solved_ok = attempt_solved_frame(SOLVED_EDGE_MARGIN, SOLVED_LAYOUT_MAX_ATTEMPTS, use_fixed_board_pose=False)

            if not solved_ok:
                print(
                    f"  INFO Image {i}: strict solved framing failed; retrying with relaxed margin "
                    f"{SOLVED_EDGE_MARGIN_RELAXED:.3f}."
                )
                solved_ok = attempt_solved_frame(
                    SOLVED_EDGE_MARGIN_RELAXED,
                    SOLVED_LAYOUT_MAX_ATTEMPTS,
                    use_fixed_board_pose=False,
                )

            if not solved_ok and reference_board_matrix is not None:
                print(f"  INFO Image {i}: relaxed solved framing failed; trying fixed reference board pose fallback.")
                solved_ok = attempt_solved_frame(
                    0.0,
                    SOLVED_STATIC_FALLBACK_ATTEMPTS,
                    use_fixed_board_pose=True,
                )

            if solved_ok:
                active_pieces = target_visible
                solved_success += 1

            if not solved_ok:
                print(
                    f"  WARN Image {i}: solved framing failed after strict+relaxed+fixed attempts; "
                    "using best-effort solved fallback without frame-margin gate."
                )

                prepare_hdri_background(True, hdri_images, board_pose_mode='solved', board_inner_rel=board_inner_rel)
                if board and reference_board_matrix is not None:
                    board.matrix_world = reference_board_matrix.copy()
                    if board_inner_obj and board_inner_rel is not None:
                        apply_relative_transform(board, board_inner_obj, board_inner_rel)
                    bpy.context.view_layer.update()

                placed = apply_reference_solved_layout(board, reference_solved_layout)
                if len(placed) != len(PIECE_NAMES):
                    print(f"  WARN Image {i}: reference solved placement incomplete; falling back to random piece placement.")
                    active_pieces = place_active_pieces(
                        scene,
                        cam,
                        list(target_visible),
                        (-PLACEMENT_RADIUS, PLACEMENT_RADIUS),
                        (-PLACEMENT_RADIUS, PLACEMENT_RADIUS),
                        RANDOM_PIECE_Z,
                        MAX_TILT_DEGREES,
                        RANDOM_EDGE_MARGIN,
                        require_all=False,
                        max_retries=MAX_PLACEMENT_RETRIES,
                        context_label='solved-fallback-random',
                    )
                else:
                    show_only_piece_set(target_visible)
                    bpy.context.view_layer.update()
                    active_pieces = target_visible
        else:
            use_board = random.random() < BOARD_VISIBILITY_PROB
            prepare_hdri_background(use_board, hdri_images, board_pose_mode='random', board_inner_rel=board_inner_rel)
            active_pieces = place_active_pieces(
                scene,
                cam,
                active_pieces,
                (-PLACEMENT_RADIUS, PLACEMENT_RADIUS),
                (-PLACEMENT_RADIUS, PLACEMENT_RADIUS),
                RANDOM_PIECE_Z,
                MAX_TILT_DEGREES,
                RANDOM_EDGE_MARGIN,
                require_all=False,
                max_retries=MAX_PLACEMENT_RETRIES,
                context_label='random',
            )

        scene.frame_set(i)
        
        # 1. GENERATE MASKS (Natively in memory, perfectly crisp)
        masks = render_piece_masks(active_pieces, scene, RES_X, RES_Y)
        polygons = {p_name: extract_polygon_from_mask(m) for p_name, m in masks.items()}
        
        # 2. RENDER MAIN EXACT COLOR IMAGE
        img_filename = f"{i:06d}.png"
        img_path = os.path.join(IMAGES_DIR, split, img_filename)
        ensure_rgb_render_state(scene, rgb_engine, rgb_view_transform)
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGB'
        scene.render.filepath = img_path
        bpy.ops.render.render(write_still=True)
        
        # 3. WRITE YOLO LABEL FILES
        lbl_path = os.path.join(LABELS_DIR, split, f"{i:06d}.txt")
        with open(lbl_path, 'w') as f:
            for p_name, poly in polygons.items():
                if poly is None: continue
                # Convert list of tuples back to space-separated YOLO format
                coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in poly)
                class_id = CLASS_MAP[p_name]
                f.write(f"{class_id} {coords}\n")

            if use_board:
                # Class 11: board segmentation polygon
                board_poly = render_board_mask(scene, RES_X, RES_Y)
                if board_poly:
                    coords = " ".join(f"{x:.6f} {y:.6f}" for x, y in board_poly)
                    f.write(f"{CLASS_BOARD} {coords}\n")

                # Class 12 (hinge) is NOT labelled in synthetic data.
                # Hinge annotations come from real photos only (Roboflow).

        if mode in {'solved_full', 'solved_partial'}:
            print(f"[{i+1}/{TOTAL_IMAGES}] ({mode}) Saved Image and Generated Segmentations: {img_filename} in '{split}'")
        else:
            print(f"[{i+1}/{TOTAL_IMAGES}] Saved Image and Generated Segmentations: {img_filename} in '{split}'")

    if solved_requested > 0:
        print(f"Solved-board success rate: {solved_success}/{solved_requested}")

if __name__ == "__main__":
    generate_dataset()
    print("Dataset Rendering and Segmentation Extraction perfectly Complete!")
