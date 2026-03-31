/**
 * Grid Mapper — Maps YOLO detections to board placements
 *
 * Strategy: Centroid-based distance matching
 *
 * Root cause of the old approach's failure:
 *   - Checked whether PIN CENTER pixels fell inside the mask.
 *     But noodle pieces slot around pins — the pin hole is often OUTSIDE
 *     the mask. Also, proto masks are 160×160 (1/4 scale), making
 *     single-pixel checks unreliable.
 *
 * New approach:
 *   1. Compute the centroid of the detection's segmentation mask.
 *   2. Transform that centroid to board-space coordinates.
 *   3. For each valid placement of this piece type, compute its board-space
 *      centroid (mean of covered pins' coordinates).
 *   4. Pick the placement whose centroid is closest to the detected centroid.
 */

import {
  BoardState,
  PIN_COORDINATES,
  POSITIONS_AROUND_PINS,
} from './board';
import { PIECE_LABELS, YOLO_TO_SOLVER_INDEX } from '../constants';
import { ALL_PLACEMENTS, type Placement } from './placements';
import { POSITION_TO_PIN } from './board';
import { applyHomography } from './homography';
import type { Detection } from '../types';

export interface PieceMapping {
  detection: Detection;
  placement: Placement | null;
  pinIndices: number[];
  confidence: number;
  /** Board-space distance between detected centroid and matched placement centroid (debug) */
  distanceBoardUnits?: number;
}

/** Reject match if nearest placement centroid is farther than this (board units, total span = 15.8) */
const MAX_MATCH_DISTANCE = 2.5;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Compute the centroid of all mask pixels with alpha > 50.
 * Returns [mean_x, mean_y] in original image pixel space, or null if empty.
 */
function computeMaskCentroid(mask: ImageData): [number, number] | null {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  const { width, height, data } = mask;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 50) {
        sumX += x;
        sumY += y;
        count++;
      }
    }
  }
  return count > 0 ? [sumX / count, sumY / count] : null;
}

/**
 * Transform a pixel coordinate to board-space using a linear (rectangular) calibration.
 * Board space: x ∈ [-7.9, 7.9], y ∈ [-7.9, 7.9]
 */
function linearPixelToBoard(
  px: number,
  py: number,
  bounds: { minX: number; minY: number; width: number; height: number },
): [number, number] {
  const PIN_MIN = -7.9;
  const PIN_RANGE = 15.8;
  return [
    PIN_MIN + ((px - bounds.minX) / bounds.width) * PIN_RANGE,
    PIN_MIN + ((py - bounds.minY) / bounds.height) * PIN_RANGE,
  ];
}

/**
 * Compute the board-space centroid of a placement.
 * = mean PIN_COORDINATES of all pins covered by the placement's cells.
 */
function computePlacementCentroid(placement: Placement): [number, number] {
  const pins = new Set<number>();
  for (const pos of placement.positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0) pins.add(pin);
  }
  if (pins.size === 0) return [0, 0];
  let sumX = 0;
  let sumY = 0;
  for (const pin of pins) {
    const [px, py] = PIN_COORDINATES[pin];
    sumX += px;
    sumY += py;
  }
  return [sumX / pins.size, sumY / pins.size];
}

/**
 * Collect all unique pin indices covered by a placement.
 */
function getPlacementPins(placement: Placement): number[] {
  const pins = new Set<number>();
  for (const pos of placement.positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0) pins.add(pin);
  }
  return Array.from(pins);
}

/**
 * Estimate rough board bounds from detection bounding boxes.
 * Used as fallback when no calibration is provided.
 */
