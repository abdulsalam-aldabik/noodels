import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InferenceRunner } from "../inference/InferenceRunner";
import type { ModelStatus } from "../inference/InferenceRunner";
import { runScanPipeline } from "../pipeline/ScanPipeline";
import type { CalibratedBoardRef, ScanArtifacts, ScanDebug, ScanPipelineConfig } from "../vision/visionTypes";
import { drawCornersOverlay, drawRectifiedYoloOverlay, drawYoloOverlay } from "../pipeline/DebugArtifacts";
import type { RectifiedGeometry } from "../vision/RectifiedDetector";
import { RECTIFIED_MARGIN_RANGE, RECTIFIED_SIZE } from "../vision/RectifiedDetector";
import { applyHomography, computeHomography } from "../vision/HomographyComputer";
import { BOARD_WIDTH, POSITIONS_AROUND_PINS } from "../engine/constants";
import { BOARD_GRID, buildCellEdgeCoordinates } from "../board/gridGeometry";
import type { RawDetection } from "../inference/inferenceTypes";
import { generateCandidates, mapRectifiedPiecesToGrid } from "../vision/PieceMapper";
import { globalAssign } from "../pipeline/PieceAssigner";

import "../styles/app.css";
import "./rectified-grid-lab.css";

interface OverlayUrls {
  raw: string;
  yolo: string;
  corners: string;
  rectified: string;
  mapped: string;
}

interface LabMetrics {
  pieceCount: number;
  ambiguousCount: number;
  avgCellConfidence: number;
  score: number;
}

interface SweepRow {
  margin: number;
  selectedMargin: number;
  score: number;
  pieceCount: number;
  avgCellConfidence: number;
  ambiguousCount: number;
}

interface ScenarioResult {
  metrics: LabMetrics;
  geometryProfile: string;
  cellSpacingPx: number;
  selectedMargin: number;
  geometry?: RectifiedGeometry;
  rectifiedDetections?: RawDetection[];
  overlayUrls?: OverlayUrls;
}

interface LiveMappingStats {
  mappedCount: number;
  assignedCount: number;
  droppedCount: number;
  ambiguousCount: number;
  avgCellConfidence: number;
  score: number;
}

interface GridTune {
  originX: number;
  originY: number;
  spacingPx: number;
  rotationDeg: number;
}

interface GridDragState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startOriginX: number;
  startOriginY: number;
}

