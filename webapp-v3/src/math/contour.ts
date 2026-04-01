/**
 * Contour extraction and convex hull utilities for auto-calibration.
 */

/** Extract boundary pixels from a binary mask (alpha > threshold) */
export function extractContour(mask: ImageData, threshold = 128): [number, number][] {
  const { width, height, data } = mask;
  const points: [number, number][] = [];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha <= threshold) continue;

      // Check if this is a boundary pixel (has a neighbor below threshold)
      const top    = data[((y - 1) * width + x) * 4 + 3];
      const bottom = data[((y + 1) * width + x) * 4 + 3];
      const left   = data[(y * width + (x - 1)) * 4 + 3];
      const right  = data[(y * width + (x + 1)) * 4 + 3];

      if (top <= threshold || bottom <= threshold || left <= threshold || right <= threshold) {
        points.push([x, y]);
      }
    }
  }

  return points;
}

/** Convex hull using monotone chain (Andrew's algorithm) */
export function convexHull(points: [number, number][]): [number, number][] {
  if (points.length < 3) return [...points];

  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  const cross = (o: [number, number], a: [number, number], b: [number, number]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  // Lower hull
  const lower: [number, number][] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }

  // Upper hull
  const upper: [number, number][] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }

  // Remove last point of each half (duplicate of the other half's first)
  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

/**
 * Find 4 corners of the convex hull that best approximate a quadrilateral.
 * Strategy: find hull points closest to the bounding box corners.
 */
export function simplifyToQuad(hull: [number, number][]): [number, number][] | null {
  if (hull.length < 4) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of hull) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  const targets: [number, number][] = [
    [minX, minY], // top-left
    [maxX, minY], // top-right
    [maxX, maxY], // bottom-right
    [minX, maxY], // bottom-left
  ];

  const corners: [number, number][] = [];
  const used = new Set<number>();

  for (const target of targets) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < hull.length; i++) {
      if (used.has(i)) continue;
      const dx = hull[i][0] - target[0];
      const dy = hull[i][1] - target[1];
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx === -1) return null;
    used.add(bestIdx);
    corners.push(hull[bestIdx]);
  }

  return corners;
}
