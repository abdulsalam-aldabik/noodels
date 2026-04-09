import type { Tensor } from "onnxruntime-web";
import {
  NUM_CLASSES,
  MASK_SIZE,
  CONFIDENCE_GATE,
  NMS_IOU_THRESHOLD,
} from "./inferenceTypes";
import type { RawDetection, LetterboxParams } from "./inferenceTypes";

// ── Debug snapshot ────────────────────────────────────────────────────────────

export interface PostprocessDebug {
  tensorShape0: number[];
  tensorShape1: number[];
  /** Whether rows are the first axis ([1, rows, anchors]) or second ([1, anchors, rows]). */
  layout: "rows_first" | "anchors_first";
  numRows: number;
  numAnchors: number;
  numMaskCoeffs: number;
  /** True = values are already in [0,1]; False = raw logits, sigmoid applied. */
  scoresPreSigmoid: boolean;
  /** Maximum raw class score seen for class 11 (board) across all anchors. */
  maxBoardScore: number;
  /** Count of anchors above CONFIDENCE_GATE before NMS. */
  aboveThreshold: number;
  /** Count of detections kept after NMS. */
  afterNMS: number;
  /** Detections by class index, count. */
  countsByClass: Record<number, number>;
  /** Highest confidence score per class. */
  maxConfByClass: Record<number, number>;
}

// ── Internal types ────────────────────────────────────────────────────────────

interface PreNMSBox {
  classId: number;
  confidence: number;
  cx: number; cy: number; w: number; h: number;
  coeffs: Float32Array;
}

// ── Tensor format detection ───────────────────────────────────────────────────

/**
 * YOLO seg ONNX models come in two common shapes for output0:
 *   rows_first:    [1, 4+NC+NM, anchors]  — dims[1] is small (e.g. 49)
 *   anchors_first: [1, anchors, 4+NC+NM]  — dims[1] is large (e.g. 8400)
 *
 * We distinguish by checking which dimension is larger.
 */
function detectLayout(output0: Tensor): {
  layout: "rows_first" | "anchors_first";
  rows: number;
  anchors: number;
} {
  const d1 = output0.dims[1];
  const d2 = output0.dims[2];
  if (d1 <= d2) {
    return { layout: "rows_first", rows: d1, anchors: d2 };
  }
  return { layout: "anchors_first", rows: d2, anchors: d1 };
}

/** Access element at (row, anchor) accounting for layout. */
function getVal(
  data: Float32Array,
  row: number,
  anchor: number,
  layout: "rows_first" | "anchors_first",
  rows: number,
  anchors: number,
): number {
  if (layout === "rows_first") return data[row * anchors + anchor];
  return data[anchor * rows + row];
}

/**
 * Samples a small set of values to detect whether class scores are already
 * post-sigmoid (values bounded in [0,1]) or raw logits (can exceed 1).
 *
 * Strategy: check the max absolute value of class score entries across a sample
 * of 200 anchors. If every value is within [0, 1.05] (allowing small float error),
 * treat as pre-sigmoid. Otherwise apply sigmoid.
 */
