import { InferenceRunner } from "../inference/InferenceRunner";
import { preprocessImage, loadImageFromFile } from "../inference/preprocessing";
import { locateBoard } from "../vision/BoardLocator";
import {
  mapPiecesToGrid,
  mapRectifiedPiecesToGrid,
  mergeMappedPlacements,
  generateCandidates,
} from "../vision/PieceMapper";
import {
  runRectifiedPass,
  isValidRectifiedMargin,
  RECTIFIED_MARGIN_RANGE,
  type RectifiedGeometry,
} from "../vision/RectifiedDetector";
import {
  rasterizeMaskToBoardCells,
  findBestPlacementByCoverage,
  MIN_COVERAGE_IOU,
} from "../vision/CellCoverage";
import { globalAssign } from "./PieceAssigner";
import { validatePartialState } from "./PartialStateValidator";
import { formatHint } from "./HintFormatter";
import {
  createScanDebug,
  summarizeDetections,
  persistDebugArtifacts,
} from "./DebugArtifacts";
import type { DebugArtifactInputs } from "./DebugArtifacts";
import {
  generatePlacementsForPiece,
  collapseCandidatesBySymmetry,
} from "../engine/placements";
import { BOARD_WIDTH } from "../engine/constants";
import type { RawDetection } from "../inference/inferenceTypes";
import type { PiecePlacement } from "../engine/types";
import { DEFAULT_SCAN_CONFIG } from "../vision/visionTypes";
import type {
  CalibratedBoardRef,
  MappedPiecePlacement,
  PieceCandidate,
  ScanResult,
  ScanDebug,
  ScanPipelineConfig,
  ValidationReport,
} from "../vision/visionTypes";

// ── Config ────────────────────────────────────────────────────────────────────

export { DEFAULT_SCAN_CONFIG } from "../vision/visionTypes";
export type { ScanPipelineConfig } from "../vision/visionTypes";

// ── Local types ───────────────────────────────────────────────────────────────

type PipelineFailure = Extract<ScanResult, { ok: false }>;
type StageResult<T> = { ok: true; value: T } | { ok: false; failure: PipelineFailure };
type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

interface PreprocessStageOutput {
  imageSource: ImageSource;
  preprocessed: Awaited<ReturnType<typeof preprocessImage>>;
}

interface InferenceStageOutput {
  detections: RawDetection[];
}

interface RectifiedStageOutput {
  rectifiedCanvas: OffscreenCanvas | null;
  rectifiedDetections: RawDetection[];
  rectifiedGeometry: RectifiedGeometry | null;
}

interface MappingStageOutput {
  mappedPlacements: MappedPiecePlacement[];
  candidatesByPiece: Map<number, PieceCandidate[]>;
}

interface ResolutionStageOutput {
  resolvedPlacements: Map<number, PiecePlacement>;
  coveredCellsByClass: Map<number, Set<number>>;
  mappedByClass: Map<number, MappedPiecePlacement>;
}

interface HintStageOutput {
  hint: ReturnType<typeof formatHint>["hint"];
  solverResult: ReturnType<typeof formatHint>["solverResult"];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): number {
  return performance.now();
}

function okStage<T>(value: T): StageResult<T> {
  return { ok: true, value };
}

function failStage<T>(
  debug: ScanDebug,
  t0: number,
  stage: string,
  debugError: string,
  userError: string,
): StageResult<T> {
  debug.error = debugError;
  debug.errorStage = stage;
  debug.timings.total = now() - t0;
  return {
    ok: false,
    failure: {
      ok: false,
      error: userError,
      stage,
      debug,
    },
  };
}

function validateConfigStage(
  config: ScanPipelineConfig,
  debug: ScanDebug,
  t0: number,
): StageResult<void> {
  if (!isValidRectifiedMargin(config.marginCells)) {
    return failStage(
      debug,
      t0,
      "config",
      `Invalid rectified marginCells=${config.marginCells}. Expected ${RECTIFIED_MARGIN_RANGE.min}..${RECTIFIED_MARGIN_RANGE.max}.`,
      `Invalid rectified margin. Use a value between ${RECTIFIED_MARGIN_RANGE.min} and ${RECTIFIED_MARGIN_RANGE.max}.`,
    );
  }
  return okStage(undefined);
}

