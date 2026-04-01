import { BoardState } from '../board/board';
import type { PieceMapping } from '../types';

export interface MappingValidationResult {
  boardState: BoardState;
  keptMappings: PieceMapping[];
  droppedMappings: PieceMapping[];
  reason: string;
}

export function buildBoardFromMappings(mappings: PieceMapping[]): BoardState {
  const board = new BoardState();
  for (const mapping of mappings) {
    if (!mapping.placement) continue;
    if (!board.areFree(mapping.placement.positions)) continue;
    board.place(mapping.placement.positions, mapping.placement.pieceIndex);
  }
  return board;
}

export function validateMappingsForSolve(
  mappings: PieceMapping[],
  options: { minConfidence?: number; maxDistance?: number } = {},
): MappingValidationResult {
  const minConfidence = options.minConfidence ?? 0.5;
  const maxDistance = options.maxDistance ?? 1.9;

  const board = new BoardState();
  const keptMappings: PieceMapping[] = [];
  const droppedMappings: PieceMapping[] = [];

  // Place highest-confidence mappings first to resolve overlap conflicts deterministically.
  const ordered = [...mappings]
    .filter(m => m.placement)
    .sort((a, b) => b.confidence - a.confidence);

  for (const mapping of ordered) {
    const distance = mapping.distanceBoardUnits ?? 0;
    const lowConfidence = mapping.confidence < minConfidence;
    const farDistance = distance > maxDistance;

    if (lowConfidence || farDistance) {
      droppedMappings.push(mapping);
      continue;
    }

    if (!board.areFree(mapping.placement!.positions)) {
      droppedMappings.push(mapping);
      continue;
    }

    board.place(mapping.placement!.positions, mapping.placement!.pieceIndex);
    keptMappings.push(mapping);
  }

  const reason =
    droppedMappings.length > 0
      ? `Filtered ${droppedMappings.length} risky/overlapping mappings before solve`
      : 'Mapped board passed validation';

  return { boardState: board, keptMappings, droppedMappings, reason };
}
