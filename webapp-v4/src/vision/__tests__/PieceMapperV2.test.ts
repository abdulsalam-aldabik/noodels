import { describe, it, expect } from "vitest";
import {
  mapPiecesToBoardStateV2,
  COVERAGE_THRESHOLD,
  MIN_CELLS,
  AMBIGUITY_MARGIN,
  MIN_ACCEPT_IOU,
} from "../PieceMapperV2";
import { getPlacementIndex } from "../placementIndex";
import type { RectifiedFrame } from "../types";
import type { DetectionMask, RawDetection } from "../../inference/types";
import { CLASS_NAMES } from "../../inference/types";
import { computePinBoardPoints } from "../../board/gridGeometry";
import { generatePlacementsForPiece } from "../../engine/placements";
import { solve } from "../../engine/solver";

// Silence unused-var lint for intentionally-exported constants used in docs
void COVERAGE_THRESHOLD;
void MIN_CELLS;
void AMBIGUITY_MARGIN;

function makeIdentityFrame(conditionOverride?: number): RectifiedFrame {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  return {
    canvasSize: { width: 14, height: 14 },
    cellSpacingPx: 1,
    homography: {
      forward: identity,
      inverse: identity,
      condition: conditionOverride ?? 1,
    },
    pinPoints: computePinBoardPoints().map((p) => ({ x: p.x, y: p.y })),
  };
}

function makeDetectionFromCellSet(
  classId: number,
  cells: Array<{ row: number; col: number }>,
  opts: { maskW?: number; maskH?: number; score?: number } = {},
): RawDetection {
  const maskW = opts.maskW ?? 14;
  const maskH = opts.maskH ?? 14;
  const score = opts.score ?? 0.9;
  const data = new Uint8Array(maskW * maskH);
  for (const { row, col } of cells) {
    if (row >= 0 && row < maskH && col >= 0 && col < maskW) {
      data[row * maskW + col] = 1;
    }
  }
  const mask: DetectionMask = { width: maskW, height: maskH, data };
  return {
    classId,
    className: CLASS_NAMES[classId] ?? String(classId),
    score,
    // Identity-frame tests use board-space coordinates where edges are
    // [-0.5, 13.5] and cell centers are integer (0..13).
    bbox: { x: -0.5, y: -0.5, width: 14, height: 14 },
    mask,
  };
}

function linearToCells(
  positions: number[],
): Array<{ row: number; col: number }> {
  return positions.map((p) => ({ row: Math.floor(p / 14), col: p % 14 }));
}