function detectPreSigmoid(
  data: Float32Array,
  anchors: number,
  layout: "rows_first" | "anchors_first",
  rows: number,
): boolean {
  const sampleStep = Math.max(1, Math.floor(anchors / 200));
  let maxAbs = 0;
  for (let a = 0; a < anchors; a += sampleStep) {
    for (let c = 0; c < NUM_CLASSES; c++) {
      const v = Math.abs(getVal(data, 4 + c, a, layout, rows, anchors));
      if (v > maxAbs) maxAbs = v;
    }
  }
  return maxAbs <= 1.05;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// ── Box decoding ──────────────────────────────────────────────────────────────

function decodeBoxes(
  output0: Tensor,
  debug: Partial<PostprocessDebug>,
): PreNMSBox[] {
  const data = output0.data as Float32Array;
  const { layout, rows, anchors } = detectLayout(output0);
  const numMaskCoeffs = Math.max(0, rows - 4 - NUM_CLASSES);
  const preSigmoid = detectPreSigmoid(data, anchors, layout, rows);

  debug.layout = layout;
  debug.numRows = rows;
  debug.numAnchors = anchors;
  debug.numMaskCoeffs = numMaskCoeffs;
  debug.scoresPreSigmoid = preSigmoid;

  const maxConfByClass: Record<number, number> = {};
  let maxBoardScore = 0;
  let aboveThreshold = 0;
  const boxes: PreNMSBox[] = [];

  for (let a = 0; a < anchors; a++) {
    let bestClass = -1;
    let bestScore = -Infinity;

    for (let c = 0; c < NUM_CLASSES; c++) {
      const raw = getVal(data, 4 + c, a, layout, rows, anchors);
      const score = preSigmoid ? raw : sigmoid(raw);
      if (score > bestScore) { bestScore = score; bestClass = c; }
      // Track max board score for debug
      if (c === 11) {
        const s = preSigmoid ? raw : sigmoid(raw);
        if (s > maxBoardScore) maxBoardScore = s;
      }
    }

    if (bestClass >= 0) {
      if (!maxConfByClass[bestClass] || bestScore > maxConfByClass[bestClass]) {
        maxConfByClass[bestClass] = bestScore;
      }
    }

    if (bestScore < CONFIDENCE_GATE) continue;
    aboveThreshold++;

    const cx = getVal(data, 0, a, layout, rows, anchors);
    const cy = getVal(data, 1, a, layout, rows, anchors);
    const w  = getVal(data, 2, a, layout, rows, anchors);
    const h  = getVal(data, 3, a, layout, rows, anchors);

    const coeffs = new Float32Array(numMaskCoeffs);
    for (let m = 0; m < numMaskCoeffs; m++) {
      coeffs[m] = getVal(data, 4 + NUM_CLASSES + m, a, layout, rows, anchors);
    }

    boxes.push({ classId: bestClass, confidence: bestScore, cx, cy, w, h, coeffs });
  }

  debug.maxBoardScore = maxBoardScore;
  debug.aboveThreshold = aboveThreshold;
  debug.maxConfByClass = maxConfByClass;

  return boxes;
}

// ── NMS ───────────────────────────────────────────────────────────────────────

function iou(a: PreNMSBox, b: PreNMSBox): number {
  const ax1 = a.cx - a.w / 2, ay1 = a.cy - a.h / 2;
  const ax2 = a.cx + a.w / 2, ay2 = a.cy + a.h / 2;
  const bx1 = b.cx - b.w / 2, by1 = b.cy - b.h / 2;
  const bx2 = b.cx + b.w / 2, by2 = b.cy + b.h / 2;
  const ix1 = Math.max(ax1, bx1), iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2), iy2 = Math.min(ay2, by2);
  const inter = Math.max(0, ix2 - ix1) * Math.max(0, iy2 - iy1);
  if (inter === 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

function applyNMS(boxes: PreNMSBox[]): PreNMSBox[] {
  const byClass = new Map<number, PreNMSBox[]>();
  for (const box of boxes) {
    if (!byClass.has(box.classId)) byClass.set(box.classId, []);
    byClass.get(box.classId)!.push(box);
  }
  const kept: PreNMSBox[] = [];
  for (const candidates of byClass.values()) {
    candidates.sort((a, b) => b.confidence - a.confidence);
    const sup = new Uint8Array(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      if (sup[i]) continue;
      kept.push(candidates[i]);
      for (let j = i + 1; j < candidates.length; j++) {
        if (!sup[j] && iou(candidates[i], candidates[j]) > NMS_IOU_THRESHOLD) sup[j] = 1;
      }
    }
  }
  return kept;
}

// ── Mask decoding ─────────────────────────────────────────────────────────────

function decodeMask(
  box: PreNMSBox,
  output1: Tensor,
  params: LetterboxParams,
  numMaskCoeffs: number,
): { polygon: [number, number][]; centroid: [number, number] } {
  const protoData = output1.data as Float32Array;
  // output1: [1, NM, MASK_H, MASK_W] — detect actual mask size from tensor
  const maskH = output1.dims[2] ?? MASK_SIZE;
  const maskW = output1.dims[3] ?? MASK_SIZE;
  const maskArea = maskH * maskW;

  const maskVals = new Float32Array(maskArea);
  for (let m = 0; m < Math.min(numMaskCoeffs, box.coeffs.length); m++) {
    const coeff = box.coeffs[m];
    const offset = m * maskArea;
    for (let px = 0; px < maskArea; px++) {
      maskVals[px] += coeff * protoData[offset + px];
    }
  }

  const scaleX = maskW / 640;
  const scaleY = maskH / 640;
  const mx1 = Math.max(0, Math.floor((box.cx - box.w / 2) * scaleX));
  const my1 = Math.max(0, Math.floor((box.cy - box.h / 2) * scaleY));
  const mx2 = Math.min(maskW - 1, Math.ceil((box.cx + box.w / 2) * scaleX));
  const my2 = Math.min(maskH - 1, Math.ceil((box.cy + box.h / 2) * scaleY));

  const foreground: [number, number][] = [];
  for (let my = my1; my <= my2; my++) {
    for (let mx = mx1; mx <= mx2; mx++) {
      const val = maskVals[my * maskW + mx];
      if (sigmoid(val) >= 0.5) {
        const imgX = (mx / scaleX - params.padX) / params.scale;
        const imgY = (my / scaleY - params.padY) / params.scale;
        foreground.push([imgX, imgY]);
      }
    }
  }

  if (foreground.length === 0) {
    const cx = (box.cx - params.padX) / params.scale;
    const cy = (box.cy - params.padY) / params.scale;
    return { polygon: [[cx, cy]], centroid: [cx, cy] };
  }

  let sumX = 0, sumY = 0;
  for (const [px, py] of foreground) { sumX += px; sumY += py; }
  const centroid: [number, number] = [sumX / foreground.length, sumY / foreground.length];
  const polygon = computeConvexHull(foreground);
  return { polygon, centroid };
}

// ── Convex hull ───────────────────────────────────────────────────────────────

function cross(o: [number, number], a: [number, number], b: [number, number]): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

export function computeConvexHull(points: [number, number][]): [number, number][] {
  if (points.length <= 3) return points;
  const pts = points.length > 2000
    ? points.filter((_, i) => i % Math.ceil(points.length / 2000) === 0)
    : [...points];
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface DecodeResult {
  detections: RawDetection[];
  debug: PostprocessDebug;
}

/**
 * Converts raw ONNX output tensors into NMS-filtered detections.
 * Automatically handles:
 *   - rows_first vs anchors_first tensor layout
 *   - pre-sigmoid vs raw logit class scores
 *   - variable number of mask prototype coefficients
 */
export function decodeDetections(
  output0: Tensor,
  output1: Tensor,
  params: LetterboxParams,
): DecodeResult {
  const debugPartial: Partial<PostprocessDebug> = {
    tensorShape0: [...output0.dims],
    tensorShape1: [...output1.dims],
  };

  const rawBoxes = decodeBoxes(output0, debugPartial);
  const kept = applyNMS(rawBoxes);

  const numMaskCoeffs = debugPartial.numMaskCoeffs ?? 32;

  const detections: RawDetection[] = kept.map((box) => {
    const { polygon, centroid } = decodeMask(box, output1, params, numMaskCoeffs);
    const x1 = (box.cx - box.w / 2 - params.padX) / params.scale;
    const y1 = (box.cy - box.h / 2 - params.padY) / params.scale;
    const x2 = (box.cx + box.w / 2 - params.padX) / params.scale;
    const y2 = (box.cy + box.h / 2 - params.padY) / params.scale;
    return {
      classId: box.classId,
      confidence: box.confidence,
      bbox: [x1, y1, x2, y2] as [number, number, number, number],
      maskPolygon: polygon,
      maskCentroid: centroid,
    };
  });

  const countsByClass: Record<number, number> = {};
  for (const d of detections) {
    countsByClass[d.classId] = (countsByClass[d.classId] ?? 0) + 1;
  }

  const debug: PostprocessDebug = {
    tensorShape0: debugPartial.tensorShape0!,
    tensorShape1: debugPartial.tensorShape1!,
    layout: debugPartial.layout!,
    numRows: debugPartial.numRows!,
    numAnchors: debugPartial.numAnchors!,
    numMaskCoeffs,
    scoresPreSigmoid: debugPartial.scoresPreSigmoid!,
    maxBoardScore: debugPartial.maxBoardScore ?? 0,
    aboveThreshold: debugPartial.aboveThreshold ?? 0,
    afterNMS: detections.length,
    countsByClass,
    maxConfByClass: debugPartial.maxConfByClass ?? {},
  };

  return { detections, debug };
}
