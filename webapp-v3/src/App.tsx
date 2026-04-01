import { useReducer, useEffect, useCallback } from 'react';
import { loadModel, onModelStatus, runInference } from './engine/inference';
import { autocalibrate } from './engine/autocalibrate';
import { mapDetectionsToBoard } from './engine/gridMapper';
import { solve, getHint } from './board/solver';
import { BoardState } from './board/board';
import { ImageCapture } from './components/ImageCapture';
import { DetectionOverlay } from './components/DetectionOverlay';
import { PieceLegend } from './components/PieceLegend';
import { SolverPanel } from './components/SolverPanel';
import { StatusBar } from './components/StatusBar';
import { PerformanceStats } from './components/PerformanceStats';
import { BoardSvg } from './render/BoardSvg';
import type {
  Phase, ModelStatus, Detection, InferenceResult,
  CalibrationResult, PieceMapping, SolverResult, Placement,
} from './types';

import './index.css';

interface AppState {
  phase: Phase;
  modelStatus: ModelStatus;
  modelMessage: string;
  image: HTMLImageElement | null;
  inferenceResult: InferenceResult | null;
  detections: Detection[];
  calibration: CalibrationResult | null;
  mappings: PieceMapping[];
  boardState: BoardState;
  solverResult: SolverResult | null;
  hintPlacement: Placement | null;
  solving: boolean;
  error: string | null;
}

type Action =
  | { type: 'MODEL_STATUS'; status: ModelStatus; message?: string }
  | { type: 'START_PROCESSING'; image: HTMLImageElement }
  | { type: 'INFERENCE_COMPLETE'; result: InferenceResult; calibration: CalibrationResult | null; mappings: PieceMapping[]; boardState: BoardState }
  | { type: 'START_SOLVING' }
  | { type: 'SOLVE_COMPLETE'; result: SolverResult }
  | { type: 'HINT_COMPLETE'; placement: Placement | null; result: SolverResult | null }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'MODEL_STATUS':
      return { ...state, modelStatus: action.status, modelMessage: action.message || '' };
    case 'START_PROCESSING':
      return { ...state, phase: 'processing', image: action.image, error: null };
    case 'INFERENCE_COMPLETE':
      return {
        ...state, phase: 'results',
        inferenceResult: action.result,
        detections: action.result.detections,
        calibration: action.calibration,
        mappings: action.mappings,
        boardState: action.boardState,
        solverResult: null, hintPlacement: null,
      };
    case 'START_SOLVING':
      return { ...state, solving: true };
    case 'SOLVE_COMPLETE':
      return { ...state, solving: false, solverResult: action.result, phase: action.result.solved ? 'solved' : state.phase };
    case 'HINT_COMPLETE':
      return { ...state, solving: false, hintPlacement: action.placement, solverResult: action.result };
    case 'ERROR':
      return { ...state, phase: 'capture', error: action.message, solving: false };
    case 'RESET':
      return { ...initialState, modelStatus: state.modelStatus, modelMessage: state.modelMessage };
    default:
      return state;
  }
}

const initialState: AppState = {
  phase: 'capture',
  modelStatus: 'idle',
  modelMessage: '',
  image: null,
  inferenceResult: null,
  detections: [],
  calibration: null,
  mappings: [],
  boardState: new BoardState(),
  solverResult: null,
  hintPlacement: null,
  solving: false,
  error: null,
};

