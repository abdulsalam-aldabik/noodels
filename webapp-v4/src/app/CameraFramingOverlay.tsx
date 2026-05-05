/**
 * Task 6A — Camera Framing Overlay.
 *
 * Purely CSS/SVG framing guide shown on the live camera view.
 * Consists of:
 *   - A centered dashed square outline (~70% of the shorter screen dimension)
 *   - Four corner L-brackets
 *   - A center crosshair
 *   - Label text: "Align board corners to the brackets"
 *
 * Dismissible after first use (in-memory flag, not localStorage).
 */

interface CameraFramingOverlayProps {
  onDismiss: () => void;
}

export default function CameraFramingOverlay({ onDismiss }: CameraFramingOverlayProps) {
  return (
    <div className="framing-overlay" onClick={onDismiss} role="presentation">
      <svg
        className="framing-overlay-svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Dashed square outline */}
        <rect
          x="15"
          y="15"
          width="70"
          height="70"
          fill="none"
          stroke="rgba(255,255,255,0.4)"
          strokeWidth="0.3"
          strokeDasharray="2,2"
          rx="1"
        />

        {/* Corner L-brackets — TL */}
        <polyline
          points="15,25 15,15 25,15"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="0.6"
          strokeLinecap="round"
        />
        {/* TR */}
        <polyline
          points="75,15 85,15 85,25"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="0.6"
          strokeLinecap="round"
        />
        {/* BR */}
        <polyline
          points="85,75 85,85 75,85"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="0.6"
          strokeLinecap="round"
        />
        {/* BL */}
        <polyline
          points="25,85 15,85 15,75"
          fill="none"
          stroke="rgba(255,255,255,0.85)"
          strokeWidth="0.6"
          strokeLinecap="round"
        />

        {/* Center crosshair */}
        <line x1="48" y1="50" x2="52" y2="50" stroke="rgba(255,255,255,0.6)" strokeWidth="0.3" />
        <line x1="50" y1="48" x2="50" y2="52" stroke="rgba(255,255,255,0.6)" strokeWidth="0.3" />
      </svg>

      {/* Label text */}
      <div className="framing-overlay-label">
        Align board corners to the brackets
      </div>

      {/* Tap to dismiss hint */}
      <div className="framing-overlay-dismiss">
        Tap to dismiss
      </div>
    </div>
  );
}
