import { useMemo } from 'react';
import {
  PIN_COORDINATES,
  NUM_PINS,
  POSITION_TO_PIN,
} from '../board';
import type { BoardState } from '../board';
import { PIECE_LABELS, PIECE_COLORS, SOLVER_TO_YOLO_INDEX } from '../constants';
import type { Placement } from '../board';
import type { PieceMapping } from '../board/gridMapper';

interface BoardViewProps {
  boardState: BoardState;
  mappings: PieceMapping[];
  hintPlacement?: Placement | null;
}

// SVG coordinate space
const SVG_SIZE = 440;
const CENTER = SVG_SIZE / 2;
const SCALE = 26;
const PIN_RADIUS = 6;
const NOODLE_WIDTH = 18;

/**
 * Convert board coordinates to SVG coordinates.
 */
function toSvg(bx: number, by: number): [number, number] {
  return [CENTER + bx * SCALE, CENTER + by * SCALE];
}

/**
 * Get the ordered pin sequence for a placement.
 */
function getOrderedPins(placement: Placement): number[] {
  const seen = new Set<number>();
  const ordered: number[] = [];
  for (const pos of placement.positions) {
    const pin = POSITION_TO_PIN[pos];
    if (pin >= 0 && !seen.has(pin)) {
      seen.add(pin);
      ordered.push(pin);
    }
  }
  return ordered;
}

/**
 * Generate a smooth noodle SVG path through a sequence of pins.
 * Uses quadratic bezier curves for smooth, rounded noodle-like paths.
 */
function generateNoodlePath(pinSequence: number[]): string {
  if (pinSequence.length < 2) return '';

  const points = pinSequence.map(pin => {
    const [bx, by] = PIN_COORDINATES[pin];
    return toSvg(bx, by);
  });

  let d = `M ${points[0][0]} ${points[0][1]}`;

  if (points.length === 2) {
    d += ` L ${points[1][0]} ${points[1][1]}`;
  } else {
    for (let i = 1; i < points.length - 1; i++) {
      const [cx, cy] = points[i];
      const [nx, ny] = points[i + 1];
      const midX = (cx + nx) / 2;
      const midY = (cy + ny) / 2;
      d += ` Q ${cx} ${cy} ${midX} ${midY}`;
    }
    const last = points[points.length - 1];
    const prev = points[points.length - 2];
    d += ` Q ${prev[0]} ${prev[1]} ${last[0]} ${last[1]}`;
  }

  return d;
}

