// Analyze model bounding boxes and compute scale factors
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modelsDir = resolve("public/models");

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

// Axis correction: x'=x, y'=-z, z'=y
function parseAndCorrect(file) {
  const text = readFileSync(file, "utf-8");
  const verts = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("v ")) continue;
    const p = t.split(/\s+/);
    if (p.length < 4) continue;
    verts.push({
      x: parseFloat(p[1]),
      y: -parseFloat(p[3]), // -z
      z: parseFloat(p[2]),  // y
    });
  }
  return verts;
}

// Board constants
const BOARD_WIDTH = 14;
const CELL_SIZE = 28;
const BOARD_PADDING = 20;
const BOARD_SIZE = BOARD_PADDING * 2 + (BOARD_WIDTH - 1) * CELL_SIZE; // 404
const HALF_BOARD = BOARD_SIZE / 2; // 202

// Piece base orientations (bigGridPositions from constants.ts, on 40-wide grid)
const BIG_GRID_W = 40;
const PIECE_BIG_POSITIONS = {
  0: [4, 44, 82, 83, 122, 123],
  1: [44, 45, 48, 49, 86, 87],
  2: [9, 49, 90, 130, 168, 169],
  3: [91, 131, 172, 173, 212, 213, 250, 251],
  4: [126, 127, 164, 165, 204, 205, 243, 283],
  5: [160, 161, 200, 201, 242, 282, 320, 321],
  6: [208, 209, 246, 247, 286, 287, 324, 325],
  7: [290, 291, 332, 333, 372, 373, 410, 411],
  8: [328, 329, 364, 365, 368, 369, 406, 407],
  9: [360, 361, 402, 403, 442, 443, 484, 485, 524, 525],
  10: [446, 447, 450, 451, 488, 489, 528, 529],
};

// Convert bigGrid pos to board (14-wide) pos
function bigToBoard(bigPos) {
  const row = Math.floor(bigPos / BIG_GRID_W);
  const col = bigPos % BIG_GRID_W;
  return row * BOARD_WIDTH + col;
}

// Board position to world coords (THREE.js)
function posToWorld(boardPos) {
  const row = Math.floor(boardPos / BOARD_WIDTH);
  const col = boardPos % BOARD_WIDTH;
  const svgX = BOARD_PADDING + col * CELL_SIZE;
  const svgY = BOARD_PADDING + row * CELL_SIZE;
  return { x: svgX - HALF_BOARD, y: HALF_BOARD - svgY };
}

console.log("=== Per-piece analysis ===\n");

for (const piece of PIECES) {
  const verts = parseAndCorrect(resolve(modelsDir, piece.file));
  
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  
  const modelW = maxX - minX;
  const modelH = maxY - minY;
  const modelCX = (minX + maxX) / 2;
  const modelCY = (minY + maxY) / 2;
  
  // Board positions
  const boardPositions = PIECE_BIG_POSITIONS[piece.id].map(bigToBoard);
  const worldPositions = boardPositions.map(posToWorld);
  
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (const w of worldPositions) {
    if (w.x < bMinX) bMinX = w.x;
    if (w.x > bMaxX) bMaxX = w.x;
    if (w.y < bMinY) bMinY = w.y;
    if (w.y > bMaxY) bMaxY = w.y;
  }
  
  const boardW = bMaxX - bMinX;
  const boardH = bMaxY - bMinY;
  const boardCX = (bMinX + bMaxX) / 2;
  const boardCY = (bMinY + bMaxY) / 2;
  
  // Scale factors
  const scaleX = boardW > 0 && modelW > 0 ? boardW / modelW : "N/A";
  const scaleY = boardH > 0 && modelH > 0 ? boardH / modelH : "N/A";
  
  // Also compute: what scale maps model center to board center?
  // If all pieces use the SAME global scale and offset, then:
  // worldX = modelX * globalScale + offsetX
  // worldY = modelY * globalScale + offsetY
  
  console.log(`Piece ${piece.key} (id=${piece.id}): ${verts.length} vertices`);
  console.log(`  Model bbox: X[${minX.toFixed(2)}, ${maxX.toFixed(2)}] Y[${minY.toFixed(2)}, ${maxY.toFixed(2)}]`);
  console.log(`  Model size: ${modelW.toFixed(2)} x ${modelH.toFixed(2)}, center: (${modelCX.toFixed(2)}, ${modelCY.toFixed(2)})`);
  console.log(`  Board world: X[${bMinX}, ${bMaxX}] Y[${bMinY}, ${bMaxY}]`);
  console.log(`  Board size: ${boardW} x ${boardH}, center: (${boardCX}, ${boardCY})`);
  console.log(`  Scale X: ${typeof scaleX === 'number' ? scaleX.toFixed(4) : scaleX}, Scale Y: ${typeof scaleY === 'number' ? scaleY.toFixed(4) : scaleY}`);
  console.log();
}

