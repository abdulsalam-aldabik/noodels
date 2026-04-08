// Check if a SINGLE global scale works when we DON'T assume axis alignment
// i.e., the model might be rotated relative to the board
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const modelsDir = resolve("public/models");
const CELL_SIZE = 28;
const BOARD_WIDTH = 14;
const BOARD_PADDING = 20;
const HALF_BOARD = (BOARD_PADDING * 2 + 13 * CELL_SIZE) / 2;
const BIG_GRID_W = 40;

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

function parseAndCorrect(file) {
  const text = readFileSync(file, "utf-8");
  const verts = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("v ")) continue;
    const p = t.split(/\s+/);
    if (p.length < 4) continue;
    verts.push({ x: parseFloat(p[1]), y: -parseFloat(p[3]), z: parseFloat(p[2]) });
  }
  return verts;
}

function posToWorld(boardPos) {
  const row = Math.floor(boardPos / BOARD_WIDTH);
  const col = boardPos % BOARD_WIDTH;
  return { x: BOARD_PADDING + col * CELL_SIZE - HALF_BOARD, y: HALF_BOARD - BOARD_PADDING - row * CELL_SIZE };
}

// For each piece, compute the diagonal distance between the two furthest-apart
// cell centers on the board (in world coords), and the diagonal extent of the
// model bounding box. The ratio should be consistent if there's a global scale.

console.log("=== Diagonal distance analysis ===\n");
console.log("If all models are at the same scale, the ratio of board diagonal");
console.log("to model diagonal should be constant across all pieces.\n");

const ratios = [];

for (const piece of PIECES) {
  const verts = parseAndCorrect(resolve(modelsDir, piece.file));
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  const modelDiag = Math.sqrt((maxX-minX)**2 + (maxY-minY)**2);
  
  const boardPositions = PIECE_BIG_POSITIONS[piece.id].map(p => {
    const row = Math.floor(p / BIG_GRID_W);
    const col = p % BIG_GRID_W;
    return row * BOARD_WIDTH + col;
  });
  const worldPositions = boardPositions.map(posToWorld);
  
  // Find max distance between any two cell centers
  let maxDist = 0;
  for (let i = 0; i < worldPositions.length; i++) {
    for (let j = i+1; j < worldPositions.length; j++) {
      const d = Math.sqrt((worldPositions[i].x-worldPositions[j].x)**2 + (worldPositions[i].y-worldPositions[j].y)**2);
      if (d > maxDist) maxDist = d;
    }
  }
  
  const ratio = maxDist / modelDiag;
  ratios.push(ratio);
  
  console.log(`${piece.key}(${piece.id}): modelDiag=${modelDiag.toFixed(2)}, boardDiag=${maxDist.toFixed(2)}, ratio=${ratio.toFixed(4)}`);
}

const avgRatio = ratios.reduce((a,b)=>a+b,0) / ratios.length;
const stdDev = Math.sqrt(ratios.reduce((a,r)=>a+(r-avgRatio)**2, 0) / ratios.length);
console.log(`\nAverage ratio: ${avgRatio.toFixed(4)}, StdDev: ${stdDev.toFixed(4)}, CV: ${(stdDev/avgRatio*100).toFixed(1)}%`);

// Now check: what if the model size includes ~1 cell of "overhang" padding on each side?
// i.e., the model extends past the cell centers by about half a cell worth
console.log("\n=== With cell-center-to-edge padding ===");
console.log("Board diagonal measured between cell centers.");
console.log("Model includes rubber that extends past the outermost cells.\n");

// The model bbox extends beyond the cell centers. If each side has ~padding,
// then model_effective = model_bbox - 2*padding on each axis.
// Let's see if we can find a consistent padding.

// For each piece, if ratio = boardDiag / (modelDiag - padding_correction):
// We can try: modelDiag_effective = modelDiag - 2*R where R is the rubber radius
// and see if there's an R that makes ratios consistent.

// Actually, let's try a different analysis. 
// The model center should map to the board center (centroid of cells).
// With a FIXED global scale S, check if model_center * S maps near board_center.

// But we saw that doesn't work with different S for X and Y.
// What if the axis correction is wrong? What if it should be x'=x, y'=z (not -z)?

console.log("\n=== Trying alternate axis corrections ===\n");

const corrections = [
  { name: "x,y=-z (current)", fn: (x,y,z) => ({x, y: -z}) },
  { name: "x,y=z", fn: (x,y,z) => ({x, y: z}) },
  { name: "x=-y,y=-z", fn: (x,y,z) => ({x: -y, y: -z}) },
  { name: "x=y,y=-z", fn: (x,y,z) => ({x: y, y: -z}) },
  { name: "x=-z,y=x", fn: (x,y,z) => ({x: -z, y: x}) },
  { name: "x=z,y=x", fn: (x,y,z) => ({x: z, y: x}) },
];

for (const corr of corrections) {
  const pairData = [];
  
  for (const piece of PIECES) {
    const text = readFileSync(resolve(modelsDir, piece.file), "utf-8");
    const verts = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("v ")) continue;
      const p = t.split(/\s+/);
      if (p.length < 4) continue;
      const v = corr.fn(parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3]));
      verts.push(v);
    }
    
    let cx = 0, cy = 0;
    for (const v of verts) { cx += v.x; cy += v.y; }
    cx /= verts.length; cy /= verts.length;
    
    const boardPositions = PIECE_BIG_POSITIONS[piece.id].map(p => {
      const row = Math.floor(p / BIG_GRID_W);
      const col = p % BIG_GRID_W;
      return row * BOARD_WIDTH + col;
    });
    const worldPositions = boardPositions.map(posToWorld);
    let bCx = 0, bCy = 0;
    for (const w of worldPositions) { bCx += w.x; bCy += w.y; }
    bCx /= worldPositions.length; bCy /= worldPositions.length;
    
    pairData.push({ modelCX: cx, modelCY: cy, boardCX: bCx, boardCY: bCy });
  }
  
  // Fit global scale+offset for X and Y
  function fit(model, board) {
    const n = model.length;
    let sM = 0, sB = 0, sMM = 0, sMB = 0;
    for (let i = 0; i < n; i++) { sM += model[i]; sB += board[i]; sMM += model[i]**2; sMB += model[i]*board[i]; }
    const S = (n * sMB - sM * sB) / (n * sMM - sM * sM);
    const O = (sB - S * sM) / n;
    let errSum = 0;
    for (let i = 0; i < n; i++) errSum += (model[i]*S+O - board[i])**2;
    return { S, O, rmse: Math.sqrt(errSum/n) };
  }
  
  const xFit = fit(pairData.map(p=>p.modelCX), pairData.map(p=>p.boardCX));
  const yFit = fit(pairData.map(p=>p.modelCY), pairData.map(p=>p.boardCY));
  
  console.log(`${corr.name}: Sx=${xFit.S.toFixed(3)} Ox=${xFit.O.toFixed(1)} rmseX=${xFit.rmse.toFixed(1)} | Sy=${yFit.S.toFixed(3)} Oy=${yFit.O.toFixed(1)} rmseY=${yFit.rmse.toFixed(1)} | totalRMSE=${Math.sqrt(xFit.rmse**2+yFit.rmse**2).toFixed(1)}`);
}
