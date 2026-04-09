import { BOARD_WIDTH, BOARD_HEIGHT, MISSING_POSITIONS } from "../engine/constants";
import { CLASS_BOARD, CLASS_HINGE } from "../inference/inferenceTypes";
import type { RawDetection } from "../inference/inferenceTypes";
import { computeHomography, orderCorners, applyHomography } from "./HomographyComputer";
import { computeConvexHull } from "../inference/postprocessing";
import { refineBoardCorners } from "./OpenCVProcessor";
import type { CalibratedBoardRef, HingeEdge } from "./visionTypes";

// Lower than before — board mask may have moderate confidence in real photos.
// OpenCV fallback further reduces dependency on this gate.
const BOARD_CONFIDENCE_THRESHOLD = 0.25;
const MIN_BOARD_AREA_RATIO = 0.03;

type CandidateCornerSource =
  | "cv_contour"
  | "cv_refine"
  | "cv_yolo_fused"
  | "mask_quadrants"
  | "mask_hull"
  | "bbox";

export type BoardLocateFailureCode =
  | "board_class_missing"
  | "board_confidence_low"
  | "board_polygon_invalid"
  | "corner_order_failed"
  | "homography_failed";

export interface BoardLocateDiagnostics {
  failureCode: BoardLocateFailureCode | null;
  failureDetail: string | null;
  cornerSource: CandidateCornerSource | null;
  boardConfidence: number;
  candidatesTried: CandidateCornerSource[];
}

const BOARD_DST_CORNERS: [[number, number], [number, number], [number, number], [number, number]] = [
  [0, 0],
  [BOARD_WIDTH - 1, 0],
  [BOARD_WIDTH - 1, BOARD_HEIGHT - 1],
  [0, BOARD_HEIGHT - 1],
];

const MISSING_SET = new Set<number>(MISSING_POSITIONS);
const VALID_CELLS: [number, number][] = (() => {
  const cells: [number, number][] = [];
  for (let pos = 0; pos < BOARD_WIDTH * BOARD_HEIGHT; pos += 1) {
    if (!MISSING_SET.has(pos)) {
      cells.push([Math.floor(pos / BOARD_WIDTH), pos % BOARD_WIDTH]);
    }
  }
  return cells;
})();

export interface BoardHypothesis {
  rotationDeg: 0 | 90 | 180 | 270;
  boardRef: CalibratedBoardRef;
  score: number;
  landingCount: number;
  collisionCount: number;
  meanLandingConfidence: number;
}

interface CornerCandidate {
  source: CandidateCornerSource;
  points: [number, number][];
}

function samplePoints(points: [number, number][], max = 120): [number, number][] {
  if (points.length <= max) return points;
  const step = Math.ceil(points.length / max);
  const sampled: [number, number][] = [];
  for (let i = 0; i < points.length; i += step) sampled.push(points[i]);
  return sampled;
}

function boundaryDistance(x: number, y: number): number {
  const dx0 = Math.abs(x);
  const dx1 = Math.abs((BOARD_WIDTH - 1) - x);
  const dy0 = Math.abs(y);
  const dy1 = Math.abs((BOARD_HEIGHT - 1) - y);
  return Math.min(dx0, dx1, dy0, dy1);
}

function scoreBoardFit(H: number[][], boundary: [number, number][]): number {
  if (boundary.length === 0) return -Infinity;

  let inside = 0;
  let finite = 0;
  let edgeDistanceSum = 0;
  const transformed: [number, number][] = [];

  for (const [px, py] of boundary) {
    const [x, y] = applyHomography(H, px, py);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    finite += 1;
    transformed.push([x, y]);
    if (x >= -1 && x <= BOARD_WIDTH && y >= -1 && y <= BOARD_HEIGHT) {
      inside += 1;
    }
    edgeDistanceSum += Math.min(10, boundaryDistance(x, y));
  }

  if (finite === 0) return -Infinity;

  const insideRatio = inside / finite;
  const meanEdgeDistance = edgeDistanceSum / finite;

  const mappedArea = Math.max(1, polygonArea(transformed));
  const targetArea = (BOARD_WIDTH - 1) * (BOARD_HEIGHT - 1);
  const areaError = Math.abs(mappedArea - targetArea) / targetArea;
  const areaScore = Math.max(0, 1 - Math.min(1, areaError));

  return insideRatio * 2.4 + areaScore * 0.9 - meanEdgeDistance * 0.18;
}

