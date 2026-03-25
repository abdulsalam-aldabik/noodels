/**
 * Grid Mapper — Maps YOLO detections to board placements
 *
 * Uses SEGMENTATION MASKS for accurate pin matching:
 * 1. Estimate board bounds from detections
 * 2. For each pin, compute its pixel position in the image
 * 3. For each detection, check which pins' pixel coords fall within the MASK
 * 4. Match against valid placements using pin overlap
 */

import {
  BoardState,
  PIN_COORDINATES,
  NUM_PINS,
  POSITIONS_AROUND_PINS,
} from './board';
import { PIECE_LABELS } from '../constants';
import { ALL_PLACEMENTS, type Placement } from './placements';
import { POSITION_TO_PIN } from './board';
import type { Detection } from '../types';

export interface PieceMapping {
  detection: Detection;
  placement: Placement | null;
  pinIndices: number[];
  confidence: number;
}

/**
 * Check if a pixel coordinate falls within a detection's segmentation mask.
 */
function isPixelInMask(
  mask: ImageData,
  px: number,
  py: number,
): boolean {
  const x = Math.round(px);
  const y = Math.round(py);
  if (x < 0 || x >= mask.width || y < 0 || y >= mask.height) return false;
  // Mask alpha channel > 0 means this pixel belongs to the piece
  const idx = (y * mask.width + x) * 4 + 3; // alpha channel
  return mask.data[idx] > 50;
}

/**
 * Get all pin indices that a placement occupies.
 */
function getPlacementPins(placement: Placement): Set<number> {
  const pins = new Set<number>();
  for (const pos of placement.positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0) pins.add(pin);
  }
  return pins;
}

/**
 * Estimate board bounding box from detections.
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
  const padX = bw * 0.2;
  const padY = bh * 0.2;

  return {
    minX: minX - padX,
    minY: minY - padY,
    width: bw + 2 * padX,
    height: bh + 2 * padY,
  };
}

/**
 * Compute pixel positions for all 21 pins given board bounds.
 */
function computePinPixels(boardBounds: {
  minX: number; minY: number; width: number; height: number;
}): [number, number][] {
  const PIN_MIN = -7.9;
  const PIN_RANGE = 15.8;

  return Array.from({ length: NUM_PINS }, (_, i) => {
    const [bx, by] = PIN_COORDINATES[i];
    const px = boardBounds.minX + ((bx - PIN_MIN) / PIN_RANGE) * boardBounds.width;
    const py = boardBounds.minY + ((by - PIN_MIN) / PIN_RANGE) * boardBounds.height;
    return [px, py] as [number, number];
  });
}

/**
 * Map YOLO detections to board placements using segmentation masks.
 *
 * Strategy:
 * - For each detection with a mask, check which pins fall inside the mask
 * - For each detection without a mask, fall back to bbox-based matching
 * - Match the detected pins against valid placements for that piece
 */
