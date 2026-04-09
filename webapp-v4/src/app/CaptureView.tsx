import { useCallback, useEffect, useRef, useState } from "react";
import { InferenceRunner } from "../inference/InferenceRunner";
import type { ModelStatus } from "../inference/InferenceRunner";
import { BOARD_HEIGHT, BOARD_WIDTH } from "../engine/constants";
import { runScanPipeline } from "../pipeline/ScanPipeline";
import type { ScanResult } from "../vision/visionTypes";
import { loadOpenCV } from "../vision/OpenCVProcessor";
import { warpImageToCanonicalBoard } from "../vision/RectifiedDetector";

type DebugArtifacts = Record<string, string | null>;

type ScanSourceType = "camera_live" | "file_upload";

async function loadImageFromDataUrl(dataUrl: string | null): Promise<HTMLImageElement | null> {
  if (!dataUrl) return null;
  return await new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = dataUrl;
  });
}

async function fileToDataUrl(file: File): Promise<string | null> {
  try {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read uploaded file"));
      reader.readAsDataURL(file);
    });
  } catch {
    return null;
  }
}

function imageBitmapToDataUrl(bitmap: ImageBitmap): string | null {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  } catch {
    return null;
  }
}

async function normalizeRawDataUrl(
  source: File | ImageBitmap,
  imageDataUrl: string | null,
): Promise<string | null> {
  if (imageDataUrl) return imageDataUrl;
  if (source instanceof File) return await fileToDataUrl(source);
  return imageBitmapToDataUrl(source);
}

