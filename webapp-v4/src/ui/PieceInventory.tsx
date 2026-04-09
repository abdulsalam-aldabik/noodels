import { useState } from "react";
import { PIECE_ASSET_BY_ID } from "../pieces/assets";
import PiecePreview3D from "../rendering/PiecePreview3D";

export interface PieceStat {
  id: number;
  orientations: number;
  isPlaced: boolean;
}

export interface PieceInventoryProps {
  pieceStats: PieceStat[];
  selectedPieceId: number;
  onSelect: (pieceId: number) => void;
  onRotate: (pieceId: number) => void;
  onFlip: (pieceId: number) => void;
  onPickUp: (pieceId: number) => void;
}

export default function PieceInventory({
  pieceStats,
  selectedPieceId,
  onSelect,
  onRotate,
  onFlip,
  onPickUp,
}: Readonly<PieceInventoryProps>) {
  const [isOpen, setIsOpen] = useState(true);
  const placedCount = pieceStats.filter((p) => p.isPlaced).length;

  return (
    <div className="piece-inventory">
      <button
        type="button"
        className="inventory-toggle"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
      >
        <span>Pieces <span className="inventory-count">({placedCount}/{pieceStats.length} placed)</span></span>
        <span className={`toggle-chevron${isOpen ? " open" : ""}`}>▼</span>
      </button>

      {isOpen && (
        <div className="piece-grid">
          {pieceStats.map((piece) => {
            const asset = PIECE_ASSET_BY_ID[piece.id];
            return (
              <article
                key={piece.id}
                className={`piece-card${selectedPieceId === piece.id ? " selected" : ""}${piece.isPlaced ? " placed" : ""}`}
              >
                <div className="piece-label">
                  <span className="piece-key" style={{ color: asset.colorHex }}>{asset.key}</span>
                  <span className="piece-color-name">{asset.colorName}</span>
                </div>

                <PiecePreview3D modelUrl={asset.objUrl} colorHex={asset.colorHex} />

                <div className="piece-actions">
                  <button type="button" aria-label="Select piece" onClick={() => onSelect(piece.id)}>
                    Use
                  </button>
                  <button type="button" aria-label="Rotate piece" onClick={() => onRotate(piece.id)}>
                    Rotate
                  </button>
                  <button type="button" aria-label="Flip piece" onClick={() => onFlip(piece.id)}>
                    Flip
                  </button>
                  {piece.isPlaced && (
                    <button type="button" aria-label="Pick up piece" onClick={() => onPickUp(piece.id)}>
                      Pick Up
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
