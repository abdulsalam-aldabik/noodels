declare global {
  interface Window {
    cv?: {
      Mat: new () => { rows: number; data32S: Int32Array; delete(): void };
      MatVector: new () => { size(): number; get(i: number): { delete(): void }; delete(): void };
      COLOR_RGBA2GRAY: number;
      RETR_EXTERNAL: number;
      CHAIN_APPROX_SIMPLE: number;
      CV_8U: number;
      Size: new (w: number, h: number) => unknown;
      matFromImageData(imageData: ImageData): { delete(): void };
      cvtColor(src: unknown, dst: unknown, code: number): void;
      findContours(src: unknown, contours: unknown, hierarchy: unknown, mode: number, method: number): void;
      contourArea(contour: unknown): number;
      arcLength(contour: unknown, closed: boolean): number;
      approxPolyDP(contour: unknown, approxCurve: { rows: number; data32S: Int32Array; delete(): void }, epsilon: number, closed: boolean): void;
      GaussianBlur(src: unknown, dst: unknown, size: unknown, sigmaX: number): void;
      Canny(src: unknown, dst: unknown, t1: number, t2: number): void;
      dilate(src: unknown, dst: unknown, kernel: unknown): void;
      Matones(rows: number, cols: number, type: number): { delete(): void };
      MatOnes?: (rows: number, cols: number, type: number) => { delete(): void };
    };
    onOpenCvReady?: () => void;
  }
}

let cvReady: Promise<boolean> | null = null;
const OPENCV_SOURCES = [
  "/opencv.js",
  "https://docs.opencv.org/4.10.0/opencv.js",
];

function root(): Window {
  return globalThis as unknown as Window;
}

function getCv() {
  return root().cv;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function deleteIfPresent(value: unknown): void {
  if (value && typeof value === "object" && "delete" in value) {
    (value as { delete(): void }).delete();
  }
}

export function loadOpenCV(): Promise<boolean> {
  if (cvReady !== null) return cvReady;

  cvReady = new Promise((resolve) => {
    if (typeof globalThis.window === "undefined") {
      resolve(false);
      return;
    }

    if (getCv()?.Mat) {
      resolve(true);
      return;
    }

    let resolved = false;
    const finish = (value: boolean): void => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };

    const previous = root().onOpenCvReady;
    root().onOpenCvReady = () => {
      if (typeof previous === "function") previous();
      finish(true);
    };

    const loadAt = (index: number): void => {
      if (index >= OPENCV_SOURCES.length) {
        finish(Boolean(getCv()?.Mat));
        return;
      }

      const script = document.createElement("script");
      script.src = OPENCV_SOURCES[index];
      script.async = true;
      script.crossOrigin = "anonymous";

      script.onload = () => {
        // Some OpenCV builds expose cv immediately without firing onOpenCvReady.
        setTimeout(() => {
          if (getCv()?.Mat) finish(true);
          else loadAt(index + 1);
        }, 900);
      };

      script.onerror = () => {
        loadAt(index + 1);
      };

      document.head.appendChild(script);
    };

    loadAt(0);
  });

  return cvReady;
}

export function isOpenCVReady(): boolean {
  return typeof globalThis.window !== "undefined" && Boolean(getCv()?.Mat);
}

