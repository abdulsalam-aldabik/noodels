import { useMemo } from 'react';
import { PIN_COORDINATES, NUM_PINS } from '../board/board';
import { PIECE_LABELS, PIECE_COLORS } from '../constants';
import { SVG_SIZE, toSvg, getPlacementPinData, generateNoodlePath } from './noodlePath';
import type { Placement, PieceMapping } from '../types';

interface BoardSvgProps {
  mappings: PieceMapping[];
  hintPlacement?: Placement | null;
}

const PIN_RADIUS = 6;
const NOODLE_WIDTH = 12;

function NoodleEndCaps({ pins, color }: { pins: number[]; color: string }) {
  if (pins.length === 0) return null;
  const caps = pins[0] === pins[pins.length - 1] ? [pins[0]] : [pins[0], pins[pins.length - 1]];
  return (
    <>
      {caps.map(pin => {
        const [sx, sy] = toSvg(...PIN_COORDINATES[pin]);
        return <circle key={`cap-${pin}`} cx={sx} cy={sy} r={NOODLE_WIDTH / 2 + 1} fill={color} opacity="0.9" />;
      })}
    </>
  );
}

export function BoardSvg({ mappings, hintPlacement }: BoardSvgProps) {
  const placedPieces = useMemo(() => {
    const pieces: Array<{
      pieceIndex: number; label: string; color: string;
      rgb: [number, number, number]; pins: number[]; path: string;
    }> = [];

    for (const m of mappings) {
      if (!m.placement) continue;
      const idx = m.placement.pieceIndex;
      const label = PIECE_LABELS[idx];
      const { rgb } = PIECE_COLORS[label];
      const { pins, segmentTypes } = getPlacementPinData(m.placement);
      const path = generateNoodlePath(pins, segmentTypes);
      if (path) {
        pieces.push({
          pieceIndex: idx, label,
          color: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
          rgb, pins, path,
        });
      }
    }
    return pieces;
  }, [mappings]);

  const hintPiece = useMemo(() => {
    if (!hintPlacement) return null;
    const idx = hintPlacement.pieceIndex;
    const label = PIECE_LABELS[idx];
    const { rgb } = PIECE_COLORS[label];
    const { pins, segmentTypes } = getPlacementPinData(hintPlacement);
    const path = generateNoodlePath(pins, segmentTypes);
    return { pieceIndex: idx, label, color: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`, rgb, pins, path };
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

        {/* Grid lines between adjacent pins */}
        {Array.from({ length: NUM_PINS }).map((_, pin) => {
          const [px, py] = PIN_COORDINATES[pin];
          const [sx, sy] = toSvg(px, py);
          return Array.from({ length: NUM_PINS }).map((_, other) => {
            if (other <= pin) return null;
            const [ox, oy] = PIN_COORDINATES[other];
            const dist = Math.sqrt((px - ox) ** 2 + (py - oy) ** 2);
            if (dist > 0.1 && dist < 4.0) {
              const [ex, ey] = toSvg(ox, oy);
              return <line key={`g-${pin}-${other}`} x1={sx} y1={sy} x2={ex} y2={ey} stroke="rgba(255,255,255,0.04)" strokeWidth="1" />;
            }
            return null;
          });
        })}

        {/* Placed pieces */}
        {placedPieces.map(p => (
          <g key={`piece-${p.pieceIndex}`}>
            <path d={p.path} fill="none" stroke="rgba(0,0,0,0.4)" strokeWidth={NOODLE_WIDTH + 4} strokeLinecap="round" strokeLinejoin="round" />
            <path d={p.path} fill="none" stroke={p.color} strokeWidth={NOODLE_WIDTH} strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
            <path d={p.path} fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth={NOODLE_WIDTH - 4} strokeLinecap="round" strokeLinejoin="round" />
            <NoodleEndCaps pins={p.pins} color={p.color} />
          </g>
        ))}

        {/* Hint piece */}
        {hintPiece && (
          <g>
            <path d={hintPiece.path} fill="none" stroke={hintPiece.color}
              strokeWidth={NOODLE_WIDTH} strokeLinecap="round" strokeLinejoin="round"
              opacity="0.4" strokeDasharray="6 6">
              <animate attributeName="stroke-dashoffset" from="0" to="12" dur="0.8s" repeatCount="indefinite" />
            </path>
            {hintPiece.pins.map(pin => {
              const [sx, sy] = toSvg(...PIN_COORDINATES[pin]);
              return (
                <g key={`hint-${pin}`}>
                  <circle cx={sx} cy={sy} r={PIN_RADIUS + 4}
                    fill={`rgba(${hintPiece.rgb[0]},${hintPiece.rgb[1]},${hintPiece.rgb[2]},0.3)`}
                    stroke={hintPiece.color} strokeWidth="1.5">
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
              <circle cx={sx} cy={sy} r={occ ? PIN_RADIUS + 1 : PIN_RADIUS}
                fill={occ ? occ.color : 'rgba(255,255,255,0.1)'}
                stroke={occ ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.15)'}
                strokeWidth={occ ? 1.5 : 1} className="board-pin" />
              {occ && (
                <text x={sx} y={sy + 1} textAnchor="middle" dominantBaseline="middle"
                  fill="white" fontSize="8" fontWeight="700" fontFamily="Inter, sans-serif" pointerEvents="none">
                  {PIECE_LABELS[occ.pieceIndex]}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
