/**
 * Core types for the IQ Noodles piece detection system.
 */

/** A single detected piece from YOLO inference */
export interface Detection {
  /** Class index (0-10) */
  classId: number;
  /** Piece label (A-K) */
  label: string;
  /** Human-readable color name */
  colorName: string;
  /** RGB color tuple */
  rgb: [number, number, number];
  /** Confidence score (0-1) */
  confidence: number;
  /** Bounding box [x1, y1, x2, y2] in original image coords */
  bbox: [number, number, number, number];
  /** Segmentation mask as ImageData (original image size) */
  mask: ImageData | null;
}

/** Result from running inference on a single image */
export interface InferenceResult {
  /** All detected pieces */
  detections: Detection[];
  /** Inference time in milliseconds */
  inferenceTimeMs: number;
  /** Preprocessing time in milliseconds */
  preprocessTimeMs: number;
  /** Postprocessing time in milliseconds */
  postprocessTimeMs: number;
  /** Original image dimensions */
  originalSize: { width: number; height: number };
}

/** Model loading state */
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Application view state */
export type AppView = 'home' | 'capture' | 'results';
