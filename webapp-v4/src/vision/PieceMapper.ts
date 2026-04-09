import { BOARD_WIDTH, BOARD_HEIGHT, MISSING_POSITIONS } from "../engine/constants";
import { collapseCandidatesBySymmetry, generatePlacementsForPiece } from "../engine/placements";
import { CLASS_PIECE_FIRST, CLASS_PIECE_LAST, MAX_CELL_RADIUS, CELL_AMBIGUITY_RATIO } from "../inference/inferenceTypes";
import type { RawDetection } from "../inference/inferenceTypes";
import type { Candidate } from "../pipeline/PieceAssigner";
import { applyHomography } from "./HomographyComputer";
import { PIECE_ASSETS } from "../pieces/assets";
import { shapeFitScore } from "./ShapeMatcher";
import type { CalibratedBoardRef, MappedPiecePlacement } from "./visionTypes";

// ── Valid cell lookup ─────────────────────────────────────────────────────────

const MISSING_SET = new Set<number>(MISSING_POSITIONS);

/** All valid board positions as [row, col] pairs, precomputed. */
const VALID_CELLS: [number, number][] = (() => {
  const cells: [number, number][] = [];
  for (let pos = 0; pos < BOARD_WIDTH * BOARD_HEIGHT; pos++) {
    if (!MISSING_SET.has(pos)) {
      cells.push([Math.floor(pos / BOARD_WIDTH), pos % BOARD_WIDTH]);
    }
  }
  return cells;
})();

// ── Piece key lookup ──────────────────────────────────────────────────────────

const MODEL_KEYS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;

const INTERNAL_ID_BY_KEY = new Map<string, number>(
  PIECE_ASSETS.map((a) => [a.key, a.pieceId]),
);

const MAX_ALTERNATIVE_CELLS = 5;
const AMBIGUITY_DELTA = 0.9;
const TOP_K_CANDIDATES = 3;

function samplePoints(points: [number, number][], max = 80): [number, number][] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const sampled: [number, number][] = [];
  for (let i = 0; i < points.length; i += step) {
    sampled.push(points[i]);
  }
  return sampled;
}

function modelClassToInternalPieceId(modelClassId: number): number {
  const key = MODEL_KEYS[modelClassId];
  if (!key) return modelClassId;
  const mapped = INTERNAL_ID_BY_KEY.get(key);
  return mapped ?? modelClassId;
}

function modelClassToKey(modelClassId: number): string {
  return MODEL_KEYS[modelClassId] ?? `piece_${modelClassId}`;
}

// ── Distance ──────────────────────────────────────────────────────────────────

function euclidean(r1: number, c1: number, r2: number, c2: number): number {
  const dr = r1 - r2, dc = c1 - c2;
  return Math.sqrt(dr * dr + dc * dc);
}

function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0], yi = polygon[i][1];
    const xj = polygon[j][0], yj = polygon[j][1];
    const intersects = ((yi > point[1]) !== (yj > point[1]))
      && (point[0] < (xj - xi) * (point[1] - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

function toCell(pos: number): [number, number] {
  return [Math.floor(pos / BOARD_WIDTH), pos % BOARD_WIDTH];
}

function isValidCell(row: number, col: number): boolean {
  if (row < 0 || row >= BOARD_HEIGHT || col < 0 || col >= BOARD_WIDTH) return false;
  return !MISSING_SET.has(row * BOARD_WIDTH + col);
}

function rotationDegFromPlacement(placementRotationSteps?: 0 | 1 | 2 | 3): 0 | 90 | 180 | 270 {
  switch (placementRotationSteps ?? 0) {
    case 0: return 0;
    case 1: return 90;
    case 2: return 180;
    case 3: return 270;
  }
}

function placementCentroid(positions: number[]): [number, number] {
  let rowSum = 0;
  let colSum = 0;
  for (const pos of positions) {
    const [row, col] = toCell(pos);
    rowSum += row;
    colSum += col;
  }
  return [rowSum / positions.length, colSum / positions.length];
}

function candidateNeighborhoodCells(mapped: MappedPiecePlacement): [number, number][] {
  const out: [number, number][] = [];
  const seen = new Set<number>();

  const push = (cell: [number, number]): void => {
    const [row, col] = cell;
    if (!isValidCell(row, col)) return;
    const key = row * BOARD_WIDTH + col;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cell);
  };

  push(mapped.candidateCell);
  for (const alt of mapped.alternativeCells) push(alt);

  const [boardCol, boardRow] = mapped.boardCentroid;
  const baseRow = Math.round(boardRow);
  const baseCol = Math.round(boardCol);
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      push([baseRow + dr, baseCol + dc]);
    }
  }

  return out;
}

