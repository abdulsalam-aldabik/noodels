import type { InferenceResult, Point2D } from "../inference/types";
import { BOARD_CLASS_ID, HINGE_CLASS_ID } from "../inference/types";
import {
  BOARD_EDGE_MIN,
  GRID,
  boardToCanvas,
  computePinBoardPoints,
} from "../board/gridGeometry";
import type { BoardRef, BoardState, RectifiedFrame } from "../vision/types";
import { getPlacementIndex } from "../vision/placementIndex";

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
  const cellSize = w / GRID;

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
