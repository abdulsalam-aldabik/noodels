import type { ImageSize } from "./types";

export const MODEL_INPUT_SIZE = 640;

export interface LetterboxInfo {
  /** Model input side length (pixels). */
  inputSize: number;
  /** Original source image size (pixels). */
  sourceSize: ImageSize;
  /** Resized (unpadded) image size that was placed on the letterboxed canvas. */
  resizedSize: ImageSize;
  /** Scale factor applied to source → resized. */
  scale: number;
  /** Horizontal padding (left side) in model-input px. */
  padX: number;
  /** Vertical padding (top side) in model-input px. */
  padY: number;
}

/**
 * Read a loaded image into a model-ready NCHW float32 tensor. The image is
 * letterboxed (preserving aspect ratio) into an inputSize×inputSize square,
 * RGB-normalized to [0,1], and laid out as [1, 3, inputSize, inputSize].
 *
 * The returned LetterboxInfo allows postprocessing to undo the transform
 * and map detections back to original image coordinates.
 */
export function imageToTensor(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  inputSize: number = MODEL_INPUT_SIZE,
): { tensor: Float32Array; info: LetterboxInfo } {
  const srcW =
    image instanceof HTMLImageElement
      ? image.naturalWidth
      : image instanceof HTMLCanvasElement
        ? image.width
        : image.width;
  const srcH =
    image instanceof HTMLImageElement
      ? image.naturalHeight
      : image instanceof HTMLCanvasElement
        ? image.height
        : image.height;

  const scale = Math.min(inputSize / srcW, inputSize / srcH);
  const resizedW = Math.round(srcW * scale);
  const resizedH = Math.round(srcH * scale);
  const padX = Math.floor((inputSize - resizedW) / 2);
  const padY = Math.floor((inputSize - resizedH) / 2);

  const canvas = document.createElement("canvas");
  canvas.width = inputSize;
  canvas.height = inputSize;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("imageToTensor: could not get 2d context");

  // Fill with letterbox gray (114) matching Ultralytics default.
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, inputSize, inputSize);
  ctx.drawImage(image, 0, 0, srcW, srcH, padX, padY, resizedW, resizedH);

  const { data } = ctx.getImageData(0, 0, inputSize, inputSize);
  const n = inputSize * inputSize;
  const tensor = new Float32Array(3 * n);
  // Interleaved RGBA → planar RGB (CHW) normalized to [0,1].
  for (let i = 0; i < n; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[n + i] = data[i * 4 + 1] / 255;
    tensor[2 * n + i] = data[i * 4 + 2] / 255;
  }

  return {
    tensor,
    info: {
      inputSize,
      sourceSize: { width: srcW, height: srcH },
      resizedSize: { width: resizedW, height: resizedH },
      scale,
      padX,
      padY,
    },
  };
}

/** Undo letterbox: map a coordinate from model-input space back to source image space. */
export function modelToSourcePoint(
  x: number,
  y: number,
  info: LetterboxInfo,
): { x: number; y: number } {
  return {
    x: (x - info.padX) / info.scale,
    y: (y - info.padY) / info.scale,
  };
}

/** Undo letterbox for a bbox [x1,y1,x2,y2] in model-input space. */
export function modelToSourceBox(
  box: [number, number, number, number],
  info: LetterboxInfo,
): { x: number; y: number; width: number; height: number } {
  const tl = modelToSourcePoint(box[0], box[1], info);
  const br = modelToSourcePoint(box[2], box[3], info);
  return {
    x: tl.x,
    y: tl.y,
    width: br.x - tl.x,
    height: br.y - tl.y,
  };
}
