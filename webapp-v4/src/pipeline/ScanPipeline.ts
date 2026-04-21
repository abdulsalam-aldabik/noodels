import { InferenceRunner } from "../inference/InferenceRunner";
import type { InferenceResult, Point2D } from "../inference/types";
import { expectedCellSpacingPx, BOARD_EDGE_MAX, BOARD_EDGE_MIN } from "../board/gridGeometry";
import { locateBoard } from "../vision/BoardLocator";
import { locatePins } from "../vision/PinLocator";
import { locateBoardPins } from "../vision/BoardLocatorPins";
import { snapPiecesToPins } from "../vision/PinSnapper";
import { assignmentsToBoardState } from "../vision/PinPairToPlacement";
import type { PinEndpointAssignment } from "../vision/types";
import { mapPiecesToBoardState } from "../vision/PieceMapper";
import { mapPiecesToBoardStateV2 } from "../vision/PieceMapperV2";
import { applyHomography, rectify, DEFAULT_RECTIFIED_CANVAS } from "../vision/Rectifier";
import type { BoardRef, BoardRefPins } from "../vision/types";
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
  type LocalizationVersion,
  type ScanResult,
  type ScanStatus,
  type ScanTelemetry,
} from "./types";

export type MapperVersion = "v1" | "v2" | "pins";

export interface ScanPipelineOptions {
  runner?: InferenceRunner;
  rectifiedCanvasSize?: number;
  emitArtifacts?: boolean;
  mapperVersion?: MapperVersion;
  /**
   * Which board-localization path to run. "corners" (default) uses the
   * 4-corner BoardLocator only. "pins" also runs PinLocator +
   * BoardLocatorPins to refine the homography from detected class-13 pins,
   * and — when pin localization succeeds — uses PinSnapper +
   * PinPairToPlacement for piece mapping instead of mapperVersion's mapper.
   */
  localizationVersion?: LocalizationVersion;
}

/**
 * Staged orchestrator: image -> inference -> localization -> rectification -> mapping -> artifacts.
 */
export class ScanPipeline {
  private readonly runner: InferenceRunner;
  private readonly canvasSize: number;
  private readonly emitArtifacts: boolean;
  private readonly mapperVersion: MapperVersion;
  private readonly localizationVersion: LocalizationVersion;

  constructor(options: ScanPipelineOptions = {}) {
    this.runner = options.runner ?? new InferenceRunner();
    this.canvasSize = options.rectifiedCanvasSize ?? DEFAULT_RECTIFIED_CANVAS;
    this.emitArtifacts = options.emitArtifacts ?? true;
    this.mapperVersion = options.mapperVersion ?? "v2";
    this.localizationVersion = options.localizationVersion ?? "pins";
  }

  async ensureLoaded(): Promise<void> {
    await this.runner.ensureLoaded();
  }

