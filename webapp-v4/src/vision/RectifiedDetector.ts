import type { RawDetection, LetterboxParams } from "../inference/inferenceTypes";
import {
  CLASS_PIECE_FIRST,
  CLASS_PIECE_LAST,
} from "../inference/inferenceTypes";
import type { InferenceRunner } from "../inference/InferenceRunner";
import type { CalibratedBoardRef } from "./visionTypes";
import {
  BOARD_GRID,
  getBoardCenterCorners,
  expectedRectifiedCellSpacing,
} from "../board/gridGeometry";
import { computeHomography } from "./HomographyComputer";

/** Size of rectified image (square, model input-aligned). */
export const RECTIFIED_SIZE = 640;
export { MODEL_INPUT_SIZE } from "../inference/inferenceTypes";

type RectificationSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
type OrderedCorners = [[number, number], [number, number], [number, number], [number, number]];
type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

const RECTIFIED_BG = 114;
const MIN_MARGIN_CELLS = 0.35;
const MAX_MARGIN_CELLS = 2.6;
const MIN_HOMOGRAPHY_W = 1e-9;

export const RECTIFIED_MARGIN_RANGE = {
  min: MIN_MARGIN_CELLS,
  max: MAX_MARGIN_CELLS,
} as const;

/**
 * Mapping geometry between rectified pixels and board grid coordinates.
 */
export interface RectifiedGeometry {
  gridToPixelScale: number;
  boardOriginCol: number;
  boardOriginRow: number;
  rotationAngleDeg: number;
  rectifiedToBoardMatrix: number[][];
  boardToRectifiedMatrix: number[][];
  marginCells: number;
  sourceToRectifiedMatrix?: number[][];
  rectifiedToSourceMatrix?: number[][];
  candidateMarginsTried?: number[];
  selectionScore?: number;
}

export interface RectifiedPassResult {
  detections: RawDetection[];
  rectifiedCanvas: OffscreenCanvas;
  geometry: RectifiedGeometry;
  timings: {
    warpMs: number;
    inferenceMs: number;
  };
}

function toMatrix3(matrix: number[][]): Matrix3 {
  if (matrix.length !== 3 || matrix.some((row) => row.length !== 3)) {
    throw new Error("Expected 3x3 matrix");
  }
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
}

function fromMatrix3(matrix: Matrix3): number[][] {
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
}

function multiply3x3(a: Matrix3, b: Matrix3): Matrix3 {
  const out: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r][c] =
        a[r][0] * b[0][c] +
        a[r][1] * b[1][c] +
        a[r][2] * b[2][c];
    }
  }

  return out;
}

function invert3x3(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) throw new Error("Singular matrix");

  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

function validateMarginCells(marginCells: number): number | null {
  if (!Number.isFinite(marginCells)) return null;
  if (marginCells < MIN_MARGIN_CELLS || marginCells > MAX_MARGIN_CELLS) return null;
  return marginCells;
}

export function isValidRectifiedMargin(marginCells: number): boolean {
  return validateMarginCells(marginCells) !== null;
}

