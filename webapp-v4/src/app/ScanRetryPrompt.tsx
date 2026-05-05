/**
 * Task 6B — Retry Prompt on Detection Failure.
 *
 * Displayed when a scan triggers one of the retry conditions:
 *   - HOMOGRAPHY_UNSTABLE: condition number > 5000
 *   - GRID_MISALIGNED: gridFitResidualMax > 0.15
 *   - TOO_FEW_PLACED: placed < 5
 *   - HIGH_AMBIGUITY: ambiguous > placed
 *
 * Shows the failure message with an icon, a primary "Retake Photo" button,
 * and a secondary "Use Anyway" button that sets lowConfidence: true.
 */

import type { RetryInfo, RetryReason } from "../pipeline/types";

interface ScanRetryPromptProps {
  retryInfo: RetryInfo;
  onRetake: () => void;
  /** Called with lowConfidence=true flag. */
  onUseAnyway: () => void;
}

const RETRY_ICONS: Record<RetryReason, string> = {
  HOMOGRAPHY_UNSTABLE: "📐",
  GRID_MISALIGNED: "📏",
  TOO_FEW_PLACED: "🔍",
  HIGH_AMBIGUITY: "❓",
};

export default function ScanRetryPrompt({
  retryInfo,
  onRetake,
  onUseAnyway,
}: ScanRetryPromptProps) {
  const icon = retryInfo.retryReason ? RETRY_ICONS[retryInfo.retryReason] : "⚠️";

  return (
    <div className="scan-retry-prompt">
      <div className="scan-retry-card">
        <div className="scan-retry-icon">{icon}</div>
        <div className="scan-retry-message">
          {retryInfo.message ?? "Detection failed — please try again."}
        </div>
        <div className="scan-retry-actions">
          <button
            type="button"
            className="camera-btn camera-btn--confirm scan-retry-primary"
            onClick={onRetake}
          >
            Retake Photo
          </button>
          <button
            type="button"
            className="camera-btn camera-btn--ghost scan-retry-secondary"
            onClick={onUseAnyway}
          >
            Use Anyway
          </button>
        </div>
      </div>
    </div>
  );
}
