/**
 * Pin-anchored localization: refines the corner-based BoardRef using detected
 * class-13 pins as an over-determined correspondence set.
 *
 * Flow:
 *   1. Seed an initial image→board homography from the 4 board corners.
 *   2. Warp each detected pin into board space via the seed homography.
 *   3. Assign each detected pin to the nearest canonical pin (greedy, score-ordered).
 *   4. If ≥ MIN_INLIER_PINS correspondences survive the assignment threshold,
 *      refit an N-point least-squares DLT over those correspondences.
 *   5. Run one inlier-refinement pass (drop any correspondence whose residual
 *      exceeds RESIDUAL_REJECT_CELLS, refit) so a single bad pin doesn't warp
 *      the homography.
 *   6. Fall back to the corner homography if the pin count is too low.
 *
 * This module does NOT replace {@link locateBoard}; it consumes its output
 * and produces a {@link BoardRefPins} that callers can use in place of the
 * base BoardRef.
 */

import {
  BOARD_EDGE_MAX,
  BOARD_EDGE_MIN,
  computePinBoardPoints,
} from "../board/gridGeometry";
import type { Point2D } from "../inference/types";
import { applyHomography, computeHomography4, invert3x3 } from "./Rectifier";
import type {
  BoardRef,
  BoardRefPins,
  Homography,
  PinCorrespondence,
  PinDetection,
  PinLocalizationStatus,
} from "./types";

/** Greedy nearest-neighbor acceptance radius, in board-space cell units. */
const ASSIGNMENT_RADIUS_CELLS = 0.7;
/** Minimum correspondences before we prefer a pin-fit homography over corners. */
const MIN_INLIER_PINS = 12;
/** Residual above this (cells) drops a correspondence in the inlier pass. */
const RESIDUAL_REJECT_CELLS = 0.45;

export interface LocateBoardPinsOptions {
  minInlierPins?: number;
  assignmentRadiusCells?: number;
  residualRejectCells?: number;
}

export function locateBoardPins(
  pinDetections: PinDetection[],
  boardRef: BoardRef,
  options: LocateBoardPinsOptions = {},
): BoardRefPins {
  const minInlier = options.minInlierPins ?? MIN_INLIER_PINS;
  const assignRadius = options.assignmentRadiusCells ?? ASSIGNMENT_RADIUS_CELLS;
  const residualReject = options.residualRejectCells ?? RESIDUAL_REJECT_CELLS;

  const base: BoardRefPins = {
    ...boardRef,
    pinDetections,
    pinCorrespondences: [],
    pinStatus: "failed",
  };

  if (boardRef.status === "failed") {
    base.pinStatus = "failed";
    base.pinMessage = "corner localization failed; cannot seed pin matching";
    return base;
  }

  // Seed homography from the 4 board corners (image px → board units).
  let cornerH: number[];
  try {
    cornerH = buildCornerHomography(boardRef.corners);
  } catch (err) {
    base.pinStatus = "failed";
    base.pinMessage = `corner homography solve failed: ${String(err)}`;
    return base;
  }

  const canonicalPins = computePinBoardPoints();

  // Initial assignment: project each detected pin to board space via cornerH,
  // then greedy-match against canonical pin centers in score-descending order.
  const initial = assignPinsToCanonical(
    pinDetections,
    canonicalPins,
    cornerH,
    assignRadius,
  );

  if (initial.length < minInlier) {
    base.pinCorrespondences = initial.map((c) => ({
      ...c,
      residualBoardUnits: c.residualBoardUnits,
    }));
    base.pinStatus = "fallback_corners";
    base.pinMessage = `only ${initial.length}/21 pin correspondences (threshold ${minInlier})`;
    return base;
  }

  // Refit N-point DLT using all accepted correspondences, then one inlier pass.
  let refined: PinCorrespondence[] = initial;
  let pinH: number[] | null = null;
  try {
    pinH = computeHomographyN(
      refined.map((c) => c.imagePoint),
      refined.map((c) => c.boardPoint),
    );
  } catch (err) {
    base.pinCorrespondences = refined;
    base.pinStatus = "fallback_corners";
    base.pinMessage = `pin DLT refit failed: ${String(err)}`;
    return base;
  }

  // Inlier refinement: compute residuals under the refit, drop outliers, refit once more.
  const inliers = computeResiduals(refined, pinH).filter(
    (c) => c.residualBoardUnits <= residualReject,
  );
  if (inliers.length >= minInlier && inliers.length < refined.length) {
    try {
      pinH = computeHomographyN(
        inliers.map((c) => c.imagePoint),
        inliers.map((c) => c.boardPoint),
      );
      refined = computeResiduals(inliers, pinH);
    } catch {
      // Keep the pre-inlier fit if the refit fails.
      refined = computeResiduals(refined, pinH);
    }
  } else {
    refined = computeResiduals(refined, pinH);
  }

  const pinHomography = buildHomographyStruct(pinH);
  const status: PinLocalizationStatus =
    refined.length >= 18 ? "ok" : refined.length >= minInlier ? "lowPinCount" : "fallback_corners";

  return {
    ...boardRef,
    pinDetections,
    pinCorrespondences: refined,
    pinHomography,
    pinStatus: status,
    pinMessage:
      status === "lowPinCount"
        ? `fit used ${refined.length}/21 pins (below 18-pin high-confidence threshold)`
        : undefined,
  };
}

