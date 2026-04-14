/**
 * Optional OpenCV.js processor for board contour detection.
 * Loads asynchronously and never blocks the main thread.
 * Falls back gracefully — the pipeline works without it.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cvInstance: any = null;
let loadPromise: Promise<boolean> | null = null;
let loadAttempted = false;

// Proxied through Vite dev-server to satisfy COEP: require-corp.
// See vite.config.ts proxy rule for /opencv-proxy.
const OPENCV_CDN = "/opencv-proxy/4.9.0/opencv.js";

export function isOpenCVReady(): boolean {
  return cvInstance !== null;
}

/**
 * Initiates non-blocking OpenCV load. Safe to call multiple times.
 * Returns true if loaded successfully, false on failure.
 */
export function loadOpenCV(): Promise<boolean> {
  if (cvInstance) return Promise.resolve(true);
  if (loadPromise) return loadPromise;
  if (loadAttempted) return Promise.resolve(false);

  loadAttempted = true;
  loadPromise = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = OPENCV_CDN;
    script.async = true;

    script.onload = () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const g = globalThis as any;
      const finalize = () => { cvInstance = g.cv; resolve(true); };

      setTimeout(() => {
        if (g.cv?.Mat) {
          finalize();
        } else if (g.cv) {
          g.cv.onRuntimeInitialized = finalize;
        } else {
          resolve(false);
        }
      }, 100);
    };

    script.onerror = () => {
      console.warn("OpenCV.js failed to load — contour detection disabled");
      resolve(false);
    };

    // Timeout: don't wait forever
    setTimeout(() => {
      if (!cvInstance) {
        console.warn("OpenCV.js load timed out");
        resolve(false);
      }
    }, 10_000);

    document.head.appendChild(script);
  });

  return loadPromise;
}

/**
 * Uses OpenCV contour detection to find the board quadrilateral.
 * Returns 4 corner points or null if detection fails.
 */
export function findBoardContourCV(
  imageData: ImageData,
): [[number, number], [number, number], [number, number], [number, number]] | null {
  if (!cvInstance) return null;
  const cv = cvInstance;

  let src: InstanceType<typeof cv.Mat> | null = null;
  let gray: InstanceType<typeof cv.Mat> | null = null;
  let blurred: InstanceType<typeof cv.Mat> | null = null;
  let edges: InstanceType<typeof cv.Mat> | null = null;
  let contours: InstanceType<typeof cv.MatVector> | null = null;
  let hierarchy: InstanceType<typeof cv.Mat> | null = null;

  try {
    src = cv.matFromImageData(imageData);
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

    edges = new cv.Mat();
    cv.Canny(blurred, edges, 50, 150);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Find the largest contour that approximates to 4 corners
    let bestArea = 0;
    let bestCorners: [number, number][] | null = null;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      // Board should be at least 10% of image area
      const minArea = imageData.width * imageData.height * 0.1;
      if (area < minArea) continue;

      const peri = cv.arcLength(contour, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(contour, approx, 0.02 * peri, true);

      if (approx.rows === 4 && area > bestArea) {
        bestArea = area;
        bestCorners = [];
        for (let j = 0; j < 4; j++) {
          bestCorners.push([
            approx.data32S[j * 2],
            approx.data32S[j * 2 + 1],
          ]);
        }
      }
      approx.delete();
    }

    if (!bestCorners || bestCorners.length !== 4) return null;

    return bestCorners as [[number, number], [number, number], [number, number], [number, number]];
  } catch {
    return null;
  } finally {
    src?.delete?.();
    gray?.delete?.();
    blurred?.delete?.();
    edges?.delete?.();
    contours?.delete?.();
    hierarchy?.delete?.();
  }
}
