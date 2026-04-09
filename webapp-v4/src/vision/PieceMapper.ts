import { BOARD_WIDTH, BOARD_HEIGHT, MISSING_POSITIONS } from "../engine/constants";
import { CLASS_PIECE_FIRST, CLASS_PIECE_LAST, MAX_CELL_RADIUS, CELL_AMBIGUITY_RATIO } from "../inference/inferenceTypes";
import type { RawDetection } from "../inference/inferenceTypes";
import { applyHomography } from "./HomographyComputer";
import { PIECE_ASSETS } from "../pieces/assets";
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

const PIECE_KEY_BY_CLASS_ID: Record<number, string> = Object.fromEntries(
  PIECE_ASSETS.map((a) => [a.pieceId, a.key]),
);

// ── Distance ──────────────────────────────────────────────────────────────────

function euclidean(r1: number, c1: number, r2: number, c2: number): number {
  const dr = r1 - r2, dc = c1 - c2;
  return Math.sqrt(dr * dr + dc * dc);
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

    // Project centroid through homography: image pixels → board grid (col, row)
    const [boardCol, boardRow] = applyHomography(H, imgCx, imgCy);

    // Find nearest valid cell
    let nearestDist = Infinity;
    let nearestCell: [number, number] = [0, 0];
    let secondDist = Infinity;
    const alternatives: [number, number][] = [];

    for (const [r, c] of VALID_CELLS) {
      const dist = euclidean(boardRow, boardCol, r, c);
      if (dist < nearestDist) {
        secondDist = nearestDist;
        nearestDist = dist;
        nearestCell = [r, c];
      } else if (dist < secondDist) {
        secondDist = dist;
      }
    }

    // Collect all cells within ambiguity threshold
    if (secondDist / nearestDist < CELL_AMBIGUITY_RATIO) {
      for (const [r, c] of VALID_CELLS) {
        const dist = euclidean(boardRow, boardCol, r, c);
        if (dist > nearestDist && dist < nearestDist * CELL_AMBIGUITY_RATIO) {
          alternatives.push([r, c]);
        }
      }
    }

    // Cell confidence: 1 at exact centre, 0 at MAX_CELL_RADIUS
    const cellConfidence = Math.max(0, 1 - nearestDist / MAX_CELL_RADIUS);

    results.push({
      classId,
      pieceKey: PIECE_KEY_BY_CLASS_ID[classId] ?? `piece_${classId}`,
      imageCentroid: [imgCx, imgCy],
      boardCentroid: [boardCol, boardRow], // (col, row) in grid space
      candidateCell: nearestCell,
      cellConfidence,
      ambiguous: alternatives.length > 0,
      alternativeCells: alternatives,
    });
  }

  return results;
}