function ensureRunnerReadyStage(
  runner: InferenceRunner,
  debug: ScanDebug,
  t0: number,
): StageResult<void> {
  if (!runner.isReady) {
    return failStage(
      debug,
      t0,
      "init",
      "Model not loaded",
      "Model not loaded. Please wait.",
    );
  }
  return okStage(undefined);
}

async function runPreprocessStage(
  source: File | ImageSource,
  debug: ScanDebug,
  t0: number,
): Promise<StageResult<PreprocessStageOutput>> {
  try {
    const tPre = now();
    const imageSource = source instanceof File ? await loadImageFromFile(source) : source;
    const preprocessed = await preprocessImage(imageSource);
    debug.timings.preprocess = now() - tPre;
    return okStage({ imageSource, preprocessed });
  } catch (error) {
    const message = String(error);
    return failStage(
      debug,
      t0,
      "preprocess",
      message,
      `Preprocessing failed: ${message}`,
    );
  }
}

async function runInferenceStage(
  runner: InferenceRunner,
  preprocessed: Awaited<ReturnType<typeof preprocessImage>>,
  debug: ScanDebug,
  t0: number,
): Promise<StageResult<InferenceStageOutput>> {
  try {
    const tInf = now();
    const inference = await runner.run(preprocessed.tensor, preprocessed.params);
    debug.timings.inference = now() - tInf;
    debug.postprocess = inference.debug;
    debug.allDetections = summarizeDetections(inference.detections);
    return okStage({ detections: inference.detections });
  } catch (error) {
    const message = String(error);
    return failStage(
      debug,
      t0,
      "inference",
      message,
      `Inference failed: ${message}`,
    );
  }
}

function sourceDimensions(imageSource: ImageSource): { width: number; height: number } {
  if (imageSource instanceof HTMLImageElement) {
    return { width: imageSource.naturalWidth, height: imageSource.naturalHeight };
  }
  return { width: imageSource.width, height: imageSource.height };
}

function runBoardLocalizationStage(
  imageSource: ImageSource,
  detections: RawDetection[],
  config: ScanPipelineConfig,
  debug: ScanDebug,
  t0: number,
): StageResult<CalibratedBoardRef> {
  const { width, height } = sourceDimensions(imageSource);
  const tBoard = now();
  const boardRef = locateBoard(detections, width, height, config.boardInset);
  debug.timings.boardLocate = now() - tBoard;

  if (!boardRef) {
    return failStage(
      debug,
      t0,
      "board_localization",
      "Board not detected",
      "Board not detected. Ensure the full board is visible and well-lit.",
    );
  }

  return okStage(boardRef);
}

function applyBoardDebug(debug: ScanDebug, boardRef: CalibratedBoardRef): void {
  debug.boardDetected = true;
  debug.boardConfidence = boardRef.boardConfidence;
  debug.boardCornerSource = boardRef.boardCornerSource;
  debug.hingeSnapped = boardRef.hingeSnapped;
  debug.cornersClipped = boardRef.cornersClipped;
}

async function runRectifiedStage(
  imageSource: ImageSource,
  boardRef: CalibratedBoardRef,
  runner: InferenceRunner,
  config: ScanPipelineConfig,
  debug: ScanDebug,
): Promise<RectifiedStageOutput> {
  const output: RectifiedStageOutput = {
    rectifiedCanvas: null,
    rectifiedDetections: [],
    rectifiedGeometry: null,
  };

  const tRectify = now();
  try {
    const rectified = await runRectifiedPass(imageSource, boardRef, runner, config.marginCells);
    if (rectified) {
      output.rectifiedCanvas = rectified.rectifiedCanvas;
      output.rectifiedDetections = rectified.detections;
      output.rectifiedGeometry = rectified.geometry;
      debug.timings.rectify = rectified.timings.warpMs;
      debug.timings.rectifiedInference = rectified.timings.inferenceMs;
    } else {
      debug.timings.rectify = now() - tRectify;
      debug.timings.rectifiedInference = 0;
    }
  } catch {
    debug.timings.rectify = now() - tRectify;
    debug.timings.rectifiedInference = 0;
  }

  debug.rectifiedDetectionsCount = output.rectifiedDetections.length;
  if (output.rectifiedGeometry) {
    debug.cellSpacingPx = output.rectifiedGeometry.gridToPixelScale;
  } else {
    debug.warnings.push("Rectified pass unavailable - using primary-pass mapping only.");
  }

  return output;
}

