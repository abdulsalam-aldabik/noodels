/**
 * Build a PinEndpointAssignment for each piece detection.
 *
 * Given the board-space mask samples from PieceEndpointExtractor and the
 * canonical pin positions, we derive:
 *   - `visitedPins`: every canonical pin whose centre lies within
 *     VISIT_RADIUS_CELLS of any board-space mask sample. This is the tight
 *     representation consumed by PinPairIndex for legal-placement lookup.
 *   - `endpointPins`: the 2 canonical pins closest to the extracted rope
 *     endpoints (if extraction succeeded and the snap distance is within
 *     ENDPOINT_SNAP_RADIUS_CELLS).
 *
 * Both assignments are unordered and deduplicated. Endpoint snapping does not
 * reject candidates outside `visitedPins` — a piece can terminate beside a pin
 * it doesn't fully thread — but the caller should treat endpoint-only hits
 * as lower-confidence.
 */

import { computePinBoardPoints, type PinBoardPoint } from "../board/gridGeometry";
import { PIECE_CLASS_COUNT, type Point2D, type RawDetection } from "../inference/types";
import { extractPieceEndpoints } from "./PieceEndpointExtractor";
import type { PinEndpointAssignment } from "./types";

/** Max distance (cells) from a mask sample to count a pin as "visited". */
const VISIT_RADIUS_CELLS = 0.65;
/** Max distance (cells) from an extracted endpoint to its snapped canonical pin. */
const ENDPOINT_SNAP_RADIUS_CELLS = 0.9;

export interface SnapOptions {
  visitRadiusCells?: number;
  endpointSnapRadiusCells?: number;
}

/** Produce one assignment per piece-class detection in `detections`. */
export function snapPiecesToPins(
  detections: RawDetection[],
  imgToBoard: number[],
  options: SnapOptions = {},
): PinEndpointAssignment[] {
  const visitRadius = options.visitRadiusCells ?? VISIT_RADIUS_CELLS;
  const endpointRadius = options.endpointSnapRadiusCells ?? ENDPOINT_SNAP_RADIUS_CELLS;
  const canonical = computePinBoardPoints();

  const out: PinEndpointAssignment[] = [];
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    if (d.classId >= PIECE_CLASS_COUNT) continue; // only piece classes (0..10)
    const extracted = extractPieceEndpoints(d, imgToBoard);
    const visited = findVisitedPins(extracted.boardSamples, canonical, visitRadius);
    const endpointPins = extracted.endpoints
      ? snapEndpointsToPins(extracted.endpoints, canonical, endpointRadius)
      : null;

    out.push({
      classId: d.classId,
      className: d.className,
      sourceDetectionIndex: i,
      visitedPins: visited,
      endpointPins,
      endpoints: extracted.endpoints,
      pcaEigenRatio: extracted.eigenRatio,
    });
  }
  return out;
}

function findVisitedPins(
  samples: Point2D[],
  canonical: PinBoardPoint[],
  radius: number,
): number[] {
  if (samples.length === 0) return [];
  const r2 = radius * radius;
  const hits = new Set<number>();
  for (const cp of canonical) {
    for (const s of samples) {
      const dx = s.x - cp.x;
      const dy = s.y - cp.y;
      if (dx * dx + dy * dy <= r2) {
        hits.add(cp.pinIndex);
        break;
      }
    }
  }
  return [...hits].sort((a, b) => a - b);
}

function snapEndpointsToPins(
  endpoints: [Point2D, Point2D],
  canonical: PinBoardPoint[],
  radius: number,
): [number, number] | null {
  const pinA = nearestPinIndex(endpoints[0], canonical, radius);
  const pinB = nearestPinIndex(endpoints[1], canonical, radius);
  if (pinA === -1 || pinB === -1 || pinA === pinB) return null;
  return pinA < pinB ? [pinA, pinB] : [pinB, pinA];
}

function nearestPinIndex(
  point: Point2D,
  canonical: PinBoardPoint[],
  radius: number,
): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (const cp of canonical) {
    const dx = point.x - cp.x;
    const dy = point.y - cp.y;
    const d = Math.hypot(dx, dy);
    if (d < bestD) {
      bestD = d;
      best = cp.pinIndex;
    }
  }
  return bestD <= radius ? best : -1;
}
