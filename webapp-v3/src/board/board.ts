/**
 * IQ Noodles Board — 14x14 grid, 81 valid cells, 21 pins.
 * Ported from GridNoodles.java.
 */

export const GRID_WIDTH = 14;
export const GRID_HEIGHT = 14;
export const TOTAL_CELLS = GRID_WIDTH * GRID_HEIGHT;

/** Blocked/missing positions */
export const MISSING_POSITIONS: ReadonlySet<number> = new Set([
  0, 1, 2, 3, 6, 7, 10, 11, 12, 13,
  14, 15, 16, 17, 20, 21, 24, 25, 26, 27,
  28, 29, 32, 33, 36, 37, 40, 41,
  42, 43, 46, 47, 50, 51, 54, 55,
  58, 59, 62, 63, 66, 67,
  72, 73, 76, 77, 80, 81,
  84, 85, 88, 89, 92, 93, 96, 97,
  98, 99, 102, 103, 106, 107, 110, 111,
  114, 115, 118, 119, 122, 123,
  128, 129, 132, 133, 136, 137,
  140, 141, 144, 145, 148, 149, 152, 153,
  154, 155, 158, 159, 162, 163, 166, 167,
  168, 169, 170, 171, 174, 175, 178, 179, 180, 181,
  182, 183, 184, 185, 188, 189, 192, 193, 194, 195,
]);

/** All 81 valid positions */
export const VALID_POSITIONS: readonly number[] = (() => {
  const valid: number[] = [];
  for (let i = 0; i < TOTAL_CELLS; i++) {
    if (!MISSING_POSITIONS.has(i)) valid.push(i);
  }
  return valid;
})();

/** 21 pins — each pin's 4 surrounding cells [TL, TR, BL, BR] */
export const POSITIONS_AROUND_PINS: readonly (readonly number[])[] = [
  [4, 5, 18, 19],     // pin 0
  [8, 9, 22, 23],     // pin 1
  [30, 31, 44, 45],   // pin 2
  [34, 35, 48, 49],   // pin 3
  [38, 39, 52, 53],   // pin 4
  [56, 57, 70, 71],   // pin 5
  [60, 61, 74, 75],   // pin 6
  [64, 65, 78, 79],   // pin 7
  [68, 69, 82, 83],   // pin 8
  [86, 87, 100, 101], // pin 9
  [90, 91, 104, 105], // pin 10
  [94, 95, 108, 109], // pin 11
  [112, 113, 126, 127], // pin 12
  [116, 117, 130, 131], // pin 13
  [120, 121, 134, 135], // pin 14
  [124, 125, 138, 139], // pin 15
  [142, 143, 156, 157], // pin 16
  [146, 147, 160, 161], // pin 17
  [150, 151, 164, 165], // pin 18
  [172, 173, 186, 187], // pin 19
  [176, 177, 190, 191], // pin 20
];

export const NUM_PINS = POSITIONS_AROUND_PINS.length;

/** Pin coordinates in board-space (origin at center) */
export const PIN_COORDINATES: readonly [number, number][] = [
  [-1.8, -5.6], [1.8, -5.6],
  [-3.6, -3.6], [0, -3.6], [3.6, -3.6],
  [-5.4, -1.8], [-1.8, -1.8], [1.8, -1.8], [5.4, -1.8],
  [-3.6, 0], [0, 0], [3.6, 0],
  [-5.4, 1.8], [-1.8, 1.8], [1.8, 1.8], [5.4, 1.8],
  [-3.6, 3.6], [0, 3.6], [3.6, 3.6],
  [-1.8, 5.4], [1.8, 5.4],
];

/** Map grid position -> pin index (-1 if not adjacent to any pin) */
export const POSITION_TO_PIN: readonly number[] = (() => {
  const map = new Array(TOTAL_CELLS).fill(-1);
  for (let pin = 0; pin < POSITIONS_AROUND_PINS.length; pin++) {
    for (const pos of POSITIONS_AROUND_PINS[pin]) {
      map[pos] = pin;
    }
  }
  return map;
})();

// Navigation
const OUT_OF_GRID = -1;

export function positionExists(pos: number): boolean {
  return pos >= 0 && pos < TOTAL_CELLS && !MISSING_POSITIONS.has(pos);
}

export function getPositionNorth(pos: number): number {
  if (Math.floor(pos / GRID_WIDTH) > 0) {
    const n = pos - GRID_WIDTH;
    if (!MISSING_POSITIONS.has(n)) return n;
  }
  return OUT_OF_GRID;
}

export function getPositionSouth(pos: number): number {
  if (Math.floor(pos / GRID_WIDTH) < GRID_HEIGHT - 1) {
    const s = pos + GRID_WIDTH;
    if (!MISSING_POSITIONS.has(s)) return s;
  }
  return OUT_OF_GRID;
}

export function getPositionWest(pos: number): number {
  if (pos % GRID_WIDTH > 0) {
    const w = pos - 1;
    if (!MISSING_POSITIONS.has(w)) return w;
  }
  return OUT_OF_GRID;
}

export function getPositionEast(pos: number): number {
  if (pos % GRID_WIDTH < GRID_WIDTH - 1) {
    const e = pos + 1;
    if (!MISSING_POSITIONS.has(e)) return e;
  }
  return OUT_OF_GRID;
}

/** Mutable board state */
export class BoardState {
  free: boolean[];
  pieceAt: number[];

  constructor() {
    this.free = new Array(TOTAL_CELLS);
    this.pieceAt = new Array(TOTAL_CELLS).fill(-1);
    for (let i = 0; i < TOTAL_CELLS; i++) {
      this.free[i] = !MISSING_POSITIONS.has(i);
    }
  }

  clone(): BoardState {
    const copy = new BoardState();
    copy.free = [...this.free];
    copy.pieceAt = [...this.pieceAt];
    return copy;
  }

  areFree(positions: number[]): boolean {
    for (const pos of positions) {
      if (pos < 0 || pos >= TOTAL_CELLS || !this.free[pos]) return false;
    }
    return true;
  }

  place(positions: number[], pieceIndex: number): void {
    for (const pos of positions) {
      this.free[pos] = false;
      this.pieceAt[pos] = pieceIndex;
    }
  }

  remove(positions: number[]): void {
    for (const pos of positions) {
      this.free[pos] = true;
      this.pieceAt[pos] = -1;
    }
  }

  getPlacedPieces(): Set<number> {
    const placed = new Set<number>();
    for (const p of this.pieceAt) {
      if (p >= 0) placed.add(p);
    }
    return placed;
  }

  /** Check all free cells form one connected region (no isolated holes) */
  checkOpenSpace(): boolean {
    let start = -1;
    for (const pos of VALID_POSITIONS) {
      if (this.free[pos]) { start = pos; break; }
    }
    if (start === -1) return true;

    const visited = new Set<number>();
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const dir of [getPositionNorth, getPositionSouth, getPositionWest, getPositionEast]) {
        const n = dir(current);
        if (n !== OUT_OF_GRID && this.free[n] && !visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    let totalFree = 0;
    for (const pos of VALID_POSITIONS) {
      if (this.free[pos]) totalFree++;
    }
    return visited.size === totalFree;
  }
}
