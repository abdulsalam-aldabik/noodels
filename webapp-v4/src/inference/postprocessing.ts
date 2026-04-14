import type { Tensor } from "onnxruntime-web";
import {
  NUM_CLASSES,
  NUM_MASK_COEFFS,
  MASK_SIZE,
  CONFIDENCE_GATE,
  NMS_IOU_THRESHOLD,
  CLASS_BOARD,
  mapModelClassToEngineClassId,
} from "./inferenceTypes";
import type { RawDetection, LetterboxParams } from "./inferenceTypes";

// -- Debug snapshot -----------------------------------------------------------

export interface PostprocessDebug {
  tensorShape0: number[];
  tensorShape1: number[];
  /** output0 layout used during decode. */
  layout: "rows_first" | "anchors_first" | "detections_first" | "features_first";
  numRows: number;
  numAnchors: number;
  numMaskCoeffs: number;
  /** True = scores are already probabilities, false = sigmoid was applied. */
  scoresPreSigmoid: boolean;
  /** Maximum confidence score seen for class 11 (board). */
  maxBoardScore: number;
  /** Count of candidates above CONFIDENCE_GATE before suppression. */
  aboveThreshold: number;
  /** Count of detections kept after suppression. */
  afterNMS: number;
  /** Detections by internal class id (engine id space). */
  countsByClass: Record<number, number>;
  /** Highest confidence score per internal class. */
  maxConfByClass: Record<number, number>;
}

// -- Internal types -----------------------------------------------------------

interface PreNMSBox {
  classId: number;
  confidence: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  coeffs: Float32Array;
}

type RawLayout = "rows_first" | "anchors_first";
type PackedLayout = "detections_first" | "features_first";

interface DecodeBoxesResult {
  boxes: PreNMSBox[];
  alreadySuppressed: boolean;
}

// -- Tensor format detection --------------------------------------------------

/**
 * Raw-anchor YOLO output0 layouts:
 * - rows_first:    [1, rows, anchors]    rows ~= 4 + nc + nm, anchors large
 * - anchors_first: [1, anchors, rows]    anchors large, rows ~= 4 + nc + nm
 */
function detectRawLayout(output0: Tensor): {
  layout: RawLayout;
  rows: number;
  anchors: number;
} {
  const d1 = output0.dims[1] ?? 0;
  const d2 = output0.dims[2] ?? 0;
  if (d1 <= d2) {
    return { layout: "rows_first", rows: d1, anchors: d2 };
  }
  return { layout: "anchors_first", rows: d2, anchors: d1 };
}

/**
 * End-to-end packed output0 layouts:
 * - detections_first: [1, detections, features]
 * - features_first:   [1, features, detections]
 * with features = 6 + numMaskCoeffs.
 */
function detectPackedLayout(
  output0: Tensor,
  protoChannels: number,
): { layout: PackedLayout; detections: number; features: number } | null {
  const d1 = output0.dims[1] ?? 0;
  const d2 = output0.dims[2] ?? 0;
  const expectedFeatures = protoChannels + 6;

  if (d2 === expectedFeatures && d1 > 0 && d1 <= 1000) {
    return { layout: "detections_first", detections: d1, features: d2 };
  }
  if (d1 === expectedFeatures && d2 > 0 && d2 <= 1000) {
    return { layout: "features_first", detections: d2, features: d1 };
  }

  return null;
}

/** Access value at (row, anchor) for raw layouts. */
function getRawVal(
  data: Float32Array,
  row: number,
  anchor: number,
  layout: RawLayout,
  rows: number,
  anchors: number,
): number {
  if (layout === "rows_first") return data[row * anchors + anchor];
  return data[anchor * rows + row];
}

/** Access value at (det, feature) for packed layouts. */
function getPackedVal(
  data: Float32Array,
  det: number,
  feature: number,
  layout: PackedLayout,
  detections: number,
  features: number,
): number {
  if (layout === "detections_first") return data[det * features + feature];
  return data[feature * detections + det];
}

/**
 * Samples raw-anchor class scores to detect whether they are already bounded
 * probabilities or logits that still need sigmoid.
 */
