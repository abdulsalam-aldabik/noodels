import { InferenceRunner } from "../inference/InferenceRunner";
import { preprocessImage, loadImageFromFile } from "../inference/preprocessing";
import {
  locateBoard,
  locateBoardFromCorners,
  pickBestBoardHypothesis,
  scoreBoardHypotheses,
  type BoardLocateDiagnostics,
} from "../vision/BoardLocator";
import { generateCandidates, mapPiecesToGrid, mapRectifiedPiecesToGrid } from "../vision/PieceMapper";
import { validatePartialState } from "./PartialStateValidator";
import { globalAssign } from "./PieceAssigner";
import { formatHint } from "./HintFormatter";
import { loadOpenCV, isOpenCVReady, findBoardContourCV } from "../vision/OpenCVProcessor";
import { rectifiedPieceDetection } from "../vision/RectifiedDetector";
import type {
  ScanDebug,
  ScanResult,
} from "../vision/visionTypes";

const CLASS_LABELS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "board",
  "hinge",
];

function now(): number {
  return performance.now();
}

function createDebug(): ScanDebug {
  return {
    timings: {
      preprocess: 0,
      inference: 0,
      boardLocate: 0,
      pieceMap: 0,
      validate: 0,
      hint: 0,
      total: 0,
    },
    postprocess: null,
    boardDetected: false,
    boardConfidence: 0,
    boardFailureCode: null,
    boardFailureDetail: null,
    boardCornerSource: null,
    boardCornerCandidates: [],
    openCvReady: false,
    cvContourDetected: false,
    cvContourCorners: [],
    hingeDetected: false,
    hingeEdge: null,
    classLabels: CLASS_LABELS,
    allDetections: [],
    pieceMappings: [],
    orientationHypotheses: [],
    selectedOrientation: 0,
    rectifiedSecondPassUsed: false,
    rectifiedDetectionsCount: 0,
    confirmedPlacements: [],
    error: null,
    errorStage: null,
  };
}

function buildFailure(stage: string, error: string, debug: ScanDebug): ScanResult {
  debug.error = error;
  debug.errorStage = stage;
  return { ok: false, error, stage, debug };
}

function getBoardFailureReason(
  debug: ScanDebug,
  diagnostics: BoardLocateDiagnostics,
): string {
  if (diagnostics.failureCode === "board_confidence_low") {
    return diagnostics.failureDetail
      ?? "Board detection confidence was below the current acceptance threshold.";
  }

  if (diagnostics.failureCode === "corner_order_failed") {
    return "Board was detected, but corner ordering failed for all localization candidates.";
  }

  if (diagnostics.failureCode === "homography_failed") {
    return "Board was detected, but all corner candidates failed homography computation.";
  }

  if (diagnostics.failureCode === "board_polygon_invalid") {
    return diagnostics.failureDetail
      ?? "Board mask geometry was too weak to extract a usable contour.";
  }

  const counts = debug.postprocess?.countsByClass ?? {};
  const boardCount = counts[11] ?? 0;
  const hingeCount = counts[12] ?? 0;
  const anyPieceCount = Object.entries(counts)
    .filter(([k]) => Number(k) >= 0 && Number(k) <= 10)
    .reduce((s, [, v]) => s + v, 0);

  if (boardCount === 0 && anyPieceCount > 0) {
    return "Pieces were detected but board class was missing in this frame. Try centering the full board with less background.";
  }

  if (boardCount > 0 && hingeCount === 0) {
    return "Board mask was found but hinge was not detected; orientation can be less stable in rotated captures.";
  }

  if (Object.keys(counts).length === 0) {
    return "No detections survived confidence/NMS in this frame.";
  }

  return "Board contour could not be localized from current detections.";
}

/**
 * Runs the full IQ Noodles scan pipeline on a single image.
 *
 * Stages:
 *   1. Preprocess image → 640×640 tensor (letterbox)
 *   2. ONNX inference → RawDetection[]
 *   3. Board localization (class 11) → CalibratedBoardRef
 *   4. Hinge interpretation (class 12) → orientation correction (inside BoardLocator)
 *   5. Piece mapping (classes 0–10) → MappedPiecePlacement[]
 *   6. Partial state validation → ValidationReport
 *   7. Solver handoff → HintPayload
 *
 * The photo is never stored or transmitted — only the derived JSON structures leave
 * this function.
 *
 * @param source - The captured image (File, HTMLImageElement, HTMLCanvasElement, or ImageBitmap)
 * @returns ScanResult — either an error with stage name, or full pipeline output
 */