function sourceDimensions(source: RectificationSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function bilinearSample(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const dx = x - x0;
  const dy = y - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const w00 = (1 - dx) * (1 - dy);
  const w10 = dx * (1 - dy);
  const w01 = (1 - dx) * dy;
  const w11 = dx * dy;

  const r = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
  const g = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
  const b = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
  const a = src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
}

function buildRectifiedGeometry(marginCells: number): RectifiedGeometry | null {
  const validatedMargin = validateMarginCells(marginCells);
  if (validatedMargin === null) return null;

  const scale = expectedRectifiedCellSpacing(RECTIFIED_SIZE, validatedMargin);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const boardOriginCol = -validatedMargin;
  const boardOriginRow = -validatedMargin;

  const boardGridCorners = getBoardCenterCorners() as OrderedCorners;
  const boardPixelCorners: OrderedCorners = [
    [(BOARD_GRID.minCol - boardOriginCol) * scale, (BOARD_GRID.minRow - boardOriginRow) * scale],
    [(BOARD_GRID.maxCol - boardOriginCol) * scale, (BOARD_GRID.minRow - boardOriginRow) * scale],
    [(BOARD_GRID.maxCol - boardOriginCol) * scale, (BOARD_GRID.maxRow - boardOriginRow) * scale],
    [(BOARD_GRID.minCol - boardOriginCol) * scale, (BOARD_GRID.maxRow - boardOriginRow) * scale],
  ];

  try {
    return {
      gridToPixelScale: scale,
      boardOriginCol,
      boardOriginRow,
      rotationAngleDeg: 0,
      rectifiedToBoardMatrix: computeHomography(boardPixelCorners, boardGridCorners),
      boardToRectifiedMatrix: computeHomography(boardGridCorners, boardPixelCorners),
      marginCells: validatedMargin,
    };
  } catch {
    return null;
  }
}

function preprocessRectified(
  canvas: OffscreenCanvas,
): { tensor: Float32Array; params: LetterboxParams } {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Rectified preprocessing failed: no 2D context");
  }

  const { data } = ctx.getImageData(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
  const pixelCount = RECTIFIED_SIZE * RECTIFIED_SIZE;
  const tensor = new Float32Array(3 * pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[pixelCount + i] = data[i * 4 + 1] / 255;
    tensor[2 * pixelCount + i] = data[i * 4 + 2] / 255;
  }

  return {
    tensor,
    params: {
      scale: 1,
      padX: 0,
      padY: 0,
      origW: RECTIFIED_SIZE,
      origH: RECTIFIED_SIZE,
    },
  };
}

function rectifiedSelectionScore(detections: RawDetection[]): number {
  const pieces = detections.filter(
    (d) => d.classId >= CLASS_PIECE_FIRST && d.classId <= CLASS_PIECE_LAST,
  );
  const uniqueClasses = new Set(pieces.map((d) => d.classId)).size;
  const avgConf = pieces.length > 0
    ? pieces.reduce((sum, d) => sum + d.confidence, 0) / pieces.length
    : 0;
  return uniqueClasses * 10 + pieces.length * 2 + avgConf;
}

/**
 * Warps source image into canonical board coordinates using board homography.
 */
export function warpToCanonicalBoard(
  source: RectificationSource,
  boardRef: CalibratedBoardRef,
  marginCells = 1,
): { canvas: OffscreenCanvas; geometry: RectifiedGeometry } | null {
  const geometry = buildRectifiedGeometry(marginCells);
  if (!geometry) return null;

  let sourceToBoard: Matrix3;
  let boardToRectified: Matrix3;
  try {
    sourceToBoard = toMatrix3(boardRef.homographyMatrix);
    boardToRectified = toMatrix3(geometry.boardToRectifiedMatrix);
  } catch {
    return null;
  }

  const sourceToRectified = multiply3x3(boardToRectified, sourceToBoard);

  let rectifiedToSource: Matrix3;
  try {
    rectifiedToSource = invert3x3(sourceToRectified);
  } catch {
    return null;
  }

  const { width: srcW, height: srcH } = sourceDimensions(source);
  if (srcW <= 1 || srcH <= 1) return null;

  const srcCanvas = new OffscreenCanvas(srcW, srcH);
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) return null;
  srcCtx.drawImage(source as CanvasImageSource, 0, 0);

  const srcImageData = srcCtx.getImageData(0, 0, srcW, srcH);
  const src = srcImageData.data;

  const dstCanvas = new OffscreenCanvas(RECTIFIED_SIZE, RECTIFIED_SIZE);
  const dstCtx = dstCanvas.getContext("2d");
  if (!dstCtx) return null;

  const dstImageData = dstCtx.createImageData(RECTIFIED_SIZE, RECTIFIED_SIZE);
  const dst = dstImageData.data;

  for (let py = 0; py < RECTIFIED_SIZE; py++) {
    for (let px = 0; px < RECTIFIED_SIZE; px++) {
      const rx = px + 0.5;
      const ry = py + 0.5;

      const w =
        rectifiedToSource[2][0] * rx +
        rectifiedToSource[2][1] * ry +
        rectifiedToSource[2][2];

      const out = (py * RECTIFIED_SIZE + px) * 4;

      if (Math.abs(w) < MIN_HOMOGRAPHY_W) {
        dst[out] = RECTIFIED_BG;
        dst[out + 1] = RECTIFIED_BG;
        dst[out + 2] = RECTIFIED_BG;
        dst[out + 3] = 255;
        continue;
      }

      const sx =
        (rectifiedToSource[0][0] * rx +
          rectifiedToSource[0][1] * ry +
          rectifiedToSource[0][2]) / w;
      const sy =
        (rectifiedToSource[1][0] * rx +
          rectifiedToSource[1][1] * ry +
          rectifiedToSource[1][2]) / w;

      if (sx < 0 || sy < 0 || sx > srcW - 1 || sy > srcH - 1) {
        dst[out] = RECTIFIED_BG;
        dst[out + 1] = RECTIFIED_BG;
        dst[out + 2] = RECTIFIED_BG;
        dst[out + 3] = 255;
        continue;
      }

      const [r, g, b, a] = bilinearSample(src, srcW, srcH, sx, sy);
      dst[out] = r;
      dst[out + 1] = g;
      dst[out + 2] = b;
      dst[out + 3] = a;
    }
  }

  dstCtx.putImageData(dstImageData, 0, 0);

  return {
    canvas: dstCanvas,
    geometry: {
      ...geometry,
      sourceToRectifiedMatrix: fromMatrix3(sourceToRectified),
      rectifiedToSourceMatrix: fromMatrix3(rectifiedToSource),
    },
  };
}

