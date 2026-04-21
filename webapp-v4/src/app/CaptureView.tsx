import { useCallback, useEffect, useRef, useState } from "react";

import { ScanPipeline } from "../pipeline/ScanPipeline";
import type { ScanResult } from "../pipeline/types";
import type { PiecePlacement as EnginePlacement } from "../engine/types";
import { generatePlacementsForPiece } from "../engine/placements";
import { BOARD_WIDTH } from "../engine/constants";

// ── Pipeline bridge ───────────────────────────────────────────────────────────

/**
 * Convert the current pipeline's vision PiecePlacement (which has classId,
 * cell, orientation, mirrored) into the engine's PiecePlacement (which has
 * positions[], orientationIndex, rotationSteps, mirrored) by finding the
 * matching canonical placement.
 */
function resolveToEnginePlacement(
  classId: number,
  cell: { row: number; col: number },
  orientationDeg: number,
  mirrored: boolean,
): EnginePlacement | null {
  const targetPos = cell.row * BOARD_WIDTH + cell.col;
  const allPlacements = generatePlacementsForPiece(classId);
  const rotationSteps = orientationDeg / 90;

  // First try: match by rotation + mirror + position coverage
  for (const p of allPlacements) {
    if (
      (p.rotationSteps ?? 0) === rotationSteps &&
      (p.mirrored ?? false) === mirrored &&
      p.positions.includes(targetPos)
    ) {
      return p;
    }
  }

  // Fallback: find the placement that covers the target cell and is closest
  // in rotation/mirror
  const covering = allPlacements.filter((p) => p.positions.includes(targetPos));
  if (covering.length === 0) return null;

  // Pick the best match by centroid distance to the cell
  let best = covering[0];
  let bestDist = Infinity;
  for (const p of covering) {
    let sumRow = 0, sumCol = 0;
    for (const pos of p.positions) {
      sumRow += Math.floor(pos / BOARD_WIDTH);
      sumCol += pos % BOARD_WIDTH;
    }
    const avgRow = sumRow / p.positions.length;
    const avgCol = sumCol / p.positions.length;
    const dr = avgRow - cell.row;
    const dc = avgCol - cell.col;
    const dist = dr * dr + dc * dc;
    if (dist < bestDist) {
      bestDist = dist;
      best = p;
    }
  }

  return best;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CaptureViewProps {
  onScanComplete: (placements: Map<number, EnginePlacement>) => void;
  onCancel: () => void;
}

type Phase = "idle" | "loading" | "scanning" | "done";

// ── Helpers ───────────────────────────────────────────────────────────────────

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      resolve(img);
    };
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = url;
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function CaptureView({ onScanComplete, onCancel }: CaptureViewProps) {
  const pipelineRef = useRef<ScanPipeline | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup preview URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const ensurePipeline = useCallback(async (): Promise<ScanPipeline> => {
    if (pipelineRef.current) return pipelineRef.current;
    setPhase("loading");
    const pipeline = new ScanPipeline();
    await pipeline.ensureLoaded();
    pipelineRef.current = pipeline;
    return pipeline;
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setScanResult(null);
    setError(null);

    try {
      const pipeline = await ensurePipeline();
      setPhase("scanning");
      const img = await loadImageFromFile(file);
      const result = await pipeline.run(img);
      setScanResult(result);
      setPhase("done");
    } catch (err) {
      setError((err as Error).message);
      setPhase("done");
    }

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [previewUrl, ensurePipeline]);

  const handleCapture = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRetry = useCallback(() => {
    setPhase("idle");
    setScanResult(null);
    setError(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleConfirm = useCallback(() => {
    if (!scanResult || scanResult.status === "failed" || !scanResult.boardState) return;

    const confirmed = new Map<number, EnginePlacement>();
    for (const placement of scanResult.boardState.placements) {
      if (placement.ambiguous) continue; // skip ambiguous pieces
      if (placement.confidence < 0.3) continue; // skip low confidence

      const enginePlacement = resolveToEnginePlacement(
        placement.classId,
        placement.cell,
        placement.orientation,
        placement.mirrored,
      );
      if (enginePlacement) {
        confirmed.set(placement.classId, enginePlacement);
      }
    }

    onScanComplete(confirmed);
  }, [scanResult, onScanComplete]);

  // Count placed pieces
  const placedCount = scanResult?.boardState?.placements.length ?? 0;
  const ambiguousCount = scanResult?.boardState?.placements.filter(p => p.ambiguous).length ?? 0;
  const isSuccess = scanResult && scanResult.status !== "failed" && placedCount > 0;

  return (
    <div className="capture-view">
      {/* Header */}
      <div className="capture-header">
        <h2>Scan Board</h2>
        {phase === "loading" && (
          <span className="capture-model-badge" style={{ color: "var(--accent)" }}>
            Loading model…
          </span>
        )}
      </div>

      {/* Instruction */}
      {phase === "idle" && (
        <p className="capture-instruction">
          Take a photo of your IQ Noodles board. Ensure all pieces and the full board outline are visible.
        </p>
      )}

      {/* Image preview */}
      {previewUrl && (
        <div className="capture-preview-wrap">
          <img
            src={previewUrl}
            alt="Board scan"
            className="capture-preview-img"
          />
        </div>
      )}

      {/* Scanning indicator */}
      {phase === "scanning" && (
        <div className="capture-scanning">Analysing board…</div>
      )}

      {/* Error message */}
      {error && (
        <div className="capture-error">
          <strong>Scan failed:</strong> {error}
        </div>
      )}

      {/* Results on success */}
      {isSuccess && phase === "done" && (
        <div className="capture-quality">
          <div className="capture-quality-row">
            <span className="capture-quality-label">Status</span>
            <span className={`capture-quality-dot ${scanResult!.status === "ok" ? "ok" : "warn"}`} />
            <span>{scanResult!.status}</span>
          </div>
          <div className="capture-quality-row">
            <span className="capture-quality-label">Pieces found</span>
            <span className={`capture-quality-dot ${placedCount >= 8 ? "ok" : placedCount >= 4 ? "warn" : "bad"}`} />
            <span>{placedCount} placed{ambiguousCount > 0 ? ` (${ambiguousCount} ambiguous)` : ""}</span>
          </div>
          <div className="capture-quality-row">
            <span className="capture-quality-label">Detections</span>
            <span>{scanResult!.inference.detections.length} total · {scanResult!.inference.durationMs.toFixed(0)}ms</span>
          </div>
          <div className="capture-quality-row">
            <span className="capture-quality-label">Localization</span>
            <span>{scanResult!.telemetry.localization.version} · score {scanResult!.boardRef.cornerScore.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Failed scan */}
      {scanResult?.status === "failed" && phase === "done" && (
        <div className="capture-error">
          Board not detected. Ensure the full board is visible and the photo is well-lit.
        </div>
      )}

      {/* Actions */}
      <div className="capture-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />

        {phase !== "scanning" && phase !== "loading" && (
          <button
            className="capture-btn capture-btn--primary"
            onClick={handleCapture}
          >
            {phase === "idle" ? "Take Photo" : "Retake Photo"}
          </button>
        )}

        {isSuccess && phase === "done" && (
          <button className="capture-btn capture-btn--confirm" onClick={handleConfirm}>
            Apply to Board ({placedCount - ambiguousCount} pieces)
          </button>
        )}

        {phase === "done" && !isSuccess && (
          <button className="capture-btn" onClick={handleRetry}>
            Try Again
          </button>
        )}

        <button className="capture-btn capture-btn--ghost" onClick={onCancel}>
          Back to Manual
        </button>
      </div>
    </div>
  );
}
