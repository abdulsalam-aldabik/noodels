import { useCallback, useEffect, useRef, useState } from "react";
import { InferenceRunner } from "../inference/InferenceRunner";
import type { ModelStatus } from "../inference/InferenceRunner";
import { runScanPipeline } from "../pipeline/ScanPipeline";
import type { ScanResult } from "../vision/visionTypes";

// ── Sub-components ────────────────────────────────────────────────────────────

function ModelStatusBadge({ status }: { status: ModelStatus }) {
  if (status.state === "idle") return null;
  const text =
    status.state === "loading" ? "Loading model…"
    : status.state === "ready" ? "Model ready"
    : `Model error: ${status.message}`;
  const color =
    status.state === "ready" ? "var(--accent-2)"
    : status.state === "error" ? "#f87171"
    : "var(--ink-soft)";
  return (
    <span className="capture-model-badge" style={{ color }}>
      {text}
    </span>
  );
}

function ScanQuality({ result }: { result: Extract<ScanResult, { ok: true }> }) {
  const { boardRef, mappedPlacements, report } = result;
  const detectedCount = mappedPlacements.length;
  const droppedCount = report.droppedPieces.length;
  const confirmedCount = detectedCount - droppedCount;
  const avgConf = mappedPlacements.length > 0
    ? mappedPlacements.reduce((s, m) => s + m.cellConfidence, 0) / mappedPlacements.length
    : 0;

  return (
    <div className="capture-quality">
      <div className="capture-quality-row">
        <span className="capture-quality-label">Board</span>
        <span className="capture-quality-dot ok" />
        <span>{(boardRef.boardConfidence * 100).toFixed(0)}%</span>
      </div>
      <div className="capture-quality-row">
        <span className="capture-quality-label">Hinge</span>
        <span className={`capture-quality-dot ${boardRef.hingeConfidence >= 0.5 ? "ok" : "warn"}`} />
        <span>{boardRef.hingeConfidence >= 0.5 ? `${boardRef.hingeEdge}` : "undetected — assumed top"}</span>
      </div>
      <div className="capture-quality-row">
        <span className="capture-quality-label">Pieces</span>
        <span className="capture-quality-dot ok" />
        <span>{confirmedCount} confirmed{droppedCount > 0 ? `, ${droppedCount} unclear` : ""}</span>
      </div>
      <div className="capture-quality-row">
        <span className="capture-quality-label">Avg confidence</span>
        <span className={`capture-quality-dot ${avgConf >= 0.7 ? "ok" : avgConf >= 0.4 ? "warn" : "bad"}`} />
        <span>{(avgConf * 100).toFixed(0)}%</span>
      </div>
      {report.warnings.length > 0 && (
        <details className="capture-warnings">
          <summary>{report.warnings.length} warning{report.warnings.length !== 1 ? "s" : ""}</summary>
          <ul>
            {report.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

function HintCard({ result }: { result: Extract<ScanResult, { ok: true }> }) {
  const { hint } = result;
  if (!hint) {
    const { report } = result;
    if (report.solvable === false) {
      return (
        <div className="capture-hint capture-hint--error">
          No valid solution found — check for misplaced pieces.
        </div>
      );
    }
    return (
      <div className="capture-hint capture-hint--warn">
        Solver timed out or board is already complete.
      </div>
    );
  }

  const confColor =
    hint.hintConfidence === "high" ? "var(--accent-2)"
    : hint.hintConfidence === "medium" ? "var(--accent)"
    : "#f87171";

  return (
    <div className="capture-hint">
      <div className="capture-hint-header">
        <span>Next piece: </span>
        <strong style={{ fontSize: "1.2rem" }}>{hint.nextPieceKey}</strong>
        <span className="capture-hint-conf" style={{ color: confColor }}>
          {hint.hintConfidence} confidence
        </span>
      </div>
      <div className="capture-hint-detail">
        {hint.alternativePlacements > 0
          ? `${hint.alternativePlacements} alternative position${hint.alternativePlacements !== 1 ? "s" : ""}`
          : "Only one valid position"}
        {" · "}
        {hint.solverTimeMs.toFixed(0)}ms · {hint.statesExplored.toLocaleString()} states
      </div>
    </div>
  );
}

// ── Board polygon overlay ─────────────────────────────────────────────────────

function BoardOverlay({
  imageRef,
  result,
}: {
  imageRef: React.RefObject<HTMLImageElement | null>;
  result: Extract<ScanResult, { ok: true }>;
}) {
  const img = imageRef.current;
  if (!img || !img.complete) return null;

  const scaleX = img.clientWidth / img.naturalWidth;
  const scaleY = img.clientHeight / img.naturalHeight;

  const pts = result.boardRef.boardPolygon
    .map(([x, y]) => `${(x * scaleX).toFixed(1)},${(y * scaleY).toFixed(1)}`)
    .join(" ");

  const centroids = result.mappedPlacements;

  return (
    <svg
      className="capture-overlay-svg"
      viewBox={`0 0 ${img.clientWidth} ${img.clientHeight}`}
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      {/* Board polygon */}
      <polygon
        points={pts}
        fill="rgba(100,210,178,0.12)"
        stroke="rgba(100,210,178,0.85)"
        strokeWidth="2"
      />
      {/* Piece centroids */}
      {centroids.map((m) => {
        const cx = m.imageCentroid[0] * scaleX;
        const cy = m.imageCentroid[1] * scaleY;
        const color =
          m.cellConfidence >= 0.7 ? "#64d2b2"
          : m.cellConfidence >= 0.4 ? "#ffbf3f"
          : "#f87171";
        return (
          <g key={m.classId}>
            <circle cx={cx} cy={cy} r={10} fill={`${color}33`} stroke={color} strokeWidth={2} />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={9}
              fontWeight="bold"
              fill="#fff"
            >
              {m.pieceKey}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ── Main CaptureView ──────────────────────────────────────────────────────────

export interface CaptureViewProps {
  /** Called when the scan succeeds and the user confirms — passes confirmed placements. */
  onScanComplete: (result: Extract<ScanResult, { ok: true }>) => void;
  /** Called when the user wants to go back to manual mode. */
  onCancel: () => void;
}

type ScanPhase =
  | "idle"
  | "scanning"
  | "done";

export default function CaptureView({ onScanComplete, onCancel }: CaptureViewProps) {
  const [modelStatus, setModelStatus] = useState<ModelStatus>(
    InferenceRunner.getInstance().status,
  );
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  // Subscribe to model status changes
  useEffect(() => {
    const runner = InferenceRunner.getInstance();
    // Load model if not already loading
    if (runner.status.state === "idle") {
      runner.load().catch(() => {/* error shown via status listener */});
    }
    return runner.onStatusChange(setModelStatus);
  }, []);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Show preview
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setScanResult(null);
    setScanPhase("scanning");

    const result = await runScanPipeline(file);
    setScanResult(result);
    setScanPhase("done");

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [previewUrl]);

  const handleCameraCapture = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleRetry = useCallback(() => {
    setScanPhase("idle");
    setScanResult(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleConfirm = useCallback(() => {
    if (scanResult?.ok) {
      onScanComplete(scanResult);
    }
  }, [scanResult, onScanComplete]);

  const isReady = modelStatus.state === "ready";
  const successResult = scanResult?.ok ? scanResult : null;
  const errorMessage = scanResult && !scanResult.ok ? scanResult.error : null;

  return (
    <div className="capture-view">
      {/* Header */}
      <div className="capture-header">
        <h2>Scan Board</h2>
        <ModelStatusBadge status={modelStatus} />
      </div>

      {/* Instruction */}
      {scanPhase === "idle" && (
        <p className="capture-instruction">
          Take a photo of your IQ Noodles board. Ensure all pieces and the full board outline are visible.
        </p>
      )}

      {/* Image preview + overlay */}
      {previewUrl && (
        <div className="capture-preview-wrap">
          <img
            ref={imageRef}
            src={previewUrl}
            alt="Board scan"
            className="capture-preview-img"
            onLoad={() => {
              // Force a re-render after the image loads so overlay can read dimensions
              setScanPhase((p) => p);
            }}
          />
          {successResult && (
            <BoardOverlay imageRef={imageRef} result={successResult} />
          )}
        </div>
      )}

      {/* Scanning indicator */}
      {scanPhase === "scanning" && (
        <div className="capture-scanning">Analysing board…</div>
      )}

      {/* Error message */}
      {errorMessage && (
        <div className="capture-error">
          <strong>Scan failed ({!scanResult?.ok ? scanResult?.stage : ""}):</strong> {errorMessage}
        </div>
      )}

      {/* Quality + hint on success */}
      {successResult && scanPhase === "done" && (
        <>
          <ScanQuality result={successResult} />
          <HintCard result={successResult} />
        </>
      )}

      {/* Actions */}
      <div className="capture-actions">
        {/* Hidden file input — accepts both camera and gallery on mobile */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: "none" }}
          onChange={handleFileSelect}
        />

        {scanPhase !== "scanning" && (
          <button
            className="capture-btn capture-btn--primary"
            onClick={handleCameraCapture}
            disabled={!isReady}
          >
            {scanPhase === "idle" ? "Take Photo" : "Retake Photo"}
          </button>
        )}

        {successResult && scanPhase === "done" && (
          <button className="capture-btn capture-btn--confirm" onClick={handleConfirm}>
            Apply to Board
          </button>
        )}

        {scanPhase === "done" && !successResult && (
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
