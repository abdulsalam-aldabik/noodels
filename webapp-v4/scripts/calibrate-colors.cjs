/**
 * Color Calibration Script
 * 
 * Reads a rectified board image and YOLO detection overlay to extract
 * the actual RGB colors the phone camera sees for each piece.
 * 
 * Strategy:
 * 1. Load rectified.png (960×960, 14×14 grid, 60px cell spacing)
 * 2. For each cell, sample the most chromatic pixels in a patch around the center
 * 3. Use the YOLO report.json classHistogram to know which pieces are detected
 * 4. Output the actual median colors per cell for manual mapping
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const BOARD_EDGE_MIN = -1;
const BOARD_EDGE_SPAN = 16;
const BOARD_WIDTH = 14;
const BOARD_HEIGHT = 14;

// Missing positions (diamond cutouts)
const MISSING_POSITIONS = [
  0,1,2,3,4, 5,6,     // row 0 left
  10,11,12,13,         // row 0 right
  14,15,16,17, 18,     // row 1 left
  23,24,25,26,27,      // row 1 right
  28,29,30, 31,        // row 2 left
  38,39,40,41,         // row 2 right
  42,43,44,            // row 3 left
  53,54,55,            // row 3 right
  56,57,               // row 4 left
  68,69,               // row 4 right
  70,                  // row 5 left
  83,                  // row 5 right
  
  112,                 // row 8 left
  125,                 // row 8 right
  126,127,             // row 9 left
  138,139,             // row 9 right
  140,141,142,         // row 10 left
  151,152,153,         // row 10 right
  154,155,156,157,     // row 11 left
  164,165,166,167,     // row 11 right
  168,169,170,171,172, // row 12 left
  177,178,179,180,181, // row 12 right
  182,183,184,185,186,187,188, // row 13 left
  191,192,193,194,195, // row 13 right
];

const MISSING_SET = new Set(MISSING_POSITIONS);

function boardToCanvas(col, row, canvasSize) {
  const scale = canvasSize / BOARD_EDGE_SPAN;
  return {
    x: (col - BOARD_EDGE_MIN) * scale,
    y: (row - BOARD_EDGE_MIN) * scale,
  };
}

function srgbToLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function rgbToLab(r, g, b) {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const x = 0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl;
  const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
  const z = 0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl;
  const xn = 0.95047, yn = 1.0, zn = 1.08883;
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return {
    L: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

async function extractColors(debugDir) {
  const rectifiedPath = path.join(debugDir, 'rectified.png');
  if (!fs.existsSync(rectifiedPath)) {
    console.error('No rectified.png found in', debugDir);
    return;
  }

  const img = sharp(rectifiedPath);
  const meta = await img.metadata();
  const w = meta.width;
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;

  console.log(`Image: ${w}x${meta.height}, ${channels} channels`);
  const cellSpacing = w / BOARD_EDGE_SPAN;
  const patchRadius = Math.max(4, Math.floor(cellSpacing * 0.4));
  console.log(`Cell spacing: ${cellSpacing}px, patch radius: ${patchRadius}px`);

  const cellColors = [];

  for (let row = 0; row < BOARD_HEIGHT; row++) {
    for (let col = 0; col < BOARD_WIDTH; col++) {
      const cellIndex = row * BOARD_WIDTH + col;
      if (MISSING_SET.has(cellIndex)) continue;

      const cp = boardToCanvas(col, row, w);
      const cx = Math.round(cp.x);
      const cy = Math.round(cp.y);

      // Sample patch and collect chromatic pixels
      const pixels = [];
      for (let dy = -patchRadius; dy <= patchRadius; dy++) {
        for (let dx = -patchRadius; dx <= patchRadius; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= w || py < 0 || py >= w) continue;
          const idx = (py * w + px) * channels;
          const r = data[idx], g = data[idx + 1], b = data[idx + 2];
          const maxC = Math.max(r, g, b);
          const minC = Math.min(r, g, b);
          const lum = (maxC + minC) / 2;
          const sat = maxC > 0 ? (maxC - minC) / maxC : 0;
          if (lum > 245 || minC > 240) continue; // skip highlights
          pixels.push({ r, g, b, sat, lum, score: sat * lum });
        }
      }

      if (pixels.length < 3) continue;

      // Take top 40% most chromatic
      pixels.sort((a, b) => b.score - a.score);
      const topCount = Math.max(3, Math.floor(pixels.length * 0.4));
      const top = pixels.slice(0, topCount);

      // Median color
      top.sort((a, b) => a.r - b.r);
      const medR = top[Math.floor(topCount / 2)].r;
      top.sort((a, b) => a.g - b.g);
      const medG = top[Math.floor(topCount / 2)].g;
      top.sort((a, b) => a.b - b.b);
      const medB = top[Math.floor(topCount / 2)].b;

      const lab = rgbToLab(medR, medG, medB);

      // Check if this is board (dark) or piece (bright)
      const isPiece = lab.L > 22;

      cellColors.push({
        row, col, cellIndex,
        r: medR, g: medG, b: medB,
        lab,
        isPiece,
        hex: `#${medR.toString(16).padStart(2, '0')}${medG.toString(16).padStart(2, '0')}${medB.toString(16).padStart(2, '0')}`,
      });
    }
  }

  // Print piece cells only, grouped by approximate color clusters
  const pieceCells = cellColors.filter(c => c.isPiece);
  console.log(`\nPiece cells: ${pieceCells.length} / ${cellColors.length} total\n`);

  // Sort by Lab L, a, b for visual grouping
  pieceCells.sort((a, b) => {
    const da = a.lab.a - b.lab.a;
    if (Math.abs(da) > 10) return da;
    const db = a.lab.b - b.lab.b;
    if (Math.abs(db) > 10) return db;
    return a.lab.L - b.lab.L;
  });

  console.log('row,col | RGB hex    | Lab L    a      b     | sat*lum');
  console.log('--------|------------|------------------------|--------');
  for (const c of pieceCells) {
    const satLum = cellColors.find(x => x.cellIndex === c.cellIndex);
    console.log(
      `${String(c.row).padStart(3)},${String(c.col).padStart(3)} | ${c.hex} | ${c.lab.L.toFixed(1).padStart(6)} ${c.lab.a.toFixed(1).padStart(6)} ${c.lab.b.toFixed(1).padStart(6)} |`
    );
  }
}

// Reference colors for comparison
const REF_COLORS = [
  { id: 0, key: 'J', name: 'DarkRed',     rgb: [0xb6, 0x30, 0x48] },
  { id: 1, key: 'C', name: 'DarkBlue',     rgb: [0x20, 0x6d, 0xd9] },
  { id: 2, key: 'H', name: 'Purple',       rgb: [0xc7, 0x78, 0xb9] },
  { id: 3, key: 'B', name: 'SkyBlue',      rgb: [0x08, 0xa7, 0xe8] },
  { id: 4, key: 'A', name: 'Yellow',       rgb: [0xf9, 0xd6, 0x5e] },
  { id: 5, key: 'K', name: 'YellowGreen',  rgb: [0x95, 0xd4, 0x50] },
  { id: 6, key: 'I', name: 'Orange',       rgb: [0xfc, 0x69, 0x0c] },
  { id: 7, key: 'G', name: 'Pink',         rgb: [0xec, 0x71, 0xa8] },
  { id: 8, key: 'D', name: 'Green',        rgb: [0x1f, 0xa1, 0x5b] },
  { id: 9, key: 'F', name: 'Teal',         rgb: [0x85, 0xda, 0xbb] },
  { id: 10, key: 'E', name: 'Red',         rgb: [0xee, 0x39, 0x4f] },
];

console.log('\n=== CURRENT REFERENCE COLORS (Lab) ===\n');
for (const ref of REF_COLORS) {
  const lab = rgbToLab(ref.rgb[0], ref.rgb[1], ref.rgb[2]);
  const hex = `#${ref.rgb[0].toString(16).padStart(2, '0')}${ref.rgb[1].toString(16).padStart(2, '0')}${ref.rgb[2].toString(16).padStart(2, '0')}`;
  console.log(`${ref.key.padStart(2)} (${ref.name.padEnd(12)}) ${hex} → Lab ${lab.L.toFixed(1).padStart(6)} ${lab.a.toFixed(1).padStart(6)} ${lab.b.toFixed(1).padStart(6)}`);
}

// Process multiple debug directories for robust calibration
const debugDirs = [
  'c:\\Users\\abdul\\Desktop\\team-halal\\project\\phone-debug\\2026-04-29T10-24-53-484Z_ok-6',
  'c:\\Users\\abdul\\Desktop\\team-halal\\project\\phone-debug\\2026-04-29T10-15-37-601Z_ok-5',
  'c:\\Users\\abdul\\Desktop\\team-halal\\project\\phone-debug\\2026-04-29T10-03-46-033Z_ok-7',
];

(async () => {
  for (const dir of debugDirs) {
    console.log(`\n\n${'='.repeat(60)}`);
    console.log(`Processing: ${path.basename(dir)}`);
    console.log('='.repeat(60));
    await extractColors(dir);
  }
})();