// Now try to find a GLOBAL scale+offset by least-squares across all piece centers
console.log("=== Global scale analysis ===\n");
console.log("If models share a global coordinate system, then:");
console.log("  worldX = modelX * S + Ox");
console.log("  worldY = modelY * S + Oy\n");

// Collect (modelCenter, boardCenter) pairs
const pairs = [];
for (const piece of PIECES) {
  const verts = parseAndCorrect(resolve(modelsDir, piece.file));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  
  const boardPositions = PIECE_BIG_POSITIONS[piece.id].map(bigToBoard);
  const worldPositions = boardPositions.map(posToWorld);
  let bMinX = Infinity, bMaxX = -Infinity, bMinY = Infinity, bMaxY = -Infinity;
  for (const w of worldPositions) {
    if (w.x < bMinX) bMinX = w.x;
    if (w.x > bMaxX) bMaxX = w.x;
    if (w.y < bMinY) bMinY = w.y;
    if (w.y > bMaxY) bMaxY = w.y;
  }
  
  pairs.push({
    key: piece.key,
    modelCX: (minX + maxX) / 2,
    modelCY: (minY + maxY) / 2,
    boardCX: (bMinX + bMaxX) / 2,
    boardCY: (bMinY + bMaxY) / 2,
  });
}

// Solve for S, Ox using X pairs: boardCX = modelCX * S + Ox
// Least squares: minimize sum((boardCX_i - modelCX_i * S - Ox)^2)
function solveLinear(model, board) {
  const n = model.length;
  let sumM = 0, sumB = 0, sumMM = 0, sumMB = 0;
  for (let i = 0; i < n; i++) {
    sumM += model[i];
    sumB += board[i];
    sumMM += model[i] * model[i];
    sumMB += model[i] * board[i];
  }
  const S = (n * sumMB - sumM * sumB) / (n * sumMM - sumM * sumM);
  const O = (sumB - S * sumM) / n;
  return { S, O };
}

const xResult = solveLinear(pairs.map(p => p.modelCX), pairs.map(p => p.boardCX));
const yResult = solveLinear(pairs.map(p => p.modelCY), pairs.map(p => p.boardCY));

console.log(`X: scale=${xResult.S.toFixed(4)}, offset=${xResult.O.toFixed(4)}`);
console.log(`Y: scale=${yResult.S.toFixed(4)}, offset=${yResult.O.toFixed(4)}`);

// Show residuals
console.log("\nResiduals (predicted - actual) in world units:");
for (const p of pairs) {
  const predX = p.modelCX * xResult.S + xResult.O;
  const predY = p.modelCY * yResult.S + yResult.O;
  const errX = predX - p.boardCX;
  const errY = predY - p.boardCY;
  console.log(`  ${p.key}: errX=${errX.toFixed(2)}, errY=${errY.toFixed(2)}, dist=${Math.sqrt(errX*errX+errY*errY).toFixed(2)}`);
}
