import { useMemo, useState } from "react";

import {
  IQ_NOODLES_PIECES,
  NoodlesBoard,
  POSITIONS_AROUND_PINS,
  findAllOrientations,
  generatePlacementsForPiece,
  solve,
  getHint,
} from "../iq-noodles-engine";
import type { PiecePlacement } from "../iq-noodles-engine";
import BoardScene3D from "./BoardScene3D";
import { BoardCoordinator, getPinCenter } from "./boardCoordinator";
import PiecePreview3D from "./PiecePreview3D";
import { PIECE_ASSET_BY_ID } from "./pieceAssets";

import "./iq-noodles-app.css";

interface PointerMapResult {
  x: number;
  y: number;
  rectWidth: number;
  rectHeight: number;
}

function getPlacementFootprintSize(positions: number[], boardWidth: number): number {
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;

  positions.forEach((position) => {
    const row = Math.floor(position / boardWidth);
    const col = position % boardWidth;
    minRow = Math.min(minRow, row);
    maxRow = Math.max(maxRow, row);
    minCol = Math.min(minCol, col);
    maxCol = Math.max(maxCol, col);
  });

  const rowSpan = maxRow - minRow + 1;
  const colSpan = maxCol - minCol + 1;
  return Math.max(rowSpan, colSpan);
}


