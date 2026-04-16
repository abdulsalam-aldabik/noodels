import { InferenceRunner } from "../inference/InferenceRunner";
import type { InferenceResult } from "../inference/types";
import { expectedCellSpacingPx } from "../board/gridGeometry";
import { locateBoard } from "../vision/BoardLocator";
import { mapPiecesToBoardState } from "../vision/PieceMapper";
import { mapPiecesToBoardStateV2 } from "../vision/PieceMapperV2";
import { rectify, DEFAULT_RECTIFIED_CANVAS } from "../vision/Rectifier";
import {
  classHistogram,
  renderCornersArtifact,
  renderMappedArtifact,
  renderRawArtifact,
  renderRectifiedArtifact,
  renderYoloArtifact,
} from "./DebugArtifacts";
import {
  TELEMETRY_SCHEMA_VERSION,
  type DebugArtifactBlobs,
  type ScanResult,
  type ScanStatus,
  type ScanTelemetry,
} from "./types";

export type MapperVersion = "v1" | "v2";

export interface ScanPipelineOptions {
  runner?: InferenceRunner;
  rectifiedCanvasSize?: number;
  emitArtifacts?: boolean;
  mapperVersion?: MapperVersion;
}

/**
 * Staged orchestrator: image -> inference -> localization -> rectification -> mapping -> artifacts.
 */
export class ScanPipeline {
  private readonly runner: InferenceRunner;
  private readonly canvasSize: number;
  private readonly emitArtifacts: boolean;
  private readonly mapperVersion: MapperVersion;

  constructor(options: ScanPipelineOptions = {}) {
    this.runner = options.runner ?? new InferenceRunner();
    this.canvasSize = options.rectifiedCanvasSize ?? DEFAULT_RECTIFIED_CANVAS;
    this.emitArtifacts = options.emitArtifacts ?? true;
    this.mapperVersion = options.mapperVersion ?? "v1";
  }

  async ensureLoaded(): Promise<void> {
    await this.runner.ensureLoaded();
  }

  async run(
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  ): Promise<ScanResult> {
    const inference: InferenceResult = await this.runner.run(image);
    const boardRef = locateBoard(inference.detections, inference.imageSize);

    let rectifiedFrame: ScanResult["rectified"];
    let boardState: ScanResult["boardState"];
    let rectifiedCanvas: HTMLCanvasElement | null = null;
    let status: ScanStatus = "ok";
    let message: string | undefined;

    if (boardRef.status === "failed") {
      status = "failed";
      message = boardRef.message ?? "board localization failed";
    } else {
      const { frame, canvas } = rectify(image, boardRef, {
        canvasSize: this.canvasSize,
      });
      rectifiedFrame = frame;
      rectifiedCanvas = canvas;
      boardState =
        this.mapperVersion === "v2"
          ? mapPiecesToBoardStateV2(inference.detections, frame)
          : mapPiecesToBoardState(inference.detections, frame);

      if (boardRef.status === "lowConfidence") {
        status = "lowConfidence";
        message = boardRef.message;
      }
    }

    const telemetry: ScanTelemetry = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      imageSize: inference.imageSize,
      inference: {
        modelPath: inference.modelPath,
        durationMs: inference.durationMs,
        numDetections: inference.detections.length,
        classHistogram: classHistogram(inference),
      },
      localization: {
        status: boardRef.status,
        cornerSource: boardRef.cornerSource,
        cornerScore: boardRef.cornerScore,
        hingeFound: boardRef.hingeFound,
        candidates: boardRef.candidates.map((candidate) => ({
          source: candidate.source,
          score: candidate.score,
        })),
        corners: boardRef.corners.map((point) => ({ x: point.x, y: point.y })),
      },
      rectification: rectifiedFrame
        ? {
            canvasSize: rectifiedFrame.canvasSize,
            cellSpacingPx: rectifiedFrame.cellSpacingPx,
            expectedCellSpacingPx: expectedCellSpacingPx(this.canvasSize),
            homographyCondition: rectifiedFrame.homography.condition,
          }
        : {
            canvasSize: { width: this.canvasSize, height: this.canvasSize },
            cellSpacingPx: 0,
            expectedCellSpacingPx: expectedCellSpacingPx(this.canvasSize),
            homographyCondition: 0,
          },
      mapping: {
        mapperVersion: this.mapperVersion,
        pieces: (boardState?.placements ?? []).map((placement) => ({
          classId: placement.classId,
          className: placement.className,
          cell: placement.cell,
          orientation: placement.orientation,
          mirrored: placement.mirrored,
          confidence: placement.confidence,
          ambiguous: placement.ambiguous,
        })),
        unassigned: boardState?.unassignedDetections.length ?? 0,
      },
      status,
      message,
    };

    const artifacts: DebugArtifactBlobs = {
      report: JSON.stringify(telemetry, null, 2),
    };

    if (this.emitArtifacts) {
      artifacts.raw = await renderRawArtifact(image);
      artifacts.yolo = await renderYoloArtifact(image, inference);
      artifacts.corners = await renderCornersArtifact(image, boardRef);
      if (rectifiedCanvas && rectifiedFrame) {
        artifacts.rectified = await renderRectifiedArtifact(
          rectifiedCanvas,
          rectifiedFrame,
        );
        if (boardState) {
          artifacts.mapped = await renderMappedArtifact(
            rectifiedCanvas,
            rectifiedFrame,
            boardState,
          );
        }
      }
    }

    return {
      status,
      inference,
      boardRef,
      rectified: rectifiedFrame,
      boardState,
      telemetry,
      artifacts,
    };
  }
}

