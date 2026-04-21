import { snapToCell } from "../board/gridGeometry";
import {
  BOARD_CLASS_ID,
  CLASS_NAMES,
  HINGE_CLASS_ID,
  PIN_CLASS_ID,
  type RawDetection,
} from "../inference/types";
import { PIECE_ASSETS, type PieceKey } from "../pieces/assets";
import { applyHomography } from "./Rectifier";
import {
  matchPieceOrientation,
  type BoardCell,
  type OrientationMatchInput,
  type OrientationMatchResult,
} from "./OrientationMatcher";
import type { BoardState, PiecePlacement, RectifiedFrame } from "./types";

const PIECE_KEYS: readonly PieceKey[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
];

const PIECE_KEY_SET = new Set<PieceKey>(PIECE_KEYS);

const PIECE_ID_BY_KEY = PIECE_ASSETS.reduce<Record<PieceKey, number>>(
  (acc, asset) => {
    acc[asset.key] = asset.pieceId;
    return acc;
  },
  {} as Record<PieceKey, number>,
);

export interface PieceMapperOptions {
  topK?: number;
  ambiguityDelta?: number;
  orientationMatcher?: (input: OrientationMatchInput) => OrientationMatchResult;
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function imagePointToBoardCell(
  imageX: number,
  imageY: number,
  homographyForward: number[],
): BoardCell {
  const boardPoint = applyHomography(homographyForward, imageX, imageY);
  const snapped = snapToCell(boardPoint.x, boardPoint.y);
  return { row: snapped.row, col: snapped.col };
}

function centroidFromMask(detection: RawDetection): { x: number; y: number } | null {
  const mask = detection.mask;
  if (!mask || mask.width <= 0 || mask.height <= 0) return null;

  let sumX = 0;
  let sumY = 0;
  let count = 0;

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const value = mask.data[y * mask.width + x];
      if (!value) continue;
      sumX += x + 0.5;
      sumY += y + 0.5;
      count += 1;
    }
  }

  if (count === 0) return null;

  const normX = sumX / count / mask.width;
  const normY = sumY / count / mask.height;
  return {
    x: detection.bbox.x + normX * detection.bbox.width,
    y: detection.bbox.y + normY * detection.bbox.height,
  };
}

function detectionAnchorPoint(detection: RawDetection): { x: number; y: number } {
  const fromMask = centroidFromMask(detection);
  if (fromMask) return fromMask;
  return {
    x: detection.bbox.x + detection.bbox.width / 2,
    y: detection.bbox.y + detection.bbox.height / 2,
  };
}

function observedCellsFromMask(
  detection: RawDetection,
  homographyForward: number[],
): BoardCell[] {
  const mask = detection.mask;
  if (!mask || mask.width <= 0 || mask.height <= 0) return [];

  const keys = new Set<string>();
  const cells: BoardCell[] = [];

  for (let y = 0; y < mask.height; y++) {
    for (let x = 0; x < mask.width; x++) {
      const value = mask.data[y * mask.width + x];
      if (!value) continue;

      const imageX = detection.bbox.x + ((x + 0.5) / mask.width) * detection.bbox.width;
      const imageY = detection.bbox.y + ((y + 0.5) / mask.height) * detection.bbox.height;
      const cell = imagePointToBoardCell(imageX, imageY, homographyForward);
      const key = `${cell.row},${cell.col}`;

      if (keys.has(key)) continue;
      keys.add(key);
      cells.push(cell);
    }
  }

  return cells;
}

export function pieceKeyFromDetection(detection: RawDetection): PieceKey | null {
  if (PIECE_KEY_SET.has(detection.className as PieceKey)) {
    return detection.className as PieceKey;
  }

  if (detection.classId >= 0 && detection.classId < 11) {
    const className = CLASS_NAMES[detection.classId];
    if (className && PIECE_KEY_SET.has(className as PieceKey)) {
      return className as PieceKey;
    }
  }

  return null;
}

interface CandidatePlacement {
  pieceKey: PieceKey;
  placement: PiecePlacement;
  rawDetection: RawDetection;
}

export function mapPiecesToBoardState(
  detections: RawDetection[],
  rectified: RectifiedFrame,
  options: PieceMapperOptions = {},
): BoardState {
  const matchOrientation = options.orientationMatcher ?? matchPieceOrientation;

  const candidates: CandidatePlacement[] = [];
  const unassigned: RawDetection[] = [];

  for (let detectionIndex = 0; detectionIndex < detections.length; detectionIndex++) {
    const detection = detections[detectionIndex];

    if (detection.classId === BOARD_CLASS_ID || detection.classId === HINGE_CLASS_ID || detection.classId === PIN_CLASS_ID) {
      continue;
    }

    const pieceKey = pieceKeyFromDetection(detection);
    if (!pieceKey) {
      unassigned.push(detection);
      continue;
    }

    const pieceId = PIECE_ID_BY_KEY[pieceKey];
    if (pieceId === undefined) {
      unassigned.push(detection);
      continue;
    }

    const anchorPoint = detectionAnchorPoint(detection);
    const anchorCell = imagePointToBoardCell(
      anchorPoint.x,
      anchorPoint.y,
      rectified.homography.forward,
    );

    const observedCells = observedCellsFromMask(
      detection,
      rectified.homography.forward,
    );
    if (observedCells.length === 0) {
      observedCells.push(anchorCell);
    }

    const match = matchOrientation({
      pieceId,
      observedCells,
      topK: options.topK,
      ambiguityDelta: options.ambiguityDelta,
    });

    const placement: PiecePlacement = {
      classId: detection.classId,
      className: pieceKey,
      cell: anchorCell,
      orientation: match.orientation,
      mirrored: match.mirrored,
      confidence: clamp01(detection.score * match.confidence),
      ambiguous: match.ambiguous,
      topK: match.topK.map((candidate) => ({
        orientation: candidate.orientation,
        mirrored: candidate.mirrored,
        score: candidate.score,
      })),
      sourceDetectionIndex: detectionIndex,
    };

    candidates.push({
      pieceKey,
      placement,
      rawDetection: detection,
    });
  }

  // Keep the highest-confidence candidate per piece key.
  candidates.sort((a, b) => b.placement.confidence - a.placement.confidence);
  const placements: PiecePlacement[] = [];
  const usedPieceKeys = new Set<PieceKey>();
  for (const candidate of candidates) {
    if (usedPieceKeys.has(candidate.pieceKey)) {
      unassigned.push(candidate.rawDetection);
      continue;
    }
    usedPieceKeys.add(candidate.pieceKey);
    placements.push(candidate.placement);
  }

  return {
    placements,
    unassignedDetections: unassigned,
  };
}
