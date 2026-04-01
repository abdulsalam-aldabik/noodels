/**
 * ONNX Runtime Web inference for YOLO26n-seg (13 classes).
 *
 * Key fix from v2: mask coefficients are extracted during decodeDetections()
 * and stored directly in the Detection object — no re-indexing into output0Data.
 *
 * Output format (end2end=True): (1, 300, 38)
 *   [x1, y1, x2, y2, score, class_id, mask_coeff_0..mask_coeff_31]
 *   4 + 1 + 1 + 32 = 38
 */

import * as ort from 'onnxruntime-web';
import {
  MODEL_PATH,
  MODEL_INPUT_SIZE,
  CONFIDENCE_THRESHOLD,
  NUM_CLASSES,
  getClassLabel,
  getClassRgb,
} from '../constants';
import type { Detection, InferenceResult, ModelStatus } from '../types';

ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;

let session: ort.InferenceSession | null = null;
let statusCallback: ((status: ModelStatus, progress?: string) => void) | null = null;

export function onModelStatus(cb: (status: ModelStatus, progress?: string) => void) {
  statusCallback = cb;
}

export async function loadModel(): Promise<void> {
  if (session) return;
  statusCallback?.('loading', 'Downloading model...');

  try {
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    statusCallback?.('ready');
  } catch (error) {
    statusCallback?.('error', String(error));
    throw error;
  }
}

export function isModelLoaded(): boolean {
  return session !== null;
}

// ─── Preprocessing ──────────────────────────────────────────

function preprocessImage(imageSource: HTMLImageElement | HTMLCanvasElement) {
  const canvas = document.createElement('canvas');
  canvas.width = MODEL_INPUT_SIZE;
  canvas.height = MODEL_INPUT_SIZE;
  const ctx = canvas.getContext('2d')!;

  const origW = imageSource instanceof HTMLImageElement ? imageSource.naturalWidth : imageSource.width;
  const origH = imageSource instanceof HTMLImageElement ? imageSource.naturalHeight : imageSource.height;

  const scale = Math.min(MODEL_INPUT_SIZE / origW, MODEL_INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = Math.round((MODEL_INPUT_SIZE - newW) / 2);
  const padY = Math.round((MODEL_INPUT_SIZE - newH) / 2);

  ctx.fillStyle = 'rgb(114, 114, 114)';
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  ctx.drawImage(imageSource, padX, padY, newW, newH);

  const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const pixels = imageData.data;
  const size = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const float32Data = new Float32Array(3 * size);

  for (let i = 0; i < size; i++) {
    const rgbaIdx = i * 4;
    float32Data[i] = pixels[rgbaIdx] / 255.0;
    float32Data[size + i] = pixels[rgbaIdx + 1] / 255.0;
    float32Data[2 * size + i] = pixels[rgbaIdx + 2] / 255.0;
  }

  return {
    tensor: new ort.Tensor('float32', float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]),
    scale, padX, padY, originalWidth: origW, originalHeight: origH,
  };
}

// ─── Detection Decoding ─────────────────────────────────────