export function BoardView({ mappings, hintPlacement }: BoardViewProps) {
  // Build piece placement data from mappings
  const placedPieces = useMemo(() => {
    const pieces: Array<{
      pieceIndex: number;
      label: string;
      color: string;
      rgb: [number, number, number];
      pinSequence: number[];
      path: string;
    }> = [];

    for (const mapping of mappings) {
      if (!mapping.placement) continue;
      const pieceIndex = mapping.placement.pieceIndex;

      // Use the YOLO detection color (the physical piece color)
      const detRgb = mapping.detection.rgb;
      const rgb: [number, number, number] = detRgb
        ? [detRgb[0], detRgb[1], detRgb[2]]
        : PIECE_COLORS[PIECE_LABELS[pieceIndex]]?.rgb ?? [128, 128, 128];
      const label = mapping.detection.label;

      const pinSequence = getOrderedPins(mapping.placement);
      const path = generateNoodlePath(pinSequence);

      if (path) {
        pieces.push({
          pieceIndex,
          label,
          color: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
          rgb,
          pinSequence,
          path,
        });
      }
    }

    return pieces;
  }, [mappings]);

  // Hint piece — use reverse mapping to get YOLO color for solver piece index
  const hintPiece = useMemo(() => {
    if (!hintPlacement) return null;
    const pieceIndex = hintPlacement.pieceIndex;
    const yoloIdx = SOLVER_TO_YOLO_INDEX[pieceIndex];
    const label = PIECE_LABELS[yoloIdx] ?? PIECE_LABELS[pieceIndex];
    const { rgb } = PIECE_COLORS[label];
    const pinSequence = getOrderedPins(hintPlacement);
    const path = generateNoodlePath(pinSequence);
    return {
      pieceIndex,
      label,
      color: `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`,
      rgb,
      pinSequence,
      path,
    };
  }, [hintPlacement]);

  // Occupied pins (for highlighting)
  const occupiedPins = useMemo(() => {
    const map = new Map<number, { pieceIndex: number; color: string; label: string }>();
    for (const piece of placedPieces) {
      for (const pin of piece.pinSequence) {
        map.set(pin, { pieceIndex: piece.pieceIndex, color: piece.color, label: piece.label });
      }
    }
    return map;
  }, [placedPieces]);


  return (
    <div className="board-view" id="board-view">
      <svg
        viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        className="board-svg"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Definitions */}
        <defs>
          {/* Glossy gradient for noodle highlights */}
          <linearGradient id="noodle-gloss" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="white" stopOpacity="0.35" />
            <stop offset="40%" stopColor="white" stopOpacity="0.08" />
            <stop offset="100%" stopColor="black" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Background */}
        <rect x="0" y="0" width={SVG_SIZE} height={SVG_SIZE} fill="#1a1a2e" rx="12" />

        {/* Board outline (square) */}
        <rect
          x={toSvg(-7.9, -7.9)[0]}
          y={toSvg(-7.9, -7.9)[1]}
          width={15.8 * SCALE}
          height={15.8 * SCALE}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth="2"
          rx="4"
        />

        {/* Subtle grid lines between adjacent pins */}
        {Array.from({ length: NUM_PINS }).map((_, pin) => {
          const [px, py] = PIN_COORDINATES[pin];
          const [sx, sy] = toSvg(px, py);
          return Array.from({ length: NUM_PINS }).map((_, other) => {
            if (other <= pin) return null;
            const [ox, oy] = PIN_COORDINATES[other];
            const dx = Math.abs(px - ox);
            const dy = Math.abs(py - oy);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > 0.1 && dist < 4.0) {
              const [ex, ey] = toSvg(ox, oy);
              return (
                <line
                  key={`grid-${pin}-${other}`}
                  x1={sx} y1={sy} x2={ex} y2={ey}
                  stroke="rgba(255,255,255,0.04)"
                  strokeWidth="1"
                />
              );
            }
            return null;
          });
        })}

        {/* Placed piece noodle paths — thick rounded curves like physical pieces */}
        {placedPieces.map((piece) => {
          // Compute darker and lighter variants for depth effect
          const darkerColor = `rgb(${Math.max(0, piece.rgb[0] - 40)},${Math.max(0, piece.rgb[1] - 40)},${Math.max(0, piece.rgb[2] - 40)})`;

          return (
            <g key={`piece-${piece.pieceIndex}`}>
              {/* Drop shadow */}
              <path
                d={piece.path}
                fill="none"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={NOODLE_WIDTH + 6}
                strokeLinecap="round"
                strokeLinejoin="round"
                transform="translate(1.5, 2.5)"
              />
              {/* Dark outer edge — simulates the groove/border of the piece */}
              <path
                d={piece.path}
                fill="none"
                stroke={darkerColor}
                strokeWidth={NOODLE_WIDTH + 3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Main noodle body — the actual piece color */}
              <path
                d={piece.path}
                fill="none"
                stroke={piece.color}
                strokeWidth={NOODLE_WIDTH}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Glossy highlight — simulates the rounded, shiny surface */}
              <path
                d={piece.path}
                fill="none"
                stroke="rgba(255,255,255,0.22)"
                strokeWidth={NOODLE_WIDTH - 6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Bright center highlight — the specular reflection line */}
              <path
                d={piece.path}
                fill="none"
                stroke="rgba(255,255,255,0.12)"
                strokeWidth={Math.max(2, NOODLE_WIDTH - 12)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {/* Round end-caps at start and end of the noodle */}
              {[piece.pinSequence[0], piece.pinSequence[piece.pinSequence.length - 1]].map((pin, i) => {
                const [bx, by] = PIN_COORDINATES[pin];
                const [sx, sy] = toSvg(bx, by);
                return (
                  <g key={`cap-${piece.pieceIndex}-${i}`}>
                    {/* Outer cap */}
                    <circle
                      cx={sx} cy={sy}
                      r={(NOODLE_WIDTH + 3) / 2}
                      fill={darkerColor}
                    />
                    {/* Inner cap matching body */}
                    <circle
                      cx={sx} cy={sy}
                      r={NOODLE_WIDTH / 2}
                      fill={piece.color}
                    />
                    {/* Highlight cap */}
                    <circle
                      cx={sx} cy={sy}
                      r={(NOODLE_WIDTH - 6) / 2}
                      fill="rgba(255,255,255,0.18)"
                    />
                  </g>
                );
              })}
              {/* Piece label at the center of the noodle */}
              {(() => {
                const mid = Math.floor(piece.pinSequence.length / 2);
                const pin = piece.pinSequence[mid];
                const [bx, by] = PIN_COORDINATES[pin];
                const [sx, sy] = toSvg(bx, by);
                return (
                  <text
                    x={sx} y={sy + 1}
                    textAnchor="middle" dominantBaseline="middle"
                    fill="white" fontSize="9" fontWeight="800"
                    fontFamily="Inter, sans-serif" pointerEvents="none"
                    stroke="rgba(0,0,0,0.6)" strokeWidth="2.5" paintOrder="stroke"
                  >
                    {piece.label}
                  </text>
                );
              })()}
            </g>
          );
        })}

        {/* Hint noodle path (dashed, animated) */}
        {hintPiece && (
          <g>
            <path
              d={hintPiece.path}
              fill="none"
              stroke={hintPiece.color}
              strokeWidth={NOODLE_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.4"
              strokeDasharray="8 6"
            >
              <animate
                attributeName="stroke-dashoffset"
                from="0" to="14"
                dur="0.8s"
                repeatCount="indefinite"
              />
            </path>
            {/* Hint pin labels */}
            {hintPiece.pinSequence.map(pin => {
              const [bx, by] = PIN_COORDINATES[pin];
              const [sx, sy] = toSvg(bx, by);
              return (
                <g key={`hint-pin-${pin}`}>
                  <circle
                    cx={sx} cy={sy} r={PIN_RADIUS + 4}
                    fill={`rgba(${hintPiece.rgb[0]},${hintPiece.rgb[1]},${hintPiece.rgb[2]},0.3)`}
                    stroke={hintPiece.color}
                    strokeWidth="1.5"
                  >
                    <animate
                      attributeName="r"
                      values={`${PIN_RADIUS + 4};${PIN_RADIUS + 7};${PIN_RADIUS + 4}`}
                      dur="1.2s" repeatCount="indefinite"
                    />
                  </circle>
                  <text
                    x={sx} y={sy + 1}
                    textAnchor="middle" dominantBaseline="middle"
                    fill="rgba(255,255,255,0.8)"
                    fontSize="9" fontWeight="600" fontFamily="Inter, sans-serif"
                    pointerEvents="none"
                  >
                    {hintPiece.label}?
                  </text>
                </g>
              );
            })}
          </g>
        )}

        {/* Pins (drawn on top) */}
        {PIN_COORDINATES.map(([bx, by], pin) => {
          const [sx, sy] = toSvg(bx, by);
          const occupied = occupiedPins.get(pin);

          return (
            <g key={`pin-${pin}`}>
              <circle
                cx={sx} cy={sy}
                r={occupied ? 4 : PIN_RADIUS}
                fill={occupied ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.1)'}
                stroke={occupied ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.15)'}
                strokeWidth={1}
                className="board-pin"
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
