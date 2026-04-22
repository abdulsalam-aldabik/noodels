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
import { applyHomography } from "./Rectifier";
import type { PinEndpointAssignment } from "./types";

/** Max distance (cells) from a mask sample to count a pin as "visited". */
const VISIT_RADIUS_CELLS = 0.65;
/** Max distance (cells) from an extracted endpoint to its snapped canonical pin. */
const ENDPOINT_SNAP_RADIUS_CELLS = 0.9;

export interface SnapOptions {
  visitRadiusCells?: number;
  endpointSnapRadiusCells?: number;
  /**
   * Inverse homography (board-space → source-image pixels). When provided,
   * pin-visit detection uses a direct mask-probe at each canonical pin's
   * projected image location instead of the sparse board-sample scan. This is
   * more reliable when masks are large (high stride causes sample scan to miss
   * pin-adjacent pixels).
   */
  boardToImg?: number[];
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
  const boardToImg = options.boardToImg;

  const out: PinEndpointAssignment[] = [];
  for (let i = 0; i < detections.length; i++) {
    const d = detections[i];
    if (d.classId >= PIECE_CLASS_COUNT) continue; // only piece classes (0..10)
    const extracted = extractPieceEndpoints(d, imgToBoard);

    // Pin-probe is preferred: project each canonical pin to image space and
    // probe the mask directly. Avoids stride-based sampling gaps that cause
    // the sample-scan to miss pins when masks are large.
    const visited =
      boardToImg && d.mask
        ? findVisitedPinsByProbe(d, canonical, boardToImg)
        : findVisitedPins(extracted.boardSamples, canonical, visitRadius);

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

/**
 * Project each canonical pin's board-space position to source-image pixels
 * via the inverse homography, then probe the detection mask in an annular
 * ring around that location.
 *
 * IQ Noodles pieces thread *around* pins — the physical peg goes through a
 * hole in the piece. The mask therefore has a gap at the pin center and
 * material in a ring surrounding it. We probe the annular region
 * [PROBE_R_INNER .. PROBE_R_OUTER] mask-pixels from the projected pin center
 * and count the fraction of ring pixels that are mask=1. A pin is "visited"
 * when either:
 *   - ≥1 pixel in the full probe area (inner+outer) is mask=1 (lenient), OR
 *   - the ring coverage fraction exceeds RING_COVERAGE_THRESHOLD (strict).
 * The lenient gate is the actual filter; the coverage fraction is exported
 * for downstream scoring via {@link findVisitedPinsByProbeWithCoverage}.
 */

/** Inner radius: skip the hole at pin center (mask-pixel units). */
const PROBE_R_INNER = 2;
/** Outer radius: probe the annular ring where piece material is (mask-pixel units). */
const PROBE_R_OUTER = 8;

export interface PinVisitWithCoverage {
  pinIndex: number;
  /** Fraction of probed ring pixels that are mask=1 (0..1). */
  coverage: number;
}

function findVisitedPinsByProbe(
  detection: RawDetection,
  canonical: PinBoardPoint[],
  boardToImg: number[],
): number[] {
  return findVisitedPinsByProbeWithCoverage(detection, canonical, boardToImg)
    .map(v => v.pinIndex);
}

export function findVisitedPinsByProbeWithCoverage(
  detection: RawDetection,
  canonical: PinBoardPoint[],
  boardToImg: number[],
): PinVisitWithCoverage[] {
  const m = detection.mask!; // caller guards m != null
  const { x: bx, y: by, width: bw, height: bh } = detection.bbox;

  const hits: PinVisitWithCoverage[] = [];
  for (const cp of canonical) {
    const img = applyHomography(boardToImg, cp.x, cp.y);

    // Normalised position within this detection's bbox
    const fx = (img.x - bx) / bw;
    const fy = (img.y - by) / bh;

    // Skip pins that project outside the bbox (with small margin)
    if (fx < -0.05 || fx > 1.05 || fy < -0.05 || fy > 1.05) continue;

    const cx = fx * m.width;
    const cy = fy * m.height;

    // Probe the full area (inner + outer) for any hit, and the ring for coverage.
    const x0 = Math.max(0, Math.round(cx) - PROBE_R_OUTER);
    const x1 = Math.min(m.width - 1, Math.round(cx) + PROBE_R_OUTER);
    const y0 = Math.max(0, Math.round(cy) - PROBE_R_OUTER);
    const y1 = Math.min(m.height - 1, Math.round(cy) + PROBE_R_OUTER);

    let anyHit = false;
    let ringTotal = 0;
    let ringHits = 0;
    const r2Inner = PROBE_R_INNER * PROBE_R_INNER;
    const r2Outer = PROBE_R_OUTER * PROBE_R_OUTER;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2Outer) continue; // outside outer radius

        const isSet = m.data[y * m.width + x] !== 0;
        if (isSet) anyHit = true;

        // Count ring pixels (between inner and outer radius)
        if (d2 >= r2Inner) {
          ringTotal++;
          if (isSet) ringHits++;
        }
      }
    }

    if (anyHit) {
      const coverage = ringTotal > 0 ? ringHits / ringTotal : 0;
      hits.push({ pinIndex: cp.pinIndex, coverage });
    }
  }
  return hits;
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
