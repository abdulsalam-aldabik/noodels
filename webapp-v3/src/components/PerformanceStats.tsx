import type { InferenceResult } from '../types';

interface PerformanceStatsProps {
  result: InferenceResult;
}

export function PerformanceStats({ result }: PerformanceStatsProps) {
  const total = result.preprocessTimeMs + result.inferenceTimeMs + result.postprocessTimeMs;
  return (
    <div className="card">
      <div className="perf-stats__title">Performance</div>
      <div className="perf-stats__grid">
        <div className="perf-stat">
          <span className="perf-stat__value">{result.preprocessTimeMs.toFixed(0)}ms</span>
          <span className="perf-stat__label">Preprocess</span>
        </div>
        <div className="perf-stat">
          <span className="perf-stat__value">{result.inferenceTimeMs.toFixed(0)}ms</span>
          <span className="perf-stat__label">Inference</span>
        </div>
        <div className="perf-stat">
          <span className="perf-stat__value">{result.postprocessTimeMs.toFixed(0)}ms</span>
          <span className="perf-stat__label">Postprocess</span>
        </div>
        <div className="perf-stat">
          <span className="perf-stat__value">{total.toFixed(0)}ms</span>
          <span className="perf-stat__label">Total</span>
        </div>
      </div>
    </div>
  );
}
