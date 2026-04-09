import { InferenceRunner } from "../inference/InferenceRunner";
import { CLASS_PIECE_FIRST, CLASS_PIECE_LAST, MODEL_INPUT_SIZE } from "../inference/inferenceTypes";
import { preprocessImage } from "../inference/preprocessing";
import type { RawDetection } from "../inference/inferenceTypes";
import type { CalibratedBoardRef } from "./visionTypes";
import { applyHomography } from "./HomographyComputer";
import { BOARD_WIDTH, BOARD_HEIGHT } from "../engine/constants";

export interface RectifiedDetectionResult {
  detections: RawDetection[];
  rectifiedWidth: number;
  rectifiedHeight: number;
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function sourceSize(source: HTMLImageElement | HTMLCanvasElement | ImageBitmap): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth || source.width, height: source.naturalHeight || source.height };
  }
  if (source instanceof HTMLCanvasElement) {
    return { width: source.width, height: source.height };
  }
  return { width: source.width, height: source.height };
}

function invert3x3(H: number[][]): number[][] | null {
  const a = H[0][0], b = H[0][1], c = H[0][2];
  const d = H[1][0], e = H[1][1], f = H[1][2];
  const g = H[2][0], h = H[2][1], i = H[2][2];

  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const D = -(b * i - c * h);
  const E = a * i - c * g;
  const F = -(a * h - b * g);
  const G = b * f - c * e;
  const Hc = -(a * f - c * d);
  const I = a * e - b * d;

  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;

  const invDet = 1 / det;
  return [
    [A * invDet, D * invDet, G * invDet],
    [B * invDet, E * invDet, Hc * invDet],
    [C * invDet, F * invDet, I * invDet],
  ];
}

export function warpImageToCanonicalBoard(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  boardRef: CalibratedBoardRef,
  outSize = MODEL_INPUT_SIZE,
): HTMLCanvasElement | null {
  const { width, height } = sourceSize(source);
  if (width <= 0 || height <= 0) return null;

  const srcCanvas = createCanvas(width, height);
  const srcCtx = srcCanvas.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return null;
  srcCtx.drawImage(source as CanvasImageSource, 0, 0, width, height);

  const srcImage = srcCtx.getImageData(0, 0, width, height);
  const srcData = srcImage.data;

  const invH = invert3x3(boardRef.homographyMatrix);
  if (!invH) return null;

  const outCanvas = createCanvas(outSize, outSize);
  const outCtx = outCanvas.getContext("2d");
  if (!outCtx) return null;

  const outImage = outCtx.createImageData(outSize, outSize);
  const outData = outImage.data;

  for (let y = 0; y < outSize; y += 1) {
    const boardRow = (y / Math.max(1, outSize - 1)) * (BOARD_HEIGHT - 1);
    for (let x = 0; x < outSize; x += 1) {
      const boardCol = (x / Math.max(1, outSize - 1)) * (BOARD_WIDTH - 1);
      const [srcX, srcY] = applyHomography(invH, boardCol, boardRow);

      const sx = Math.round(srcX);
      const sy = Math.round(srcY);
      const outIdx = (y * outSize + x) * 4;

      if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
        outData[outIdx] = 0;
        outData[outIdx + 1] = 0;
        outData[outIdx + 2] = 0;
        outData[outIdx + 3] = 255;
        continue;
      }

      const srcIdx = (sy * width + sx) * 4;
      outData[outIdx] = srcData[srcIdx];
      outData[outIdx + 1] = srcData[srcIdx + 1];
      outData[outIdx + 2] = srcData[srcIdx + 2];
      outData[outIdx + 3] = srcData[srcIdx + 3];
    }
  }

  outCtx.putImageData(outImage, 0, 0);
  return outCanvas;
}

export async function rectifiedPieceDetection(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  boardRef: CalibratedBoardRef,
  runner: InferenceRunner,
): Promise<RectifiedDetectionResult | null> {
  const rectifiedCanvas = warpImageToCanonicalBoard(source, boardRef, MODEL_INPUT_SIZE);
  if (!rectifiedCanvas) return null;

  const preprocessed = await preprocessImage(rectifiedCanvas);
  const run = await runner.run(preprocessed.tensor, preprocessed.params);
  const detections = run.detections.filter(
    (det) => det.classId >= CLASS_PIECE_FIRST && det.classId <= CLASS_PIECE_LAST,
  );

  return {
    detections,
    rectifiedWidth: rectifiedCanvas.width,
    rectifiedHeight: rectifiedCanvas.height,
  };
}
