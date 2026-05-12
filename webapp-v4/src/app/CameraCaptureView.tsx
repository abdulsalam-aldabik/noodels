import { useCallback, useEffect, useRef, useState } from "react";

import type { PiecePlacement as EnginePlacement } from "../engine/types";
import type { ScanResult } from "../pipeline/types";
import { getSharedPipeline } from "../pipeline/pipelinePreload";

import BoardGhostOverlay from "./BoardGhostOverlay";
import ScanRetryPrompt from "./ScanRetryPrompt";
import { uploadDebugBundle } from "./debugSave";
import { buildConfirmedPlacements, countConfirmable } from "./scanConfirm";

/** Capture downscale target — see Change 2 in the capture canvas below. */
const CAPTURE_MAX_LONG_EDGE = 1920;

type Phase = "starting" | "live" | "loading" | "scanning" | "review";

interface CaptureDiagnostics {
  source: "ImageCapture.takePhoto" | "canvas.drawImage";
  streamWidth: number;
  streamHeight: number;
  capturedWidth: number;
  capturedHeight: number;
  viewportPortrait: boolean;
  rotationApplied: -90 | 0 | 90;
  screenAngle: number;
  jpegBytes: number;
  totalMs: number;
}

export interface CameraCaptureViewProps {
  onScanComplete: (placements: Map<number, EnginePlacement>) => void;
  onOpenManual: () => void;
  onExit?: () => void;
}

