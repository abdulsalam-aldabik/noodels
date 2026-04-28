import { useCallback, useEffect, useRef, useState } from "react";

import type { PiecePlacement as EnginePlacement } from "../engine/types";
import { ScanPipeline } from "../pipeline/ScanPipeline";
import type { ScanResult } from "../pipeline/types";

import BoardGhostOverlay from "./BoardGhostOverlay";
import { buildConfirmedPlacements, countConfirmable } from "./scanConfirm";

type Phase = "starting" | "live" | "loading" | "scanning" | "review";

interface CaptureDiagnostics {
  source: "ImageCapture.takePhoto" | "canvas.drawImage";
  streamWidth: number;
  streamHeight: number;
  capturedWidth: number;
  capturedHeight: number;
  viewportPortrait: boolean;
  rotationApplied: 0 | 90;
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
  const pipelineRef = useRef<ScanPipeline | null>(null);

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

  const ensurePipeline = useCallback(async (): Promise<ScanPipeline> => {
    if (pipelineRef.current) return pipelineRef.current;
    setPhase("loading");
    const pipeline = new ScanPipeline();
    await pipeline.ensureLoaded();
    pipelineRef.current = pipeline;
    return pipeline;
  }, []);

  // ── Shutter ─────────────────────────────────────────────────────────────

  const handleShutter = useCallback(async () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || video.readyState < 2) return;

    const t0 = performance.now();
    const streamW = video.videoWidth;
    const streamH = video.videoHeight;
    if (!streamW || !streamH) return;

    // 1) Try a full-resolution still via ImageCapture.takePhoto when the
    //    browser supports it (Chrome/Android, Safari 16.4+). Falls back to
    //    drawing the current video frame into a canvas.
    let frameBitmap: ImageBitmap | HTMLImageElement | HTMLVideoElement = video;
    let frameW = streamW;
    let frameH = streamH;
    let source: CaptureDiagnostics["source"] = "canvas.drawImage";
    const track = stream.getVideoTracks()[0];
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

    // 2) Orientation correction. Mobile browsers often report the camera's
    //    native sensor dimensions (landscape) even when the phone is held
    //    portrait. The user lines the board up against the on-screen ghost
    //    (hinge at top of the *viewport*), so the captured image must be
    //    rotated to match what the user saw. Otherwise the hinge ends up on
    //    the side of the JPEG and BoardLocator's orientation logic fails.
    const viewportPortrait = window.innerHeight > window.innerWidth;
    const captureLandscape = frameW > frameH;
    let rotationApplied: CaptureDiagnostics["rotationApplied"] = 0;
    if (viewportPortrait && captureLandscape) rotationApplied = 90;
    else if (!viewportPortrait && !captureLandscape) rotationApplied = 90;

    const canvas = document.createElement("canvas");
    if (rotationApplied === 90) {
      canvas.width = frameH;
      canvas.height = frameW;
    } else {
      canvas.width = frameW;
      canvas.height = frameH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (rotationApplied === 90) {
      ctx.translate(frameH, 0);
      ctx.rotate(Math.PI / 2);
    }
    ctx.drawImage(frameBitmap as CanvasImageSource, 0, 0, frameW, frameH);

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
      jpegBytes: blob.size,
      totalMs: Math.round(performance.now() - t0),
    };
    setDiagnostics(diag);
    console.info("[camera] capture", diag);

    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    const url = URL.createObjectURL(blob);
    setCapturedUrl(url);
    setScanResult(null);
    setScanError(null);

    // Freeze camera while scanning
    stopStream();

    try {
      const pipeline = await ensurePipeline();
      setPhase("scanning");
      const img = await loadImage(url);
      const result = await pipeline.run(img);
      setScanResult(result);
      setPhase("review");
    } catch (err) {
      setScanError((err as Error).message);
      setPhase("review");
    }
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

  const handleApply = useCallback(() => {
    if (!scanResult) return;
    const confirmed = buildConfirmedPlacements(scanResult);
    onScanComplete(confirmed);
  }, [onScanComplete, scanResult]);

  // ── Render ──────────────────────────────────────────────────────────────

  const placedCount = scanResult?.boardState?.placements.length ?? 0;
  const confirmableCount = countConfirmable(scanResult);
  const isSuccess = !!scanResult && scanResult.status !== "failed" && placedCount > 0;

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

      {/* Review panel (after capture) */}
      {phase === "review" && (
        <div className="camera-review">
          {scanError && (
            <div className="camera-error-card">
              <strong>Scan failed</strong>
              <p>{scanError}</p>
            </div>
          )}
          {!scanError && !isSuccess && (
            <div className="camera-error-card">
              <strong>Board not detected</strong>
              <p>Make sure the full board is in the ghost outline and the photo is well-lit.</p>
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
                    {scanResult.telemetry.localization.pin && (
                      <div>
                        Pins: matched {scanResult.telemetry.localization.pin.matchedPinCount}
                        /{scanResult.telemetry.localization.pin.detectedPinCount} ·
                        residual {scanResult.telemetry.localization.pin.residualMeanCells.toFixed(2)} cells
                      </div>
                    )}
                  </div>
                  <div className="camera-details-section">
                    <div className="camera-details-title">Pieces</div>
                    <div>Mapper: {scanResult.telemetry.mapping.mapperVersion}</div>
                    <div>Placed ≥ 0.15: {confirmableCount}</div>
                    <div>
                      mask: {scanResult.telemetry.mapping.maskCount} ·
                      color rescue: {scanResult.telemetry.mapping.colorRescueCount} ·
                      unassigned YOLO: {scanResult.telemetry.mapping.unassigned}
                    </div>
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
              <button type="button" className="camera-btn camera-btn--confirm" onClick={handleApply}>
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
