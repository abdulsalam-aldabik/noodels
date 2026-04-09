import { InferenceRunner } from "../inference/InferenceRunner";
import { preprocessImage, loadImageFromFile } from "../inference/preprocessing";
import { locateBoard } from "../vision/BoardLocator";
import { mapPiecesToGrid } from "../vision/PieceMapper";
import { validatePartialState } from "./PartialStateValidator";
import { formatHint } from "./HintFormatter";
import type { ScanResult } from "../vision/visionTypes";

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
  const runner = InferenceRunner.getInstance();

  if (!runner.isReady) {
    return { ok: false, error: "Model not loaded. Please wait for model to finish loading.", stage: "init" };
  }

  // ── Stage 1: Preprocess ────────────────────────────────────────────────────

  let preprocessed: Awaited<ReturnType<typeof preprocessImage>>;
  try {
    const imageSource = source instanceof File
      ? await loadImageFromFile(source)
      : source;
    preprocessed = await preprocessImage(imageSource);
  } catch (err) {
    return { ok: false, error: `Image preprocessing failed: ${String(err)}`, stage: "preprocess" };
  }

  // ── Stage 2: ONNX Inference ────────────────────────────────────────────────

  let detections: Awaited<ReturnType<typeof runner.run>>;
  try {
    detections = await runner.run(preprocessed.tensor, preprocessed.params);
  } catch (err) {
    return { ok: false, error: `Inference failed: ${String(err)}`, stage: "inference" };
  }

  // ── Stage 3+4: Board localization + hinge interpretation ──────────────────

  const boardRef = locateBoard(detections);
  if (!boardRef) {
    return {
      ok: false,
      error: "Board not detected. Ensure the full board is visible and the photo is well-lit.",
      stage: "board_localization",
    };
  }

  // ── Stage 5: Piece mapping ─────────────────────────────────────────────────

  const mappedPlacements = mapPiecesToGrid(detections, boardRef);

  // ── Stage 6: Validation ────────────────────────────────────────────────────

  const { report, confirmedPlacements } = validatePartialState(mappedPlacements);

  // ── Stage 7: Solver + hint ─────────────────────────────────────────────────

  // Run solver in a way that doesn't block the event loop by deferring to next tick.
  // The solver is synchronous but we want the UI to remain responsive.
  const { hint, solverResult } = await new Promise<ReturnType<typeof formatHint>>((resolve) => {
    setTimeout(() => resolve(formatHint(confirmedPlacements)), 0);
  });

  return {
    ok: true,
    boardRef,
    mappedPlacements,
    report,
    confirmedPlacements,
    hint,
    solverResult,
  };
}
