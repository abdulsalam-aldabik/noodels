import {
  CLASS_NAMES,
  type BoundingBox,
  type DetectionMask,
  type RawDetection,
} from "./types";
import { modelToSourceBox, type LetterboxInfo } from "./preprocessing";

export const DEFAULT_CONF_THRESHOLD = 0.25;
export const DEFAULT_IOU_THRESHOLD = 0.5;
export const MASK_COEFFS = 32;
export const END2END_ATTRS = 6 + MASK_COEFFS;

interface RawAnchor {
  xc: number;
  yc: number;
  w: number;
  h: number;
  score: number;
  classId: number;
  maskCoeffs: Float32Array;
}

/**
 * Decode a YOLOv8-seg `output0` tensor of shape [1, 4+numClasses+32, numAnchors]
 * into a list of surviving anchors after confidence filtering.
 * The raw tensor is stored in channel-major order, which is why we index as
 * `data[channel * numAnchors + anchorIdx]`.
 */
export function decodeDetectionOutput(
  output0: Float32Array,
  numClasses: number,
  numAnchors: number,
  confThreshold: number = DEFAULT_CONF_THRESHOLD,
): RawAnchor[] {
  const channels = 4 + numClasses + MASK_COEFFS;
  if (output0.length !== channels * numAnchors) {
    throw new Error(
      `decodeDetectionOutput: expected ${channels * numAnchors} values, got ${output0.length}`,
    );
  }
  const survivors: RawAnchor[] = [];
  for (let a = 0; a < numAnchors; a++) {
    let bestClass = -1;
    let bestScore = -Infinity;
    for (let c = 0; c < numClasses; c++) {
      const score = output0[(4 + c) * numAnchors + a];
      if (score > bestScore) {
        bestScore = score;
        bestClass = c;
      }
    }
    if (bestScore < confThreshold) continue;

    const coeffs = new Float32Array(MASK_COEFFS);
    for (let k = 0; k < MASK_COEFFS; k++) {
      coeffs[k] = output0[(4 + numClasses + k) * numAnchors + a];
    }
    survivors.push({
      xc: output0[0 * numAnchors + a],
      yc: output0[1 * numAnchors + a],
      w: output0[2 * numAnchors + a],
      h: output0[3 * numAnchors + a],
      score: bestScore,
      classId: bestClass,
      maskCoeffs: coeffs,
    });
  }
  return survivors;
}

function iou(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const xi1 = Math.max(a[0], b[0]);
  const yi1 = Math.max(a[1], b[1]);
  const xi2 = Math.min(a[2], b[2]);
  const yi2 = Math.min(a[3], b[3]);
  const iw = Math.max(0, xi2 - xi1);
  const ih = Math.max(0, yi2 - yi1);
  const inter = iw * ih;
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const union = areaA + areaB - inter;
  return union <= 0 ? 0 : inter / union;
}

interface NmsAnchor extends RawAnchor {
  box: [number, number, number, number];
}

/** Class-wise non-max suppression. */
export function nonMaxSuppression(
  anchors: RawAnchor[],
  iouThreshold: number = DEFAULT_IOU_THRESHOLD,
): NmsAnchor[] {
  const withBox: NmsAnchor[] = anchors.map((a) => ({
    ...a,
    box: [a.xc - a.w / 2, a.yc - a.h / 2, a.xc + a.w / 2, a.yc + a.h / 2],
  }));
  withBox.sort((a, b) => b.score - a.score);

  const kept: NmsAnchor[] = [];
  const suppressed = new Uint8Array(withBox.length);
  for (let i = 0; i < withBox.length; i++) {
    if (suppressed[i]) continue;
    kept.push(withBox[i]);
    for (let j = i + 1; j < withBox.length; j++) {
      if (suppressed[j]) continue;
      if (withBox[i].classId !== withBox[j].classId) continue;
      if (iou(withBox[i].box, withBox[j].box) >= iouThreshold) {
        suppressed[j] = 1;
      }
    }
  }
  return kept;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Build a per-detection binary mask by multiplying the mask-coefficient vector
 * against the prototype tensor (shape [maskCount, protoH, protoW]), sigmoid,
 * then cropping to the detection bbox and thresholding.
 *
 * Returned mask is at prototype resolution but cropped to the bbox region,
 * which is the standard YOLO-seg post-step. Coordinates are in prototype
 * space; callers map them to source-image space via the letterbox info.
 */
export function buildInstanceMask(
  maskCoeffs: Float32Array,
  protos: Float32Array,
  protoCount: number,
  protoH: number,
  protoW: number,
  bboxModel: [number, number, number, number],
  inputSize: number,
  threshold = 0.5,
): DetectionMask {
  const scaleX = protoW / inputSize;
  const scaleY = protoH / inputSize;
  const x1 = Math.max(0, Math.floor(bboxModel[0] * scaleX));
  const y1 = Math.max(0, Math.floor(bboxModel[1] * scaleY));
  const x2 = Math.min(protoW, Math.ceil(bboxModel[2] * scaleX));
  const y2 = Math.min(protoH, Math.ceil(bboxModel[3] * scaleY));
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);

  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      const py = y1 + y;
      const px = x1 + x;
      const pIdx = py * protoW + px;
      for (let k = 0; k < protoCount; k++) {
        sum += maskCoeffs[k] * protos[k * protoH * protoW + pIdx];
      }
      data[y * w + x] = sigmoid(sum) > threshold ? 1 : 0;
    }
  }
  return { width: w, height: h, data };
}

