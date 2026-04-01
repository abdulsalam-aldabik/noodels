import { useRef, useEffect } from 'react';
import type { Detection, CalibrationResult } from '../types';

interface DetectionOverlayProps {
  image: HTMLImageElement;
  detections: Detection[];
  calibration: CalibrationResult | null;
}

export function DetectionOverlay({ image, detections, calibration }: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d')!;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;

    // Draw original image
    ctx.drawImage(image, 0, 0);

    // Draw masks
    for (const det of detections) {
      if (det.mask) {
        ctx.globalAlpha = 0.4;
        ctx.putImageData(det.mask, 0, 0);
        ctx.globalAlpha = 1.0;
      }
    }

    // Draw bboxes and labels
    for (const det of detections) {
      const [x1, y1, x2, y2] = det.bbox;
      const [r, g, b] = det.rgb;
      const color = `rgb(${r},${g},${b})`;

      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);

      // Label background
      const text = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = 'bold 16px Inter, sans-serif';
      const metrics = ctx.measureText(text);
      ctx.fillStyle = color;
      ctx.fillRect(x1, y1 - 22, metrics.width + 8, 22);
      ctx.fillStyle = 'white';
      ctx.fillText(text, x1 + 4, y1 - 6);
    }

    // Draw auto-calibration board outline
    if (calibration) {
      const corners = calibration.boardCorners;
      ctx.strokeStyle = '#10b981';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.beginPath();
      ctx.moveTo(corners[0][0], corners[0][1]);
      for (let i = 1; i < corners.length; i++) {
        ctx.lineTo(corners[i][0], corners[i][1]);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);

      // Label corners
      const labels = ['TL', 'TR', 'BR', 'BL'];
      for (let i = 0; i < corners.length; i++) {
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(corners[i][0], corners[i][1], 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 12px Inter, sans-serif';
        ctx.fillText(labels[i], corners[i][0] + 10, corners[i][1] - 10);
      }
    }
  }, [image, detections, calibration]);

  return (
    <div className="results-overlay">
      <canvas ref={canvasRef} className="results-canvas" />
    </div>
  );
}
