/**
 * Offline connector extraction script.
 *
 * Run with: npx tsx src/iq-noodles-app/extractConnectors.ts
 *
 * Loads each piece OBJ file, applies axis-correction rotation (90° around X),
 * identifies the two connector endpoint bulbs, and prints the canonical
 * anchor data to paste into connectorAnchors.ts.
 *
 * DEV-ONLY — not part of the production bundle.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* ------------------------------------------------------------------ */
/*  OBJ parser — extracts vertex positions                             */
/* ------------------------------------------------------------------ */

interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function parseObjVertices(objText: string): Vec3[] {
  const vertices: Vec3[] = [];
  for (const line of objText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("v ")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    vertices.push({
      x: parseFloat(parts[1]),
      y: parseFloat(parts[2]),
      z: parseFloat(parts[3]),
    });
  }
  return vertices;
}

/* ------------------------------------------------------------------ */
/*  Axis correction: rotate 90° around X (to match Three.js scene)     */
/*  x' = x,  y' = -z,  z' = y                                        */
/* ------------------------------------------------------------------ */

function applyAxisCorrection(v: Vec3): Vec3 {
  return { x: v.x, y: -v.z, z: v.y };
}

/* ------------------------------------------------------------------ */
/*  Find the two connector endpoint clusters.                          */
/*                                                                     */
/*  Strategy:                                                          */
/*  1. Find the piece's longest axis in XY plane via PCA.              */
/*  2. Project all vertices onto this axis.                            */
/*  3. Find vertices near the two extremes of the projection.          */
/*  4. Compute centroids of those clusters — these are the endpoints.  */
/* ------------------------------------------------------------------ */

function findEndpoints(
  vertices: Vec3[],
): { endpoints: [[number, number], [number, number]]; bbox: { minX: number; maxX: number; minY: number; maxY: number } } {
  // Compute bounding box
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }

  // Compute centroid
  const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
  const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;

  // PCA on XY: find the principal axis direction
  let cxx = 0, cxy = 0, cyy = 0;
  for (const v of vertices) {
    const dx = v.x - cx;
    const dy = v.y - cy;
    cxx += dx * dx;
    cxy += dx * dy;
    cyy += dy * dy;
  }

  // Eigenvector of the covariance matrix for the larger eigenvalue
  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const eigenVal1 = trace / 2 + Math.sqrt(Math.max(0, (trace * trace) / 4 - det));
  // Principal axis direction
  let ax: number, ay: number;
  if (Math.abs(cxy) > 1e-10) {
    ax = eigenVal1 - cyy;
    ay = cxy;
  } else {
    // Already axis-aligned
    ax = cxx >= cyy ? 1 : 0;
    ay = cxx >= cyy ? 0 : 1;
  }
  const len = Math.sqrt(ax * ax + ay * ay);
  ax /= len;
  ay /= len;

  // Project all vertices onto the principal axis
  const projections = vertices.map((v) => (v.x - cx) * ax + (v.y - cy) * ay);
  const minProj = Math.min(...projections);
  const maxProj = Math.max(...projections);
  const span = maxProj - minProj;

  // Cluster: vertices within 15% of the span from each extreme
  const threshold = span * 0.15;

  let endAx = 0, endAy = 0, countA = 0;
  let endBx = 0, endBy = 0, countB = 0;

  for (let i = 0; i < vertices.length; i++) {
    const proj = projections[i];
    if (proj - minProj < threshold) {
      endAx += vertices[i].x;
      endAy += vertices[i].y;
      countA++;
    }
    if (maxProj - proj < threshold) {
      endBx += vertices[i].x;
      endBy += vertices[i].y;
      countB++;
    }
  }

  if (countA === 0 || countB === 0) {
    throw new Error("Could not find endpoint clusters");
  }

  endAx /= countA;
  endAy /= countA;
  endBx /= countB;
  endBy /= countB;

  return {
    endpoints: [
      [round6(endAx), round6(endAy)],
      [round6(endBx), round6(endBy)],
    ],
    bbox: {
      minX: round6(minX),
      maxX: round6(maxX),
      minY: round6(minY),
      maxY: round6(maxY),
    },
  };
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}

/* ------------------------------------------------------------------ */
/*  Main                                                               */
/* ------------------------------------------------------------------ */

const PIECES = [
  { id: 0, key: "J", file: "piece_J.obj" },
  { id: 1, key: "C", file: "piece_C.obj" },
  { id: 2, key: "H", file: "piece_H.obj" },
  { id: 3, key: "B", file: "piece_B.obj" },
  { id: 4, key: "A", file: "piece_A.obj" },
  { id: 5, key: "K", file: "piece_K.obj" },
  { id: 6, key: "I", file: "piece_I.obj" },
  { id: 7, key: "G", file: "piece_G.obj" },
  { id: 8, key: "D", file: "piece_D.obj" },
  { id: 9, key: "F", file: "piece_F.obj" },
  { id: 10, key: "E", file: "piece_E.obj" },
];

const modelsDir = resolve(import.meta.dirname ?? __dirname, "../../public/models");

console.log("// Auto-generated by extractConnectors.ts");
console.log("// Do not edit manually.\n");
console.log("export interface PieceConnectorAnchors {");
console.log("  endpoints: [[number, number], [number, number]];");
console.log("  bbox: { minX: number; maxX: number; minY: number; maxY: number };");
console.log("}\n");
console.log("export const CONNECTOR_ANCHORS: Record<number, PieceConnectorAnchors> = {");

for (const piece of PIECES) {
  const objPath = resolve(modelsDir, piece.file);
  const objText = readFileSync(objPath, "utf-8");
  const rawVertices = parseObjVertices(objText);
  const correctedVertices = rawVertices.map(applyAxisCorrection);

  const { endpoints, bbox } = findEndpoints(correctedVertices);

  const spanX = Math.abs(endpoints[1][0] - endpoints[0][0]);
  const spanY = Math.abs(endpoints[1][1] - endpoints[0][1]);

  console.log(`  // Piece ${piece.key} (id=${piece.id}) — ${rawVertices.length} vertices, span: ${round6(spanX)} x ${round6(spanY)}`);
  console.log(`  ${piece.id}: {`);
  console.log(`    endpoints: [[${endpoints[0][0]}, ${endpoints[0][1]}], [${endpoints[1][0]}, ${endpoints[1][1]}]],`);
  console.log(`    bbox: { minX: ${bbox.minX}, maxX: ${bbox.maxX}, minY: ${bbox.minY}, maxY: ${bbox.maxY} },`);
  console.log(`  },`);
}

console.log("};");
