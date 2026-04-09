import { SegmentShape } from "./types";
import type {
  PieceDefinition,
  PieceOrientation,
  PieceOrientationWithTransform,
} from "./types";

const BIG_GRID_WIDTH = 40;
const BIG_GRID_HEIGHT = 40;
const BIG_GRID_CENTER_SHIFT = (BIG_GRID_HEIGHT / 2) * BIG_GRID_WIDTH + BIG_GRID_WIDTH / 2;

// Each row is [colFactor, rowFactor] for a 90° CCW rotation step applied in big-grid space.
const ROTATION_MATRIX: ReadonlyArray<readonly [number, number]> = [
  [-40, 1],
  [-1, -40],
  [40, -1],
];

export const ROTATION_SHAPE_MAP: ReadonlyArray<readonly SegmentShape[]> = [
  [SegmentShape.CURVE, SegmentShape.CROSS_EW, SegmentShape.CROSS_NS],
  [SegmentShape.CURVE, SegmentShape.CROSS_NS, SegmentShape.CROSS_EW],
  [SegmentShape.CURVE, SegmentShape.CROSS_EW, SegmentShape.CROSS_NS],
];

const REFLECTION_MATRIX: readonly [number, number] = [1, -40];

export const REFLECTION_SHAPE_MAP: readonly SegmentShape[] = [
  SegmentShape.CURVE,
  SegmentShape.CROSS_EW,
  SegmentShape.CROSS_NS,
];

function normalizeToMinimalPosition(positions: number[]): number[] {
  let minWidth = BIG_GRID_WIDTH;
  let minHeight = BIG_GRID_HEIGHT;

  for (const position of positions) {
    const width = position % BIG_GRID_WIDTH;
    const height = Math.floor(position / BIG_GRID_WIDTH);
    minWidth = Math.min(minWidth, width);
    minHeight = Math.min(minHeight, height);
  }

  const shift = minHeight * BIG_GRID_HEIGHT + minWidth;
  return positions.map((position) => position - shift);
}

function sortWithShapes(positions: number[], shapes: SegmentShape[]): PieceOrientation {
  const paired = positions.map((position, index) => ({ position, shape: shapes[index] }));
  paired.sort((a, b) => a.position - b.position);
  return {
    positions: paired.map((entry) => entry.position),
    shapes: paired.map((entry) => entry.shape),
  };
}

function areOrientationsIdentical(a: PieceOrientation, b: PieceOrientation): boolean {
  if (a.positions.length !== b.positions.length || a.shapes.length !== b.shapes.length) {
    return false;
  }
  for (let i = 0; i < a.positions.length; i += 1) {
    if (a.positions[i] !== b.positions[i] || a.shapes[i] !== b.shapes[i]) {
      return false;
    }
  }
  return true;
}

// Decompose a big-grid position into (remainder, quotient) for matrix multiplication.
function getKeys(value: number): [number, number] {
  const d = Math.floor((Math.abs(value) + 10) / BIG_GRID_WIDTH);
  if (value < 0) {
    const r = value + d * BIG_GRID_WIDTH;
    return [r, -d];
  }
  const r = value - d * BIG_GRID_WIDTH;
  return [r, d];
}

function recenterAndNormalize(positions: number[]): number[] {
  const centered = positions.map((position) => position + BIG_GRID_CENTER_SHIFT);
  return normalizeToMinimalPosition(centered);
}

function remapShapes(shapes: SegmentShape[], map: readonly SegmentShape[]): SegmentShape[] {
  return shapes.map((shape) => map[shape]);
}

function buildRotatedPositions(keys: [number, number][], matrix: readonly [number, number]): number[] {
  return keys.map(([x, y]) => x * matrix[0] + y * matrix[1]);
}

export function findAllOrientations(piece: PieceDefinition): PieceOrientation[] {
  return findAllOrientationsWithTransforms(piece).map((entry) => entry.orientation);
}

