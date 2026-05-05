import { InferenceRunner } from "../inference/InferenceRunner";
import type { InferenceResult, Point2D, RawDetection } from "../inference/types";
import { BOARD_CLASS_ID } from "../inference/types";
import { expectedCellSpacingPx, BOARD_EDGE_MAX, BOARD_EDGE_MIN } from "../board/gridGeometry";
import { locateBoard } from "../vision/BoardLocator";
import { locatePins } from "../vision/PinLocator";
import { locateBoardPins } from "../vision/BoardLocatorPins";
import { mapPiecesToBoardState } from "../vision/PieceMapper";
import { applyHomography, rectify, DEFAULT_RECTIFIED_CANVAS } from "../vision/Rectifier";
import type { BoardRef, BoardRefPins } from "../vision/types";
import {
  classHistogram,
  renderCornersArtifact,
  renderColorClassificationArtifact,
  renderDetectionsOnRectifiedArtifact,
  renderMappedArtifact,
  renderRawArtifact,
  renderRectifiedArtifact,
  renderYoloArtifact,
} from "./DebugArtifacts";
import {
  TELEMETRY_SCHEMA_VERSION,
  type AmbiguityPlacementPolicy,
  type DebugArtifactBlobs,
  type LocalizationVersion,
  type RetryInfo,
  type ScanResult,
  type ScanStatus,
  type ScanTelemetry,
} from "./types";

// ── Task 3: Homography quality gate threshold ────────────────────────────────
/** Maximum acceptable condition number. Above this, the homography is too
 *  ill-conditioned for reliable coordinate mapping. */
export const HOMOGRAPHY_CONDITION_THRESHOLD = 5_000;

// ── Task 1: Board crop padding ───────────────────────────────────────────────
/** Fraction of the fused board bbox to add as padding on each side. */
const BOARD_CROP_PADDING = 0.10;

export interface ScanPipelineOptions {
  runner?: InferenceRunner;
  rectifiedCanvasSize?: number;
  emitArtifacts?: boolean;
  /**
   * Which board-localization path to run. "corners" uses the 4-corner
   * BoardLocator only. "pins" also runs PinLocator + BoardLocatorPins to
   * refine the homography from detected class-13 pins.
   */
  localizationVersion?: LocalizationVersion;
  /** Task 5: ambiguity placement policy. Default: "strict". */
  ambiguityPlacementPolicy?: AmbiguityPlacementPolicy;
}

/**
 * Orchestrator: image → inference → localization → rectification → mapping → artifacts.
 */
export class ScanPipeline {
  private readonly runner: InferenceRunner;
  private readonly canvasSize: number;
  private readonly emitArtifacts: boolean;
  private readonly localizationVersion: LocalizationVersion;
  private readonly ambiguityPolicy: AmbiguityPlacementPolicy;

  constructor(options: ScanPipelineOptions = {}) {
    this.runner = options.runner ?? new InferenceRunner();
    this.canvasSize = options.rectifiedCanvasSize ?? DEFAULT_RECTIFIED_CANVAS;
    this.emitArtifacts = options.emitArtifacts ?? true;
    this.localizationVersion = options.localizationVersion ?? "pins";
    this.ambiguityPolicy = options.ambiguityPlacementPolicy ?? "off";
  }

  get isLoaded(): boolean {
    return this.runner.isLoaded;
  }

  async ensureLoaded(): Promise<void> {
    await this.runner.ensureLoaded();
  }