function buildPlacementIndex(pieceId: number): Map<number, ReturnType<typeof generatePlacementsForPiece>> {
  const byCell = new Map<number, ReturnType<typeof generatePlacementsForPiece>>();
  const placements = generatePlacementsForPiece(pieceId);

  for (const placement of placements) {
    for (const pos of placement.positions) {
      const arr = byCell.get(pos);
      if (arr) arr.push(placement);
      else byCell.set(pos, [placement]);
    }
  }

  return byCell;
}

function scoreCandidate(mapped: MappedPiecePlacement, footprintCells: [number, number][]): number {
  const [detCol, detRow] = mapped.boardCentroid;

  const centroid = placementCentroid(footprintCells.map(([row, col]) => row * BOARD_WIDTH + col));
  const centroidDist = euclidean(centroid[0], centroid[1], detRow, detCol);
  const centroidScore = Math.max(0, 1 - centroidDist / 3.5);

  const shapeScore = shapeFitScore(mapped.boardMaskPoints, footprintCells);
  return 0.4 * centroidScore + 0.4 * mapped.detectionConfidence + 0.2 * shapeScore;
}

export function generateCandidates(
  mappedPlacements: MappedPiecePlacement[],
  k = TOP_K_CANDIDATES,
): Map<number, Candidate[]> {
  const out = new Map<number, Candidate[]>();

  for (const mapped of mappedPlacements) {
    const byCell = buildPlacementIndex(mapped.classId);
    const cells = candidateNeighborhoodCells(mapped);
    const pieceCandidates: Candidate[] = [];
    const seen = new Set<string>();

    for (const cell of cells) {
      const placements = byCell.get(cell[0] * BOARD_WIDTH + cell[1]);
      if (!placements) continue;

      for (const placement of placements) {
        const key = `${placement.orientationIndex}:${placement.positions.join(",")}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const footprint = placement.positions.map((pos) => toCell(pos));
        const orientationDeg = rotationDegFromPlacement(placement.rotationSteps);

        pieceCandidates.push({
          pieceId: mapped.classId,
          pieceKey: mapped.pieceKey,
          anchorCell: cell,
          orientationDeg,
          footprint,
          score: scoreCandidate(mapped, footprint),
          placement,
        });
      }
    }

    pieceCandidates.sort((a, b) => b.score - a.score);
    const collapsed = collapseCandidatesBySymmetry(pieceCandidates);
    out.set(mapped.classId, collapsed.slice(0, k));
  }

  return out;
}

export function mapRectifiedPiecesToGrid(
  detections: RawDetection[],
  rectifiedW: number,
  rectifiedH: number,
): MappedPiecePlacement[] {
  const byClass = new Map<number, RawDetection>();
  for (const det of detections) {
    if (det.classId < CLASS_PIECE_FIRST || det.classId > CLASS_PIECE_LAST) continue;
    const existing = byClass.get(det.classId);
    if (!existing || det.confidence > existing.confidence) {
      byClass.set(det.classId, det);
    }
  }

  const mapped: MappedPiecePlacement[] = [];
  for (const [classId, det] of byClass) {
    const [imgCx, imgCy] = det.maskCentroid;
    const boardCol = (imgCx / Math.max(1, rectifiedW - 1)) * (BOARD_WIDTH - 1);
    const boardRow = (imgCy / Math.max(1, rectifiedH - 1)) * (BOARD_HEIGHT - 1);

    const boardMaskPoints = samplePoints(det.maskPolygon).map(([x, y]) => [
      (x / Math.max(1, rectifiedW - 1)) * (BOARD_WIDTH - 1),
      (y / Math.max(1, rectifiedH - 1)) * (BOARD_HEIGHT - 1),
    ] as [number, number]);

    const ranked = VALID_CELLS
      .map(([r, c]) => ({ cell: [r, c] as [number, number], dist: euclidean(boardRow, boardCol, r, c) }))
      .sort((a, b) => a.dist - b.dist);

    const nearest = ranked[0];
    const nearestDist = nearest.dist;
    const nearestCell = nearest.cell;
    const alternatives: [number, number][] = [];

    const distBase = Math.max(nearestDist, 1e-6);
    for (let i = 1; i < ranked.length; i += 1) {
      if (alternatives.length >= MAX_ALTERNATIVE_CELLS) break;
      const candidate = ranked[i];
      const ratio = candidate.dist / distBase;
      const delta = candidate.dist - nearestDist;
      if (ratio <= CELL_AMBIGUITY_RATIO || delta <= AMBIGUITY_DELTA) {
        alternatives.push(candidate.cell);
      } else if (candidate.dist > nearestDist + MAX_CELL_RADIUS * 0.55) {
        break;
      }
    }

    const cellConfidence = Math.max(0, 1 - nearestDist / MAX_CELL_RADIUS);
    const internalPieceId = modelClassToInternalPieceId(classId);
    mapped.push({
      modelClassId: classId,
      classId: internalPieceId,
      pieceKey: modelClassToKey(classId),
      detectionConfidence: det.confidence,
      imageCentroid: [imgCx, imgCy],
      boardCentroid: [boardCol, boardRow],
      boardMaskPoints,
      candidateCell: nearestCell,
      cellConfidence,
      ambiguous: alternatives.length > 0,
      alternativeCells: alternatives,
    });
  }

  return mapped;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Projects each piece detection's mask centroid through the board homography H
 * and snaps it to the nearest valid board cell.
 *
 * Only processes piece detections (classId 0–10).
 * One detection per class — if the same class appears multiple times (e.g. due
 * to a noisy model), only the highest-confidence detection is kept.
 *
 * @param detections - Full list of YOLO detections (all classes)
 * @param boardRef   - Calibrated board reference containing the homography H
 */
export function mapPiecesToGrid(
  detections: RawDetection[],
  boardRef: CalibratedBoardRef,
): MappedPiecePlacement[] {
  const H = boardRef.homographyMatrix;

  // Keep only one detection per class (highest confidence)
  const byClass = new Map<number, RawDetection>();
  for (const det of detections) {
    if (det.classId < CLASS_PIECE_FIRST || det.classId > CLASS_PIECE_LAST) continue;
    const existing = byClass.get(det.classId);
    if (!existing || det.confidence > existing.confidence) {
      byClass.set(det.classId, det);
    }
  }

  const results: MappedPiecePlacement[] = [];

  for (const [classId, det] of byClass) {
    const [imgCx, imgCy] = det.maskCentroid;

    // Only map detections physically inside the detected board polygon
    if (!pointInPolygon([imgCx, imgCy], boardRef.boardPolygon)) {
      continue;
    }

    // Project centroid through homography: image pixels → board grid (col, row)
    const [boardCol, boardRow] = applyHomography(H, imgCx, imgCy);

    // Hard gate: only keep detections that project inside board-space bounds
    if (boardCol < -0.5 || boardCol > BOARD_WIDTH - 0.5 || boardRow < -0.5 || boardRow > BOARD_HEIGHT - 0.5) {
      continue;
    }
    const boardMaskPoints = samplePoints(det.maskPolygon).map(([px, py]) => applyHomography(H, px, py));

    // Rank valid cells by centroid distance. A short alternative list helps
    // global assignment recover from local centroid noise.
    const ranked = VALID_CELLS
      .map(([r, c]) => ({ cell: [r, c] as [number, number], dist: euclidean(boardRow, boardCol, r, c) }))
      .sort((a, b) => a.dist - b.dist);

    const nearest = ranked[0];
    const nearestDist = nearest.dist;
    const nearestCell = nearest.cell;
    const alternatives: [number, number][] = [];

    const distBase = Math.max(nearestDist, 1e-6);
    for (let i = 1; i < ranked.length; i += 1) {
      if (alternatives.length >= MAX_ALTERNATIVE_CELLS) break;
      const candidate = ranked[i];
      const ratio = candidate.dist / distBase;
      const delta = candidate.dist - nearestDist;

      if (ratio <= CELL_AMBIGUITY_RATIO || delta <= AMBIGUITY_DELTA) {
        alternatives.push(candidate.cell);
      } else if (candidate.dist > nearestDist + MAX_CELL_RADIUS * 0.55) {
        break;
      }
    }

    // Cell confidence: 1 at exact centre, 0 at MAX_CELL_RADIUS
    const cellConfidence = Math.max(0, 1 - nearestDist / MAX_CELL_RADIUS);

    const internalPieceId = modelClassToInternalPieceId(classId);
    results.push({
      modelClassId: classId,
      classId: internalPieceId,
      pieceKey: modelClassToKey(classId),
      detectionConfidence: det.confidence,
      imageCentroid: [imgCx, imgCy],
      boardCentroid: [boardCol, boardRow], // (col, row) in grid space
      boardMaskPoints,
      candidateCell: nearestCell,
      cellConfidence,
      ambiguous: alternatives.length > 0,
      alternativeCells: alternatives,
    });
  }

  return results;
}
