/**
 * ONNX Runtime Web inference engine for YOLO26n-seg model.
 *
 * Handles model loading, image preprocessing, inference, and
 * postprocessing (NMS, mask decoding) for IQ Noodles piece detection.
 *
 * Model I/O (from training notebook output):
 *   Input:  (1, 3, 640, 640) BCHW float32
 *   Output0: (1, 300, 38)          — 300 candidate detections, each with 4 bbox + 11 class probs + 1 placeholder + ... wait
 *            Actually for YOLO seg: (1, 38, 8400) transposed — need to check
 *   Output1: (1, 32, 160, 160)     — 32 prototype masks at 1/4 resolution
 *
 *   Per detection (38 values):
 *     [0:4]   = cx, cy, w, h (center-form bbox)
 *     [4:15]  = 11 class probabilities
 *     [15:16] = unused or additional
 *     [4+NUM_CLASSES : 4+NUM_CLASSES+32] = 32 mask coefficients
 *
 *   But the notebook says output shape is (1, 300, 38) which is end2end=True format.
 *   38 = 4 (bbox) + 1 (conf?) + 11 (classes) + ... let's handle both formats.
 *
 *   Actually from the notebook: output shape(s) ((1, 300, 38), (1, 32, 160, 160))
 *   This is the end2end format where NMS is already applied.
 *   38 = 4 (x1,y1,x2,y2) + 1 (score) + 1 (class_id) + 32 (mask_coeffs)
 *   Wait, 4+1+1+32 = 38. Yes!
 */

import * as ort from 'onnxruntime-web';
import {
  MODEL_PATH,
  MODEL_INPUT_SIZE,
  CONFIDENCE_THRESHOLD,
  NUM_CLASSES,
  PIECE_LABELS,
  PIECE_COLORS,
} from './constants';
import type { Detection, InferenceResult, ModelStatus } from './types';

// Configure ONNX Runtime to use WASM backend
ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;

let session: ort.InferenceSession | null = null;
let statusCallback: ((status: ModelStatus, progress?: string) => void) | null = null;

/** Set a callback to receive model loading status updates */
export function onModelStatus(cb: (status: ModelStatus, progress?: string) => void) {
  statusCallback = cb;
}

/** Load the ONNX model */
export async function loadModel(): Promise<void> {
  if (session) return;

  statusCallback?.('loading', 'Downloading model...');

  try {
    session = await ort.InferenceSession.create(MODEL_PATH, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    statusCallback?.('ready');
    console.log('✅ ONNX model loaded successfully');
    console.log('   Input names:', session.inputNames);
    console.log('   Output names:', session.outputNames);
  } catch (error) {
    console.error('❌ Failed to load ONNX model:', error);
    statusCallback?.('error', String(error));
    throw error;
  }
}

/** Check if model is loaded */
export function isModelLoaded(): boolean {
  return session !== null;
}

/**
 * Preprocess an image for YOLO inference.
 * Letterbox-resizes to 640x640, normalizes to [0,1], converts to NCHW tensor.
 */
function preprocessImage(
  imageSource: HTMLImageElement | HTMLCanvasElement,
): {
  tensor: ort.Tensor;
  scale: number;
  padX: number;
  padY: number;
  originalWidth: number;
  originalHeight: number;
} {
  const canvas = document.createElement('canvas');
  canvas.width = MODEL_INPUT_SIZE;
  canvas.height = MODEL_INPUT_SIZE;
  const ctx = canvas.getContext('2d')!;

  // Get original dimensions
  const origW = imageSource instanceof HTMLImageElement ? imageSource.naturalWidth : imageSource.width;
  const origH = imageSource instanceof HTMLImageElement ? imageSource.naturalHeight : imageSource.height;

  // Letterbox resize (maintain aspect ratio, pad with gray)
  const scale = Math.min(MODEL_INPUT_SIZE / origW, MODEL_INPUT_SIZE / origH);
  const newW = Math.round(origW * scale);
  const newH = Math.round(origH * scale);
  const padX = Math.round((MODEL_INPUT_SIZE - newW) / 2);
  const padY = Math.round((MODEL_INPUT_SIZE - newH) / 2);

  // Fill with gray (114/255 is YOLO standard letterbox color)
  ctx.fillStyle = `rgb(114, 114, 114)`;
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);

  // Draw resized image centered
  ctx.drawImage(imageSource, padX, padY, newW, newH);

  // Extract pixel data
  const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const pixels = imageData.data; // RGBA flat array

  // Convert to NCHW float32 tensor, normalized to [0, 1]
  const size = MODEL_INPUT_SIZE * MODEL_INPUT_SIZE;
  const float32Data = new Float32Array(3 * size);

  for (let i = 0; i < size; i++) {
    const rgbaIdx = i * 4;
    float32Data[i]            = pixels[rgbaIdx]     / 255.0; // R
    float32Data[size + i]     = pixels[rgbaIdx + 1] / 255.0; // G
    float32Data[2 * size + i] = pixels[rgbaIdx + 2] / 255.0; // B
  }

  const tensor = new ort.Tensor('float32', float32Data, [1, 3, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE]);

  return { tensor, scale, padX, padY, originalWidth: origW, originalHeight: origH };
}

