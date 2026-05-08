export interface ControlBarProps {
  onRotate: () => void;
  onFlip: () => void;
  onClear: () => void;
  onPlaceFirstFit: () => void;
  onValidate: () => void;
  onSolve: () => void;
  onHint: () => void;
  onToggleDebug: () => void;
  showDebug: boolean;
  solverStatus: string;
}

export default function ControlBar({
  onRotate,
  onFlip,
  onClear,
  onPlaceFirstFit,
  onValidate,
  onSolve,
  onHint,
  onToggleDebug,
  showDebug,
  solverStatus,
}: Readonly<ControlBarProps>) {
  return (
    <div className="controls-row">
      <button type="button" onClick={onRotate}>Rotate</button>
      <button type="button" onClick={onFlip}>Flip</button>
      <button type="button" onClick={onClear}>Clear</button>
      <button type="button" onClick={onPlaceFirstFit}>Place First Fit</button>
      <button type="button" onClick={onValidate}>Validate</button>
      <button type="button" onClick={onSolve}>Solve</button>
      <button type="button" onClick={onHint}>Hint</button>
      {import.meta.env.DEV && (
        <button type="button" onClick={onToggleDebug}>
          {showDebug ? "Hide Debug Panel" : "Show Debug Panel"}
        </button>
      )}
      {solverStatus && <span className="feedback-line">{solverStatus}</span>}
    </div>
  );
}