function extractQuadrantCorners(points: [number, number][]): [number, number][] | null {
  if (points.length < 4) return null;

  const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;

  const quadrant: Array<[number, number] | null> = [null, null, null, null];
  const qDist = [-1, -1, -1, -1];

  for (const p of points) {
    const dx = p[0] - cx;
    const dy = p[1] - cy;

    let q = 0;
    if (dx >= 0 && dy < 0) q = 1;
    else if (dx >= 0 && dy >= 0) q = 2;
    else if (dx < 0 && dy >= 0) q = 3;

    const d2 = dx * dx + dy * dy;
    if (d2 > qDist[q]) {
      qDist[q] = d2;
      quadrant[q] = p;
    }
  }

  if (quadrant.every((p) => p !== null)) {
    return quadrant as [number, number][];
  }

  return null;
}

function fuseCornerSets(a: [number, number][], b: [number, number][]): [number, number][] | null {
  if (a.length < 4 || b.length < 4) return null;

  try {
    const oa = orderCorners(a);
    const ob = orderCorners(b);

    return [
      [(oa[0][0] + ob[0][0]) / 2, (oa[0][1] + ob[0][1]) / 2],
      [(oa[1][0] + ob[1][0]) / 2, (oa[1][1] + ob[1][1]) / 2],
      [(oa[2][0] + ob[2][0]) / 2, (oa[2][1] + ob[2][1]) / 2],
      [(oa[3][0] + ob[3][0]) / 2, (oa[3][1] + ob[3][1]) / 2],
    ];
  } catch {
    return null;
  }
}