/**
 * Decode the YOLO output into detections.
 *
 * The model with end2end=True outputs (1, 300, 38):
 *   [x1, y1, x2, y2, score, class_id, mask_coeff_0..mask_coeff_31]
 *
 * If the model is NOT end2end, output is (1, 38, 8400) and we need to transpose + NMS.
 * We handle both cases.
 */
type RawDetection = Omit<Detection, 'mask'> & { _rowIndex: number };

function decodeDetections(
  output0Data: Float32Array,
  output0Dims: readonly number[],
  scale: number,
  padX: number,
  padY: number,
): RawDetection[] {
  const detections: RawDetection[] = [];

  if (output0Dims.length === 3) {
    const [, dim1, dim2] = output0Dims;

    // End2end format: (1, 300, 38) — NMS already done
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

        // Convert from letterboxed coords to original image coords
        const bx1 = (x1 - padX) / scale;
        const by1 = (y1 - padY) / scale;
        const bx2 = (x2 - padX) / scale;
        const by2 = (y2 - padY) / scale;

        const label = PIECE_LABELS[classId];
        const pieceInfo = PIECE_COLORS[label];

        detections.push({
          classId,
          label,
          colorName: pieceInfo.name,
          rgb: pieceInfo.rgb,
          confidence: score,
          bbox: [bx1, by1, bx2, by2],
          _rowIndex: i,
        });
      }
    }
    // Non-end2end format: (1, 38, 8400)
    else if (dim1 === (4 + NUM_CLASSES + 32) || dim1 > dim2) {
      // Transpose: treat as (1, features, num_candidates)
      const numFeatures = dim1;
      const numCandidates = dim2;

      // Collect raw candidates
      const candidates: Array<{
        classId: number;
        score: number;
        bbox: [number, number, number, number];
        maskCoeffs: Float32Array;
      }> = [];

      for (let j = 0; j < numCandidates; j++) {
        // cx, cy, w, h
        const cx = output0Data[0 * numCandidates + j];
        const cy = output0Data[1 * numCandidates + j];
        const w  = output0Data[2 * numCandidates + j];
        const h  = output0Data[3 * numCandidates + j];

        // Find best class
        let bestClassId = 0;
        let bestScore = 0;
        for (let c = 0; c < NUM_CLASSES; c++) {
          const classScore = output0Data[(4 + c) * numCandidates + j];
          if (classScore > bestScore) {
            bestScore = classScore;
            bestClassId = c;
          }
        }

        if (bestScore < CONFIDENCE_THRESHOLD) continue;

        // Convert center-form to corner-form
        const x1 = cx - w / 2;
        const y1 = cy - h / 2;
        const x2 = cx + w / 2;
        const y2 = cy + h / 2;

        // Mask coefficients
        const maskStart = (4 + NUM_CLASSES);
        const maskCoeffs = new Float32Array(numFeatures - maskStart);
        for (let m = 0; m < maskCoeffs.length; m++) {
          maskCoeffs[m] = output0Data[(maskStart + m) * numCandidates + j];
        }

        candidates.push({
          classId: bestClassId,
          score: bestScore,
          bbox: [x1, y1, x2, y2],
          maskCoeffs,
        });
      }

      // Apply NMS
      const kept = applyNMS(candidates, 0.5);

      for (const c of kept) {
        const bx1 = (c.bbox[0] - padX) / scale;
        const by1 = (c.bbox[1] - padY) / scale;
        const bx2 = (c.bbox[2] - padX) / scale;
        const by2 = (c.bbox[3] - padY) / scale;

        const label = PIECE_LABELS[c.classId];
        const pieceInfo = PIECE_COLORS[label];

        detections.push({
          classId: c.classId,
          label,
          colorName: pieceInfo.name,
          rgb: pieceInfo.rgb,
          confidence: c.score,
          bbox: [bx1, by1, bx2, by2],
          _rowIndex: -1, // non-end2end doesn't need row index
        });
      }
    }
  }

  return detections;
}

