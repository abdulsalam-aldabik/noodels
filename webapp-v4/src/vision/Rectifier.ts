import {
  BOARD_EDGE_MAX,
  BOARD_EDGE_MIN,
  BOARD_EDGE_SPAN,
  boardToCanvas,
  computePinBoardPoints,
  expectedCellSpacingPx,
} from "../board/gridGeometry";
import type { Point2D } from "../inference/types";
import type { BoardRef, Homography, RectifiedFrame } from "./types";

export const DEFAULT_RECTIFIED_CANVAS = 960; // 960 / 16 = 60 px per cell

/**
 * Solve H mapping src[i] → dst[i] for four pairs using the normalized DLT
 * formulation. Returns a 3×3 row-major homography. The result maps
 * homogeneous src points (x, y, 1) to dst points.
 */
export function computeHomography4(
  src: [Point2D, Point2D, Point2D, Point2D],
  dst: [Point2D, Point2D, Point2D, Point2D],
): number[] {
  // Build 8×8 linear system for the 8 unknowns of H (h33 fixed to 1).
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solveLinear(A, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting. */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    let pivotAbs = Math.abs(M[i][i]);
    for (let r = i + 1; r < n; r++) {
      const a = Math.abs(M[r][i]);
      if (a > pivotAbs) {
        pivotAbs = a;
        pivot = r;
      }
    }
    if (pivotAbs < 1e-12) {
      throw new Error("solveLinear: singular or near-singular system");
    }
    if (pivot !== i) {
      const tmp = M[i];
      M[i] = M[pivot];
      M[pivot] = tmp;
    }
    const inv = 1 / M[i][i];
    for (let c = i; c <= n; c++) M[i][c] *= inv;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = M[r][i];
      if (f === 0) continue;
      for (let c = i; c <= n; c++) M[r][c] -= f * M[i][c];
    }
  }
  return M.map((row) => row[n]);
}

export function invert3x3(m: number[]): number[] {
  const a = m[0], b = m[1], c = m[2];
  const d = m[3], e = m[4], f = m[5];
  const g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) throw new Error("invert3x3: singular matrix");
  const invDet = 1 / det;
  return [
    A * invDet,
    -(b * i - c * h) * invDet,
    (b * f - c * e) * invDet,
    B * invDet,
    (a * i - c * g) * invDet,
    -(a * f - c * d) * invDet,
    C * invDet,
    -(a * h - b * g) * invDet,
    (a * e - b * d) * invDet,
  ];
}

export function applyHomography(m: number[], x: number, y: number): Point2D {
  const X = m[0] * x + m[1] * y + m[2];
  const Y = m[3] * x + m[4] * y + m[5];
  const W = m[6] * x + m[7] * y + m[8];
  return { x: X / W, y: Y / W };
}


export interface RectifyOptions {
  canvasSize?: number;
  /** If provided, use this image→board homography directly instead of
   *  deriving one from the BoardRef corners. Used by the pin-anchored path
   *  to avoid the lossy corners round-trip. */
  precomputedImgToBoard?: number[];
}

export interface RectifyOutput {
  frame: RectifiedFrame;
  canvas: HTMLCanvasElement;
}

/**
 * Warp the source image onto a canvasSize × canvasSize canvas such that the
 * four BoardRef corners map to the edge corners of the canonical 14×14 grid.
 * Uses backward mapping with bilinear sampling.
 *
 * When `options.precomputedImgToBoard` is set, that homography is used directly
 * (bypassing the corner-based solve), which gives much better results when the
 * homography was fit from 21 pin correspondences.
 */