function runMappingStage(
  detections: RawDetection[],
  boardRef: CalibratedBoardRef,
  rectified: RectifiedStageOutput,
  debug: ScanDebug,
): MappingStageOutput {
  const tMap = now();

  const primaryMappedPlacements = mapPiecesToGrid(detections, boardRef.homographyMatrix);
  const rectifiedMappedPlacements = rectified.rectifiedGeometry
    ? mapRectifiedPiecesToGrid(rectified.rectifiedDetections, rectified.rectifiedGeometry)
    : [];

  const mappedPlacements = mergeMappedPlacements(
    primaryMappedPlacements,
    rectifiedMappedPlacements,
  );

  const candidatesByPiece = generateCandidates(mappedPlacements, 3);
  debug.timings.directMap = now() - tMap;

  return { mappedPlacements, candidatesByPiece };
}

/** Picks the placement covering targetPos whose centroid is nearest to detectedBoardCentroid. */
function nearestCentroidPlacement(
  classId: number,
  targetPos: number,
  detectedBoardCentroid: [number, number] | undefined,
): PiecePlacement | null {
  const all = generatePlacementsForPiece(classId).filter((p) => p.positions.includes(targetPos));
  if (all.length === 0) return null;

  const collapsed = collapseCandidatesBySymmetry(all);
  if (!detectedBoardCentroid) return collapsed[0];

  const [detectedCol, detectedRow] = detectedBoardCentroid;
  let best = collapsed[0];
  let bestDist = Infinity;

  for (const placement of collapsed) {
    let sumR = 0;
    let sumC = 0;
    for (const pos of placement.positions) {
      sumR += Math.floor(pos / BOARD_WIDTH);
      sumC += pos % BOARD_WIDTH;
    }

    const centroidRow = sumR / placement.positions.length;
    const centroidCol = sumC / placement.positions.length;
    const dist =
      (centroidRow - detectedRow) * (centroidRow - detectedRow) +
      (centroidCol - detectedCol) * (centroidCol - detectedCol);

    if (dist < bestDist) {
      bestDist = dist;
      best = placement;
    }
  }

  return best;
}

/**
 * Resolves a (classId, cell) candidate to a concrete engine PiecePlacement.
 *
 * Primary: cell-coverage IoU matching against the projected mask polygon.
 * Fallback: centroid-nearest placement within the candidate cell.
 */
function resolveCandidateToPlacement(
  classId: number,
  cell: [number, number],
  mapped: MappedPiecePlacement | undefined,
): { placement: PiecePlacement; coveredCells: Set<number> } | null {
  const [r, c] = cell;
  const targetPos = r * BOARD_WIDTH + c;

  if (mapped && mapped.boardMaskPoints.length >= 3) {
    const coveredCells = rasterizeMaskToBoardCells(mapped.boardMaskPoints);
    if (coveredCells.size > 0) {
      const result = findBestPlacementByCoverage(
        classId,
        coveredCells,
        targetPos,
        mapped.boardMaskPoints,
      );
      if (result && result.score >= MIN_COVERAGE_IOU) {
        return { placement: result.placement, coveredCells };
      }
    }
  }

  const placement = nearestCentroidPlacement(classId, targetPos, mapped?.boardCentroid);
  if (!placement) return null;
  return { placement, coveredCells: new Set() };
}