const PHASE_STEPS: { label: string; phase: Phase }[] = [
  { label: 'Capture', phase: 'capture' },
  { label: 'Detect', phase: 'processing' },
  { label: 'Map & Solve', phase: 'results' },
  { label: 'Hints', phase: 'solved' },
];

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    onModelStatus((status, message) => dispatch({ type: 'MODEL_STATUS', status, message }));
    loadModel().catch(() => {});
  }, []);

  const handleImageCaptured = useCallback(async (image: HTMLImageElement) => {
    dispatch({ type: 'START_PROCESSING', image });
    try {
      const result = await runInference(image);
      const calibration = autocalibrate(result.detections);
      const { mappings, boardState } = mapDetectionsToBoard(result.detections, calibration);
      dispatch({ type: 'INFERENCE_COMPLETE', result, calibration, mappings, boardState });
    } catch (e) {
      dispatch({ type: 'ERROR', message: String(e) });
    }
  }, []);

  const handleSolve = useCallback(() => {
    dispatch({ type: 'START_SOLVING' });
    setTimeout(() => {
      const result = solve(state.boardState);
      dispatch({ type: 'SOLVE_COMPLETE', result });
    }, 50);
  }, [state.boardState]);

  const handleHint = useCallback(() => {
    dispatch({ type: 'START_SOLVING' });
    setTimeout(() => {
      const hint = getHint(state.boardState);
      dispatch({
        type: 'HINT_COMPLETE',
        placement: hint?.placement || null,
        result: hint?.fullSolution || null,
      });
    }, 50);
  }, [state.boardState]);

  const currentPhaseIdx = PHASE_STEPS.findIndex(s => s.phase === state.phase);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header__inner">
          <div className="header__brand">
            <div className="header__logo">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div>
              <div className="header__title">IQ Noodles</div>
              <div className="header__subtitle">Puzzle Detection & Solver</div>
            </div>
          </div>
          <div className="header__status">
            <div className={`status-dot status-dot--${state.modelStatus}`} />
            <span className="header__status-text">
              {state.modelStatus === 'ready' ? 'Model Ready' : state.modelStatus === 'loading' ? 'Loading...' : state.modelStatus === 'error' ? 'Error' : 'Idle'}
            </span>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Phase bar */}
        <div className="phase-bar">
          {PHASE_STEPS.map((step, i) => (
            <div key={step.phase} style={{ display: 'flex', alignItems: 'center' }}>
              {i > 0 && <div className="phase-step__connector" />}
              <div className={`phase-step ${i <= currentPhaseIdx ? 'phase-step--active' : ''}`}>
                <span className="phase-step__number">{i + 1}</span>
                <span className="phase-step__label">{step.label}</span>
              </div>
            </div>
          ))}
        </div>

        <StatusBar modelStatus={state.modelStatus} statusMessage={state.modelMessage} />

        {state.error && (
          <div className="error-banner">! {state.error}</div>
        )}

        {/* Capture phase */}
        {state.phase === 'capture' && (
          <div className="section">
            <div className="card">
              <div className="card__header">
                <div className="card__title">Capture Board</div>
                <p className="card__description">Take or upload a photo of your IQ Noodles puzzle board</p>
              </div>
              <ImageCapture onImageCaptured={handleImageCaptured} disabled={state.modelStatus !== 'ready'} />
            </div>
          </div>
        )}

        {/* Processing phase */}
        {state.phase === 'processing' && (
          <div className="section">
            <div className="processing-indicator">
              <div className="processing-indicator__spinner" />
              Running inference...
            </div>
          </div>
        )}

        {/* Results / Solved phase */}
        {(state.phase === 'results' || state.phase === 'solved') && (
          <div className="section results-section">
            <div className="results-header">
              <div className="results-header__title">
                {state.phase === 'solved' ? 'Solution' : 'Detection Results'}
              </div>
              <div className="results-header__actions">
                <button className="btn btn--ghost" onClick={() => dispatch({ type: 'RESET' })}>
                  Start Over
                </button>
              </div>
            </div>

            <div className="board-layout">
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Detection overlay */}
                {state.image && (
                  <div className="card results-image-card">
                    <DetectionOverlay
                      image={state.image}
                      detections={state.detections}
                      calibration={state.calibration}
                    />
                  </div>
                )}

                {/* Board visualization */}
                <div className="card board-card">
                  <BoardSvg mappings={state.mappings} hintPlacement={state.hintPlacement} />
                </div>
              </div>

              <div className="board-sidebar">
                <PieceLegend detections={state.detections} />
                <SolverPanel
                  result={state.solverResult}
                  onSolve={handleSolve}
                  onHint={handleHint}
                  solving={state.solving}
                />
                {state.inferenceResult && <PerformanceStats result={state.inferenceResult} />}
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        Smart NV - Thomas More University
      </footer>
    </div>
  );
}