interface GridLine {
  key: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const GRID_COL_EDGES = buildCellEdgeCoordinates(BOARD_GRID.cols);
const GRID_ROW_EDGES = buildCellEdgeCoordinates(BOARD_GRID.rows);
const GRID_CENTER_COL = (BOARD_GRID.minCol + BOARD_GRID.maxCol) / 2;
const GRID_CENTER_ROW = (BOARD_GRID.minRow + BOARD_GRID.maxRow) / 2;

const PIN_BOARD_POINTS = POSITIONS_AROUND_PINS.map((positions, pinIndex) => {
  let sumRow = 0;
  let sumCol = 0;
  for (const pos of positions) {
    sumRow += Math.floor(pos / BOARD_WIDTH);
    sumCol += pos % BOARD_WIDTH;
  }
  return {
    pinIndex,
    row: sumRow / positions.length,
    col: sumCol / positions.length,
  };
});

function rotateAround(
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  angleRad: number,
): [number, number] {
  const dx = x - centerX;
  const dy = y - centerY;
  const cosTheta = Math.cos(angleRad);
  const sinTheta = Math.sin(angleRad);
  return [
    centerX + dx * cosTheta - dy * sinTheta,
    centerY + dx * sinTheta + dy * cosTheta,
  ];
}

function mapBoardPointToPixel(tune: GridTune, col: number, row: number): [number, number] {
  const baseX = tune.originX + col * tune.spacingPx;
  const baseY = tune.originY + row * tune.spacingPx;
  if (Math.abs(tune.rotationDeg) < 1e-8) return [baseX, baseY];

  const centerX = tune.originX + GRID_CENTER_COL * tune.spacingPx;
  const centerY = tune.originY + GRID_CENTER_ROW * tune.spacingPx;
  return rotateAround(baseX, baseY, centerX, centerY, (tune.rotationDeg * Math.PI) / 180);
}

function createTuneFromGeometry(geometry: RectifiedGeometry): GridTune {
  const [originX, originY] = geometry.boardToRectifiedMatrix
    ? applyHomography(geometry.boardToRectifiedMatrix, BOARD_GRID.minCol, BOARD_GRID.minRow)
    : [
      (BOARD_GRID.minCol - geometry.boardOriginCol) * geometry.gridToPixelScale,
      (BOARD_GRID.minRow - geometry.boardOriginRow) * geometry.gridToPixelScale,
    ];

  return {
    originX,
    originY,
    spacingPx: geometry.gridToPixelScale,
    rotationDeg: geometry.rotationAngleDeg,
  };
}

function createGeometryFromTune(
  tune: GridTune,
  marginCells: number,
  fallbackGeometry: RectifiedGeometry | null,
): RectifiedGeometry | null {
  const boardCenterCorners: [[number, number], [number, number], [number, number], [number, number]] = [
    [BOARD_GRID.minCol, BOARD_GRID.minRow],
    [BOARD_GRID.maxCol, BOARD_GRID.minRow],
    [BOARD_GRID.maxCol, BOARD_GRID.maxRow],
    [BOARD_GRID.minCol, BOARD_GRID.maxRow],
  ];

  const rectifiedCenterCorners: [[number, number], [number, number], [number, number], [number, number]] = [
    mapBoardPointToPixel(tune, BOARD_GRID.minCol, BOARD_GRID.minRow),
    mapBoardPointToPixel(tune, BOARD_GRID.maxCol, BOARD_GRID.minRow),
    mapBoardPointToPixel(tune, BOARD_GRID.maxCol, BOARD_GRID.maxRow),
    mapBoardPointToPixel(tune, BOARD_GRID.minCol, BOARD_GRID.maxRow),
  ];

  try {
    const rectifiedToBoardMatrix = computeHomography(rectifiedCenterCorners, boardCenterCorners);
    const boardToRectifiedMatrix = computeHomography(boardCenterCorners, rectifiedCenterCorners);

    const safeSpacing = Math.max(1e-6, tune.spacingPx);
    const boardOriginCol = BOARD_GRID.minCol - tune.originX / safeSpacing;
    const boardOriginRow = BOARD_GRID.minRow - tune.originY / safeSpacing;

    return {
      gridToPixelScale: tune.spacingPx,
      boardOriginCol,
      boardOriginRow,
      rotationAngleDeg: tune.rotationDeg,
      rectifiedToBoardMatrix,
      boardToRectifiedMatrix,
      marginCells,
      sourceToRectifiedMatrix: fallbackGeometry?.sourceToRectifiedMatrix,
      rectifiedToSourceMatrix: fallbackGeometry?.rectifiedToSourceMatrix,
      candidateMarginsTried: fallbackGeometry?.candidateMarginsTried,
      selectionScore: fallbackGeometry?.selectionScore,
    };
  } catch {
    return null;
  }
}

function ModelStatusBadge({ status }: Readonly<{ status: ModelStatus }>) {
  if (status.state === "idle") return null;

  let text = "";
  let tone = "lab-status--loading";
  if (status.state === "loading") {
    text = "Model loading...";
  } else if (status.state === "ready") {
    text = "Model ready";
    tone = "lab-status--ready";
  } else {
    text = `Model error: ${status.message}`;
    tone = "lab-status--error";
  }

  return <span className={`lab-status ${tone}`}>{text}</span>;
}

function revokeOverlayUrls(urls: OverlayUrls | null): void {
  if (!urls) return;
  URL.revokeObjectURL(urls.raw);
  URL.revokeObjectURL(urls.yolo);
  URL.revokeObjectURL(urls.corners);
  URL.revokeObjectURL(urls.rectified);
  URL.revokeObjectURL(urls.mapped);
}

function createRawCanvas(
  source: HTMLImageElement | HTMLCanvasElement | ImageBitmap,
): OffscreenCanvas {
  const width = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const height = source instanceof HTMLImageElement ? source.naturalHeight : source.height;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("2D canvas context unavailable");
  }
  ctx.drawImage(source, 0, 0);
  return canvas;
}

async function canvasToJpegUrl(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return URL.createObjectURL(blob);
}

