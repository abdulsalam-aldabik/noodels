import { useEffect, useMemo, useState } from "react";

import { NoodlesBoard } from "../engine/board";
import { IQ_NOODLES_PIECES, POSITIONS_AROUND_PINS } from "../engine/constants";
import type { PiecePlacement } from "../engine/types";
import { BoardCoordinator, getPinCenter } from "../board/BoardCoordinator";
import { PIECE_ASSET_BY_ID } from "../pieces/assets";
import { getPieceTuning } from "../pieces/tuning";
import type { PlacedModel } from "../rendering/BoardScene3D";
import BoardCanvas from "../ui/BoardCanvas";
import ControlBar from "../ui/ControlBar";
import DebugPanel from "../ui/DebugPanel";
import PieceInventory from "../ui/PieceInventory";
import TouchPiecePicker from "../ui/TouchPiecePicker";
import SharedInventoryCanvas from "../rendering/SharedInventoryCanvas";
import { useOrientations } from "../hooks/useOrientations";
import { usePlacementFinder } from "../hooks/usePlacementFinder";
import { useSolver } from "../hooks/useSolver";
import CameraCaptureView from "./CameraCaptureView";
import CaptureView from "./CaptureView";
import { getSharedPipeline } from "../pipeline/pipelinePreload";

import "../styles/app.css";

const PHONE_MEDIA_QUERY = "(max-width: 900px)";

