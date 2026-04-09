import { useMemo, useState } from "react";

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
import SharedInventoryCanvas from "../rendering/SharedInventoryCanvas";
import { useOrientations } from "../hooks/useOrientations";
import { usePlacementFinder } from "../hooks/usePlacementFinder";
import { useSolver } from "../hooks/useSolver";
import CaptureView from "./CaptureView";
import type { ScanResult } from "../vision/visionTypes";

import "../styles/app.css";

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

  const { placementsByPiece, findBestPlacement, getFreePlacements, countFreePlacementsByOrientation } =
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
    setSelectedPieceId(pieceId);
  }

  function buildInitialPlacements(): Map<number, PiecePlacement> {
    const map = new Map<number, PiecePlacement>();
    for (const [id, placement] of Object.entries(placedByPiece)) {
      map.set(Number(id), placement);
    }
    return map;
  }

  // ── Solver ───────────────────────────────────────────────────────────────

  const { solverStatus, clearStatus, onSolve, onValidate, onHint } = useSolver(
    buildInitialPlacements,
    (solution) => setPlacedByPiece(solution),
    (pieceId, placement) => setPlacedByPiece((prev) => ({ ...prev, [pieceId]: placement })),
  );

  function clearBoard(): void {
    setPlacedByPiece({});
    clearStatus();
  }

  // ── Scan completion handler ───────────────────────────────────────────────

  function onScanComplete(result: Extract<ScanResult, { ok: true }>): void {
    // Merge scanned placements on top of any manually placed pieces.
    // Scanned pieces take precedence for the same pieceId.
    const next: Record<number, PiecePlacement> = { ...placedByPiece };
    for (const [pieceId, placement] of result.confirmedPlacements) {
      next[pieceId] = placement;
    }
    setPlacedByPiece(next);
    // Pre-select the hinted piece so the user can place it immediately
    if (result.hint) {
      setSelectedPieceId(result.hint.nextPieceId);
    }
  }

  // ── Hover preview ────────────────────────────────────────────────────────

  const previewPlacement = useMemo(() => {
    if (!hoverPoint) return null;
    const { row, col } = coordinator.boardPointToRowCol(hoverPoint);
    return findBestPlacement(
      selectedPieceId,
      orientationByPiece[selectedPieceId],
      row,
      col,
      occupiedByOthers,
    );
  }, [hoverPoint, coordinator, findBestPlacement, selectedPieceId, orientationByPiece, occupiedByOthers]);

  // ── Board pointer events ─────────────────────────────────────────────────

  function mapPointerToBoard(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return coordinator.domToBoardPoint(event.clientX, event.clientY, rect.left, rect.top, rect.width, rect.height);
  }

  function onBoardPointerMove(event: React.PointerEvent<HTMLDivElement>): void {
    setHoverPoint(mapPointerToBoard(event));
  }

  function onBoardClick(event: React.PointerEvent<HTMLDivElement>): void {
    const boardPt = mapPointerToBoard(event);
    const { row: targetRow, col: targetCol } = coordinator.boardPointToRowCol(boardPt);
    const selectedOrientation = orientationByPiece[selectedPieceId];

    const candidate = findBestPlacement(
      selectedPieceId,
      selectedOrientation,
      targetRow,
      targetCol,
      occupiedByOthers,
      true,
    );

    if (showDebug) {
      const rect = event.currentTarget.getBoundingClientRect();
      const freeByOrientation = countFreePlacementsByOrientation(selectedPieceId, occupiedByOthers);
      const counts = Object.entries(freeByOrientation).map(([k, v]) => `${k}:${v}`).join(" ");
      setDebugPlacementInfo([
        `piece=${PIECE_ASSET_BY_ID[selectedPieceId].key}(${selectedPieceId}) selectedOrientation=${selectedOrientation}`,
        `svgRect=${rect.width.toFixed(1)}x${rect.height.toFixed(1)} boardSize=${coordinator.boardSize}`,
        `local=(${boardPt.x.toFixed(1)}, ${boardPt.y.toFixed(1)}) target=(${targetRow.toFixed(2)}, ${targetCol.toFixed(2)})`,
        `freeCandidatesByOrientation=${counts || "none"}`,
        `result=${candidate ? `ok orientation=${candidate.orientationIndex}` : "none"}`,
      ].join("\n"));
    }

    if (candidate) applyPlacement(selectedPieceId, candidate, selectedOrientation);
  }

  // ── Place First Fit ──────────────────────────────────────────────────────

  function placeFirstFit(): void {
    const selectedOrientation = orientationByPiece[selectedPieceId];
    const free = getFreePlacements(selectedPieceId, occupiedByOthers);
    const byOrientation = free.reduce<Record<number, PiecePlacement[]>>((acc, p) => {
      if (!acc[p.orientationIndex]) acc[p.orientationIndex] = [];
      acc[p.orientationIndex].push(p);
      return acc;
    }, {});

    const candidate = byOrientation[selectedOrientation]?.[0] ?? Object.values(byOrientation).flat()[0] ?? null;

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
      // This ensures we anchor to connector pins, not pass-through pins.
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

  return (
    <>
    <SharedInventoryCanvas />
    <div className="noodles-shell">
      <header className="noodles-header">
        <div className="noodles-title-row">
          <h1>IQ Noodles</h1>
        </div>

        <CaptureView onScanComplete={onScanComplete} />

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

        {showDebug && (
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
