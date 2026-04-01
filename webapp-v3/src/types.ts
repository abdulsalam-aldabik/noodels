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