function decodeDetections(
  output0Data: Float32Array,
  output0Dims: readonly number[],
  scale: number,
  padX: number,
  padY: number,
): Detection[] {
  const detections: Detection[] = [];

  if (output0Dims.length !== 3) return detections;
  const [, dim1, dim2] = output0Dims;

  // End2end format: (1, 300, 38)
  if (dim2 === 38 && dim1 <= 300) {
    for (let i = 0; i < dim1; i++) {
      const offset = i * 38;
      const x1 = output0Data[offset + 0];
      const y1 = output0Data[offset + 1];
      const x2 = output0Data[offset + 2];
      const y2 = output0Data[offset + 3];
      const score = output0Data[offset + 4];
      const classId = Math.round(output0Data[offset + 5]);

      if (score < CONFIDENCE_THRESHOLD) continue;
      if (classId < 0 || classId >= NUM_CLASSES) continue;

      // Convert from letterboxed to original image coords
      const bx1 = (x1 - padX) / scale;
      const by1 = (y1 - padY) / scale;
      const bx2 = (x2 - padX) / scale;
      const by2 = (y2 - padY) / scale;

      // FIX: Extract mask coefficients RIGHT HERE, not later
      const maskCoeffs = new Float32Array(32);
      for (let m = 0; m < 32; m++) {
        maskCoeffs[m] = output0Data[offset + 6 + m];
      }

      detections.push({
        classId,
        label: getClassLabel(classId),
        confidence: score,
        bbox: [bx1, by1, bx2, by2],
        maskCoeffs,
        mask: null,
        rgb: getClassRgb(classId),
      });
    }
  }
  // Non-end2end format: (1, features, candidates)
  else if (dim1 > dim2 || dim1 === (4 + NUM_CLASSES + 32)) {
    const numFeatures = dim1;
    const numCandidates = dim2;

    const candidates: Array<{
      classId: number; score: number;
      bbox: [number, number, number, number];
      maskCoeffs: Float32Array;
    }> = [];

    for (let j = 0; j < numCandidates; j++) {
      const cx = output0Data[0 * numCandidates + j];
      const cy = output0Data[1 * numCandidates + j];
      const w = output0Data[2 * numCandidates + j];
      const h = output0Data[3 * numCandidates + j];

      let bestClassId = 0;
      let bestScore = 0;
      for (let c = 0; c < NUM_CLASSES; c++) {
        const s = output0Data[(4 + c) * numCandidates + j];
        if (s > bestScore) { bestScore = s; bestClassId = c; }
      }
      if (bestScore < CONFIDENCE_THRESHOLD) continue;

      const maskStart = 4 + NUM_CLASSES;
      const maskCoeffs = new Float32Array(numFeatures - maskStart);
      for (let m = 0; m < maskCoeffs.length; m++) {
        maskCoeffs[m] = output0Data[(maskStart + m) * numCandidates + j];
      }

      candidates.push({
        classId: bestClassId, score: bestScore,
        bbox: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
        maskCoeffs,
      });
    }

    // NMS
    const kept = applyNMS(candidates, 0.5);

    for (const c of kept) {
      detections.push({
        classId: c.classId,
        label: getClassLabel(c.classId),
        confidence: c.score,
        bbox: [
          (c.bbox[0] - padX) / scale,
          (c.bbox[1] - padY) / scale,
          (c.bbox[2] - padX) / scale,
          (c.bbox[3] - padY) / scale,
        ],
        maskCoeffs: c.maskCoeffs,
        mask: null,
        rgb: getClassRgb(c.classId),
      });
    }
  }

  return detections;
}

function applyNMS<T extends { score: number; bbox: [number, number, number, number] }>(
  candidates: T[], iouThreshold: number,
): T[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);
    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      if (computeIoU(sorted[i].bbox, sorted[j].bbox) > iouThreshold) suppressed.add(j);
    }
  }
  return kept;
}

function computeIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── Mask Decoding ──────────────────────────────────────────