function useIsPhone(): boolean {
  const [isPhone, setIsPhone] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(PHONE_MEDIA_QUERY).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(PHONE_MEDIA_QUERY);
    const onChange = (e: MediaQueryListEvent) => setIsPhone(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return isPhone;
}

export default function IQNoodlesApp() {
  const board = useMemo(() => new NoodlesBoard(), []);
  const coordinator = useMemo(
    () => new BoardCoordinator(board.width, board.height),
    [board.width, board.height],
  );

  // ── Static board geometry ────────────────────────────────────────────────

  const positionToPinIndex = useMemo(() => {
    const map = new Map<number, number>();
    POSITIONS_AROUND_PINS.forEach((positions, pinIndex) => {
      positions.forEach((pos) => map.set(pos, pinIndex));
    });
    return map;
  }, []);

  const pinCentersByIndex = useMemo((): Array<[number, number]> => {
    return POSITIONS_AROUND_PINS.map((positions) => {
      const avgRow = positions.reduce((s, p) => s + Math.floor(p / board.width), 0) / positions.length;
      const avgCol = positions.reduce((s, p) => s + (p % board.width), 0) / positions.length;
      return [avgRow, avgCol];
    });
  }, [board.width]);

  const boardCells = useMemo(() => {
    const cells: Array<{ position: number; x: number; y: number }> = [];
    for (let position = 0; position < board.width * board.height; position++) {
      if (!board.isFree(position)) continue;
      const [row, col] = coordinator.toRowCol(position);
      const point = coordinator.rowColToBoardPoint(row, col);
      cells.push({ position, x: point.x, y: point.y });
    }
    return cells;
  }, [board, coordinator]);

  const pinCenters = useMemo(() => {
    return POSITIONS_AROUND_PINS.map((positions, pinIndex) => {
      const [row, col] = getPinCenter(positions, coordinator);
      const point = coordinator.rowColToBoardPoint(row, col);
      return { pinIndex, x: point.x, y: point.y };
    });
  }, [coordinator]);

  // ── App mode ─────────────────────────────────────────────────────────────

  const isPhone = useIsPhone();
  const [mode, setMode] = useState<"manual" | "scan">(() => {
    if (typeof window === "undefined") return "manual";
    return window.matchMedia(PHONE_MEDIA_QUERY).matches ? "scan" : "manual";
  });

  // Idle preload — start loading the ONNX model in the background as soon as
  // the app is mounted, so there is zero wait when the user taps the shutter.
  useEffect(() => {
    const load = () => { getSharedPipeline().ensureLoaded().catch(() => {}); };
    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(load, { timeout: 2000 });
      return () => cancelIdleCallback(id);
    }
    // Safari fallback
    const id = setTimeout(load, 500);
    return () => clearTimeout(id);
  }, []);

  // ── Core state ───────────────────────────────────────────────────────────

  const [selectedPieceId, setSelectedPieceId] = useState(0);
  const [placedByPiece, setPlacedByPiece] = useState<Record<number, PiecePlacement>>({});
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugPlacementInfo, setDebugPlacementInfo] = useState("");

  // pieceId → orientationIndex → {x, y, scale} offset overrides (from debug panel nudges)
  const [offsetOverrides, setOffsetOverrides] = useState<
    Record<number, Record<number, { x: number; y: number; scale: number }>>
  >({});

  // ── Orientation management ───────────────────────────────────────────────

  const { placementsByPiece, findBestPlacement, getFreePlacements } =
    usePlacementFinder(board, coordinator);

  const {
    orientationByPiece,
    orientationCounts,
    orientationMetaByPiece,
    orientationIndicesByPiece,
    setOrientation,
    rotate,
    flip,
  } = useOrientations(placementsByPiece);

  // ── Derived: occupied cells (excluding selected piece) ──────────────────

  const occupiedByOthers = useMemo(() => {
    const occupied = new Set<number>();
    for (const [key, placement] of Object.entries(placedByPiece)) {
      if (Number(key) !== selectedPieceId) {
        placement.positions.forEach((pos) => occupied.add(pos));
      }
    }
    return occupied;
  }, [placedByPiece, selectedPieceId]);

  // ── Placement helpers ────────────────────────────────────────────────────

  function applyPlacement(pieceId: number, placement: PiecePlacement, selectedOrientation: number): void {
    if (placement.orientationIndex !== selectedOrientation) {
      setOrientation(pieceId, placement.orientationIndex);
    }
    setPlacedByPiece((prev) => ({ ...prev, [pieceId]: placement }));
  }

  function removePiece(pieceId: number): void {
    setPlacedByPiece((prev) => {
      const next = { ...prev };
      delete next[pieceId];
      return next;
    });
  }

  function clearBoard(): void {
    setPlacedByPiece({});
    setDebugPlacementInfo("Board cleared.");
  }

  // ── Solver ───────────────────────────────────────────────────────────────

  const getInitialPlacements = () => {
    const map = new Map<number, PiecePlacement>();
    for (const [id, placement] of Object.entries(placedByPiece)) {
      map.set(Number(id), placement);
    }
    return map;
  };

  const { solverStatus, onValidate, onSolve, onHint } = useSolver(
    getInitialPlacements,
    (placements) => setPlacedByPiece(placements),
    (pieceId, placement) => applyPlacement(pieceId, placement, orientationByPiece[pieceId]),
  );

  // ── Board interaction ────────────────────────────────────────────────────

  const previewPlacement = useMemo((): PiecePlacement | null => {
    if (!hoverPoint) return null;
    // Convert hover point (SVG coords) to row/col for findBestPlacement
    const targetRow = hoverPoint.y / (coordinator.boardSize / (board.height - 1));
    const targetCol = hoverPoint.x / (coordinator.boardSize / (board.width - 1));
    const result = findBestPlacement(
      selectedPieceId,
      orientationByPiece[selectedPieceId],
      targetRow,
      targetCol,
      occupiedByOthers,
    );
    return result;
  }, [hoverPoint, selectedPieceId, orientationByPiece, occupiedByOthers, findBestPlacement, coordinator, board]);

  function onBoardPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const normX = (event.clientX - rect.left) / rect.width;
    const normY = (event.clientY - rect.top) / rect.height;
    setHoverPoint({
      x: normX * coordinator.boardSize,
      y: normY * coordinator.boardSize,
    });
  }

  function onBoardClick() {
    if (!previewPlacement) return;

    const selectedOrientation = orientationByPiece[selectedPieceId];
    const { candidate, byOrientation } = (() => {
      const freePlacements = getFreePlacements(selectedPieceId, occupiedByOthers);
      const byOrientation: Record<number, PiecePlacement[]> = {};
      for (const p of freePlacements) {
        const oi = p.orientationIndex;
        if (!byOrientation[oi]) byOrientation[oi] = [];
        byOrientation[oi].push(p);
      }
      const candidates = byOrientation[selectedOrientation] ?? [];
      const match = candidates.find(
        (p) =>
          p.positions.length === previewPlacement.positions.length &&
          p.positions.every((pos, i) => pos === previewPlacement.positions[i]),
      );
      return { candidate: match, byOrientation };
    })();

    if (showDebug) {
      const counts = Object.entries(byOrientation).map(([k, v]) => `${k}:${v.length}`).join(" ");
      setDebugPlacementInfo([
        `manualPlace piece=${PIECE_ASSET_BY_ID[selectedPieceId].key}(${selectedPieceId}) selectedOrientation=${selectedOrientation}`,
        `freeCandidatesByOrientation=${counts || "none"}`,
        `result=${candidate ? `ok orientation=${candidate.orientationIndex}` : "none"}`,
      ].join("\n"));
    }

    if (candidate) applyPlacement(selectedPieceId, candidate, selectedOrientation);
  }

  // ── Place first fit (auto) ──────────────────────────────────────────────

  function placeFirstFit(): void {
    const selectedOrientation = orientationByPiece[selectedPieceId];
    const freePlacements = getFreePlacements(selectedPieceId, occupiedByOthers);
    const candidates = freePlacements.filter(
      (p) => p.orientationIndex === selectedOrientation,
    );
    if (candidates.length > 0) {
      applyPlacement(selectedPieceId, candidates[0], selectedOrientation);
    }
  }

  // ── Scan complete handler ───────────────────────────────────────────────

  function onScanComplete(confirmedPlacements: Map<number, PiecePlacement>): void {
    clearBoard();
    for (const [pieceId, placement] of confirmedPlacements) {
      applyPlacement(pieceId, placement, placement.orientationIndex);
    }
    setMode("manual");
  }

  // ── Debug offset nudges ──────────────────────────────────────────────────

  function nudgeOffset(pieceId: number, oi: number, axis: "x" | "y", delta: number): void {
    setOffsetOverrides((prev) => {
      const tuning = getPieceTuning(pieceId);
      const base = tuning.orientationOffsets?.[oi] ?? { x: 0, y: 0 };
      const current = prev[pieceId]?.[oi] ?? { x: base.x, y: base.y, scale: tuning.residualScale ?? 1 };
      const updated = { ...current, [axis]: Math.round((current[axis] + delta) * 100) / 100 };
      return { ...prev, [pieceId]: { ...(prev[pieceId] ?? {}), [oi]: updated } };
    });
  }

  function nudgeScale(pieceId: number, oi: number, delta: number): void {
    setOffsetOverrides((prev) => {
      const tuning = getPieceTuning(pieceId);
      const base = tuning.orientationOffsets?.[oi] ?? { x: 0, y: 0 };
      const current = prev[pieceId]?.[oi] ?? { x: base.x, y: base.y, scale: tuning.residualScale ?? 1 };
      const updated = { ...current, scale: Math.round((current.scale + delta) * 1000) / 1000 };
      return { ...prev, [pieceId]: { ...(prev[pieceId] ?? {}), [oi]: updated } };
    });
  }

  function resetOffset(pieceId: number): void {
    setOffsetOverrides((prev) => {
      const next = { ...prev };
      delete next[pieceId];
      return next;
    });
  }

  // ── Derived rendering data ───────────────────────────────────────────────

  const placedCells = useMemo(() => {
    return Object.entries(placedByPiece).flatMap(([id, placement]) => {
      const pieceId = Number(id);
      return placement.positions.map((position) => {
        const [row, col] = coordinator.toRowCol(position);
        const point = coordinator.rowColToBoardPoint(row, col);
        return { pieceId, position, x: point.x, y: point.y };
      });
    });
  }, [coordinator, placedByPiece]);

  const placedModels = useMemo((): PlacedModel[] => {
    return Object.entries(placedByPiece).map(([id, placement]) => {
      const pieceId = Number(id);

      // Compute the 3D center as the midpoint of the two most-distant gripping pins.
      const touchedPins = new Map<number, [number, number]>();
      for (const pos of placement.positions) {
        const pinIndex = positionToPinIndex.get(pos);
        if (pinIndex !== undefined && !touchedPins.has(pinIndex)) {
          touchedPins.set(pinIndex, pinCentersByIndex[pinIndex]);
        }
      }

      let centerRow: number;
      let centerCol: number;

      const pinList = [...touchedPins.values()];
      if (pinList.length >= 2) {
        let maxDist2 = -1;
        let bestA = pinList[0];
        let bestB = pinList[1];
        for (let i = 0; i < pinList.length; i++) {
          for (let j = i + 1; j < pinList.length; j++) {
            const dr = pinList[i][0] - pinList[j][0];
            const dc = pinList[i][1] - pinList[j][1];
            const d2 = dr * dr + dc * dc;
            if (d2 > maxDist2) { maxDist2 = d2; bestA = pinList[i]; bestB = pinList[j]; }
          }
        }
        centerRow = (bestA[0] + bestB[0]) / 2;
        centerCol = (bestA[1] + bestB[1]) / 2;
      } else {
        // Fallback: average of all occupied cells
        let sumRow = 0, sumCol = 0;
        for (const pos of placement.positions) {
          const [r, c] = coordinator.toRowCol(pos);
          sumRow += r; sumCol += c;
        }
        const count = placement.positions.length || 1;
        centerRow = sumRow / count;
        centerCol = sumCol / count;
      }

      const asset = PIECE_ASSET_BY_ID[pieceId];
      const oi = placement.orientationIndex;
      const override = offsetOverrides[pieceId]?.[oi];

      return {
        pieceId,
        colorHex: asset.colorHex,
        modelUrl: asset.objUrl,
        centerRow,
        centerCol,
        orientationIndex: oi,
        rotationSteps: placement.rotationSteps ?? 0,
        mirrored: placement.mirrored ?? false,
        residualOffsetX: override?.x,
        residualOffsetY: override?.y,
        residualScale: override?.scale,
      };
    });
  }, [coordinator, offsetOverrides, pinCentersByIndex, placedByPiece, positionToPinIndex]);

  const pieceStats = useMemo(() => {
    return IQ_NOODLES_PIECES.map((piece) => ({
      id: piece.id,
      orientations: orientationIndicesByPiece[piece.id]?.length ?? orientationCounts[piece.id],
      isPlaced: Boolean(placedByPiece[piece.id]),
    }));
  }, [orientationCounts, orientationIndicesByPiece, placedByPiece]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (isPhone) {
    if (mode === "scan") {
      return (
        <>
          <SharedInventoryCanvas />
          <div className="noodles-shell is-mobile">
            <CameraCaptureView
              onScanComplete={onScanComplete}
              onOpenManual={() => setMode("manual")}
            />
          </div>
        </>
      );
    }

    return (
      <>
        <SharedInventoryCanvas />
        <div className="noodles-shell is-mobile">
          <div className="mobile-manual">
            <div className="mobile-manual-topbar">
              <button
                type="button"
                className="camera-chip"
                onClick={() => setMode("scan")}
                aria-label="Back to camera"
              >
                ← Camera
              </button>
              <span className="mobile-manual-title">Manual</span>
              <div className="mobile-manual-topbar-actions">
                <button type="button" className="camera-chip" onClick={onHint} aria-label="Hint">
                  Hint
                </button>
                <button type="button" className="camera-chip" onClick={onSolve} aria-label="Solve">
                  Solve
                </button>
                <button type="button" className="camera-chip" onClick={clearBoard} aria-label="Clear board">
                  Clear
                </button>
              </div>
            </div>

            <div className="mobile-manual-board">
              <BoardCanvas
                coordinator={coordinator}
                boardCells={boardCells}
                pinCenters={pinCenters}
                placedCells={placedCells}
                placedModels={placedModels}
                previewPlacement={previewPlacement}
                selectedPieceId={selectedPieceId}
                showDebug={showDebug}
                placedByPiece={placedByPiece}
                onPointerMove={onBoardPointerMove}
                onPointerLeave={() => setHoverPoint(null)}
                onPointerDown={onBoardClick}
              />
            </div>

            {solverStatus && <div className="mobile-manual-status">{solverStatus}</div>}

            <TouchPiecePicker
              pieceStats={pieceStats}
              selectedPieceId={selectedPieceId}
              onSelect={setSelectedPieceId}
              onRotate={rotate}
              onFlip={flip}
              onPickUp={removePiece}
            />
          </div>
        </div>
      </>
    );
  }

  // Desktop: unchanged layout
  if (mode === "scan") {
    return (
      <>
        <SharedInventoryCanvas />
        <div className="noodles-shell">
          <div className="noodles-header">
            <CaptureView
              onScanComplete={onScanComplete}
              onCancel={() => setMode("manual")}
            />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
    <SharedInventoryCanvas />
    <div className="noodles-shell">
      <header className="noodles-header">
        <div className="noodles-title-row">
          <h1>IQ Noodles</h1>
          <button className="capture-btn capture-btn--primary" onClick={() => setMode("scan")}>
            Scan Board
          </button>
        </div>

        <ControlBar
          onRotate={() => rotate(selectedPieceId)}
          onFlip={() => flip(selectedPieceId)}
          onClear={clearBoard}
          onPlaceFirstFit={placeFirstFit}
          onValidate={onValidate}
          onSolve={onSolve}
          onHint={onHint}
          onToggleDebug={() => setShowDebug((v) => !v)}
          showDebug={showDebug}
          solverStatus={solverStatus}
        />

        {import.meta.env.DEV && showDebug && (
          <DebugPanel
            selectedPieceId={selectedPieceId}
            selectedOrientation={orientationByPiece[selectedPieceId]}
            orientationMetaByPiece={orientationMetaByPiece}
            orientationIndicesByPiece={orientationIndicesByPiece}
            placedByPiece={placedByPiece}
            placementInfo={debugPlacementInfo}
            offsetOverrides={offsetOverrides}
            onNudgeOffset={nudgeOffset}
            onNudgeScale={nudgeScale}
            onResetOffset={resetOffset}
          />
        )}
      </header>

      <section className="board-panel">
        <BoardCanvas
          coordinator={coordinator}
          boardCells={boardCells}
          pinCenters={pinCenters}
          placedCells={placedCells}
          placedModels={placedModels}
          previewPlacement={previewPlacement}
          selectedPieceId={selectedPieceId}
          showDebug={showDebug}
          placedByPiece={placedByPiece}
          onPointerMove={onBoardPointerMove}
          onPointerLeave={() => setHoverPoint(null)}
          onPointerDown={onBoardClick}
        />
      </section>

      <section className="inventory-panel">
        <PieceInventory
          pieceStats={pieceStats}
          selectedPieceId={selectedPieceId}
          onSelect={setSelectedPieceId}
          onRotate={rotate}
          onFlip={flip}
          onPickUp={removePiece}
        />
      </section>
    </div>
    </>
  );
}
