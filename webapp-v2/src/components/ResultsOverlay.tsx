import { useEffect, useRef, useState, useCallback } from 'react';
import type { InferenceResult, Detection } from '../types';
import { computeHomography, REF_PIN_LABELS, REF_PIN_BOARD_COORDS } from '../board/homography';

interface ResultsOverlayProps {
  image: HTMLImageElement;
  result: InferenceResult;
  /** Called with the computed 9-element homography matrix whenever a point moves. */
  onCalibrationChange?: (H: number[]) => void;
}

// ─── Initial position helpers ─────────────────────────────────────────────────

/**
 * Estimate rectangular board bounds from detection bounding boxes (+ 20% padding).
 */
function estimateBoundsFromDetections(detections: Detection[]): {
  minX: number; minY: number; width: number; height: number;
} {
  if (detections.length === 0) return { minX: 100, minY: 100, width: 400, height: 400 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const det of detections) {
    const [x1, y1, x2, y2] = det.bbox;
    if (x1 < minX) minX = x1;
    if (y1 < minY) minY = y1;
    if (x2 > maxX) maxX = x2;
    if (y2 > maxY) maxY = y2;
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  return {
    minX: Math.max(0, minX - bw * 0.2),
    minY: Math.max(0, minY - bh * 0.2),
    width: bw * 1.4,
    height: bh * 1.4,
  };
}

/**
 * Project the 4 reference pins from board-space to pixel-space using linear mapping.
 * This gives reasonable starting positions that the user can then fine-tune.
 */
function initialRefPoints(
  detections: Detection[],
  imgW: number,
  imgH: number,
): [number, number][] {
  const bounds = estimateBoundsFromDetections(detections);
  const PIN_MIN = -7.9;
  const PIN_RANGE = 15.8;
  return REF_PIN_BOARD_COORDS.map(([bx, by]) => {
    const px = bounds.minX + ((bx - PIN_MIN) / PIN_RANGE) * bounds.width;
    const py = bounds.minY + ((by - PIN_MIN) / PIN_RANGE) * bounds.height;
    return [
      Math.max(0, Math.min(imgW, px)),
      Math.max(0, Math.min(imgH, py)),
    ] as [number, number];
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Interactive detection overlay with 4-point perspective calibration.
 *
 * The user drags 4 labelled reference dots to their corresponding physical pin
 * locations on the board in the photo. The component computes and emits a
 * perspective homography H (pixel → board space) whenever a point moves.
 *
 * Reference pins (board-space):
 *   Top   (pin  0): (-1.8, -5.6)
 *   Right (pin  8): ( 5.4, -1.8)
 *   Left  (pin 12): (-5.4,  1.8)
 *   Bottom(pin 20): ( 1.8,  5.4)
 */
export function ResultsOverlay({ image, result, onCalibrationChange }: ResultsOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const { width: imgW, height: imgH } = result.originalSize;

  // 4 draggable reference points in image-pixel space
  const [refPoints, setRefPoints] = useState<[number, number][]>(() =>
    initialRefPoints(result.detections, imgW, imgH),
  );

  const [activeIdx, setActiveIdx] = useState<number | null>(null);

  // Compute and emit homography whenever points change
  useEffect(() => {
    if (!onCalibrationChange) return;
    try {
      const H = computeHomography(refPoints as [number, number][]);
      onCalibrationChange(H);
    } catch {
      // Points may be temporarily collinear during drag — ignore
    }
  }, [refPoints, onCalibrationChange]);

  // ── Drag handlers ──
  const handlePointerDown = useCallback((e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    setActiveIdx(idx);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (activeIdx === null || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const scaleX = imgW / rect.width;
      const scaleY = imgH / rect.height;
      const mx = Math.max(0, Math.min(imgW, (e.clientX - rect.left) * scaleX));
      const my = Math.max(0, Math.min(imgH, (e.clientY - rect.top) * scaleY));
      setRefPoints((prev) => {
        const next = prev.map((p, i) => (i === activeIdx ? ([mx, my] as [number, number]) : p));
        return next;
      });
    },
    [activeIdx, imgW, imgH],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (activeIdx !== null) {
        setActiveIdx(null);
        (e.target as Element).releasePointerCapture(e.pointerId);
      }
    },
    [activeIdx],
  );

  // ── Static canvas: image + masks + boxes ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = imgW;
    canvas.height = imgH;
    ctx.drawImage(image, 0, 0, imgW, imgH);

    for (const det of result.detections) {
      if (det.mask) {
        const tmp = document.createElement('canvas');
        tmp.width = imgW;
        tmp.height = imgH;
        tmp.getContext('2d')!.putImageData(det.mask, 0, 0);
        ctx.drawImage(tmp, 0, 0);
      }
    }

    for (const det of result.detections) {
      const [x1, y1, x2, y2] = det.bbox;
      const [r, g, b] = det.rgb;
      ctx.strokeStyle = `rgba(${r},${g},${b},0.5)`;
      ctx.lineWidth = Math.max(2, Math.min(imgW, imgH) * 0.003);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const fontSize = Math.max(12, Math.min(imgW, imgH) * 0.02);
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      const labelText = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
      const tw = ctx.measureText(labelText).width;
      const padX = fontSize * 0.3;
      const padY = fontSize * 0.15;
      const lh = fontSize + padY * 2;
      const lw = tw + padX * 2;
      const ly = y1 - lh > 0 ? y1 - lh : y1;
      ctx.fillStyle = `rgba(${r},${g},${b},0.85)`;
      ctx.beginPath();
      ctx.roundRect(x1, ly, lw, lh, [4, 4, 0, 0]);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textBaseline = 'bottom';
      ctx.fillText(labelText, x1 + padX, ly + lh - padY);
    }
  }, [image, result, imgW, imgH]);

  // ── Coordinate helpers (image-pixel → CSS-percentage) ──
  const toPctX = (x: number) => `${(x / imgW) * 100}%`;
  const toPctY = (y: number) => `${(y / imgH) * 100}%`;

  // Colors and shapes for the 4 reference points
  const pointColors = ['#ff4d6d', '#4cc9f0', '#f8961e', '#90be6d'];
  const [tp, rp, lp, bp] = refPoints;

  return (
    <div
      ref={containerRef}
      className="results-overlay"
      id="results-overlay"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        className="results-canvas"
        style={{ display: 'block', width: '100%', height: 'auto' }}
      />

      {/* SVG Calibration Overlay */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <g
          style={{ pointerEvents: 'auto', touchAction: 'none' }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Calibration quadrilateral */}
          <polygon
            points={[tp, rp, bp, lp]
              .map(([x, y]) => `${toPctX(x)},${toPctY(y)}`)
              .join(' ')}
            fill="rgba(0,170,255,0.06)"
            stroke="rgba(0,170,255,0.5)"
            strokeWidth="1.5"
            strokeDasharray="6 4"
            pointerEvents="none"
          />

          {/* Diagonal cross-hairs between opposite points */}
          {[[tp, bp], [rp, lp]].map(([[ax, ay], [bx, by]], i) => (
            <line
              key={i}
              x1={toPctX(ax)} y1={toPctY(ay)}
              x2={toPctX(bx)} y2={toPctY(by)}
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="1"
              strokeDasharray="4 6"
              pointerEvents="none"
            />
          ))}

          {/* Draggable reference points */}
          {refPoints.map(([px, py], idx) => {
            const color = pointColors[idx];
            const label = REF_PIN_LABELS[idx];
            const isActive = activeIdx === idx;
            return (
              <g key={idx}>
                {/* Outer glow ring when active */}
                {isActive && (
                  <circle
                    cx={toPctX(px)} cy={toPctY(py)} r="18"
                    fill="none"
                    stroke={color}
                    strokeWidth="2"
                    strokeOpacity="0.4"
                    pointerEvents="none"
                  />
                )}
                {/* Hit area (invisible, larger) */}
                <circle
                  cx={toPctX(px)} cy={toPctY(py)} r="16"
                  fill="transparent"
                  onPointerDown={(e) => handlePointerDown(e, idx)}
                  style={{ cursor: 'crosshair' }}
                />
                {/* Visible dot */}
                <circle
                  cx={toPctX(px)} cy={toPctY(py)} r="7"
                  fill={color}
                  stroke="#fff"
                  strokeWidth="2"
                  pointerEvents="none"
                />
                {/* Label */}
                <text
                  x={toPctX(px)} y={toPctY(py - 14)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill="#fff"
                  fontSize="10"
                  fontWeight="700"
                  fontFamily="Inter, sans-serif"
                  pointerEvents="none"
                  style={{ textShadow: `0 1px 3px rgba(0,0,0,0.8)` }}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Help Banner */}
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.75)', color: 'white', padding: '6px 14px',
        borderRadius: 20, fontSize: 12, pointerEvents: 'none',
        backdropFilter: 'blur(4px)', border: '1px solid rgba(255,255,255,0.12)',
        fontWeight: 500, whiteSpace: 'nowrap',
      }}>
        Drag coloured dots to pin positions — Top · Right · Left · Bottom
      </div>
    </div>
  );
}
