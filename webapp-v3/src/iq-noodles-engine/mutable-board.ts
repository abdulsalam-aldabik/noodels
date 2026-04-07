import { NoodlesBoard } from "./board";
import { BOARD_WIDTH, BOARD_HEIGHT } from "./constants";

const TOTAL = BOARD_WIDTH * BOARD_HEIGHT;

export class MutableNoodlesBoard {
  private readonly base: NoodlesBoard;
  private readonly occupied: boolean[];
  private readonly pieceAtCell: number[];

  constructor(base?: NoodlesBoard) {
    this.base = base ?? new NoodlesBoard();
    this.occupied = new Array(TOTAL).fill(false);
    this.pieceAtCell = new Array(TOTAL).fill(-1);
  }

  get width(): number {
    return this.base.width;
  }

  get height(): number {
    return this.base.height;
  }

  isCellFree(position: number): boolean {
    return this.base.isFree(position) && !this.occupied[position];
  }

  areCellsFree(positions: number[]): boolean {
    return positions.every((p) => this.isCellFree(p));
  }

  place(positions: number[], pieceId: number): void {
    for (const p of positions) {
      this.occupied[p] = true;
      this.pieceAtCell[p] = pieceId;
    }
  }

  remove(positions: number[]): void {
    for (const p of positions) {
      this.occupied[p] = false;
      this.pieceAtCell[p] = -1;
    }
  }

  getPlacedPieceIds(): Set<number> {
    const ids = new Set<number>();
    for (const id of this.pieceAtCell) {
      if (id >= 0) ids.add(id);
    }
    return ids;
  }

  clone(): MutableNoodlesBoard {
    const copy = new MutableNoodlesBoard(this.base);
    for (let i = 0; i < TOTAL; i++) {
      copy.occupied[i] = this.occupied[i];
      copy.pieceAtCell[i] = this.pieceAtCell[i];
    }
    return copy;
  }

  checkOpenSpace(): boolean {
    let start = -1;
    for (let i = 0; i < TOTAL; i++) {
      if (this.isCellFree(i)) {
        start = i;
        break;
      }
    }
    if (start === -1) return true;

    const visited = new Set<number>();
    const queue = [start];
    visited.add(start);

    while (queue.length > 0) {
      const current = queue.shift()!;
      const row = Math.floor(current / BOARD_WIDTH);
      const col = current % BOARD_WIDTH;
      const neighbors = [
        row > 0 ? current - BOARD_WIDTH : -1,
        row < BOARD_HEIGHT - 1 ? current + BOARD_WIDTH : -1,
        col > 0 ? current - 1 : -1,
        col < BOARD_WIDTH - 1 ? current + 1 : -1,
      ];
      for (const n of neighbors) {
        if (n >= 0 && this.isCellFree(n) && !visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      }
    }

    let totalFree = 0;
    for (let i = 0; i < TOTAL; i++) {
      if (this.isCellFree(i)) totalFree++;
    }
    return visited.size === totalFree;
  }
}
