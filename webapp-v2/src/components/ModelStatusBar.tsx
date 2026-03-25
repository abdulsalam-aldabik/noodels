import type { ModelStatus } from '../types';

interface ModelStatusBarProps {
  status: ModelStatus;
  progress?: string;
}

export function ModelStatusBar({ status, progress }: ModelStatusBarProps) {
  if (status === 'ready') return null;

  return (
    <div className={`model-status model-status--${status}`} id="model-status">
      {status === 'idle' && (
        <>
          <div className="model-status__icon">⏳</div>
          <span>Model not loaded</span>
        </>
      )}
      {status === 'loading' && (
        <>
          <div className="model-status__spinner" />
          <span>{progress || 'Loading YOLO model...'}</span>
        </>
      )}
      {status === 'error' && (
        <>
          <div className="model-status__icon">❌</div>
          <span>Failed to load model{progress ? `: ${progress}` : ''}</span>
        </>
      )}
    </div>
  );
}
