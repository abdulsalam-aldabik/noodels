import { useCallback, useEffect, useRef, useState } from "react";
import { InferenceRunner } from "../inference/InferenceRunner";
import type { ModelStatus } from "../inference/InferenceRunner";
import { runScanPipeline } from "../pipeline/ScanPipeline";
import type { ScanResult } from "../vision/visionTypes";
import { BOARD_GRID, buildInternalGridFractions } from "../board/gridGeometry";

// ── Sub-components ────────────────────────────────────────────────────────────

function ModelStatusBadge({ status }: Readonly<{ status: ModelStatus }>) {
  if (status.state === "idle") return null;
  let text: string;
  if (status.state === "loading") text = "Loading model…";
  else if (status.state === "ready") text = "Model ready";
  else text = `Model error: ${status.message}`;
  let color: string;
  if (status.state === "ready") color = "var(--accent-2)";
  else if (status.state === "error") color = "#f87171";
  else color = "var(--ink-soft)";
  return (
    <span className="capture-model-badge" style={{ color }}>
      {text}
    </span>
  );
}

function HintCard({ result }: Readonly<{ result: Extract<ScanResult, { ok: true }> }>) {
  const { hint } = result;
  if (!hint) {
    if (result.report.solvable === false) {
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

  let confColor: string;
  if (hint.hintConfidence === "high") confColor = "var(--accent-2)";
  else if (hint.hintConfidence === "medium") confColor = "var(--accent)";
  else confColor = "#f87171";

  return (
    <div className="capture-hint">
      <div className="capture-hint-header">
        <span>Next piece: </span>
        <strong style={{ fontSize: "1.2rem" }}>{hint.nextPieceKey}</strong>
        <span className="capture-hint-conf" style={{ color: confColor }}>
          {hint.hintConfidence} confidence
        </span>
      </div>
    </div>
  );
}

// ── Main CaptureView ──────────────────────────────────────────────────────────

export interface CaptureViewProps {
  /** Called when the scan succeeds and the user confirms — passes confirmed placements. */
  onScanComplete: (result: Extract<ScanResult, { ok: true }>) => void;
  /** Called when the user wants to go back to manual mode. */
  onCancel: () => void;
}

type ScanPhase = "idle" | "scanning" | "done";

const GUIDE_VERTICAL_LINE_FRACTIONS = buildInternalGridFractions(BOARD_GRID.cols);
const GUIDE_HORIZONTAL_LINE_FRACTIONS = buildInternalGridFractions(BOARD_GRID.rows);

function stopStream(stream: MediaStream | null): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    track.stop();
  }
}

