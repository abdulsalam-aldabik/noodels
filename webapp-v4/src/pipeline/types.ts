import type { InferenceResult } from "../inference/types";
import type {
  BoardRef,
  BoardState,
  PinLocalizationStatus,
  RectifiedFrame,
} from "../vision/types";

export const TELEMETRY_SCHEMA_VERSION = 2;

export type LocalizationVersion = "corners" | "pins";

export type ScanStatus = "ok" | "lowConfidence" | "failed";

export interface ScanTelemetry {
  schemaVersion: number;
  timestamp: string;
  imageSize: { width: number; height: number };
  inference: {
    modelPath: string;
    durationMs: number;
    numDetections: number;
    classHistogram: Record<string, number>;
  };
  localization: {
    status: string;
    cornerSource: string;
    cornerScore: number;
    hingeFound: boolean;
    candidates: Array<{ source: string; score: number }>;
    corners: Array<{ x: number; y: number }>;
    version: LocalizationVersion;
    pin?: {
      status: PinLocalizationStatus;
      message?: string;
      detectedPinCount: number;
      matchedPinCount: number;
      residualMaxCells: number;
      residualMeanCells: number;
    };
  };
  rectification: {
    canvasSize: { width: number; height: number };
    cellSpacingPx: number;
    expectedCellSpacingPx: number;
    homographyCondition: number;
  };
  mapping: {
    mapperVersion: "v4";
    pieces: Array<{
      classId: number;
      className: string;
      cell: { row: number; col: number };
      orientation: number;
      mirrored: boolean;
      confidence: number;
      ambiguous: boolean;
      source?: "yolo-mask" | "color-rescue";
    }>;
    unassigned: number;
    maskCount: number;
    colorRescueCount: number;
    droppedColorClassIds: number[];
  };
  status: ScanStatus;
  message?: string;
}

export interface DebugArtifactBlobs {
  raw?: Blob;
  yolo?: Blob;
  corners?: Blob;
  rectified?: Blob;
  detectionsOnRectified?: Blob;
  colorClassification?: Blob;
  mapped?: Blob;
  report: string; // JSON string
}

export interface ScanResult {
  status: ScanStatus;
  inference: InferenceResult;
  boardRef: BoardRef;
  rectified?: RectifiedFrame;
  boardState?: BoardState;
  telemetry: ScanTelemetry;
  artifacts: DebugArtifactBlobs;
}
