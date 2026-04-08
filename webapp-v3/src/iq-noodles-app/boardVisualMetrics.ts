export const BASE_BOARD_CELL_SIZE = 28;

export const BOARD_CELL_RADIUS = 8;
export const PIN_RING_RADIUS = 12;
export const PIN_CORE_RADIUS = 5.5;

export function getPinDiameterForCellSize(cellSize: number): number {
  return cellSize * ((PIN_RING_RADIUS * 2) / BASE_BOARD_CELL_SIZE);
}
