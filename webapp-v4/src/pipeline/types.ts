import type { InferenceResult } from "../inference/types";
import type {
  BoardRef,
  BoardState,
  PinLocalizationStatus,
  RectifiedFrame,
} from "../vision/types";

export const TELEMETRY_SCHEMA_VERSION = 3;

export type LocalizationVersion = "corners" | "pins";

export type ScanStatus = "ok" | "lowConfidence" | "failed" | "rejected_condition" | "rejected_residual";

export type AmbiguityPlacementPolicy = "strict" | "lenient" | "off";

export type RetryReason =
  | "HOMOGRAPHY_UNSTABLE"
  | "GRID_MISALIGNED"
  | "TOO_FEW_PLACED"
  | "HIGH_AMBIGUITY";

export interface RetryInfo {
  retryTriggered: boolean;
  retryReason?: RetryReason;
  message?: string;
  lowConfidence: boolean;
}

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
    /** NEW (Task 2): maximum grid-fit residual across all pin correspondences. */
    gridFitResidualMax?: number;
    /** NEW (Task 2): mean grid-fit residual across all pin correspondences. */
    gridFitResidualMean?: number;
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
    /** NEW (Task 3): true if the condition number passed the quality gate. */
    homographyGatePassed: boolean;
  };
  mapping: {
    mapperVersion: "v4";
    /** NEW (Task 5): which ambiguity policy was in effect. */
    placementPolicy: AmbiguityPlacementPolicy;
    /** NEW (Task 4A): how many duplicate color-rescue assignments were dropped. */
    droppedDuplicateCount: number;
    pieces: Array<{
      classId: number;
      className: string;
      cell: { row: number; col: number };
      orientation: number;
      mirrored: boolean;
      confidence: number;
      ambiguous: boolean;
      source?: "yolo-mask" | "color-rescue";
      /** NEW (Task 5): true when placed despite being ambiguous (lenient/off policy). */
      placedDespiteAmbiguity?: boolean;
      /** NEW (Task 5): reason a piece was not placed (only when unassigned). */
      unassignedReason?: "ambiguous" | "duplicate" | "low_confidence";
    }>;
    unassigned: number;
    maskCount: number;
    colorRescueCount: number;
    droppedColorClassIds: number[];
  };
  /** NEW (Task 6): UI retry information. */
  ui?: {
    retryTriggered: boolean;
    retryReason?: RetryReason;
    lowConfidence: boolean;
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
  /** NEW (Task 6): retry information for the UI layer. */
  retryInfo?: RetryInfo;
}