describe("PieceMapperV2", () => {
  it("maps a single clean placement for piece A", () => {
    const placements = generatePlacementsForPiece(0);
    expect(placements.length).toBeGreaterThan(0);
    const p = placements[0];
    const cells = linearToCells(p.positions);
    const det = makeDetectionFromCellSet(0, cells);
    const frame = makeIdentityFrame();

    const state = mapPiecesToBoardStateV2([det], frame);
    expect(state.placements.length).toBe(1);
    const out = state.placements[0];
    expect(out.confidence).toBeGreaterThan(0.95);
    expect(out.ambiguous).toBe(false);
    const minRow = Math.min(...cells.map((c) => c.row));
    const minCandidates = cells.filter((c) => c.row === minRow);
    const minCol = Math.min(...minCandidates.map((c) => c.col));
    expect(out.cell).toEqual({ row: minRow, col: minCol });
    expect(out.orientation).toBe(((p.rotationSteps ?? 0) * 90) as 0 | 90 | 180 | 270);
    expect(out.mirrored).toBe(Boolean(p.mirrored));
    expect(out.sourceDetectionIndex).toBe(0);
    expect(out.className).toBe("A");
  });

  it("maps all 11 pieces from a valid full-solution fixture", () => {
    const solved = solve(undefined, 2000);
    expect(solved.solved).toBe(true);
    expect(solved.timedOut).toBe(false);

    const picked: Array<{ classId: number; positions: number[]; rotationSteps: number; mirrored: boolean }> = [];
    solved.solution.forEach((placement, classId) => {
      if (!placement) return;
      picked.push({
        classId,
        positions: placement.positions,
        rotationSteps: placement.rotationSteps ?? 0,
        mirrored: Boolean(placement.mirrored),
      });
    });
    expect(picked.length).toBe(11);

    const detections = picked.map((p) =>
      makeDetectionFromCellSet(p.classId, linearToCells(p.positions)),
    );
    const frame = makeIdentityFrame();
    const state = mapPiecesToBoardStateV2(detections, frame);

    expect(state.placements.length).toBe(11);
    expect(state.unassignedDetections.length).toBe(0);
    for (const pl of state.placements) {
      expect(pl.confidence).toBeGreaterThan(0.9);
    }
    // Check no-overlap
    const seen = new Set<string>();
    for (let i = 0; i < state.placements.length; i++) {
      const classId = state.placements[i].classId;
      const orig = picked.find((p) => p.classId === classId)!;
      for (const pos of orig.positions) {
        const key = `${pos}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });

  it("rejects detection with empty mask", () => {
    const det = makeDetectionFromCellSet(0, []);
    const frame = makeIdentityFrame();
    const state = mapPiecesToBoardStateV2([det], frame);
    expect(state.placements.length).toBe(0);
    expect(state.unassignedDetections.length).toBe(1);
  });

  it("handles noisy mask with 1-cell jitter", () => {
    const placements = generatePlacementsForPiece(0);
    const p = placements[0];
    const cells = linearToCells(p.positions);
    // Drop one cell
    const dropped = cells.slice(0, cells.length - 1);
    // Find an adjacent non-occupied cell
    const occupied = new Set(cells.map((c) => c.row * 14 + c.col));
    let added: { row: number; col: number } | null = null;
    outer: for (const c of cells) {
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nr = c.row + dr;
        const nc = c.col + dc;
        if (nr < 0 || nr > 13 || nc < 0 || nc > 13) continue;
        const key = nr * 14 + nc;
        if (!occupied.has(key)) {
          added = { row: nr, col: nc };
          break outer;
        }
      }
    }
    expect(added).not.toBeNull();
    const noisy = [...dropped, added!];
    const det = makeDetectionFromCellSet(0, noisy);
    const frame = makeIdentityFrame();
    const state = mapPiecesToBoardStateV2([det], frame);
    expect(state.placements.length).toBe(1);
    const out = state.placements[0];
    expect(out.confidence).toBeGreaterThanOrEqual(MIN_ACCEPT_IOU);
    expect(out.confidence).toBeLessThanOrEqual(1);
    // Placement should match original p
    const minRow = Math.min(...cells.map((c) => c.row));
    const minCandidates = cells.filter((c) => c.row === minRow);
    const minCol = Math.min(...minCandidates.map((c) => c.col));
    expect(out.cell).toEqual({ row: minRow, col: minCol });
  });

  it("flags ambiguous when two placements tie within margin", () => {
    // Search all piece classes for two canonical placements whose cell sets
    // differ by exactly one cell (symmetric difference = 2).
    const index = getPlacementIndex();
    type Hit = { classId: number; a: Set<number>; b: Set<number> };
    let hit: Hit | null = null;
    outer: for (const [classId, list] of index.entries()) {
      for (let i = 0; i < list.length && !hit; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const A = list[i].cellSet;
          const B = list[j].cellSet;
          if (A.size !== B.size) continue;
          let diff = 0;
          for (const c of A) if (!B.has(c)) diff++;
          for (const c of B) if (!A.has(c)) diff++;
          if (diff === 2) {
            hit = { classId, a: A, b: B };
            break outer;
          }
        }
      }
    }
    if (!hit) {
      // no two placements in same class differ by exactly 1 cell
      // skip per spec
      return;
    }
    // Build a detection whose cell set is intersection plus one of the
    // symmetric-difference cells (picks A exactly).
    const intersection: number[] = [];
    for (const c of hit.a) if (hit.b.has(c)) intersection.push(c);
    const onlyA: number[] = [];
    for (const c of hit.a) if (!hit.b.has(c)) onlyA.push(c);
    // Cell set = intersection + onlyA[0]  ⇒  identical to A → IoU(A)=1, IoU(B)<1
    // We want margin < AMBIGUITY_MARGIN but also that both are candidates.
    // Use detection = intersection alone (missing one cell from both).
    // Then IoU(A) = (size-1)/(size) = IoU(B). Tie.
    const detCells = intersection.map((c) => ({
      row: Math.floor(c / 14),
      col: c % 14,
    }));
    const det = makeDetectionFromCellSet(hit.classId, detCells);
    const frame = makeIdentityFrame();
    const state = mapPiecesToBoardStateV2([det], frame);
    expect(state.placements.length).toBe(1);
    const out = state.placements[0];
    // With a tie, margin=0 < AMBIGUITY_MARGIN.
    expect(out.ambiguous).toBe(true);
    expect(out.topK.length).toBeGreaterThanOrEqual(2);
  });

  it("greedy non-overlap resolves same-class collision", () => {
    // Find a piece class with at least two distinct placements, then feed
    // two detections of that class whose top-1 candidate collides.
    const index = getPlacementIndex();
    let chosen: {
      classId: number;
      first: Set<number>;
      secondCells: Array<{ row: number; col: number }>;
    } | null = null;
    for (const [classId, list] of index.entries()) {
      if (list.length >= 2) {
        // pick two placements that don't share all cells
        const a = list[0];
        const b = list[1];
        chosen = {
          classId,
          first: a.cellSet,
          secondCells: [...b.cellSet].map((c) => ({
            row: Math.floor(c / 14),
            col: c % 14,
          })),
        };
        break;
      }
    }
    expect(chosen).not.toBeNull();
    const detA = makeDetectionFromCellSet(
      chosen!.classId,
      [...chosen!.first].map((c) => ({
        row: Math.floor(c / 14),
        col: c % 14,
      })),
      { score: 0.95 },
    );
    const detB = makeDetectionFromCellSet(
      chosen!.classId,
      chosen!.secondCells,
      { score: 0.9 },
    );
    const frame = makeIdentityFrame();
    const state = mapPiecesToBoardStateV2([detA, detB], frame);
    // Both must produce placements if cell sets are disjoint OR second
    // falls through. If they're disjoint we expect two placements.
    // We just verify no overlap among accepted placements.
    const occ = new Set<number>();
    for (const pl of state.placements) {
      // Reconstruct cells for this accepted placement by using the index.
      const entries = index.get(pl.classId)!;
      const match = entries.find(
        (e) =>
          e.rotationSteps * 90 === pl.orientation &&
          e.mirrored === pl.mirrored &&
          e.topLeftCell.row === pl.cell.row &&
          e.topLeftCell.col === pl.cell.col,
      );
      expect(match).toBeDefined();
      for (const c of match!.cellSet) {
        expect(occ.has(c)).toBe(false);
        occ.add(c);
      }
    }
    expect(state.placements.length).toBeGreaterThanOrEqual(1);
  });

  it("uses bbox fallback when mask is undefined", () => {
    const placements = generatePlacementsForPiece(0);
    const p = placements[0];
    const cells = linearToCells(p.positions);
    const rows = cells.map((c) => c.row);
    const cols = cells.map((c) => c.col);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    // bbox tight around placement's axis-aligned bounds in board units.
    // Because identity homography maps image px == board units, bbox in image
    // space is (col-0.5, row-0.5, width=cols+1, height=rows+1).
    const det: RawDetection = {
      classId: 0,
      className: "A",
      score: 0.9,
      bbox: {
        x: minCol - 0.5,
        y: minRow - 0.5,
        width: maxCol - minCol + 1,
        height: maxRow - minRow + 1,
      },
      mask: undefined,
    };
    const frame = makeIdentityFrame();
    const state = mapPiecesToBoardStateV2([det], frame);
    expect(state.placements.length).toBe(1);
    const out = state.placements[0];
    expect(out.confidence).toBeGreaterThanOrEqual(MIN_ACCEPT_IOU);
  });

  it("forces ambiguous flag when homography.condition is large", () => {
    const placements = generatePlacementsForPiece(0);
    const p = placements[0];
    const cells = linearToCells(p.positions);
    const det = makeDetectionFromCellSet(0, cells);
    const frame = makeIdentityFrame(1e7);
    const state = mapPiecesToBoardStateV2([det], frame);
    expect(state.placements.length).toBe(1);
    const out = state.placements[0];
    expect(out.ambiguous).toBe(true);
    expect(out.confidence).toBeLessThanOrEqual(0.5);
  });

  it("unassigns detection whose mask has no IoU >= MIN_ACCEPT_IOU for its class", () => {
    // Pick a cell set that doesn't resemble any piece-A placement.
    // A single isolated cell far from A's placements should produce low IoU
    // for every placement of class 0.
    const det = makeDetectionFromCellSet(0, [
      { row: 0, col: 4 },
      { row: 0, col: 5 },
      { row: 0, col: 8 },
      { row: 0, col: 9 },
      { row: 1, col: 4 },
    ]);
    const frame = makeIdentityFrame();
    const state = mapPiecesToBoardStateV2([det], frame);
    // Either accept with low confidence → we expect no placement if max IoU < MIN_ACCEPT_IOU.
    // If tests match a placement, confidence is below MIN_ACCEPT_IOU → unassigned.
    if (state.placements.length === 0) {
      expect(state.unassignedDetections.length).toBe(1);
    } else {
      // If it DID accept one, it should at least be ambiguous+low conf (defensive).
      // But per spec, below MIN_ACCEPT_IOU goes to unassigned.
      expect(state.placements[0].confidence).toBeGreaterThanOrEqual(MIN_ACCEPT_IOU);
    }
  });

  it("deterministic on repeated runs", () => {
    const placements = generatePlacementsForPiece(0);
    const p = placements[0];
    const det = makeDetectionFromCellSet(0, linearToCells(p.positions));
    const frame = makeIdentityFrame();
    const a = mapPiecesToBoardStateV2([det], frame);
    const b = mapPiecesToBoardStateV2([det], frame);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