function resolveAssignmentPlacements(
  assignment: Map<number, PieceCandidate>,
  mappedPlacements: MappedPiecePlacement[],
): ResolutionStageOutput {
  const mappedByClass = new Map<number, MappedPiecePlacement>();
  for (const mapped of mappedPlacements) {
    mappedByClass.set(mapped.classId, mapped);
  }

  const resolvedPlacements = new Map<number, PiecePlacement>();
  const coveredCellsByClass = new Map<number, Set<number>>();

  for (const [classId, candidate] of assignment) {
    const resolved = resolveCandidateToPlacement(
      classId,
      candidate.cell,
      mappedByClass.get(classId),
    );

    if (!resolved) continue;

    resolvedPlacements.set(classId, resolved.placement);
    if (resolved.coveredCells.size > 0) {
      coveredCellsByClass.set(classId, resolved.coveredCells);
    }
  }

  return { resolvedPlacements, coveredCellsByClass, mappedByClass };
}

function applyValidationDebug(
  debug: ScanDebug,
  mappedPlacements: MappedPiecePlacement[],
  confirmedPlacements: Map<number, PiecePlacement>,
  report: ValidationReport,
  mappedByClass: Map<number, MappedPiecePlacement>,
): void {
  debug.pieceMappings = mappedPlacements.map((m) => ({
    classId: m.classId,
    pieceKey: m.pieceKey,
    confidence: m.detectionConfidence,
    cellConfidence: m.cellConfidence,
    candidateCell: m.candidateCell,
    boardCentroid: m.boardCentroid,
    ambiguous: m.ambiguous,
    dropped: !confirmedPlacements.has(m.classId),
    centroidRectifiedPx: m.centroidRectifiedPx,
  }));

  debug.confirmedPlacements = [...confirmedPlacements.entries()].map(([classId, placement]) => ({
    classId,
    pieceKey: mappedByClass.get(classId)?.pieceKey ?? `piece_${classId}`,
    orientationIndex: placement.orientationIndex,
    positions: placement.positions,
  }));

  debug.droppedPieces = report.droppedPieces;
  debug.warnings = [...debug.warnings, ...report.warnings];
}

async function runHintStage(
  confirmedPlacements: Map<number, PiecePlacement>,
  debug: ScanDebug,
): Promise<HintStageOutput> {
  const tHint = now();
  const hintResult = await new Promise<ReturnType<typeof formatHint>>((resolve) => {
    setTimeout(() => resolve(formatHint(confirmedPlacements)), 0);
  });
  debug.timings.hint = now() - tHint;
  return {
    hint: hintResult.hint,
    solverResult: hintResult.solverResult,
  };
}

function maybeAttachArtifacts(
  scanResult: Extract<ScanResult, { ok: true }>,
  config: ScanPipelineConfig,
  imageSource: ImageSource,
  detections: RawDetection[],
  rectified: RectifiedStageOutput,
  coveredCellsByClass: Map<number, Set<number>>,
): void {
  if (!config.returnArtifacts || !rectified.rectifiedCanvas || !rectified.rectifiedGeometry) return;

  scanResult._artifacts = {
    imageSource,
    fullDetections: detections,
    rectifiedCanvas: rectified.rectifiedCanvas,
    rectifiedDetections: rectified.rectifiedDetections,
    rectifiedGeometry: rectified.rectifiedGeometry,
    coveredCellsByClass,
  };
}

function buildBoardFailureArtifacts(
  debug: ScanDebug,
  imageSource: ImageSource,
  detections: RawDetection[],
): DebugArtifactInputs {
  return {
    debug,
    source: imageSource,
    detections,
    boardRef: null,
    rectifiedCanvas: null,
    rectifiedDetections: [],
    rectifiedGeometry: null,
    coveredCellsByClass: new Map(),
  };
}