export async function runScanPipeline(
  source: File | HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<ScanResult> {
  const startTotal = now();
  const debug = createDebug();
  const runner = InferenceRunner.getInstance();

  if (!runner.isReady) {
    return buildFailure("init", "Model not loaded. Please wait for model to finish loading.", debug);
  }

  // OpenCV is optional. Start loading in background; do not block the scan path.
  void loadOpenCV().catch(() => undefined);

  // ── Stage 1: Preprocess ────────────────────────────────────────────────────

  let imageSource: HTMLImageElement | HTMLCanvasElement | ImageBitmap;
  let preprocessed: Awaited<ReturnType<typeof preprocessImage>>;
  const tPre0 = now();
  try {
    imageSource = source instanceof File
      ? await loadImageFromFile(source)
      : source;
    preprocessed = await preprocessImage(imageSource);
  } catch (err) {
    debug.timings.preprocess = now() - tPre0;
    debug.timings.total = now() - startTotal;
    return buildFailure("preprocess", `Image preprocessing failed: ${String(err)}`, debug);
  }
  debug.timings.preprocess = now() - tPre0;

  // ── Stage 2: ONNX Inference ────────────────────────────────────────────────

  let runResult: Awaited<ReturnType<typeof runner.run>>;
  const tInf0 = now();
  try {
    runResult = await runner.run(preprocessed.tensor, preprocessed.params);
  } catch (err) {
    debug.timings.inference = now() - tInf0;
    debug.timings.total = now() - startTotal;
    return buildFailure("inference", `Inference failed: ${String(err)}`, debug);
  }
  debug.timings.inference = now() - tInf0;
  debug.postprocess = runResult.debug;

  const detections = runResult.detections;
  debug.allDetections = detections.map((d) => ({
    classId: d.classId,
    label: CLASS_LABELS[d.classId] ?? `class_${d.classId}`,
    confidence: d.confidence,
    bbox: d.bbox,
    centroid: d.maskCentroid,
  }));

  // ── Stage 3+4: Board localization + hinge interpretation ──────────────────

  const tBoard0 = now();
  const boardDiagnostics: BoardLocateDiagnostics = {
    failureCode: null,
    failureDetail: null,
    cornerSource: null,
    boardConfidence: 0,
    candidatesTried: [],
  };
  debug.openCvReady = isOpenCVReady();

  let cvContourCorners: [number, number][] | null = null;
  if (debug.openCvReady) {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = imageSource instanceof ImageBitmap
        ? imageSource
        : await createImageBitmap(imageSource as CanvasImageSource);
      cvContourCorners = await findBoardContourCV(bitmap);
    } catch {
      cvContourCorners = null;
    } finally {
      if (bitmap && imageSource !== bitmap) {
        bitmap.close();
      }
    }
  }
  debug.cvContourDetected = Boolean(cvContourCorners && cvContourCorners.length >= 4);
  debug.cvContourCorners = cvContourCorners ? [...cvContourCorners] : [];

  let boardRef = locateBoard(
    detections,
    preprocessed.params.origW,
    preprocessed.params.origH,
    boardDiagnostics,
    cvContourCorners,
  );
  let boardCornerSourceOverride: string | null = null;

  if (!boardRef && cvContourCorners && cvContourCorners.length >= 4) {
    const cvFallbackBoard = locateBoardFromCorners(cvContourCorners);
    if (cvFallbackBoard) {
      boardRef = cvFallbackBoard;
      boardDiagnostics.failureCode = null;
      boardDiagnostics.failureDetail = null;
      boardCornerSourceOverride = "cv_contour_fallback";
    }
  }

  debug.timings.boardLocate = now() - tBoard0;
  debug.boardFailureCode = boardDiagnostics.failureCode;
  debug.boardFailureDetail = boardDiagnostics.failureDetail;
  debug.boardCornerSource = boardCornerSourceOverride ?? boardDiagnostics.cornerSource;
  debug.boardCornerCandidates = [...boardDiagnostics.candidatesTried];

  if (!boardRef) {
    const baseMsg = "Board not detected. Keep the full square board inside the guide box and avoid glare.";
    const cvMsg = debug.openCvReady
      ? "OpenCV refinement was enabled."
      : "OpenCV is not loaded (optional fallback is disabled).";
    const reason = getBoardFailureReason(debug, boardDiagnostics);
    const code = debug.boardFailureCode ? ` (code: ${debug.boardFailureCode})` : "";
    debug.timings.total = now() - startTotal;
    return buildFailure("board_localization", `${baseMsg} ${cvMsg} ${reason}${code}`, debug);
  }

  debug.boardDetected = true;
  debug.boardConfidence = boardRef.boardConfidence;
  debug.boardFailureCode = null;
  debug.boardFailureDetail = null;
  debug.boardCornerSource = boardCornerSourceOverride ?? boardDiagnostics.cornerSource;
  debug.hingeDetected = boardRef.hingeConfidence > 0;
  debug.hingeEdge = boardRef.hingeEdge;

  // ── Stage 5: Board orientation hypothesis scoring (Fix 1) ────────────────

  const scoredHypotheses = scoreBoardHypotheses(boardRef, detections);
  debug.orientationHypotheses = [...scoredHypotheses]
    .sort((a, b) => a.rotationDeg - b.rotationDeg)
    .map((h) => ({
      rotationDeg: h.rotationDeg,
      score: h.score,
      landingCount: h.landingCount,
      collisionCount: h.collisionCount,
      meanLandingConfidence: h.meanLandingConfidence,
    }));

  let chosen = pickBestBoardHypothesis(boardRef, detections);
  if (!chosen) {
    debug.timings.total = now() - startTotal;
    return buildFailure("board_orientation", "Could not score board orientation hypotheses.", debug);
  }

  // When hinge signal is weak and top hypotheses are tied, keep canonical 0°.
  if (boardRef.hingeConfidence < 0.45 && scoredHypotheses.length >= 2) {
    const gap = scoredHypotheses[0].score - scoredHypotheses[1].score;
    if (gap < 0.02) {
      const canonical = scoredHypotheses.find((h) => h.rotationDeg === 0);
      if (canonical) chosen = canonical;
    }
  }

  boardRef = chosen.boardRef;
  debug.selectedOrientation = Math.floor(chosen.rotationDeg / 90);

  // ── Stage 6: Rectified second pass + candidate assignment (Fix 2/3/4/5/6) ─

  const tMap0 = now();
  let mappedPlacements = mapPiecesToGrid(detections, boardRef);

  try {
    const rectified = await rectifiedPieceDetection(
      imageSource as HTMLImageElement | HTMLCanvasElement | ImageBitmap,
      boardRef,
      runner,
    );
    if (rectified && rectified.detections.length > 0) {
      debug.rectifiedSecondPassUsed = true;
      debug.rectifiedDetectionsCount = rectified.detections.length;
      mappedPlacements = mapRectifiedPiecesToGrid(
        rectified.detections,
        rectified.rectifiedWidth,
        rectified.rectifiedHeight,
      );
    }
  } catch {
    // Keep first-pass mapping when rectified second pass fails.
  }

  debug.timings.pieceMap = now() - tMap0;

  const tVal0 = now();
  const candidateMap = generateCandidates(mappedPlacements, 3);
  const assignment = globalAssign(candidateMap);
  const confirmedPlacements = new Map(
    [...assignment.entries()].map(([pieceId, candidate]) => [pieceId, candidate.placement]),
  );
  const { report } = validatePartialState(mappedPlacements, confirmedPlacements);
  debug.timings.validate = now() - tVal0;

  debug.pieceMappings = mappedPlacements.map((m) => ({
    modelClassId: m.modelClassId,
    classId: m.classId,
    pieceKey: m.pieceKey,
    confidence: m.detectionConfidence,
    cellConfidence: m.cellConfidence,
    candidateCell: m.candidateCell,
    ambiguous: m.ambiguous,
    dropped: report.droppedPieces.includes(m.classId),
  }));

  const keyByInternalId = new Map<number, string>(
    mappedPlacements.map((m) => [m.classId, m.pieceKey]),
  );
  debug.confirmedPlacements = [...confirmedPlacements.entries()].map(([classId, placement]) => ({
    classId,
    pieceKey: keyByInternalId.get(classId) ?? `piece_${classId}`,
    orientationIndex: placement.orientationIndex,
    positions: placement.positions,
    rotationSteps: placement.rotationSteps,
    mirrored: placement.mirrored,
  }));

  // ── Stage 7: Solver + hint ─────────────────────────────────────────────────

  const tHint0 = now();
  const { hint, solverResult } = await new Promise<ReturnType<typeof formatHint>>((resolve) => {
    setTimeout(() => resolve(formatHint(confirmedPlacements)), 0);
  });
  debug.timings.hint = now() - tHint0;
  debug.timings.total = now() - startTotal;

  return {
    ok: true,
    boardRef,
    mappedPlacements,
    report,
    confirmedPlacements,
    hint,
    solverResult,
    debug,
  };
}
