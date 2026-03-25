import bpy
import bpy_extras
import mathutils
import math
import random
import os
import glob
import urllib.request
import sys
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
TOTAL_TRAIN_IMAGES = 1600
TOTAL_VAL_IMAGES = 400
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

BOARD_NAME = "board"
BOARD_COLOR = (40, 42, 45) 
DYNAMIC_PIECE_TARGET_SIZE = 1.0  
DYNAMIC_BOARD_TARGET_SIZE = 12.0 
PLACEMENT_RADIUS = 3.5 
MAX_TILT_DEGREES = 5.0
MAX_PLACEMENT_RETRIES = 500

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
    f.write("path: .\n")
    f.write("train: images/train\n")
    f.write("val: images/val\n\n")
    f.write("names:\n")
    for i, name in enumerate(PIECE_NAMES):
        label_class = PIECE_COLORS[name][0]
        f.write(f"  {i}: {label_class}\n")

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
    margin = 0.02 
    if box1[0] > box2[2] + margin or box2[0] > box1[2] + margin: return False
    if box1[1] > box2[3] + margin or box2[1] > box1[3] + margin: return False
    return True

def hide_all_pieces():
    for name in PIECE_NAMES:
        obj = bpy.data.objects.get(name)
        if obj:
            obj.hide_render = True; obj.hide_viewport = True

def prepare_hdri_background(use_board, hdri_images):
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
            board_rot_matrix = auto_scale_and_flatten(board, target_size=DYNAMIC_BOARD_TARGET_SIZE)
            yaw_matrix = mathutils.Euler((0, 0, math.radians(random.choice([0, 90, 180, 270])))).to_matrix()
            board.rotation_euler = (yaw_matrix @ board_rot_matrix).to_euler()
            board.location = (0, 0, -5.0) 
    
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
    
    # Hide board and HDRI
    if bpy.data.objects.get(BOARD_NAME):
        orig_board_hide = bpy.data.objects.get(BOARD_NAME).hide_render
        bpy.data.objects.get(BOARD_NAME).hide_render = True
    
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

# ================= Main Generator =================
def generate_dataset():
    scene = bpy.context.scene
    
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
        
    missing_pieces = [p for p in PIECE_NAMES if not bpy.data.objects.get(p)]
    if missing_pieces:
        print(f"\nCRITICAL ERROR: MISSING PIECES FROM OUTLINER: {missing_pieces}\n")
        return

    download_hdris_if_missing()
    center_origins_to_geometry()
    setup_materials()
    
    scene.use_nodes = False 
    hide_all_pieces()
    
    hdri_images = glob.glob(os.path.join(HDRI_DIR, "*.exr")) + glob.glob(os.path.join(HDRI_DIR, "*.hdr"))

    # BALANCING
    single_piece_images = len(PIECE_NAMES) * IMAGES_PER_PIECE_ALONE
    multiple_piece_images = TOTAL_IMAGES - single_piece_images 
    counts = list(range(2, len(PIECE_NAMES) + 1))  
    images_per_count = multiple_piece_images // len(counts) 
    
    plan = []
    for piece in PIECE_NAMES:
        for _ in range(IMAGES_PER_PIECE_ALONE):
            plan.append([piece])
            
    for count in counts:
        for _ in range(images_per_count):
            plan.append(random.sample(PIECE_NAMES, count))
            
    while len(plan) < TOTAL_IMAGES:
        plan.append(random.sample(PIECE_NAMES, random.choice(counts)))
        
    random.shuffle(plan)
    
    print(f"Starting Generation: {len(plan)} images.")
    
    for i, active_pieces in enumerate(plan):
        split = 'train' if i < TOTAL_TRAIN_IMAGES else 'val'
        
        use_board = random.random() < 0.25
        prepare_hdri_background(use_board, hdri_images)
        
        hide_all_pieces()
        placed_boxes_fast = []
        valid_placement = True
        
        for p_name in active_pieces:
            obj = bpy.data.objects.get(p_name)
            obj.hide_render = False; obj.hide_viewport = False
            
            base_rot_matrix = auto_scale_and_flatten(obj, target_size=DYNAMIC_PIECE_TARGET_SIZE)
            
            placed = False
            for attempt in range(MAX_PLACEMENT_RETRIES):
                
                yaw_matrix = mathutils.Euler((0, 0, random.uniform(0, 2 * math.pi))).to_matrix()
                t_x = math.radians(random.uniform(-MAX_TILT_DEGREES, MAX_TILT_DEGREES))
                t_y = math.radians(random.uniform(-MAX_TILT_DEGREES, MAX_TILT_DEGREES))
                tilt_matrix = mathutils.Euler((t_x, t_y, 0)).to_matrix()
                
                if random.random() > 0.5: flip_matrix = mathutils.Euler((math.pi, 0, 0)).to_matrix()
                else: flip_matrix = mathutils.Matrix.Identity(3)
                    
                obj.rotation_euler = (yaw_matrix @ tilt_matrix @ flip_matrix @ base_rot_matrix).to_euler()
                
                obj.location.x = random.uniform(-PLACEMENT_RADIUS, PLACEMENT_RADIUS)
                obj.location.y = random.uniform(-PLACEMENT_RADIUS, PLACEMENT_RADIUS)
                obj.location.z = 5.0 
                
                bpy.context.view_layer.update()
                
                bbox_fast = get_2d_bounding_box(scene, cam, obj)
                if not bbox_fast: continue
                min_x, min_y, max_x, max_y = bbox_fast
                if min_x < 0.05 or max_x > 0.95 or min_y < 0.05 or max_y > 0.95: continue 
                    
                overlap = False
                for p_box in placed_boxes_fast:
                    if is_overlapping(bbox_fast, p_box):
                        overlap = True; break
                        
                if not overlap:
                    placed_boxes_fast.append(bbox_fast)
                    placed = True
                    break
                    
            if not placed:
                obj.hide_render = True; obj.hide_viewport = True
                valid_placement = False
                
        if not valid_placement:
            print(f"WARNING at Image {i}: Could not place all pieces! mathematical overlap. Skipping this frame.")
            continue

        scene.frame_set(i)
        
        # 1. GENERATE MASKS (Natively in memory, perfectly crisp)
        masks = render_piece_masks(active_pieces, scene, RES_X, RES_Y)
        polygons = {p_name: extract_polygon_from_mask(m) for p_name, m in masks.items()}
        
        # 2. RENDER MAIN EXACT COLOR IMAGE
        img_filename = f"{i:06d}.png"
        img_path = os.path.join(IMAGES_DIR, split, img_filename)
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGBA'
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

        print(f"[{i+1}/{TOTAL_IMAGES}] Saved Image and Generated Segmentations: {img_filename} in '{split}'")

if __name__ == "__main__":
    generate_dataset()
    print("Dataset Rendering and Segmentation Extraction perfectly Complete!")
