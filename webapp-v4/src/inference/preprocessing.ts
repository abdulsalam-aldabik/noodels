import { MODEL_INPUT_SIZE } from "./inferenceTypes";
import type { LetterboxParams } from "./inferenceTypes";

/**
 * Draws a source image into an offscreen canvas letterboxed to MODEL_INPUT_SIZE × MODEL_INPUT_SIZE.
 * Padding is filled with grey (114, 114, 114) — standard for YOLO.
 *
 * Returns the canvas (for pixel access) and the letterbox parameters needed to
 * map mask coordinates back to original image space.
 */
function letterboxDraw(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  srcW: number,
  srcH: number,
): { canvas: OffscreenCanvas; params: LetterboxParams } {
  const scale = Math.min(MODEL_INPUT_SIZE / srcW, MODEL_INPUT_SIZE / srcH);
  const scaledW = Math.round(srcW * scale);
  const scaledH = Math.round(srcH * scale);
  const padX = Math.floor((MODEL_INPUT_SIZE - scaledW) / 2);
  const padY = Math.floor((MODEL_INPUT_SIZE - scaledH) / 2);

  const canvas = new OffscreenCanvas(MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const ctx = canvas.getContext("2d")!;

  // Fill with YOLO grey padding
  ctx.fillStyle = "rgb(114,114,114)";
  ctx.fillRect(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  ctx.drawImage(source as CanvasImageSource, padX, padY, scaledW, scaledH);

  return { canvas, params: { scale, padX, padY, origW: srcW, origH: srcH } };
}

/**
 * Converts an ImageData (from the letterboxed canvas) into a Float32Array
 * tensor in NCHW format [1, 3, H, W] with values normalized to [0, 1].
 */
function imageDataToTensor(imageData: ImageData): Float32Array {
  const { data, width, height } = imageData;
  const numPixels = width * height;
  const tensor = new Float32Array(3 * numPixels);

  for (let i = 0; i < numPixels; i++) {
    tensor[i] = data[i * 4] / 255;                    // R channel
    tensor[numPixels + i] = data[i * 4 + 1] / 255;   // G channel
    tensor[2 * numPixels + i] = data[i * 4 + 2] / 255; // B channel
  }

  return tensor;
}

export interface PreprocessResult {
  tensor: Float32Array;
  params: LetterboxParams;
}

/**
 * Preprocesses any image source for YOLO inference.
 *
 * Accepts an HTMLImageElement (natural image), HTMLCanvasElement (grabbed frame),
 * or ImageBitmap (from createImageBitmap). Handles CORS-loaded images transparently
 * because we draw via canvas, not direct pixel access.
 */
export async function preprocessImage(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<PreprocessResult> {
  let srcW: number;
  let srcH: number;

  if (source instanceof HTMLImageElement) {
    srcW = source.naturalWidth;
    srcH = source.naturalHeight;
  } else if (source instanceof HTMLCanvasElement) {
    srcW = source.width;
    srcH = source.height;
  } else {
    // ImageBitmap
    srcW = source.width;
    srcH = source.height;
  }

  const { canvas, params } = letterboxDraw(source, srcW, srcH);
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, MODEL_INPUT_SIZE, MODEL_INPUT_SIZE);
  const tensor = imageDataToTensor(imageData);

  return { tensor, params };
}

/**
 * Creates an HTMLImageElement from a File or Blob and waits for it to load.
 * Useful for processing user-selected photos from <input type="file">.
 */
export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`Failed to load image: ${file.name}`));
    };
    img.src = url;
  });
}

/**
 * Grabs the current frame from a <video> element into an ImageBitmap.
 * Use this when reading from a live camera stream.
 */
export async function captureVideoFrame(video: HTMLVideoElement): Promise<ImageBitmap> {
  return createImageBitmap(video, 0, 0, video.videoWidth, video.videoHeight);
}
