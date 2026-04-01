import type { SolverResult } from '../types';

interface SolverPanelProps {
  result: SolverResult | null;
  onSolve: () => void;
  onHint: () => void;
  solving: boolean;
}

export function SolverPanel({ result, onSolve, onHint, solving }: SolverPanelProps) {
  return (
    <div className="card">
      <div className="card__header">
        <div className="card__title">Solver</div>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
        <button className="btn btn--primary" onClick={onSolve} disabled={solving}>
          {solving ? 'Solving...' : 'Solve Puzzle'}
        </button>
        <button className="btn btn--secondary" onClick={onHint} disabled={solving}>
          Get Hint
        </button>
      </div>

      {result && (
        <div className="perf-stats__grid">
          <div className="perf-stat">
            <span className="perf-stat__value">{result.solved ? 'Yes' : result.timedOut ? 'Timeout' : 'No'}</span>
            <span className="perf-stat__label">Solved</span>
          </div>
          <div className="perf-stat">
            <span className="perf-stat__value">{result.timeMs.toFixed(0)}ms</span>
            <span className="perf-stat__label">Time</span>
          </div>
          <div className="perf-stat">
            <span className="perf-stat__value">{result.statesExplored.toLocaleString()}</span>
            <span className="perf-stat__label">States</span>
          </div>
        </div>
      )}
    </div>
  );
}