function polygonArea(points: [number, number][]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function cellKey(row: number, col: number): number {
  return row * BOARD_WIDTH + col;
}

function euclidean(r1: number, c1: number, r2: number, c2: number): number {
  const dr = r1 - r2;
  const dc = c1 - c2;
  return Math.sqrt(dr * dr + dc * dc);
}

function rotateCornersBySteps(
  corners: [[number, number], [number, number], [number, number], [number, number]],
  rotationSteps: 0 | 1 | 2 | 3,
): [[number, number], [number, number], [number, number], [number, number]] {
  const [tl, tr, br, bl] = corners;
  switch (rotationSteps) {
    case 0: return [tl, tr, br, bl];
    case 1: return [bl, tl, tr, br];
    case 2: return [br, bl, tl, tr];
    case 3: return [tr, br, bl, tl];
  }
}

function rotateBoardRefBySteps(
  boardRef: CalibratedBoardRef,
  rotationSteps: 0 | 1 | 2 | 3,
): CalibratedBoardRef | null {
  const rotatedCorners = rotateCornersBySteps(boardRef.boardCorners, rotationSteps);
  try {
    const H = computeHomography(rotatedCorners, BOARD_DST_CORNERS);
    if (!isFiniteHomography(H)) return null;

    return {
      ...boardRef,
      boardCorners: rotatedCorners,
      homographyMatrix: H,
    };
  } catch {
    return null;
  }
}

function expectedRotationFromHinge(edge: HingeEdge): 0 | 1 | 2 | 3 {
  switch (edge) {
    case "top": return 0;
    case "left": return 1;
    case "bottom": return 2;
    case "right": return 3;
  }
}

function nearestValidCell(boardCol: number, boardRow: number): { row: number; col: number; dist: number } {
  let bestRow = 0;
  let bestCol = 0;
  let bestDist = Infinity;

  for (const [row, col] of VALID_CELLS) {
    const d = euclidean(boardRow, boardCol, row, col);
    if (d < bestDist) {
      bestDist = d;
      bestRow = row;
      bestCol = col;
    }
  }

  return { row: bestRow, col: bestCol, dist: bestDist };
}

function scoreOneBoardHypothesis(
  boardRef: CalibratedBoardRef,
  detections: RawDetection[],
  rotationSteps: 0 | 1 | 2 | 3,
): BoardHypothesis | null {
  const rotated = rotateBoardRefBySteps(boardRef, rotationSteps);
  if (!rotated) return null;

  const pieceDets = detections.filter((d) => d.classId >= 0 && d.classId <= 10);
  const total = pieceDets.length;

  if (total === 0) {
    return {
      rotationDeg: (rotationSteps * 90) as 0 | 90 | 180 | 270,
      boardRef: rotated,
      score: 0,
      landingCount: 0,
      collisionCount: 0,
      meanLandingConfidence: 0,
    };
  }

  let landingCount = 0;
  let confidenceSum = 0;
  let collisionCount = 0;
  const cellCounts = new Map<number, number>();

  for (const det of pieceDets) {
    const [imgCx, imgCy] = det.maskCentroid;
    const [boardCol, boardRow] = applyHomography(rotated.homographyMatrix, imgCx, imgCy);

    if (
      boardCol < -0.5
      || boardCol > BOARD_WIDTH - 0.5
      || boardRow < -0.5
      || boardRow > BOARD_HEIGHT - 0.5
    ) {
      continue;
    }

    const nearest = nearestValidCell(boardCol, boardRow);
    if (nearest.dist > 1.0) continue;

    landingCount += 1;
    confidenceSum += det.confidence;

    const key = cellKey(nearest.row, nearest.col);
    const nextCount = (cellCounts.get(key) ?? 0) + 1;
    cellCounts.set(key, nextCount);
    if (nextCount > 1) collisionCount += 1;
  }

  const meanConf = landingCount > 0 ? confidenceSum / landingCount : 0;
  let score =
    0.5 * (landingCount / total)
    + 0.3 * meanConf
    - 0.2 * (collisionCount / total);

  if (boardRef.hingeConfidence >= 0.55) {
    const expected = expectedRotationFromHinge(boardRef.hingeEdge);
    const hingeBonus = boardRef.hingeConfidence * 0.1;
    score += rotationSteps === expected ? hingeBonus : -hingeBonus * 0.35;
  }

  return {
    rotationDeg: (rotationSteps * 90) as 0 | 90 | 180 | 270,
    boardRef: rotated,
    score,
    landingCount,
    collisionCount,
    meanLandingConfidence: meanConf,
  };
}

export function scoreBoardHypotheses(
  boardRef: CalibratedBoardRef,
  detections: RawDetection[],
): BoardHypothesis[] {
  const hypotheses: BoardHypothesis[] = [];
  for (const steps of [0, 1, 2, 3] as const) {
    const hypothesis = scoreOneBoardHypothesis(boardRef, detections, steps);
    if (hypothesis) hypotheses.push(hypothesis);
  }
  return hypotheses.sort((a, b) => b.score - a.score);
}

export function pickBestBoardHypothesis(
  boardRef: CalibratedBoardRef,
  detections: RawDetection[],
): BoardHypothesis | null {
  const hypotheses = scoreBoardHypotheses(boardRef, detections);
  return hypotheses.length > 0 ? hypotheses[0] : null;
}

function isFiniteHomography(H: number[][]): boolean {
  return H.every((row) => row.every((value) => Number.isFinite(value)));
}

function setFailure(
  diagnostics: BoardLocateDiagnostics | undefined,
  failureCode: BoardLocateFailureCode,
  failureDetail: string,
): void {
  if (!diagnostics) return;
  diagnostics.failureCode = failureCode;
  diagnostics.failureDetail = failureDetail;
}

export function locateBoard(
  detections: RawDetection[],
  imageW = 0,
  imageH = 0,
  diagnostics?: BoardLocateDiagnostics,
  cvContourCorners?: [number, number][] | null,
): CalibratedBoardRef | null {
  if (diagnostics) {
    diagnostics.failureCode = null;
    diagnostics.failureDetail = null;
    diagnostics.cornerSource = null;
    diagnostics.boardConfidence = 0;
    diagnostics.candidatesTried = [];
  }

  // ── 1. Find best board detection (class 11) ───────────────────────────────

  const boardDets = detections
    .filter((d) => d.classId === CLASS_BOARD)
    .sort((a, b) => b.confidence - a.confidence);

  const boardDet = boardDets[0];

  if (!boardDet) {
    setFailure(diagnostics, "board_class_missing", "No class-11 board detection was available after postprocessing.");
    return null;
  }

  if (diagnostics) diagnostics.boardConfidence = boardDet.confidence;

  if (boardDet.confidence < BOARD_CONFIDENCE_THRESHOLD) {
    setFailure(
      diagnostics,
      "board_confidence_low",
      `Board confidence ${boardDet.confidence.toFixed(3)} is below threshold ${BOARD_CONFIDENCE_THRESHOLD.toFixed(3)}.`,
    );
    return null;
  }

  // ── 2. Build corner candidates from multiple sources ──────────────────────

  const rawPolygon = boardDet.maskPolygon.length >= 4
    ? computeConvexHull(boardDet.maskPolygon)
    : boardDet.maskPolygon;

  const [x1, y1, x2, y2] = boardDet.bbox;
  const bboxPolygon: [number, number][] = [
    [x1, y1],
    [x2, y1],
    [x2, y2],
    [x1, y2],
  ];

  const basePolygon = rawPolygon.length >= 4 ? rawPolygon : bboxPolygon;
  const cvCorners = imageW > 0 && imageH > 0
    ? refineBoardCorners(basePolygon, imageW, imageH)
    : null;
  const maskQuad = rawPolygon.length >= 4 ? extractQuadrantCorners(rawPolygon) : null;
  const fusedCvYolo = cvContourCorners && maskQuad
    ? fuseCornerSets(cvContourCorners, maskQuad)
    : null;

  const minBoardArea = imageW > 0 && imageH > 0
    ? imageW * imageH * MIN_BOARD_AREA_RATIO
    : 0;

  const candidates: CornerCandidate[] = [];
  const addCandidate = (source: CandidateCornerSource, points: [number, number][]): void => {
    if (points.length < 4) return;
    const area = polygonArea(points);
    // Keep bbox as an absolute fallback even when area heuristics are poor.
    if (source !== "bbox" && minBoardArea > 0 && area < minBoardArea) return;
    candidates.push({ source, points });
  };

  if (cvContourCorners && cvContourCorners.length >= 4) addCandidate("cv_contour", cvContourCorners);
  if (cvCorners && cvCorners.length >= 4) addCandidate("cv_refine", cvCorners);
  if (fusedCvYolo && fusedCvYolo.length >= 4) addCandidate("cv_yolo_fused", fusedCvYolo);
  if (maskQuad && maskQuad.length >= 4) addCandidate("mask_quadrants", maskQuad);
  addCandidate("mask_hull", rawPolygon);
  addCandidate("bbox", bboxPolygon);

  if (candidates.length === 0) {
    setFailure(diagnostics, "board_polygon_invalid", "No valid board corner candidate had at least four points.");
    return null;
  }

  // ── 3. Resolve corners + homography with fallback chain ───────────────────

  let corners: [[number, number], [number, number], [number, number], [number, number]] | null = null;
  let H: number[][] | null = null;
  let selectedSource: CandidateCornerSource | null = null;
  let selectedPolygon: [number, number][] | null = null;
  let bestScore = -Infinity;
  let hadOrderFailure = false;
  let hadHomographyFailure = false;
  const boundarySample = samplePoints(rawPolygon.length >= 4 ? rawPolygon : bboxPolygon);

  for (const candidate of candidates) {
    diagnostics?.candidatesTried.push(candidate.source);

    let ordered: [[number, number], [number, number], [number, number], [number, number]];
    try {
      ordered = orderCorners(candidate.points);
    } catch {
      hadOrderFailure = true;
      continue;
    }

    try {
      const candidateH = computeHomography(ordered, BOARD_DST_CORNERS);
      if (!isFiniteHomography(candidateH)) {
        hadHomographyFailure = true;
        continue;
      }

      const fit = scoreBoardFit(candidateH, boundarySample);

      if (fit > bestScore) {
        bestScore = fit;
        corners = ordered;
        H = candidateH;
        selectedSource = candidate.source;
        selectedPolygon = candidate.points;
      }
    } catch {
      hadHomographyFailure = true;
    }
  }

  if (!corners || !H || !selectedSource || !selectedPolygon) {
    if (hadHomographyFailure) {
      setFailure(diagnostics, "homography_failed", "All corner candidates failed homography computation.");
    } else if (hadOrderFailure) {
      setFailure(diagnostics, "corner_order_failed", "Corner ordering failed for all board candidates.");
    } else {
      setFailure(diagnostics, "board_polygon_invalid", "No board corner candidate could be resolved.");
    }
    return null;
  }

  if (diagnostics) diagnostics.cornerSource = selectedSource;

  // ── 5. Hinge detection (as soft prior only) ───────────────────────────────

  const { hingeEdge, hingeConfidence } = interpretHinge(detections, H);

  return {
    boardPolygon: selectedPolygon,
    boardCorners: corners,
    hingeEdge,
    hingeConfidence,
    homographyMatrix: H,
    boardConfidence: boardDet.confidence,
  };
}

export function locateBoardFromCorners(cornersInput: [number, number][]): CalibratedBoardRef | null {
  if (cornersInput.length < 4) return null;

  let corners: [[number, number], [number, number], [number, number], [number, number]];
  try {
    corners = orderCorners(cornersInput);
  } catch {
    return null;
  }

  try {
    const homographyMatrix = computeHomography(corners, BOARD_DST_CORNERS);
    if (!isFiniteHomography(homographyMatrix)) return null;
    return {
      boardPolygon: cornersInput,
      boardCorners: corners,
      hingeEdge: "top",
      hingeConfidence: 0,
      homographyMatrix,
      boardConfidence: 0.2,
    };
  } catch {
    return null;
  }
}

function interpretHinge(
  detections: RawDetection[],
  H: number[][],
): { hingeEdge: HingeEdge; hingeConfidence: number } {
  const hingeDets = detections
    .filter((d) => d.classId === CLASS_HINGE)
    .sort((a, b) => b.confidence - a.confidence);

  if (hingeDets.length === 0) return { hingeEdge: "top", hingeConfidence: 0 };

  const hinge = hingeDets[0];
  const imgCx = (hinge.bbox[0] + hinge.bbox[2]) / 2;
  const imgCy = (hinge.bbox[1] + hinge.bbox[3]) / 2;
  const [boardCol, boardRow] = applyHomography(H, imgCx, imgCy);

  const EDGE_THRESHOLD = 2;
  const distTop    = boardRow;
  const distBottom = (BOARD_HEIGHT - 1) - boardRow;
  const distLeft   = boardCol;
  const distRight  = (BOARD_WIDTH  - 1) - boardCol;
  const minDist    = Math.min(distTop, distBottom, distLeft, distRight);

  if (minDist > EDGE_THRESHOLD) return { hingeEdge: "top", hingeConfidence: 0 };

  let hingeEdge: HingeEdge;
  if (distTop === minDist)         hingeEdge = "top";
  else if (distBottom === minDist) hingeEdge = "bottom";
  else if (distLeft === minDist)   hingeEdge = "left";
  else                             hingeEdge = "right";

  const hingeConfidence = Math.min(1, hinge.confidence * (1 - minDist / EDGE_THRESHOLD));
  return { hingeEdge, hingeConfidence };
}

