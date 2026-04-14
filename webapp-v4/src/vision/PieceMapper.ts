import { BOARD_WIDTH } from "../engine/constants";
import {
  CLASS_PIECE_FIRST, CLASS_PIECE_LAST,
  MAX_CELL_RADIUS, CELL_AMBIGUITY_RATIO,
} from "../inference/inferenceTypes";
import type { RawDetection } from "../inference/inferenceTypes";
import { PIECE_ASSETS } from "../pieces/assets";
import { shapeFitScore } from "./ShapeMatcher";
import { generatePlacementsForPiece } from "../engine/placements";
import { VALID_CELLS } from "./boardCells";
import type { RectifiedGeometry } from "./RectifiedDetector";
import type { MappedPiecePlacement, PieceCandidate } from "./visionTypes";
import { applyHomography } from "./HomographyComputer";

// ── Helpers ──────────────────────────────────────────────────────────────────

const PIECE_KEY_BY_CLASS_ID: Record<number, string> = Object.fromEntries(
  PIECE_ASSETS.map((a) => [a.pieceId, a.key]),
);

const MAX_ALTERNATIVE_CELLS = 8;

export function pointInPolygon(px: number, py: number, polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Keeps one detection per piece class (highest confidence). */
function bestDetectionPerClass(detections: RawDetection[]): Map<number, RawDetection> {
  const byClass = new Map<number, RawDetection>();
  for (const det of detections) {
    if (det.classId < CLASS_PIECE_FIRST || det.classId > CLASS_PIECE_LAST) continue;
    const existing = byClass.get(det.classId);
    if (!existing || det.confidence > existing.confidence) {
      byClass.set(det.classId, det);
    }
  }
  return byClass;
}

/** Finds nearest valid cell and alternatives for a board-space point. */
function maskCoveredCells(boardMaskPoints: [number, number][]): [number, number][] {
  if (boardMaskPoints.length < 3) return [];

  const covered: [number, number][] = [];
  for (const [r, c] of VALID_CELLS) {
    const offsets: [number, number][] = [
      [c - 0.25, r - 0.25],
      [c + 0.25, r - 0.25],
      [c - 0.25, r + 0.25],
      [c + 0.25, r + 0.25],
      [c, r],
    ];

    let insideCount = 0;
    for (const [px, py] of offsets) {
      if (pointInPolygon(px, py, boardMaskPoints)) {
        insideCount++;
      }
    }

    if (insideCount >= 2) {
      covered.push([r, c]);
    }
  }

  return covered;
}

function snapToCell(
  boardRow: number,
  boardCol: number,
  boardMaskPoints: [number, number][],
): {
  nearest: { cell: [number, number]; dist: number };
  alternatives: [number, number][];
  fromMaskCoverage: boolean;
} | null {
  const covered = maskCoveredCells(boardMaskPoints)
    .map((cell) => ({ cell, dist: Math.hypot(boardRow - cell[0], boardCol - cell[1]) }))
    .sort((a, b) => a.dist - b.dist);

  if (covered.length > 0) {
    const nearest = covered[0];
    const alternatives: [number, number][] = covered
      .slice(1, MAX_ALTERNATIVE_CELLS + 1)
      .map((entry) => entry.cell);

    return { nearest, alternatives, fromMaskCoverage: true };
  }

  const cellDistances: Array<{ cell: [number, number]; dist: number }> = [];
  for (const [r, c] of VALID_CELLS) {
    cellDistances.push({ cell: [r, c], dist: Math.hypot(boardRow - r, boardCol - c) });
  }
  cellDistances.sort((a, b) => a.dist - b.dist);

  const nearest = cellDistances[0];
  if (!nearest || nearest.dist > MAX_CELL_RADIUS * 3) return null;

  const alternatives: [number, number][] = [];
  for (let i = 1; i < Math.min(cellDistances.length, MAX_ALTERNATIVE_CELLS + 1); i++) {
    const ratio = cellDistances[i].dist / nearest.dist;
    if (ratio <= CELL_AMBIGUITY_RATIO || cellDistances[i].dist - nearest.dist <= 0.9) {
      alternatives.push(cellDistances[i].cell);
    } else {
      break;
    }
  }

  return { nearest, alternatives, fromMaskCoverage: false };
}

/** Builds a MappedPiecePlacement from computed board-space coordinates. */
function buildMapping(
  classId: number,
  det: RawDetection,
  boardCol: number,
  boardRow: number,
  boardMaskPoints: [number, number][],
  centroidRectifiedPx?: [number, number],
): MappedPiecePlacement | null {
  const snap = snapToCell(boardRow, boardCol, boardMaskPoints);
  if (!snap) return null;

  const cellConfidence = snap.fromMaskCoverage
    ? Math.max(0.35, Math.max(0, 1 - snap.nearest.dist / (MAX_CELL_RADIUS * 2)))
    : Math.max(0, 1 - snap.nearest.dist / MAX_CELL_RADIUS);

  return {
    classId,
    pieceKey: PIECE_KEY_BY_CLASS_ID[classId] ?? `piece_${classId}`,
    detectionConfidence: det.confidence,
    imageCentroid: det.maskCentroid,
    boardCentroid: [boardCol, boardRow],
    boardMaskPoints,
    candidateCell: snap.nearest.cell,
    cellConfidence,
    ambiguous: snap.alternatives.length > 0,
    alternativeCells: snap.alternatives,
    centroidRectifiedPx,
  };
}

// ── Rectified-space mapping ─────────────────────────────────────────────────

/**
 * Primary mapping pass: project detections from original image space to board
 * space using the board homography (image px -> board grid).
 */
export function mapPiecesToGrid(
  detections: RawDetection[],
  homographyMatrix: number[][],
): MappedPiecePlacement[] {
  const byClass = bestDetectionPerClass(detections);
  const results: MappedPiecePlacement[] = [];

  for (const [classId, det] of byClass) {
    const [cx, cy] = det.maskCentroid;
    const [boardCol, boardRow] = applyHomography(homographyMatrix, cx, cy);
    const boardMaskPoints: [number, number][] = det.maskPolygon.map(([x, y]) =>
      applyHomography(homographyMatrix, x, y),
    );
    const mp = buildMapping(classId, det, boardCol, boardRow, boardMaskPoints);
    if (mp) results.push(mp);
  }

  return results;
}

/**
 * Maps detections from the rectified (top-down) image directly to board cells.
 * In rectified space, pixel coordinates map linearly to board grid coordinates,
 * so no homography is needed; we inverse-rotate by the detected board angle,
 * then apply scale + origin.
 *
 * cellSpacing = RECTIFIED_SIZE / (boardSpan + 2*margin)
 * Default margin=1 -> 640 / (14 + 2) = 40 px
 * [rx, ry] = R(-theta) * [cx, cy]
 * col = rx / cellSpacing + boardOriginCol
 * row = ry / cellSpacing + boardOriginRow
 */
export function mapRectifiedPiecesToGrid(
  detections: RawDetection[],
  geometry: RectifiedGeometry,
): MappedPiecePlacement[] {
  const byClass = bestDetectionPerClass(detections);
  const results: MappedPiecePlacement[] = [];
  const {
    gridToPixelScale,
    boardOriginCol,
    boardOriginRow,
    rotationAngleDeg,
    rectifiedToBoardMatrix,
  } = geometry;

  const theta = (rotationAngleDeg * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  const toBoardAxes = (x: number, y: number): [number, number] => [
    x * cosTheta + y * sinTheta,
    -x * sinTheta + y * cosTheta,
  ];

  for (const [classId, det] of byClass) {
    const [cx, cy] = det.maskCentroid;
    const [boardCol, boardRow] = rectifiedToBoardMatrix
      ? applyHomography(rectifiedToBoardMatrix, cx, cy)
      : (() => {
        const [rotCx, rotCy] = toBoardAxes(cx, cy);
        return [
          rotCx / gridToPixelScale + boardOriginCol,
          rotCy / gridToPixelScale + boardOriginRow,
        ] as [number, number];
      })();
    const boardMaskPoints: [number, number][] = det.maskPolygon.map(
      ([x, y]) => {
        if (rectifiedToBoardMatrix) {
          return applyHomography(rectifiedToBoardMatrix, x, y);
        }
        const [rotX, rotY] = toBoardAxes(x, y);
        return [
          rotX / gridToPixelScale + boardOriginCol,
          rotY / gridToPixelScale + boardOriginRow,
        ];
      },
    );
    const mp = buildMapping(classId, det, boardCol, boardRow, boardMaskPoints, [cx, cy]);
    if (mp) results.push(mp);
  }

  return results;
}

function pickPreferredMapping(
  a: MappedPiecePlacement,
  b: MappedPiecePlacement,
): MappedPiecePlacement {
  if (a.ambiguous !== b.ambiguous) return a.ambiguous ? b : a;
  if (a.cellConfidence !== b.cellConfidence) {
    return a.cellConfidence > b.cellConfidence ? a : b;
  }
  if (a.detectionConfidence !== b.detectionConfidence) {
    return a.detectionConfidence > b.detectionConfidence ? a : b;
  }
  return a;
}

/**
 * Merges primary + rectified mappings, preferring less ambiguous/higher
 * confidence entries and ensuring we keep at most one mapping per piece class.
 */
export function mergeMappedPlacements(
  primaryMapped: MappedPiecePlacement[],
  rectifiedMapped: MappedPiecePlacement[],
): MappedPiecePlacement[] {
  const byClass = new Map<number, MappedPiecePlacement>();

  for (const mp of primaryMapped) {
    byClass.set(mp.classId, mp);
  }

  for (const mp of rectifiedMapped) {
    const existing = byClass.get(mp.classId);
    if (!existing) {
      byClass.set(mp.classId, mp);
      continue;
    }
    byClass.set(mp.classId, pickPreferredMapping(existing, mp));
  }

  return [...byClass.values()];
}

// ── Candidate generation (top-K per piece) ──────────────────────────────────

const CENTROID_WEIGHT = 0.2;
const CONFIDENCE_WEIGHT = 0.25;
const SHAPE_WEIGHT = 0.55;

/**
 * Generates top-K candidate placements per piece.
 * Each candidate is scored by: centroid proximity + detection confidence + shape fit.
 */
export function generateCandidates(
  mappedPlacements: MappedPiecePlacement[],
  k = 3,
): Map<number, PieceCandidate[]> {
  const result = new Map<number, PieceCandidate[]>();

  for (const mp of mappedPlacements) {
    const allCells = [mp.candidateCell, ...mp.alternativeCells];
    const candidates: PieceCandidate[] = [];

    for (const cell of allCells) {
      const [r, c] = cell;
      const centroidDist = Math.hypot(
        mp.boardCentroid[1] - r,  // boardCentroid is [col, row]
        mp.boardCentroid[0] - c,
      );
      const centroidScore = Math.max(0, 1 - centroidDist / MAX_CELL_RADIUS);

      let shapeFit = 0;
      if (mp.boardMaskPoints.length > 3) {
        const placements = generatePlacementsForPiece(mp.classId);
        const targetPos = r * BOARD_WIDTH + c;
        const covering = placements.filter((p) => p.positions.includes(targetPos));
        if (covering.length > 0) {
          shapeFit = Math.max(...covering.map((p) => shapeFitScore(mp.boardMaskPoints, p)));
        }
      }

      const score =
        CENTROID_WEIGHT * centroidScore +
        CONFIDENCE_WEIGHT * mp.detectionConfidence +
        SHAPE_WEIGHT * shapeFit;

      candidates.push({
        classId: mp.classId,
        pieceKey: mp.pieceKey,
        cell,
        score,
        centroidDist,
        detectionConfidence: mp.detectionConfidence,
        shapeFitScore: shapeFit,
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    result.set(mp.classId, candidates.slice(0, k));
  }

  return result;
}