export function findAllOrientationsWithTransforms(piece: PieceDefinition): PieceOrientationWithTransform[] {
  const unique: PieceOrientationWithTransform[] = [];

  const baseNormalized = normalizeToMinimalPosition(piece.bigGridPositions);
  const baseSorted = sortWithShapes(baseNormalized, [...piece.shapes]);
  unique.push({
    orientation: baseSorted,
    transform: { rotationSteps: 0, mirrored: false },
  });

  const addIfUnique = (
    candidate: PieceOrientation,
    rotationSteps: 0 | 1 | 2 | 3,
    mirrored: boolean,
  ): void => {
    if (!unique.some((existing) => areOrientationsIdentical(existing.orientation, candidate))) {
      unique.push({ orientation: candidate, transform: { rotationSteps, mirrored } });
    }
  };

  let min = Math.min(...baseSorted.positions);
  let translated = baseSorted.positions.map((position) => position - min);
  const baseKeys = translated.map(getKeys);
  const baseShapes = [...baseSorted.shapes];

  ROTATION_MATRIX.forEach((matrix, rotationIndex) => {
    const rotated = buildRotatedPositions(baseKeys, matrix);
    const normalized = recenterAndNormalize(rotated);
    const remappedShapes = remapShapes(baseShapes, ROTATION_SHAPE_MAP[rotationIndex]);
    addIfUnique(sortWithShapes(normalized, remappedShapes), (rotationIndex + 1) as 1 | 2 | 3, false);
  });

  const reflected = buildRotatedPositions(baseKeys, REFLECTION_MATRIX);
  const reflectedNormalized = recenterAndNormalize(reflected);
  const reflectedShapes = remapShapes(baseShapes, REFLECTION_SHAPE_MAP);
  const reflectedSorted = sortWithShapes(reflectedNormalized, reflectedShapes);

  if (!unique.some((existing) => areOrientationsIdentical(existing.orientation, reflectedSorted))) {
    unique.push({
      orientation: reflectedSorted,
      transform: { rotationSteps: 0, mirrored: true },
    });

    min = Math.min(...reflectedSorted.positions);
    translated = reflectedSorted.positions.map((position) => position - min);
    const reflectedKeys = translated.map(getKeys);
    const reflectedBaseShapes = [...reflectedSorted.shapes];

    ROTATION_MATRIX.forEach((matrix, rotationIndex) => {
      const rotated = buildRotatedPositions(reflectedKeys, matrix);
      const normalized = recenterAndNormalize(rotated);
      const remappedShapes = remapShapes(reflectedBaseShapes, ROTATION_SHAPE_MAP[rotationIndex]);
      const candidate = sortWithShapes(normalized, remappedShapes);

      if (!unique.some((existing) => areOrientationsIdentical(existing.orientation, candidate))) {
        unique.push({
          orientation: candidate,
          transform: { rotationSteps: (rotationIndex + 1) as 1 | 2 | 3, mirrored: true },
        });
      }
    });
  }

  return unique;
}

export function adjustOrientationToBoard(
  orientation: PieceOrientation,
  boardWidth: number,
  boardHeight: number,
): PieceOrientation | null {
  let maxWidth = -1;
  let maxHeight = -1;

  for (const position of orientation.positions) {
    const width = position % BIG_GRID_WIDTH;
    const height = Math.floor(position / BIG_GRID_WIDTH);
    maxWidth = Math.max(maxWidth, width);
    maxHeight = Math.max(maxHeight, height);
  }

  if (maxWidth >= boardWidth || maxHeight >= boardHeight) {
    return null;
  }

  const adjusted = orientation.positions.map(
    (position) => boardWidth * Math.floor(position / BIG_GRID_WIDTH) + (position % BIG_GRID_WIDTH),
  );

  return {
    positions: adjusted,
    shapes: [...orientation.shapes],
  };
}