function decodeMasks(
  output1Data: Float32Array,
  detections: Detection[],
  scale: number,
  padX: number,
  padY: number,
  originalWidth: number,
  originalHeight: number,
): void {
  const MASK_SIZE = 160;
  const NUM_PROTOS = 32;

  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = originalWidth;
  maskCanvas.height = originalHeight;
  const maskCtx = maskCanvas.getContext('2d')!;

  for (const det of detections) {
    if (!det.maskCoeffs || det.maskCoeffs.length < NUM_PROTOS) continue;

    // Compute per-pixel mask: sigmoid(sum(coeff_i * proto_i))
    const maskPixels = new Float32Array(MASK_SIZE * MASK_SIZE);
    for (let p = 0; p < NUM_PROTOS; p++) {
      const protoOffset = p * MASK_SIZE * MASK_SIZE;
      const c = det.maskCoeffs[p];
      for (let i = 0; i < MASK_SIZE * MASK_SIZE; i++) {
        maskPixels[i] += c * output1Data[protoOffset + i];
      }
    }

    // Sigmoid
    for (let i = 0; i < maskPixels.length; i++) {
      maskPixels[i] = 1.0 / (1.0 + Math.exp(-maskPixels[i]));
    }

    // Crop to bbox in 160-scale coords
    const [r, g, b] = det.rgb;
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = MASK_SIZE;
    smallCanvas.height = MASK_SIZE;
    const smallCtx = smallCanvas.getContext('2d')!;
    const smallImageData = smallCtx.createImageData(MASK_SIZE, MASK_SIZE);

    const bx1_160 = Math.max(0, Math.floor((det.bbox[0] * scale + padX) * (MASK_SIZE / MODEL_INPUT_SIZE)));
    const by1_160 = Math.max(0, Math.floor((det.bbox[1] * scale + padY) * (MASK_SIZE / MODEL_INPUT_SIZE)));
    const bx2_160 = Math.min(MASK_SIZE, Math.ceil((det.bbox[2] * scale + padX) * (MASK_SIZE / MODEL_INPUT_SIZE)));
    const by2_160 = Math.min(MASK_SIZE, Math.ceil((det.bbox[3] * scale + padY) * (MASK_SIZE / MODEL_INPUT_SIZE)));

    for (let y = 0; y < MASK_SIZE; y++) {
      for (let x = 0; x < MASK_SIZE; x++) {
        const idx = y * MASK_SIZE + x;
        const pixIdx = idx * 4;
        const inBbox = x >= bx1_160 && x < bx2_160 && y >= by1_160 && y < by2_160;
        const alpha = inBbox && maskPixels[idx] > 0.5 ? 150 : 0;

        smallImageData.data[pixIdx + 0] = r;
        smallImageData.data[pixIdx + 1] = g;
        smallImageData.data[pixIdx + 2] = b;
        smallImageData.data[pixIdx + 3] = alpha;
      }
    }

    smallCtx.putImageData(smallImageData, 0, 0);

    // Scale to original image size (undo letterbox)
    maskCtx.clearRect(0, 0, originalWidth, originalHeight);
    const srcX = padX * (MASK_SIZE / MODEL_INPUT_SIZE);
    const srcY = padY * (MASK_SIZE / MODEL_INPUT_SIZE);
    const srcW = (originalWidth * scale) * (MASK_SIZE / MODEL_INPUT_SIZE);
    const srcH = (originalHeight * scale) * (MASK_SIZE / MODEL_INPUT_SIZE);

    maskCtx.drawImage(smallCanvas, srcX, srcY, srcW, srcH, 0, 0, originalWidth, originalHeight);
    det.mask = maskCtx.getImageData(0, 0, originalWidth, originalHeight);
  }
}

// ─── Main Entry ─────────────────────────────────────────────

export async function runInference(
  imageSource: HTMLImageElement | HTMLCanvasElement,
): Promise<InferenceResult> {
  if (!session) throw new Error('Model not loaded. Call loadModel() first.');

  const t0 = performance.now();
  const { tensor, scale, padX, padY, originalWidth, originalHeight } = preprocessImage(imageSource);
  const preprocessTimeMs = performance.now() - t0;

  const t1 = performance.now();
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = tensor;
  const results = await session.run(feeds);
  const inferenceTimeMs = performance.now() - t1;

  const t2 = performance.now();
  const output0 = results[session.outputNames[0]];
  const output1 = results[session.outputNames[1]];

  const detections = decodeDetections(
    output0.data as Float32Array, output0.dims, scale, padX, padY,
  );

  if (output1) {
    decodeMasks(
      output1.data as Float32Array, detections,
      scale, padX, padY, originalWidth, originalHeight,
    );
  }

  const postprocessTimeMs = performance.now() - t2;

  return {
    detections,
    inferenceTimeMs,
    preprocessTimeMs,
    postprocessTimeMs,
    originalSize: { width: originalWidth, height: originalHeight },
  };
}
