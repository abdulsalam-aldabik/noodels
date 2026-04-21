"""Probe: reproduce a real frame's state and report per-pin world + NDC coords.

Fixes random seed so we can re-inspect the same pose repeatedly.
"""
import importlib.util, os, random
import bpy, mathutils, bpy_extras

REPO = bpy.path.abspath("//")
spec = importlib.util.spec_from_file_location("gen", os.path.join(REPO, "blender_yolo_generator_v2.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

random.seed(42)

gen.auto_remap_stl_object_names()
gen.hide_unmapped_objects()
gen.center_origins_to_geometry()

board = bpy.data.objects.get(gen.BOARD_NAME)
bi = bpy.data.objects.get(gen.MANUAL_BOARD_INNER_OBJECT_NAME)
cam = bpy.data.objects.get("Camera")

# Pre-pose snapshot
print("=== BEFORE set_board_pose ===")
print(f"board loc={tuple(board.location)} rot={tuple(board.rotation_euler)}")
for i in range(21):
    p = bpy.data.objects.get(f"pin_{i:02d}")
    if p is None:
        print(f"  pin_{i:02d}: MISSING"); continue
    w = p.matrix_world.translation
    l = p.location
    print(f"  pin_{i:02d}: local={tuple(round(v,2) for v in l)} world=({w.x:+.2f}, {w.y:+.2f}, {w.z:+.2f}) parent={p.parent.name if p.parent else None}")

# Apply pose + reattach board_inner + configure camera (mirror prepare_hdri_background)
rel = gen.capture_relative_transform(board, bi) if board and bi else None
gen.set_board_pose(board)
gen.apply_relative_transform(board, bi, rel)
gen.configure_capture_camera(cam, bpy.context.scene)
bpy.context.view_layer.update()

print("\n=== AFTER set_board_pose ===")
print(f"board matrix_world:\n{board.matrix_world}")
wc = [board.matrix_world @ mathutils.Vector(c) for c in board.bound_box]
print(f"board WORLD bbox: "
      f"X [{min(v.x for v in wc):+.2f}..{max(v.x for v in wc):+.2f}]  "
      f"Y [{min(v.y for v in wc):+.2f}..{max(v.y for v in wc):+.2f}]  "
      f"Z [{min(v.z for v in wc):+.2f}..{max(v.z for v in wc):+.2f}]")
print(f"cam loc={tuple(cam.location)} rot={tuple(cam.rotation_euler)}")

print("\n=== PIN WORLD + NDC ===")
scene = bpy.context.scene
res_x, res_y = gen.RES_X, gen.RES_Y
for i in range(21):
    p = bpy.data.objects.get(f"pin_{i:02d}")
    if p is None: continue
    w = p.matrix_world.translation
    co = bpy_extras.object_utils.world_to_camera_view(scene, cam, w)
    # Blender NDC: x,y in [0,1], z = depth in camera space; origin bottom-left
    img_x = co.x
    img_y = 1.0 - co.y  # flip to top-down YOLO conv
    in_frame = 0.0 <= co.x <= 1.0 and 0.0 <= co.y <= 1.0 and co.z > 0
    row, col = gen.PIN_GRID_CORNERS[i]
    print(f"  pin_{i:02d} (r={row:2d}, c={col:2d})  world=({w.x:+7.2f}, {w.y:+7.2f}, {w.z:+7.2f})  "
          f"ndc=({co.x:.3f},{co.y:.3f},z={co.z:+.2f}) img=({img_x:.3f},{img_y:.3f}) {'' if in_frame else 'OUT'}")

# Also render one preview with pin overlay for eyeball check
out_dir = os.path.join(REPO, "debug-output", "probe-pin-projection")
os.makedirs(out_dir, exist_ok=True)
scene.render.filepath = os.path.join(out_dir, "probe_rgb.png")
scene.render.image_settings.file_format = "PNG"
scene.render.resolution_x = res_x
scene.render.resolution_y = res_y
bpy.ops.render.render(write_still=True)
print(f"\nRendered to {scene.render.filepath}")