function estimateBoardBounds(detections: Detection[]): {
  minX: number; minY: number; width: number; height: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const det of detections) {
    const [x1, y1, x2, y2] = det.bbox;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  const pad = 0.2;
  return {
    minX: minX - bw * pad,
    minY: minY - bh * pad,
    width:  bw * (1 + 2 * pad),
    height: bh * (1 + 2 * pad),
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Map YOLO detections to board placements using centroid-distance matching.
 *
 * @param detections  Detected pieces from YOLO inference
 * @param calibration Either a perspective homography `{ H: number[] }` (9 elements)
 *                    or a rectangular bounds `{ minX, minY, width, height }`.
 *                    If omitted, bounds are estimated from the detection bboxes.
 */
export function mapDetectionsToBoard(
  detections: Detection[],
  calibration?: { H: number[] } | { minX: number; minY: number; width: number; height: number },
): {
  mappings: PieceMapping[];
  boardState: BoardState;
} {
  if (detections.length === 0) {
    return { mappings: [], boardState: new BoardState() };
  }

  // Consistency Rule 3: Reject low confidence detections
  const validDetections = detections.filter(det => det.confidence >= 0.3);

  // Consistency Rule 1: Max 1 of each piece class allowed
  const classCounts = new Map<string, number>();
  for (const det of validDetections) {
    classCounts.set(det.label, (classCounts.get(det.label) || 0) + 1);
  }
  for (const [label, count] of classCounts.entries()) {
    if (count > 1) {
      throw new Error(`Detection unclear (found multiple ${label}). Please ensure all 4 board corners are visible and take another photo.`);
    }
  }

  // Resolve coordinate transform function
  let toBoard: (px: number, py: number) => [number, number];

  if (calibration && 'H' in calibration) {
    toBoard = (px, py) => applyHomography(calibration.H, px, py);
  } else {
    const bounds =
      calibration && 'minX' in calibration
        ? calibration
        : estimateBoardBounds(detections);
    toBoard = (px, py) => linearPixelToBoard(px, py, bounds);
  }

  const labelToIndex = new Map<string, number>();
  PIECE_LABELS.forEach((label, idx) => labelToIndex.set(label, idx));

  // Sort by confidence (highest first — commit most-certain placements first)
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);

  const board = new BoardState();
  const mappings: PieceMapping[] = [];
  const usedPieces = new Set<number>();

  for (const det of sorted) {
    const pieceIndex = labelToIndex.get(det.label);
    if (pieceIndex === undefined || usedPieces.has(pieceIndex)) {
      mappings.push({ detection: det, placement: null, pinIndices: [], confidence: det.confidence });
      continue;
    }

    // Step 1: Get detection centroid in pixel space
    let pixelCentroid: [number, number] | null = null;
    if (det.mask) {
      pixelCentroid = computeMaskCentroid(det.mask);
    }
    if (!pixelCentroid) {
      // Fallback: bounding-box centre
      pixelCentroid = [
        (det.bbox[0] + det.bbox[2]) / 2,
        (det.bbox[1] + det.bbox[3]) / 2,
      ];
    }

    // Step 2: Transform to board space
    const [bcx, bcy] = toBoard(pixelCentroid[0], pixelCentroid[1]);

    // Step 3: Find the valid, unoccupied placement with the nearest centroid
    const placements = ALL_PLACEMENTS[pieceIndex];
    let bestPlacement: Placement | null = null;
    let bestDist = Infinity;

    for (const placement of placements) {
      if (!board.areFree(placement.positions)) continue;
      const [pcx, pcy] = computePlacementCentroid(placement);
      const dist = Math.sqrt((bcx - pcx) ** 2 + (bcy - pcy) ** 2);
      if (dist < bestDist) {
        bestDist = dist;
        bestPlacement = placement;
      }
    }

    if (bestPlacement && bestDist <= MAX_MATCH_DISTANCE) {
      board.place(bestPlacement.positions, pieceIndex);
      usedPieces.add(pieceIndex);
      const pins = getPlacementPins(bestPlacement);
      mappings.push({
        detection: det,
        placement: bestPlacement,
        pinIndices: pins,
        confidence: det.confidence,
        distanceBoardUnits: bestDist,
      });
      console.log(
        `✅ ${det.label} centroid (${bcx.toFixed(2)}, ${bcy.toFixed(2)}) → dist ${bestDist.toFixed(2)} units → pins [${pins.join(',')}]`,
      );
    } else {
      // Last-resort fallback: nearest single pin from centroid
      let nearestPin = 0;
      let nearestPinDist = Infinity;
      for (let pin = 0; pin < PIN_COORDINATES.length; pin++) {
        const [px, py] = PIN_COORDINATES[pin];
        const d = Math.sqrt((bcx - px) ** 2 + (bcy - py) ** 2);
        if (d < nearestPinDist) { nearestPinDist = d; nearestPin = pin; }
      }
      const cells = [...POSITIONS_AROUND_PINS[nearestPin]];
      if (board.areFree(cells)) board.place(cells, pieceIndex);
      usedPieces.add(pieceIndex);

      mappings.push({
        detection: det,
        placement: null,
        pinIndices: [nearestPin],
        confidence: det.confidence,
        distanceBoardUnits: bestDist,
      });
      console.warn(
        `⚠️ ${det.label} no placement within ${MAX_MATCH_DISTANCE} units (best ${bestDist.toFixed(2)}) — fallback pin ${nearestPin}`,
      );
    }
  }

  return { mappings, boardState: board };
}