export default function CaptureView({ onScanComplete, onCancel }: Readonly<CaptureViewProps>) {
  const [modelStatus, setModelStatus] = useState<ModelStatus>(
    InferenceRunner.getInstance().status,
  );
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Subscribe to model status changes
  useEffect(() => {
    const runner = InferenceRunner.getInstance();
    if (runner.status.state === "idle") {
      runner.load().catch(() => {/* error shown via status listener */});
    }
    return runner.onStatusChange(setModelStatus);
  }, []);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [previewUrl]);

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    const video = videoRef.current;
    video.srcObject = streamRef.current;
    video.play().catch(() => {
      setCameraError("Camera preview failed to start.");
    });
  }, [cameraOpen]);

  const processCapturedFile = useCallback(async (
    file: File,
    sourceType: "camera" | "upload",
  ) => {
    const url = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
    setScanResult(null);
    setScanPhase("scanning");

    const result = await runScanPipeline(file, sourceType);
    setScanResult(result);
    setScanPhase("done");
  }, []);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    await processCapturedFile(file, "upload");

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [processCapturedFile]);

  const closeGuidedCamera = useCallback(() => {
    setCameraOpen(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    stopStream(streamRef.current);
    streamRef.current = null;
  }, []);

  const handleCameraCapture = useCallback(async () => {
    setCameraError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      fileInputRef.current?.click();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1920 },
          aspectRatio: { ideal: 1 },
        },
        audio: false,
      });
      stopStream(streamRef.current);
      streamRef.current = stream;
      setCameraOpen(true);
    } catch {
      setCameraError("Could not open guided camera. Falling back to device photo picker.");
      fileInputRef.current?.click();
    }
  }, []);

  const handleGuidedCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setCameraError("Camera is not ready yet. Please try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setCameraError("Capture failed. Could not access canvas context.");
      return;
    }

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/jpeg", 0.92);
    });

    if (!blob) {
      setCameraError("Capture failed. Please try again.");
      return;
    }

    const file = new File([blob], `guided-capture-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });

    closeGuidedCamera();
    await processCapturedFile(file, "camera");
  }, [closeGuidedCamera, processCapturedFile]);

  const handleRetry = useCallback(() => {
    setScanPhase("idle");
    setScanResult(null);
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  }, [previewUrl]);

  const handleConfirm = useCallback(() => {
    if (scanResult?.ok) onScanComplete(scanResult);
  }, [scanResult, onScanComplete]);

  const isReady = modelStatus.state === "ready";
  const successResult = scanResult?.ok ? scanResult : null;
  const errorMessage = scanResult && !scanResult.ok ? scanResult.error : null;
  const errorStage = scanResult && !scanResult.ok ? scanResult.stage : "";

  return (
    <div className="capture-view">
      <div className="capture-header">
        <h2>Scan Board</h2>
        <ModelStatusBadge status={modelStatus} />
      </div>

      {scanPhase === "idle" && (
        <p className="capture-instruction">
          Use the guided camera and align the board inside the square frame. Keep
          the hinge edge at the top when taking the photo.
        </p>
      )}

      {cameraOpen && (
        <div className="capture-camera">
          <div className="capture-camera-viewport">
            <video ref={videoRef} className="capture-camera-video" playsInline muted autoPlay />
            <div className="capture-camera-guide" aria-hidden="true">
              <div className="guide-frame">
                <div className="guide-corner guide-corner--tl" />
                <div className="guide-corner guide-corner--tr" />
                <div className="guide-corner guide-corner--bl" />
                <div className="guide-corner guide-corner--br" />
                <div className="guide-hinge-bar">
                  <span className="guide-hinge-label">HINGE ↑</span>
                </div>
                <svg className="guide-grid" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {GUIDE_VERTICAL_LINE_FRACTIONS.map((fraction) => (
                    <line
                      key={`v${fraction}`}
                      x1={fraction * 100}
                      y1={0}
                      x2={fraction * 100}
                      y2={100}
                      stroke="white"
                      strokeWidth="0.3"
                    />
                  ))}
                  {GUIDE_HORIZONTAL_LINE_FRACTIONS.map((fraction) => (
                    <line
                      key={`h${fraction}`}
                      x1={0}
                      y1={fraction * 100}
                      x2={100}
                      y2={fraction * 100}
                      stroke="white"
                      strokeWidth="0.3"
                    />
                  ))}
                </svg>
              </div>
              <p className="guide-instruction">Point camera straight down — hinge at top</p>
            </div>
          </div>
          <div className="capture-camera-actions">
            <button className="capture-btn capture-btn--confirm" onClick={handleGuidedCapture}>
              Capture
            </button>
            <button className="capture-btn" onClick={closeGuidedCamera}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {previewUrl && (
        <div className="capture-preview-wrap">
          <img src={previewUrl} alt="Board scan" className="capture-preview-img" />
        </div>
      )}

      {scanPhase === "scanning" && (
        <div className="capture-scanning">Analysing board…</div>
      )}

      {errorMessage && (
        <div className="capture-error">
          <strong>Scan failed{errorStage ? ` (${errorStage})` : ""}:</strong> {errorMessage}
        </div>
      )}

      {cameraError && (
        <div className="capture-error">
          <strong>Camera:</strong> {cameraError}
        </div>
      )}

      {successResult && scanPhase === "done" && <HintCard result={successResult} />}

      <div className="capture-actions">
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
            disabled={!isReady || cameraOpen}
          >
            {scanPhase === "idle" ? "Open Guided Camera" : "Retake with Guided Camera"}
          </button>
        )}

        {scanPhase !== "scanning" && !cameraOpen && (
          <button className="capture-btn" onClick={() => fileInputRef.current?.click()}>
            Choose Existing Photo
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