function detectPreSigmoid(
  data: Float32Array,
  anchors: number,
  layout: RawLayout,
  rows: number,
): boolean {
  const sampleStep = Math.max(1, Math.floor(anchors / 200));
  let maxAbs = 0;
  for (let a = 0; a < anchors; a += sampleStep) {
    for (let c = 0; c < NUM_CLASSES; c++) {
      const v = Math.abs(getRawVal(data, 4 + c, a, layout, rows, anchors));
      if (v > maxAbs) maxAbs = v;
    }
  }
  return maxAbs <= 1.05;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

// -- Box decoding -------------------------------------------------------------

function decodePackedBoxes(
  output0: Tensor,
  output1: Tensor,
  debug: Partial<PostprocessDebug>,
): DecodeBoxesResult | null {
  const protoChannels = output1.dims[1] ?? NUM_MASK_COEFFS;
  const packed = detectPackedLayout(output0, protoChannels);
  if (!packed) return null;

  const data = output0.data as Float32Array;
  const { layout, detections, features } = packed;
  const numMaskCoeffs = Math.max(0, features - 6);

  debug.layout = layout;
  debug.numRows = features;
  debug.numAnchors = detections;
  debug.numMaskCoeffs = numMaskCoeffs;
  // Packed export already emits final confidence scores.
  debug.scoresPreSigmoid = true;

  const maxConfByClass: Record<number, number> = {};
  let maxBoardScore = 0;
  let aboveThreshold = 0;
  const boxes: PreNMSBox[] = [];

  for (let i = 0; i < detections; i++) {
    const score = getPackedVal(data, i, 4, layout, detections, features);
    if (score < CONFIDENCE_GATE) continue;
    aboveThreshold++;

    const modelClass = Math.round(getPackedVal(data, i, 5, layout, detections, features));
    if (modelClass < 0 || modelClass >= NUM_CLASSES) continue;

    if (modelClass === CLASS_BOARD && score > maxBoardScore) {
      maxBoardScore = score;
    }

    const classId = mapModelClassToEngineClassId(modelClass);
    if (!maxConfByClass[classId] || score > maxConfByClass[classId]) {
      maxConfByClass[classId] = score;
    }

    const rx1 = getPackedVal(data, i, 0, layout, detections, features);
    const ry1 = getPackedVal(data, i, 1, layout, detections, features);
    const rx2 = getPackedVal(data, i, 2, layout, detections, features);
    const ry2 = getPackedVal(data, i, 3, layout, detections, features);

    const x1 = Math.min(rx1, rx2);
    const y1 = Math.min(ry1, ry2);
    const x2 = Math.max(rx1, rx2);
    const y2 = Math.max(ry1, ry2);

    const coeffs = new Float32Array(numMaskCoeffs);
    for (let m = 0; m < numMaskCoeffs; m++) {
      coeffs[m] = getPackedVal(data, i, 6 + m, layout, detections, features);
    }

    boxes.push({ classId, confidence: score, x1, y1, x2, y2, coeffs });
  }

  debug.maxBoardScore = maxBoardScore;
  debug.aboveThreshold = aboveThreshold;
  debug.maxConfByClass = maxConfByClass;

  // End-to-end export is already top-k filtered/suppressed in-model.
  return { boxes, alreadySuppressed: true };
}

function decodeRawAnchorBoxes(
  output0: Tensor,
  debug: Partial<PostprocessDebug>,
): DecodeBoxesResult {
  const data = output0.data as Float32Array;
  const { layout, rows, anchors } = detectRawLayout(output0);
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
    let bestModelClass = -1;
    let bestScore = -Infinity;

    for (let c = 0; c < NUM_CLASSES; c++) {
      const raw = getRawVal(data, 4 + c, a, layout, rows, anchors);
      const score = preSigmoid ? raw : sigmoid(raw);
      if (score > bestScore) {
        bestScore = score;
        bestModelClass = c;
      }
      if (c === CLASS_BOARD && score > maxBoardScore) {
        maxBoardScore = score;
      }
    }

    if (bestScore < CONFIDENCE_GATE || bestModelClass < 0) continue;
    aboveThreshold++;

    const classId = mapModelClassToEngineClassId(bestModelClass);
    if (!maxConfByClass[classId] || bestScore > maxConfByClass[classId]) {
      maxConfByClass[classId] = bestScore;
    }

    const cx = getRawVal(data, 0, a, layout, rows, anchors);
    const cy = getRawVal(data, 1, a, layout, rows, anchors);
    const w = Math.max(0, getRawVal(data, 2, a, layout, rows, anchors));
    const h = Math.max(0, getRawVal(data, 3, a, layout, rows, anchors));

    const x1 = cx - w / 2;
    const y1 = cy - h / 2;
    const x2 = cx + w / 2;
    const y2 = cy + h / 2;

    const coeffs = new Float32Array(numMaskCoeffs);
    for (let m = 0; m < numMaskCoeffs; m++) {
      coeffs[m] = getRawVal(data, 4 + NUM_CLASSES + m, a, layout, rows, anchors);
    }

    boxes.push({ classId, confidence: bestScore, x1, y1, x2, y2, coeffs });
  }

  debug.maxBoardScore = maxBoardScore;
  debug.aboveThreshold = aboveThreshold;
  debug.maxConfByClass = maxConfByClass;

  return { boxes, alreadySuppressed: false };
}

