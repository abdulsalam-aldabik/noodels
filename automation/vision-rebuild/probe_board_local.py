"""Probe: inspect board local bbox + pin parent-relative offsets before/after center_origins."""
import importlib.util, os, bpy, mathutils

REPO = bpy.path.abspath("//")
spec = importlib.util.spec_from_file_location("gen", os.path.join(REPO, "blender_yolo_generator_v2.py"))
gen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gen)

board = bpy.data.objects.get(gen.BOARD_NAME) or bpy.data.objects.get("board") or bpy.data.objects.get("IQ-Noodles.003")
assert board is not None, "no board"

def dump(tag):
    bpy.context.view_layer.update()
    bbl = [mathutils.Vector(c) for c in board.bound_box]
    print(f"\n--- {tag} ---")
    print(f"board.name={board.name} location={tuple(board.location)}")
    xs = [v.x for v in bbl]; ys = [v.y for v in bbl]; zs = [v.z for v in bbl]
    print(f"board LOCAL bbox: X [{min(xs):+.2f}..{max(xs):+.2f}] Y [{min(ys):+.2f}..{max(ys):+.2f}] Z [{min(zs):+.2f}..{max(zs):+.2f}]")
    # geometric center of local bbox
    c = sum(bbl, mathutils.Vector()) / 8.0
    print(f"local_center = ({c.x:+.3f}, {c.y:+.3f}, {c.z:+.3f})")
    for i in [0, 5, 10, 15, 20]:
        p = bpy.data.objects.get(f"pin_{i:02d}")
        if p:
            wp = p.matrix_world.translation
            lp = p.location
            print(f"  pin_{i:02d} local={tuple(round(v,2) for v in lp)} world=({wp.x:+.2f},{wp.y:+.2f},{wp.z:+.2f})")

dump("raw scene.blend (no preprocessing)")
gen.auto_remap_stl_object_names()
dump("after auto_remap")
gen.hide_unmapped_objects()
gen.center_origins_to_geometry()
dump("after center_origins_to_geometry")
