/**
 * Dev-only auto-save: ships every phone capture + scan artifacts to the
 * Vite middleware in vite.config.ts (`debugSavePlugin`), which writes them
 * under <projectRoot>/phone-debug/<bundle>/.
 *
 * Each call uploads files in parallel; a single failed upload does not
 * abort the others. The function is safe to call from production builds —
 * the middleware only exists in dev, so the fetches will 404 and we swallow
 * the error.
 */

import type { ScanResult } from "../pipeline/types";

const ENDPOINT = "/__debug-save";

export interface CaptureMeta {
  source: "ImageCapture.takePhoto" | "canvas.drawImage";
  streamWidth: number;
  streamHeight: number;
  capturedWidth: number;
  capturedHeight: number;
  viewportPortrait: boolean;
  rotationApplied: number;
  screenAngle: number;
  jpegBytes: number;
  totalMs: number;
  scanError?: string | null;
}

/**
 * Upload the captured JPEG, all scan artifacts, capture diagnostics, and
 * scan telemetry under a single bundle name. Returns the bundle name
 * (also the folder name on disk) so callers can show it to the user.
 */
export async function uploadDebugBundle(
  capture: Blob,
  scan: ScanResult | null,
  meta: CaptureMeta,
): Promise<string> {
  const bundle = makeBundleName(scan);

  const send = async (
    name: string,
    body: Blob | string,
    contentType: string,
  ): Promise<void> => {
    const url = `${ENDPOINT}?bundle=${encodeURIComponent(bundle)}&name=${encodeURIComponent(name)}`;
    try {
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": contentType },
        body,
      });
    } catch (err) {
      console.warn(`[debug-save] ${name} failed`, err);
    }
  };

  const tasks: Promise<void>[] = [
    send("capture.jpg", capture, "image/jpeg"),
    send("capture-meta.json", JSON.stringify(meta, null, 2), "application/json"),
  ];
  if (scan) {
    tasks.push(send("report.json", scan.artifacts.report, "application/json"));
    pushBlob(tasks, send, "raw.png", scan.artifacts.raw);
    pushBlob(tasks, send, "yolo.png", scan.artifacts.yolo);
    pushBlob(tasks, send, "corners.png", scan.artifacts.corners);
    pushBlob(tasks, send, "rectified.png", scan.artifacts.rectified);
    pushBlob(
      tasks,
      send,
      "detections-on-rectified.png",
      scan.artifacts.detectionsOnRectified,
    );
    pushBlob(
      tasks,
      send,
      "color-classification.png",
      scan.artifacts.colorClassification,
    );
    pushBlob(tasks, send, "mapped.png", scan.artifacts.mapped);
  }

  await Promise.all(tasks);
  return bundle;
}

function pushBlob(
  tasks: Promise<void>[],
  send: (name: string, body: Blob, ct: string) => Promise<void>,
  name: string,
  blob: Blob | undefined,
): void {
  if (blob) tasks.push(send(name, blob, blob.type || "application/octet-stream"));
}

/**
 * Folder name for one capture: ISO timestamp (filesystem-safe) plus a short
 * status tag so failed scans sort and identify next to good ones.
 */
function makeBundleName(scan: ScanResult | null): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (!scan) return `${stamp}_no-scan`;
  const placed = scan.boardState?.placements.length ?? 0;
  const status = scan.status === "ok" ? `ok-${placed}` : scan.status;
  return `${stamp}_${status}`;
}
