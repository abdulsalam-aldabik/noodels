import type { InferenceResult } from "../inference/types";
import type { BoardRef, BoardState, RectifiedFrame } from "../vision/types";

export const TELEMETRY_SCHEMA_VERSION = 1;

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
  };
  rectification: {
    canvasSize: { width: number; height: number };
    cellSpacingPx: number;
    expectedCellSpacingPx: number;
    homographyCondition: number;
  };
  mapping: {
    mapperVersion: "v1" | "v2";
    pieces: Array<{
      classId: number;
      className: string;
      cell: { row: number; col: number };
      orientation: number;
      mirrored: boolean;
      confidence: number;
      ambiguous: boolean;
    }>;
    unassigned: number;
  };
  status: ScanStatus;
  message?: string;
}

export interface DebugArtifactBlobs {
  raw?: Blob;
  yolo?: Blob;
  corners?: Blob;
  rectified?: Blob;
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
