import { useReducer, useEffect, useCallback } from 'react';
import { loadModel, onModelStatus, runInference } from './engine/inference';
import { autocalibrate } from './engine/autocalibrate';
import { mapDetectionsToBoard } from './engine/gridMapper';
import { generateDetectionCandidates } from './engine/candidateGenerator';
import { optimizeGlobalAssignments } from './engine/globalAssignment';
import { DEFAULT_ASSIGNMENT_CONFIG } from './engine/mappingConfig';
import { validateMappingsForSolve } from './engine/mappingValidation';
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
  CalibrationResult, PieceMapping, SolverResult, Placement, AssignmentDiagnostics,
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
  mappingDiagnostics: AssignmentDiagnostics | null;
  pendingUncertainMappings: PieceMapping[] | null;
  boardState: BoardState;
  solveMode: 'auto' | 'safe' | 'force';
  solveStrategyLabel: string | null;
  solveStrategyReason: string | null;
  solverResult: SolverResult | null;
  hintPlacement: Placement | null;
  solving: boolean;
  error: string | null;
}

type Action =
  | { type: 'MODEL_STATUS'; status: ModelStatus; message?: string }
  | { type: 'START_PROCESSING'; image: HTMLImageElement }
  | {
      type: 'INFERENCE_COMPLETE';
      result: InferenceResult;
      calibration: CalibrationResult | null;
      mappings: PieceMapping[];
      boardState: BoardState;
      mappingDiagnostics: AssignmentDiagnostics;
      pendingUncertainMappings: PieceMapping[] | null;
    }
  | { type: 'START_SOLVING' }
  | { type: 'SOLVE_COMPLETE'; result: SolverResult; strategyLabel: string; strategyReason?: string }
  | { type: 'HINT_COMPLETE'; placement: Placement | null; result: SolverResult | null }
  | { type: 'SET_SOLVE_MODE'; mode: 'auto' | 'safe' | 'force' }
  | { type: 'APPLY_UNCERTAIN_MAPPINGS' }
  | { type: 'ERROR'; message: string }
  | { type: 'RESET' };

