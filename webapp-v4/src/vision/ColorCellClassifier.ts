/**
 * ColorCellClassifier — Identifies which piece occupies each board cell by
 * sampling pixel colors from the rectified board image.
 *
 * After pin-based homography rectification, the board image is a clean top-down
 * view where each cell center maps to a known pixel position. Each of the 11
 * IQ Noodles pieces has a distinctive color. By comparing sampled cell colors
 * against known piece reference colors, we can determine piece occupancy
 * without relying on YOLO's piece segmentation (which is unreliable when
 * pieces are tightly packed on the board).
 *
 * Steps:
 *   1. Sample a small patch (5×5 px) at each valid cell center.
 *   2. Convert to CIE Lab color space for perceptual distance.
 *   3. Find the closest reference piece color (or board/empty).
 *   4. Apply confidence thresholding and consistency checks.
 *   5. Flood-fill connected cells of the same class → piece regions.
 */

import { BOARD_WIDTH, BOARD_HEIGHT, MISSING_POSITIONS } from "../engine/constants";
import { PIECE_ASSETS } from "../pieces/assets";
import { boardToCanvas, BOARD_EDGE_SPAN } from "../board/gridGeometry";

// ── Reference colors ────────────────────────────────────────────────────────

interface LabColor {
  L: number;
  a: number;
  b: number;
}

interface ReferenceColor {
  classId: number;
  name: string;
  rgb: [number, number, number];
  lab: LabColor;
}

// Board background color (dark gray plastic).
const BOARD_RGB: [number, number, number] = [40, 42, 45];

// Pin color (metallic silver/gray).
const PIN_RGB: [number, number, number] = [160, 160, 165];

// ── sRGB → CIE Lab ────────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  // D65 illuminant
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;
  return [x, y, z];
}

function xyzToLab(x: number, y: number, z: number): LabColor {
  // D65 reference white
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function rgbToLab(r: number, g: number, b: number): LabColor {
  const [x, y, z] = rgbToXyz(r, g, b);
  return xyzToLab(x, y, z);
}

function labDistance(a: LabColor, b: LabColor): number {
  const dL = a.L - b.L;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

// ── Build reference table ───────────────────────────────────────────────────

const MISSING_SET = new Set(MISSING_POSITIONS);

let _referenceColors: ReferenceColor[] | null = null;
let _boardLab: LabColor | null = null;
let _pinLab: LabColor | null = null;

function getReferenceColors(): {
  pieces: ReferenceColor[];
  board: LabColor;
  pin: LabColor;
} {
  if (!_referenceColors) {
    _referenceColors = PIECE_ASSETS.map((asset) => ({
      classId: asset.pieceId,
      name: asset.key,
      rgb: asset.colorRgb as [number, number, number],
      lab: rgbToLab(asset.colorRgb[0], asset.colorRgb[1], asset.colorRgb[2]),
    }));
    _boardLab = rgbToLab(BOARD_RGB[0], BOARD_RGB[1], BOARD_RGB[2]);
    _pinLab = rgbToLab(PIN_RGB[0], PIN_RGB[1], PIN_RGB[2]);
  }
  return { pieces: _referenceColors, board: _boardLab!, pin: _pinLab! };
}

// ── White-balance normalization ─────────────────────────────────────────────

/**
 * Sample the dark-plastic frame visible at {@link MISSING_POSITIONS} cells
 * (the diamond cutouts of an IQ Noodles board), compute its mean RGB, and
 * apply per-channel scale so that mean → {@link BOARD_RGB}. Mutates the
 * canvas in place. No-op when the sample is implausible (too bright, too
 * dark, or saturated), to avoid worsening already-clean captures.
 *
 * Why MISSING_POSITIONS: those cells are physically present on the board but
 * outside the playable diamond, so they're guaranteed to show frame plastic
 * (no piece can occupy them). They are the most reliable WB anchor.
 */
export function whiteBalanceRectifiedCanvas(canvas: HTMLCanvasElement): void {
  const w = canvas.width;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;
  const imageData = ctx.getImageData(0, 0, w, w);
  const data = imageData.data;

  const cellSpacing = w / BOARD_EDGE_SPAN;
  const patchRadius = Math.max(2, Math.floor(cellSpacing * 0.3));

  let sumR = 0, sumG = 0, sumB = 0, n = 0;
  for (const cellIndex of MISSING_POSITIONS) {
    const row = Math.floor(cellIndex / BOARD_WIDTH);
    const col = cellIndex % BOARD_WIDTH;
    const cp = boardToCanvas(col, row, w);
    const cx = Math.round(cp.x);
    const cy = Math.round(cp.y);

    for (let dy = -patchRadius; dy <= patchRadius; dy++) {
      for (let dx = -patchRadius; dx <= patchRadius; dx++) {
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || px >= w || py < 0 || py >= w) continue;
        const idx = (py * w + px) * 4;
        sumR += data[idx];
        sumG += data[idx + 1];
        sumB += data[idx + 2];
        n++;
      }
    }
  }
  if (n === 0) return;

  const meanR = sumR / n;
  const meanG = sumG / n;
  const meanB = sumB / n;
  const meanLum = (meanR + meanG + meanB) / 3;
  // Sample is implausible: corner cells show piece colors (rectification off)
  // or pure black (rectification overshot the board). Skip rather than
  // amplify noise.
  if (meanLum > 90 || meanLum < 5) return;

  const clamp = (s: number) => Math.max(0.5, Math.min(2, s));
  const scaleR = clamp(BOARD_RGB[0] / Math.max(1, meanR));
  const scaleG = clamp(BOARD_RGB[1] / Math.max(1, meanG));
  const scaleB = clamp(BOARD_RGB[2] / Math.max(1, meanB));

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, data[i] * scaleR);
    data[i + 1] = Math.min(255, data[i + 1] * scaleG);
    data[i + 2] = Math.min(255, data[i + 2] * scaleB);
  }
  ctx.putImageData(imageData, 0, 0);
}

