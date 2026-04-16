import { generatePlacementsForPiece } from "../engine/placements";
import type { PieceOrientation } from "./types";

const BOARD_WIDTH = 14;
const DEFAULT_TOP_K = 3;
const DEFAULT_AMBIGUITY_DELTA = 0.08;

const ORIENTATION_BY_ROTATION_STEP: readonly PieceOrientation[] = [0, 90, 180, 270];

export interface BoardCell {
  row: number;
  col: number;
}

interface OrientationTemplateInternal {
  orientationIndex: number;
  orientation: PieceOrientation;
  mirrored: boolean;
  cells: BoardCell[];
  signature: string;
  cellKeySet: Set<string>;
}

export interface OrientationTemplate {
  orientationIndex: number;
  orientation: PieceOrientation;
  mirrored: boolean;
  cells: BoardCell[];
  signature: string;
}

export interface OrientationCandidateScore {
  orientation: PieceOrientation;
  mirrored: boolean;
  score: number;
  orientationIndex: number;
}

export interface OrientationMatchInput {
  pieceId: number;
  observedCells: BoardCell[];
  topK?: number;
  ambiguityDelta?: number;
}

export interface OrientationMatchResult {
  orientation: PieceOrientation;
  mirrored: boolean;
  confidence: number;
  ambiguous: boolean;
  topK: OrientationCandidateScore[];
}

const templateCache = new Map<number, OrientationTemplateInternal[]>();

function rotationStepToOrientation(step: number | undefined): PieceOrientation {
  const normalized = ((step ?? 0) % 4 + 4) % 4;
  return ORIENTATION_BY_ROTATION_STEP[normalized] as PieceOrientation;
}

function cellKey(cell: BoardCell): string {
  return `${cell.row},${cell.col}`;
}

function normalizeCells(cells: BoardCell[]): BoardCell[] {
  if (cells.length === 0) return [];

  const unique = new Map<string, BoardCell>();
  for (const cell of cells) {
    unique.set(cellKey(cell), cell);
  }
  const deduped = [...unique.values()];

  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  for (const cell of deduped) {
    if (cell.row < minRow) minRow = cell.row;
    if (cell.col < minCol) minCol = cell.col;
  }

  return deduped
    .map((cell) => ({ row: cell.row - minRow, col: cell.col - minCol }))
    .sort((a, b) => (a.row - b.row) || (a.col - b.col));
}

function jaccardScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;

  let intersection = 0;
  for (const key of a) {
    if (b.has(key)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function positionToCell(position: number): BoardCell {
  return {
    row: Math.floor(position / BOARD_WIDTH),
    col: position % BOARD_WIDTH,
  };
}

function buildTemplates(pieceId: number): OrientationTemplateInternal[] {
  const placements = generatePlacementsForPiece(pieceId);
  const byOrientation = new Map<number, OrientationTemplateInternal>();

  for (const placement of placements) {
    if (byOrientation.has(placement.orientationIndex)) continue;

    const normalizedCells = normalizeCells(
      placement.positions.map((position) => positionToCell(position)),
    );
    const signature = normalizedCells.map((cell) => cellKey(cell)).join("|");

    byOrientation.set(placement.orientationIndex, {
      orientationIndex: placement.orientationIndex,
      orientation: rotationStepToOrientation(placement.rotationSteps),
      mirrored: Boolean(placement.mirrored),
      cells: normalizedCells,
      signature,
      cellKeySet: new Set(normalizedCells.map((cell) => cellKey(cell))),
    });
  }

  return [...byOrientation.values()].sort(
    (a, b) => a.orientationIndex - b.orientationIndex,
  );
}

function getTemplateCache(pieceId: number): OrientationTemplateInternal[] {
  const cached = templateCache.get(pieceId);
  if (cached) return cached;

  let built: OrientationTemplateInternal[] = [];
  try {
    built = buildTemplates(pieceId);
  } catch {
    built = [];
  }
  templateCache.set(pieceId, built);
  return built;
}

export function getOrientationTemplates(pieceId: number): OrientationTemplate[] {
  return getTemplateCache(pieceId).map((template) => ({
    orientationIndex: template.orientationIndex,
    orientation: template.orientation,
    mirrored: template.mirrored,
    cells: template.cells,
    signature: template.signature,
  }));
}

function compareCandidates(
  a: OrientationCandidateScore,
  b: OrientationCandidateScore,
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.mirrored !== b.mirrored) return Number(a.mirrored) - Number(b.mirrored);
  if (a.orientation !== b.orientation) return a.orientation - b.orientation;
  return a.orientationIndex - b.orientationIndex;
}

export function matchPieceOrientation(
  input: OrientationMatchInput,
): OrientationMatchResult {
  const templates = getTemplateCache(input.pieceId);
  const requestedTopK = Math.max(1, Math.floor(input.topK ?? DEFAULT_TOP_K));
  const ambiguityDelta = input.ambiguityDelta ?? DEFAULT_AMBIGUITY_DELTA;

  if (templates.length === 0 || input.observedCells.length === 0) {
    return {
      orientation: 0,
      mirrored: false,
      confidence: 0,
      ambiguous: true,
      topK: [],
    };
  }

  const observedSet = new Set(
    normalizeCells(input.observedCells).map((cell) => cellKey(cell)),
  );

  const scored = templates
    .map<OrientationCandidateScore>((template) => ({
      orientation: template.orientation,
      mirrored: template.mirrored,
      score: jaccardScore(observedSet, template.cellKeySet),
      orientationIndex: template.orientationIndex,
    }))
    .sort(compareCandidates);

  const topK = scored.slice(0, requestedTopK);
  const best = topK[0];
  if (!best) {
    return {
      orientation: 0,
      mirrored: false,
      confidence: 0,
      ambiguous: true,
      topK: [],
    };
  }

  const margin =
    topK.length > 1 ? Math.max(0, topK[0].score - topK[1].score) : 1;

  return {
    orientation: best.orientation,
    mirrored: best.mirrored,
    confidence: best.score,
    ambiguous: topK.length > 1 && margin < ambiguityDelta,
    topK,
  };
}
