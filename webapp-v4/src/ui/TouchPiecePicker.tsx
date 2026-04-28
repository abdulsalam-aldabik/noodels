import { PIECE_ASSET_BY_ID } from "../pieces/assets";

import type { PieceStat } from "./PieceInventory";

export interface TouchPiecePickerProps {
  pieceStats: PieceStat[];
  selectedPieceId: number;
  onSelect: (pieceId: number) => void;
  onRotate: (pieceId: number) => void;
  onFlip: (pieceId: number) => void;
  onPickUp: (pieceId: number) => void;
}

/**
 * Phone-optimised replacement for the desktop PieceInventory card grid.
 * Horizontally-scrolling strip of large tap targets plus big round action
 * buttons for the currently-selected piece. The solver and board logic
 * upstream are unchanged.
 */
export default function TouchPiecePicker({
  pieceStats,
  selectedPieceId,
  onSelect,
  onRotate,
  onFlip,
  onPickUp,
}: Readonly<TouchPiecePickerProps>) {
  const selectedAsset = PIECE_ASSET_BY_ID[selectedPieceId];
  const selectedStat = pieceStats.find((p) => p.id === selectedPieceId);

  return (
    <div className="touch-picker">
      <div className="touch-picker-actions">
        <div className="touch-picker-selected">
          <span
            className="touch-picker-selected-swatch"
            style={{ background: selectedAsset.colorHex }}
            aria-hidden="true"
          />
          <div className="touch-picker-selected-label">
            <strong style={{ color: selectedAsset.colorHex }}>{selectedAsset.key}</strong>
            <span>{selectedAsset.colorName}</span>
          </div>
        </div>
        <div className="touch-picker-buttons">
          <button
            type="button"
            className="touch-action-btn"
            onClick={() => onRotate(selectedPieceId)}
            aria-label="Rotate piece"
          >
            <span aria-hidden="true">↻</span>
          </button>
          <button
            type="button"
            className="touch-action-btn"
            onClick={() => onFlip(selectedPieceId)}
            aria-label="Flip piece"
          >
            <span aria-hidden="true">⇄</span>
          </button>
          {selectedStat?.isPlaced && (
            <button
              type="button"
              className="touch-action-btn touch-action-btn--warn"
              onClick={() => onPickUp(selectedPieceId)}
              aria-label="Pick up placed piece"
            >
              <span aria-hidden="true">✕</span>
            </button>
          )}
        </div>
      </div>

      <div className="touch-picker-strip" role="listbox" aria-label="Pieces">
        {pieceStats.map((piece) => {
          const asset = PIECE_ASSET_BY_ID[piece.id];
          const isSelected = piece.id === selectedPieceId;
          return (
            <button
              type="button"
              key={piece.id}
              role="option"
              aria-selected={isSelected}
              className={`touch-piece-tile${isSelected ? " is-selected" : ""}${piece.isPlaced ? " is-placed" : ""}`}
              style={{ borderColor: isSelected ? asset.colorHex : undefined }}
              onClick={() => onSelect(piece.id)}
            >
              <span
                className="touch-piece-swatch"
                style={{ background: asset.colorHex }}
                aria-hidden="true"
              />
              <span className="touch-piece-key" style={{ color: asset.colorHex }}>
                {asset.key}
              </span>
              {piece.isPlaced && <span className="touch-piece-placed-mark" aria-hidden="true">•</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