/** Simple IoU-based NMS */
function applyNMS<T extends { score: number; bbox: [number, number, number, number] }>(
  candidates: T[],
  iouThreshold: number,
): T[] {
  // Sort by score descending
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const kept: T[] = [];
  const suppressed = new Set<number>();

  for (let i = 0; i < sorted.length; i++) {
    if (suppressed.has(i)) continue;
    kept.push(sorted[i]);

    for (let j = i + 1; j < sorted.length; j++) {
      if (suppressed.has(j)) continue;
      if (computeIoU(sorted[i].bbox, sorted[j].bbox) > iouThreshold) {
        suppressed.add(j);
      }
    }
  }

  return kept;
}

/** Compute Intersection over Union */
function computeIoU(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]);
  const y2 = Math.min(a[3], b[3]);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const aArea = (a[2] - a[0]) * (a[3] - a[1]);
  const bArea = (b[2] - b[0]) * (b[3] - b[1]);
  const union = aArea + bArea - intersection;

  return union > 0 ? intersection / union : 0;
}

/**
 * Decode instance segmentation masks from prototype masks and coefficients.
 *
 * For end2end format: mask_coeffs are at indices [6:38] of each detection (32 values).
 * output1 has shape (1, 32, 160, 160) — 32 prototype masks at 160x160 (1/4 of 640).
 *
 * Per-instance mask = sigmoid( sum(coeffs[i] * proto[i]) ) for each pixel.
 * Then crop to bbox and resize to original image size.
 */
function decodeMasks(
  output0Data: Float32Array,
  output0Dims: readonly number[],
  output1Data: Float32Array,
  _output1Dims: readonly number[],
  detections: RawDetection[],
  scale: number,
  padX: number,
  padY: number,
  originalWidth: number,
  originalHeight: number,
): Detection[] {
  const MASK_SIZE = 160;
  const NUM_PROTOS = 32;
  const [, dim1, dim2] = output0Dims;

  // Create an offscreen canvas for mask rendering
  const maskCanvas = document.createElement('canvas');
  maskCanvas.width = originalWidth;
  maskCanvas.height = originalHeight;
  const maskCtx = maskCanvas.getContext('2d')!;

  return detections.map((det) => {
    // Extract mask coefficients using the original row index
    let coeffs: number[];

    if (dim2 === 38 && dim1 <= 300) {
      // End2end: coeffs at [6:38] for each detection row
      // Use the original row index, not the filtered array index
      const offset = det._rowIndex * 38;
      coeffs = Array.from(output0Data.slice(offset + 6, offset + 38));
    } else {
      // Non-end2end: already extracted during decoding — skip masks for now
      return { ...det, mask: null };
    }

    if (coeffs.length !== NUM_PROTOS) {
      return { ...det, mask: null };
    }

    // Compute per-pixel mask: sigmoid(sum(coeff_i * proto_i))
    const maskPixels = new Float32Array(MASK_SIZE * MASK_SIZE);

    for (let p = 0; p < NUM_PROTOS; p++) {
      const protoOffset = p * MASK_SIZE * MASK_SIZE;
      const c = coeffs[p];
      for (let i = 0; i < MASK_SIZE * MASK_SIZE; i++) {
        maskPixels[i] += c * output1Data[protoOffset + i];
      }
    }

    // Apply sigmoid
    for (let i = 0; i < maskPixels.length; i++) {
      maskPixels[i] = 1.0 / (1.0 + Math.exp(-maskPixels[i]));
    }

    // Crop mask to bbox (in letterboxed 640 coords, scaled down to 160)
    // Then render to original image size
    const [r, g, b] = det.rgb;

    // Create the mask on a small canvas first
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = MASK_SIZE;
    smallCanvas.height = MASK_SIZE;
    const smallCtx = smallCanvas.getContext('2d')!;
    const smallImageData = smallCtx.createImageData(MASK_SIZE, MASK_SIZE);

    // Compute bbox in 160-scale coords for cropping
    const bx1_160 = Math.max(0, Math.floor((det.bbox[0] * scale + padX) * (MASK_SIZE / MODEL_INPUT_SIZE)));
    const by1_160 = Math.max(0, Math.floor((det.bbox[1] * scale + padY) * (MASK_SIZE / MODEL_INPUT_SIZE)));
    const bx2_160 = Math.min(MASK_SIZE, Math.ceil((det.bbox[2] * scale + padX) * (MASK_SIZE / MODEL_INPUT_SIZE)));
    const by2_160 = Math.min(MASK_SIZE, Math.ceil((det.bbox[3] * scale + padY) * (MASK_SIZE / MODEL_INPUT_SIZE)));

    for (let y = 0; y < MASK_SIZE; y++) {
      for (let x = 0; x < MASK_SIZE; x++) {
        const idx = y * MASK_SIZE + x;
        const pixIdx = idx * 4;

        // Only render within bbox
        const inBbox = x >= bx1_160 && x < bx2_160 && y >= by1_160 && y < by2_160;
        const alpha = inBbox && maskPixels[idx] > 0.5 ? 150 : 0;

        smallImageData.data[pixIdx + 0] = r;
        smallImageData.data[pixIdx + 1] = g;
        smallImageData.data[pixIdx + 2] = b;
        smallImageData.data[pixIdx + 3] = alpha;
      }
    }

    smallCtx.putImageData(smallImageData, 0, 0);

    // Scale up to original image size (undo letterbox)
    maskCtx.clearRect(0, 0, originalWidth, originalHeight);

    // The 160x160 mask corresponds to the 640x640 letterboxed image.
    // We need to map it back to original image coords.
    const srcX = padX * (MASK_SIZE / MODEL_INPUT_SIZE);
    const srcY = padY * (MASK_SIZE / MODEL_INPUT_SIZE);
    const srcW = (originalWidth * scale) * (MASK_SIZE / MODEL_INPUT_SIZE);
    const srcH = (originalHeight * scale) * (MASK_SIZE / MODEL_INPUT_SIZE);

    maskCtx.drawImage(
      smallCanvas,
      srcX, srcY, srcW, srcH,  // source rect in 160x160 space
      0, 0, originalWidth, originalHeight,  // dest rect in original image space
    );

    const finalMask = maskCtx.getImageData(0, 0, originalWidth, originalHeight);

    return { ...det, mask: finalMask };
  });
}

