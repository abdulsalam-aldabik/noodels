import { describe, expect, it } from "vitest";

import {
  getOrientationTemplates,
  matchPieceOrientation,
  type BoardCell,
} from "../OrientationMatcher";

function translateCells(
  cells: BoardCell[],
  rowOffset: number,
  colOffset: number,
): BoardCell[] {
  return cells.map((cell) => ({
    row: cell.row + rowOffset,
    col: cell.col + colOffset,
  }));
}

function signature(cells: BoardCell[]): string {
  let minRow = Number.POSITIVE_INFINITY;
  let minCol = Number.POSITIVE_INFINITY;
  for (const cell of cells) {
    minRow = Math.min(minRow, cell.row);
    minCol = Math.min(minCol, cell.col);
  }
  return cells
    .map((cell) => `${cell.row - minRow},${cell.col - minCol}`)
    .sort()
    .join("|");
}

function findDistinctMirroredTemplate(): {
  pieceId: number;
  template: ReturnType<typeof getOrientationTemplates>[number];
} | null {
  for (let pieceId = 0; pieceId <= 10; pieceId++) {
    const templates = getOrientationTemplates(pieceId);
    const nonMirrored = new Set(
      templates
        .filter((template) => !template.mirrored)
        .map((template) => signature(template.cells)),
    );

    for (const template of templates) {
      if (!template.mirrored) continue;
      if (!nonMirrored.has(signature(template.cells))) {
        return { pieceId, template };
      }
    }
  }
  return null;
}

describe("matchPieceOrientation", () => {
  it("matches an exact observed footprint with confidence 1", () => {
    const pieceId = 4;
    const templates = getOrientationTemplates(pieceId);
    expect(templates.length).toBeGreaterThan(0);

    const target = templates[0];
    const observed = translateCells(target.cells, 5, 7);
    const result = matchPieceOrientation({
      pieceId,
      observedCells: observed,
      topK: 4,
      ambiguityDelta: 0.05,
    });

    expect(result.orientation).toBe(target.orientation);
    expect(result.mirrored).toBe(target.mirrored);
    expect(result.confidence).toBeCloseTo(1, 8);
    expect(result.ambiguous).toBe(false);
  });

  it("returns mirrored=true when a unique mirrored template is matched", () => {
    const picked = findDistinctMirroredTemplate();
    expect(picked).not.toBeNull();
    if (!picked) return;

    const observed = translateCells(picked.template.cells, 3, 9);
    const result = matchPieceOrientation({
      pieceId: picked.pieceId,
      observedCells: observed,
      topK: 3,
      ambiguityDelta: 0.05,
    });

    expect(result.mirrored).toBe(true);
    expect(result.orientation).toBe(picked.template.orientation);
    expect(result.confidence).toBeCloseTo(1, 8);
  });

  it("keeps topK sorted by score descending", () => {
    const pieceId = 4;
    const templates = getOrientationTemplates(pieceId);
    const observed = translateCells(templates[0].cells, 2, 2);

    const result = matchPieceOrientation({
      pieceId,
      observedCells: observed,
      topK: 2,
    });

    expect(result.topK).toHaveLength(2);
    expect(result.topK[0].score).toBeGreaterThanOrEqual(result.topK[1].score);
  });

  it("marks sparse evidence as ambiguous when top scores are close", () => {
    const result = matchPieceOrientation({
      pieceId: 4,
      observedCells: [{ row: 7, col: 7 }],
      topK: 3,
      ambiguityDelta: 0.2,
    });

    expect(result.ambiguous).toBe(true);
  });
});