/**
 * Deterministic rectified second pass: evaluates exactly one margin value.
 */
export async function runRectifiedPass(
  source: RectificationSource,
  boardRef: CalibratedBoardRef,
  runner: InferenceRunner,
  marginCells = 1,
): Promise<RectifiedPassResult | null> {
  const warpStart = performance.now();
  const warped = warpToCanonicalBoard(source, boardRef, marginCells);
  if (!warped) return null;

  const warpMs = performance.now() - warpStart;

  try {
    const inferenceStart = performance.now();
    const { tensor, params } = preprocessRectified(warped.canvas);
    const inference = await runner.run(tensor, params);
    const inferenceMs = performance.now() - inferenceStart;

    return {
      detections: inference.detections,
      rectifiedCanvas: warped.canvas,
      geometry: {
        ...warped.geometry,
        candidateMarginsTried: [warped.geometry.marginCells],
        selectionScore: rectifiedSelectionScore(inference.detections),
      },
      timings: {
        warpMs,
        inferenceMs,
      },
    };
  } catch {
    return null;
  }
}
import type { RawDetection, LetterboxParams } from "../inference/inferenceTypes";
import {
  CLASS_PIECE_FIRST,
  CLASS_PIECE_LAST,
} from "../inference/inferenceTypes";
import type { InferenceRunner } from "../inference/InferenceRunner";
import type { CalibratedBoardRef } from "./visionTypes";
import {
  BOARD_GRID,
  getBoardCenterCorners,
  expectedRectifiedCellSpacing,
} from "../board/gridGeometry";
import { computeHomography } from "./HomographyComputer";

/** Size of rectified image (square, model input-aligned). */
export const RECTIFIED_SIZE = 640;
export { MODEL_INPUT_SIZE } from "../inference/inferenceTypes";

type RectificationSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;
type OrderedCorners = [[number, number], [number, number], [number, number], [number, number]];
type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

const RECTIFIED_BG = 114;
const MIN_MARGIN_CELLS = 0.35;
const MAX_MARGIN_CELLS = 2.6;
const MIN_HOMOGRAPHY_W = 1e-9;

export const RECTIFIED_MARGIN_RANGE = {
  min: MIN_MARGIN_CELLS,
  max: MAX_MARGIN_CELLS,
} as const;

/**
 * Mapping geometry between rectified pixels and board grid coordinates.
 */
export interface RectifiedGeometry {
  gridToPixelScale: number;
  boardOriginCol: number;
  boardOriginRow: number;
  rotationAngleDeg: number;
  rectifiedToBoardMatrix: number[][];
  boardToRectifiedMatrix: number[][];
  marginCells: number;
  sourceToRectifiedMatrix?: number[][];
  rectifiedToSourceMatrix?: number[][];
  candidateMarginsTried?: number[];
  selectionScore?: number;
}

export interface RectifiedPassResult {
  detections: RawDetection[];
  rectifiedCanvas: OffscreenCanvas;
  geometry: RectifiedGeometry;
  timings: {
    warpMs: number;
    inferenceMs: number;
  };
}

function toMatrix3(matrix: number[][]): Matrix3 {
  if (matrix.length !== 3 || matrix.some((row) => row.length !== 3)) {
    throw new Error("Expected 3x3 matrix");
  }
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
}

function fromMatrix3(matrix: Matrix3): number[][] {
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
}

function multiply3x3(a: Matrix3, b: Matrix3): Matrix3 {
  const out: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r][c] =
        a[r][0] * b[0][c] +
        a[r][1] * b[1][c] +
        a[r][2] * b[2][c];
    }
  }

  return out;
}

function invert3x3(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) throw new Error("Singular matrix");

  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