function buildSuccessArtifacts(
  debug: ScanDebug,
  imageSource: ImageSource,
  detections: RawDetection[],
  boardRef: CalibratedBoardRef,
  rectified: RectifiedStageOutput,
  coveredCellsByClass: Map<number, Set<number>>,
): DebugArtifactInputs {
  return {
    debug,
    source: imageSource,
    detections,
    boardRef,
    rectifiedCanvas: rectified.rectifiedCanvas,
    rectifiedDetections: rectified.rectifiedDetections,
    rectifiedGeometry: rectified.rectifiedGeometry,
    coveredCellsByClass,
  };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Runs the IQ Noodles scan pipeline on a single image.
 */
export async function runScanPipeline(
  source: File | HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  sourceType: "camera" | "upload" = "upload",
  config: ScanPipelineConfig = DEFAULT_SCAN_CONFIG,
): Promise<ScanResult> {
  const debug = createScanDebug(sourceType);
  const t0 = now();
  const runner = InferenceRunner.getInstance();

  const configStage = validateConfigStage(config, debug, t0);
  if (!configStage.ok) return configStage.failure;

  const initStage = ensureRunnerReadyStage(runner, debug, t0);
  if (!initStage.ok) return initStage.failure;

  const preprocessStage = await runPreprocessStage(source, debug, t0);
  if (!preprocessStage.ok) return preprocessStage.failure;
  const { imageSource, preprocessed } = preprocessStage.value;

  const inferenceStage = await runInferenceStage(runner, preprocessed, debug, t0);
  if (!inferenceStage.ok) return inferenceStage.failure;
  const { detections } = inferenceStage.value;

  const boardStage = runBoardLocalizationStage(imageSource, detections, config, debug, t0);
  if (!boardStage.ok) {
    const artifactInputs = buildBoardFailureArtifacts(debug, imageSource, detections);
    persistDebugArtifacts(artifactInputs).catch(() => {});
    return boardStage.failure;
  }
  const boardRef = boardStage.value;
  applyBoardDebug(debug, boardRef);

  const rectified = await runRectifiedStage(imageSource, boardRef, runner, config, debug);

  const mapping = runMappingStage(detections, boardRef, rectified, debug);

  const tAssign = now();
  const assignment = globalAssign(mapping.candidatesByPiece);
  debug.timings.assignment = now() - tAssign;

  const resolution = resolveAssignmentPlacements(assignment, mapping.mappedPlacements);

  const tVal = now();
  const validation = validatePartialState(
    resolution.resolvedPlacements,
    mapping.mappedPlacements,
  );
  debug.timings.validate = now() - tVal;

  applyValidationDebug(
    debug,
    mapping.mappedPlacements,
    validation.confirmedPlacements,
    validation.report,
    resolution.mappedByClass,
  );

  const hintStage = await runHintStage(validation.confirmedPlacements, debug);
  debug.timings.total = now() - t0;

  const artifactInputs = buildSuccessArtifacts(
    debug,
    imageSource,
    detections,
    boardRef,
    rectified,
    resolution.coveredCellsByClass,
  );
  persistDebugArtifacts(artifactInputs).catch((error) => {
    console.warn("Debug artifact persistence failed:", error);
  });

  const result: Extract<ScanResult, { ok: true }> = {
    ok: true,
    boardRef,
    mappedPlacements: mapping.mappedPlacements,
    report: validation.report,
    confirmedPlacements: validation.confirmedPlacements,
    hint: hintStage.hint,
    solverResult: hintStage.solverResult,
    debug,
  };

  maybeAttachArtifacts(
    result,
    config,
    imageSource,
    detections,
    rectified,
    resolution.coveredCellsByClass,
  );

  return result;
}
import { InferenceRunner } from "../inference/InferenceRunner";
import { preprocessImage, loadImageFromFile } from "../inference/preprocessing";
import { locateBoard } from "../vision/BoardLocator";
import {
  mapPiecesToGrid,
  mapRectifiedPiecesToGrid,
  mergeMappedPlacements,
  generateCandidates,
} from "../vision/PieceMapper";
import {
  runRectifiedPass,
  isValidRectifiedMargin,
  RECTIFIED_MARGIN_RANGE,
  type RectifiedGeometry,
} from "../vision/RectifiedDetector";
import {
  rasterizeMaskToBoardCells,
  findBestPlacementByCoverage,
  MIN_COVERAGE_IOU,
} from "../vision/CellCoverage";
import { globalAssign } from "./PieceAssigner";
import { validatePartialState } from "./PartialStateValidator";
import { formatHint } from "./HintFormatter";
import {
  createScanDebug,
  summarizeDetections,
  persistDebugArtifacts,
} from "./DebugArtifacts";
import type { DebugArtifactInputs } from "./DebugArtifacts";
import {
  generatePlacementsForPiece,
  collapseCandidatesBySymmetry,
} from "../engine/placements";
import { BOARD_WIDTH } from "../engine/constants";
import type { RawDetection } from "../inference/inferenceTypes";
import type { PiecePlacement } from "../engine/types";
import { DEFAULT_SCAN_CONFIG } from "../vision/visionTypes";
import type {
  CalibratedBoardRef,
  MappedPiecePlacement,
  PieceCandidate,
  ScanResult,
  ScanDebug,
  ScanPipelineConfig,
} from "../vision/visionTypes";

// ── Config ────────────────────────────────────────────────────────────────────

export { DEFAULT_SCAN_CONFIG } from "../vision/visionTypes";
export type { ScanPipelineConfig } from "../vision/visionTypes";

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): number {
  return performance.now();
}

