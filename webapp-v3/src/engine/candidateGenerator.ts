import { ALL_PLACEMENTS } from '../board/placements';
import { GRID_WIDTH, MISSING_POSITIONS, POSITION_TO_PIN } from '../board/board';
import { PIECE_CLASS_COUNT } from '../constants';
import { applyHomography } from '../math/homography';
import { DEFAULT_ASSIGNMENT_CONFIG } from './mappingConfig';
import type {
  AssignmentConfig,
  CalibrationResult,
  Detection,
  DetectionCandidateSet,
  Placement,
  PlacementCandidate,
} from '../types';

const BOARD_MIN = -7.9;
const BOARD_SPAN = 15.8;
const CELL_SIZE = BOARD_SPAN / GRID_WIDTH;

function linearPixelToBoard(
  px: number,
  py: number,
  bounds: { minX: number; minY: number; width: number; height: number },
): [number, number] {
  return [
    -7.9 + ((px - bounds.minX) / bounds.width) * 15.8,
    -7.9 + ((py - bounds.minY) / bounds.height) * 15.8,
  ];
}

function estimateBoardBounds(detections: Detection[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

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
    width: bw * (1 + 2 * pad),
    height: bh * (1 + 2 * pad),
  };
}

function boardPointToCellIndex(bx: number, by: number): number | null {
  const col = Math.floor((bx - BOARD_MIN) / CELL_SIZE);
  const row = Math.floor((by - BOARD_MIN) / CELL_SIZE);
  if (row < 0 || row >= GRID_WIDTH || col < 0 || col >= GRID_WIDTH) return null;
  return row * GRID_WIDTH + col;
}

function indexToRowCol(index: number): [number, number] {
  return [Math.floor(index / GRID_WIDTH), index % GRID_WIDTH];
}

function similarityByDelta(a: number, b: number): number {
  if (a <= 0 && b <= 0) return 1;
  const denom = Math.max(a, b, 1);
  return Math.max(0, 1 - Math.abs(a - b) / denom);
}

function collectPinCount(positions: Iterable<number>): number {
  const pins = new Set<number>();
  for (const pos of positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0) pins.add(pin);
  }
  return pins.size;
}

function summarizeCells(cells: Set<number>): {
  cellCount: number;
  rowSpan: number;
  colSpan: number;
  pinCount: number;
} {
  let minRow = Infinity;
  let maxRow = -Infinity;
  let minCol = Infinity;
  let maxCol = -Infinity;

  for (const index of cells) {
    const [row, col] = indexToRowCol(index);
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
  }

  return {
    cellCount: cells.size,
    rowSpan: cells.size > 0 ? maxRow - minRow + 1 : 0,
    colSpan: cells.size > 0 ? maxCol - minCol + 1 : 0,
    pinCount: collectPinCount(cells),
  };
}

function buildDetectionOccupancy(
  detection: Detection,
  toBoard: (px: number, py: number) => [number, number],
): {
  activeCells: Set<number>;
  invalidCellRatio: number;
} {
  const occupancy = new Uint16Array(GRID_WIDTH * GRID_WIDTH);
  let validHits = 0;
  let invalidHits = 0;

  if (detection.mask) {
    const { width, height, data } = detection.mask;

    // Use stride=2 to balance stability and performance for large masks.
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 2) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha <= 60) continue;

        const [bx, by] = toBoard(x + 0.5, y + 0.5);
        const cellIndex = boardPointToCellIndex(bx, by);
        if (cellIndex === null || MISSING_POSITIONS.has(cellIndex)) {
          invalidHits++;
          continue;
        }

        occupancy[cellIndex] += 1;
        validHits++;
      }
    }
  }

  // Fallback when mask is missing/weak: seed occupancy with bbox center.
  if (validHits === 0) {
    const px = (detection.bbox[0] + detection.bbox[2]) / 2;
    const py = (detection.bbox[1] + detection.bbox[3]) / 2;
    const [bx, by] = toBoard(px, py);
    const cellIndex = boardPointToCellIndex(bx, by);
    if (cellIndex !== null && !MISSING_POSITIONS.has(cellIndex)) {
      occupancy[cellIndex] = 1;
      validHits = 1;
    }
  }

  const activeCells = new Set<number>();
  let maxCellHits = 0;
  for (const hits of occupancy) {
    if (hits > maxCellHits) maxCellHits = hits;
  }

  const minActivation = Math.max(1, Math.floor(maxCellHits * 0.3));
  for (let i = 0; i < occupancy.length; i++) {
    if (occupancy[i] >= minActivation) activeCells.add(i);
  }

  const totalHits = validHits + invalidHits;
  const invalidCellRatio = totalHits > 0 ? invalidHits / totalHits : 1;
  return { activeCells, invalidCellRatio };
}