export function rectify(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  boardRef: BoardRef,
  options: RectifyOptions = {},
): RectifyOutput {
  const canvasSize = options.canvasSize ?? DEFAULT_RECTIFIED_CANVAS;

  // Destination corners in rectified-canvas px (edge corners of the grid).
  const dstCorners: [Point2D, Point2D, Point2D, Point2D] = [
    boardToCanvas(BOARD_EDGE_MIN, BOARD_EDGE_MIN, canvasSize),
    boardToCanvas(BOARD_EDGE_MAX, BOARD_EDGE_MIN, canvasSize),
    boardToCanvas(BOARD_EDGE_MAX, BOARD_EDGE_MAX, canvasSize),
    boardToCanvas(BOARD_EDGE_MIN, BOARD_EDGE_MAX, canvasSize),
  ];

  let Himg2canvas: number[];
  let Hcanvas2img: number[];

  if (options.precomputedImgToBoard) {
    // Pin path: compose the precomputed image→board homography with
    // the board→canvas transform to get image→canvas directly.
    const s = canvasSize / BOARD_EDGE_SPAN;
    const Cboard2canvas = [s, 0, -BOARD_EDGE_MIN * s, 0, s, -BOARD_EDGE_MIN * s, 0, 0, 1];
    Himg2canvas = multiply3x3(Cboard2canvas, options.precomputedImgToBoard);
    Hcanvas2img = invert3x3(Himg2canvas);
  } else {
    Himg2canvas = computeHomography4(boardRef.corners, dstCorners);
    Hcanvas2img = invert3x3(Himg2canvas);
  }

  // Read the source image onto an intermediate canvas for sampling.
  const srcW =
    source instanceof HTMLImageElement
      ? source.naturalWidth
      : source instanceof HTMLCanvasElement
        ? source.width
        : source.width;
  const srcH =
    source instanceof HTMLImageElement
      ? source.naturalHeight
      : source instanceof HTMLCanvasElement
        ? source.height
        : source.height;

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = srcW;
  srcCanvas.height = srcH;
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) throw new Error("rectify: could not get source 2d context");
  srcCtx.drawImage(source, 0, 0);
  const srcData = srcCtx.getImageData(0, 0, srcW, srcH).data;

  const out = document.createElement("canvas");
  out.width = canvasSize;
  out.height = canvasSize;
  const outCtx = out.getContext("2d");
  if (!outCtx) throw new Error("rectify: could not get output 2d context");
  const outImage = outCtx.createImageData(canvasSize, canvasSize);
  const outData = outImage.data;

  for (let cy = 0; cy < canvasSize; cy++) {
    for (let cx = 0; cx < canvasSize; cx++) {
      const p = applyHomography(Hcanvas2img, cx + 0.5, cy + 0.5);
      const x = p.x;
      const y = p.y;
      const idx = (cy * canvasSize + cx) * 4;
      if (x < 0 || y < 0 || x >= srcW - 1 || y >= srcH - 1) {
        outData[idx] = 0;
        outData[idx + 1] = 0;
        outData[idx + 2] = 0;
        outData[idx + 3] = 255;
        continue;
      }
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const i00 = (y0 * srcW + x0) * 4;
      const i10 = i00 + 4;
      const i01 = i00 + srcW * 4;
      const i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      outData[idx] = w00 * srcData[i00] + w10 * srcData[i10] + w01 * srcData[i01] + w11 * srcData[i11];
      outData[idx + 1] =
        w00 * srcData[i00 + 1] + w10 * srcData[i10 + 1] + w01 * srcData[i01 + 1] + w11 * srcData[i11 + 1];
      outData[idx + 2] =
        w00 * srcData[i00 + 2] + w10 * srcData[i10 + 2] + w01 * srcData[i01 + 2] + w11 * srcData[i11 + 2];
      outData[idx + 3] = 255;
    }
  }
  outCtx.putImageData(outImage, 0, 0);

  // Forward homography: image px → board units.
  // Compose: board = C * canvas where canvas = Himg2canvas * img.
  //   C = [[1/s, 0, MIN], [0, 1/s, MIN], [0, 0, 1]]
  // Inverse:  image px ← board units via Hcanvas2img * C^{-1}.
  //   C^{-1} = [[s, 0, -MIN*s], [0, s, -MIN*s], [0, 0, 1]]
  const s = canvasSize / BOARD_EDGE_SPAN;
  const C = [1 / s, 0, BOARD_EDGE_MIN, 0, 1 / s, BOARD_EDGE_MIN, 0, 0, 1];
  const Cinv = [s, 0, -BOARD_EDGE_MIN * s, 0, s, -BOARD_EDGE_MIN * s, 0, 0, 1];
  const forward = multiply3x3(C, Himg2canvas);
  const inverse = multiply3x3(Hcanvas2img, Cinv);
  const imgToBoard: Homography = {
    forward,
    inverse,
    condition: svdConditionNumber3x3(Himg2canvas),
  };

  const pinPoints = computePinBoardPoints().map((p) => ({ x: p.x, y: p.y }));

  return {
    frame: {
      canvasSize: { width: canvasSize, height: canvasSize },
      cellSpacingPx: expectedCellSpacingPx(canvasSize),
      homography: imgToBoard,
      pinPoints,
    },
    canvas: out,
  };
}