function buildBoardFromMappings(mappings: PieceMapping[]): BoardState {
  const board = new BoardState();
  for (const mapping of mappings) {
    if (mapping.placement && board.areFree(mapping.placement.positions)) {
      board.place(mapping.placement.positions, mapping.placement.pieceIndex);
    }
  }
  return board;
}

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
        mappingDiagnostics: action.mappingDiagnostics,
        pendingUncertainMappings: action.pendingUncertainMappings,
        solverResult: null, hintPlacement: null,
      };
    case 'START_SOLVING':
      return { ...state, solving: true };
    case 'SOLVE_COMPLETE':
      return {
        ...state,
        solving: false,
        solverResult: action.result,
        solveStrategyLabel: action.strategyLabel,
        solveStrategyReason: action.strategyReason || null,
        phase: action.result.solved ? 'solved' : state.phase,
      };
    case 'HINT_COMPLETE':
      return { ...state, solving: false, hintPlacement: action.placement, solverResult: action.result };
    case 'SET_SOLVE_MODE':
      return { ...state, solveMode: action.mode };
    case 'APPLY_UNCERTAIN_MAPPINGS':
      if (!state.pendingUncertainMappings) return state;
      return {
        ...state,
        mappings: state.pendingUncertainMappings,
        boardState: buildBoardFromMappings(state.pendingUncertainMappings),
        pendingUncertainMappings: null,
        solveStrategyReason: 'Applied uncertain mappings manually',
      };
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
  mappingDiagnostics: null,
  pendingUncertainMappings: null,
  boardState: new BoardState(),
  solveMode: 'auto',
  solveStrategyLabel: null,
  solveStrategyReason: null,
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

  const runStagedSolve = useCallback(() => {
    if (state.solveMode === 'force') {
      const forcedBoard = state.pendingUncertainMappings
        ? buildBoardFromMappings(state.pendingUncertainMappings)
        : state.boardState;
      return {
        result: solve(forcedBoard),
        strategyLabel: 'Force mapped board',
        strategyReason: state.pendingUncertainMappings
          ? 'Used all uncertain mappings before solve'
          : 'Solved directly from mapped board',
      };
    }

    if (state.solveMode === 'safe') {
      const validation = validateMappingsForSolve(
        state.pendingUncertainMappings ?? state.mappings,
        { minConfidence: 0.45, maxDistance: 0.75 },
      );
      return {
        result: solve(validation.boardState),
        strategyLabel: 'Safer mapped solve',
        strategyReason: validation.reason,
      };
    }

    const fromMapped = solve(state.boardState);
    if (fromMapped.solved) {
      return {
        result: fromMapped,
        strategyLabel: 'Auto: mapped board',
        strategyReason: 'Solved on first attempt from mapped state',
      };
    }

    const validation = validateMappingsForSolve(
      state.pendingUncertainMappings ?? state.mappings,
      { minConfidence: 0.45, maxDistance: 0.75 },
    );
    const fromSafe = solve(validation.boardState);
    if (fromSafe.solved) {
      return {
        result: fromSafe,
        strategyLabel: 'Auto: safer mapped solve',
        strategyReason: validation.reason,
      };
    }

    const fromEmpty = solve(new BoardState());
    return {
      result: fromEmpty,
      strategyLabel: 'Auto: empty-board fallback',
      strategyReason: 'Mapped state was contradictory; solved from empty board fallback',
    };
  }, [state.boardState, state.mappings, state.pendingUncertainMappings, state.solveMode]);

  useEffect(() => {
    onModelStatus((status, message) => dispatch({ type: 'MODEL_STATUS', status, message }));
    loadModel().catch(() => {});
  }, []);

  const handleImageCaptured = useCallback(async (image: HTMLImageElement) => {
    dispatch({ type: 'START_PROCESSING', image });
    try {
      const result = await runInference(image);
      const calibration = autocalibrate(result.detections);

      if (DEFAULT_ASSIGNMENT_CONFIG.mode === 'legacy') {
        const { mappings, boardState } = mapDetectionsToBoard(result.detections, calibration);
        dispatch({
          type: 'INFERENCE_COMPLETE',
          result,
          calibration,
          mappings,
          boardState,
          mappingDiagnostics: {
            mode: 'legacy',
            elapsedMs: 0,
            statesExplored: 0,
            branchesPrunedNoFit: 0,
            branchesPrunedOpenSpace: 0,
            timedOut: false,
            usedFallback: false,
            uncertainCount: 0,
            pieceSummaries: [],
          },
          pendingUncertainMappings: null,
        });
        return;
      }

      const candidates = generateDetectionCandidates(result.detections, calibration, DEFAULT_ASSIGNMENT_CONFIG);

      if (candidates.length === 0) {
        const { mappings, boardState } = mapDetectionsToBoard(result.detections, calibration);
        dispatch({
          type: 'INFERENCE_COMPLETE',
          result,
          calibration,
          mappings,
          boardState,
          mappingDiagnostics: {
            mode: 'global',
            elapsedMs: 0,
            statesExplored: 0,
            branchesPrunedNoFit: 0,
            branchesPrunedOpenSpace: 0,
            timedOut: false,
            usedFallback: true,
            uncertainCount: 0,
            pieceSummaries: [],
            reason: 'No global candidates available, used legacy mapper',
          },
          pendingUncertainMappings: null,
        });
        return;
      }

      const mappingResult = optimizeGlobalAssignments(result.detections, candidates, DEFAULT_ASSIGNMENT_CONFIG);
      dispatch({
        type: 'INFERENCE_COMPLETE',
        result,
        calibration,
        mappings: mappingResult.mappings,
        boardState: mappingResult.boardState,
        mappingDiagnostics: mappingResult.diagnostics,
        pendingUncertainMappings: mappingResult.pendingUncertainMappings,
      });
    } catch (e) {
      dispatch({ type: 'ERROR', message: String(e) });
    }
  }, []);

  const handleSolve = useCallback(() => {
    dispatch({ type: 'START_SOLVING' });
    setTimeout(() => {
      const solved = runStagedSolve();
      dispatch({
        type: 'SOLVE_COMPLETE',
        result: solved.result,
        strategyLabel: solved.strategyLabel,
        strategyReason: solved.strategyReason,
      });
    }, 50);
  }, [runStagedSolve]);

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

  let modelStatusLabel = 'Idle';
  if (state.modelStatus === 'ready') modelStatusLabel = 'Model Ready';
  if (state.modelStatus === 'loading') modelStatusLabel = 'Loading...';
  if (state.modelStatus === 'error') modelStatusLabel = 'Error';

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
            <span className="header__status-text">{modelStatusLabel}</span>
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
                  mappingDiagnostics={state.mappingDiagnostics}
                  solveMode={state.solveMode}
                  onSetSolveMode={(mode) => dispatch({ type: 'SET_SOLVE_MODE', mode })}
                  solveStrategyLabel={state.solveStrategyLabel}
                  solveStrategyReason={state.solveStrategyReason}
                  pendingUncertainCount={state.pendingUncertainMappings ? (state.mappingDiagnostics?.uncertainCount ?? 0) : 0}
                  onApplyUncertain={() => dispatch({ type: 'APPLY_UNCERTAIN_MAPPINGS' })}
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