// ── Cell color sampling ─────────────────────────────────────────────────────

export interface CellColorSample {
  cellIndex: number;
  row: number;
  col: number;
  avgR: number;
  avgG: number;
  avgB: number;
  lab: LabColor;
}

export interface CellClassification {
  cellIndex: number;
  row: number;
  col: number;
  classId: number;     // -1 = empty/board, -2 = pin, 0-10 = piece
  distance: number;    // Lab distance to matched reference
  confidence: number;  // 0-1 confidence (inverse of distance, normalized)
  lab: LabColor;
}

export interface ColorClassificationResult {
  cells: CellClassification[];
  /** Connected regions of same-class cells. */
  regions: PieceRegion[];
  /** Raw cell samples for debugging. */
  samples: CellColorSample[];
}

export interface PieceRegion {
  classId: number;
  cells: number[];       // cell indices
  avgConfidence: number;
}

/** Maximum Lab distance to consider a cell as belonging to a piece. */
const MAX_PIECE_DISTANCE = 45;
/**
 * Minimum lightness (Lab L) for a cell to be considered a piece.
 * Board plastic is very dark (L < 25). Pieces are always brighter.
 */
const MIN_PIECE_LIGHTNESS = 16;
/**
 * If the cell's nearest piece is closer than board by at least this margin,
 * it's classified as a piece even if the absolute distance is larger.
 */
const PIECE_VS_BOARD_MARGIN = 8;
/** Patch half-size: sample a (2*PATCH+1)×(2*PATCH+1) area at each cell center. */
const PATCH = 4;
/**
 * Specular-highlight cutoff. Pixels brighter than this in luminance, or with
 * all three channels above {@link HIGHLIGHT_MIN_CHANNEL}, are dropped from the
 * chromatic-pixel pool. Their saturation is technically computable but
 * unreliable — clipped sensors lose color information that would otherwise
 * contaminate the median.
 */