function validateMarginCells(marginCells: number): number | null {
  if (!Number.isFinite(marginCells)) return null;
  if (marginCells < MIN_MARGIN_CELLS || marginCells > MAX_MARGIN_CELLS) return null;
  return marginCells;
}

export function isValidRectifiedMargin(marginCells: number): boolean {
  return validateMarginCells(marginCells) !== null;
}

function sourceDimensions(source: RectificationSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function bilinearSample(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const dx = x - x0;
  const dy = y - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const w00 = (1 - dx) * (1 - dy);
  const w10 = dx * (1 - dy);
  const w01 = (1 - dx) * dy;
  const w11 = dx * dy;

  const r = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
  const g = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
  const b = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
  const a = src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
}

function buildRectifiedGeometry(marginCells: number): RectifiedGeometry | null {
  const validatedMargin = validateMarginCells(marginCells);
  if (validatedMargin === null) return null;

  const scale = expectedRectifiedCellSpacing(RECTIFIED_SIZE, validatedMargin);
  if (!Number.isFinite(scale) || scale <= 0) return null;

  const boardOriginCol = -validatedMargin;
  const boardOriginRow = -validatedMargin;

  const boardGridCorners = getBoardCenterCorners() as OrderedCorners;
  const boardPixelCorners: OrderedCorners = [
    [(BOARD_GRID.minCol - boardOriginCol) * scale, (BOARD_GRID.minRow - boardOriginRow) * scale],
    [(BOARD_GRID.maxCol - boardOriginCol) * scale, (BOARD_GRID.minRow - boardOriginRow) * scale],
    [(BOARD_GRID.maxCol - boardOriginCol) * scale, (BOARD_GRID.maxRow - boardOriginRow) * scale],
    [(BOARD_GRID.minCol - boardOriginCol) * scale, (BOARD_GRID.maxRow - boardOriginRow) * scale],
  ];

  try {
    return {
      gridToPixelScale: scale,
      boardOriginCol,
      boardOriginRow,
      rotationAngleDeg: 0,
      rectifiedToBoardMatrix: computeHomography(boardPixelCorners, boardGridCorners),
      boardToRectifiedMatrix: computeHomography(boardGridCorners, boardPixelCorners),
      marginCells: validatedMargin,
    };
  } catch {
    return null;
  }
}

function preprocessRectified(
  canvas: OffscreenCanvas,
): { tensor: Float32Array; params: LetterboxParams } {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Rectified preprocessing failed: no 2D context");
  }

  const { data } = ctx.getImageData(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
  const pixelCount = RECTIFIED_SIZE * RECTIFIED_SIZE;
  const tensor = new Float32Array(3 * pixelCount);

  for (let i = 0; i < pixelCount; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[pixelCount + i] = data[i * 4 + 1] / 255;
    tensor[2 * pixelCount + i] = data[i * 4 + 2] / 255;
  }

  return {
    tensor,
    params: {
      scale: 1,
      padX: 0,
      padY: 0,
      origW: RECTIFIED_SIZE,
      origH: RECTIFIED_SIZE,
    },
  };
}

function rectifiedSelectionScore(detections: RawDetection[]): number {
  const pieces = detections.filter(
    (d) => d.classId >= CLASS_PIECE_FIRST && d.classId <= CLASS_PIECE_LAST,
  );
  const uniqueClasses = new Set(pieces.map((d) => d.classId)).size;
  const avgConf = pieces.length > 0
    ? pieces.reduce((sum, d) => sum + d.confidence, 0) / pieces.length
    : 0;
  return uniqueClasses * 10 + pieces.length * 2 + avgConf;
}

/**
 * Warps source image into canonical board coordinates using board homography.
 */
export function warpToCanonicalBoard(
  source: RectificationSource,
  boardRef: CalibratedBoardRef,
  marginCells = 1,
): { canvas: OffscreenCanvas; geometry: RectifiedGeometry } | null {
  const geometry = buildRectifiedGeometry(marginCells);
  if (!geometry) return null;

  let sourceToBoard: Matrix3;
  let boardToRectified: Matrix3;
  try {
    sourceToBoard = toMatrix3(boardRef.homographyMatrix);
    boardToRectified = toMatrix3(geometry.boardToRectifiedMatrix);
  } catch {
    return null;
  }

  const sourceToRectified = multiply3x3(boardToRectified, sourceToBoard);

  let rectifiedToSource: Matrix3;
  try {
    rectifiedToSource = invert3x3(sourceToRectified);
  } catch {
    return null;
  }

  const { width: srcW, height: srcH } = sourceDimensions(source);
  if (srcW <= 1 || srcH <= 1) return null;

  const srcCanvas = new OffscreenCanvas(srcW, srcH);
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) return null;
  srcCtx.drawImage(source as CanvasImageSource, 0, 0);

  const srcImageData = srcCtx.getImageData(0, 0, srcW, srcH);
  const src = srcImageData.data;

  const dstCanvas = new OffscreenCanvas(RECTIFIED_SIZE, RECTIFIED_SIZE);
  const dstCtx = dstCanvas.getContext("2d");
  if (!dstCtx) return null;

  const dstImageData = dstCtx.createImageData(RECTIFIED_SIZE, RECTIFIED_SIZE);
  const dst = dstImageData.data;

  for (let py = 0; py < RECTIFIED_SIZE; py++) {
    for (let px = 0; px < RECTIFIED_SIZE; px++) {
      const rx = px + 0.5;
      const ry = py + 0.5;

      const w =
        rectifiedToSource[2][0] * rx +
        rectifiedToSource[2][1] * ry +
        rectifiedToSource[2][2];

      const out = (py * RECTIFIED_SIZE + px) * 4;

      if (Math.abs(w) < MIN_HOMOGRAPHY_W) {
        dst[out] = RECTIFIED_BG;
        dst[out + 1] = RECTIFIED_BG;
        dst[out + 2] = RECTIFIED_BG;
        dst[out + 3] = 255;
        continue;
      }

      const sx =
        (rectifiedToSource[0][0] * rx +
          rectifiedToSource[0][1] * ry +
          rectifiedToSource[0][2]) / w;
      const sy =
        (rectifiedToSource[1][0] * rx +
          rectifiedToSource[1][1] * ry +
          rectifiedToSource[1][2]) / w;

      if (sx < 0 || sy < 0 || sx > srcW - 1 || sy > srcH - 1) {
        dst[out] = RECTIFIED_BG;
        dst[out + 1] = RECTIFIED_BG;
        dst[out + 2] = RECTIFIED_BG;
        dst[out + 3] = 255;
        continue;
      }

      const [r, g, b, a] = bilinearSample(src, srcW, srcH, sx, sy);
      dst[out] = r;
      dst[out + 1] = g;
      dst[out + 2] = b;
      dst[out + 3] = a;
    }
  }

  dstCtx.putImageData(dstImageData, 0, 0);

  return {
    canvas: dstCanvas,
    geometry: {
      ...geometry,
      sourceToRectifiedMatrix: fromMatrix3(sourceToRectified),
      rectifiedToSourceMatrix: fromMatrix3(rectifiedToSource),
    },
  };
}