export interface ProtoTensor {
  data: Float32Array;
  count: number;
  height: number;
  width: number;
}

function buildDetection(
  classId: number,
  score: number,
  bboxModel: [number, number, number, number],
  maskCoeffs: Float32Array,
  proto: ProtoTensor,
  letterbox: LetterboxInfo,
): RawDetection | null {
  const bboxSrc: BoundingBox = modelToSourceBox(bboxModel, letterbox);
  if (bboxSrc.width <= 0 || bboxSrc.height <= 0) return null;

  const mask = buildInstanceMask(
    maskCoeffs,
    proto.data,
    proto.count,
    proto.height,
    proto.width,
    bboxModel,
    letterbox.inputSize,
  );

  return {
    classId,
    className: CLASS_NAMES[classId] ?? `class_${classId}`,
    score,
    bbox: bboxSrc,
    mask,
  };
}

/**
 * Postprocess end-to-end Ultralytics export where output0 is laid out as:
 *   [1, numDetections, 6 + 32]  (x1, y1, x2, y2, score, class_id, 32 mask coeffs)
 * or transposed:
 *   [1, 6 + 32, numDetections]
 */
export function postprocessEnd2End(
  output0: Float32Array,
  numDetections: number,
  attrsPerDetection: number,
  proto: ProtoTensor,
  letterbox: LetterboxInfo,
  confThreshold: number = DEFAULT_CONF_THRESHOLD,
  transposed: boolean = false,
): RawDetection[] {
  if (attrsPerDetection < END2END_ATTRS) {
    throw new Error(
      `postprocessEnd2End: attrsPerDetection must be >= ${END2END_ATTRS}, got ${attrsPerDetection}`,
    );
  }

  const expected = numDetections * attrsPerDetection;
  if (output0.length !== expected) {
    throw new Error(
      `postprocessEnd2End: expected ${expected} values, got ${output0.length}`,
    );
  }

  const valueAt = (detIdx: number, attrIdx: number): number => {
    if (transposed) {
      return output0[attrIdx * numDetections + detIdx];
    }
    return output0[detIdx * attrsPerDetection + attrIdx];
  };

  const out: RawDetection[] = [];
  for (let detIdx = 0; detIdx < numDetections; detIdx++) {
    const score = valueAt(detIdx, 4);
    if (score < confThreshold) continue;

    const classId = Math.round(valueAt(detIdx, 5));
    if (classId < 0) continue;

    const bboxModel: [number, number, number, number] = [
      valueAt(detIdx, 0),
      valueAt(detIdx, 1),
      valueAt(detIdx, 2),
      valueAt(detIdx, 3),
    ];

    const maskCoeffs = new Float32Array(MASK_COEFFS);
    for (let k = 0; k < MASK_COEFFS; k++) {
      maskCoeffs[k] = valueAt(detIdx, 6 + k);
    }

    const detection = buildDetection(
      classId,
      score,
      bboxModel,
      maskCoeffs,
      proto,
      letterbox,
    );
    if (detection) {
      out.push(detection);
    }
  }

  return out;
}

/**
 * Full postprocessing: decode + NMS + build masks + letterbox-unwind bbox ->
 * list of RawDetection in original source-image coordinates. Masks remain in
 * prototype coordinates and carry their crop origin through bbox.
 */
export function postprocess(
  output0: Float32Array,
  proto: ProtoTensor,
  numClasses: number,
  numAnchors: number,
  letterbox: LetterboxInfo,
  confThreshold: number = DEFAULT_CONF_THRESHOLD,
  iouThreshold: number = DEFAULT_IOU_THRESHOLD,
): RawDetection[] {
  const anchors = decodeDetectionOutput(output0, numClasses, numAnchors, confThreshold);
  const kept = nonMaxSuppression(anchors, iouThreshold);

  const out: RawDetection[] = [];
  for (const k of kept) {
    const detection = buildDetection(
      k.classId,
      k.score,
      k.box,
      k.maskCoeffs,
      proto,
      letterbox,
    );
    if (detection) {
      out.push(detection);
    }
  }
  return out;
}
