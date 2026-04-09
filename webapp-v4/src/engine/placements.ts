import { NoodlesBoard } from "./board";
import { IQ_NOODLES_PIECES } from "./constants";
import { adjustOrientationToBoard, findAllOrientationsWithTransforms } from "./orientation";
import type { PiecePlacement } from "./types";

export function generatePlacementsForPiece(pieceId: number, board = new NoodlesBoard()): PiecePlacement[] {
  const piece = IQ_NOODLES_PIECES[pieceId];
  if (!piece) {
    throw new Error(`Unknown piece id: ${pieceId}`);
  }

  const placements: PiecePlacement[] = [];
  const orientations = findAllOrientationsWithTransforms(piece);

  orientations.forEach((entry, orientationIndex) => {
    const adjusted = adjustOrientationToBoard(entry.orientation, board.width, board.height);
    if (!adjusted) {
      return;
    }

    let maxWidth = 0;
    let maxHeight = 0;
    adjusted.positions.forEach((position) => {
      maxWidth = Math.max(maxWidth, position % board.width);
      maxHeight = Math.max(maxHeight, Math.floor(position / board.width));
    });

    for (let h = 0; h < board.height - maxHeight; h += 1) {
      for (let w = 0; w < board.width - maxWidth; w += 1) {
        const shift = board.width * h + w;
        const translated = adjusted.positions.map((position) => position + shift);

        if (board.areFree(translated)) {
          placements.push({
            pieceId,
            orientationIndex,
            positions: translated,
            shapes: [...adjusted.shapes],
            rotationSteps: entry.transform.rotationSteps,
            mirrored: entry.transform.mirrored,
          });
        }
      }
    }
  });

  return placements;
}

export function generatePlacementsForAllPieces(board = new NoodlesBoard()): PiecePlacement[][] {
  return IQ_NOODLES_PIECES.map((piece) => generatePlacementsForPiece(piece.id, board));
}