/**
 * Deterministic rectified second pass: evaluates exactly one margin value.
 */
export async function runRectifiedPass(
  source: RectificationSource,
  boardRef: CalibratedBoardRef,
  runner: InferenceRunner,
  marginCells = 1,
): Promise<RectifiedPassResult | null> {
  const warpStart = performance.now();
  const warped = warpToCanonicalBoard(source, boardRef, marginCells);
  if (!warped) return null;

  const warpMs = performance.now() - warpStart;

  try {
    const inferenceStart = performance.now();
    const { tensor, params } = preprocessRectified(warped.canvas);
    const inference = await runner.run(tensor, params);
    const inferenceMs = performance.now() - inferenceStart;

    return {
      detections: inference.detections,
      rectifiedCanvas: warped.canvas,
      geometry: {
        ...warped.geometry,
        candidateMarginsTried: [warped.geometry.marginCells],
        selectionScore: rectifiedSelectionScore(inference.detections),
      },
      timings: {
        warpMs,
        inferenceMs,
      },
    };
  } catch {
    return null;
  }
}
import type { RawDetection, LetterboxParams } from "../inference/inferenceTypes";
import {
  CLASS_PIECE_FIRST,
  CLASS_PIECE_LAST,
} from "../inference/inferenceTypes";
import type { InferenceRunner } from "../inference/InferenceRunner";
import type { CalibratedBoardRef } from "./visionTypes";
import {
  BOARD_GRID,
  getBoardCenterCorners,
  expectedRectifiedCellSpacing,
} from "../board/gridGeometry";
import { computeHomography } from "./HomographyComputer";

/** Size of the rectified board image (square, matches model input size). */
export const RECTIFIED_SIZE = 640;
export { MODEL_INPUT_SIZE } from "../inference/inferenceTypes";

type OrderedCorners = [[number, number], [number, number], [number, number], [number, number]];
type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];
type RectificationSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