async function buildOverlayUrls(
  boardRef: CalibratedBoardRef,
  artifacts: ScanArtifacts,
): Promise<OverlayUrls> {
  const rawUrl = await canvasToJpegUrl(createRawCanvas(artifacts.imageSource));
  const yoloUrl = await canvasToJpegUrl(drawYoloOverlay(artifacts.imageSource, artifacts.fullDetections));
  const cornersUrl = await canvasToJpegUrl(drawCornersOverlay(artifacts.imageSource, boardRef));
  const rectifiedUrl = await canvasToJpegUrl(artifacts.rectifiedCanvas);
  const mappedUrl = await canvasToJpegUrl(
    drawRectifiedYoloOverlay(
      artifacts.rectifiedCanvas,
      artifacts.rectifiedDetections,
      artifacts.rectifiedGeometry,
      artifacts.coveredCellsByClass,
    ),
  );

  return {
    raw: rawUrl,
    yolo: yoloUrl,
    corners: cornersUrl,
    rectified: rectifiedUrl,
    mapped: mappedUrl,
  };
}

function computeMetrics(pieceMappings: ScanDebug["pieceMappings"]): LabMetrics {
  if (pieceMappings.length === 0) {
    return {
      pieceCount: 0,
      ambiguousCount: 0,
      avgCellConfidence: 0,
      score: 0,
    };
  }

  const pieceCount = pieceMappings.length;
  const ambiguousCount = pieceMappings.filter((m) => m.ambiguous).length;
  const avgCellConfidence =
    pieceMappings.reduce((acc, m) => acc + m.cellConfidence, 0) / pieceCount;

  const score = avgCellConfidence + pieceCount * 0.08 - ambiguousCount * 0.15;

  return {
    pieceCount,
    ambiguousCount,
    avgCellConfidence,
    score,
  };
}

