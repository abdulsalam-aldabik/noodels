import { useMemo } from "react";

import { BoardCoordinator, getPinCenter } from "../board/BoardCoordinator";
import { BOARD_HEIGHT, BOARD_WIDTH, POSITIONS_AROUND_PINS } from "../engine/constants";

/**
 * Translucent ghost of the IQ Noodles board that the user lines up with the
 * physical puzzle in the live camera preview. The hinge bar sits above the
 * body so the orientation ("hinge up") is enforced visually.
 *
 * The body is drawn at 100x100 user units inside the SVG; the hinge sits in
 * negative Y so it reads as "on top" regardless of how the SVG is scaled.
 * The whole thing is rendered inside a squared-up container so the phone user
 * sees a shape that matches the real board's footprint + hinge.
 */
export default function BoardGhostOverlay() {
  const pinPoints = useMemo(() => {
    const coord = new BoardCoordinator(BOARD_WIDTH, BOARD_HEIGHT);
    const scale = 100 / coord.boardSize;
    return POSITIONS_AROUND_PINS.map((positions, pinIndex) => {
      const [row, col] = getPinCenter(positions, coord);
      const pt = coord.rowColToBoardPoint(row, col);
      return { pinIndex, x: pt.x * scale, y: pt.y * scale };
    });
  }, []);

  // viewBox: body 0..100 in X and Y. Hinge sits above (negative Y) so the
  // overlay always displays hinge-on-top in portrait phone orientation.
  const viewBox = "-4 -18 108 122";

  return (
    <svg
      className="ghost-overlay-svg"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {/* Hinge bar */}
      <rect
        className="ghost-hinge ghost-stroke-dark"
        x={6}
        y={-14}
        width={88}
        height={10}
        rx={3}
      />
      <rect
        className="ghost-hinge ghost-stroke-bright"
        x={6}
        y={-14}
        width={88}
        height={10}
        rx={3}
      />
      {/* Two short vertical marks where the hinge meets the body */}
      <line className="ghost-stroke-bright" x1={12} y1={-4} x2={12} y2={2} />
      <line className="ghost-stroke-bright" x1={88} y1={-4} x2={88} y2={2} />

      {/* Board body */}
      <rect
        className="ghost-body ghost-stroke-dark"
        x={0}
        y={0}
        width={100}
        height={100}
        rx={9}
      />
      <rect
        className="ghost-body ghost-stroke-bright"
        x={0}
        y={0}
        width={100}
        height={100}
        rx={9}
      />

      {/* Pin dots — faint, for texture alignment */}
      {pinPoints.map((p) => (
        <circle
          key={p.pinIndex}
          className="ghost-pin"
          cx={p.x}
          cy={p.y}
          r={1.6}
        />
      ))}

      {/* "Hinge up" chevron inside the hinge bar */}
      <polyline
        className="ghost-stroke-bright"
        fill="none"
        points="46,-11 50,-7 54,-11"
      />
    </svg>
  );
}
