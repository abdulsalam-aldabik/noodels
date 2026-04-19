"""Dump each piece's local bbox in Blender so we can compare against CONNECTOR_ANCHORS."""
import importlib.util
import os

import bpy


def _load_mod():
    gen_path = os.path.join(bpy.path.abspath("//"), "blender_yolo_generator_v2.py")
    spec = importlib.util.spec_from_file_location("noodles_gen_v2", gen_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main():
    mod = _load_mod()
    mod.auto_remap_stl_object_names()
    mod.hide_unmapped_objects()
    mod.center_origins_to_geometry()

    for pname in mod.PIECE_NAMES:
        obj = bpy.data.objects.get(pname)
        if not obj:
            print(f"{pname}: MISSING")
            continue
        xs = [v[0] for v in obj.bound_box]
        ys = [v[1] for v in obj.bound_box]
        zs = [v[2] for v in obj.bound_box]
        print(
            f"{pname}: "
            f"X=[{min(xs):.3f},{max(xs):.3f}] span={max(xs)-min(xs):.3f} | "
            f"Y=[{min(ys):.3f},{max(ys):.3f}] span={max(ys)-min(ys):.3f} | "
            f"Z=[{min(zs):.3f},{max(zs):.3f}] span={max(zs)-min(zs):.3f} | "
            f"scale={tuple(round(s,4) for s in obj.scale)}"
        )


if __name__ == "__main__":
    main()