const RECTIFIED_BG_VALUE = 114;
const MIN_MARGIN_CELLS = 0.35;
const MAX_MARGIN_CELLS = 2.6;
const MIN_HOMOGRAPHY_W = 1e-9;

export const RECTIFIED_MARGIN_RANGE = {
  min: MIN_MARGIN_CELLS,
  max: MAX_MARGIN_CELLS,
} as const;

/**
 * Describes how the 14×14 board grid maps to/from the rectified 640×640 image.
 */
export interface RectifiedGeometry {
  gridToPixelScale: number;
  boardOriginCol: number;
  boardOriginRow: number;
  rotationAngleDeg: number;
  rectifiedToBoardMatrix: number[][];
  boardToRectifiedMatrix: number[][];
  marginCells: number;
  sourceToRectifiedMatrix?: number[][];
  rectifiedToSourceMatrix?: number[][];
  candidateMarginsTried?: number[];
  selectionScore?: number;
}

interface CandidateStats {
  pieceCount: number;
  uniquePieceClasses: number;
  score: number;
}

interface RectifiedCandidate {
  marginCells: number;
  detections: RawDetection[];
  rectifiedCanvas: OffscreenCanvas;
  geometry: RectifiedGeometry;
  stats: CandidateStats;
  timings: {
    warpMs: number;
    inferenceMs: number;
  };
}

function toMatrix3(matrix: number[][]): Matrix3 {
  if (matrix.length !== 3 || matrix.some((row) => row.length !== 3)) {
    throw new Error("Expected 3x3 matrix");
  }
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
}

function fromMatrix3(matrix: Matrix3): number[][] {
  return [
    [matrix[0][0], matrix[0][1], matrix[0][2]],
    [matrix[1][0], matrix[1][1], matrix[1][2]],
    [matrix[2][0], matrix[2][1], matrix[2][2]],
  ];
}

function validateMarginCells(marginCells: number): number | null {
  if (!Number.isFinite(marginCells)) return null;
  if (marginCells < MIN_MARGIN_CELLS || marginCells > MAX_MARGIN_CELLS) return null;
  return marginCells;
}

export function isValidRectifiedMargin(marginCells: number): boolean {
  return validateMarginCells(marginCells) !== null;
}

function invertMatrix3(H: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-10) throw new Error("Singular homography");

  const inv = 1 / det;
  return [
    [(e * i - f * h) * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [(f * g - d * i) * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [(d * h - e * g) * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}

function multiplyMatrix3(A: Matrix3, B: Matrix3): Matrix3 {
  const out: Matrix3 = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r][c] =
        A[r][0] * B[0][c] +
        A[r][1] * B[1][c] +
        A[r][2] * B[2][c];
    }
  }

  return out;
}

function createBoardCornersForMargin(marginCells: number): {
  boardGridCorners: OrderedCorners;
  boardPixelCorners: OrderedCorners;
  scale: number;
  originCol: number;
  originRow: number;
} | null {
  const scale = expectedRectifiedCellSpacing(RECTIFIED_SIZE, marginCells);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  const originCol = -marginCells;
  const originRow = -marginCells;

  const boardGridCorners = getBoardCenterCorners() as OrderedCorners;

  const boardPixelCorners: OrderedCorners = [
    [(BOARD_GRID.minCol - originCol) * scale, (BOARD_GRID.minRow - originRow) * scale],
    [(BOARD_GRID.maxCol - originCol) * scale, (BOARD_GRID.minRow - originRow) * scale],
    [(BOARD_GRID.maxCol - originCol) * scale, (BOARD_GRID.maxRow - originRow) * scale],
    [(BOARD_GRID.minCol - originCol) * scale, (BOARD_GRID.maxRow - originRow) * scale],
  ];

  return { boardGridCorners, boardPixelCorners, scale, originCol, originRow };
}

function buildRectifiedGeometry(marginCells: number): RectifiedGeometry | null {
  const validatedMargin = validateMarginCells(marginCells);
  if (validatedMargin === null) return null;

  const corners = createBoardCornersForMargin(validatedMargin);
  if (!corners) return null;

  try {
    const rectifiedToBoardMatrix = computeHomography(corners.boardPixelCorners, corners.boardGridCorners);
    const boardToRectifiedMatrix = computeHomography(corners.boardGridCorners, corners.boardPixelCorners);

    return {
      gridToPixelScale: corners.scale,
      boardOriginCol: corners.originCol,
      boardOriginRow: corners.originRow,
      rotationAngleDeg: 0,
      rectifiedToBoardMatrix,
      boardToRectifiedMatrix,
      marginCells: validatedMargin,
    };
  } catch {
    return null;
  }
}

