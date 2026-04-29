"""Probe: run flatten on board, compute pin world positions, and print them.

Reproduces the post-set_board_pose state of the board to inspect where the
21 pin world positions land relative to the camera frustum.
"""
import importlib.util, os, bpy, mathutils

REPO = bpy.path.abspath("//")
spec = importlib.util.spec_from_file_location("gen", os.path.join(REPO, "blender_yolo_generator_v2.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

gen.auto_remap_stl_object_names()
gen.hide_unmapped_objects()
gen.center_origins_to_geometry()

board = bpy.data.objects.get(gen.BOARD_NAME)
bi = bpy.data.objects.get(gen.MANUAL_BOARD_INNER_OBJECT_NAME)
print(f"board={board.name if board else None}  board_inner={bi.name if bi else None}")

rel = gen.capture_relative_transform(board, bi) if board and bi else None
gen.set_board_pose(board)
gen.apply_relative_transform(board, bi, rel)
bpy.context.view_layer.update()

print(f"\nboard world location: {tuple(board.location)}")
print(f"board world matrix:\n{board.matrix_world}")
print(f"board_inner world matrix:\n{bi.matrix_world}")

# World bbox of board_inner after pose
wc = [bi.matrix_world @ mathutils.Vector(c) for c in bi.bound_box]
print(f"board_inner WORLD bbox:")
print(f"  X: {min(v.x for v in wc):.3f} .. {max(v.x for v in wc):.3f}")
print(f"  Y: {min(v.y for v in wc):.3f} .. {max(v.y for v in wc):.3f}")
print(f"  Z: {min(v.z for v in wc):.3f} .. {max(v.z for v in wc):.3f}")

# Now compute pin positions
pins = gen.compute_pin_world_positions(bi)
print(f"\nPin world positions ({len(pins)}):")
for i, p in enumerate(pins):
    print(f"  pin {i:02d} (row={gen.PIN_GRID_CORNERS[i][0]:2d}, col={gen.PIN_GRID_CORNERS[i][1]:2d}): "
          f"({p.x:+.3f}, {p.y:+.3f}, {p.z:+.3f})")

# Project all pins
cam = bpy.data.objects.get("Camera") or bpy.data.objects.get("camera")
if cam:
    print(f"\ncam location: {tuple(cam.location)}  rotation: {tuple(cam.rotation_euler)}")
    gen.configure_capture_camera(cam, bpy.context.scene)
    import bpy_extras
    print(f"\nProjected pins (Blender NDC x, y, z-depth):")
    for i, p in enumerate(pins):
        co = bpy_extras.object_utils.world_to_camera_view(bpy.context.scene, cam, p)
        print(f"  pin {i:02d}: ndc=({co.x:.3f}, {co.y:.3f}, z={co.z:.2f})")