  async run(
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  ): Promise<ScanResult> {
    const inference: InferenceResult = await this.runner.run(image);
    const cornerRef = locateBoard(inference.detections, inference.imageSize);

    // Pin-path localization refinement (optional).
    let pinRef: BoardRefPins | undefined;
    if (this.localizationVersion === "pins") {
      const pins = locatePins(inference.detections, {
        boardCorners: cornerRef.status !== "failed" ? cornerRef.corners : undefined,
      });
      pinRef = locateBoardPins(pins, cornerRef);
    }

    // Decide which BoardRef to use for rectification. The pin path only
    // overrides the corners when it produced a usable homography.
    const usingPinHomography =
      !!pinRef &&
      pinRef.pinStatus !== "fallback_corners" &&
      pinRef.pinStatus !== "failed" &&
      !!pinRef.pinHomography;

    const effectiveRef: BoardRef = usingPinHomography
      ? refineCornersFromPinHomography(pinRef!, cornerRef)
      : cornerRef;

    let rectifiedFrame: ScanResult["rectified"];
    let boardState: ScanResult["boardState"];
    let rectifiedCanvas: HTMLCanvasElement | null = null;
    let status: ScanStatus = "ok";
    let message: string | undefined;
    let effectiveMapper: MapperVersion = this.mapperVersion;
    let pinAssignments: PinEndpointAssignment[] = [];

    if (effectiveRef.status === "failed") {
      status = "failed";
      message = effectiveRef.message ?? "board localization failed";
    } else {
      const { frame, canvas } = rectify(image, effectiveRef, {
        canvasSize: this.canvasSize,
        // When pin path produced a valid homography, use it directly for
        // rectification. This avoids the lossy corners→H→corners→H round-trip.
        precomputedImgToBoard: usingPinHomography
          ? pinRef!.pinHomography!.forward
          : undefined,
      });
      rectifiedFrame = frame;
      rectifiedCanvas = canvas;

      if (usingPinHomography) {
        effectiveMapper = "pins";
        pinAssignments = snapPiecesToPins(
          inference.detections,
          frame.homography.forward,
        );
        boardState = assignmentsToBoardState(pinAssignments, inference.detections);
      } else {
        boardState =
          this.mapperVersion === "v2"
            ? mapPiecesToBoardStateV2(inference.detections, frame)
            : mapPiecesToBoardState(inference.detections, frame);
      }

      if (effectiveRef.status === "lowConfidence") {
        status = "lowConfidence";
        message = effectiveRef.message;
      }
    }

    const pinTelemetry = pinRef
      ? {
          status: pinRef.pinStatus,
          message: pinRef.pinMessage,
          detectedPinCount: pinRef.pinDetections.length,
          matchedPinCount: pinRef.pinCorrespondences.length,
          residualMaxCells: pinRef.pinCorrespondences.length
            ? Math.max(
                ...pinRef.pinCorrespondences.map((c) => c.residualBoardUnits),
              )
            : 0,
          residualMeanCells: pinRef.pinCorrespondences.length
            ? pinRef.pinCorrespondences.reduce(
                (s, c) => s + c.residualBoardUnits,
                0,
              ) / pinRef.pinCorrespondences.length
            : 0,
        }
      : undefined;

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
        status: effectiveRef.status,
        cornerSource: effectiveRef.cornerSource,
        cornerScore: effectiveRef.cornerScore,
        hingeFound: effectiveRef.hingeFound,
        candidates: effectiveRef.candidates.map((candidate) => ({
          source: candidate.source,
          score: candidate.score,
        })),
        corners: effectiveRef.corners.map((point) => ({ x: point.x, y: point.y })),
        version: usingPinHomography ? "pins" : this.localizationVersion,
        pin: pinTelemetry,
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
        mapperVersion: effectiveMapper,
        pieces: (boardState?.placements ?? []).map((placement) => {
          const assignment = pinAssignments.find(
            (a) => a.sourceDetectionIndex === placement.sourceDetectionIndex,
          );
          return {
            classId: placement.classId,
            className: placement.className,
            cell: placement.cell,
            orientation: placement.orientation,
            mirrored: placement.mirrored,
            confidence: placement.confidence,
            ambiguous: placement.ambiguous,
            ...(assignment
              ? {
                  visitedPins: assignment.visitedPins,
                  endpointPins: assignment.endpointPins ?? undefined,
                  legalPair: true,
                }
              : {}),
          };
        }),
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
      artifacts.corners = await renderCornersArtifact(image, effectiveRef);
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
      boardRef: effectiveRef,
      rectified: rectifiedFrame,
      boardState,
      telemetry,
      artifacts,
    };
  }
}

/**
 * Back-project the 4 board edge corners from a pin-fit homography so the
 * downstream Rectifier (which solves from 4 corners) uses the refined fit.
 */
function refineCornersFromPinHomography(
  pinRef: BoardRefPins,
  cornerRef: BoardRef,
): BoardRef {
  const invH = pinRef.pinHomography!.inverse;
  const edgeCorners: [Point2D, Point2D, Point2D, Point2D] = [
    applyHomography(invH, BOARD_EDGE_MIN, BOARD_EDGE_MIN),
    applyHomography(invH, BOARD_EDGE_MAX, BOARD_EDGE_MIN),
    applyHomography(invH, BOARD_EDGE_MAX, BOARD_EDGE_MAX),
    applyHomography(invH, BOARD_EDGE_MIN, BOARD_EDGE_MAX),
  ];
  return {
    ...cornerRef,
    corners: edgeCorners,
    cornerSource: "ransac_line_intersection", // reuse existing enum; pin-refined
    cornerScore: Math.max(cornerRef.cornerScore, 0.85),
    status: cornerRef.status === "failed" ? "failed" : "ok",
  };
}
