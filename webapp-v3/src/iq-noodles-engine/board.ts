import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  MISSING_POSITIONS,
  POSITIONS_AROUND_PINS,
} from "./constants";

export class NoodlesBoard {
  readonly width = BOARD_WIDTH;
  readonly height = BOARD_HEIGHT;
  readonly maxPosition = 191;

  private readonly missingSet = new Set<number>(MISSING_POSITIONS);
  private readonly pinIndexByPosition: number[];

  constructor() {
    this.pinIndexByPosition = new Array(this.width * this.height).fill(-1);
    POSITIONS_AROUND_PINS.forEach((positions, pinIndex) => {
      positions.forEach((pos) => {
        this.pinIndexByPosition[pos] = pinIndex;
      });
    });
  }

  isInBounds(position: number): boolean {
    return position >= 0 && position < this.width * this.height;
  }

  isMissing(position: number): boolean {
    return this.missingSet.has(position);
  }

  isFree(position: number): boolean {
    return this.isInBounds(position) && !this.isMissing(position);
  }

  areFree(positions: number[]): boolean {
    return positions.every((pos) => this.isFree(pos));
  }

  getPositionsAroundPin(pinIndex: number): number[] {
    return [...POSITIONS_AROUND_PINS[pinIndex]];
  }

  getPinIndexAtPosition(position: number): number {
    if (!this.isInBounds(position)) {
      return -1;
    }
    return this.pinIndexByPosition[position];
  }

  getValidCellCount(): number {
    return this.width * this.height - MISSING_POSITIONS.length;
  }
}
