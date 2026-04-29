import type { InferenceResult, Point2D } from "../inference/types";
import { BOARD_CLASS_ID, HINGE_CLASS_ID, PIN_CLASS_ID, PIECE_CLASS_COUNT } from "../inference/types";
import type { RawDetection } from "../inference/types";
import {
  BOARD_EDGE_MIN,
  BOARD_EDGE_SPAN,
  GRID,
  boardToCanvas,
  computePinBoardPoints,
} from "../board/gridGeometry";
import type { BoardRef, BoardState, RectifiedFrame } from "../vision/types";
import { getPlacementIndex } from "../vision/placementIndex";
import { warpMaskToCells } from "../vision/maskToBoardGrid";
import { applyHomography } from "../vision/Rectifier";
import { classifyCellsByColor } from "../vision/ColorCellClassifier";
import { PIECE_ASSETS } from "../pieces/assets";
import { BOARD_WIDTH } from "../engine/constants";

const CLASS_COLORS = [
  "#ff5555", "#55ff55", "#5577ff", "#ffaa33", "#aa55ff",
  "#33ccff", "#ffff55", "#ff55aa", "#33ffaa", "#aaff33",
  "#ff8833", "#22cc88", "#eeeeee",
];

interface DrawCtx {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

function sourceCanvas(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): DrawCtx {
  const w =
    image instanceof HTMLImageElement ? image.naturalWidth : image.width;
  const h =
    image instanceof HTMLImageElement ? image.naturalHeight : image.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("sourceCanvas: 2d context unavailable");
  ctx.drawImage(image, 0, 0);
  return { canvas, ctx };
}

function blobFromCanvas(canvas: HTMLCanvasElement, quality = 0.9): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality,
    );
  });
}

export async function renderRawArtifact(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): Promise<Blob> {
  const { canvas } = sourceCanvas(image);
  return blobFromCanvas(canvas);
}

export async function renderYoloArtifact(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  inference: InferenceResult,
): Promise<Blob> {
  const { canvas, ctx } = sourceCanvas(image);
  ctx.lineWidth = Math.max(2, Math.round(canvas.width / 500));
  ctx.font = `${Math.round(canvas.width / 70)}px sans-serif`;
  ctx.textBaseline = "top";
  for (const d of inference.detections) {
    const color = CLASS_COLORS[d.classId % CLASS_COLORS.length];
    ctx.strokeStyle = color;
    ctx.fillStyle = color + "33";
    ctx.strokeRect(d.bbox.x, d.bbox.y, d.bbox.width, d.bbox.height);
    ctx.fillRect(d.bbox.x, d.bbox.y, d.bbox.width, d.bbox.height);
    ctx.fillStyle = color;
    ctx.fillText(
      `${d.className} ${(d.score * 100).toFixed(0)}%`,
      d.bbox.x + 4,
      d.bbox.y + 4,
    );
  }
  return blobFromCanvas(canvas);
}