  async run(
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  ): Promise<ScanResult> {
    // ── Stage 0: Initial inference on the full frame ──────────────────────
    const inference: InferenceResult = await this.runner.run(image);

    // ── Task 1: Two-stage detection — crop to board, re-infer ────────────
    const { croppedInference, cropOffset } = await this.twoStageDetection(
      image,
      inference,
    );
    // If the crop yielded a usable re-inference, use it; otherwise keep original.
    const effectiveInference = croppedInference ?? inference;

    // If we cropped, remap detections back to original image space.
    const remappedDetections = cropOffset
      ? remapDetections(effectiveInference.detections, cropOffset)
      : effectiveInference.detections;

    // Build a synthetic InferenceResult with remapped coordinates for downstream.
    const finalInference: InferenceResult = cropOffset
      ? {
          ...effectiveInference,
          detections: remappedDetections,
          imageSize: inference.imageSize, // original image size
        }
      : effectiveInference;

    const cornerRef = locateBoard(finalInference.detections, finalInference.imageSize);

    // Pin-path localization refinement (optional).
    let pinRef: BoardRefPins | undefined;
    if (this.localizationVersion === "pins") {
      const pins = locatePins(finalInference.detections, {
        boardCorners: cornerRef.status !== "failed" ? cornerRef.corners : undefined,
      });
      pinRef = locateBoardPins(pins, cornerRef);
    }

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
    let homographyCondition = 0;
    let homographyGatePassed = true;

    if (effectiveRef.status === "failed") {
      status = "failed";
      message = effectiveRef.message ?? "board localization failed";
    } else {
      const { frame, canvas } = rectify(image, effectiveRef, {
        canvasSize: this.canvasSize,
        precomputedImgToBoard: usingPinHomography
          ? pinRef!.pinHomography!.forward
          : undefined,
      });
      rectifiedFrame = frame;
      rectifiedCanvas = canvas;
      homographyCondition = frame.homography.condition;

      // ── Task 3: Homography quality gate ────────────────────────────────
      if (homographyCondition > HOMOGRAPHY_CONDITION_THRESHOLD) {
        homographyGatePassed = false;
        status = "rejected_condition";
        message = `Homography condition ${homographyCondition.toFixed(0)} exceeds threshold ${HOMOGRAPHY_CONDITION_THRESHOLD}`;
        // Do NOT proceed with piece mapping — the coordinates are unreliable.
      } else {
        // Proceed with piece mapping.
        boardState = mapPiecesToBoardState(
          canvas,
          finalInference.detections,
          frame.homography,
          this.ambiguityPolicy,
        );

        if (effectiveRef.status === "lowConfidence") {
          status = "lowConfidence";
          message = effectiveRef.message;
        }
      }
    }

    // ── Task 2: Pin-based grid fitting telemetry ─────────────────────────
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

    const gridFitResidualMax = pinTelemetry?.residualMaxCells ?? undefined;
    const gridFitResidualMean = pinTelemetry?.residualMeanCells ?? undefined;

    // ── Task 6: Determine retry info ─────────────────────────────────────
    const placements = boardState?.placements ?? [];
    const avgPlacedConfidence = placements.length > 0
      ? placements.reduce((s, p) => s + p.confidence, 0) / placements.length
      : 0;
    const retryInfo = evaluateRetryConditions(
      homographyCondition,
      gridFitResidualMean,
      placements.length,
      placements.filter((p) => p.ambiguous).length,
      avgPlacedConfidence,
    );

    const telemetry: ScanTelemetry = {
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      timestamp: new Date().toISOString(),
      imageSize: inference.imageSize,
      inference: {
        modelPath: inference.modelPath,
        durationMs: inference.durationMs,
        numDetections: finalInference.detections.length,
        classHistogram: classHistogram(finalInference),
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
        gridFitResidualMax,
        gridFitResidualMean,
        pin: pinTelemetry,
      },
      rectification: rectifiedFrame
        ? {
            canvasSize: rectifiedFrame.canvasSize,
            cellSpacingPx: rectifiedFrame.cellSpacingPx,
            expectedCellSpacingPx: expectedCellSpacingPx(this.canvasSize),
            homographyCondition: rectifiedFrame.homography.condition,
            homographyGatePassed,
          }
        : {
            canvasSize: { width: this.canvasSize, height: this.canvasSize },
            cellSpacingPx: 0,
            expectedCellSpacingPx: expectedCellSpacingPx(this.canvasSize),
            homographyCondition: 0,
            homographyGatePassed: false,
          },
      mapping: {
        mapperVersion: "v4",
        placementPolicy: this.ambiguityPolicy,
        droppedDuplicateCount: boardState?.stats.droppedDuplicateCount ?? 0,
        pieces: (boardState?.placements ?? []).map((placement) => ({
          classId: placement.classId,
          className: placement.className,
          cell: placement.cell,
          orientation: placement.orientation,
          mirrored: placement.mirrored,
          confidence: placement.confidence,
          ambiguous: placement.ambiguous,
          source: placement.source,
          placedDespiteAmbiguity: placement.placedDespiteAmbiguity,
        })),
        unassigned: boardState?.unassignedDetections.length ?? 0,
        maskCount: boardState?.stats.maskCount ?? 0,
        colorRescueCount: boardState?.stats.colorRescueCount ?? 0,
        droppedColorClassIds: boardState?.stats.droppedColorClassIds ?? [],
      },
      ui: {
        retryTriggered: retryInfo.retryTriggered,
        retryReason: retryInfo.retryReason,
        lowConfidence: retryInfo.lowConfidence,
      },
      status,
      message,
    };

    const artifacts: DebugArtifactBlobs = {
      report: JSON.stringify(telemetry, null, 2),
    };

    if (this.emitArtifacts) {
      artifacts.raw = await renderRawArtifact(image);
      artifacts.yolo = await renderYoloArtifact(image, finalInference);
      artifacts.corners = await renderCornersArtifact(image, effectiveRef);
      if (rectifiedCanvas && rectifiedFrame) {
        artifacts.rectified = await renderRectifiedArtifact(
          rectifiedCanvas,
          rectifiedFrame,
        );
        artifacts.detectionsOnRectified = await renderDetectionsOnRectifiedArtifact(
          rectifiedCanvas,
          rectifiedFrame,
          finalInference.detections,
        );
        artifacts.colorClassification = await renderColorClassificationArtifact(
          rectifiedCanvas,
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
      inference: finalInference,
      boardRef: effectiveRef,
      rectified: rectifiedFrame,
      boardState,
      telemetry,
      artifacts,
      retryInfo,
    };
  }

  // ── Task 1: Two-stage detection ──────────────────────────────────────────
  /**
   * Extract the board bounding box from the initial inference, crop the source
   * image to that region (with padding), and re-run YOLO on the crop. This
   * makes pieces much larger in the model's input, boosting confidence.
   *
   * Returns the cropped inference and the crop offset for coordinate remapping.
   * Returns nulls if no usable board bbox was found.
   */
  private async twoStageDetection(
    image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
    initialInference: InferenceResult,
  ): Promise<{
    croppedInference: InferenceResult | null;
    cropOffset: { x: number; y: number } | null;
  }> {
    // Collect all board-class detections.
    const boardDets = initialInference.detections.filter(
      (d) => d.classId === BOARD_CLASS_ID,
    );
    if (boardDets.length === 0) {
      return { croppedInference: null, cropOffset: null };
    }

    // Fuse overlapping board bboxes via IoU-based NMS.
    const fusedBbox = fuseBoxesNMS(
      boardDets.map((d) => d.bbox),
      0.3,
    );

    // Add padding, clamp to image bounds.
    const imgW = initialInference.imageSize.width;
    const imgH = initialInference.imageSize.height;
    const padX = fusedBbox.width * BOARD_CROP_PADDING;
    const padY = fusedBbox.height * BOARD_CROP_PADDING;

    const cropX = Math.max(0, Math.round(fusedBbox.x - padX));
    const cropY = Math.max(0, Math.round(fusedBbox.y - padY));
    const cropRight = Math.min(imgW, Math.round(fusedBbox.x + fusedBbox.width + padX));
    const cropBottom = Math.min(imgH, Math.round(fusedBbox.y + fusedBbox.height + padY));
    const cropW = cropRight - cropX;
    const cropH = cropBottom - cropY;

    // Don't crop if the board already fills most of the frame in either
    // dimension — close-up portrait shots often fill width but not height,
    // and re-cropping only adds noise without zooming in further.
    if (cropW / imgW > 0.85 || cropH / imgH > 0.85) {
      return { croppedInference: null, cropOffset: null };
    }

    // Crop the source image to a canvas.
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx) {
      return { croppedInference: null, cropOffset: null };
    }
    cropCtx.drawImage(
      image as CanvasImageSource,
      cropX, cropY, cropW, cropH,
      0, 0, cropW, cropH,
    );

    // Re-run inference on the cropped image.
    const croppedResult = await this.runner.run(cropCanvas);

    return {
      croppedInference: croppedResult,
      cropOffset: { x: cropX, y: cropY },
    };
  }
}

/**
 * Back-project the 4 board edge corners from a pin-fit homography so the
 * downstream Rectifier uses the refined fit.
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
    cornerSource: "ransac_line_intersection",
    cornerScore: Math.max(cornerRef.cornerScore, 0.85),
    status: cornerRef.status === "failed" ? "failed" : "ok",
  };
}

// ── Task 1 helpers: NMS + coordinate remapping ───────────────────────────────

interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fuse an array of bounding boxes using IoU-based NMS, returning a single
 *  encompassing box for all retained detections. */
function fuseBoxesNMS(boxes: BBox[], iouThreshold: number): BBox {
  if (boxes.length === 0) throw new Error("fuseBoxesNMS: no boxes");
  if (boxes.length === 1) return { ...boxes[0] };

  // Sort by area descending.
  const sorted = [...boxes].sort(
    (a, b) => b.width * b.height - a.width * a.height,
  );
  const kept: BBox[] = [];

  for (const box of sorted) {
    let suppress = false;
    for (const k of kept) {
      if (computeIoU(box, k) > iouThreshold) {
        suppress = true;
        break;
      }
    }
    if (!suppress) kept.push(box);
  }

  // Union bounding box of all kept boxes.
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const b of kept) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function computeIoU(a: BBox, b: BBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = a.width * a.height;
  const areaB = b.width * b.height;
  return intersection / (areaA + areaB - intersection);
}

/** Remap all detection coordinates from crop-local to original image space. */
function remapDetections(
  detections: RawDetection[],
  offset: { x: number; y: number },
): RawDetection[] {
  return detections.map((d) => ({
    ...d,
    bbox: {
      x: d.bbox.x + offset.x,
      y: d.bbox.y + offset.y,
      width: d.bbox.width,
      height: d.bbox.height,
    },
    polygon: d.polygon?.map((p) => ({ x: p.x + offset.x, y: p.y + offset.y })),
  }));
}

// ── Task 6: Retry condition evaluation ───────────────────────────────────────

function evaluateRetryConditions(
  homographyCondition: number,
  gridFitResidualMean: number | undefined,
  placedCount: number,
  ambiguousCount: number,
  avgPlacedConfidence: number,
): RetryInfo {
  // Check conditions in priority order.
  if (homographyCondition > HOMOGRAPHY_CONDITION_THRESHOLD) {
    return {
      retryTriggered: true,
      retryReason: "HOMOGRAPHY_UNSTABLE",
      message: "Board angle too steep — hold camera directly above",
      lowConfidence: true,
    };
  }
  // Use mean residual (not max) so a single outlier pin doesn't trigger a
  // false alarm. Threshold 0.22 cells ≈ 13 px on the 960 px canvas.
  if (gridFitResidualMean !== undefined && gridFitResidualMean > 0.22) {
    return {
      retryTriggered: true,
      retryReason: "GRID_MISALIGNED",
      message: "Grid misaligned — make sure all corners are visible",
      lowConfidence: true,
    };
  }
  // Only warn about few pieces when confidence is also low — a legitimately
  // sparse board (few pieces placed intentionally) will have high confidence
  // per detection and should pass through without a retry prompt.
  if (placedCount < 5 && avgPlacedConfidence < 0.55) {
    return {
      retryTriggered: true,
      retryReason: "TOO_FEW_PLACED",
      message: "Too few pieces found — check lighting and retake",
      lowConfidence: true,
    };
  }
  if (ambiguousCount > placedCount) {
    return {
      retryTriggered: true,
      retryReason: "HIGH_AMBIGUITY",
      message: "Detection uncertain — try better lighting or a different angle",
      lowConfidence: true,
    };
  }
  return {
    retryTriggered: false,
    lowConfidence: false,
  };
}
