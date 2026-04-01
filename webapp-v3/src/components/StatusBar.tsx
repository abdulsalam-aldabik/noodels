import type { ModelStatus } from '../types';

interface StatusBarProps {
  modelStatus: ModelStatus;
  statusMessage?: string;
}

export function StatusBar({ modelStatus, statusMessage }: StatusBarProps) {
  if (modelStatus === 'ready') return null;

  const className = `model-status model-status--${modelStatus}`;

  return (
    <div className={className}>
      {modelStatus === 'loading' && <div className="model-status__spinner" />}
      {modelStatus === 'error' && <span className="model-status__icon">!</span>}
      <span>{statusMessage || (modelStatus === 'loading' ? 'Loading model...' : 'Model not loaded')}</span>
    </div>
  );
}
