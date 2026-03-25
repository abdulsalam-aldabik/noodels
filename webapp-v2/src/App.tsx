import { useState, useCallback, useEffect } from 'react';
import { loadModel, runInference, onModelStatus, isModelLoaded } from './inference';
import { ImageCapture } from './components/ImageCapture';
import { ResultsOverlay, type BoardBounds } from './components/ResultsOverlay';
import { PieceLegend } from './components/PieceLegend';
import { PerformanceStats } from './components/PerformanceStats';
import { ModelStatusBar } from './components/ModelStatusBar';
import { BoardView } from './components/BoardView';
import {
  BoardState,
  mapDetectionsToBoard,
  solve,
  type Placement,
  type SolverResult,
  type PieceMapping,
} from './board';
import { rectifyBoard, RECTIFIED_SIZE } from './board/boardRectifier';
import type { InferenceResult, ModelStatus } from './types';
import './index.css';

type AppPhase = 'capture' | 'results' | 'board' | 'solved';

function App() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [modelProgress, setModelProgress] = useState<string>('');
  const [capturedImage, setCapturedImage] = useState<HTMLImageElement | null>(null);
  const [result, setResult] = useState<InferenceResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<AppPhase>('capture');

  const [boardState, setBoardState] = useState<BoardState | null>(null);
  const [mappings, setMappings] = useState<PieceMapping[]>([]);
  const [solverResult, setSolverResult] = useState<SolverResult | null>(null);
  const [hintPlacement, setHintPlacement] = useState<Placement | null>(null);
  const [isSolving, setIsSolving] = useState(false);
  const [customBoardBounds, setCustomBoardBounds] = useState<BoardBounds | null>(null);
  const [rectifiedCanvas, setRectifiedCanvas] = useState<HTMLCanvasElement | null>(null);
  const [processingStage, setProcessingStage] = useState<string>('');

  // Load model on mount
  useEffect(() => {
    onModelStatus((status: ModelStatus, progress?: string) => {
      setModelStatus(status);
      if (progress) setModelProgress(progress);
    });
    loadModel().catch(console.error);
  }, []);

  const handleImageCaptured = useCallback(async (image: HTMLImageElement) => {
    setCapturedImage(image);
    setResult(null);
    setError(null);
    setRectifiedCanvas(null);
    setPhase('capture');

    if (!isModelLoaded()) {
      setError('Model is not loaded yet. Please wait.');
      return;
    }

    setIsProcessing(true);
    try {
      // Step 1: Rectify the image (detect board corners + perspective warp)
      setProcessingStage('Detecting board & rectifying...');
      const rectResult = await rectifyBoard(image);
      setRectifiedCanvas(rectResult.rectifiedCanvas);
      console.log(`📐 Board rectified (corners: ${JSON.stringify(rectResult.corners)})`);

      // Step 2: Run YOLO inference on the rectified image
      setProcessingStage('Running piece detection...');
      const inferenceResult = await runInference(rectResult.rectifiedCanvas);
      setResult(inferenceResult);
      setPhase('results');
    } catch (err) {
      console.error('Processing failed:', err);
      setError(`Processing failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
      setProcessingStage('');
    }
  }, []);

  const handleMapToBoard = useCallback(() => {
    if (!result) return;

    try {
      // When we have a rectified image, use fixed pin positions (exact coordinates)
      const rectifiedBounds = rectifiedCanvas
        ? { minX: 0, minY: 0, width: RECTIFIED_SIZE, height: RECTIFIED_SIZE }
        : undefined;

      const { mappings: newMappings, boardState: newBoard } = mapDetectionsToBoard(
        result.detections, 
        rectifiedBounds || customBoardBounds || undefined
      );
      
      setBoardState(newBoard);
      setMappings(newMappings);
      setSolverResult(null);
      setHintPlacement(null);
      setPhase('board');

      console.log(`📍 Mapped ${newMappings.length} detections to board pins (rectified: ${!!rectifiedCanvas})`);
    } catch (err) {
      console.error('Mapping failed:', err);
      setError(`Mapping failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [result, rectifiedCanvas, customBoardBounds]);

  const handleSolve = useCallback(() => {
    if (!boardState) return;

    setIsSolving(true);
    setError(null);

    // Run solver in a setTimeout to avoid blocking the UI
    setTimeout(() => {
      try {
        const result = solve(boardState, 5000);
        setSolverResult(result);

        if (result.solved) {
          // Find the first hint (first unplaced piece)
          const placed = boardState.getPlacedPieces();
          for (let i = 0; i < 11; i++) {
            if (!placed.has(i) && result.solution[i]) {
              setHintPlacement(result.solution[i]);
              break;
            }
          }
          setPhase('solved');
          console.log(`✅ Solved in ${result.timeMs.toFixed(0)}ms (${result.statesExplored} states explored)`);
        } else if (result.timedOut) {
          setError('Solver timed out. The detected piece positions may be incorrect.');
        } else {
          setError('No solution found. The detected piece positions may be incorrect.');
        }
      } catch (err) {
        console.error('Solver error:', err);
        setError(`Solver error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsSolving(false);
      }
    }, 50);
  }, [boardState]);

  const handleReset = useCallback(() => {
    setCapturedImage(null);
    setResult(null);
    setError(null);
    setPhase('capture');
    setBoardState(null);
    setMappings([]);
    setSolverResult(null);
    setHintPlacement(null);
  }, []);

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header__inner">
          <div className="header__brand">
            <div className="header__logo">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            </div>
            <div>
              <h1 className="header__title">IQ Noodles</h1>
              <p className="header__subtitle">Piece Detection System</p>
            </div>
          </div>
          <div className="header__status">
            <div className={`status-dot status-dot--${modelStatus}`} />
            <span className="header__status-text">
              {modelStatus === 'ready' ? 'Model Ready' :
               modelStatus === 'loading' ? 'Loading...' :
               modelStatus === 'error' ? 'Error' : 'Idle'}
            </span>
          </div>
        </div>
      </header>

      <main className="main">
        <ModelStatusBar status={modelStatus} progress={modelProgress} />

        {/* Phase indicator */}
        {phase !== 'capture' && (
          <div className="phase-bar" id="phase-bar">
            <div className={`phase-step ${phase === 'results' || phase === 'board' || phase === 'solved' ? 'phase-step--active' : ''}`}>
              <span className="phase-step__number">1</span>
              <span className="phase-step__label">Detect</span>
            </div>
            <div className="phase-step__connector" />
            <div className={`phase-step ${phase === 'board' || phase === 'solved' ? 'phase-step--active' : ''}`}>
              <span className="phase-step__number">2</span>
              <span className="phase-step__label">Map</span>
            </div>
            <div className="phase-step__connector" />
            <div className={`phase-step ${phase === 'solved' ? 'phase-step--active' : ''}`}>
              <span className="phase-step__number">3</span>
              <span className="phase-step__label">Solve</span>
            </div>
          </div>
        )}

        {/* Capture phase */}
        {phase === 'capture' && !result && (
          <section className="section">
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">
                  {isProcessing ? 'Analyzing...' : 'Capture Board'}
                </h2>
                <p className="card__description">
                  {isProcessing
                    ? 'Running YOLO inference on your image...'
                    : 'Take a top-down photo of your IQ Noodles board to detect pieces'}
                </p>
              </div>

              {isProcessing && (
                <div className="processing-indicator" id="processing-indicator">
                  <div className="processing-indicator__spinner" />
                  <span>{processingStage || 'Processing...'}</span>
                </div>
              )}

              <ImageCapture
                onImageCaptured={handleImageCaptured}
                disabled={modelStatus !== 'ready' || isProcessing}
              />
            </div>
          </section>
        )}

        {/* Results phase — detection overlay + sidebar */}
        {phase === 'results' && result && capturedImage && (
          <section className="section results-section">
            <div className="results-header">
              <h2 className="results-header__title">Detection Results</h2>
              <div className="results-header__actions">
                <button className="btn btn--primary" onClick={handleMapToBoard} id="btn-map-to-board">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <path d="M3 9h18M9 3v18" />
                  </svg>
                  Map to Board
                </button>
                <button className="btn btn--ghost" onClick={handleReset} id="btn-new-photo">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,4 1,10 7,10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Retake
                </button>
              </div>
            </div>

            <div className="results-grid">
              <div className="card results-image-card">
                <ResultsOverlay 
                  image={capturedImage} 
                  result={result} 
                  onBoundsChange={setCustomBoardBounds}
                />
              </div>
              <div className="results-sidebar">
                <div className="card">
                  <PieceLegend detections={result.detections} />
                </div>
                <div className="card">
                  <PerformanceStats
                    inferenceTimeMs={result.inferenceTimeMs}
                    preprocessTimeMs={result.preprocessTimeMs}
                    postprocessTimeMs={result.postprocessTimeMs}
                    numDetections={result.detections.length}
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Board phase — SVG board + mapping info */}
        {(phase === 'board' || phase === 'solved') && boardState && (
          <section className="section board-section">
            <div className="results-header">
              <h2 className="results-header__title">
                {phase === 'solved' ? 'Solution Found!' : 'Board Mapping'}
              </h2>
              <div className="results-header__actions">
                {phase === 'board' && (
                  <button
                    className="btn btn--primary"
                    onClick={handleSolve}
                    disabled={isSolving}
                    id="btn-solve"
                  >
                    {isSolving ? (
                      <>
                        <div className="processing-indicator__spinner" />
                        Solving...
                      </>
                    ) : (
                      <>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                        Get Hint
                      </>
                    )}
                  </button>
                )}
                <button className="btn btn--ghost" onClick={handleReset}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="1,4 1,10 7,10" />
                    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
                  </svg>
                  Start Over
                </button>
              </div>
            </div>

            <div className="board-layout">
              {/* Board SVG */}
              <div className="card board-card">
                <BoardView
                  boardState={boardState}
                  mappings={mappings}
                  hintPlacement={hintPlacement}
                />
              </div>

              {/* Sidebar */}
              <div className="board-sidebar">
                {/* Mapping summary */}
                <div className="card">
                  <h3 className="perf-stats__title">Piece Mapping</h3>
                  <div className="mapping-summary">
                    {mappings.map((m, i) => (
                      <div key={i} className="mapping-item">
                        <div
                          className="piece-chip__color"
                          style={{ backgroundColor: `rgb(${m.detection.rgb.join(',')})` }}
                        />
                        <span className="mapping-item__label">{m.detection.label}</span>
                        <span className="mapping-item__pins">→ Pin {m.pinIndices.join(', ')}</span>
                        <span className="piece-chip__confidence">
                          {(m.detection.confidence * 100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Solver results */}
                {solverResult && (
                  <div className="card">
                    <h3 className="perf-stats__title">Solver Results</h3>
                    <div className="perf-stats__grid">
                      <div className="perf-stat">
                        <span className="perf-stat__value">
                          {solverResult.solved ? '✅' : '❌'}
                        </span>
                        <span className="perf-stat__label">Status</span>
                      </div>
                      <div className="perf-stat">
                        <span className="perf-stat__value">{solverResult.timeMs.toFixed(0)}ms</span>
                        <span className="perf-stat__label">Time</span>
                      </div>
                      <div className="perf-stat">
                        <span className="perf-stat__value">{solverResult.statesExplored}</span>
                        <span className="perf-stat__label">States</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Detection image preview */}
                {capturedImage && result && (
                  <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                    <ResultsOverlay image={capturedImage} result={result} onBoundsChange={() => {}} />
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {error && (
          <div className="error-banner" id="error-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error}
          </div>
        )}
      </main>

      <footer className="footer">
        <p>Smart NV · IQ Noodles Detection MVP · YOLO26n-seg</p>
      </footer>
    </div>
  );
}

export default App;