export default function IQNoodlesApp() {
  const board = useMemo(() => new NoodlesBoard(), []);
  const coordinator = useMemo(() => new BoardCoordinator(board.width, board.height), [board.height, board.width]);
  const [selectedPieceId, setSelectedPieceId] = useState(0);
  const [placedByPiece, setPlacedByPiece] = useState<Record<number, PiecePlacement>>({});
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number } | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [debugPlacementInfo, setDebugPlacementInfo] = useState("");

  const [orientationByPiece, setOrientationByPiece] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      initial[piece.id] = 0;
    });
    return initial;
  });

  const orientationCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      counts[piece.id] = findAllOrientations(piece).length;
    });
    return counts;
  }, []);

  const placementsByPiece = useMemo(() => {
    const placements: Record<number, PiecePlacement[]> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      placements[piece.id] = generatePlacementsForPiece(piece.id, board);
    });
    return placements;
  }, [board]);

  const orientationMetaByPiece = useMemo(() => {
    const meta: Record<number, Record<number, { mirrored: boolean; rotationSteps: 0 | 1 | 2 | 3 }>> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      const byOrientation: Record<number, { mirrored: boolean; rotationSteps: 0 | 1 | 2 | 3 }> = {};
      placementsByPiece[piece.id].forEach((placement) => {
        if (byOrientation[placement.orientationIndex] === undefined) {
          byOrientation[placement.orientationIndex] = {
            mirrored: placement.mirrored ?? false,
            rotationSteps: placement.rotationSteps ?? 0,
          };
        }
      });
      meta[piece.id] = byOrientation;
    });
    return meta;
  }, [placementsByPiece]);

  const orientationIndicesByPiece = useMemo(() => {
    const indices: Record<number, number[]> = {};
    IQ_NOODLES_PIECES.forEach((piece) => {
      indices[piece.id] = Object.keys(orientationMetaByPiece[piece.id])
        .map(Number)
        .sort((a, b) => a - b);
    });
    return indices;
  }, [orientationMetaByPiece]);

  const getNextOrientationIndex = (pieceId: number, currentOrientation: number): number => {
    const available = orientationIndicesByPiece[pieceId] ?? [];
    if (available.length === 0) {
      return currentOrientation;
    }

    const currentMeta = orientationMetaByPiece[pieceId]?.[currentOrientation];
    if (!currentMeta) {
      return available[0];
    }

    const sameMirror = available.filter(
      (index) => (orientationMetaByPiece[pieceId]?.[index]?.mirrored ?? false) === currentMeta.mirrored,
    );

    const cyclePool = (sameMirror.length > 0 ? sameMirror : available)
      .slice()
      .sort((a, b) => {
        const ra = orientationMetaByPiece[pieceId]?.[a]?.rotationSteps ?? 0;
        const rb = orientationMetaByPiece[pieceId]?.[b]?.rotationSteps ?? 0;
        return ra - rb || a - b;
      });

    const currentIndex = cyclePool.indexOf(currentOrientation);
    if (currentIndex < 0) {
      return cyclePool[0];
    }
    return cyclePool[(currentIndex + 1) % cyclePool.length];
  };

  const pieceStats = useMemo(() => {
    return IQ_NOODLES_PIECES.map((piece) => ({
      id: piece.id,
      orientations: orientationIndicesByPiece[piece.id]?.length ?? orientationCounts[piece.id],
      isPlaced: Boolean(placedByPiece[piece.id]),
    }));
  }, [orientationCounts, orientationIndicesByPiece, placedByPiece]);

  const boardCells = useMemo(() => {
    const cells: Array<{ position: number; x: number; y: number }> = [];
    for (let position = 0; position < board.width * board.height; position += 1) {
      if (!board.isFree(position)) {
        continue;
      }
      const [row, col] = coordinator.toRowCol(position);
      const point = coordinator.rowColToBoardPoint(row, col);
      cells.push({
        position,
        x: point.x,
        y: point.y,
      });
    }
    return cells;
  }, [board, coordinator]);

  const pinCenters = useMemo(() => {
    return POSITIONS_AROUND_PINS.map((positions, pinIndex) => {
      const [row, col] = getPinCenter(positions, coordinator);
      const point = coordinator.rowColToBoardPoint(row, col);
      return {
        pinIndex,
        x: point.x,
        y: point.y,
      };
    });
  }, [coordinator]);

  const boardSize = coordinator.boardSize;

  const occupiedByOthers = useMemo(() => {
    const occupied = new Set<number>();
    Object.entries(placedByPiece).forEach(([key, placement]) => {
      const pieceId = Number(key);
      if (pieceId === selectedPieceId) {
        return;
      }
      placement.positions.forEach((position) => occupied.add(position));
    });
    return occupied;
  }, [placedByPiece, selectedPieceId]);

  const getFreePlacements = (pieceId: number): PiecePlacement[] => {
    return placementsByPiece[pieceId].filter((placement) =>
      placement.positions.every((position) => !occupiedByOthers.has(position)),
    );
  };

  const countFreePlacementsByOrientation = (pieceId: number): Record<number, number> => {
    return getFreePlacements(pieceId).reduce<Record<number, number>>((acc, placement) => {
      acc[placement.orientationIndex] = (acc[placement.orientationIndex] ?? 0) + 1;
      return acc;
    }, {});
  };

  const applyPlacement = (pieceId: number, placement: PiecePlacement, selectedOrientation: number): void => {
    if (placement.orientationIndex !== selectedOrientation) {
      setOrientationByPiece((previous) => ({
        ...previous,
        [pieceId]: placement.orientationIndex,
      }));
    }

    setPlacedByPiece((previous) => ({
      ...previous,
      [pieceId]: placement,
    }));
  };

  const findBestPlacement = (
    pieceId: number,
    orientationIndex: number,
    targetRow: number,
    targetCol: number,
    allowOrientationFallback = false,
  ): PiecePlacement | null => {
    const freeCandidates = getFreePlacements(pieceId);

    const candidates = freeCandidates.filter((placement) => placement.orientationIndex === orientationIndex);

    const scoringPool =
      candidates.length > 0 || !allowOrientationFallback ? candidates : freeCandidates;

    if (scoringPool.length === 0) {
      return null;
    }

    let bestPlacement: PiecePlacement | null = null;
    let bestScore = Number.POSITIVE_INFINITY;

    scoringPool.forEach((placement) => {
      const center = placement.positions.reduce(
        (acc, position) => {
          const [row, col] = coordinator.toRowCol(position);
          acc.row += row;
          acc.col += col;
          return acc;
        },
        { row: 0, col: 0 },
      );

      center.row /= placement.positions.length;
      center.col /= placement.positions.length;
      const score = (center.row - targetRow) ** 2 + (center.col - targetCol) ** 2;

      if (score < bestScore) {
        bestScore = score;
        bestPlacement = placement;
      }
    });

    return bestPlacement;
  };

  const previewCell = hoverPoint ? coordinator.boardPointToRowCol(hoverPoint) : null;
  const previewPlacement = previewCell
    ? findBestPlacement(
      selectedPieceId,
      orientationByPiece[selectedPieceId],
      previewCell.row,
      previewCell.col,
    )
    : null;

  const mapPointerToBoard = (event: React.PointerEvent<HTMLDivElement>): PointerMapResult => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      ...coordinator.domToBoardPoint(
        event.clientX,
        event.clientY,
        rect.left,
        rect.top,
        rect.width,
        rect.height,
      ),
      rectWidth: rect.width,
      rectHeight: rect.height,
    };
  };

  const getLocalPoint = (event: React.PointerEvent<HTMLDivElement>): { x: number; y: number } => {
    const mapped = mapPointerToBoard(event);
    return { x: mapped.x, y: mapped.y };
  };

  const getFlippedOrientationIndex = (pieceId: number, currentOrientation: number): number => {
    const available = orientationIndicesByPiece[pieceId] ?? [];
    const currentMeta = orientationMetaByPiece[pieceId]?.[currentOrientation];
    if (!currentMeta) return currentOrientation;

    const targetMirrored = !currentMeta.mirrored;
    const opposite = available.filter(
      (index) => (orientationMetaByPiece[pieceId]?.[index]?.mirrored ?? false) === targetMirrored,
    );
    if (opposite.length === 0) return currentOrientation;

    const matchingRotation = opposite.find(
      (index) => (orientationMetaByPiece[pieceId]?.[index]?.rotationSteps ?? 0) === currentMeta.rotationSteps,
    );
    return matchingRotation ?? opposite[0];
  };

  const rotateSelectedPiece = (): void => {
    const current = orientationByPiece[selectedPieceId];
    const next = getNextOrientationIndex(selectedPieceId, current);

    setOrientationByPiece((previous) => ({
      ...previous,
      [selectedPieceId]: next,
    }));
  };

  const flipSelectedPiece = (): void => {
    const current = orientationByPiece[selectedPieceId];
    const next = getFlippedOrientationIndex(selectedPieceId, current);
    setOrientationByPiece((previous) => ({
      ...previous,
      [selectedPieceId]: next,
    }));
  };

  const clearBoard = (): void => {
    setPlacedByPiece({});
    setSolverStatus("");
  };

  const [solverStatus, setSolverStatus] = useState("");

  const buildInitialPlacements = (): Map<number, PiecePlacement> => {
    const map = new Map<number, PiecePlacement>();
    for (const [id, placement] of Object.entries(placedByPiece)) {
      map.set(Number(id), placement);
    }
    return map;
  };

  const onSolve = (): void => {
    setSolverStatus("Solving...");
    setTimeout(() => {
      const result = solve(buildInitialPlacements());
      if (result.solved) {
        const next: Record<number, PiecePlacement> = {};
        result.solution.forEach((placement, pieceId) => {
          if (placement) next[pieceId] = placement;
        });
        setPlacedByPiece(next);
        setSolverStatus(`Solved in ${result.timeMs.toFixed(0)}ms (${result.statesExplored} states)`);
      } else if (result.timedOut) {
        setSolverStatus("Solver timed out");
      } else {
        setSolverStatus("No solution found");
      }
    }, 10);
  };

  const onHint = (): void => {
    setSolverStatus("Finding hint...");
    setTimeout(() => {
      const hint = getHint(buildInitialPlacements());
      if (hint) {
        setPlacedByPiece((prev) => ({ ...prev, [hint.pieceId]: hint.placement }));
        setSolverStatus(`Hint: piece ${PIECE_ASSET_BY_ID[hint.pieceId].key} (${hint.fullResult.timeMs.toFixed(0)}ms)`);
      } else {
        setSolverStatus("No hint available");
      }
    }, 10);
  };

  const placeFirstFit = (): void => {
    const selectedOrientation = orientationByPiece[selectedPieceId];
    const freeByOrientation = getFreePlacements(selectedPieceId)
      .reduce<Record<number, PiecePlacement[]>>((acc, placement) => {
        if (!acc[placement.orientationIndex]) {
          acc[placement.orientationIndex] = [];
        }
        acc[placement.orientationIndex].push(placement);
        return acc;
      }, {});

    const fallbackPool = Object.values(freeByOrientation).flat();
    const candidate = freeByOrientation[selectedOrientation]?.[0] ?? fallbackPool[0] ?? null;

    if (showDebug) {
      const counts = Object.entries(freeByOrientation)
        .map(([idx, list]) => `${idx}:${list.length}`)
        .join(" ");
      const resultLabel = candidate
        ? `ok orientation=${candidate.orientationIndex}`
        : "none";
      setDebugPlacementInfo(
        [
          `manualPlace piece=${PIECE_ASSET_BY_ID[selectedPieceId].key}(${selectedPieceId}) selectedOrientation=${selectedOrientation}`,
          `freeCandidatesByOrientation=${counts || "none"}`,
          `result=${resultLabel}`,
        ].join("\n"),
      );
    }

    if (!candidate) {
      return;
    }

    applyPlacement(selectedPieceId, candidate, selectedOrientation);
  };

  const onBoardClick = (event: React.PointerEvent<HTMLDivElement>): void => {
    const mapped = mapPointerToBoard(event);
    const mappedCell = coordinator.boardPointToRowCol({ x: mapped.x, y: mapped.y });
    const targetRow = mappedCell.row;
    const targetCol = mappedCell.col;
    const selectedOrientation = orientationByPiece[selectedPieceId];

    const freeByOrientation = countFreePlacementsByOrientation(selectedPieceId);

    const candidate = findBestPlacement(
      selectedPieceId,
      selectedOrientation,
      targetRow,
      targetCol,
      true,
    );

    if (showDebug) {
      const counts = Object.keys(freeByOrientation)
        .map((key) => `${key}:${freeByOrientation[Number(key)]}`)
        .join(" ");
      const resultLabel = candidate
        ? `ok orientation=${candidate.orientationIndex}`
        : "none";
      setDebugPlacementInfo(
        [
          `piece=${PIECE_ASSET_BY_ID[selectedPieceId].key}(${selectedPieceId}) selectedOrientation=${selectedOrientation}`,
          `svgRect=${mapped.rectWidth.toFixed(1)}x${mapped.rectHeight.toFixed(1)} boardSize=${boardSize}`,
          `local=(${mapped.x.toFixed(1)}, ${mapped.y.toFixed(1)}) target=(${targetRow.toFixed(2)}, ${targetCol.toFixed(2)})`,
          `freeCandidatesByOrientation=${counts || "none"}`,
          `result=${resultLabel}`,
        ].join("\n"),
      );
    }

    if (!candidate) {
      return;
    }

    applyPlacement(selectedPieceId, candidate, selectedOrientation);
  };

  const removePiece = (pieceId: number): void => {
    setPlacedByPiece((previous) => {
      const next = { ...previous };
      delete next[pieceId];
      return next;
    });
    setSelectedPieceId(pieceId);
  };

  const placedCells = useMemo(() => {
    return Object.entries(placedByPiece).flatMap(([id, placement]) => {
      const pieceId = Number(id);
      return placement.positions.map((position) => {
        const [row, col] = coordinator.toRowCol(position);
        const point = coordinator.rowColToBoardPoint(row, col);
        return {
          pieceId,
          position,
          x: point.x,
          y: point.y,
        };
      });
    });
  }, [coordinator, placedByPiece]);

  const placedModels = useMemo(() => {
    return Object.entries(placedByPiece).map(([id, placement]) => {
      const pieceId = Number(id);
      const center = placement.positions.reduce(
        (acc, position) => {
          const [row, col] = coordinator.toRowCol(position);
          acc.row += row;
          acc.col += col;
          return acc;
        },
        { row: 0, col: 0 },
      );

      const count = placement.positions.length || 1;
      const asset = PIECE_ASSET_BY_ID[pieceId];

      return {
        pieceId,
        colorHex: asset.colorHex,
        modelUrl: asset.objUrl,
        centerRow: center.row / count,
        centerCol: center.col / count,
        rotationSteps: placement.rotationSteps ?? 0,
        mirrored: placement.mirrored ?? false,
        modelSize: getPlacementFootprintSize(placement.positions, board.width),
      };
    });
  }, [coordinator, placedByPiece]);

  return (
    <div className="noodles-shell">
      <header className="noodles-header">
        <h1>IQ Noodles</h1>
        <div className="controls-row">
          <button type="button" onClick={rotateSelectedPiece}>Rotate</button>
          <button type="button" onClick={flipSelectedPiece}>Flip</button>
          <button type="button" onClick={clearBoard}>Clear</button>
          <button type="button" onClick={placeFirstFit}>Place First Fit</button>
          <button type="button" onClick={onSolve}>Solve</button>
          <button type="button" onClick={onHint}>Hint</button>
          <button type="button" onClick={() => setShowDebug((v) => !v)}>{showDebug ? "Hide Debug Panel" : "Show Debug Panel"}</button>
          {solverStatus && <span className="feedback-line">{solverStatus}</span>}
        </div>
        {showDebug && (() => {
          const selectedOrientation = orientationByPiece[selectedPieceId];
          const selectedMeta = orientationMetaByPiece[selectedPieceId]?.[selectedOrientation];
          const available = orientationIndicesByPiece[selectedPieceId] ?? [];
          const sameMirror = available
            .filter((index) => (orientationMetaByPiece[selectedPieceId]?.[index]?.mirrored ?? false) === (selectedMeta?.mirrored ?? false))
            .sort((a, b) => {
              const ra = orientationMetaByPiece[selectedPieceId]?.[a]?.rotationSteps ?? 0;
              const rb = orientationMetaByPiece[selectedPieceId]?.[b]?.rotationSteps ?? 0;
              return ra - rb || a - b;
            });

          return (
            <pre className="debug-panel" aria-label="Orientation debug panel">
              {[
                `selectedPiece=${PIECE_ASSET_BY_ID[selectedPieceId].key}(${selectedPieceId})`,
                `selectedOrientation=${selectedOrientation}`,
                `selectedRotationSteps=${selectedMeta?.rotationSteps ?? "?"}`,
                `selectedMirrored=${selectedMeta?.mirrored ?? "?"}`,
                `rotatePool=${sameMirror.map((index) => `${index}[r${orientationMetaByPiece[selectedPieceId]?.[index]?.rotationSteps ?? "?"}]`).join(" ") || "none"}`,
              ].join("\n")}
            </pre>
          );
        })()}
        {showDebug && debugPlacementInfo && (
          <pre className="debug-panel" aria-label="Placement debug panel">{debugPlacementInfo}</pre>
        )}
      </header>

      <section className="board-panel">
        <div className="merged-board">
          <div
            className="board-interaction-layer"
            aria-label="IQ Noodles interaction layer"
            role="region"
            onPointerMove={(event) => setHoverPoint(getLocalPoint(event))}
            onPointerLeave={() => setHoverPoint(null)}
            onPointerDown={onBoardClick}
          />

          <svg
            className="board-visual-layer"
            viewBox={`0 0 ${boardSize} ${boardSize}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="IQ Noodles board visuals"
          >
            <rect x={0} y={0} width={boardSize} height={boardSize} rx={18} className="board-frame" />

            {boardCells.map((cell) => (
              <circle
                key={cell.position}
                cx={cell.x}
                cy={cell.y}
                r={6}
                className="board-cell"
              />
            ))}

            {pinCenters.map((pin) => (
              <g key={pin.pinIndex}>
                <circle cx={pin.x} cy={pin.y} r={10} className="pin-ring" />
                <circle cx={pin.x} cy={pin.y} r={4} className="pin-core" />
              </g>
            ))}

            {previewPlacement?.positions.map((position) => {
              const [row, col] = coordinator.toRowCol(position);
              const point = coordinator.rowColToBoardPoint(row, col);
              return (
                <circle
                  key={`preview-${position}`}
                  cx={point.x}
                  cy={point.y}
                  r={8.5}
                  className="preview-cell"
                  fill={PIECE_ASSET_BY_ID[selectedPieceId].colorHex}
                />
              );
            })}

            {placedCells.map((cell) => (
              <circle
                key={`${cell.pieceId}-${cell.position}`}
                cx={cell.x}
                cy={cell.y}
                r={8.5}
                className="placed-cell"
                fill={PIECE_ASSET_BY_ID[cell.pieceId].colorHex}
              />
            ))}

            {showDebug && placedModels.map((model) => {
              const asset = PIECE_ASSET_BY_ID[model.pieceId];
              const centerPoint = coordinator.rowColToBoardPoint(model.centerRow, model.centerCol);
              const cx = centerPoint.x;
              const cy = centerPoint.y;
              return (
                <text
                  key={`debug-${model.pieceId}`}
                  x={cx}
                  y={cy}
                  className="debug-label"
                >
                  {`${asset.key} o${placedByPiece[model.pieceId]?.orientationIndex ?? "?"} r${model.rotationSteps}${model.mirrored ? " M" : ""}`}
                </text>
              );
            })}
          </svg>

          <BoardScene3D
            coordinator={coordinator}
            placedModels={placedModels}
          />
        </div>
      </section>

      <section className="inventory-panel">
        <div className="piece-grid">
          {pieceStats.map((piece) => (
            <article
              key={piece.id}
              className={`piece-card ${selectedPieceId === piece.id ? "selected" : ""}`}
            >
              <div className="piece-label">
                <span className="piece-key" style={{ color: PIECE_ASSET_BY_ID[piece.id].colorHex }}>{PIECE_ASSET_BY_ID[piece.id].key}</span>
                <span className="piece-color-name">{PIECE_ASSET_BY_ID[piece.id].colorName}</span>
              </div>
              <PiecePreview3D
                modelUrl={PIECE_ASSET_BY_ID[piece.id].objUrl}
                colorHex={PIECE_ASSET_BY_ID[piece.id].colorHex}
              />
              <div className="piece-actions">
                <button type="button" aria-label="Select piece" onClick={() => setSelectedPieceId(piece.id)}>Use</button>
                <button
                  type="button"
                  aria-label="Rotate piece"
                  onClick={() => {
                    setOrientationByPiece((previous) => {
                      const current = previous[piece.id];
                      const next = getNextOrientationIndex(piece.id, current);
                      return {
                        ...previous,
                        [piece.id]: next,
                      };
                    });
                  }}
                >
                  Rotate
                </button>
                <button
                  type="button"
                  aria-label="Flip piece"
                  onClick={() => {
                    setOrientationByPiece((previous) => {
                      const current = previous[piece.id];
                      const next = getFlippedOrientationIndex(piece.id, current);
                      return { ...previous, [piece.id]: next };
                    });
                  }}
                >
                  Flip
                </button>
                {piece.isPlaced && (
                  <button type="button" aria-label="Pick up piece" onClick={() => removePiece(piece.id)}>Pick Up</button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
