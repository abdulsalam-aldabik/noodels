import type { RawDetection } from "../inference/inferenceTypes";
import { CLASS_BOARD, CLASS_HINGE } from "../inference/inferenceTypes";
import { PIECE_ASSETS } from "../pieces/assets";
import { BOARD_WIDTH, POSITIONS_AROUND_PINS } from "../engine/constants";
import { BOARD_GRID, buildCellEdgeCoordinates } from "../board/gridGeometry";
import type { RectifiedGeometry } from "../vision/RectifiedDetector";
import { applyHomography } from "../vision/HomographyComputer";
import type { CalibratedBoardRef, ScanDebug } from "../vision/visionTypes";

const CLASS_LABELS = [...PIECE_ASSETS.map((a) => a.key), "board", "hinge"];
const PIECE_COLORS = new Map<number, string>(PIECE_ASSETS.map((a) => [a.pieceId, a.colorHex]));

const GRID_COL_EDGES = buildCellEdgeCoordinates(BOARD_GRID.cols);
const GRID_ROW_EDGES = buildCellEdgeCoordinates(BOARD_GRID.rows);

const DEBUG_SAVE_ENDPOINT = "/__debug-save/";

type OverlaySource = HTMLImageElement | HTMLCanvasElement | ImageBitmap | OffscreenCanvas;

export interface DebugArtifactInputs {
  debug: ScanDebug;
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap | null;
  detections: RawDetection[];
  boardRef: CalibratedBoardRef | null;
  rectifiedCanvas: OffscreenCanvas | null;
  rectifiedDetections: RawDetection[];
  rectifiedGeometry: RectifiedGeometry | null;
  coveredCellsByClass: Map<number, Set<number>>;
}

function makeCanvas(
  source: OverlaySource,
): { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D } {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to create 2D context");
  ctx.drawImage(source as CanvasImageSource, 0, 0);
  return { canvas, ctx };
}

function classColor(classId: number): string {
  if (classId === CLASS_BOARD) return "#64d2b2";
  if (classId === CLASS_HINGE) return "#ff9f43";
  return PIECE_COLORS.get(classId) ?? "#ffffff";
}

function classLabel(classId: number): string {
  return CLASS_LABELS[classId] ?? `class_${classId}`;
}

/** Creates a new debug snapshot with default values. */
export function createScanDebug(sourceType: "camera" | "upload"): ScanDebug {
  return {
    timestamp: new Date().toISOString(),
    sourceType,
    timings: {
      preprocess: 0,
      inference: 0,
      boardLocate: 0,
      rectify: 0,
      rectifiedInference: 0,
      directMap: 0,
      assignment: 0,
      validate: 0,
      hint: 0,
      total: 0,
    },
    postprocess: null,
    boardDetected: false,
    boardConfidence: 0,
    boardCornerSource: null,
    hingeSnapped: false,
    cornersClipped: false,
    cellSpacingPx: 0,
    allDetections: [],
    rectifiedDetectionsCount: 0,
    pieceMappings: [],
    confirmedPlacements: [],
    droppedPieces: [],
    warnings: [],
    artifactPaths: {},
    error: null,
    errorStage: null,
  };
}

/** Converts raw detections into compact debug rows. */
export function summarizeDetections(detections: RawDetection[]): ScanDebug["allDetections"] {
  return detections.map((det) => ({
    classId: det.classId,
    label: classLabel(det.classId),
    confidence: Math.round(det.confidence * 1000) / 1000,
    bbox: det.bbox,
    centroid: det.maskCentroid,
  }));
}