const HIGHLIGHT_MAX_LUM = 245;
const HIGHLIGHT_MIN_CHANNEL = 240;

/**
 * Sample the rectified canvas at each valid board cell and classify by color.
 *
 * Key insight: IQ Noodles pieces are thin tubes — a large fraction of each
 * cell is dark board background visible through gaps. Simple averaging
 * produces a muddy dark color. Instead, we sample a large patch and take
 * the MEDIAN of the most-saturated, brightest pixels — these are the actual
 * piece material.
 */
export function classifyCellsByColor(
  rectifiedCanvas: HTMLCanvasElement,
): ColorClassificationResult {
  const w = rectifiedCanvas.width;
  const ctx = rectifiedCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("classifyCellsByColor: 2d context unavailable");
  const imageData = ctx.getImageData(0, 0, w, w);
  const data = imageData.data;

  const cellSpacing = w / BOARD_EDGE_SPAN;
  // Sample a patch of ~half-cell radius for robust coverage.
  const patchRadius = Math.max(PATCH, Math.floor(cellSpacing * 0.4));

  const { pieces, board, pin } = getReferenceColors();
  const samples: CellColorSample[] = [];
  const cells: CellClassification[] = [];

  for (let row = 0; row < BOARD_HEIGHT; row++) {
    for (let col = 0; col < BOARD_WIDTH; col++) {
      const cellIndex = row * BOARD_WIDTH + col;

      // Skip missing positions (board corner cutouts).
      if ((MISSING_SET as Set<number>).has(cellIndex)) continue;

      // Cell center in canvas pixels.
      const cp = boardToCanvas(col, row, w);
      const cx = Math.round(cp.x);
      const cy = Math.round(cp.y);

      // Collect all pixel colors in the patch.
      const pixelColors: Array<{ r: number; g: number; b: number; sat: number; lum: number }> = [];
      const clipped: Array<{ r: number; g: number; b: number; sat: number; lum: number }> = [];

      for (let dy = -patchRadius; dy <= patchRadius; dy++) {
        for (let dx = -patchRadius; dx <= patchRadius; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= w || py < 0 || py >= w) continue;
          const idx = (py * w + px) * 4;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];

          // Compute quick saturation and luminance.
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const lum = (maxC + minC) / 2;
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;

          // Drop near-clipped highlights — specular reflections corrupt the
          // median for the cell beneath them.
          if (lum > HIGHLIGHT_MAX_LUM || minC > HIGHLIGHT_MIN_CHANNEL) {
            clipped.push({ r, g, b, sat, lum });
            continue;
          }
          pixelColors.push({ r, g, b, sat, lum });
        }
      }

      // If everything is clipped (cell entirely under a highlight), fall back
      // to the original pool so the cell still has a sample.
      if (pixelColors.length === 0 && clipped.length > 0) {
        pixelColors.push(...clipped);
      }

      if (pixelColors.length === 0) continue;

      // Strategy: take the most chromatic (high saturation + brightness) pixels.
      // Sort by a combined "piece-ness" score: saturation × luminance.
      // Piece material is bright and colorful; board is dark and gray.
      pixelColors.sort((a, b) => (b.sat * b.lum) - (a.sat * a.lum));

      // Take the top 40% most-chromatic pixels and compute their median color.
      const topCount = Math.max(3, Math.floor(pixelColors.length * 0.4));
      const topPixels = pixelColors.slice(0, topCount);

      // Median color (more robust than mean against outliers).
      topPixels.sort((a, b) => a.r - b.r);
      const medR = topPixels[Math.floor(topCount / 2)].r;
      topPixels.sort((a, b) => a.g - b.g);
      const medG = topPixels[Math.floor(topCount / 2)].g;
      topPixels.sort((a, b) => a.b - b.b);
      const medB = topPixels[Math.floor(topCount / 2)].b;

      const avgR = medR;
      const avgG = medG;
      const avgB = medB;
      const lab = rgbToLab(avgR, avgG, avgB);

      samples.push({ cellIndex, row, col, avgR, avgG, avgB, lab });

      // Distance to board & pin colors.
      const boardDist = labDistance(lab, board);
      const pinDist = labDistance(lab, pin);

      // Distance to each piece color.
      let bestPieceId = -1;
      let bestPieceDist = Infinity;
      let secondBestPieceDist = Infinity;
      for (const ref of pieces) {
        const d = labDistance(lab, ref.lab);
        if (d < bestPieceDist) {
          secondBestPieceDist = bestPieceDist;
          bestPieceDist = d;
          bestPieceId = ref.classId;
        } else if (d < secondBestPieceDist) {
          secondBestPieceDist = d;
        }
      }

      // Classify.
      let classId: number;
      let distance: number;

      // Very dark cells are board/empty regardless of color matching.
      if (lab.L < MIN_PIECE_LIGHTNESS) {
        classId = -1;
        distance = boardDist;
      }
      // If board is clearly the closest match (piece is much further).
      else if (boardDist < bestPieceDist - PIECE_VS_BOARD_MARGIN && boardDist < 30) {
        classId = -1;
        distance = boardDist;
      }
      // If pin color is the closest match.
      else if (pinDist < bestPieceDist && pinDist < 20) {
        classId = -2;
        distance = pinDist;
      }
      // If closest piece is within acceptable range.
      else if (bestPieceDist < MAX_PIECE_DISTANCE) {
        classId = bestPieceId;
        distance = bestPieceDist;
      }
      // Fallback: even if piece distance is high, if it's much closer than
      // board, still classify as piece (handles dim/shadowed pieces).
      else if (bestPieceDist < boardDist + 5 && lab.L > 30) {
        classId = bestPieceId;
        distance = bestPieceDist;
      }
      else {
        classId = -1;
        distance = bestPieceDist;
      }

      const confidence = classId >= 0
        ? Math.max(0, 1 - bestPieceDist / MAX_PIECE_DISTANCE)
        : 0;

      cells.push({ cellIndex, row, col, classId, distance, confidence, lab });
    }
  }

  // Flood-fill connected regions of the same piece class.
  const regions = floodFillRegions(cells);

  return { cells, regions, samples };
}