/**
 * Run inference on an image element.
 */
export async function runInference(
  imageSource: HTMLImageElement | HTMLCanvasElement,
): Promise<InferenceResult> {
  if (!session) {
    throw new Error('Model not loaded. Call loadModel() first.');
  }

  // Preprocess
  const t0 = performance.now();
  const { tensor, scale, padX, padY, originalWidth, originalHeight } = preprocessImage(imageSource);
  const preprocessTimeMs = performance.now() - t0;

  // Inference
  const t1 = performance.now();
  const feeds: Record<string, ort.Tensor> = {};
  feeds[session.inputNames[0]] = tensor;
  const results = await session.run(feeds);
  const inferenceTimeMs = performance.now() - t1;

  // Postprocess
  const t2 = performance.now();

  const output0 = results[session.outputNames[0]];
  const output1 = results[session.outputNames[1]];

  const output0Data = output0.data as Float32Array;
  const output0Dims = output0.dims;

  // Decode detections (handles both end2end and raw formats)
  const rawDetections = decodeDetections(output0Data, output0Dims, scale, padX, padY);

  // Decode masks if prototype masks are available
  let detections: Detection[];
  if (output1) {
    const output1Data = output1.data as Float32Array;
    const output1Dims = output1.dims;
    detections = decodeMasks(
      output0Data, output0Dims,
      output1Data, output1Dims,
      rawDetections,
      scale, padX, padY,
      originalWidth, originalHeight,
    );
  } else {
    detections = rawDetections.map(d => ({ ...d, mask: null }));
  }

  const postprocessTimeMs = performance.now() - t2;

  console.log(`✅ Inference complete: ${detections.length} pieces detected`);
  console.log(`   Preprocess: ${preprocessTimeMs.toFixed(1)}ms`);
  console.log(`   Inference:  ${inferenceTimeMs.toFixed(1)}ms`);
  console.log(`   Postprocess: ${postprocessTimeMs.toFixed(1)}ms`);

  return {
    detections,
    inferenceTimeMs,
    preprocessTimeMs,
    postprocessTimeMs,
    originalSize: { width: originalWidth, height: originalHeight },
  };
}