function getSourceSize(source: RectificationSource): {
  width: number;
  height: number;
} {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function bilinearSample(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);

  const dx = x - x0;
  const dy = y - y0;

  const i00 = (y0 * width + x0) * 4;
  const i10 = (y0 * width + x1) * 4;
  const i01 = (y1 * width + x0) * 4;
  const i11 = (y1 * width + x1) * 4;

  const w00 = (1 - dx) * (1 - dy);
  const w10 = dx * (1 - dy);
  const w01 = (1 - dx) * dy;
  const w11 = dx * dy;

  const r = src[i00] * w00 + src[i10] * w10 + src[i01] * w01 + src[i11] * w11;
  const g = src[i00 + 1] * w00 + src[i10 + 1] * w10 + src[i01 + 1] * w01 + src[i11 + 1] * w11;
  const b = src[i00 + 2] * w00 + src[i10 + 2] * w10 + src[i01 + 2] * w01 + src[i11 + 2] * w11;
  const a = src[i00 + 3] * w00 + src[i10 + 3] * w10 + src[i01 + 3] * w01 + src[i11 + 3] * w11;

  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
}

/**
 * Warps the source image to canonical board space.
 *
 * This rewrite composes matrices explicitly:
 * source->rectified = board->rectified * source->board
 * and samples using bilinear interpolation for smoother piece edges.
 */
export function warpToCanonicalBoard(
  source: RectificationSource,
  boardRef: CalibratedBoardRef,
  marginCells = 1,
): { canvas: OffscreenCanvas; geometry: RectifiedGeometry } | null {
  const geometry = buildRectifiedGeometry(marginCells);
  if (!geometry) return null;

  let sourceToBoard: Matrix3;
  let boardToRectified: Matrix3;
  try {
    sourceToBoard = toMatrix3(boardRef.homographyMatrix);
    boardToRectified = toMatrix3(geometry.boardToRectifiedMatrix);
  } catch {
    return null;
  }

  const sourceToRectified = multiplyMatrix3(boardToRectified, sourceToBoard);

  let rectifiedToSource: Matrix3;
  try {
    rectifiedToSource = invertMatrix3(sourceToRectified);
  } catch {
    return null;
  }

  const { width: srcW, height: srcH } = getSourceSize(source);
  if (srcW <= 1 || srcH <= 1) return null;

  const srcCanvas = new OffscreenCanvas(srcW, srcH);
  const srcCtx = srcCanvas.getContext("2d");
  if (!srcCtx) return null;
  srcCtx.drawImage(source as CanvasImageSource, 0, 0);
  const srcImageData = srcCtx.getImageData(0, 0, srcW, srcH);

  const dstCanvas = new OffscreenCanvas(RECTIFIED_SIZE, RECTIFIED_SIZE);
  const dstCtx = dstCanvas.getContext("2d");
  if (!dstCtx) return null;

  const dstImageData = dstCtx.createImageData(RECTIFIED_SIZE, RECTIFIED_SIZE);
  const dst = dstImageData.data;
  const src = srcImageData.data;

  for (let py = 0; py < RECTIFIED_SIZE; py++) {
    for (let px = 0; px < RECTIFIED_SIZE; px++) {
      const rx = px + 0.5;
      const ry = py + 0.5;

      const w =
        rectifiedToSource[2][0] * rx +
        rectifiedToSource[2][1] * ry +
        rectifiedToSource[2][2];

      const di = (py * RECTIFIED_SIZE + px) * 4;

      if (Math.abs(w) < MIN_HOMOGRAPHY_W) {
        dst[di] = RECTIFIED_BG_VALUE;
        dst[di + 1] = RECTIFIED_BG_VALUE;
        dst[di + 2] = RECTIFIED_BG_VALUE;
        dst[di + 3] = 255;
        continue;
      }

      const sx =
        (rectifiedToSource[0][0] * rx +
          rectifiedToSource[0][1] * ry +
          rectifiedToSource[0][2]) /
        w;
      const sy =
        (rectifiedToSource[1][0] * rx +
          rectifiedToSource[1][1] * ry +
          rectifiedToSource[1][2]) /
        w;

      if (sx < 0 || sy < 0 || sx > srcW - 1 || sy > srcH - 1) {
        dst[di] = RECTIFIED_BG_VALUE;
        dst[di + 1] = RECTIFIED_BG_VALUE;
        dst[di + 2] = RECTIFIED_BG_VALUE;
        dst[di + 3] = 255;
        continue;
      }

      const [r, g, b, a] = bilinearSample(src, srcW, srcH, sx, sy);
      dst[di] = r;
      dst[di + 1] = g;
      dst[di + 2] = b;
      dst[di + 3] = a;
    }
  }

  dstCtx.putImageData(dstImageData, 0, 0);

  return {
    canvas: dstCanvas,
    geometry: {
      ...geometry,
      sourceToRectifiedMatrix: fromMatrix3(sourceToRectified),
      rectifiedToSourceMatrix: fromMatrix3(rectifiedToSource),
    },
  };
}

