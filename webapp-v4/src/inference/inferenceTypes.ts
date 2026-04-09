// ── Model output format (YOLOv8/v11-seg) ─────────────────────────────────────
// output0: Float32[1, 4 + NUM_CLASSES + NUM_MASK_COEFFS, NUM_ANCHORS]
//   Each anchor: [cx, cy, w, h, class0_score…class12_score, coeff0…coeff31]
//   No separate objectness score — class scores are direct.
// output1: Float32[1, NUM_MASK_COEFFS, MASK_H, MASK_W]
//   Prototype masks to be linearly combined via anchor coefficients.

export const MODEL_INPUT_SIZE = 640;
export const NUM_CLASSES = 13;
export const NUM_MASK_COEFFS = 32;
export const MASK_SIZE = 160;           // proto mask spatial dimension
export const NUM_ANCHORS = 8400;        // 80²+40²+20² feature map cells at 640px input

// Class index constants
export const CLASS_PIECE_FIRST = 0;     // pieces A–K are classes 0–10
export const CLASS_PIECE_LAST = 10;
export const CLASS_BOARD = 11;
export const CLASS_HINGE = 12;

// Filtering thresholds
export const CONFIDENCE_GATE = 0.2;            // minimum class score to keep a detection
export const NMS_IOU_THRESHOLD = 0.45;         // IoU above which boxes are suppressed
export const CELL_AMBIGUITY_RATIO = 1.2;       // 2nd-nearest / nearest distance ratio
export const MAX_CELL_RADIUS = 0.7;            // board-grid units; centroid this far from a cell = drop
export const MIN_CELL_CONFIDENCE = 0.4;        // drop piece if cell confidence is below this
export const INFERENCE_TIMEOUT_MS = 8000;

/** One decoded detection from the model after NMS. */
export interface RawDetection {
  classId: number;
  confidence: number;
  /** Bounding box in original image pixels [x1, y1, x2, y2]. */
  bbox: [number, number, number, number];
  /** Contour points in original image pixels, derived from the decoded mask. */
  maskPolygon: [number, number][];
  /** Centroid of the mask polygon in original image pixels. */
  maskCentroid: [number, number];
}

/** Letterbox parameters saved during preprocessing — needed to undo padding when
 *  mapping mask coordinates back to the original image space. */
export interface LetterboxParams {
  /** Scale factor applied to the original image. */
  scale: number;
  /** Left padding in pixels (within the 640×640 canvas). */
  padX: number;
  /** Top padding in pixels (within the 640×640 canvas). */
  padY: number;
  /** Original image width in pixels. */
  origW: number;
  /** Original image height in pixels. */
  origH: number;
}
