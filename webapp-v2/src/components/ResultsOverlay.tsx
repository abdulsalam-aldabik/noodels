import { useEffect, useRef, useState } from 'react';
import type { InferenceResult, Detection } from '../types';

interface ResultsOverlayProps {
  image: HTMLImageElement;
  result: InferenceResult;
  onBoundsChange?: (bounds: { minX: number; minY: number; width: number; height: number }) => void;
}

export interface BoardBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/**
 * Helper to estimate initial board bounds from detections.
 */
function estimateBoardBounds(detections: Detection[]): BoardBounds {
  if (detections.length === 0) {
    return { minX: 100, minY: 100, width: 400, height: 400 };
  }
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
  const padX = bw * 0.2;
  const padY = bh * 0.2;

  return {
    minX: Math.max(0, minX - padX),
    minY: Math.max(0, minY - padY),
    width: bw + 2 * padX,
    height: bh + 2 * padY,
  };
}

/**
 * Interactive canvas overlay for detections + a draggable board calibration box.
 */
export function ResultsOverlay({ image, result, onBoundsChange }: ResultsOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The calibration box coordinates (in image pixel space)
  const [bounds, setBounds] = useState<BoardBounds>(() => estimateBoardBounds(result.detections));

  // Report bounds up to App
  useEffect(() => {
    onBoundsChange?.(bounds);
  }, [bounds, onBoundsChange]);

  // Handle resizing / dragging logic
  const [activeHandle, setActiveHandle] = useState<string | null>(null);

  const handlePointerDown = (e: React.PointerEvent, handle: string) => {
    e.preventDefault();
    setActiveHandle(handle);
    (e.target as Element).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!activeHandle || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    // Convert mouse coordinates to image pixel space
    const scaleX = result.originalSize.width / rect.width;
    const scaleY = result.originalSize.height / rect.height;

    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    setBounds((prev) => {
      let { minX, minY, width, height } = prev;
      let maxX = minX + width;
      let maxY = minY + height;

      if (activeHandle === 'tl') {
        minX = Math.min(mx, maxX - 20);
        minY = Math.min(my, maxY - 20);
      } else if (activeHandle === 'tr') {
        maxX = Math.max(mx, minX + 20);
        minY = Math.min(my, maxY - 20);
      } else if (activeHandle === 'bl') {
        minX = Math.min(mx, maxX - 20);
        maxY = Math.max(my, minY + 20);
      } else if (activeHandle === 'br') {
        maxX = Math.max(mx, minX + 20);
        maxY = Math.max(my, minY + 20);
      } else if (activeHandle === 'move') {
        // Just moving the whole box
        // To do this perfectly we need the start offset, but a simpler way:
        minX += e.movementX * scaleX;
        minY += e.movementY * scaleY;
        maxX = minX + width;
        maxY = minY + height;
      }

      // Constrain to image bounds
      minX = Math.max(0, Math.min(minX, result.originalSize.width - width));
      minY = Math.max(0, Math.min(minY, result.originalSize.height - height));

      return {
        minX,
        minY,
        width: maxX - minX,
        height: maxY - minY,
      };
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (activeHandle) {
      setActiveHandle(null);
      (e.target as Element).releasePointerCapture(e.pointerId);
    }
  };

  // Render the static canvas (image + masks + boxes)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { width, height } = result.originalSize;
    canvas.width = width;
    canvas.height = height;

    // Base image
    ctx.drawImage(image, 0, 0, width, height);

    // Masks
    for (const det of result.detections) {
      if (det.mask) {
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = width;
        tempCanvas.height = height;
        const tempCtx = tempCanvas.getContext('2d')!;
        tempCtx.putImageData(det.mask, 0, 0);
        ctx.drawImage(tempCanvas, 0, 0);
      }
    }

    // Boxes & Labels
    for (const det of result.detections) {
      const [x1, y1, x2, y2] = det.bbox;
      const [r, g, b] = det.rgb;

      ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, 0.5)`;
      ctx.lineWidth = Math.max(2, Math.min(width, height) * 0.003);
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      const labelText = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
      const fontSize = Math.max(12, Math.min(width, height) * 0.02);
      ctx.font = `600 ${fontSize}px Inter, sans-serif`;
      const textMetrics = ctx.measureText(labelText);
      const labelPadX = fontSize * 0.3;
      const labelPadY = fontSize * 0.15;
      const labelH = fontSize + labelPadY * 2;
      const labelW = textMetrics.width + labelPadX * 2;

      const labelY = y1 - labelH > 0 ? y1 - labelH : y1;
      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, 0.85)`;
      ctx.beginPath();
      ctx.roundRect(x1, labelY, labelW, labelH, [4, 4, 0, 0]);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.textBaseline = 'bottom';
      ctx.fillText(labelText, x1 + labelPadX, labelY + labelH - labelPadY);
    }
  }, [image, result]);

  // Helper to convert image pixel coordinates to CSS percentages for the SVG overlay
  const toPctX = (x: number) => (x / result.originalSize.width) * 100;
  const toPctY = (y: number) => (y / result.originalSize.height) * 100;

  return (
    <div
      ref={containerRef}
      className="results-overlay"
      id="results-overlay"
      style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}
    >
      <canvas ref={canvasRef} className="results-canvas" style={{ display: 'block', width: '100%', height: 'auto' }} />

      {/* Interactive Calibration Overlay */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none', // Let touches pass through except on our specific handles
        }}
      >
        <defs>
          <pattern id="gridPattern" width="14.28%" height="14.28%">
            <rect width="100%" height="100%" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          </pattern>
        </defs>

        <g
          style={{ pointerEvents: 'auto', touchAction: 'none' }}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
        >
          {/* Main Board Area (Draggable) */}
          <rect
            x={`${toPctX(bounds.minX)}%`}
            y={`${toPctY(bounds.minY)}%`}
            width={`${toPctX(bounds.width)}%`}
            height={`${toPctY(bounds.height)}%`}
            fill="rgba(0, 150, 255, 0.1)"
            stroke="#00aaff"
            strokeWidth="2"
            strokeDasharray="4 4"
            onPointerDown={(e) => handlePointerDown(e, 'move')}
            style={{ cursor: 'move' }}
          />

          {/* Grid lines inside the board area to help user align the pins */}
          <rect
            x={`${toPctX(bounds.minX)}%`}
            y={`${toPctY(bounds.minY)}%`}
            width={`${toPctX(bounds.width)}%`}
            height={`${toPctY(bounds.height)}%`}
            fill="url(#gridPattern)"
            pointerEvents="none"
          />

          {/* Corner Handles */}
          {[
            { id: 'tl', x: bounds.minX, y: bounds.minY, cursor: 'nwse-resize' },
            { id: 'tr', x: bounds.minX + bounds.width, y: bounds.minY, cursor: 'nesw-resize' },
            { id: 'bl', x: bounds.minX, y: bounds.minY + bounds.height, cursor: 'nesw-resize' },
            { id: 'br', x: bounds.minX + bounds.width, y: bounds.minY + bounds.height, cursor: 'nwse-resize' },
          ].map((handle) => (
            <circle
              key={handle.id}
              cx={`${toPctX(handle.x)}%`}
              cy={`${toPctY(handle.y)}%`}
              r="8"
              fill="#ffffff"
              stroke="#00aaff"
              strokeWidth="3"
              onPointerDown={(e) => handlePointerDown(e, handle.id)}
              style={{ cursor: handle.cursor }}
            />
          ))}
        </g>
      </svg>
      
      {/* Help Banner */}
      <div style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        background: 'rgba(0,0,0,0.7)', color: 'white', padding: '6px 12px',
        borderRadius: 20, fontSize: 13, pointerEvents: 'none', backdropFilter: 'blur(4px)',
        border: '1px solid rgba(255,255,255,0.1)', fontWeight: 500, whiteSpace: 'nowrap'
      }}>
        Adjust blue box to match board edges
      </div>
    </div>
  );
}