export default function RectifiedGridLabPage() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>(
    InferenceRunner.getInstance().status,
  );

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [sourcePreviewUrl, setSourcePreviewUrl] = useState<string | null>(null);

  const [shrinkCells, setShrinkCells] = useState(1);
  const [topInset, setTopInset] = useState(0.1);
  const [bottomInset, setBottomInset] = useState(0.03);
  const [sideInset, setSideInset] = useState(0.03);

  const [busyText, setBusyText] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");

  const [latestMetrics, setLatestMetrics] = useState<LabMetrics | null>(null);
  const [latestProfile, setLatestProfile] = useState<string>("");
  const [latestCellSpacing, setLatestCellSpacing] = useState<number>(0);
  const [sweepRows, setSweepRows] = useState<SweepRow[]>([]);

  const [overlayUrls, setOverlayUrls] = useState<OverlayUrls | null>(null);
  const [latestGeometry, setLatestGeometry] = useState<RectifiedGeometry | null>(null);
  const [latestRectifiedDetections, setLatestRectifiedDetections] = useState<RawDetection[]>([]);
  const [gridTune, setGridTune] = useState<GridTune | null>(null);
  const [copyFeedback, setCopyFeedback] = useState("");
  const dragStateRef = useRef<GridDragState | null>(null);

  const sweepCandidates = useMemo(() => {
    const values: number[] = [];
    for (let s = 0.4; s <= 2.001; s += 0.2) {
      values.push(Number(s.toFixed(2)));
    }
    return values;
  }, []);

  useEffect(() => {
    const runner = InferenceRunner.getInstance();
    if (runner.status.state === "idle") {
      runner.load().catch(() => {
        // handled by model status listener
      });
    }
    return runner.onStatusChange(setModelStatus);
  }, []);

  useEffect(() => {
    return () => {
      if (sourcePreviewUrl) URL.revokeObjectURL(sourcePreviewUrl);
      revokeOverlayUrls(overlayUrls);
    };
  }, [sourcePreviewUrl, overlayUrls]);

  const applyOverlayUrls = useCallback((next: OverlayUrls) => {
    setOverlayUrls((prev) => {
      revokeOverlayUrls(prev);
      return next;
    });
  }, []);

  const evaluateScenario = useCallback(async (
    candidateMargin: number,
    includeOverlays: boolean,
  ): Promise<ScenarioResult> => {
    if (!sourceFile) {
      throw new Error("Select a photo first.");
    }

    const runner = InferenceRunner.getInstance();
    if (!runner.isReady) {
      await runner.load();
    }

    const config: ScanPipelineConfig = {
      boardInset: {
        topRatio: topInset,
        sideRatio: sideInset,
        bottomRatio: bottomInset,
      },
      marginCells: candidateMargin,
      returnArtifacts: includeOverlays,
    };

    const result = await runScanPipeline(sourceFile, "upload", config);
    if (!result.ok) {
      throw new Error(result.error);
    }

    const metrics = computeMetrics(result.debug.pieceMappings);

    if (!result._artifacts) {
      return {
        metrics,
        geometryProfile: `selected=${candidateMargin.toFixed(2)}`,
        cellSpacingPx: result.debug.cellSpacingPx,
        selectedMargin: candidateMargin,
      };
    }

    const triedMargins = result._artifacts.rectifiedGeometry.candidateMarginsTried;
    const geometryProfile = triedMargins && triedMargins.length > 1
      ? `selected=${result._artifacts.rectifiedGeometry.marginCells.toFixed(2)} tried=[${triedMargins.map((m) => m.toFixed(2)).join(", ")}] score=${result._artifacts.rectifiedGeometry.selectionScore?.toFixed(2) ?? "n/a"}`
      : `selected=${result._artifacts.rectifiedGeometry.marginCells.toFixed(2)}`;

    const overlayUrls = includeOverlays
      ? await buildOverlayUrls(result.boardRef, result._artifacts)
      : undefined;

    return {
      metrics,
      geometryProfile,
      cellSpacingPx: result._artifacts.rectifiedGeometry.gridToPixelScale,
      selectedMargin: result._artifacts.rectifiedGeometry.marginCells,
      geometry: result._artifacts.rectifiedGeometry,
      rectifiedDetections: result._artifacts.rectifiedDetections,
      overlayUrls,
    };
  }, [bottomInset, sideInset, sourceFile, topInset]);

  const runCurrent = useCallback(async () => {
    setErrorText("");
    setBusyText("Running isolated grid fit...");

    try {
      const scenario = await evaluateScenario(shrinkCells, true);
      if (scenario.overlayUrls) {
        applyOverlayUrls(scenario.overlayUrls);
      }

      setLatestMetrics(scenario.metrics);
      setLatestProfile(scenario.geometryProfile || "fallback");
      setLatestCellSpacing(scenario.cellSpacingPx);
      setShrinkCells(scenario.selectedMargin);
      setLatestGeometry(scenario.geometry ?? null);
      setLatestRectifiedDetections(scenario.rectifiedDetections ?? []);
      setGridTune(scenario.geometry ? createTuneFromGeometry(scenario.geometry) : null);
      setSweepRows([]);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyText("");
    }
  }, [applyOverlayUrls, evaluateScenario, shrinkCells]);

  const runSweep = useCallback(async () => {
    setErrorText("");
    setBusyText("Sweeping margin values...");

    try {
      const rows: SweepRow[] = [];
      let best: SweepRow | null = null;

      for (const candidateMargin of sweepCandidates) {
        const scenario = await evaluateScenario(candidateMargin, false);

        const row: SweepRow = {
          margin: candidateMargin,
          selectedMargin: scenario.selectedMargin,
          score: scenario.metrics.score,
          pieceCount: scenario.metrics.pieceCount,
          avgCellConfidence: scenario.metrics.avgCellConfidence,
          ambiguousCount: scenario.metrics.ambiguousCount,
        };

        rows.push(row);

        if (!best || row.score > best.score) {
          best = row;
        }
      }

      if (!best) {
        throw new Error("No sweep result produced.");
      }

      setSweepRows(rows);

      const finalScenario = await evaluateScenario(best.margin, true);
      if (finalScenario.overlayUrls) {
        applyOverlayUrls(finalScenario.overlayUrls);
      }

      setLatestMetrics(finalScenario.metrics);
      setLatestProfile(finalScenario.geometryProfile || "fallback");
      setLatestCellSpacing(finalScenario.cellSpacingPx);
      setShrinkCells(finalScenario.selectedMargin);
      setLatestGeometry(finalScenario.geometry ?? null);
      setLatestRectifiedDetections(finalScenario.rectifiedDetections ?? []);
      setGridTune(finalScenario.geometry ? createTuneFromGeometry(finalScenario.geometry) : null);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyText("");
    }
  }, [applyOverlayUrls, evaluateScenario, sweepCandidates]);

  const onFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSourceFile(file);
    setErrorText("");
    setLatestMetrics(null);
    setLatestProfile("");
    setLatestCellSpacing(0);
    setLatestGeometry(null);
    setLatestRectifiedDetections([]);
    setGridTune(null);
    setCopyFeedback("");
    setSweepRows([]);
    setOverlayUrls((prev) => {
      revokeOverlayUrls(prev);
      return null;
    });

    setSourcePreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
  }, []);

  const tunedGeometry = useMemo(() => {
    if (!gridTune) return null;
    return createGeometryFromTune(gridTune, shrinkCells, latestGeometry);
  }, [gridTune, shrinkCells, latestGeometry]);

  const liveMappingStats = useMemo<LiveMappingStats | null>(() => {
    if (!tunedGeometry || latestRectifiedDetections.length === 0) return null;

    const remapped = mapRectifiedPiecesToGrid(latestRectifiedDetections, tunedGeometry);
    if (remapped.length === 0) {
      return {
        mappedCount: 0,
        assignedCount: 0,
        droppedCount: 0,
        ambiguousCount: 0,
        avgCellConfidence: 0,
        score: 0,
      };
    }

    const candidatesByPiece = generateCandidates(remapped, 3);
    const assigned = globalAssign(candidatesByPiece);
    const ambiguousCount = remapped.filter((m) => m.ambiguous).length;
    const avgCellConfidence = remapped.reduce((sum, m) => sum + m.cellConfidence, 0) / remapped.length;
    const assignedCount = assigned.size;
    const droppedCount = Math.max(0, remapped.length - assignedCount);
    const score = avgCellConfidence + assignedCount * 0.11 - ambiguousCount * 0.16 - droppedCount * 0.2;

    return {
      mappedCount: remapped.length,
      assignedCount,
      droppedCount,
      ambiguousCount,
      avgCellConfidence,
      score,
    };
  }, [latestRectifiedDetections, tunedGeometry]);

  const inferredMarginFromTune = useMemo(() => {
    if (!gridTune) return null;
    const raw = (RECTIFIED_SIZE / Math.max(1e-6, gridTune.spacingPx) - BOARD_GRID.maxCenterSpan) / 2;
    if (!Number.isFinite(raw)) return null;
    return raw;
  }, [gridTune]);

  const tunedOverlay = useMemo(() => {
    if (!gridTune) return null;

    const verticalLines: GridLine[] = GRID_COL_EDGES.map((colEdge) => {
      const [x1, y1] = mapBoardPointToPixel(gridTune, colEdge, BOARD_GRID.edgeMinRow);
      const [x2, y2] = mapBoardPointToPixel(gridTune, colEdge, BOARD_GRID.edgeMaxRow);
      return { key: `v-${colEdge}`, x1, y1, x2, y2 };
    });

    const horizontalLines: GridLine[] = GRID_ROW_EDGES.map((rowEdge) => {
      const [x1, y1] = mapBoardPointToPixel(gridTune, BOARD_GRID.edgeMinCol, rowEdge);
      const [x2, y2] = mapBoardPointToPixel(gridTune, BOARD_GRID.edgeMaxCol, rowEdge);
      return { key: `h-${rowEdge}`, x1, y1, x2, y2 };
    });

    const [tlx, tly] = mapBoardPointToPixel(gridTune, BOARD_GRID.edgeMinCol, BOARD_GRID.edgeMinRow);
    const [trx, try_] = mapBoardPointToPixel(gridTune, BOARD_GRID.edgeMaxCol, BOARD_GRID.edgeMinRow);
    const [brx, bry] = mapBoardPointToPixel(gridTune, BOARD_GRID.edgeMaxCol, BOARD_GRID.edgeMaxRow);
    const [blx, bly] = mapBoardPointToPixel(gridTune, BOARD_GRID.edgeMinCol, BOARD_GRID.edgeMaxRow);

    const pinPoints = PIN_BOARD_POINTS.map((pin) => {
      const [x, y] = mapBoardPointToPixel(gridTune, pin.col, pin.row);
      return { key: `pin-${pin.pinIndex}`, x, y };
    });

    return {
      verticalLines,
      horizontalLines,
      pinPoints,
      boundsPolygon: `${tlx},${tly} ${trx},${try_} ${brx},${bry} ${blx},${bly}`,
    };
  }, [gridTune]);

  const resetGridTune = useCallback(() => {
    if (!latestGeometry) return;
    setGridTune(createTuneFromGeometry(latestGeometry));
  }, [latestGeometry]);

  const nudgeGridTune = useCallback((dx: number, dy: number) => {
    setGridTune((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        originX: prev.originX + dx,
        originY: prev.originY + dy,
      };
    });
  }, []);

  const syncMarginFromTune = useCallback(() => {
    if (inferredMarginFromTune === null) return;
    const clamped = Math.min(
      RECTIFIED_MARGIN_RANGE.max,
      Math.max(RECTIFIED_MARGIN_RANGE.min, inferredMarginFromTune),
    );
    setShrinkCells(Number(clamped.toFixed(2)));
  }, [inferredMarginFromTune]);

  const onTunePointerDown = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (!gridTune) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startOriginX: gridTune.originX,
      startOriginY: gridTune.originY,
    };
  }, [gridTune]);

  const onTunePointerMove = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    const drag = dragStateRef.current;
    if (drag?.pointerId !== event.pointerId) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = RECTIFIED_SIZE / Math.max(1, rect.width);
    const scaleY = RECTIFIED_SIZE / Math.max(1, rect.height);
    const dx = (event.clientX - drag.startClientX) * scaleX;
    const dy = (event.clientY - drag.startClientY) * scaleY;

    setGridTune((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        originX: drag.startOriginX + dx,
        originY: drag.startOriginY + dy,
      };
    });
  }, []);

  const onTunePointerUp = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    }
  }, []);

  const tuneJson = useMemo(() => {
    if (!gridTune) return "";
    const inferredMargin = inferredMarginFromTune;
    return JSON.stringify({
      originX: Number(gridTune.originX.toFixed(2)),
      originY: Number(gridTune.originY.toFixed(2)),
      spacingPx: Number(gridTune.spacingPx.toFixed(4)),
      rotationDeg: Number(gridTune.rotationDeg.toFixed(3)),
      inferredMarginCells: inferredMargin === null ? null : Number(inferredMargin.toFixed(3)),
    }, null, 2);
  }, [gridTune, inferredMarginFromTune]);

  const copyTuneJson = useCallback(async () => {
    if (!tuneJson) return;
    try {
      await navigator.clipboard.writeText(tuneJson);
      setCopyFeedback("Copied");
      globalThis.setTimeout(() => setCopyFeedback(""), 1400);
    } catch {
      setCopyFeedback("Copy failed");
      globalThis.setTimeout(() => setCopyFeedback(""), 1800);
    }
  }, [tuneJson]);

  const isBusy = busyText.length > 0;

  return (
    <div className="noodles-shell lab-shell">
      <header className="noodles-header lab-header">
        <h1>Rectified Grid Calibration Lab</h1>
        <p>
          Isolated workflow for YOLO-driven grid fitting. Tune margin and insets here,
          iterate quickly, then carry the best values into main scan flow.
        </p>
        <p className="lab-path">Open at /dev/rectified-grid-lab while running npm run dev.</p>
      </header>

      <section className="inventory-panel lab-controls-panel">
        <div className="lab-top-row">
          <ModelStatusBadge status={modelStatus} />
          <label className="lab-file-picker">
            <span>Select photo</span>
            <input type="file" accept="image/*" onChange={onFileChange} />
          </label>
        </div>

        {sourcePreviewUrl && (
          <div className="lab-preview-strip">
            <img src={sourcePreviewUrl} alt="Selected source" />
          </div>
        )}

        <div className="lab-slider-grid">
          <label>
            Margin Cells: {shrinkCells.toFixed(2)}
            <input
              type="range"
              min={0.4}
              max={2.2}
              step={0.05}
              value={shrinkCells}
              onChange={(event) => setShrinkCells(Number(event.target.value))}
            />
          </label>

          <label>
            Top Inset Ratio: {topInset.toFixed(3)}
            <input
              type="range"
              min={0.01}
              max={0.12}
              step={0.001}
              value={topInset}
              onChange={(event) => setTopInset(Number(event.target.value))}
            />
          </label>

          <label>
            Bottom Inset Ratio: {bottomInset.toFixed(3)}
            <input
              type="range"
              min={0.005}
              max={0.08}
              step={0.001}
              value={bottomInset}
              onChange={(event) => setBottomInset(Number(event.target.value))}
            />
          </label>

          <label>
            Side Inset Ratio: {sideInset.toFixed(3)}
            <input
              type="range"
              min={0.005}
              max={0.08}
              step={0.001}
              value={sideInset}
              onChange={(event) => setSideInset(Number(event.target.value))}
            />
          </label>
        </div>

        <div className="controls-row">
          <button type="button" disabled={isBusy || !sourceFile} onClick={() => void runCurrent()}>
            Run Current Fit
          </button>
          <button type="button" disabled={isBusy || !sourceFile} onClick={() => void runSweep()}>
            Auto Sweep Margin
          </button>
        </div>

        {busyText && <p className="lab-info">{busyText}</p>}
        {errorText && <p className="lab-error">{errorText}</p>}

        {latestMetrics && (
          <div className="lab-metrics-grid">
            <div>
              <strong>Mapped pieces</strong>
              <span>{latestMetrics.pieceCount}</span>
            </div>
            <div>
              <strong>Avg cell confidence</strong>
              <span>{latestMetrics.avgCellConfidence.toFixed(3)}</span>
            </div>
            <div>
              <strong>Ambiguous pieces</strong>
              <span>{latestMetrics.ambiguousCount}</span>
            </div>
            <div>
              <strong>Scenario score</strong>
              <span>{latestMetrics.score.toFixed(3)}</span>
            </div>
            <div>
              <strong>Cell spacing px</strong>
              <span>{latestCellSpacing.toFixed(3)}</span>
            </div>
            <div>
              <strong>Geometry profile</strong>
              <span>{latestProfile}</span>
            </div>
          </div>
        )}

        {sweepRows.length > 0 && (
          <div className="lab-sweep-table-wrap">
            <table className="lab-sweep-table">
              <thead>
                <tr>
                  <th>Margin</th>
                  <th>Selected</th>
                  <th>Score</th>
                  <th>Pieces</th>
                  <th>Avg Conf</th>
                  <th>Ambiguous</th>
                </tr>
              </thead>
              <tbody>
                {sweepRows
                  .slice()
                  .sort((a, b) => b.score - a.score)
                  .map((row) => (
                    <tr key={row.margin}>
                      <td>{row.margin.toFixed(2)}</td>
                      <td>{row.selectedMargin.toFixed(2)}</td>
                      <td>{row.score.toFixed(3)}</td>
                      <td>{row.pieceCount}</td>
                      <td>{row.avgCellConfidence.toFixed(3)}</td>
                      <td>{row.ambiguousCount}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {overlayUrls?.rectified && gridTune && tunedOverlay && (
        <section className="board-panel lab-live-panel">
          <h2 className="lab-live-title">Live Grid Tuner (No Rerun)</h2>
          <p className="lab-live-subtitle">
            Drag the cyan grid directly, or adjust sliders below. Changes apply instantly on this
            rectified image and do not rerun the scan pipeline.
          </p>

          {liveMappingStats && (
            <div className="lab-live-metrics-grid">
              <div>
                <strong>Mapped</strong>
                <span>{liveMappingStats.mappedCount}</span>
              </div>
              <div>
                <strong>Assigned</strong>
                <span>{liveMappingStats.assignedCount}</span>
              </div>
              <div>
                <strong>Dropped</strong>
                <span>{liveMappingStats.droppedCount}</span>
              </div>
              <div>
                <strong>Ambiguous</strong>
                <span>{liveMappingStats.ambiguousCount}</span>
              </div>
              <div>
                <strong>Avg cell conf</strong>
                <span>{liveMappingStats.avgCellConfidence.toFixed(3)}</span>
              </div>
              <div>
                <strong>Live score</strong>
                <span>{liveMappingStats.score.toFixed(3)}</span>
              </div>
            </div>
          )}

          <div className="lab-live-controls-grid">
            <label>
              Origin X: {gridTune.originX.toFixed(2)} px
              <input
                type="range"
                min={-120}
                max={240}
                step={0.25}
                value={gridTune.originX}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setGridTune((prev) => (prev ? { ...prev, originX: value } : prev));
                }}
              />
            </label>

            <label>
              Origin Y: {gridTune.originY.toFixed(2)} px
              <input
                type="range"
                min={-120}
                max={240}
                step={0.25}
                value={gridTune.originY}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setGridTune((prev) => (prev ? { ...prev, originY: value } : prev));
                }}
              />
            </label>

            <label>
              Cell Spacing: {gridTune.spacingPx.toFixed(4)} px
              <input
                type="range"
                min={20}
                max={65}
                step={0.01}
                value={gridTune.spacingPx}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setGridTune((prev) => (prev ? { ...prev, spacingPx: value } : prev));
                }}
              />
            </label>

            <label>
              Rotation: {gridTune.rotationDeg.toFixed(3)}°
              <input
                type="range"
                min={-15}
                max={15}
                step={0.05}
                value={gridTune.rotationDeg}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setGridTune((prev) => (prev ? { ...prev, rotationDeg: value } : prev));
                }}
              />
            </label>
          </div>

          <div className="controls-row lab-live-actions">
            <button type="button" onClick={() => nudgeGridTune(-1, 0)}>Nudge Left</button>
            <button type="button" onClick={() => nudgeGridTune(1, 0)}>Nudge Right</button>
            <button type="button" onClick={() => nudgeGridTune(0, -1)}>Nudge Up</button>
            <button type="button" onClick={() => nudgeGridTune(0, 1)}>Nudge Down</button>
            <button type="button" onClick={syncMarginFromTune} disabled={inferredMarginFromTune === null}>
              Sync Margin From Spacing
            </button>
            <button type="button" onClick={resetGridTune} disabled={!latestGeometry}>Reset to Detected</button>
          </div>

          {inferredMarginFromTune !== null && (
            <p className="lab-live-hint">
              Inferred margin from spacing: {inferredMarginFromTune.toFixed(3)} cells
              {' '}({RECTIFIED_MARGIN_RANGE.min.toFixed(2)}..{RECTIFIED_MARGIN_RANGE.max.toFixed(2)} valid range)
            </p>
          )}

          <div className="lab-live-stage">
            <img src={overlayUrls.rectified} alt="Rectified base" className="lab-live-base" />
            <svg
              className="lab-live-overlay"
              viewBox={`0 0 ${RECTIFIED_SIZE} ${RECTIFIED_SIZE}`}
              preserveAspectRatio="none"
              onPointerDown={onTunePointerDown}
              onPointerMove={onTunePointerMove}
              onPointerUp={onTunePointerUp}
              onPointerCancel={onTunePointerUp}
            >
              <polygon className="lab-live-bounds" points={tunedOverlay.boundsPolygon} />

              {tunedOverlay.verticalLines.map((line) => (
                <line
                  key={line.key}
                  className="lab-live-line"
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                />
              ))}

              {tunedOverlay.horizontalLines.map((line) => (
                <line
                  key={line.key}
                  className="lab-live-line"
                  x1={line.x1}
                  y1={line.y1}
                  x2={line.x2}
                  y2={line.y2}
                />
              ))}

              {tunedOverlay.pinPoints.map((pin) => (
                <circle key={pin.key} className="lab-live-pin" cx={pin.x} cy={pin.y} r={2.8} />
              ))}
            </svg>
          </div>

          <div className="lab-live-json-wrap">
            <strong>Live tune values</strong>
            <pre>{tuneJson}</pre>
            <div className="controls-row lab-live-json-actions">
              <button type="button" onClick={() => void copyTuneJson()}>Copy JSON</button>
              {copyFeedback && <span className="lab-copy-feedback">{copyFeedback}</span>}
            </div>
          </div>
        </section>
      )}

      {overlayUrls && (
        <section className="board-panel lab-artifacts-panel">
          <div className="lab-artifact-grid">
            <figure>
              <img src={overlayUrls.raw} alt="Raw frame" />
              <figcaption>Raw</figcaption>
            </figure>
            <figure>
              <img src={overlayUrls.yolo} alt="Full YOLO overlay" />
              <figcaption>Full YOLO</figcaption>
            </figure>
            <figure>
              <img src={overlayUrls.corners} alt="Board corners overlay" />
              <figcaption>Board + corners</figcaption>
            </figure>
            <figure>
              <img src={overlayUrls.rectified} alt="Rectified view" />
              <figcaption>Rectified</figcaption>
            </figure>
            <figure>
              <img src={overlayUrls.mapped} alt="Rectified mapped overlay" />
              <figcaption>Rectified mapped</figcaption>
            </figure>
          </div>
        </section>
      )}
    </div>
  );
}
