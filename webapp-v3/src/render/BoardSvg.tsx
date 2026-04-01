import { useMemo } from 'react';
import { PIN_COORDINATES, VALID_POSITIONS, GRID_WIDTH } from '../board/board';
import { PIECE_LABELS, PIECE_COLORS } from '../constants';
import { SVG_SIZE, toSvg, getPlacementPinData } from './noodlePath';
import type { Placement, PieceMapping } from '../types';

interface BoardSvgProps {
  mappings: PieceMapping[];
  hintPlacement?: Placement | null;
}

const PIN_RADIUS = 6;
const BOARD_MIN = -7.9;
const BOARD_SPAN = 15.8;
const CELL_SIZE = BOARD_SPAN / GRID_WIDTH;

function cellToBoardCenter(cellIndex: number): [number, number] {
  const row = Math.floor(cellIndex / GRID_WIDTH);
  const col = cellIndex % GRID_WIDTH;
  return [
    BOARD_MIN + (col + 0.5) * CELL_SIZE,
    BOARD_MIN + (row + 0.5) * CELL_SIZE,
  ];
}

function pinCenter(pins: number[]): [number, number] {
  if (pins.length === 0) return [0, 0];
  let sumX = 0;
  let sumY = 0;
  for (const pin of pins) {
    sumX += PIN_COORDINATES[pin][0];
    sumY += PIN_COORDINATES[pin][1];
  }
  return [sumX / pins.length, sumY / pins.length];
}

export function BoardSvg({ mappings, hintPlacement }: BoardSvgProps) {
  const placedPieces = useMemo(() => {
    const pieces: Array<{
      pieceIndex: number; label: string; color: string;
      rgb: [number, number, number]; pins: number[]; positions: number[];
    }> = [];

    for (const m of mappings) {
      if (!m.placement) continue;
      const idx = m.placement.pieceIndex;
      const label = PIECE_LABELS[idx];
      const { rgb } = PIECE_COLORS[label];
      const { pins } = getPlacementPinData(m.placement);
      pieces.push({
        pieceIndex: idx, label,
        color: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
        rgb, pins,
        positions: [...m.placement.positions],
      });
    }
    return pieces;
  }, [mappings]);

  const hintPiece = useMemo(() => {
    if (!hintPlacement) return null;
    const idx = hintPlacement.pieceIndex;
    const label = PIECE_LABELS[idx];
    const { rgb } = PIECE_COLORS[label];
    const { pins } = getPlacementPinData(hintPlacement);
    return {
      pieceIndex: idx,
      label,
      color: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
      rgb,
      pins,
      positions: [...hintPlacement.positions],
    };
  }, [hintPlacement]);

  const occupiedPins = useMemo(() => {
    const map = new Map<number, { pieceIndex: number; color: string }>();
    for (const p of placedPieces) {
      for (const pin of p.pins) map.set(pin, { pieceIndex: p.pieceIndex, color: p.color });
    }
    return map;
  }, [placedPieces]);

  return (
    <div className="board-view">
      <svg viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`} className="board-svg" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width={SVG_SIZE} height={SVG_SIZE} fill="#1a1a2e" rx="12" />

        {/* Board outline */}
        <rect
          x={toSvg(-7.9, -7.9)[0]} y={toSvg(-7.9, -7.9)[1]}
          width={15.8 * 26} height={15.8 * 26}
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="2" rx="4"
        />

        {/* Board structure: show all valid cells so puzzle shape is understandable */}
        {VALID_POSITIONS.map((cellIndex) => {
          const [bx, by] = cellToBoardCenter(cellIndex);
          const [sx, sy] = toSvg(bx, by);
          return (
            <rect
              key={`cell-${cellIndex}`}
              x={sx - 4}
              y={sy - 4}
              width={8}
              height={8}
              rx={2}
              fill="rgba(255,255,255,0.04)"
              stroke="rgba(255,255,255,0.06)"
              strokeWidth="0.5"
            />
          );
        })}

        {/* Placed pieces */}
        {placedPieces.map(p => (
          <g key={`piece-${p.pieceIndex}`}>
            {p.positions.map((cellIndex) => {
              const [bx, by] = cellToBoardCenter(cellIndex);
              const [sx, sy] = toSvg(bx, by);
              return (
                <rect
                  key={`piece-cell-${p.pieceIndex}-${cellIndex}`}
                  x={sx - 6}
                  y={sy - 6}
                  width={12}
                  height={12}
                  rx={3}
                  fill={p.color}
                  opacity="0.92"
                />
              );
            })}

            {(() => {
              const [cx, cy] = pinCenter(p.pins);
              const [sx, sy] = toSvg(cx, cy);
              return (
                <g>
                  <circle cx={sx} cy={sy} r={8} fill="rgba(8,10,22,0.74)" />
                  <text x={sx} y={sy + 1} textAnchor="middle" dominantBaseline="middle"
                    fill="white" fontSize="8" fontWeight="700" fontFamily="Inter, sans-serif" pointerEvents="none">
                    {p.label}
                  </text>
                </g>
              );
            })()}
          </g>
        ))}

        {/* Hint piece */}
        {hintPiece && (
          <g>
            {hintPiece.positions.map((cellIndex) => {
              const [bx, by] = cellToBoardCenter(cellIndex);
              const [sx, sy] = toSvg(bx, by);
              return (
                <rect
                  key={`hint-cell-${hintPiece.pieceIndex}-${cellIndex}`}
                  x={sx - 6}
                  y={sy - 6}
                  width={12}
                  height={12}
                  rx={3}
                  fill={hintPiece.color}
                  opacity="0.35"
                >
                  <animate attributeName="opacity" values="0.2;0.45;0.2" dur="1.2s" repeatCount="indefinite" />
                </rect>
              );
            })}
            {hintPiece.pins.map(pin => {
              const [sx, sy] = toSvg(...PIN_COORDINATES[pin]);
              return (
                <g key={`hint-${pin}`}>
                  <circle cx={sx} cy={sy} r={PIN_RADIUS + 4}
                    fill={`rgba(${hintPiece.rgb[0]},${hintPiece.rgb[1]},${hintPiece.rgb[2]},0.3)`}
                    stroke="rgba(255,255,255,0.25)" strokeWidth="1">
                    <animate attributeName="r" values={`${PIN_RADIUS + 4};${PIN_RADIUS + 7};${PIN_RADIUS + 4}`} dur="1.2s" repeatCount="indefinite" />
                  </circle>
                  <text x={sx} y={sy + 1} textAnchor="middle" dominantBaseline="middle"
                    fill="rgba(255,255,255,0.8)" fontSize="9" fontWeight="600" fontFamily="Inter, sans-serif" pointerEvents="none">
                    {hintPiece.label}?
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Pins */}
        {PIN_COORDINATES.map(([bx, by], pin) => {
          const [sx, sy] = toSvg(bx, by);
          const occ = occupiedPins.get(pin);
          return (
            <g key={`pin-${pin}`}>
              <circle cx={sx} cy={sy} r={PIN_RADIUS + 3}
                fill="rgba(255,255,255,0.05)"
              />
              <circle cx={sx} cy={sy} r={occ ? PIN_RADIUS + 1 : PIN_RADIUS}
                fill={occ ? occ.color : 'rgba(255,255,255,0.12)'}
                className="board-pin" />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
