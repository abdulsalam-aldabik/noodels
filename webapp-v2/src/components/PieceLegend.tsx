import type { Detection } from '../types';

interface PieceLegendProps {
  detections: Detection[];
}

/**
 * Visual legend showing all 11 IQ Noodles pieces with their detection status.
 * Detected pieces show confidence; undetected pieces are dimmed.
 */
export function PieceLegend({ detections }: PieceLegendProps) {
  // Build a map of detected pieces
  const detectedMap = new Map<string, Detection>();
  for (const det of detections) {
    const existing = detectedMap.get(det.label);
    if (!existing || det.confidence > existing.confidence) {
      detectedMap.set(det.label, det);
    }
  }

  return (
    <div className="piece-legend" id="piece-legend">
      <h3 className="piece-legend__title">Detected Pieces</h3>
      <div className="piece-legend__grid">
        {detections.length === 0 ? (
          <p className="piece-legend__empty">No pieces detected</p>
        ) : (
          detections
          .sort((a, b) => a.label.localeCompare(b.label))
          .map((det, i) => {
            const [r, g, b] = det.rgb;
            return (
              <div
                key={`${det.label}-${i}`}
                className="piece-chip piece-chip--detected"
              >
                <div
                  className="piece-chip__color"
                  style={{ backgroundColor: `rgb(${r}, ${g}, ${b})` }}
                />
                <div className="piece-chip__info">
                  <span className="piece-chip__label">{det.label}</span>
                  <span className="piece-chip__name">{det.colorName}</span>
                </div>
                <span className="piece-chip__confidence">
                  {(det.confidence * 100).toFixed(1)}%
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