/** Build the initial image→board homography from the BoardRef corners. */
function buildCornerHomography(corners: BoardRef["corners"]): number[] {
  const edgeCorners: [Point2D, Point2D, Point2D, Point2D] = [
    { x: BOARD_EDGE_MIN, y: BOARD_EDGE_MIN }, // TL
    { x: BOARD_EDGE_MAX, y: BOARD_EDGE_MIN }, // TR
    { x: BOARD_EDGE_MAX, y: BOARD_EDGE_MAX }, // BR
    { x: BOARD_EDGE_MIN, y: BOARD_EDGE_MAX }, // BL
  ];
  return computeHomography4(corners, edgeCorners);
}

/**
 * Greedy score-ordered nearest-neighbor assignment.
 * Each detected pin claims its nearest unclaimed canonical pin within radius.
 */
function assignPinsToCanonical(
  detections: PinDetection[],
  canonical: ReturnType<typeof computePinBoardPoints>,
  imgToBoard: number[],
  radiusCells: number,
): PinCorrespondence[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score);
  const claimed = new Set<number>();
  const out: PinCorrespondence[] = [];

  for (const det of sorted) {
    const boardP = applyHomography(imgToBoard, det.center.x, det.center.y);
    let bestIdx = -1;
    let bestDist = Infinity;
    for (const cp of canonical) {
      if (claimed.has(cp.pinIndex)) continue;
      const dx = boardP.x - cp.x;
      const dy = boardP.y - cp.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = cp.pinIndex;
      }
    }
    if (bestIdx >= 0 && bestDist <= radiusCells) {
      claimed.add(bestIdx);
      const cp = canonical[bestIdx];
      out.push({
        canonicalPinIndex: bestIdx,
        imagePoint: det.center,
        boardPoint: { x: cp.x, y: cp.y },
        score: det.score,
        residualBoardUnits: bestDist,
      });
    }
  }
  return out;
}

/**
 * Least-squares DLT for image→board, n ≥ 4. Fixes h33 = 1 and solves the
 * 2n×8 overdetermined system via normal equations (A^T A) h = A^T b.
 */
export function computeHomographyN(src: Point2D[], dst: Point2D[]): number[] {
  if (src.length !== dst.length) {
    throw new Error("computeHomographyN: src/dst length mismatch");
  }
  const n = src.length;
  if (n < 4) throw new Error("computeHomographyN: need ≥4 correspondences");

  const At = Array.from({ length: 8 }, () => new Array<number>(8).fill(0));
  const Atb = new Array<number>(8).fill(0);

  for (let i = 0; i < n; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    const rows = [
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    ];
    for (const row of rows) {
      const lhs = row.slice(0, 8);
      const rhs = row[8];
      for (let a = 0; a < 8; a++) {
        Atb[a] += lhs[a] * rhs;
        for (let b = 0; b < 8; b++) {
          At[a][b] += lhs[a] * lhs[b];
        }
      }
    }
  }

  const h = solveLinearSystem(At, Atb);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Gaussian elimination with partial pivoting (same shape as Rectifier's solver). */
function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    let pivotAbs = Math.abs(M[i][i]);
    for (let r = i + 1; r < n; r++) {
      const v = Math.abs(M[r][i]);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivot = r;
      }
    }
    if (pivotAbs < 1e-12) {
      throw new Error("solveLinearSystem: singular or near-singular matrix");
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

function computeResiduals(corrs: PinCorrespondence[], imgToBoard: number[]): PinCorrespondence[] {
  return corrs.map((c) => {
    const projected = applyHomography(imgToBoard, c.imagePoint.x, c.imagePoint.y);
    const dx = projected.x - c.boardPoint.x;
    const dy = projected.y - c.boardPoint.y;
    return { ...c, residualBoardUnits: Math.sqrt(dx * dx + dy * dy) };
  });
}

function buildHomographyStruct(forward: number[]): Homography {
  const inverse = invert3x3(forward);
  return {
    forward,
    inverse,
    condition: frobeniusNorm(forward) * frobeniusNorm(inverse),
  };
}

function frobeniusNorm(m: number[]): number {
  let s = 0;
  for (const v of m) s += v * v;
  return Math.sqrt(s);
}
