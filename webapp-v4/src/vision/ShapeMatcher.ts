type Cell = [number, number];

const GRID_SIZE = 32;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function edgeMap(binary: Uint8Array, size: number): Uint8Array {
  const edges = new Uint8Array(binary.length);
  const idx = (r: number, c: number): number => r * size + c;

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      const i = idx(r, c);
      if (!binary[i]) continue;

      const n = r > 0 ? binary[idx(r - 1, c)] : 0;
      const s = r < size - 1 ? binary[idx(r + 1, c)] : 0;
      const w = c > 0 ? binary[idx(r, c - 1)] : 0;
      const e = c < size - 1 ? binary[idx(r, c + 1)] : 0;

      if (!(n && s && w && e)) edges[i] = 1;
    }
  }

  return edges;
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] > 0 ? 1 : 0;
    const bv = b[i] > 0 ? 1 : 0;
    inter += av & bv;
    union += av | bv;
  }
  return union === 0 ? 0 : inter / union;
}

function normalizeBounds(points: Array<[number, number]>): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    maxX = 1;
    minY = 0;
    maxY = 1;
  }

  if (Math.abs(maxX - minX) < 1e-6) maxX = minX + 1;
  if (Math.abs(maxY - minY) < 1e-6) maxY = minY + 1;

  return { minX, maxX, minY, maxY };
}

function toGrid(
  x: number,
  y: number,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  size: number,
): [number, number] {
  const gx = clamp(Math.round(((x - bounds.minX) / (bounds.maxX - bounds.minX)) * (size - 1)), 0, size - 1);
  const gy = clamp(Math.round(((y - bounds.minY) / (bounds.maxY - bounds.minY)) * (size - 1)), 0, size - 1);
  return [gx, gy];
}

/**
 * Edge IoU-like shape fit score in normalized local space.
 *
 * detectionMaskPoints: [col, row] board-space mask points.
 * footprint:           [row, col] cell footprint for a candidate placement.
 */
export function shapeFitScore(
  detectionMaskPoints: [number, number][],
  footprint: Cell[],
): number {
  if (detectionMaskPoints.length === 0 || footprint.length === 0) return 0;

  const footprintPoints = footprint.map(([row, col]) => [col, row] as [number, number]);
  const allPoints = [...detectionMaskPoints, ...footprintPoints];
  const bounds = normalizeBounds(allPoints);

  const detBinary = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (const [col, row] of detectionMaskPoints) {
    const [gx, gy] = toGrid(col, row, bounds, GRID_SIZE);
    detBinary[gy * GRID_SIZE + gx] = 1;
  }

  const tplBinary = new Uint8Array(GRID_SIZE * GRID_SIZE);
  for (const [row, col] of footprint) {
    const [gx, gy] = toGrid(col, row, bounds, GRID_SIZE);
    tplBinary[gy * GRID_SIZE + gx] = 1;
  }

  const detEdges = edgeMap(detBinary, GRID_SIZE);
  const tplEdges = edgeMap(tplBinary, GRID_SIZE);
  return iou(detEdges, tplEdges);
}