async function buildYoloOverlayDataUrl(imageDataUrl: string | null, result: ScanResult): Promise<string | null> {
  const img = await loadImageFromDataUrl(imageDataUrl);

  if (!img) return null;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);
  ctx.lineWidth = 3;
  ctx.font = "20px sans-serif";

  for (const det of result.debug.allDetections) {
    const [x1, y1, x2, y2] = det.bbox;
    const w = Math.max(1, x2 - x1);
    const h = Math.max(1, y2 - y1);
    const isBoard = det.classId === 11;
    ctx.strokeStyle = isBoard ? "#00ff99" : "#ffcc33";
    ctx.fillStyle = isBoard ? "rgba(0,255,153,0.2)" : "rgba(255,204,51,0.15)";
    ctx.strokeRect(x1, y1, w, h);
    ctx.fillRect(x1, y1, w, h);
    const label = `${det.label} ${(det.confidence * 100).toFixed(1)}%`;
    ctx.fillStyle = "#111";
    const tw = Math.ceil(ctx.measureText(label).width) + 10;
    ctx.fillRect(x1, Math.max(0, y1 - 28), tw, 24);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, x1 + 5, Math.max(18, y1 - 10));
  }

  if (result.ok) {
    const pts = result.boardRef.boardPolygon;
    if (pts.length >= 3) {
      ctx.strokeStyle = "#22d3ee";
      ctx.fillStyle = "rgba(34,211,238,0.15)";
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  return canvas.toDataURL("image/jpeg", 0.88);
}

async function buildOpenCvOverlayDataUrl(imageDataUrl: string | null, result: ScanResult): Promise<string | null> {
  const img = await loadImageFromDataUrl(imageDataUrl);
  if (!img) return null;

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(img, 0, 0);

  const cvCorners = result.debug.cvContourCorners;
  if (cvCorners.length >= 4) {
    ctx.strokeStyle = "#fb7185";
    ctx.fillStyle = "rgba(251,113,133,0.2)";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cvCorners[0][0], cvCorners[0][1]);
    for (let i = 1; i < cvCorners.length; i += 1) {
      ctx.lineTo(cvCorners[i][0], cvCorners[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  if (result.ok) {
    const corners = result.boardRef.boardCorners;
    const labels = ["TL", "TR", "BR", "BL"];

    ctx.strokeStyle = "#22d3ee";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(corners[0][0], corners[0][1]);
    for (let i = 1; i < corners.length; i += 1) ctx.lineTo(corners[i][0], corners[i][1]);
    ctx.closePath();
    ctx.stroke();

    ctx.font = "24px sans-serif";
    for (let i = 0; i < corners.length; i += 1) {
      const [x, y] = corners[i];
      ctx.fillStyle = "#f8fafc";
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#0f172a";
      ctx.fillText(labels[i], x + 10, y - 10);
    }
  }

  const info = [
    `OpenCV ready: ${result.debug.openCvReady}`,
    `CV contour: ${result.debug.cvContourDetected}`,
    `Corner source: ${result.debug.boardCornerSource ?? "n/a"}`,
    `Selected orientation: ${result.debug.selectedOrientation * 90}deg`,
  ];

  ctx.fillStyle = "rgba(15,23,42,0.75)";
  ctx.fillRect(16, 16, 450, 120);
  ctx.fillStyle = "#f8fafc";
  ctx.font = "20px sans-serif";
  info.forEach((line, idx) => ctx.fillText(line, 28, 48 + idx * 24));

  return canvas.toDataURL("image/jpeg", 0.9);
}

async function buildRectifiedArtifacts(
  imageDataUrl: string | null,
  result: ScanResult,
): Promise<{ rectified: string | null; rectifiedMapped: string | null }> {
  if (!result.ok) return { rectified: null, rectifiedMapped: null };

  const img = await loadImageFromDataUrl(imageDataUrl);
  if (!img) return { rectified: null, rectifiedMapped: null };

  const rectifiedCanvas = warpImageToCanonicalBoard(img, result.boardRef, 640);
  if (!rectifiedCanvas) return { rectified: null, rectifiedMapped: null };

  const rectified = rectifiedCanvas.toDataURL("image/jpeg", 0.9);

  const mappedCanvas = document.createElement("canvas");
  mappedCanvas.width = rectifiedCanvas.width;
  mappedCanvas.height = rectifiedCanvas.height;
  const ctx = mappedCanvas.getContext("2d");
  if (!ctx) return { rectified, rectifiedMapped: null };

  ctx.drawImage(rectifiedCanvas, 0, 0);

  // Draw board grid in canonical space.
  ctx.strokeStyle = "rgba(56,189,248,0.35)";
  ctx.lineWidth = 1;
  for (let c = 0; c < BOARD_WIDTH; c += 1) {
    const x = (c / Math.max(1, BOARD_WIDTH - 1)) * (mappedCanvas.width - 1);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, mappedCanvas.height - 1);
    ctx.stroke();
  }
  for (let r = 0; r < BOARD_HEIGHT; r += 1) {
    const y = (r / Math.max(1, BOARD_HEIGHT - 1)) * (mappedCanvas.height - 1);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(mappedCanvas.width - 1, y);
    ctx.stroke();
  }

  const dropped = new Set(result.report.droppedPieces);
  const rotationByKey = new Map(result.debug.confirmedPlacements.map((p) => [p.pieceKey, p.rotationSteps ?? 0]));

  ctx.font = "18px sans-serif";
  for (const mapped of result.mappedPlacements) {
    const [col, row] = mapped.boardCentroid;
    const x = (col / Math.max(1, BOARD_WIDTH - 1)) * (mappedCanvas.width - 1);
    const y = (row / Math.max(1, BOARD_HEIGHT - 1)) * (mappedCanvas.height - 1);
    const isDropped = dropped.has(mapped.classId);

    ctx.fillStyle = isDropped ? "#fb7185" : "#4ade80";
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.fill();

    const rot = rotationByKey.get(mapped.pieceKey);
    const label = rot !== undefined
      ? `${mapped.pieceKey} r${rot * 90}`
      : `${mapped.pieceKey}`;

    const tw = Math.ceil(ctx.measureText(label).width) + 8;
    ctx.fillStyle = "rgba(15,23,42,0.75)";
    ctx.fillRect(x + 9, y - 18, tw, 22);
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(label, x + 13, y - 2);
  }

  return {
    rectified,
    rectifiedMapped: mappedCanvas.toDataURL("image/jpeg", 0.9),
  };
}

function ModelStatusBadge({ status }: { status: ModelStatus }) {
  if (status.state === "idle") return null;
  if (status.state === "loading") return <span className="capture-model-badge">Loading model…</span>;
  if (status.state === "ready") return <span className="capture-model-badge" style={{ color: "var(--accent-2)" }}>Model ready</span>;
  return <span className="capture-model-badge" style={{ color: "#f87171" }}>Model error: {status.message}</span>;
}

export interface CaptureViewProps {
  onScanComplete: (result: Extract<ScanResult, { ok: true }>) => void;
}

type ScanPhase =
  | "idle"
  | "scanning"
  | "done";

export default function CaptureView({ onScanComplete }: CaptureViewProps) {
  const [modelStatus, setModelStatus] = useState<ModelStatus>(
    InferenceRunner.getInstance().status,
  );
  const [scanPhase, setScanPhase] = useState<ScanPhase>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [cameraMode, setCameraMode] = useState<"live" | "native">("live");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [lastFrameDataUrl, setLastFrameDataUrl] = useState<string | null>(null);

  // Subscribe to model status changes
  useEffect(() => {
    const runner = InferenceRunner.getInstance();
    // Load model if not already loading
    if (runner.status.state === "idle") {
      runner.load().catch(() => {/* error shown via status listener */});
    }
    return runner.onStatusChange(setModelStatus);
  }, []);

  useEffect(() => {
    return () => {
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
      }
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Reliability-first: warm up OpenCV fallback before first scan.
    loadOpenCV().catch(() => undefined);
  }, []);

  const persistDebugDump = useCallback(async (
    result: ScanResult,
    artifacts: DebugArtifacts,
    sourceType: ScanSourceType,
  ) => {
    try {
      await fetch("/__debug/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timestamp: new Date().toISOString(),
          sourceType,
          // Backward-compatible top-level fields.
          imageDataUrl: artifacts.raw ?? null,
          overlayDataUrl: artifacts.yolo ?? null,
          artifacts,
          result,
        }),
      });
    } catch {
      // Debug dump is best-effort only
    }
  }, []);

  const runAndStoreScan = useCallback(async (
    source: File | ImageBitmap,
    imageDataUrl: string | null,
    sourceType: ScanSourceType,
  ) => {
    setScanError(null);
    setScanPhase("scanning");
    const result = await runScanPipeline(source);

    setScanPhase("done");
    if (result.ok) {
      onScanComplete(result);
    } else {
      setScanError(`Scan failed (${result.stage}): ${result.error}`);
    }

    // Persist full debug artifacts in the background so scan UX stays responsive.
    void (async () => {
      const rawDataUrl = await normalizeRawDataUrl(source, imageDataUrl);
      const yoloOverlay = await buildYoloOverlayDataUrl(rawDataUrl, result);
      const opencvOverlay = await buildOpenCvOverlayDataUrl(rawDataUrl, result);
      const rectified = await buildRectifiedArtifacts(rawDataUrl, result);

      await persistDebugDump(result, {
        raw: rawDataUrl,
        yolo: yoloOverlay,
        opencv: opencvOverlay,
        rectified: rectified.rectified,
        rectifiedMapped: rectified.rectifiedMapped,
      }, sourceType);
    })();
  }, [onScanComplete, persistDebugDump]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const imageDataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(new Error("Failed to read file for debug output"));
      reader.readAsDataURL(file);
    }).catch(() => "");

    setLastFrameDataUrl(imageDataUrl || null);
    await runAndStoreScan(file, imageDataUrl || null, "file_upload");

    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [runAndStoreScan]);

  const stopLiveCamera = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      s.getTracks().forEach((t) => t.stop());
    }
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
    setCameraReady(false);
  }, []);

  const handleStartLiveCamera = useCallback(async (): Promise<boolean> => {
    setScanError(null);
    setStartingCamera(true);

    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setCameraReady(false);
      setCameraMode("native");
      setScanError("In-app camera needs HTTPS + camera permission. Primary scan button will stay in-app only.");
      setStartingCamera(false);
      return false;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });

      stopLiveCamera();
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
        await new Promise<void>((resolve) => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            resolve();
            return;
          }
          const onLoaded = () => resolve();
          video.addEventListener("loadeddata", onLoaded, { once: true });
          setTimeout(() => {
            video.removeEventListener("loadeddata", onLoaded);
            resolve();
          }, 450);
        });
        setCameraReady(true);
        setCameraMode("live");
      }
      return true;
    } catch {
      setCameraReady(false);
      setCameraMode("native");
      setScanError("Could not start in-app camera. Allow camera permission and use HTTPS URL on phone.");
      return false;
    } finally {
      setStartingCamera(false);
    }
  }, [stopLiveCamera]);

  const handleLiveCapture = useCallback(async (): Promise<boolean> => {
    const video = videoRef.current;
    if (!video || !cameraReady || video.videoWidth === 0 || video.videoHeight === 0) {
      setScanError("Start the in-app camera first, then tap scan.");
      return false;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.95);
    });
    if (!blob) return false;

    const imageDataUrl = canvas.toDataURL("image/jpeg", 0.85);
    setLastFrameDataUrl(imageDataUrl);

    const bitmap = await createImageBitmap(blob);
    try {
      await runAndStoreScan(bitmap, imageDataUrl, "camera_live");
      return true;
    } finally {
      bitmap.close();
    }
  }, [cameraReady, runAndStoreScan]);

  const handleOneTapScan = useCallback(async () => {
    let startedForThisTap = false;

    if (!cameraReady) {
      const started = await handleStartLiveCamera();
      if (!started) return;
      startedForThisTap = true;
      await new Promise((resolve) => setTimeout(resolve, 280));
    }

    try {
      await handleLiveCapture();
    } finally {
      if (startedForThisTap) {
        stopLiveCamera();
      }
    }
  }, [cameraReady, handleLiveCapture, handleStartLiveCamera, stopLiveCamera]);

  const handleCameraCapture = useCallback(() => {
    const input = fileInputRef.current;
    if (!input) return;
    if (typeof input.showPicker === "function") {
      try {
        input.showPicker();
        return;
      } catch {
        // fall through
      }
    }
    input.click();
  }, []);

  const handleRetry = useCallback(() => {
    setScanPhase("idle");
    setScanError(null);
  }, []);

  const isReady = modelStatus.state === "ready";

  return (
    <div className="capture-view">
      <div className="capture-header">
        <h2>Quick Scan</h2>
        <ModelStatusBadge status={modelStatus} />
      </div>

      {cameraMode === "live" && cameraReady && (
        <div className="scan-live-wrap">
          <video ref={videoRef} className="scan-live-video" muted playsInline autoPlay />
          <div className="scan-guide" aria-hidden="true">
            <span className="scan-guide-corner tl" />
            <span className="scan-guide-corner tr" />
            <span className="scan-guide-corner bl" />
            <span className="scan-guide-corner br" />
          </div>
        </div>
      )}

      {cameraMode === "native" && (
        <p className="capture-note">
          In-app camera is unavailable in this context. Use the HTTPS dev URL on your phone to enable the in-app guide box.
        </p>
      )}

      {scanPhase === "scanning" && (
        <div className="capture-scanning">Analysing board…</div>
      )}

      {scanError && <div className="capture-error">{scanError}</div>}

      {lastFrameDataUrl && (
        <p className="capture-note">Last frame captured and written to debug-output.</p>
      )}

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
            onClick={handleOneTapScan}
            disabled={!isReady}
          >
            {startingCamera
              ? "Capturing..."
              : (scanPhase === "idle" ? "Scan Now" : "Scan Again")}
          </button>
        )}

        {scanPhase === "done" && Boolean(scanError) && (
          <button className="capture-btn" onClick={handleRetry}>
            Try Again
          </button>
        )}

        <button className="capture-btn capture-btn--ghost" onClick={handleCameraCapture}>
          Open Camera App / Upload Photo
        </button>
      </div>
    </div>
  );
}