export async function renderCornersArtifact(
  image: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
  boardRef: BoardRef,
): Promise<Blob> {
  const { canvas, ctx } = sourceCanvas(image);
  ctx.font = `${Math.round(canvas.width / 70)}px sans-serif`;
  ctx.textBaseline = "top";

  const candidateColors = ["#ff9f43", "#ff6b6b", "#7a7aff", "#30d158"];
  for (let i = 0; i < boardRef.candidates.length; i++) {
    const cand = boardRef.candidates[i];
    const color = candidateColors[i % candidateColors.length];
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 600));
    ctx.beginPath();
    for (let j = 0; j < 4; j++) {
      const p = cand.corners[j];
      if (j === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(
      `${cand.source} ${(cand.score * 100).toFixed(0)}`,
      cand.corners[0].x + 6,
      cand.corners[0].y + 6,
    );
  }

  // Winner on top in bold white.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = Math.max(4, Math.round(canvas.width / 300));
  ctx.beginPath();
  for (let j = 0; j < 4; j++) {
    const p = boardRef.corners[j];
    if (j === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();

  // Corner labels
  const labels = ["TL", "TR", "BR", "BL"];
  ctx.fillStyle = "#ffffff";
  for (let j = 0; j < 4; j++) {
    const p = boardRef.corners[j];
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(4, canvas.width / 300), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillText(labels[j], p.x + 8, p.y + 8);
  }

  if (boardRef.hingePolygon && boardRef.hingeFound) {
    ctx.strokeStyle = "#ffff00";
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 600));
    ctx.beginPath();
    for (let j = 0; j < boardRef.hingePolygon.length; j++) {
      const p = boardRef.hingePolygon[j];
      if (j === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  return blobFromCanvas(canvas);
}

export async function renderRectifiedArtifact(
  rectifiedCanvas: HTMLCanvasElement,
  frame: RectifiedFrame,
): Promise<Blob> {
  const w = rectifiedCanvas.width;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = w;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("renderRectifiedArtifact: 2d context unavailable");
  ctx.drawImage(rectifiedCanvas, 0, 0);

  // Grid lines (every cell).
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    const boardCoord = BOARD_EDGE_MIN + i;
    const a = boardToCanvas(boardCoord, BOARD_EDGE_MIN, w);
    const b = boardToCanvas(boardCoord, BOARD_EDGE_MIN + GRID, w);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = boardToCanvas(BOARD_EDGE_MIN, boardCoord, w);
    const d = boardToCanvas(BOARD_EDGE_MIN + GRID, boardCoord, w);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // 21 pin markers.
  ctx.fillStyle = "#ff4d8d";
  const pins: Point2D[] = computePinBoardPoints().map((p) => ({ x: p.x, y: p.y }));
  for (const p of pins) {
    const q = boardToCanvas(p.x, p.y, w);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Telemetry legend.
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(4, 4, 220, 44);
  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.fillText(`canvas: ${frame.canvasSize.width}×${frame.canvasSize.height}`, 10, 10);
  ctx.fillText(`cellSpacingPx: ${frame.cellSpacingPx.toFixed(2)}`, 10, 26);

  return blobFromCanvas(out);
}

/** Helper used by ScanPipeline to summarize inference detections for telemetry. */
export function classHistogram(inference: InferenceResult): Record<string, number> {
  const h: Record<string, number> = {};
  for (const d of inference.detections) {
    h[d.className] = (h[d.className] ?? 0) + 1;
  }
  return h;
}

export function detectionCountsByClass(inference: InferenceResult): {
  board: number;
  hinge: number;
  pieces: number;
} {
  let board = 0, hinge = 0, pieces = 0;
  for (const d of inference.detections) {
    if (d.classId === BOARD_CLASS_ID) board++;
    else if (d.classId === HINGE_CLASS_ID) hinge++;
    else pieces++;
  }
  return { board, hinge, pieces };
}

export async function renderMappedArtifact(
  rectifiedCanvas: HTMLCanvasElement,
  frame: RectifiedFrame,
  boardState: BoardState,
): Promise<Blob> {
  const w = rectifiedCanvas.width;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = w;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("renderMappedArtifact: 2d context unavailable");
  ctx.drawImage(rectifiedCanvas, 0, 0);

  const index = getPlacementIndex();
  const cellSize = w / BOARD_EDGE_SPAN;

  for (const pl of boardState.placements) {
    const color = CLASS_COLORS[pl.classId % CLASS_COLORS.length];
    const entries = index.get(pl.classId);
    const match = entries?.find(
      (e) =>
        e.rotationSteps * 90 === pl.orientation &&
        e.mirrored === pl.mirrored &&
        e.topLeftCell.row === pl.cell.row &&
        e.topLeftCell.col === pl.cell.col,
    );
    if (!match) continue;

    ctx.fillStyle = color + "55";
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    for (const key of match.cellSet) {
      const row = Math.floor(key / 14);
      const col = key % 14;
      const tl = boardToCanvas(col - 0.5, row - 0.5, w);
      ctx.fillRect(tl.x, tl.y, cellSize, cellSize);
      ctx.strokeRect(tl.x, tl.y, cellSize, cellSize);
    }

    const center = boardToCanvas(pl.cell.col, pl.cell.row, w);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(w / 40)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(pl.className, center.x, center.y);

    if (pl.ambiguous) {
      ctx.fillStyle = "#ffaa00";
      ctx.font = `bold ${Math.round(w / 50)}px sans-serif`;
      ctx.fillText("?", center.x + cellSize * 0.6, center.y - cellSize * 0.4);
    }

    const arrowLen = cellSize * 0.7;
    const angle = (-pl.orientation * Math.PI) / 180;
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(
      center.x + Math.sin(angle) * arrowLen,
      center.y - Math.cos(angle) * arrowLen,
    );
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = `${Math.round(w / 60)}px sans-serif`;
    ctx.textAlign = "left";
    ctx.fillText(
      `${(pl.confidence * 100).toFixed(0)}%`,
      center.x + cellSize * 0.3,
      center.y + cellSize * 0.5,
    );
  }

  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    const boardCoord = -0.5 + i;
    const a = boardToCanvas(boardCoord, -0.5, w);
    const b = boardToCanvas(boardCoord, GRID - 0.5, w);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = boardToCanvas(-0.5, boardCoord, w);
    const d = boardToCanvas(GRID - 0.5, boardCoord, w);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  ctx.fillStyle = "#ff4d8d";
  const pins: Point2D[] = computePinBoardPoints().map((p) => ({ x: p.x, y: p.y }));
  for (const p of pins) {
    const q = boardToCanvas(p.x, p.y, w);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(4, 4, 260, 56);
  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(`placed: ${boardState.placements.length}  unassigned: ${boardState.unassignedDetections.length}`, 10, 10);
  const ambCount = boardState.placements.filter((p) => p.ambiguous).length;
  ctx.fillText(`ambiguous: ${ambCount}  cellSpacing: ${frame.cellSpacingPx.toFixed(2)}px`, 10, 26);
  const avgConf = boardState.placements.length > 0
    ? boardState.placements.reduce((s, p) => s + p.confidence, 0) / boardState.placements.length
    : 0;
  ctx.fillText(`avg confidence: ${(avgConf * 100).toFixed(1)}%`, 10, 42);

  return blobFromCanvas(out);
}

/**
 * Debug artifact: shows what YOLO detections look like on the rectified board.
 *
 * For each piece detection:
 *   - Warps the mask into the 14×14 cell grid and renders the cell coverage
 *     as a colored heatmap overlay.
 *   - Projects the mask centroid and bbox corners onto the rectified canvas.
 *   - Shows visited pins (canonical pins that the mask covers) as highlighted dots.
 *   - Labels each detection with YOLO class, confidence, and cell count.
 *
 * This is the key diagnostic for understanding mapping failures: you can see
 * whether the homography is warping masks to the right grid cells, whether
 * pins are being detected correctly, and whether the cell coverage matches
 * the expected piece shape.
 */
export async function renderDetectionsOnRectifiedArtifact(
  rectifiedCanvas: HTMLCanvasElement,
  frame: RectifiedFrame,
  detections: RawDetection[],
): Promise<Blob> {
  const w = rectifiedCanvas.width;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = w;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("renderDetectionsOnRectified: 2d context unavailable");
  ctx.drawImage(rectifiedCanvas, 0, 0);

  const cellSize = w / BOARD_EDGE_SPAN;
  const forward = frame.homography.forward;
  const inverse = frame.homography.inverse;
  const canonical = computePinBoardPoints();

  // Draw the grid first (subtle).
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    const boardCoord = -0.5 + i;
    const a = boardToCanvas(boardCoord, -0.5, w);
    const b = boardToCanvas(boardCoord, GRID - 0.5, w);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = boardToCanvas(-0.5, boardCoord, w);
    const d = boardToCanvas(GRID - 0.5, boardCoord, w);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // Per-detection: warp mask to cells and render.
  let detIndex = 0;
  for (const det of detections) {
    if (det.classId < 0 || det.classId >= PIECE_CLASS_COUNT) {
      // Still show pins as small circles.
      if (det.classId === PIN_CLASS_ID) {
        const centroid = bboxCenter(det);
        const bp = applyHomography(forward, centroid.x, centroid.y);
        const cp = boardToCanvas(bp.x, bp.y, w);
        ctx.fillStyle = "#ffffff55";
        ctx.beginPath();
        ctx.arc(cp.x, cp.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      continue;
    }

    const color = CLASS_COLORS[det.classId % CLASS_COLORS.length];
    const warp = warpMaskToCells(det, forward, 0.10);

    // Render cell coverage heatmap.
    for (let i = 0; i < 196; i++) {
      const coverage = warp.cellCoverage[i];
      if (coverage < 0.05) continue;
      const row = Math.floor(i / 14);
      const col = i % 14;
      const tl = boardToCanvas(col - 0.5, row - 0.5, w);
      const alpha = Math.min(0.7, coverage * 0.8);
      ctx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
      ctx.fillRect(tl.x, tl.y, cellSize, cellSize);

      // Mark cells above threshold with a border.
      if (warp.cellMask[i]) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tl.x, tl.y, cellSize, cellSize);
      }
    }

    // Render visited pins for this detection.
    if (det.mask && inverse) {
      for (const cp of canonical) {
        const img = applyHomography(inverse, cp.x, cp.y);
        const fx = (img.x - det.bbox.x) / det.bbox.width;
        const fy = (img.y - det.bbox.y) / det.bbox.height;
        if (fx < -0.05 || fx > 1.05 || fy < -0.05 || fy > 1.05) continue;

        // Check if mask covers this pin.
        const mx = Math.round(fx * det.mask.width);
        const my = Math.round(fy * det.mask.height);
        if (mx < 0 || mx >= det.mask.width || my < 0 || my >= det.mask.height) continue;

        // Probe a 5px radius around the pin.
        let found = false;
        for (let dy = -5; dy <= 5 && !found; dy++) {
          for (let dx = -5; dx <= 5 && !found; dx++) {
            const px = mx + dx;
            const py = my + dy;
            if (px >= 0 && px < det.mask.width && py >= 0 && py < det.mask.height) {
              if (det.mask.data[py * det.mask.width + px]) found = true;
            }
          }
        }

        if (found) {
          const q = boardToCanvas(cp.x, cp.y, w);
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
    }

    // Label: class name, confidence, cell count.
    const centroid = bboxCenter(det);
    const bp = applyHomography(forward, centroid.x, centroid.y);
    const cp = boardToCanvas(bp.x, bp.y, w);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(w / 45)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(det.className, cp.x, cp.y - 8);
    ctx.font = `${Math.round(w / 55)}px sans-serif`;
    ctx.fillStyle = color;
    ctx.fillText(
      `${(det.score * 100).toFixed(0)}% · ${warp.totalCells}c`,
      cp.x,
      cp.y + 10,
    );

    detIndex++;
  }

  // Pin markers (canonical positions).
  ctx.fillStyle = "#ff4d8d";
  for (const p of canonical) {
    const q = boardToCanvas(p.x, p.y, w);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend.
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(4, 4, 300, 42);
  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const pieceCount = detections.filter(d => d.classId >= 0 && d.classId < PIECE_CLASS_COUNT).length;
  const pinCount = detections.filter(d => d.classId === PIN_CLASS_ID).length;
  ctx.fillText(`YOLO on Rectified: ${pieceCount} pieces, ${pinCount} pins`, 10, 10);
  ctx.fillText(`Cell coverage heatmap (colored = detected mask cells)`, 10, 26);

  return blobFromCanvas(out);
}

function bboxCenter(d: RawDetection): { x: number; y: number } {
  return {
    x: d.bbox.x + d.bbox.width / 2,
    y: d.bbox.y + d.bbox.height / 2,
  };
}

/**
 * Debug artifact: color-based cell classification.
 *
 * Shows the rectified board with each valid cell colored by its classified
 * piece (using the actual piece reference colors). Empty/board cells are
 * left transparent. Region boundaries are drawn with white outlines.
 * Each region is labeled with the piece name and cell count.
 */
export async function renderColorClassificationArtifact(
  rectifiedCanvas: HTMLCanvasElement,
): Promise<Blob> {
  const w = rectifiedCanvas.width;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = w;
  const ctx = out.getContext("2d");
  if (!ctx) throw new Error("renderColorClassification: 2d context unavailable");
  ctx.drawImage(rectifiedCanvas, 0, 0);

  const cellSize = w / BOARD_EDGE_SPAN;
  const result = classifyCellsByColor(rectifiedCanvas);

  // Draw the grid.
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= GRID; i++) {
    const boardCoord = -0.5 + i;
    const a = boardToCanvas(boardCoord, -0.5, w);
    const b = boardToCanvas(boardCoord, GRID - 0.5, w);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const c = boardToCanvas(-0.5, boardCoord, w);
    const d = boardToCanvas(GRID - 0.5, boardCoord, w);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
  }

  // Draw classified cells with piece colors.
  for (const cell of result.cells) {
    if (cell.classId < 0) continue; // skip empty/pin

    const asset = PIECE_ASSETS.find(a => a.pieceId === cell.classId);
    if (!asset) continue;

    const tl = boardToCanvas(cell.col - 0.5, cell.row - 0.5, w);
    const alpha = Math.round(Math.max(0.35, Math.min(0.75, cell.confidence)) * 255);
    ctx.fillStyle = asset.colorHex + alpha.toString(16).padStart(2, "0");
    ctx.fillRect(tl.x, tl.y, cellSize, cellSize);

    // Thin border in piece color.
    ctx.strokeStyle = asset.colorHex;
    ctx.lineWidth = 1;
    ctx.strokeRect(tl.x, tl.y, cellSize, cellSize);
  }

  // Draw region boundaries (thicker outline around connected pieces).
  const cellToRegion = new Map<number, number>();
  result.regions.forEach((r, idx) => {
    for (const c of r.cells) cellToRegion.set(c, idx);
  });

  for (const region of result.regions) {
    const asset = PIECE_ASSETS.find(a => a.pieceId === region.classId);
    if (!asset) continue;

    for (const cellIdx of region.cells) {
      const row = Math.floor(cellIdx / BOARD_WIDTH);
      const col = cellIdx % BOARD_WIDTH;
      const tl = boardToCanvas(col - 0.5, row - 0.5, w);

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;

      // Draw edge only if neighbor is different region or missing.
      // Top
      const topIdx = (row - 1) * BOARD_WIDTH + col;
      if (row === 0 || cellToRegion.get(topIdx) !== cellToRegion.get(cellIdx)) {
        ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x + cellSize, tl.y); ctx.stroke();
      }
      // Bottom
      const botIdx = (row + 1) * BOARD_WIDTH + col;
      if (row === GRID - 1 || cellToRegion.get(botIdx) !== cellToRegion.get(cellIdx)) {
        ctx.beginPath(); ctx.moveTo(tl.x, tl.y + cellSize); ctx.lineTo(tl.x + cellSize, tl.y + cellSize); ctx.stroke();
      }
      // Left
      const leftIdx = row * BOARD_WIDTH + col - 1;
      if (col === 0 || cellToRegion.get(leftIdx) !== cellToRegion.get(cellIdx)) {
        ctx.beginPath(); ctx.moveTo(tl.x, tl.y); ctx.lineTo(tl.x, tl.y + cellSize); ctx.stroke();
      }
      // Right
      const rightIdx = row * BOARD_WIDTH + col + 1;
      if (col === GRID - 1 || cellToRegion.get(rightIdx) !== cellToRegion.get(cellIdx)) {
        ctx.beginPath(); ctx.moveTo(tl.x + cellSize, tl.y); ctx.lineTo(tl.x + cellSize, tl.y + cellSize); ctx.stroke();
      }
    }

    // Label region with piece name and cell count.
    const avgRow = region.cells.reduce((s, c) => s + Math.floor(c / BOARD_WIDTH), 0) / region.cells.length;
    const avgCol = region.cells.reduce((s, c) => s + (c % BOARD_WIDTH), 0) / region.cells.length;
    const center = boardToCanvas(avgCol, avgRow, w);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.round(w / 45)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(asset.key, center.x, center.y - 6);
    ctx.font = `${Math.round(w / 55)}px sans-serif`;
    ctx.fillStyle = asset.colorHex;
    ctx.fillText(
      `${region.cells.length}c · ${(region.avgConfidence * 100).toFixed(0)}%`,
      center.x, center.y + 10,
    );
  }

  // Pin markers.
  ctx.fillStyle = "#ff4d8d";
  const pins = computePinBoardPoints();
  for (const p of pins) {
    const q = boardToCanvas(p.x, p.y, w);
    ctx.beginPath();
    ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Legend.
  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.fillRect(4, 4, 350, 42);
  ctx.fillStyle = "#fff";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  const classifiedCount = result.cells.filter(c => c.classId >= 0).length;
  const regionCount = result.regions.length;
  ctx.fillText(`Color Classification: ${classifiedCount} cells → ${regionCount} regions`, 10, 10);
  ctx.fillText(`Pieces found: ${result.regions.map(r => PIECE_ASSETS.find(a => a.pieceId === r.classId)?.key ?? "?").join(", ")}`, 10, 26);

  return blobFromCanvas(out);
}