export default function CameraCaptureView({
  onScanComplete,
  onOpenManual,
  onExit,
}: Readonly<CameraCaptureViewProps>) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturingRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<CaptureDiagnostics | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // ── Camera lifecycle ────────────────────────────────────────────────────

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const acquireCamera = useCallback(async (): Promise<void> => {
    // Yield one microtask so any setState below never runs synchronously
    // inside the caller's effect/render — satisfies react-hooks/set-state-in-effect.
    await Promise.resolve();

    if (!window.isSecureContext) {
      setError(
        `Camera requires a secure (https) connection. You opened this page at ${window.location.protocol}//${window.location.host} — reopen it via https:// and accept the dev certificate warning.`,
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser does not support live camera capture. Try Chrome or Safari on a phone.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          // Ask for the largest reasonable frame — the model benefits from
          // more pixels on the board. Browsers clamp to what the hardware can
          // do, so "ideal" is the right knob here.
          width: { ideal: 3840 },
          height: { ideal: 2160 },
        },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setPhase("live");
    } catch (err) {
      const msg = (err as Error).message || String(err);
      if (msg.toLowerCase().includes("permission") || msg.toLowerCase().includes("denied")) {
        setError("Camera permission is blocked. Enable it in your browser settings and try again.");
      } else if (msg.toLowerCase().includes("secure")) {
        setError("Camera requires a secure (https) connection. Open the app via https or localhost.");
      } else {
        setError(`Could not start camera: ${msg}`);
      }
    }
  }, []);

  const startStream = useCallback(async () => {
    setError(null);
    setPhase("starting");
    await acquireCamera();
  }, [acquireCamera]);

  useEffect(() => {
    // Acquiring the camera is an external-system subscription (MediaStream).
    // React phase/error state only settles after the async getUserMedia call
    // resolves, so the lint rule's cascading-render concern does not apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    acquireCamera();
    return () => stopStream();
  }, [acquireCamera, stopStream]);

  useEffect(() => {
    return () => {
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
  }, [capturedUrl]);

  const ensurePipeline = useCallback(async () => {
    const pipeline = getSharedPipeline();
    if (!pipeline.isLoaded) {
      setPhase("loading");
      await pipeline.ensureLoaded();
    }
    return pipeline;
  }, []);

  // ── Shutter ─────────────────────────────────────────────────────────────

  const handleShutter = useCallback(async () => {
    if (capturingRef.current) return;
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.readyState < 2) return;

    capturingRef.current = true;
    const track = stream.getVideoTracks()[0];

    const t0 = performance.now();
    const streamW = video.videoWidth;
    const streamH = video.videoHeight;
    if (!streamW || !streamH) { capturingRef.current = false; return; }

    // 1) Try a full-resolution still via ImageCapture.takePhoto when the
    //    browser supports it (Chrome/Android, Safari 16.4+). Falls back to
    //    drawing the current video frame into a canvas.
    let frameBitmap: ImageBitmap | HTMLImageElement | HTMLVideoElement = video;
    let frameW = streamW;
    let frameH = streamH;
    let source: CaptureDiagnostics["source"] = "canvas.drawImage";
    const AnyImageCapture = (window as unknown as { ImageCapture?: typeof ImageCapture }).ImageCapture;
    if (track && AnyImageCapture) {
      try {
        const ic = new AnyImageCapture(track);
        const photoBlob = await ic.takePhoto();
        const bmp = await createImageBitmap(photoBlob);
        frameBitmap = bmp;
        frameW = bmp.width;
        frameH = bmp.height;
        source = "ImageCapture.takePhoto";
      } catch (e) {
        // takePhoto can fail mid-stream on some devices — fall back silently.
        console.warn("[camera] ImageCapture.takePhoto failed, using video frame:", e);
      }
    }

    // Rotation disabled — capture the image as-is. The board locator and
    // pin-based homography handle arbitrary orientations without needing
    // the captured frame to be rotated to match viewport orientation.
    const viewportPortrait = window.innerHeight > window.innerWidth;
    const screenAngle = (typeof screen !== "undefined" && screen.orientation)
      ? screen.orientation.angle
      : (globalThis as unknown as { orientation?: number }).orientation ?? 0;
    const rotationApplied: CaptureDiagnostics["rotationApplied"] = 0;

    // Downsample so the long edge is at most CAPTURE_MAX_LONG_EDGE px. The YOLO
    // model letterboxes to 640², so ~2 megapixel input is plenty — going higher
    // shrinks small features (especially the 21 board pins) below the model's
    // receptive field on 4K phone captures, which collapses pin-anchored
    // homography matching into the less-accurate corner fallback.
    const s = Math.min(1, CAPTURE_MAX_LONG_EDGE / Math.max(frameW, frameH));
    const scaledW = Math.round(frameW * s);
    const scaledH = Math.round(frameH * s);

    const canvas = document.createElement("canvas");
    canvas.width = scaledW;
    canvas.height = scaledH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(frameBitmap as CanvasImageSource, 0, 0, frameW, frameH, 0, 0, scaledW, scaledH);

    // Release the ImageBitmap if we allocated one
    if (frameBitmap instanceof ImageBitmap) frameBitmap.close();

    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95),
    );
    if (!blob) {
      setScanError("Could not capture frame from camera.");
      return;
    }

    const diag: CaptureDiagnostics = {
      source,
      streamWidth: streamW,
      streamHeight: streamH,
      capturedWidth: canvas.width,
      capturedHeight: canvas.height,
      viewportPortrait,
      rotationApplied,
      screenAngle,
      jpegBytes: blob.size,
      totalMs: Math.round(performance.now() - t0),
    };
    setDiagnostics(diag);
    if (import.meta.env.DEV) console.info("[camera] capture", diag);

    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    const url = URL.createObjectURL(blob);
    setCapturedUrl(url);
    setScanResult(null);
    setScanError(null);

    // Freeze camera while scanning
    stopStream();

    let result: ScanResult | null = null;
    let scanErrorMessage: string | null = null;
    try {
      const pipeline = await ensurePipeline();
      setPhase("scanning");
      const img = await loadImage(url);
      result = await pipeline.run(img);
      setScanResult(result);
      setPhase("review");
    } catch (err) {
      scanErrorMessage = (err as Error).message;
      setScanError(scanErrorMessage);
      setPhase("review");
    }

    // Dev-only: ship the captured JPEG + every scan artifact to
    // <projectRoot>/phone-debug/<bundle>/. The Vite middleware in
    // vite.config.ts handles the write. Failures are logged and ignored —
    // the scan UI is unaffected.
    if (import.meta.env.DEV) {
      uploadDebugBundle(blob, result, { ...diag, scanError: scanErrorMessage })
        .then((bundle) => console.info("[debug-save] saved bundle", bundle))
        .catch((err) => console.warn("[debug-save] failed", err));
    }

    capturingRef.current = false;
  }, [capturedUrl, ensurePipeline, stopStream]);

  const handleRetake = useCallback(() => {
    if (capturedUrl) {
      URL.revokeObjectURL(capturedUrl);
      setCapturedUrl(null);
    }
    setScanResult(null);
    setScanError(null);
    startStream();
  }, [capturedUrl, startStream]);

  const handleApply = useCallback((lowConfidence?: boolean) => {
    if (!scanResult) return;
    const confirmed = buildConfirmedPlacements(scanResult);
    // Task 6: If lowConfidence flag is set, the solver should be warned.
    if (lowConfidence) {
      console.warn("[scan] applying low-confidence scan result — solver may produce incomplete solutions");
    }
    onScanComplete(confirmed);
  }, [onScanComplete, scanResult]);

  // ── Render ──────────────────────────────────────────────────────────────

  const placedCount = scanResult?.boardState?.placements.length ?? 0;
  const confirmableCount = countConfirmable(scanResult);
  const isSuccess = !!scanResult && scanResult.status !== "failed" && scanResult.status !== "rejected_condition" && placedCount > 0;
  const retryInfo = scanResult?.retryInfo;
  const showRetryPrompt = retryInfo?.retryTriggered && phase === "review";

  return (
    <div className="camera-view">
      {/* Live video layer */}
      <video
        ref={videoRef}
        className="camera-video"
        playsInline
        muted
        autoPlay
      />

      {/* Frozen capture preview on top of the (stopped) video */}
      {capturedUrl && (
        <img src={capturedUrl} alt="" className="camera-frozen" />
      )}

      {/* Ghost overlay — only while live (not while reviewing a captured frame) */}
      {phase === "live" && <BoardGhostOverlay />}

      {/* Top bar */}
      <div className="camera-topbar">
        {onExit && (
          <button
            type="button"
            className="camera-chip camera-chip--ghost"
            onClick={onExit}
            aria-label="Close scanner"
          >
            ✕
          </button>
        )}
        <span className="camera-chip camera-chip--orient">Hinge up ↑</span>
      </div>

      {/* Center status */}
      {phase === "starting" && !error && (
        <div className="camera-status">Starting camera…</div>
      )}
      {phase === "loading" && (
        <div className="camera-status">Loading model…</div>
      )}
      {phase === "scanning" && (
        <div className="camera-status camera-status--pulse">Analysing board…</div>
      )}

      {error && (
        <div className="camera-error-card">
          <strong>Camera unavailable</strong>
          <p>{error}</p>
          <button type="button" className="camera-btn" onClick={startStream}>
            Try again
          </button>
        </div>
      )}

      {/* Task 6B: Retry prompt on detection failure */}
      {showRetryPrompt && retryInfo && (
        <ScanRetryPrompt
          retryInfo={retryInfo}
          onRetake={handleRetake}
          onUseAnyway={() => handleApply(true)}
        />
      )}

      {/* Review panel (after capture) — only show if no retry prompt */}
      {phase === "review" && !showRetryPrompt && (
        <div className="camera-review">
          {scanError && (
            <div className="camera-error-card">
              <strong>Scan failed</strong>
              <p>{scanError}</p>
            </div>
          )}
          {!scanError && !isSuccess && (
            <div className="camera-error-card">
              <strong>{diagnoseFailure(scanResult).title}</strong>
              <p>{diagnoseFailure(scanResult).hint}</p>
            </div>
          )}
          {!scanError && isSuccess && scanResult && (
            <div className="camera-review-summary">
              <div className="camera-review-row">
                <span className={`capture-quality-dot ${placedCount >= 8 ? "ok" : placedCount >= 4 ? "warn" : "bad"}`} />
                <span><strong>{placedCount}</strong> pieces detected</span>
              </div>
              <div className="camera-review-meta">
                {scanResult.inference.detections.length} detections · {scanResult.inference.durationMs.toFixed(0)} ms
              </div>
            </div>
          )}

          {(scanResult || diagnostics) && (
            <button
              type="button"
              className="camera-details-toggle"
              onClick={() => setShowDetails((v) => !v)}
            >
              {showDetails ? "Hide details ▲" : "Show details ▼"}
            </button>
          )}

          {showDetails && (
            <div className="camera-details">
              {diagnostics && (
                <div className="camera-details-section">
                  <div className="camera-details-title">Capture</div>
                  <div>Source: {diagnostics.source}</div>
                  <div>
                    Stream: {diagnostics.streamWidth}×{diagnostics.streamHeight} ·
                    Saved: {diagnostics.capturedWidth}×{diagnostics.capturedHeight}
                  </div>
                  <div>
                    Viewport: {diagnostics.viewportPortrait ? "portrait" : "landscape"} ·
                    Screen: {diagnostics.screenAngle}° ·
                    Rotation: {diagnostics.rotationApplied}° ·
                    JPEG: {(diagnostics.jpegBytes / 1024).toFixed(0)} KB
                  </div>
                  <div>Total: {diagnostics.totalMs} ms</div>
                </div>
              )}
              {scanResult && (
                <>
                  <div className="camera-details-section">
                    <div className="camera-details-title">Inference</div>
                    <div>
                      {scanResult.inference.detections.length} detections ·
                      {" "}{scanResult.inference.durationMs.toFixed(0)} ms
                    </div>
                    <div>
                      Classes: {formatClassHistogram(scanResult)}
                    </div>
                  </div>
                  <div className="camera-details-section">
                    <div className="camera-details-title">Localization</div>
                    <div>
                      Status: {scanResult.telemetry.localization.status} ·
                      Version: {scanResult.telemetry.localization.version}
                    </div>
                    <div>Corner score: {scanResult.boardRef.cornerScore.toFixed(2)}</div>
                    <div>Homography condition: {scanResult.telemetry.rectification.homographyCondition.toFixed(0)} {scanResult.telemetry.rectification.homographyGatePassed ? "✓" : "✗ REJECTED"}</div>
                    {scanResult.telemetry.localization.pin && (
                      <div>
                        Pins: matched {scanResult.telemetry.localization.pin.matchedPinCount}
                        /{scanResult.telemetry.localization.pin.detectedPinCount} ·
                        residual {scanResult.telemetry.localization.pin.residualMeanCells.toFixed(2)} cells
                      </div>
                    )}
                    {scanResult.telemetry.localization.gridFitResidualMax !== undefined && (
                      <div>Grid fit residual max: {scanResult.telemetry.localization.gridFitResidualMax.toFixed(3)} cells</div>
                    )}
                  </div>
                  <div className="camera-details-section">
                    <div className="camera-details-title">Pieces</div>
                    <div>Mapper: {scanResult.telemetry.mapping.mapperVersion} · Policy: {scanResult.telemetry.mapping.placementPolicy}</div>
                    <div>Placed ≥ 0.15: {confirmableCount}</div>
                    <div>
                      mask: {scanResult.telemetry.mapping.maskCount} ·
                      color rescue: {scanResult.telemetry.mapping.colorRescueCount} ·
                      unassigned YOLO: {scanResult.telemetry.mapping.unassigned}
                    </div>
                    {scanResult.telemetry.mapping.droppedDuplicateCount > 0 && (
                      <div>Dropped duplicates: {scanResult.telemetry.mapping.droppedDuplicateCount}</div>
                    )}
                    {scanResult.telemetry.mapping.droppedColorClassIds.length > 0 && (
                      <div>
                        Dropped color claims: [
                        {scanResult.telemetry.mapping.droppedColorClassIds.join(", ")}
                        ]
                      </div>
                    )}
                    {scanResult.boardState?.placements.slice(0, 11).map((p, i) => (
                      <div key={i} className="camera-details-placement">
                        cls {p.classId} · conf {p.confidence.toFixed(2)} · ori {p.orientation}°
                        {p.mirrored ? " ·m" : ""}
                        {p.source ? ` · ${p.source === "yolo-mask" ? "mask" : "color"}` : ""}
                        {p.ambiguous ? " · ⚠ ambiguous" : ""}
                        {p.placedDespiteAmbiguity ? " · placed despite" : ""}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          <div className="camera-review-actions">
            <button type="button" className="camera-btn camera-btn--ghost" onClick={handleRetake}>
              Retake
            </button>
            {isSuccess && (
              <button type="button" className="camera-btn camera-btn--confirm" onClick={() => handleApply()}>
                Apply ({confirmableCount})
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bottom bar (live) */}
      {phase === "live" && !error && (
        <div className="camera-bottombar">
          <button
            type="button"
            className="camera-advanced-link"
            onClick={onOpenManual}
          >
            Advanced
          </button>
          <button
            type="button"
            className="camera-shutter"
            onClick={handleShutter}
            aria-label="Take photo"
          >
            <span className="camera-shutter-inner" />
          </button>
          <span className="camera-advanced-spacer" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/**
 * Map the scan telemetry to actionable user copy. Each branch keys off a
 * distinct failure signal so retakes target the actual problem rather than
 * the generic "board not detected".
 */
function diagnoseFailure(result: ScanResult | null): { title: string; hint: string } {
  if (!result) {
    return {
      title: "Board not detected",
      hint: "Make sure the full board is in the ghost outline and the photo is well-lit.",
    };
  }
  const detections = result.inference.detections.length;
  const loc = result.telemetry.localization;
  const placed = result.boardState?.placements.length ?? 0;
  const unassigned = result.telemetry.mapping.unassigned;
  const matchedPins = loc.pin?.matchedPinCount ?? 0;

  if (detections === 0) {
    return {
      title: "Board not visible",
      hint: "Improve lighting or move closer — nothing was detected in the frame.",
    };
  }
  if (result.status === "rejected_condition") {
    return {
      title: "Board angle too steep",
      hint: "Hold the camera directly above the board — the perspective distortion is too high.",
    };
  }
  if (loc.status === "failed") {
    return {
      title: "Board not detected",
      hint: "Center the full board inside the on-screen outline and try again.",
    };
  }
  if (matchedPins > 0 && matchedPins < 8) {
    return {
      title: "Few pins visible",
      hint: `Only ${matchedPins} of 21 pins matched — move closer or reduce glare.`,
    };
  }
  if (loc.cornerScore < 0.55) {
    return {
      title: "Board edge unclear",
      hint: "Hold the phone parallel to the board so all four edges are visible.",
    };
  }
  if (placed < 4 && unassigned > 0) {
    return {
      title: "Lighting too uneven",
      hint: "Try diffuse, even lighting — pieces were detected but couldn't be mapped.",
    };
  }
  return {
    title: "Not enough pieces detected",
    hint: "Move closer or adjust lighting and try again.",
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load captured frame"));
    img.src = url;
  });
}

function formatClassHistogram(result: ScanResult): string {
  const hist = result.telemetry.inference.classHistogram ?? {};
  const entries = Object.entries(hist).filter(([, n]) => n > 0);
  if (entries.length === 0) return "none";
  return entries.map(([k, n]) => `${k}:${n}`).join(" ");
}
