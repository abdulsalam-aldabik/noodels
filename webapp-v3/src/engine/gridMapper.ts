/**
 * Maps YOLO detections to board placements using centroid-distance matching.
 */

import { BoardState, PIN_COORDINATES, POSITION_TO_PIN, POSITIONS_AROUND_PINS } from '../board/board';
import { PIECE_LABELS, PIECE_CLASS_COUNT } from '../constants';
import { ALL_PLACEMENTS } from '../board/placements';
import { applyHomography } from '../math/homography';
import type { Detection, Placement, PieceMapping, CalibrationResult } from '../types';

const MAX_MATCH_DISTANCE = 2.5;

function computeMaskCentroid(mask: ImageData): [number, number] | null {
  let sumX = 0, sumY = 0, count = 0;
  const { width, height, data } = mask;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 50) {
        sumX += x; sumY += y; count++;
      }
    }
  }
  return count > 0 ? [sumX / count, sumY / count] : null;
}

function linearPixelToBoard(
  px: number, py: number,
  bounds: { minX: number; minY: number; width: number; height: number },
): [number, number] {
  return [
    -7.9 + ((px - bounds.minX) / bounds.width) * 15.8,
    -7.9 + ((py - bounds.minY) / bounds.height) * 15.8,
  ];
}

function computePlacementCentroid(placement: Placement): [number, number] {
  const pins = new Set<number>();
  for (const pos of placement.positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0) pins.add(pin);
  }
  if (pins.size === 0) return [0, 0];
  let sumX = 0, sumY = 0;
  for (const pin of pins) {
    sumX += PIN_COORDINATES[pin][0];
    sumY += PIN_COORDINATES[pin][1];
  }
  return [sumX / pins.size, sumY / pins.size];
}

function getPlacementPins(placement: Placement): number[] {
  const pins = new Set<number>();
  for (const pos of placement.positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0) pins.add(pin);
  }
  return Array.from(pins);
}

function estimateBoardBounds(detections: Detection[]) {
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
    minX: minX - bw * pad, minY: minY - bh * pad,
    width: bw * (1 + 2 * pad), height: bh * (1 + 2 * pad),
  };
}

export function mapDetectionsToBoard(
  detections: Detection[],
  calibration?: CalibrationResult | null,
): { mappings: PieceMapping[]; boardState: BoardState } {
  // Filter to piece detections only (classes 0-10)
  const pieceDetections = detections.filter(d => d.classId < PIECE_CLASS_COUNT);

  if (pieceDetections.length === 0) {
    return { mappings: [], boardState: new BoardState() };
  }

  // Resolve coordinate transform
  let toBoard: (px: number, py: number) => [number, number];
  if (calibration) {
    toBoard = (px, py) => applyHomography(calibration.H, px, py);
  } else {
    const bounds = estimateBoardBounds(pieceDetections);
    toBoard = (px, py) => linearPixelToBoard(px, py, bounds);
  }

  const labelToIndex = new Map<string, number>();
  PIECE_LABELS.forEach((label, idx) => labelToIndex.set(label, idx));

  const sorted = [...pieceDetections].sort((a, b) => b.confidence - a.confidence);
  const board = new BoardState();
  const mappings: PieceMapping[] = [];
  const usedPieces = new Set<number>();

  for (const det of sorted) {
    const pieceIndex = labelToIndex.get(det.label);
    if (pieceIndex === undefined || usedPieces.has(pieceIndex)) {
      mappings.push({ detection: det, placement: null, pinIndices: [], confidence: det.confidence });
      continue;
    }

    // Get detection centroid
    let pixelCentroid: [number, number] | null = null;
    if (det.mask) pixelCentroid = computeMaskCentroid(det.mask);
    if (!pixelCentroid) {
      pixelCentroid = [(det.bbox[0] + det.bbox[2]) / 2, (det.bbox[1] + det.bbox[3]) / 2];
    }

    const [bcx, bcy] = toBoard(pixelCentroid[0], pixelCentroid[1]);

    // Find nearest valid unoccupied placement
    const placements = ALL_PLACEMENTS[pieceIndex];
    let bestPlacement: Placement | null = null;
    let bestDist = Infinity;

    for (const placement of placements) {
      if (!board.areFree(placement.positions)) continue;
      const [pcx, pcy] = computePlacementCentroid(placement);
      const dist = Math.sqrt((bcx - pcx) ** 2 + (bcy - pcy) ** 2);
      if (dist < bestDist) { bestDist = dist; bestPlacement = placement; }
    }

    if (bestPlacement && bestDist <= MAX_MATCH_DISTANCE) {
      board.place(bestPlacement.positions, pieceIndex);
      usedPieces.add(pieceIndex);
      mappings.push({
        detection: det,
        placement: bestPlacement,
        pinIndices: getPlacementPins(bestPlacement),
        confidence: det.confidence,
        distanceBoardUnits: bestDist,
      });
    } else {
      // Fallback: nearest single pin
      let nearestPin = 0;
      let nearestPinDist = Infinity;
      for (let pin = 0; pin < PIN_COORDINATES.length; pin++) {
        const d = Math.sqrt((bcx - PIN_COORDINATES[pin][0]) ** 2 + (bcy - PIN_COORDINATES[pin][1]) ** 2);
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
    }
  }

  return { mappings, boardState: board };
}
