import { BOARD_WIDTH, BOARD_HEIGHT } from "../engine/constants";

export type GridCorners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export const BOARD_GRID = {
  cols: BOARD_WIDTH,
  rows: BOARD_HEIGHT,
  minCol: 0,
  maxCol: BOARD_WIDTH - 1,
  minRow: 0,
  maxRow: BOARD_HEIGHT - 1,
  edgeMinCol: -0.5,
  edgeMaxCol: BOARD_WIDTH - 0.5,
  edgeMinRow: -0.5,
  edgeMaxRow: BOARD_HEIGHT - 0.5,
  centerSpanCols: BOARD_WIDTH - 1,
  centerSpanRows: BOARD_HEIGHT - 1,
  maxCenterSpan: Math.max(BOARD_WIDTH - 1, BOARD_HEIGHT - 1),
} as const;

export const DEFAULT_RECTIFIED_MARGIN_CELLS = 1;

export function getBoardCenterCorners(): GridCorners {
  return [
    [BOARD_GRID.minCol, BOARD_GRID.minRow],
    [BOARD_GRID.maxCol, BOARD_GRID.minRow],
    [BOARD_GRID.maxCol, BOARD_GRID.maxRow],
    [BOARD_GRID.minCol, BOARD_GRID.maxRow],
  ];
}

export function expectedRectifiedCellSpacing(
  rectifiedSize: number,
  marginCells = DEFAULT_RECTIFIED_MARGIN_CELLS,
): number {
  return rectifiedSize / (BOARD_GRID.maxCenterSpan + marginCells * 2);
}

export function buildInternalGridFractions(cellCount: number): number[] {
  if (!Number.isFinite(cellCount) || cellCount < 2) return [];
  const n = Math.floor(cellCount);
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

export function buildCellEdgeCoordinates(cellCount: number): number[] {
  if (!Number.isFinite(cellCount) || cellCount < 1) return [];
  const n = Math.floor(cellCount);
  return Array.from({ length: n + 1 }, (_, i) => i - 0.5);
}