// ── Flood-fill ──────────────────────────────────────────────────────────────

function floodFillRegions(cells: CellClassification[]): PieceRegion[] {
  const cellMap = new Map<number, CellClassification>();
  for (const c of cells) {
    cellMap.set(c.cellIndex, c);
  }

  const visited = new Set<number>();
  const regions: PieceRegion[] = [];

  for (const cell of cells) {
    if (cell.classId < 0) continue; // skip empty/pin
    if (visited.has(cell.cellIndex)) continue;

    // BFS flood fill.
    const region: number[] = [];
    const queue = [cell.cellIndex];
    let confSum = 0;

    while (queue.length > 0) {
      const idx = queue.pop()!;
      if (visited.has(idx)) continue;
      visited.add(idx);

      const c = cellMap.get(idx);
      if (!c || c.classId !== cell.classId) continue;

      region.push(idx);
      confSum += c.confidence;

      // 4-connected neighbors.
      const row = Math.floor(idx / BOARD_WIDTH);
      const col = idx % BOARD_WIDTH;
      if (row > 0) queue.push((row - 1) * BOARD_WIDTH + col);
      if (row < BOARD_HEIGHT - 1) queue.push((row + 1) * BOARD_WIDTH + col);
      if (col > 0) queue.push(row * BOARD_WIDTH + col - 1);
      if (col < BOARD_WIDTH - 1) queue.push(row * BOARD_WIDTH + col + 1);
    }

    if (region.length >= 3) {
      regions.push({
        classId: cell.classId,
        cells: region.sort((a, b) => a - b),
        avgConfidence: confSum / region.length,
      });
    }
  }

  return regions;
}
