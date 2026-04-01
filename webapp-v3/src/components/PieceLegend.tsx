import { PIECE_COLORS } from '../constants';
import type { Detection } from '../types';
import { PIECE_CLASS_COUNT } from '../constants';

interface PieceLegendProps {
  detections: Detection[];
}

export function PieceLegend({ detections }: PieceLegendProps) {
  const pieces = detections.filter(d => d.classId < PIECE_CLASS_COUNT);

  return (
    <div className="card">
      <div className="piece-legend__title">Detected Pieces ({pieces.length}/11)</div>
      <div className="piece-legend__grid">
        {pieces.length === 0 ? (
          <div className="piece-legend__empty">No pieces detected</div>
        ) : (
          pieces
            .sort((a, b) => a.label.localeCompare(b.label))
            .map(det => {
              const info = PIECE_COLORS[det.label];
              if (!info) return null;
              const [r, g, b] = info.rgb;
              return (
                <div key={det.label} className="piece-chip piece-chip--detected">
                  <div className="piece-chip__color" style={{ background: `rgb(${r},${g},${b})` }} />
                  <div className="piece-chip__info">
                    <span className="piece-chip__label">{det.label}</span>
                    <span className="piece-chip__name">{info.name}</span>
                  </div>
                  <span className="piece-chip__confidence">{(det.confidence * 100).toFixed(0)}%</span>
                </div>
              );
            })
        )}
      </div>
    </div>
  );
}
