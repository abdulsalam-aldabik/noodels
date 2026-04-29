export interface ImageSize {
  width: number;
  height: number;
}

export interface Point2D {
  x: number;
  y: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectionMask {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface RawDetection {
  classId: number;
  className: string;
  score: number;
  bbox: BoundingBox;
  mask?: DetectionMask;
  polygon?: Point2D[];
}

export interface InferenceResult {
  modelPath: string;
  imageSize: ImageSize;
  detections: RawDetection[];
  durationMs: number;
}

export const PIECE_CLASS_COUNT = 11;
export const BOARD_CLASS_ID = 11;
export const HINGE_CLASS_ID = 12;
export const PIN_CLASS_ID = 13;

export const CLASS_NAMES: readonly string[] = [
  "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K",
  "board", "hinge", "pin",
] as const;