export function refineBoardCorners(
  polygon: [number, number][],
  imageW: number,
  imageH: number,
): [number, number][] | null {
  if (!isOpenCVReady() || polygon.length < 4) return null;

  const cv = getCv();
  if (!cv) return null;

  let src: unknown = null;
  let gray: unknown = null;
  let contours: unknown = null;
  let hierarchy: unknown = null;
  let contour: unknown = null;
  let approx: unknown = null;

  try {
    const canvas = createCanvas(imageW, imageH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, imageW, imageH);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.moveTo(polygon[0][0], polygon[0][1]);
    for (let i = 1; i < polygon.length; i++) {
      ctx.lineTo(polygon[i][0], polygon[i][1]);
    }
    ctx.closePath();
    ctx.fill();

    src = cv.matFromImageData(ctx.getImageData(0, 0, imageW, imageH));
    gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(gray, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let largestIdx = -1;
    let largestArea = 0;
    const contourVector = contours as { size(): number; get(i: number): unknown };
    for (let i = 0; i < contourVector.size(); i++) {
      const c = contourVector.get(i);
      const area = cv.contourArea(c);
      if (area > largestArea) {
        largestArea = area;
        largestIdx = i;
      }
    }

    if (largestIdx < 0) return null;

    contour = contourVector.get(largestIdx);
    approx = new cv.Mat();
    const peri = cv.arcLength(contour, true);
    cv.approxPolyDP(contour, approx as { rows: number; data32S: Int32Array; delete(): void }, 0.02 * peri, true);

    const points: [number, number][] = [];
    const approxMat = approx as { rows: number; data32S: Int32Array };
    for (let i = 0; i < approxMat.rows; i++) {
      points.push([approxMat.data32S[i * 2], approxMat.data32S[i * 2 + 1]]);
    }

    return reduceToQuad(points);
  } catch {
    return null;
  } finally {
    deleteIfPresent(src);
    deleteIfPresent(gray);
    deleteIfPresent(contours);
    deleteIfPresent(hierarchy);
    deleteIfPresent(contour);
    deleteIfPresent(approx);
  }
}

export async function findBoardContourCV(
  imageBitmap: ImageBitmap,
): Promise<[number, number][] | null> {
  if (!isOpenCVReady()) return null;
  const cv = getCv();
  if (!cv) return null;

  const width = imageBitmap.width;
  const height = imageBitmap.height;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.drawImage(imageBitmap, 0, 0);

  let src: unknown = null;
  let gray: unknown = null;
  let blurred: unknown = null;
  let edges: unknown = null;
  let kernel: unknown = null;
  let dilated: unknown = null;
  let contours: unknown = null;
  let hierarchy: unknown = null;

  try {
    src = cv.matFromImageData(ctx.getImageData(0, 0, width, height));
    gray = new cv.Mat();
    blurred = new cv.Mat();
    edges = new cv.Mat();
    dilated = new cv.Mat();
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();

    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edges, 50, 150);

    if (typeof cv.MatOnes === "function") {
      kernel = cv.MatOnes(3, 3, cv.CV_8U);
    } else if (typeof cv.Matones === "function") {
      kernel = cv.Matones(3, 3, cv.CV_8U);
    } else {
      const cvAny = cv as unknown as { Mat?: { ones?: (rows: number, cols: number, type: number) => { delete(): void } } };
      if (cvAny.Mat?.ones) {
        kernel = cvAny.Mat.ones(3, 3, cv.CV_8U);
      }
    }

    if (!kernel) return null;

    cv.dilate(edges, dilated, kernel);
    cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const contourVector = contours as { size(): number; get(i: number): unknown };
    let bestArea = 0;
    let bestPoints: [number, number][] | null = null;
    const minArea = width * height * 0.1;

    for (let i = 0; i < contourVector.size(); i++) {
      const c = contourVector.get(i);
      const area = cv.contourArea(c);
      if (area < minArea) continue;

      const peri = cv.arcLength(c, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(c, approx, 0.02 * peri, true);

      if (approx.rows >= 4 && area > bestArea) {
        bestArea = area;
        const pts: [number, number][] = [];
        for (let j = 0; j < approx.rows; j++) {
          pts.push([approx.data32S[j * 2], approx.data32S[j * 2 + 1]]);
        }
        bestPoints = reduceToQuad(pts);
      }
      approx.delete();
    }

    return bestPoints;
  } catch {
    return null;
  } finally {
    deleteIfPresent(src);
    deleteIfPresent(gray);
    deleteIfPresent(blurred);
    deleteIfPresent(edges);
    deleteIfPresent(kernel);
    deleteIfPresent(dilated);
    deleteIfPresent(contours);
    deleteIfPresent(hierarchy);
  }
}

function reduceToQuad(points: [number, number][]): [number, number][] | null {
  if (points.length < 4) return null;
  if (points.length === 4) return points;

  const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
  const cy = points.reduce((s, p) => s + p[1], 0) / points.length;

  const quadrants: Array<[number, number] | null> = [null, null, null, null];
  const distances = [-1, -1, -1, -1];

  for (const point of points) {
    const dx = point[0] - cx;
    const dy = point[1] - cy;

    let q = 0;
    if (dx >= 0 && dy < 0) q = 1;
    else if (dx >= 0 && dy >= 0) q = 2;
    else if (dx < 0 && dy >= 0) q = 3;

    const d2 = dx * dx + dy * dy;
    if (d2 > distances[q]) {
      distances[q] = d2;
      quadrants[q] = point;
    }
  }

  if (quadrants.every((p) => p !== null)) {
    return quadrants as [number, number][];
  }

  const byRadius = [...points]
    .sort((a, b) => {
      const da = (a[0] - cx) * (a[0] - cx) + (a[1] - cy) * (a[1] - cy);
      const db = (b[0] - cx) * (b[0] - cx) + (b[1] - cy) * (b[1] - cy);
      return db - da;
    })
    .slice(0, 4);

  return byRadius.length === 4 ? byRadius : null;
}
