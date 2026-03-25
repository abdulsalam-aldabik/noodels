interface PerformanceStatsProps {
  inferenceTimeMs: number;
  preprocessTimeMs: number;
  postprocessTimeMs: number;
  numDetections: number;
}

export function PerformanceStats({
  inferenceTimeMs,
  preprocessTimeMs,
  postprocessTimeMs,
  numDetections,
}: PerformanceStatsProps) {
  const totalMs = inferenceTimeMs + preprocessTimeMs + postprocessTimeMs;

  return (
    <div className="perf-stats" id="perf-stats">
      <h3 className="perf-stats__title">Performance</h3>
      <div className="perf-stats__grid">
        <div className="perf-stat">
          <span className="perf-stat__value">{totalMs.toFixed(0)}ms</span>
          <span className="perf-stat__label">Total</span>
        </div>
        <div className="perf-stat">
          <span className="perf-stat__value">{inferenceTimeMs.toFixed(0)}ms</span>
          <span className="perf-stat__label">Inference</span>
        </div>
        <div className="perf-stat">
          <span className="perf-stat__value">{preprocessTimeMs.toFixed(0)}ms</span>
          <span className="perf-stat__label">Preprocess</span>
        </div>
        <div className="perf-stat">
          <span className="perf-stat__value">{postprocessTimeMs.toFixed(0)}ms</span>
          <span className="perf-stat__label">Postprocess</span>
        </div>
        <div className="perf-stat">
          <span className="perf-stat__value">{numDetections}</span>
          <span className="perf-stat__label">Pieces Found</span>
        </div>
      </div>
    </div>
  );
}
