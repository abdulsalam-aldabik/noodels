/**
 * Generate SVG paths for noodle pieces.
 *
 * Uses segment types to decide: CURVE -> bezier arc, CROSS -> straight line.
 */

import { PIN_COORDINATES, POSITION_TO_PIN } from '../board/board';
import { CURVE } from '../types';
import type { Placement } from '../types';

const SVG_SIZE = 440;
const CENTER = SVG_SIZE / 2;
const SCALE = 26;

export { SVG_SIZE, CENTER, SCALE };

export function toSvg(bx: number, by: number): [number, number] {
  return [CENTER + bx * SCALE, CENTER + by * SCALE];
}

/** Get ordered pin sequence and corresponding segment types for a placement */
export function getPlacementPinData(placement: Placement): {
  pins: number[];
  segmentTypes: number[];
} {
  const pins: number[] = [];
  const segmentTypes: number[] = [];
  const seen = new Set<number>();

  // positions come in pairs (2 cells per segment/pin)
  // Walk through and collect unique pins in order
  for (let i = 0; i < placement.positions.length; i++) {
    const pin = POSITION_TO_PIN[placement.positions[i]];
    if (pin >= 0 && !seen.has(pin)) {
      seen.add(pin);
      pins.push(pin);
      // The segment type for this pin is at the corresponding shape index
      // shapes array has one entry per grid cell position, but segment types
      // repeat for each pair of cells belonging to the same pin.
      // Take the first occurrence.
      segmentTypes.push(placement.shapes[i]);
    }
  }

  return { pins, segmentTypes };
}

/**
 * Generate an SVG path for a noodle piece.
 * CURVE segments get bezier curves; CROSS segments get straight lines.
 */
export function generateNoodlePath(pins: number[], segmentTypes: number[]): string {
  if (pins.length < 2) return '';

  const points = pins.map(pin => {
    const [bx, by] = PIN_COORDINATES[pin];
    return toSvg(bx, by);
  });

  let d = `M ${points[0][0]} ${points[0][1]}`;

  if (points.length === 2) {
    d += ` L ${points[1][0]} ${points[1][1]}`;
    return d;
  }

  for (let i = 1; i < points.length - 1; i++) {
    const [cx, cy] = points[i];
    const [nx, ny] = points[i + 1];

    if (segmentTypes[i] === CURVE) {
      // Quadratic bezier: control at pin center, end at midpoint to next
      const mx = (cx + nx) / 2;
      const my = (cy + ny) / 2;
      d += ` Q ${cx} ${cy} ${mx} ${my}`;
    } else {
      // CROSS_NS or CROSS_EW: straight through pin, then toward next
      d += ` L ${cx} ${cy}`;
    }
  }

  // Final segment to last point
  const last = points[points.length - 1];
  const prev = points[points.length - 2];

  if (segmentTypes[points.length - 1] === CURVE) {
    d += ` Q ${prev[0]} ${prev[1]} ${last[0]} ${last[1]}`;
  } else {
    d += ` L ${last[0]} ${last[1]}`;
  }

  return d;
}
