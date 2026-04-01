/**
 * Perspective homography: DLT with Gauss-Jordan elimination.
 */

/**
 * Compute 3x3 homography H mapping srcPixels -> dstBoard.
 * Returns 9-element row-major array (H[8] = 1).
 */
export function computeHomography(
  srcPixels: [number, number][],
  dstBoard: readonly [number, number][],
): number[] {
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
  return [...h, 1];
}

/** Apply H to pixel point -> board-space [bx, by] */
export function applyHomography(H: number[], px: number, py: number): [number, number] {
  const w = H[6] * px + H[7] * py + H[8];
  return [
    (H[0] * px + H[1] * py + H[2]) / w,
    (H[3] * px + H[4] * py + H[5]) / w,
  ];
}

/** Project board-space point back to pixel space (computes H^-1 on the fly) */
export function applyInverseHomography(H: number[], bx: number, by: number): [number, number] {
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

function solveGaussJordan(A: number[][], b: number[]): number[] {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const diag = M[col][col];
    if (Math.abs(diag) < 1e-12) {
      throw new Error('Homography degenerate');
    }

    for (let j = col; j <= n; j++) M[col][j] /= diag;
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col];
      for (let j = col; j <= n; j++) M[row][j] -= factor * M[col][j];
    }
  }

  return M.map(row => row[n]);
}