export function mapDetectionsToBoard(
  detections: Detection[],
  userBoardBounds?: { minX: number; minY: number; width: number; height: number }
): {
  mappings: PieceMapping[];
  boardState: BoardState;
} {
  if (detections.length === 0) {
    return { mappings: [], boardState: new BoardState() };
  }

  // Use manual user bounds if provided, else fall back to heuristic estimation
  const boardBounds = userBoardBounds || estimateBoardBounds(detections);
  const pinPixels = computePinPixels(boardBounds);

  const labelToIndex = new Map<string, number>();
  PIECE_LABELS.forEach((label, idx) => labelToIndex.set(label, idx));

  // Sort by confidence (highest first)
  const sorted = [...detections].sort((a, b) => b.confidence - a.confidence);

  // For each detection, find which pins fall within its mask or bbox
  const detectionPins: Array<{ detection: Detection; pins: Set<number> }> = [];

  for (const det of sorted) {
    const pinsInPiece = new Set<number>();

    if (det.mask) {
      // Use segmentation mask — most accurate method
      for (let pin = 0; pin < NUM_PINS; pin++) {
        const [px, py] = pinPixels[pin];
        if (isPixelInMask(det.mask, px, py)) {
          pinsInPiece.add(pin);
        }
      }

      // If mask found no pins, also check a small neighborhood around each pin
      if (pinsInPiece.size === 0) {
        const searchRadius = Math.max(boardBounds.width, boardBounds.height) * 0.02;
        for (let pin = 0; pin < NUM_PINS; pin++) {
          const [px, py] = pinPixels[pin];
          // Check a 3x3 grid around the pin position
          for (let dx = -searchRadius; dx <= searchRadius; dx += searchRadius) {
            for (let dy = -searchRadius; dy <= searchRadius; dy += searchRadius) {
              if (isPixelInMask(det.mask, px + dx, py + dy)) {
                pinsInPiece.add(pin);
                break;
              }
            }
          }
        }
      }

      console.log(`🎯 ${det.label} mask → pins [${Array.from(pinsInPiece).join(',')}]`);
    }

    // Fallback: bbox-based matching
    if (pinsInPiece.size === 0) {
      const [x1, y1, x2, y2] = det.bbox;
      const margin = Math.max(x2 - x1, y2 - y1) * 0.1;
      for (let pin = 0; pin < NUM_PINS; pin++) {
        const [px, py] = pinPixels[pin];
        if (px >= x1 - margin && px <= x2 + margin &&
            py >= y1 - margin && py <= y2 + margin) {
          pinsInPiece.add(pin);
        }
      }
      console.log(`📦 ${det.label} bbox fallback → pins [${Array.from(pinsInPiece).join(',')}]`);
    }

    detectionPins.push({ detection: det, pins: pinsInPiece });
  }

  // Match each detection to the best valid placement
  const board = new BoardState();
  const mappings: PieceMapping[] = [];
  const usedPieces = new Set<number>();

  for (const { detection, pins: detPins } of detectionPins) {
    const pieceIndex = labelToIndex.get(detection.label);
    if (pieceIndex === undefined || usedPieces.has(pieceIndex)) {
      mappings.push({
        detection,
        placement: null,
        pinIndices: Array.from(detPins),
        confidence: detection.confidence,
      });
      continue;
    }

    // Find the best placement that overlaps with detected pins
    const placements = ALL_PLACEMENTS[pieceIndex];
    let bestPlacement: Placement | null = null;
    let bestScore = -1;

    for (const placement of placements) {
      if (!board.areFree(placement.positions)) continue;

      const placementPins = getPlacementPins(placement);

      // Score: Jaccard-like overlap between detected pins and placement pins
      let intersection = 0;
      for (const pin of placementPins) {
        if (detPins.has(pin)) intersection++;
      }

      // Union = |detPins| + |placementPins| - |intersection|
      const union = detPins.size + placementPins.size - intersection;
      const score = union > 0 ? intersection / union : 0;

      if (score > bestScore) {
        bestScore = score;
        bestPlacement = placement;
      }
    }

    if (bestPlacement && bestScore > 0.15) {
      board.place(bestPlacement.positions, pieceIndex);
      usedPieces.add(pieceIndex);

      const matchedPins = Array.from(getPlacementPins(bestPlacement));
      mappings.push({
        detection,
        placement: bestPlacement,
        pinIndices: matchedPins,
        confidence: detection.confidence,
      });
      console.log(
        `✅ ${detection.label} → pins [${matchedPins.join(',')}] (Jaccard: ${bestScore.toFixed(2)})`
      );
    } else {
      // Fallback: nearest pin, single segment
      const cx = (detection.bbox[0] + detection.bbox[2]) / 2;
      const cy = (detection.bbox[1] + detection.bbox[3]) / 2;
      let nearestPin = 0;
      let nearestDist = Infinity;
      for (let pin = 0; pin < NUM_PINS; pin++) {
        const [px, py] = pinPixels[pin];
        const dist = Math.sqrt((cx - px) ** 2 + (cy - py) ** 2);
        if (dist < nearestDist) {
          nearestDist = dist;
          nearestPin = pin;
        }
      }

      const cells = [...POSITIONS_AROUND_PINS[nearestPin]];
      if (board.areFree(cells)) {
        board.place(cells, pieceIndex);
        usedPieces.add(pieceIndex);
      }

      mappings.push({
        detection,
        placement: null,
        pinIndices: [nearestPin],
        confidence: detection.confidence,
      });
      console.log(`⚠️ ${detection.label} → fallback pin ${nearestPin}`);
    }
  }

  return { mappings, boardState: board };
}
