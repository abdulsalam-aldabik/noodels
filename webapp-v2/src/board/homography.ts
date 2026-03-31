/**
 * Perspective Homography Utilities
 *
 * Computes a 3×3 perspective homography H that maps image pixel coordinates
 * to board-space coordinates using 4 reference pin correspondences.
 *
 * The 4 reference pins form a diamond spanning the board:
 *   • Pin  0: (-1.8, -5.6) — top
 *   • Pin  8: ( 5.4, -1.8) — right
 *   • Pin 12: (-5.4,  1.8) — left
 *   • Pin 20: ( 1.8,  5.4) — bottom
 */

/** Indices of the 4 reference pins used for calibration */
export const REF_PIN_INDICES = [0, 8, 12, 20] as const;

/** Human-readable labels for each reference point */
export const REF_PIN_LABELS = ['Top', 'Right', 'Left', 'Bottom'] as const;

/** Board-space coordinates of the 4 reference pins */
export const REF_PIN_BOARD_COORDS: readonly [number, number][] = [
  [-1.8, -5.6],
  [ 5.4, -1.8],
  [-5.4,  1.8],
  [ 1.8,  5.4],
];

/**
 * Compute perspective homography H (3×3, stored as 9-element row-major array)
 * that maps image pixel coords → board-space coords.
 *
 * Uses the Direct Linear Transform (DLT) with Gauss-Jordan elimination.
 *
 * @param srcPixels  4 pixel-space [x, y] positions (where user placed each dot)
 * @param dstBoard   4 corresponding board-space positions (defaults to REF_PIN_BOARD_COORDS)
 */
export function computeHomography(
  srcPixels: [number, number][],
  dstBoard: readonly [number, number][] = REF_PIN_BOARD_COORDS,
): number[] {
  // Build 8×8 linear system from the 4 correspondences.
  // For each pair (x,y) → (u,v):
  //   h0·x + h1·y + h2 − h6·x·u − h7·y·u = u
  //   h3·x + h4·y + h5 − h6·x·v − h7·y·v = v
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPixels[i];
    const [u, v] = dstBoard[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    b.push(v);
  }

  const h = solveGaussJordan(A, b);
  return [...h, 1]; // H[8] = 1 (scale normalisation)
}

/**
 * Apply homography H to a pixel point, returning board-space [bx, by].
 */
export function applyHomography(H: number[], px: number, py: number): [number, number] {
  const w = H[6] * px + H[7] * py + H[8];
  return [
    (H[0] * px + H[1] * py + H[2]) / w,
    (H[3] * px + H[4] * py + H[5]) / w,
  ];
}

/**
 * Project a board-space point back to pixel space using the inverse homography.
 * Useful for drawing overlaid pin positions on the image.
 *
 * Note: This computes H⁻¹ on the fly via adjugate — fine for interactive overlay rendering.
 */
export function applyInverseHomography(H: number[], bx: number, by: number): [number, number] {
  // 3×3 matrix inverse via adjugate / determinant
  const [h0, h1, h2, h3, h4, h5, h6, h7, h8] = H;
  const inv = [
    h4 * h8 - h5 * h7,
    h2 * h7 - h1 * h8,
    h1 * h5 - h2 * h4,
    h5 * h6 - h3 * h8,
    h0 * h8 - h2 * h6,
    h2 * h3 - h0 * h5,
    h3 * h7 - h4 * h6,
    h1 * h6 - h0 * h7,
    h0 * h4 - h1 * h3,
  ];
  const det = h0 * inv[0] + h1 * inv[3] + h2 * inv[6];
  const w = (inv[6] * bx + inv[7] * by + inv[8]) / det;
  return [
    (inv[0] * bx + inv[1] * by + inv[2]) / (det * w),
    (inv[3] * bx + inv[4] * by + inv[5]) / (det * w),
  ];
}

/**
 * Solve an 8×8 linear system Ax = b via Gauss-Jordan with partial pivoting.
 * Returns the 8-element solution vector.
 */
function solveGaussJordan(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivot
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const diag = M[col][col];
    if (Math.abs(diag) < 1e-12) {
      throw new Error('Homography degenerate — reference points may be collinear or duplicated');
    }

    // Normalise pivot row
    for (let j = col; j <= n; j++) M[col][j] /= diag;

    // Eliminate this column in all other rows (full Gauss-Jordan)
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }

  return M.map((row) => row[n]);
}