function multiply3x3(a: number[], b: number[]): number[] {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = 0; k < 3; k++) s += a[r * 3 + k] * b[k * 3 + c];
      out[r * 3 + c] = s;
    }
  }
  return out;
}

/**
 * Compute the SVD-based condition number of a 3×3 matrix: σ_max / σ_min.
 * Uses eigenvalues of M^T·M (which are the squared singular values).
 * For a well-conditioned homography this is typically < 100; for a
 * degenerate one (steep angle, bad corners) it's > 5,000.
 */
function svdConditionNumber3x3(m: number[]): number {
  // Compute M^T * M (symmetric 3×3).
  const mt = transpose3x3(m);
  const mtm = multiply3x3(mt, m);

  // Find eigenvalues of the symmetric 3×3 matrix using the analytical method.
  const eigenvalues = symmetricEigenvalues3x3(mtm);

  const maxEig = Math.max(...eigenvalues);
  const minEig = Math.min(...eigenvalues.filter((e) => e > 1e-15));

  if (minEig <= 1e-15) return Infinity;
  return Math.sqrt(maxEig / minEig);
}

function transpose3x3(m: number[]): number[] {
  return [
    m[0], m[3], m[6],
    m[1], m[4], m[7],
    m[2], m[5], m[8],
  ];
}

/**
 * Analytical eigenvalues of a real symmetric 3×3 matrix.
 * Uses Cardano's method for the cubic characteristic polynomial.
 */
function symmetricEigenvalues3x3(m: number[]): [number, number, number] {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5];
  const f = m[8];

  // Characteristic polynomial: λ³ - p·λ² + q·λ - r = 0
  const p = a + d + f; // trace
  const q = a * d + a * f + d * f - b * b - c * c - e * e;
  const r =
    a * d * f + 2 * b * e * c - a * e * e - d * c * c - f * b * b; // determinant

  // Solve using Cardano / trigonometric method for 3 real roots.
  const p3 = p / 3;
  const q2 = (p * p - 3 * q) / 9;
  const r2 = (2 * p * p * p - 9 * p * q + 27 * r) / 54;

  if (q2 <= 0) return [p3, p3, p3];

  const sqrtQ2 = Math.sqrt(q2);
  const sqrtQ2_3 = q2 * sqrtQ2; // q2^(3/2)

  let ratio = r2 / sqrtQ2_3;
  ratio = Math.max(-1, Math.min(1, ratio)); // clamp for numerical safety

  const theta = Math.acos(ratio);

  const e1 = -2 * sqrtQ2 * Math.cos(theta / 3) + p3;
  const e2 = -2 * sqrtQ2 * Math.cos((theta + 2 * Math.PI) / 3) + p3;
  const e3 = -2 * sqrtQ2 * Math.cos((theta - 2 * Math.PI) / 3) + p3;

  return [Math.abs(e1), Math.abs(e2), Math.abs(e3)];
}