function decodeBoxes(
  output0: Tensor,
  output1: Tensor,
  debug: Partial<PostprocessDebug>,
): DecodeBoxesResult {
  const packed = decodePackedBoxes(output0, output1, debug);
  if (packed) return packed;
  return decodeRawAnchorBoxes(output0, debug);
}

// -- NMS ----------------------------------------------------------------------

function iou(a: PreNMSBox, b: PreNMSBox): number {
  const ix1 = Math.max(a.x1, b.x1);
  const iy1 = Math.max(a.y1, b.y1);
  const ix2 = Math.min(a.x2, b.x2);
  const iy2 = Math.min(a.y2, b.y2);

  const interW = Math.max(0, ix2 - ix1);
  const interH = Math.max(0, iy2 - iy1);
  const inter = interW * interH;
  if (inter === 0) return 0;

  const aArea = Math.max(0, a.x2 - a.x1) * Math.max(0, a.y2 - a.y1);
  const bArea = Math.max(0, b.x2 - b.x1) * Math.max(0, b.y2 - b.y1);
  if (aArea <= 0 || bArea <= 0) return 0;

  return inter / (aArea + bArea - inter);
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
    const suppressed = new Uint8Array(candidates.length);
    for (let i = 0; i < candidates.length; i++) {
      if (suppressed[i]) continue;
      kept.push(candidates[i]);
      for (let j = i + 1; j < candidates.length; j++) {
        if (!suppressed[j] && iou(candidates[i], candidates[j]) > NMS_IOU_THRESHOLD) {
          suppressed[j] = 1;
        }
      }
    }
  }

  return kept;
}

// -- Mask decoding ------------------------------------------------------------

function decodeMask(
  box: PreNMSBox,
  output1: Tensor,
  params: LetterboxParams,
  numMaskCoeffs: number,
): { polygon: [number, number][]; centroid: [number, number] } {
  const protoData = output1.data as Float32Array;
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
  const mx1 = Math.max(0, Math.floor(box.x1 * scaleX));
  const my1 = Math.max(0, Math.floor(box.y1 * scaleY));
  const mx2 = Math.min(maskW - 1, Math.ceil(box.x2 * scaleX));
  const my2 = Math.min(maskH - 1, Math.ceil(box.y2 * scaleY));

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
    const cx = ((box.x1 + box.x2) / 2 - params.padX) / params.scale;
    const cy = ((box.y1 + box.y2) / 2 - params.padY) / params.scale;
    return { polygon: [[cx, cy]], centroid: [cx, cy] };
  }

  let sumX = 0;
  let sumY = 0;
  for (const [px, py] of foreground) {
    sumX += px;
    sumY += py;
  }

  const centroid: [number, number] = [sumX / foreground.length, sumY / foreground.length];
  const polygon = computeConvexHull(foreground);
  return { polygon, centroid };
}

// -- Convex hull --------------------------------------------------------------

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
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: [number, number][] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// -- Public API ---------------------------------------------------------------

export interface DecodeResult {
  detections: RawDetection[];
  debug: PostprocessDebug;
}

/**
 * Converts raw ONNX output tensors into decoded detections.
 * Supports both packed end-to-end outputs and raw-anchor outputs.
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

  const decoded = decodeBoxes(output0, output1, debugPartial);
  const kept = decoded.alreadySuppressed ? decoded.boxes : applyNMS(decoded.boxes);

  const numMaskCoeffs = debugPartial.numMaskCoeffs ?? NUM_MASK_COEFFS;

  const detections: RawDetection[] = kept.map((box) => {
    const { polygon, centroid } = decodeMask(box, output1, params, numMaskCoeffs);
    const x1 = (box.x1 - params.padX) / params.scale;
    const y1 = (box.y1 - params.padY) / params.scale;
    const x2 = (box.x2 - params.padX) / params.scale;
    const y2 = (box.y2 - params.padY) / params.scale;

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
    tensorShape0: debugPartial.tensorShape0 ?? [],
    tensorShape1: debugPartial.tensorShape1 ?? [],
    layout: debugPartial.layout ?? "rows_first",
    numRows: debugPartial.numRows ?? 0,
    numAnchors: debugPartial.numAnchors ?? 0,
    numMaskCoeffs,
    scoresPreSigmoid: debugPartial.scoresPreSigmoid ?? true,
    maxBoardScore: debugPartial.maxBoardScore ?? 0,
    aboveThreshold: debugPartial.aboveThreshold ?? 0,
    afterNMS: detections.length,
    countsByClass,
    maxConfByClass: debugPartial.maxConfByClass ?? {},
  };

  return { detections, debug };
}