/** Picks the placement covering targetPos whose centroid is nearest to detectedBoardCentroid. */
function nearestCentroidPlacement(
  classId: number,
  targetPos: number,
  detectedBoardCentroid: [number, number] | undefined,
): PiecePlacement | null {
  const all = generatePlacementsForPiece(classId).filter((p) => p.positions.includes(targetPos));
  if (all.length === 0) return null;

  const collapsed = collapseCandidatesBySymmetry(all);
  if (!detectedBoardCentroid) return collapsed[0];

  const [detectedCol, detectedRow] = detectedBoardCentroid;
  let best = collapsed[0];
  let bestDist = Infinity;
  for (const p of collapsed) {
    let sumR = 0, sumC = 0;
    for (const pos of p.positions) {
      sumR += Math.floor(pos / BOARD_WIDTH);
      sumC += pos % BOARD_WIDTH;
    }
    const d = (sumR / p.positions.length - detectedRow) ** 2
            + (sumC / p.positions.length - detectedCol) ** 2;
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

/**
 * Resolves a (classId, cell) candidate to a concrete engine PiecePlacement.
 *
 * Primary: cell-coverage IoU matching against the projected mask polygon.
 * Fallback: centroid-nearest placement within the candidate cell.
 */
function resolveCandidateToPlacement(
  classId: number,
  cell: [number, number],
  mapped: MappedPiecePlacement | undefined,
): { placement: PiecePlacement; coveredCells: Set<number> } | null {
  const [r, c] = cell;
  const targetPos = r * BOARD_WIDTH + c;

  if (mapped && mapped.boardMaskPoints.length >= 3) {
    const coveredCells = rasterizeMaskToBoardCells(mapped.boardMaskPoints);
    if (coveredCells.size > 0) {
      const result = findBestPlacementByCoverage(classId, coveredCells, targetPos, mapped.boardMaskPoints);
      if (result && result.score >= MIN_COVERAGE_IOU) {
        return { placement: result.placement, coveredCells };
      }
    }
  }

  const placement = nearestCentroidPlacement(classId, targetPos, mapped?.boardCentroid);
  if (!placement) return null;
  return { placement, coveredCells: new Set() };
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

/**
 * Runs the IQ Noodles scan pipeline on a single image.
 *
 * Stages:
 *   1. Preprocess image → 640×640 letterboxed tensor
 *   2. ONNX inference (full image) → all detections
 *   3. Board localization → 4 corners → homography H (image px → board grid)
 *   4. Rectify → warp image to canonical 640×640 board space via H-inverse
 *   5. ONNX inference on rectified image → piece detections in board-aligned space
 *   6. Direct mapping: rectified centroid → board-space (shared grid geometry)
 *   7. Global assignment → resolve to placements → validate → hint
 */
export async function runScanPipeline(
  source: File | HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  sourceType: "camera" | "upload" = "upload",
  config: ScanPipelineConfig = DEFAULT_SCAN_CONFIG,
): Promise<ScanResult> {
  const debug: ScanDebug = createScanDebug(sourceType);
  const t0 = now();
  const runner = InferenceRunner.getInstance();

  if (!isValidRectifiedMargin(config.marginCells)) {
    debug.error = `Invalid rectified marginCells=${config.marginCells}. Expected ${RECTIFIED_MARGIN_RANGE.min}..${RECTIFIED_MARGIN_RANGE.max}.`;
    debug.errorStage = "config";
    debug.timings.total = now() - t0;
    return {
      ok: false,
      error: `Invalid rectified margin. Use a value between ${RECTIFIED_MARGIN_RANGE.min} and ${RECTIFIED_MARGIN_RANGE.max}.`,
      stage: "config",
      debug,
    };
  }

  if (!runner.isReady) {
    debug.error = "Model not loaded";
    debug.errorStage = "init";
    return { ok: false, error: "Model not loaded. Please wait.", stage: "init", debug };
  }

  // ── Stage 1: Preprocess ─────────────────────────────────────────────────────
  let imageSource: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  let preprocessed: Awaited<ReturnType<typeof preprocessImage>>;
  try {
    const tPre = now();
    imageSource = source instanceof File ? await loadImageFromFile(source) : source;
    preprocessed = await preprocessImage(imageSource);
    debug.timings.preprocess = now() - tPre;
  } catch (err) {
    debug.error = String(err);
    debug.errorStage = "preprocess";
    debug.timings.total = now() - t0;
    return { ok: false, error: `Preprocessing failed: ${String(err)}`, stage: "preprocess", debug };
  }

  // ── Stage 2: ONNX Inference (full image) ────────────────────────────────────
  let detections: RawDetection[];
  try {
    const tInf = now();
    const result = await runner.run(preprocessed.tensor, preprocessed.params);
    detections = result.detections;
    debug.postprocess = result.debug;
    debug.timings.inference = now() - tInf;
    debug.allDetections = summarizeDetections(detections);
  } catch (err) {
    debug.error = String(err);
    debug.errorStage = "inference";
    debug.timings.total = now() - t0;
    return { ok: false, error: `Inference failed: ${String(err)}`, stage: "inference", debug };
  }

  // ── Stage 3: Board Localization ─────────────────────────────────────────────
  const imageW = imageSource instanceof HTMLImageElement
    ? imageSource.naturalWidth : imageSource.width;
  const imageH = imageSource instanceof HTMLImageElement
    ? imageSource.naturalHeight : imageSource.height;

  const tBoard = now();
  const boardRef: CalibratedBoardRef | null = locateBoard(
    detections, imageW, imageH, config.boardInset,
  );
  debug.timings.boardLocate = now() - tBoard;

  if (!boardRef) {
    debug.error = "Board not detected";
    debug.errorStage = "board_localization";
    debug.timings.total = now() - t0;
    const earlyInputs: DebugArtifactInputs = {
      debug, source: imageSource ?? null, detections,
      boardRef: null, rectifiedCanvas: null,
      rectifiedDetections: [], rectifiedGeometry: null,
      coveredCellsByClass: new Map(),
    };
    persistDebugArtifacts(earlyInputs).catch(() => {});
    return {
      ok: false,
      error: "Board not detected. Ensure the full board is visible and well-lit.",
      stage: "board_localization",
      debug,
    };
  }

  debug.boardDetected = true;
  debug.boardConfidence = boardRef.boardConfidence;
  debug.boardCornerSource = boardRef.boardCornerSource;
  debug.hingeSnapped = boardRef.hingeSnapped;
  debug.cornersClipped = boardRef.cornersClipped;

  // ── Stage 4+5: Rectify + Rectified Inference ────────────────────────────────
  let rectifiedCanvas: OffscreenCanvas | null = null;
  let rectifiedDetections: RawDetection[] = [];
  let rectifiedGeometry: RectifiedGeometry | null = null;

  const tRectify = now();
  try {
    const rectResult = await runRectifiedPass(
      imageSource,
      boardRef,
      runner,
      config.marginCells,
    );
    if (rectResult) {
      rectifiedCanvas = rectResult.rectifiedCanvas;
      rectifiedDetections = rectResult.detections;
      rectifiedGeometry = rectResult.geometry;
      debug.timings.rectify = rectResult.timings.warpMs;
      debug.timings.rectifiedInference = rectResult.timings.inferenceMs;
    } else {
      debug.timings.rectify = now() - tRectify;
      debug.timings.rectifiedInference = 0;
    }
  } catch {
    debug.timings.rectify = now() - tRectify;
    debug.timings.rectifiedInference = 0;
  }
  debug.rectifiedDetectionsCount = rectifiedDetections.length;

  if (rectifiedGeometry) {
    debug.cellSpacingPx = rectifiedGeometry.gridToPixelScale;
  } else {
    debug.warnings.push("Rectified pass unavailable — using primary-pass mapping only.");
  }

  // ── Stage 6: Direct mapping (rectified-only) ─────────────────────────────────
  const tMap = now();
  const primaryMappedPlacements: MappedPiecePlacement[] = mapPiecesToGrid(
    detections,
    boardRef.homographyMatrix,
  );
  const rectifiedMappedPlacements: MappedPiecePlacement[] = rectifiedGeometry
    ? mapRectifiedPiecesToGrid(rectifiedDetections, rectifiedGeometry)
    : [];
  const mappedPlacements: MappedPiecePlacement[] = mergeMappedPlacements(
    primaryMappedPlacements,
    rectifiedMappedPlacements,
  );

  const candidatesByPiece = generateCandidates(mappedPlacements, 3);
  debug.timings.directMap = now() - tMap;

  // ── Stage 7: Assignment + validation + hint ─────────────────────────────────
  const tAssign = now();
  const assignment: Map<number, PieceCandidate> = globalAssign(candidatesByPiece);
  debug.timings.assignment = now() - tAssign;

  const mappedByClass = new Map<number, MappedPiecePlacement>();
  for (const m of mappedPlacements) mappedByClass.set(m.classId, m);

  const resolvedPlacements = new Map<number, PiecePlacement>();
  const coveredCellsByClass = new Map<number, Set<number>>();

  for (const [classId, cand] of assignment) {
    const result = resolveCandidateToPlacement(classId, cand.cell, mappedByClass.get(classId));
    if (result) {
      resolvedPlacements.set(classId, result.placement);
      if (result.coveredCells.size > 0) coveredCellsByClass.set(classId, result.coveredCells);
    }
  }

  const tVal = now();
  const { report, confirmedPlacements } = validatePartialState(resolvedPlacements, mappedPlacements);
  debug.timings.validate = now() - tVal;

  debug.pieceMappings = mappedPlacements.map((m) => ({
    classId: m.classId,
    pieceKey: m.pieceKey,
    confidence: m.detectionConfidence,
    cellConfidence: m.cellConfidence,
    candidateCell: m.candidateCell,
    boardCentroid: m.boardCentroid,
    ambiguous: m.ambiguous,
    dropped: !confirmedPlacements.has(m.classId),
    centroidRectifiedPx: m.centroidRectifiedPx,
  }));
  debug.confirmedPlacements = [...confirmedPlacements.entries()].map(([classId, p]) => ({
    classId,
    pieceKey: mappedByClass.get(classId)?.pieceKey ?? `piece_${classId}`,
    orientationIndex: p.orientationIndex,
    positions: p.positions,
  }));
  debug.droppedPieces = report.droppedPieces;
  debug.warnings = [...debug.warnings, ...report.warnings];

  const tHint = now();
  const { hint, solverResult } = await new Promise<ReturnType<typeof formatHint>>((resolve) => {
    setTimeout(() => resolve(formatHint(confirmedPlacements)), 0);
  });
  debug.timings.hint = now() - tHint;
  debug.timings.total = now() - t0;

  // Persist debug artifacts (non-blocking)
  const artifactInputs: DebugArtifactInputs = {
    debug, source: imageSource, detections, boardRef,
    rectifiedCanvas, rectifiedDetections, rectifiedGeometry, coveredCellsByClass,
  };
  persistDebugArtifacts(artifactInputs).catch((err) =>
    console.warn("Debug artifact persistence failed:", err),
  );

  const scanResult: Extract<ScanResult, { ok: true }> = {
    ok: true,
    boardRef,
    mappedPlacements,
    report,
    confirmedPlacements,
    hint,
    solverResult,
    debug,
  };

  // Attach intermediate artifacts for the debug lab page if requested
  if (config.returnArtifacts && rectifiedCanvas && rectifiedGeometry) {
    scanResult._artifacts = {
      imageSource,
      fullDetections: detections,
      rectifiedCanvas,
      rectifiedDetections,
      rectifiedGeometry,
      coveredCellsByClass,
    };
  }

  return scanResult;
}
