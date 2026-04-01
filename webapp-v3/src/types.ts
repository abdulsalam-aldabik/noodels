import type { BoardState } from './board/board';

/** Segment types for noodle pieces */
export const CURVE = 0;
export const CROSS_NS = 1;
export const CROSS_EW = 2;
export type SegmentType = typeof CURVE | typeof CROSS_NS | typeof CROSS_EW;

/** A single detection from YOLO inference */
export interface Detection {
  classId: number;
  label: string;
  confidence: number;
  bbox: [number, number, number, number];
  maskCoeffs: Float32Array | null;
  mask: ImageData | null;
  rgb: [number, number, number];
}

/** Result from running inference */
export interface InferenceResult {
  detections: Detection[];
  inferenceTimeMs: number;
  preprocessTimeMs: number;
  postprocessTimeMs: number;
  originalSize: { width: number; height: number };
}

/** Model loading state */
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Auto-calibration result */
export interface CalibrationResult {
  H: number[];
  boardCorners: [number, number][];
  confidence: number;
}

/** A valid placement of a piece on the board */
export interface Placement {
  pieceIndex: number;
  positions: number[];
  shapes: SegmentType[];
}

/** Detection-to-board mapping result */
export interface PieceMapping {
  detection: Detection;
  placement: Placement | null;
  pinIndices: number[];
  confidence: number;
  distanceBoardUnits?: number;
}

export type MappingMode = 'legacy' | 'global';

export interface PlacementCandidate {
  placement: Placement;
  pinIndices: number[];
  score: number;
  distanceBoardUnits: number;
  iou: number;
  precision: number;
  recall: number;
  sizeFit: number;
  spanFit: number;
  pinCountFit: number;
  activeCellCount: number;
  placementCellCount: number;
  invalidCellRatio: number;
}

export interface DetectionCandidateSet {
  detectionIndex: number;
  detection: Detection;
  pieceIndex: number;
  candidates: PlacementCandidate[];
}

export interface AssignmentConfig {
  mode: MappingMode;
  topKCandidates: number;
  maxCandidateDistance: number;
  minTemplateIoU: number;
  minPlacementRecall: number;
  confidenceWeight: number;
  iouWeight: number;
  precisionWeight: number;
  recallWeight: number;
  sizeWeight: number;
  spanWeight: number;
  pinCountWeight: number;
  distanceWeight: number;
  invalidCellPenalty: number;
  enableOpenSpacePruning: boolean;
  timeoutMs: number;
  uncertainScoreThreshold: number;
  uncertainDistanceThreshold: number;
  unmatchedPenalty: number;
  requireManualForUncertain: boolean;
}

export interface PieceAssignmentSummary {
  pieceIndex: number;
  pieceLabel: string;
  candidateCount: number;
  topScore: number;
  topIou: number;
  topRecall: number;
  topSpanFit: number;
  selectedScore: number | null;
  selectedRecall: number | null;
  selectedUncertain: boolean;
}

export interface AssignmentDiagnostics {
  mode: MappingMode;
  elapsedMs: number;
  statesExplored: number;
  branchesPrunedNoFit: number;
  branchesPrunedOpenSpace: number;
  timedOut: boolean;
  usedFallback: boolean;
  uncertainCount: number;
  pieceSummaries: PieceAssignmentSummary[];
  reason?: string;
}

export interface UncertainMatch {
  detectionIndex: number;
  pieceIndex: number;
  score: number;
  distanceBoardUnits: number;
}

export interface MappingResult {
  mappings: PieceMapping[];
  boardState: BoardState;
  diagnostics: AssignmentDiagnostics;
  pendingUncertainMappings: PieceMapping[] | null;
}

/** Solver result */
export interface SolverResult {
  solved: boolean;
  solution: (Placement | null)[];
  timeMs: number;
  statesExplored: number;
  timedOut: boolean;
}

/** Application phase */
export type Phase = 'capture' | 'processing' | 'results' | 'solved';