function getPlacementPins(placement: Placement): number[] {
  const pins = new Set<number>();
  for (const pos of placement.positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0) pins.add(pin);
  }
  return Array.from(pins);
}

function buildToBoardTransform(
  pieceDetections: Detection[],
  calibration?: CalibrationResult | null,
): (px: number, py: number) => [number, number] {
  if (calibration) {
    return (px, py) => applyHomography(calibration.H, px, py);
  }

  const bounds = estimateBoardBounds(pieceDetections);
  return (px, py) => linearPixelToBoard(px, py, bounds);
}

export function generateDetectionCandidates(
  detections: Detection[],
  calibration?: CalibrationResult | null,
  config: AssignmentConfig = DEFAULT_ASSIGNMENT_CONFIG,
): DetectionCandidateSet[] {
  const pieceDetections = detections
    .map((detection, detectionIndex) => ({ detection, detectionIndex }))
    .filter(({ detection }) => detection.classId < PIECE_CLASS_COUNT);

  if (pieceDetections.length === 0) return [];

  const toBoard = buildToBoardTransform(pieceDetections.map(x => x.detection), calibration);

  const candidateSets: DetectionCandidateSet[] = [];

  for (const { detection, detectionIndex } of pieceDetections) {
    const pieceIndex = detection.classId;
    const { activeCells, invalidCellRatio } = buildDetectionOccupancy(detection, toBoard);
    if (activeCells.size === 0) continue;

    const detectionShape = summarizeCells(activeCells);

    const candidates: PlacementCandidate[] = [];

    for (const placement of ALL_PLACEMENTS[pieceIndex]) {
      const placementCells = new Set<number>(placement.positions);
      const placementShape = summarizeCells(placementCells);

      let intersection = 0;
      for (const pos of placement.positions) {
        if (activeCells.has(pos)) intersection++;
      }

      const union = activeCells.size + placement.positions.length - intersection;
      const iou = union > 0 ? intersection / union : 0;
      if (iou < config.minTemplateIoU) continue;

      const precision = activeCells.size > 0 ? intersection / activeCells.size : 0;
      const recall = intersection / placement.positions.length;
      if (recall < config.minPlacementRecall) continue;

      const sizeFit = similarityByDelta(detectionShape.cellCount, placementShape.cellCount);
      const spanFitRow = similarityByDelta(detectionShape.rowSpan, placementShape.rowSpan);
      const spanFitCol = similarityByDelta(detectionShape.colSpan, placementShape.colSpan);
      const spanFit = (spanFitRow + spanFitCol) / 2;
      const pinCountFit = similarityByDelta(detectionShape.pinCount, placementShape.pinCount);

      // Distance surrogate derived from overlap quality; 0 means perfect template fit.
      const distance = 1 - (iou * 0.6 + spanFit * 0.25 + sizeFit * 0.15);

      const score =
        detection.confidence * config.confidenceWeight +
        iou * config.iouWeight +
        precision * config.precisionWeight +
        recall * config.recallWeight -
        distance * config.distanceWeight +
        sizeFit * config.sizeWeight +
        spanFit * config.spanWeight +
        pinCountFit * config.pinCountWeight -
        invalidCellRatio * config.invalidCellPenalty;

      candidates.push({
        placement,
        pinIndices: getPlacementPins(placement),
        score,
        distanceBoardUnits: distance,
        iou,
        precision,
        recall,
        sizeFit,
        spanFit,
        pinCountFit,
        activeCellCount: detectionShape.cellCount,
        placementCellCount: placementShape.cellCount,
        invalidCellRatio,
      });
    }

    candidates.sort((a, b) => b.score - a.score || a.distanceBoardUnits - b.distanceBoardUnits);

    candidateSets.push({
      detection,
      detectionIndex,
      pieceIndex,
      candidates: candidates.slice(0, config.topKCandidates),
    });
  }

  return candidateSets;
}
