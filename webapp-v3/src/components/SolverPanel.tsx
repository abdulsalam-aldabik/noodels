import type { AssignmentDiagnostics, SolverResult } from '../types';

interface SolverPanelProps {
  result: SolverResult | null;
  onSolve: () => void;
  onHint: () => void;
  solving: boolean;
  mappingDiagnostics: AssignmentDiagnostics | null;
  solveMode: 'auto' | 'safe' | 'force';
  onSetSolveMode: (mode: 'auto' | 'safe' | 'force') => void;
  solveStrategyLabel: string | null;
  solveStrategyReason: string | null;
  pendingUncertainCount: number;
  onApplyUncertain: () => void;
}

export function SolverPanel({
  result,
  onSolve,
  onHint,
  solving,
  mappingDiagnostics,
  solveMode,
  onSetSolveMode,
  solveStrategyLabel,
  solveStrategyReason,
  pendingUncertainCount,
  onApplyUncertain,
}: SolverPanelProps) {
  return (
    <div className="card">
      <div className="card__header">
        <div className="card__title">Solver</div>
      </div>

      {mappingDiagnostics && (
        <>
          <div className="perf-stats__grid" style={{ marginBottom: '16px' }}>
            <div className="perf-stat">
              <span className="perf-stat__value">{mappingDiagnostics.mode}</span>
              <span className="perf-stat__label">Mapper</span>
            </div>
            <div className="perf-stat">
              <span className="perf-stat__value">{mappingDiagnostics.elapsedMs.toFixed(0)}ms</span>
              <span className="perf-stat__label">Map Time</span>
            </div>
            <div className="perf-stat">
              <span className="perf-stat__value">{mappingDiagnostics.statesExplored.toLocaleString()}</span>
              <span className="perf-stat__label">Map States</span>
            </div>
            <div className="perf-stat">
              <span className="perf-stat__value">{mappingDiagnostics.uncertainCount}</span>
              <span className="perf-stat__label">Uncertain</span>
            </div>
            <div className="perf-stat">
              <span className="perf-stat__value">{mappingDiagnostics.branchesPrunedNoFit.toLocaleString()}</span>
              <span className="perf-stat__label">Pruned (No Fit)</span>
            </div>
            <div className="perf-stat">
              <span className="perf-stat__value">{mappingDiagnostics.branchesPrunedOpenSpace.toLocaleString()}</span>
              <span className="perf-stat__label">Pruned (Space)</span>
            </div>
          </div>

          {mappingDiagnostics.pieceSummaries.length > 0 && (
            <div className="mapping-piece-list" style={{ marginBottom: '16px' }}>
              <div className="mapping-piece-list__title">Template Quality by Piece</div>
              {mappingDiagnostics.pieceSummaries.map((summary) => (
                <div key={summary.pieceIndex} className="mapping-piece-item">
                  <div className="mapping-piece-item__head">
                    <strong>{summary.pieceLabel}</strong>
                    <span>{summary.candidateCount} cands</span>
                  </div>
                  <div className="mapping-piece-item__meta">
                    <span>top {summary.topScore.toFixed(2)}</span>
                    <span>IoU {summary.topIou.toFixed(2)}</span>
                    <span>cov {summary.topRecall.toFixed(2)}</span>
                    <span>span {summary.topSpanFit.toFixed(2)}</span>
                  </div>
                  <div className="mapping-piece-item__meta">
                    <span>selected {summary.selectedScore !== null ? summary.selectedScore.toFixed(2) : 'none'}</span>
                    <span>{summary.selectedUncertain ? 'uncertain' : 'stable'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {pendingUncertainCount > 0 && (
        <div style={{ marginBottom: '16px' }}>
          <button className="btn btn--secondary" onClick={onApplyUncertain} disabled={solving}>
            Apply {pendingUncertainCount} Uncertain Matches
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <button className={`btn ${solveMode === 'auto' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => onSetSolveMode('auto')} disabled={solving}>
          Auto
        </button>
        <button className={`btn ${solveMode === 'safe' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => onSetSolveMode('safe')} disabled={solving}>
          Use Safer Solve
        </button>
        <button className={`btn ${solveMode === 'force' ? 'btn--primary' : 'btn--secondary'}`} onClick={() => onSetSolveMode('force')} disabled={solving}>
          Apply All Anyway
        </button>
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
        <>
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
          {(solveStrategyLabel || solveStrategyReason) && (
            <div style={{ marginTop: '12px', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              {solveStrategyLabel && <div><strong>Strategy:</strong> {solveStrategyLabel}</div>}
              {solveStrategyReason && <div><strong>Reason:</strong> {solveStrategyReason}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
