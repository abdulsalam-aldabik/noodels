#!/usr/bin/env python3
"""
align_piece_objs.py
===================
Translates each piece_X.obj so the midpoint between its two connector-ball
centers lies exactly at the model origin in Three.js screen space.

After running this script, PieceModel3D.tsx can use a simple vertex-centroid
(which will be ≈ 0 in X/Y) for centering — no more connectorAnchors.ts needed.

Axis convention (Three.js rotation.x = PI/2):
    Three.js screen X = OBJ x
    Three.js screen Y = -OBJ z    (z is negated to become screen Y)
    Three.js screen Z = OBJ y     (depth, irrelevant for 2-D alignment)

So centering in screen X/Y means:
    new_obj_x = obj_x - mid_screen_x
    new_obj_z = obj_z + mid_screen_y   (note: + because screen Y = -z)

Usage (from project root):
    python align_piece_objs.py

Requires: numpy   (pip install numpy)
No trimesh needed — pure OBJ text parsing.
"""

import sys
import numpy as np
from pathlib import Path

MODELS_DIR = Path("webapp-v3/public/models")
PIECE_KEYS = list("ABCDEFGHIJK")

# Fraction of vertices (sorted by PCA projection) used to locate each connector cluster.
# 0.12 = use the 12% of vertices closest to each extreme end of the piece.
CLUSTER_FRACTION = 0.12


# ---------------------------------------------------------------------------
# OBJ I/O
# ---------------------------------------------------------------------------

def load_obj(path: Path):
    """
    Returns (vertices, lines) where vertices is an (N, 3) float64 array
    and lines is the full list of raw text lines from the file.
    """
    lines = path.read_text(encoding="utf-8").splitlines()
    verts = []
    for line in lines:
        if line.startswith("v "):
            parts = line.split()
            verts.append((float(parts[1]), float(parts[2]), float(parts[3])))
    return np.array(verts, dtype=np.float64), lines


def save_obj(path: Path, original_lines: list, new_vertices: np.ndarray) -> None:
    """Replaces 'v x y z' lines with updated coordinates and writes the file."""
    out = []
    vi = 0
    for line in original_lines:
        if line.startswith("v "):
            x, y, z = new_vertices[vi]
            out.append(f"v {x:.8f} {y:.8f} {z:.8f}")
            vi += 1
        else:
            out.append(line)
    path.write_text("\n".join(out) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# Connector-midpoint detection
# ---------------------------------------------------------------------------

def find_screen_xy_midpoint(vertices: np.ndarray) -> np.ndarray:
    """
    Returns the [X, Y] midpoint between the two connector-ball centers
    in Three.js SCREEN space (X = obj_x, Y = -obj_z).

    Method: PCA on the 2-D screen projection → principal axis →
            cluster the extreme 12 % at each end → centroid of each cluster
            → average of the two centroids.
    """
    # Project to Three.js screen plane
    screen = np.column_stack([vertices[:, 0], -vertices[:, 2]])   # (N, 2)

    # PCA to find the direction connecting the two connector balls
    mean = screen.mean(axis=0)
    centered = screen - mean
    cov = centered.T @ centered                       # (2, 2)
    _, eigvec = np.linalg.eigh(cov)                  # eigenvectors as columns
    primary = eigvec[:, -1]                           # direction of max variance

    # Project onto principal axis and sort
    proj = centered @ primary                         # (N,)
    k = max(10, int(len(proj) * CLUSTER_FRACTION))
    idx = np.argsort(proj)

    center_lo = screen[idx[:k]].mean(axis=0)          # first connector
    center_hi = screen[idx[-k:]].mean(axis=0)         # second connector

    return (center_lo + center_hi) / 2.0              # midpoint


# ---------------------------------------------------------------------------
# Per-piece processing
# ---------------------------------------------------------------------------

def process_piece(key: str) -> bool:
    path = MODELS_DIR / f"piece_{key}.obj"
    if not path.exists():
        print(f"  [SKIP] {path.name} not found")
        return False

    vertices, lines = load_obj(path)
    mid = find_screen_xy_midpoint(vertices)           # [mx, my] in screen space

    print(f"  piece_{key}: screen midpoint = ({mid[0]:+.4f}, {mid[1]:+.4f})", end="")

    # Translate in OBJ space:
    #   screen X = obj_x  -> shift obj_x by -mx
    #   screen Y = -obj_z -> shift obj_z by +my  (so that -z_new -> 0)
    new_vertices = vertices.copy()
    new_vertices[:, 0] -= mid[0]
    new_vertices[:, 2] += mid[1]

    # Verify
    mid_after = find_screen_xy_midpoint(new_vertices)
    print(f"  -> after: ({mid_after[0]:+.5f}, {mid_after[1]:+.5f})")

    save_obj(path, lines, new_vertices)
    return True


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    print(f"cwd       : {Path.cwd()}")
    print(f"models dir: {MODELS_DIR.resolve()}")
    print()

    if not MODELS_DIR.exists():
        sys.exit(f"ERROR: {MODELS_DIR} does not exist. Run from the project root.")

    ok = 0
    for key in PIECE_KEYS:
        ok += process_piece(key)

    print(f"\nDone: {ok}/{len(PIECE_KEYS)} pieces updated.")
    print("Now rebuild the app — pieces should be centered at their connector midpoint.")


if __name__ == "__main__":
    main()
