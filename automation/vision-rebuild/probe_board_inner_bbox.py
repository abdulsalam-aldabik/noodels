"""Probe board_inner's local bound_box dims and world transform."""
import bpy
import mathutils

bi = bpy.data.objects.get("board_inner")
board = bpy.data.objects.get("board") or bpy.data.objects.get("IQ-Noodles.003")
if not bi:
    print("NO board_inner")
else:
    local = [mathutils.Vector(c) for c in bi.bound_box]
    xs = [v.x for v in local]
    ys = [v.y for v in local]
    zs = [v.z for v in local]
    print(f"board_inner local bbox:")
    print(f"  X: {min(xs):.4f} .. {max(xs):.4f}  (span={max(xs)-min(xs):.4f})")
    print(f"  Y: {min(ys):.4f} .. {max(ys):.4f}  (span={max(ys)-min(ys):.4f})")
    print(f"  Z: {min(zs):.4f} .. {max(zs):.4f}  (span={max(zs)-min(zs):.4f})")
    print(f"board_inner location: {tuple(bi.location)}")
    print(f"board_inner rotation_euler: {tuple(bi.rotation_euler)}")
    print(f"board_inner scale: {tuple(bi.scale)}")
    print(f"board_inner matrix_world:\n{bi.matrix_world}")
    print(f"board_inner parent: {bi.parent.name if bi.parent else None}")

    # World-space bbox
    world_corners = [bi.matrix_world @ mathutils.Vector(c) for c in bi.bound_box]
    wx = [v.x for v in world_corners]
    wy = [v.y for v in world_corners]
    wz = [v.z for v in world_corners]
    print(f"board_inner WORLD bbox:")
    print(f"  X: {min(wx):.4f} .. {max(wx):.4f}  (span={max(wx)-min(wx):.4f})")
    print(f"  Y: {min(wy):.4f} .. {max(wy):.4f}  (span={max(wy)-min(wy):.4f})")
    print(f"  Z: {min(wz):.4f} .. {max(wz):.4f}  (span={max(wz)-min(wz):.4f})")

if board:
    print(f"\nboard object: {board.name}")
    local = [mathutils.Vector(c) for c in board.bound_box]
    xs = [v.x for v in local]; ys = [v.y for v in local]; zs = [v.z for v in local]
    print(f"  board local bbox spans: X={max(xs)-min(xs):.3f} Y={max(ys)-min(ys):.3f} Z={max(zs)-min(zs):.3f}")
    world_corners = [board.matrix_world @ mathutils.Vector(c) for c in board.bound_box]
    wx = [v.x for v in world_corners]; wy = [v.y for v in world_corners]; wz = [v.z for v in world_corners]
    print(f"  board WORLD bbox spans: X={max(wx)-min(wx):.3f} Y={max(wy)-min(wy):.3f} Z={max(wz)-min(wz):.3f}")
