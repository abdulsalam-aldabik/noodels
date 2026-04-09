import { BOARD_WIDTH, BOARD_HEIGHT } from "../engine/constants";
import { CLASS_BOARD, CLASS_HINGE } from "../inference/inferenceTypes";
import type { RawDetection } from "../inference/inferenceTypes";
import { computeHomography, orderCorners, applyHomography } from "./HomographyComputer";
import { computeConvexHull } from "../inference/postprocessing";
import type { CalibratedBoardRef, HingeEdge } from "./visionTypes";

// Confidence required to trust the board detection
const BOARD_CONFIDENCE_THRESHOLD = 0.5;

/**
 * The four destination corners in board grid space.
 * Board grid runs 0–(WIDTH-1) in X (col) and 0–(HEIGHT-1) in Y (row).
 * The order matches [TL, TR, BR, BL].
 */
const BOARD_DST_CORNERS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 0],                           // TL → (col=0, row=0)
  [BOARD_WIDTH - 1, 0],             // TR → (col=13, row=0)
  [BOARD_WIDTH - 1, BOARD_HEIGHT - 1], // BR → (col=13, row=13)
  [0, BOARD_HEIGHT - 1],            // BL → (col=0, row=13)
];

/**
 * Locates the board from YOLO detections and computes the perspective
 * homography H that maps image pixels → board grid coordinates.
 *
 * Returns null if the board detection is absent or below the confidence threshold.
 */
export function locateBoard(detections: RawDetection[]): CalibratedBoardRef | null {
  // ── 1. Find the best board detection (class 11) ───────────────────────────

  const boardDetections = detections
    .filter((d) => d.classId === CLASS_BOARD)
    .sort((a, b) => b.confidence - a.confidence);

  const boardDet = boardDetections[0];

  if (!boardDet || boardDet.confidence < BOARD_CONFIDENCE_THRESHOLD) {
    return null;
  }

  // ── 2. Extract convex hull of the board mask ──────────────────────────────

  const hull = boardDet.maskPolygon.length >= 4
    ? computeConvexHull(boardDet.maskPolygon)
    : boardDet.maskPolygon;

  if (hull.length < 4) {
    return null;
  }

  // ── 3. Order corners as [TL, TR, BR, BL] ─────────────────────────────────

  let corners: [[number, number], [number, number], [number, number], [number, number]];
  try {
    corners = orderCorners(hull);
  } catch {
    return null;
  }

  // ── 4. Compute homography ─────────────────────────────────────────────────

  let H: number[][];
  try {
    H = computeHomography(corners, BOARD_DST_CORNERS);
  } catch {
    return null;
  }

  // ── 5. Interpret hinge (class 12) ────────────────────────────────────────

  const { hingeEdge, hingeConfidence } = interpretHinge(detections, H);

  // ── 6. If hinge is NOT at top, rebuild H with rotated corner mapping ──────

  let finalH = H;
  let finalCorners = corners;

  if (hingeEdge !== "top" && hingeConfidence >= 0.5) {
    const rotated = rotateCornersForHinge(corners, hingeEdge);
    try {
      finalH = computeHomography(rotated, BOARD_DST_CORNERS);
      finalCorners = rotated;
    } catch {
      // Keep original if rotation fails
      finalH = H;
      finalCorners = corners;
    }
  }

  return {
    boardPolygon: hull,
    boardCorners: finalCorners,
    hingeEdge,
    hingeConfidence,
    homographyMatrix: finalH,
    boardConfidence: boardDet.confidence,
  };
}

// ── Hinge interpretation ──────────────────────────────────────────────────────

function interpretHinge(
  detections: RawDetection[],
  H: number[][],
): { hingeEdge: HingeEdge; hingeConfidence: number } {
  const hingeDetections = detections
    .filter((d) => d.classId === CLASS_HINGE)
    .sort((a, b) => b.confidence - a.confidence);

  if (hingeDetections.length === 0) {
    return { hingeEdge: "top", hingeConfidence: 0 };
  }

  const hinge = hingeDetections[0];

  // Map hinge bbox center to board space
  const imgCx = (hinge.bbox[0] + hinge.bbox[2]) / 2;
  const imgCy = (hinge.bbox[1] + hinge.bbox[3]) / 2;

  const [boardCol, boardRow] = applyHomography(H, imgCx, imgCy);

  // Classify which edge the hinge is near
  const EDGE_THRESHOLD = 2.0; // board-grid units from edge to be considered "on edge"

  let hingeEdge: HingeEdge = "top";
  let edgeProximity = Infinity;

  const distTop = boardRow;
  const distBottom = (BOARD_HEIGHT - 1) - boardRow;
  const distLeft = boardCol;
  const distRight = (BOARD_WIDTH - 1) - boardCol;

  const minDist = Math.min(distTop, distBottom, distLeft, distRight);
  edgeProximity = minDist;

  if (distTop === minDist) hingeEdge = "top";
  else if (distBottom === minDist) hingeEdge = "bottom";
  else if (distLeft === minDist) hingeEdge = "left";
  else hingeEdge = "right";

  // If hinge maps to board interior (too far from any edge), treat as undetected
  if (edgeProximity > EDGE_THRESHOLD) {
    return { hingeEdge: "top", hingeConfidence: 0 };
  }

  // Confidence based on how clearly near an edge vs. interior
  const hingeConfidence = Math.min(1, hinge.confidence * (1 - edgeProximity / EDGE_THRESHOLD));

  return { hingeEdge, hingeConfidence };
}

// ── Corner rotation to correct for hinge orientation ─────────────────────────

/**
 * Re-orders the [TL, TR, BR, BL] corners so that when re-mapped to BOARD_DST_CORNERS,
 * the hinge edge becomes the "top" of the board.
 *
 * The hinge is at the physical top of the board. If the photo was taken with the
 * board rotated, we rotate the corner assignment to compensate.
 */
function rotateCornersForHinge(
  corners: [[number, number], [number, number], [number, number], [number, number]],
  hingeEdge: HingeEdge,
): [[number, number], [number, number], [number, number], [number, number]] {
  const [tl, tr, br, bl] = corners;

  switch (hingeEdge) {
    case "top":
      return [tl, tr, br, bl]; // already correct
    case "bottom":
      // Board is upside down — rotate 180°
      return [br, bl, tl, tr];
    case "left":
      // Board is rotated 90° clockwise (hinge on left → top when CCW rotated)
      return [bl, tl, tr, br];
    case "right":
      // Board is rotated 90° counter-clockwise
      return [tr, br, bl, tl];
  }
}