/**
 * Converts rectified canvas into normalized NCHW Float32 tensor [1, 3, 640, 640].
 */
function preprocessRectified(
  canvas: OffscreenCanvas,
): { tensor: Float32Array; params: LetterboxParams } {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Rectified preprocessing failed: no 2D context");
  }

  const { data } = ctx.getImageData(0, 0, RECTIFIED_SIZE, RECTIFIED_SIZE);
  const n = RECTIFIED_SIZE * RECTIFIED_SIZE;
  const tensor = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    tensor[i] = data[i * 4] / 255;
    tensor[n + i] = data[i * 4 + 1] / 255;
    tensor[2 * n + i] = data[i * 4 + 2] / 255;
  }

  return {
    tensor,
    params: {
      scale: 1,
      padX: 0,
      padY: 0,
      origW: RECTIFIED_SIZE,
      origH: RECTIFIED_SIZE,
    },
  };
}

function analyzeCandidateDetections(detections: RawDetection[]): CandidateStats {
  const pieceDetections = detections.filter(
    (d) => d.classId >= CLASS_PIECE_FIRST && d.classId <= CLASS_PIECE_LAST,
  );

  const pieceCount = pieceDetections.length;
  const uniquePieceClasses = new Set(pieceDetections.map((d) => d.classId)).size;
  const avgConfidence =
    pieceCount > 0
      ? pieceDetections.reduce((sum, d) => sum + d.confidence, 0) / pieceCount
      : 0;

  // Strongly prefer more unique piece classes, then total detections/confidence.
  const score = uniquePieceClasses * 10 + pieceCount * 2 + avgConfidence;

  return { pieceCount, uniquePieceClasses, score };
}

async function evaluateRectifiedCandidate(
  source: RectificationSource,
  boardRef: CalibratedBoardRef,
  runner: InferenceRunner,
  marginCells: number,
): Promise<RectifiedCandidate | null> {
  const tWarp = performance.now();
  const warpResult = warpToCanonicalBoard(source, boardRef, marginCells);
  if (!warpResult) return null;
  const warpMs = performance.now() - tWarp;

  try {
    const tInference = performance.now();
    const { tensor, params } = preprocessRectified(warpResult.canvas);
    const inferenceResult = await runner.run(tensor, params);
    const inferenceMs = performance.now() - tInference;

    return {
      marginCells: warpResult.geometry.marginCells,
      detections: inferenceResult.detections,
      rectifiedCanvas: warpResult.canvas,
      geometry: warpResult.geometry,
      stats: analyzeCandidateDetections(inferenceResult.detections),
      timings: {
        warpMs,
        inferenceMs,
      },
    };
  } catch {
    return null;
  }
}

export interface RectifiedPassResult {
  detections: RawDetection[];
  rectifiedCanvas: OffscreenCanvas;
  geometry: RectifiedGeometry;
  timings: {
    warpMs: number;
    inferenceMs: number;
  };
}

/**
 * Runs the rectified second pass.
 * Deterministic mode: use exactly one validated margin per run.
 */
export async function runRectifiedPass(
  source: RectificationSource,
  boardRef: CalibratedBoardRef,
  runner: InferenceRunner,
  marginCells = 1,
): Promise<RectifiedPassResult | null> {
  const candidate = await evaluateRectifiedCandidate(
    source,
    boardRef,
    runner,
    marginCells,
  );
  if (!candidate) return null;

  return {
    detections: candidate.detections,
    rectifiedCanvas: candidate.rectifiedCanvas,
    geometry: {
      ...candidate.geometry,
      candidateMarginsTried: [candidate.marginCells],
      selectionScore: candidate.stats.score,
    },
    timings: {
      warpMs: candidate.timings.warpMs,
      inferenceMs: candidate.timings.inferenceMs,
    },
  };
}
