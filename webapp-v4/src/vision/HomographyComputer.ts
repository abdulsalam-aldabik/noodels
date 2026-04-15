/**
 * Computes the 3×3 perspective homography matrix H from exactly 4 point
 * correspondences using the Direct Linear Transform (DLT).
 *
 * H maps source points (image pixels) to destination points (board grid).
 * Given source point (px, py):
 *   [x', y', w'] = H × [px, py, 1]
 *   dest = (x'/w', y'/w')
 *
 * The 4-point DLT constructs an 8×9 system Ah=0 and solves it analytically
 * (no SVD needed) by reducing to a 8×8 linear system via the constraint h[8]=1.
 * This is exact for 4 non-collinear correspondences with no noise.
 */
export function computeHomography(
  srcPoints: [[number, number], [number, number], [number, number], [number, number]],
  dstPoints: [[number, number], [number, number], [number, number], [number, number]],
): number[][] {
  // Build the 8×8 matrix A and 8-vector b from the 4 correspondence equations.
  // Each point pair (x,y)→(u,v) gives two rows:
  //   [-x, -y, -1,  0,  0,  0, u*x, u*y] h = -u
  //   [ 0,  0,  0, -x, -y, -1, v*x, v*y] h = -v
  // where h = [h00,h01,h02,h10,h11,h12,h20,h21] (with h22=1).

  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const [x, y] = srcPoints[i];
    const [u, v] = dstPoints[i];

    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y]);
    b.push(-u);

    A.push([0, 0, 0, -x, -y, -1, v * x, v * y]);
    b.push(-v);
  }

  const h = gaussianElimination(A, b);

  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

/**
 * Applies a 3×3 homography to transform a point (px, py).
 * Returns (col, row) in board grid space.
 */
export function applyHomography(H: number[][], px: number, py: number): [number, number] {
  const w = H[2][0] * px + H[2][1] * py + H[2][2];
  const x = (H[0][0] * px + H[0][1] * py + H[0][2]) / w;
  const y = (H[1][0] * px + H[1][1] * py + H[1][2]) / w;
  return [x, y];
}

/**
 * Solves the linear system Ax = b using Gaussian elimination with partial pivoting.
 * A is n×n, b is n×1. Mutates inputs.
 */
function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = b.length;

  // Augmented matrix [A | b]
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting: find row with largest absolute value in this column
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }

    // Swap rows
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-10) {
      throw new Error("Homography: singular matrix — points may be collinear or duplicated");
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n] / M[i][i];
    for (let j = i + 1; j < n; j++) {
      x[i] -= (M[i][j] / M[i][i]) * x[j];
    }
  }

  return x;
}

/**
 * Solves an overdetermined system Ax = b in the least-squares sense via normal
 * equations: (A^T A) x = A^T b. A is (rows × cols), result is cols-vector.
 */
function leastSquaresSolve(A: number[][], b: number[]): number[] {
  const rows = A.length;
  const cols = A[0].length;

  const AtA: number[][] = Array.from({ length: cols }, () => new Array<number>(cols).fill(0));
  const Atb: number[] = new Array<number>(cols).fill(0);

  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      Atb[j] += A[i][j] * b[i];
      for (let k = 0; k < cols; k++) {
        AtA[j][k] += A[i][j] * A[i][k];
      }
    }
  }

  return gaussianElimination(AtA, Atb);
}

/**
 * Computes a 3×3 homography from N ≥ 4 point correspondences.
 * For N = 4, uses the exact 4-point DLT.
 * For N > 4, fits in the least-squares sense via normal equations on the
 * overdetermined 2N×8 DLT system (with h[8] = 1 fixed).
 *
 * Use this instead of computeHomography when you have more than 4 correspondences
 * (e.g. from detected board pins) and want a robust fit.
 */
export function computeHomographyLeastSquares(
  srcPoints: [number, number][],
  dstPoints: [number, number][],
): number[][] {
  const n = srcPoints.length;
  if (n < 4) throw new Error(`computeHomographyLeastSquares: need ≥4 points, got ${n}`);
  if (n === 4) {
    return computeHomography(
      srcPoints as [[number, number], [number, number], [number, number], [number, number]],
      dstPoints as [[number, number], [number, number], [number, number], [number, number]],
    );
  }

  // Each point pair (x,y)→(u,v) contributes two rows to Ah=b (h[8]=1 fixed):
  //   [-x, -y, -1,  0,  0,  0, u·x, u·y] h = -u
  //   [ 0,  0,  0, -x, -y, -1, v·x, v·y] h = -v
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < n; i++) {
    const [x, y] = srcPoints[i];
    const [u, v] = dstPoints[i];
    A.push([-x, -y, -1, 0, 0, 0, u * x, u * y]);
    b.push(-u);
    A.push([0, 0, 0, -x, -y, -1, v * x, v * y]);
    b.push(-v);
  }

  const h = leastSquaresSolve(A, b);

  return [
    [h[0], h[1], h[2]],
    [h[3], h[4], h[5]],
    [h[6], h[7], 1],
  ];
}

/**
 * Orders four corner points as [TL, TR, BR, BL] based on their geometric position.
 *
 * Strategy:
 *   TL = smallest (x + y)
 *   BR = largest  (x + y)
 *   TR = smallest (y - x)
 *   BL = largest  (y - x)
 *
 * This works for any roughly rectangular quadrilateral (handles perspective tilt).
 */
export function orderCorners(
  points: [number, number][],
): [[number, number], [number, number], [number, number], [number, number]] {
  if (points.length < 4) {
    throw new Error(`orderCorners needs 4 points, got ${points.length}`);
  }

  // Use the 4 most extremal points
  const candidates = points.length === 4 ? points : pickFourExtremes(points);

  const sums = candidates.map(([x, y]) => x + y);
  const diffs = candidates.map(([x, y]) => y - x);

  const tl = candidates[sums.indexOf(Math.min(...sums))];
  const br = candidates[sums.indexOf(Math.max(...sums))];
  const tr = candidates[diffs.indexOf(Math.min(...diffs))];
  const bl = candidates[diffs.indexOf(Math.max(...diffs))];

  return [tl, tr, br, bl];
}

/**
 * Picks four extreme points from a convex polygon:
 * leftmost, rightmost, topmost, bottommost.
 * Used when the hull has more than 4 vertices.
 */
function pickFourExtremes(hull: [number, number][]): [number, number][] {
  let left = hull[0], right = hull[0], top = hull[0], bottom = hull[0];
  for (const p of hull) {
    if (p[0] < left[0]) left = p;
    if (p[0] > right[0]) right = p;
    if (p[1] < top[1]) top = p;
    if (p[1] > bottom[1]) bottom = p;
  }
  // De-duplicate (may overlap for axis-aligned shapes)
  return Array.from(new Set([left, right, top, bottom]));
}