/** Draws full-image YOLO overlays: polygons + bboxes + labels + centroids. */
export function drawYoloOverlay(
  source: OverlaySource,
  detections: RawDetection[],
): OffscreenCanvas {
  const { canvas, ctx } = makeCanvas(source);
  const height = canvas.height;

  for (const det of detections) {
    const color = classColor(det.classId);

    if (det.maskPolygon.length > 2) {
      ctx.beginPath();
      ctx.moveTo(det.maskPolygon[0][0], det.maskPolygon[0][1]);
      for (let i = 1; i < det.maskPolygon.length; i++) {
        ctx.lineTo(det.maskPolygon[i][0], det.maskPolygon[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = `${color}33`;
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    const [x1, y1, x2, y2] = det.bbox;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

    const label = `${classLabel(det.classId)} ${(det.confidence * 100).toFixed(0)}%`;
    ctx.fillStyle = color;
    ctx.font = `bold ${Math.max(12, Math.round(height / 50))}px sans-serif`;
    ctx.fillText(label, x1, y1 - 4);

    ctx.beginPath();
    ctx.arc(det.maskCentroid[0], det.maskCentroid[1], 4, 0, Math.PI * 2);
    ctx.fill();
  }

  return canvas;
}

/** Draws board polygon + ordered corners + hinge snap indicator. */
export function drawCornersOverlay(
  source: OverlaySource,
  boardRef: CalibratedBoardRef | null,
): OffscreenCanvas {
  const { canvas, ctx } = makeCanvas(source);
  if (!boardRef) return canvas;

  if (boardRef.boardPolygon.length > 2) {
    ctx.beginPath();
    ctx.moveTo(boardRef.boardPolygon[0][0], boardRef.boardPolygon[0][1]);
    for (let i = 1; i < boardRef.boardPolygon.length; i++) {
      ctx.lineTo(boardRef.boardPolygon[i][0], boardRef.boardPolygon[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(100,210,178,0.16)";
    ctx.fill();
    ctx.strokeStyle = "#64d2b2";
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  const cornerLabels = ["TL", "TR", "BR", "BL"];
  const cornerColors = ["#ff4d4f", "#52c41a", "#1677ff", "#faad14"];
  const fontSize = Math.max(13, Math.round(canvas.height / 62));

  for (let i = 0; i < 4; i++) {
    const [x, y] = boardRef.boardCorners[i];
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fillStyle = cornerColors[i];
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText(cornerLabels[i], x + 12, y - 4);
  }

  if (boardRef.hingeSnapped) {
    const [tl, tr] = boardRef.boardCorners;
    const cx = (tl[0] + tr[0]) / 2;
    const cy = (tl[1] + tr[1]) / 2;

    ctx.beginPath();
    ctx.moveTo(tl[0], tl[1]);
    ctx.lineTo(tr[0], tr[1]);
    ctx.strokeStyle = "#ffbf3f";
    ctx.lineWidth = 6;
    ctx.stroke();

    ctx.fillStyle = "#ffbf3f";
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillText("HINGE SNAPPED", cx - 60, cy - 10);
  }

  return canvas;
}

function createBoardToPixelTransform(
  geometry: RectifiedGeometry,
): (col: number, row: number) => [number, number] {
  if (geometry.boardToRectifiedMatrix) {
    return (col: number, row: number): [number, number] =>
      applyHomography(geometry.boardToRectifiedMatrix, col, row);
  }

  const theta = (geometry.rotationAngleDeg * Math.PI) / 180;
  const cosTheta = Math.cos(theta);
  const sinTheta = Math.sin(theta);

  return (col: number, row: number): [number, number] => {
    const rx = (col - geometry.boardOriginCol) * geometry.gridToPixelScale;
    const ry = (row - geometry.boardOriginRow) * geometry.gridToPixelScale;
    return [
      rx * cosTheta - ry * sinTheta,
      rx * sinTheta + ry * cosTheta,
    ];
  };
}

function drawRectifiedGrid(
  ctx: OffscreenCanvasRenderingContext2D,
  geometry: RectifiedGeometry,
): void {
  const boardToPixel = createBoardToPixelTransform(geometry);

  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1;

  for (const edge of GRID_COL_EDGES) {
    const [x1, y1] = boardToPixel(edge, BOARD_GRID.edgeMinRow);
    const [x2, y2] = boardToPixel(edge, BOARD_GRID.edgeMaxRow);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  for (const edge of GRID_ROW_EDGES) {
    const [x1, y1] = boardToPixel(BOARD_GRID.edgeMinCol, edge);
    const [x2, y2] = boardToPixel(BOARD_GRID.edgeMaxCol, edge);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (const pin of POSITIONS_AROUND_PINS) {
    let sumR = 0;
    let sumC = 0;
    for (const pos of pin) {
      sumR += Math.floor(pos / BOARD_WIDTH);
      sumC += pos % BOARD_WIDTH;
    }
    const r = sumR / pin.length;
    const c = sumC / pin.length;
    const [x, y] = boardToPixel(c, r);
    ctx.beginPath();
    ctx.arc(x, y, 3.6, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function drawCoveredCells(
  ctx: OffscreenCanvasRenderingContext2D,
  geometry: RectifiedGeometry,
  coveredCellsByClass: Map<number, Set<number>>,
): void {
  const boardToPixel = createBoardToPixelTransform(geometry);

  for (const [classId, cells] of coveredCellsByClass) {
    const color = classColor(classId);
    ctx.fillStyle = `${color}66`;

    for (const cellIdx of cells) {
      const row = Math.floor(cellIdx / BOARD_WIDTH);
      const col = cellIdx % BOARD_WIDTH;

      const p1 = boardToPixel(col - 0.5, row - 0.5);
      const p2 = boardToPixel(col + 0.5, row - 0.5);
      const p3 = boardToPixel(col + 0.5, row + 0.5);
      const p4 = boardToPixel(col - 0.5, row + 0.5);

      ctx.beginPath();
      ctx.moveTo(p1[0], p1[1]);
      ctx.lineTo(p2[0], p2[1]);
      ctx.lineTo(p3[0], p3[1]);
      ctx.lineTo(p4[0], p4[1]);
      ctx.closePath();
      ctx.fill();
    }
  }
}

/** Draws rectified detections + per-cell coverage + 14x14 grid. */
export function drawRectifiedYoloOverlay(
  rectifiedCanvas: OffscreenCanvas,
  detections: RawDetection[],
  geometry: RectifiedGeometry,
  coveredCellsByClass: Map<number, Set<number>>,
): OffscreenCanvas {
  const overlay = drawYoloOverlay(rectifiedCanvas, detections);
  const ctx = overlay.getContext("2d");
  if (!ctx) return overlay;

  drawCoveredCells(ctx, geometry, coveredCellsByClass);
  drawRectifiedGrid(ctx, geometry);

  return overlay;
}

async function postArtifact(filename: string, blob: Blob): Promise<string> {
  try {
    const response = await fetch(`${DEBUG_SAVE_ENDPOINT}${encodeURIComponent(filename)}`, {
      method: "POST",
      body: blob,
    });

    if (!response.ok) {
      console.warn(`debug-output: server returned ${response.status} for ${filename}`);
      return "";
    }

    return `debug-output/${filename}`;
  } catch (error) {
    console.warn(`debug-output: failed for ${filename}`, error);
    return "";
  }
}

async function postCanvas(canvas: OffscreenCanvas, filename: string): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.88 });
  return postArtifact(filename, blob);
}

async function postJson(data: unknown, filename: string): Promise<string> {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  return postArtifact(filename, blob);
}

async function persistRawArtifact(inputs: DebugArtifactInputs, prefix: string): Promise<string> {
  if (!inputs.source) return "";
  const { canvas } = makeCanvas(inputs.source);
  return postCanvas(canvas, `${prefix}-raw.jpg`);
}

async function persistYoloArtifact(inputs: DebugArtifactInputs, prefix: string): Promise<string> {
  if (!inputs.source || inputs.detections.length === 0) return "";
  return postCanvas(drawYoloOverlay(inputs.source, inputs.detections), `${prefix}-yolo.jpg`);
}

async function persistCornersArtifact(inputs: DebugArtifactInputs, prefix: string): Promise<string> {
  if (!inputs.source) return "";
  return postCanvas(drawCornersOverlay(inputs.source, inputs.boardRef), `${prefix}-corners.jpg`);
}

async function persistRectifiedArtifact(inputs: DebugArtifactInputs, prefix: string): Promise<string> {
  if (!inputs.rectifiedCanvas) return "";
  return postCanvas(inputs.rectifiedCanvas, `${prefix}-rectified.jpg`);
}

async function persistRectifiedMappedArtifact(inputs: DebugArtifactInputs, prefix: string): Promise<string> {
  if (!inputs.rectifiedCanvas || !inputs.rectifiedGeometry || inputs.rectifiedDetections.length === 0) {
    return "";
  }

  const canvas = drawRectifiedYoloOverlay(
    inputs.rectifiedCanvas,
    inputs.rectifiedDetections,
    inputs.rectifiedGeometry,
    inputs.coveredCellsByClass,
  );

  return postCanvas(canvas, `${prefix}-rectifiedMapped.jpg`);
}

/**
 * Persists debug artifacts (non-blocking from caller side).
 */
export async function persistDebugArtifacts(inputs: DebugArtifactInputs): Promise<void> {
  const { debug } = inputs;
  const ts = debug.timestamp.replaceAll(":", "-").replaceAll(".", "-");
  const prefix = `scan-${ts}`;

  try {
    const raw = await persistRawArtifact(inputs, prefix);
    if (raw) debug.artifactPaths.raw = raw;

    const yolo = await persistYoloArtifact(inputs, prefix);
    if (yolo) debug.artifactPaths.yolo = yolo;

    const corners = await persistCornersArtifact(inputs, prefix);
    if (corners) debug.artifactPaths.corners = corners;

    const rectified = await persistRectifiedArtifact(inputs, prefix);
    if (rectified) debug.artifactPaths.rectified = rectified;

    const rectifiedMapped = await persistRectifiedMappedArtifact(inputs, prefix);
    if (rectifiedMapped) debug.artifactPaths.rectifiedMapped = rectifiedMapped;

    const json = await postJson(debug, `${prefix}.json`);
    if (json) debug.artifactPaths.json = json;
  } catch (error) {
    console.warn("debug-output: persistence failed", error);
  }
}
