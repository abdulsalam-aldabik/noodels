import { useCallback, useEffect, useRef, useState } from "react";
import { InferenceRunner } from "../inference/InferenceRunner";
import type { ModelStatus } from "../inference/InferenceRunner";
import { runScanPipeline } from "../pipeline/ScanPipeline";
import type { ScanPipelineConfig } from "../pipeline/ScanPipeline";
import type { CalibratedBoardRef, ScanDebug, ScanArtifacts } from "../vision/visionTypes";
import {
  drawCornersOverlay,
  drawYoloOverlay,
  drawRectifiedYoloOverlay,
} from "../pipeline/DebugArtifacts";
import { expectedRectifiedCellSpacing } from "../board/gridGeometry";
import { RECTIFIED_SIZE } from "../vision/RectifiedDetector";
import "../styles/app.css";
import "./scan-lab.css";

// ── Types ─────────────────────────────────────────────────────────────────────

type FileStatus = "pending" | "running" | "pass" | "fail";

interface ScanEntry {
  id: string;
  file: File;
  status: FileStatus;
  debug?: ScanDebug;
  boardRef?: CalibratedBoardRef;
  artifacts?: ScanArtifacts;
  error?: string;
}

interface ArtifactUrls {
  raw: string;
  yolo: string;
  corners: string;
  rectified: string;
  mapped: string;
}

interface SweepRow {
  topRatio: number;
  pieces: number;
  ambiguous: number;
  dropped: number;
  cellSpacingPx: number;
  score: number;
}

type ImageTab = "raw" | "yolo" | "corners" | "rectified" | "mapped";

// ── Helpers ───────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function revokeUrls(urls: ArtifactUrls | null): void {
  if (!urls) return;
  URL.revokeObjectURL(urls.raw);
  URL.revokeObjectURL(urls.yolo);
  URL.revokeObjectURL(urls.corners);
  URL.revokeObjectURL(urls.rectified);
  URL.revokeObjectURL(urls.mapped);
}

async function canvasToUrl(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 });
  return URL.createObjectURL(blob);
}

async function buildArtifactUrls(
  artifacts: ScanArtifacts,
  boardRef?: CalibratedBoardRef,
): Promise<ArtifactUrls> {
  const imgSrc = artifacts.imageSource;

  // Raw
  const w = imgSrc instanceof HTMLImageElement ? imgSrc.naturalWidth : imgSrc.width;
  const h = imgSrc instanceof HTMLImageElement ? imgSrc.naturalHeight : imgSrc.height;
  const rawCanvas = new OffscreenCanvas(w, h);
  rawCanvas.getContext("2d")!.drawImage(imgSrc as CanvasImageSource, 0, 0);
  const rawUrl = await canvasToUrl(rawCanvas);

  // YOLO overlay (full image detections)
  const yoloUrl = await canvasToUrl(drawYoloOverlay(imgSrc, artifacts.fullDetections));

  // Corners overlay (same path as automatic debug artifacts)
  const cornersUrl = await canvasToUrl(drawCornersOverlay(imgSrc, boardRef ?? null));

  // Rectified
  const rectifiedUrl = await canvasToUrl(artifacts.rectifiedCanvas);

  // Rectified + mapped (grid + covered cells overlay)
  const mappedUrl = await canvasToUrl(
    drawRectifiedYoloOverlay(
      artifacts.rectifiedCanvas,
      artifacts.rectifiedDetections,
      artifacts.rectifiedGeometry,
      artifacts.coveredCellsByClass,
    ),
  );

  return { raw: rawUrl, yolo: yoloUrl, corners: cornersUrl, rectified: rectifiedUrl, mapped: mappedUrl };
}

function sweepScore(pieces: number, ambiguous: number, dropped: number): number {
  return pieces * 1.5 - ambiguous * 0.6 - dropped * 1.2;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModelBadge({ status }: Readonly<{ status: ModelStatus }>) {
  if (status.state === "idle") return null;
  const cls = status.state === "ready" ? "sl-status--ready"
    : status.state === "error" ? "sl-status--error"
    : "sl-status--loading";
  const text = status.state === "ready" ? "Model ready"
    : status.state === "error" ? `Error: ${status.message}`
    : "Model loading…";
  return <span className={`sl-status ${cls}`}>{text}</span>;
}

function FileStatusIcon({ status }: Readonly<{ status: FileStatus }>) {
  const cls = `sl-file-status sl-file-status--${status}`;
  const icon = status === "pending" ? "○" : status === "running" ? "⟳" : status === "pass" ? "✓" : "✗";
  return <span className={cls}>{icon}</span>;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ScanLabPage() {
  const [modelStatus, setModelStatus] = useState<ModelStatus>(
    InferenceRunner.getInstance().status,
  );

  const [entries, setEntries] = useState<ScanEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [testImageFiles, setTestImageFiles] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<ImageTab>("mapped");
  const [artifactUrls, setArtifactUrls] = useState<ArtifactUrls | null>(null);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [busyText, setBusyText] = useState("");
  const [errorText, setErrorText] = useState("");
  const [sweepRows, setSweepRows] = useState<SweepRow[]>([]);

  // Config state
  const [topRatio, setTopRatio] = useState(0.10);
  const [sideRatio, setSideRatio] = useState(0.03);
  const [bottomRatio, setBottomRatio] = useState(0.03);
  const [marginCells, setMarginCells] = useState(1.0);

  const urlsRef = useRef<ArtifactUrls | null>(null);

  useEffect(() => {
    const runner = InferenceRunner.getInstance();
    if (runner.status.state === "idle") runner.load().catch(() => {});
    return runner.onStatusChange(setModelStatus);
  }, []);

  // Fetch available test images from the dev server
  useEffect(() => {
    fetch("/__test-images/")
      .then((r) => r.json() as Promise<string[]>)
      .then((files) => setTestImageFiles(files))
      .catch(() => { /* not in dev mode or no test-images dir */ });
  }, []);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => { revokeUrls(urlsRef.current); };
  }, []);

  const applyUrls = useCallback((next: ArtifactUrls) => {
    revokeUrls(urlsRef.current);
    urlsRef.current = next;
    setArtifactUrls(next);
  }, []);

  // ── Load test images from dev server ─────────────────────────────────────

  const loadTestImages = useCallback(async () => {
    if (testImageFiles.length === 0) return;
    setBusyText("Loading test images…");
    try {
      const newEntries: ScanEntry[] = [];
      for (const filename of testImageFiles) {
        const resp = await fetch(`/__test-images/${encodeURIComponent(filename)}`);
        if (!resp.ok) continue;
        const blob = await resp.blob();
        const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
        newEntries.push({ id: uid(), file, status: "pending" });
      }
      setEntries((prev) => {
        const existing = new Set(prev.map((e) => e.file.name));
        const fresh = newEntries.filter((e) => !existing.has(e.file.name));
        const next = [...prev, ...fresh];
        if (!selectedId && next.length > 0) setSelectedId(next[0].id);
        return next;
      });
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyText("");
    }
  }, [testImageFiles, selectedId]);

  // ── File selection ────────────────────────────────────────────────────────

  const onFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const newEntries: ScanEntry[] = files.map((f) => ({ id: uid(), file: f, status: "pending" }));
    setEntries((prev) => [...prev, ...newEntries]);
    if (!selectedId && newEntries.length > 0) setSelectedId(newEntries[0].id);
    e.target.value = "";
  }, [selectedId]);

  const selectEntry = useCallback((id: string) => {
    setSelectedId(id);
    setSweepRows([]);
    setJsonOpen(false);
    setErrorText("");
  }, []);

  // ── Build config ──────────────────────────────────────────────────────────

  const buildConfig = useCallback((opts?: { returnArtifacts?: boolean }): ScanPipelineConfig => ({
    boardInset: { topRatio, sideRatio, bottomRatio },
    marginCells,
    returnArtifacts: opts?.returnArtifacts ?? false,
  }), [topRatio, sideRatio, bottomRatio, marginCells]);

  // ── Run single ────────────────────────────────────────────────────────────

  const runEntry = useCallback(async (id: string) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;

    setBusyText(`Running ${entry.file.name}…`);
    setErrorText("");
    setSweepRows([]);

    setEntries((prev) =>
      prev.map((e) => e.id === id ? { ...e, status: "running" } : e),
    );

    try {
      const result = await runScanPipeline(entry.file, "upload", buildConfig({ returnArtifacts: true }));

      if (!result.ok) {
        setEntries((prev) =>
          prev.map((e) => e.id === id
            ? { ...e, status: "fail", debug: result.debug, error: result.error }
            : e),
        );
        setErrorText(result.error);
        return;
      }

      const newEntry: ScanEntry = {
        ...entry,
        status: "pass",
        debug: result.debug,
        boardRef: result.boardRef,
        artifacts: result._artifacts,
      };
      setEntries((prev) => prev.map((e) => e.id === id ? newEntry : e));

      if (result._artifacts) {
        const urls = await buildArtifactUrls(result._artifacts, result.boardRef);
        applyUrls(urls);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setEntries((prev) =>
        prev.map((e) => e.id === id ? { ...e, status: "fail", error: msg } : e),
      );
      setErrorText(msg);
    } finally {
      setBusyText("");
    }
  }, [entries, buildConfig, applyUrls]);

  const runSelected = useCallback(() => {
    if (selectedId) void runEntry(selectedId);
  }, [selectedId, runEntry]);

  // ── Run all ───────────────────────────────────────────────────────────────

  const runAll = useCallback(async () => {
    const pending = entries.filter((e) => e.status !== "running");
    for (const entry of pending) {
      await runEntry(entry.id);
    }
  }, [entries, runEntry]);

  // ── Sweep top inset ───────────────────────────────────────────────────────

  const runSweep = useCallback(async () => {
    if (!selectedId) return;
    const entry = entries.find((e) => e.id === selectedId);
    if (!entry) return;

    setBusyText("Sweeping top inset values…");
    setErrorText("");
    setSweepRows([]);

    const steps = Array.from({ length: 11 }, (_, i) => 0.04 + i * 0.015); // 0.04–0.19
    const rows: SweepRow[] = [];

    try {
      for (const top of steps) {
        const cfg: ScanPipelineConfig = {
          boardInset: { topRatio: top, sideRatio, bottomRatio },
          marginCells,
          returnArtifacts: false,
        };
        const result = await runScanPipeline(entry.file, "upload", cfg);
        const d = result.ok ? result.debug : null;
        const pieces = d?.pieceMappings.length ?? 0;
        const ambiguous = d?.pieceMappings.filter((m) => m.ambiguous).length ?? 0;
        const dropped = d?.droppedPieces.length ?? 0;
        const csPx = d?.cellSpacingPx ?? 0;
        rows.push({ topRatio: top, pieces, ambiguous, dropped, cellSpacingPx: csPx, score: sweepScore(pieces, ambiguous, dropped) });
      }
      setSweepRows(rows);
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyText("");
    }
  }, [selectedId, entries, sideRatio, bottomRatio, marginCells]);

  // ── Derived state ─────────────────────────────────────────────────────────

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;
  const debug = selectedEntry?.debug ?? null;
  const artifacts = selectedEntry?.artifacts ?? null;

  const isBusy = busyText.length > 0;

  const expectedCellSpacingPx = expectedRectifiedCellSpacing(
    RECTIFIED_SIZE,
    artifacts?.rectifiedGeometry.marginCells ?? marginCells,
  );

  const tabUrl: Record<ImageTab, string | null> = {
    raw: artifactUrls?.raw ?? null,
    yolo: artifactUrls?.yolo ?? null,
    corners: artifactUrls?.corners ?? null,
    rectified: artifactUrls?.rectified ?? null,
    mapped: artifactUrls?.mapped ?? null,
  };

  // When selected entry changes and it already has artifacts, rebuild URLs
  useEffect(() => {
    if (!selectedEntry?.artifacts) return;
    void buildArtifactUrls(selectedEntry.artifacts, selectedEntry.boardRef)
      .then(applyUrls);
  // Only run when selectedId changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const bestSweepScore = sweepRows.length > 0
    ? Math.max(...sweepRows.map((r) => r.score))
    : -Infinity;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="scanlab-shell">
      {/* Header */}
      <header className="scanlab-header">
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <h1>Scan Debug Lab</h1>
          <ModelBadge status={modelStatus} />
        </div>
        <p>
          Full pipeline test harness — upload photos, tune parameters live, see every intermediate step.
          Open at <code>/dev/scan-lab</code> while running <code>npm run dev</code>.
        </p>
      </header>

      <div className="scanlab-body">
        {/* ── Sidebar ─────────────────────────────────────────────────────── */}
        <aside className="scanlab-sidebar">
          {/* Load from test-images/ dir */}
          {testImageFiles.length > 0 && (
            <button
              type="button"
              className="sl-btn sl-btn--primary"
              style={{ width: "100%", marginBottom: "0.4rem" }}
              disabled={isBusy}
              onClick={() => void loadTestImages()}
            >
              Load test images ({testImageFiles.length})
            </button>
          )}

          {/* Upload */}
          <label className="sl-upload-btn">
            Add images
            <input type="file" accept="image/*" multiple onChange={onFileChange} />
          </label>

          {/* File list */}
          <div className="sl-file-list">
            {entries.length === 0 && (
              <p style={{ fontSize: "0.82rem", color: "var(--ink-soft)", margin: 0 }}>
                No images uploaded yet.
              </p>
            )}
            {entries.map((entry) => {
              const passed = entry.status === "pass" && entry.debug;
              const pieces = passed ? entry.debug!.pieceMappings.length : 0;
              const dropped = passed ? entry.debug!.droppedPieces.length : 0;
              return (
                <div
                  key={entry.id}
                  className={`sl-file-item${entry.id === selectedId ? " sl-file-item--active" : ""}`}
                  onClick={() => selectEntry(entry.id)}
                >
                  <FileStatusIcon status={entry.status} />
                  <span className="sl-file-name" title={entry.file.name}>
                    {entry.file.name}
                  </span>
                  {passed && (
                    <span className={`sl-file-badge ${dropped === 0 ? "sl-file-badge--pass" : "sl-file-badge--fail"}`}>
                      {pieces - dropped}/{pieces}
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Batch summary */}
          {entries.some((e) => e.status === "pass" || e.status === "fail") && (
            <div className="sl-batch-section">
              <h3>Batch Summary</h3>
              <table className="sl-batch-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Pieces</th>
                    <th>Drop</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.filter((e) => e.status === "pass" || e.status === "fail").map((e) => {
                    const d = e.debug;
                    const pieces = d?.pieceMappings.length ?? 0;
                    const dropped = d?.droppedPieces.length ?? 0;
                    return (
                      <tr key={e.id} style={{ cursor: "pointer" }} onClick={() => selectEntry(e.id)}>
                        <td title={e.file.name}>{e.file.name.slice(0, 10)}{e.file.name.length > 10 ? "…" : ""}</td>
                        <td>{pieces}</td>
                        <td>{dropped}</td>
                        <td>{e.status === "pass" && dropped === 0 ? "✓" : e.status === "pass" ? "~" : "✗"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </aside>

        {/* ── Main area ────────────────────────────────────────────────────── */}
        <main className="scanlab-main">
          {/* Parameters */}
          <div className="sl-params-panel">
            <h2>Parameters</h2>
            <div className="sl-slider-grid">
              <label className="sl-slider-label">
                Top inset (hinge+frame): {(topRatio * 100).toFixed(1)}%
                <input type="range" min={0.01} max={0.25} step={0.005}
                  value={topRatio} onChange={(e) => setTopRatio(Number(e.target.value))} />
              </label>
              <label className="sl-slider-label">
                Side inset: {(sideRatio * 100).toFixed(1)}%
                <input type="range" min={0.005} max={0.10} step={0.002}
                  value={sideRatio} onChange={(e) => setSideRatio(Number(e.target.value))} />
              </label>
              <label className="sl-slider-label">
                Bottom inset: {(bottomRatio * 100).toFixed(1)}%
                <input type="range" min={0.005} max={0.10} step={0.002}
                  value={bottomRatio} onChange={(e) => setBottomRatio(Number(e.target.value))} />
              </label>
              <label className="sl-slider-label">
                Margin cells: {marginCells.toFixed(1)}
                <input type="range" min={0.5} max={2.5} step={0.1}
                  value={marginCells} onChange={(e) => setMarginCells(Number(e.target.value))} />
              </label>
            </div>
            <div className="sl-actions">
              <button className="sl-btn sl-btn--primary" type="button"
                disabled={isBusy || !selectedId} onClick={runSelected}>
                Run Selected
              </button>
              <button className="sl-btn" type="button"
                disabled={isBusy || entries.length === 0} onClick={() => void runAll()}>
                Run All
              </button>
              <button className="sl-btn" type="button"
                disabled={isBusy || !selectedId} onClick={() => void runSweep()}>
                Sweep Top Inset
              </button>
              {busyText && <p className="sl-busy-text">{busyText}</p>}
              {errorText && <p className="sl-error-text">{errorText}</p>}
            </div>
          </div>

          {/* No selection */}
          {!selectedEntry && (
            <div className="sl-empty-state">
              <h3>No image selected</h3>
              <p>Upload one or more photos and select one to inspect.</p>
            </div>
          )}

          {selectedEntry && (
            <>
              {/* Image tabs */}
              <div className="sl-image-section">
                <div className="sl-tab-bar">
                  {(["raw", "yolo", "corners", "rectified", "mapped"] as ImageTab[]).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      className={`sl-tab${activeTab === tab ? " sl-tab--active" : ""}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab === "raw" ? "Raw" : tab === "yolo" ? "YOLO" : tab === "corners" ? "Corners" : tab === "rectified" ? "Rectified" : "Mapped"}
                    </button>
                  ))}
                </div>
                <div className="sl-image-viewer">
                  {tabUrl[activeTab]
                    ? <img src={tabUrl[activeTab]!} alt={activeTab} />
                    : <span className="sl-image-placeholder">
                        {selectedEntry.status === "running" ? "Running…" : "No result yet. Click Run Selected."}
                      </span>
                  }
                </div>
              </div>

              {/* Geometry info */}
              {debug && (
                <div className="sl-card">
                  <p className="sl-section-title">Geometry</p>
                  <div className="sl-geometry-panel">
                    <div className={`sl-geometry-item ${Math.abs(debug.cellSpacingPx - expectedCellSpacingPx) < 1 ? "sl-geometry-item--ok" : "sl-geometry-item--warn"}`}>
                      <strong>Cell spacing </strong>
                      <span>{debug.cellSpacingPx.toFixed(3)} px </span>
                      <span style={{ fontSize: "0.75rem", opacity: 0.7 }}>
                        (want {expectedCellSpacingPx.toFixed(3)})
                      </span>
                    </div>
                    <div className="sl-geometry-item">
                      <strong>Board bbox </strong>
                      <span>
                        {debug.boardBbox
                          ? `[${debug.boardBbox.map((v) => v.toFixed(1)).join(", ")}]`
                          : "n/a"}
                      </span>
                    </div>
                    <div className="sl-geometry-item">
                      <strong>Corner source </strong>
                      <span>
                        {debug.boardCornerSource ?? "?"}
                        {typeof debug.boardCornerScore === "number" ? ` (score ${debug.boardCornerScore.toFixed(3)})` : ""}
                      </span>
                    </div>
                    <div className={`sl-geometry-item ${debug.hingeSnapped ? "sl-geometry-item--ok" : ""}`}>
                      <strong>Hinge snapped </strong>
                      <span>{debug.hingeSnapped ? "YES" : "no"}</span>
                    </div>
                    <div className="sl-geometry-item">
                      <strong>Board conf </strong>
                      <span>{(debug.boardConfidence * 100).toFixed(1)}%</span>
                    </div>
                    <div className="sl-geometry-item">
                      <strong>Rect. detections </strong>
                      <span>{debug.rectifiedDetectionsCount}</span>
                    </div>
                    {artifacts && (
                      <div className="sl-geometry-item">
                        <strong>Margin / scale </strong>
                        <span>
                          margin={artifacts.rectifiedGeometry.marginCells.toFixed(2)} (requested {marginCells.toFixed(2)})
                          {' '}→ scale={artifacts.rectifiedGeometry.gridToPixelScale.toFixed(3)}
                          , origin=({artifacts.rectifiedGeometry.boardOriginCol.toFixed(1)},
                          {artifacts.rectifiedGeometry.boardOriginRow.toFixed(1)})
                        </span>
                      </div>
                    )}
                    {artifacts?.rectifiedGeometry.candidateMarginsTried && artifacts.rectifiedGeometry.candidateMarginsTried.length > 1 && (
                      <div className="sl-geometry-item">
                        <strong>Margin candidates </strong>
                        <span>
                          [{artifacts.rectifiedGeometry.candidateMarginsTried.map((m) => m.toFixed(2)).join(", ")}], score={artifacts.rectifiedGeometry.selectionScore?.toFixed(2) ?? "n/a"}
                        </span>
                      </div>
                    )}
                    {debug.boardCornerCandidates.length > 0 && (
                      <div className="sl-geometry-item">
                        <strong>Corner candidates </strong>
                        <span>
                          {debug.boardCornerCandidates
                            .map((c) => `${c.selected ? "*" : ""}${c.source}:${c.score.toFixed(3)}${c.hingeSnapped ? ":hinge" : ""}${c.cornersClipped ? ":clipped" : ""}`)
                            .join(" | ")}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Piece mappings table */}
              {debug && debug.pieceMappings.length > 0 && (
                <div className="sl-card">
                  <p className="sl-section-title">Piece Mappings</p>
                  <div className="sl-mapping-table-wrap">
                    <table className="sl-mapping-table">
                      <thead>
                        <tr>
                          <th>Key</th>
                          <th>Det.Conf</th>
                          <th>Rect.px (col,row)</th>
                          <th>Board col/row</th>
                          <th>Cell [r,c]</th>
                          <th>CellConf</th>
                          <th>Ambig?</th>
                          <th>Dropped?</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debug.pieceMappings.map((m) => {
                          const bc = m.boardCentroid;
                          const rp = m.centroidRectifiedPx;
                          return (
                            <tr
                              key={m.classId}
                              className={`${m.dropped ? "sl-row--dropped" : ""}${m.ambiguous ? " sl-row--ambig" : ""}`}
                            >
                              <td><strong>{m.pieceKey}</strong> <span style={{ opacity: 0.5, fontSize: "0.75rem" }}>({m.classId})</span></td>
                              <td>{(m.confidence * 100).toFixed(0)}%</td>
                              <td>{rp ? `(${rp[0].toFixed(1)}, ${rp[1].toFixed(1)})` : "—"}</td>
                              <td>{bc ? `${bc[0].toFixed(2)} / ${bc[1].toFixed(2)}` : "—"}</td>
                              <td>[{m.candidateCell[0]}, {m.candidateCell[1]}]</td>
                              <td>{(m.cellConfidence * 100).toFixed(0)}%</td>
                              <td>
                                <span className={`sl-badge ${m.ambiguous ? "sl-badge--no" : "sl-badge--yes"}`}>
                                  {m.ambiguous ? "ambig" : "clean"}
                                </span>
                              </td>
                              <td>
                                {m.dropped
                                  ? <span className="sl-badge sl-badge--drop">DROPPED</span>
                                  : <span className="sl-badge sl-badge--yes">ok</span>
                                }
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Confirmed placements */}
              {debug && debug.confirmedPlacements.length > 0 && (
                <div className="sl-card">
                  <p className="sl-section-title">
                    Confirmed Placements ({debug.confirmedPlacements.length})
                  </p>
                  <div className="sl-placements-list">
                    {debug.confirmedPlacements.map((p) => (
                      <div key={p.classId} className="sl-placement-row">
                        <span className="sl-placement-key">{p.pieceKey}</span>
                        <span className="sl-placement-meta">
                          classId={p.classId} · orient={p.orientationIndex} · {p.positions.length} cells
                        </span>
                        <span className="sl-placement-cells">
                          [{p.positions.join(", ")}]
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Full image detections */}
              {debug && debug.allDetections.length > 0 && (
                <div className="sl-card">
                  <p className="sl-section-title">
                    Full-Image Detections ({debug.allDetections.length})
                  </p>
                  <div className="sl-mapping-table-wrap">
                    <table className="sl-mapping-table">
                      <thead>
                        <tr>
                          <th>Class</th>
                          <th>Label</th>
                          <th>Confidence</th>
                          <th>Centroid px</th>
                          <th>BBox</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debug.allDetections.map((d, i) => (
                          <tr key={i}>
                            <td>{d.classId}</td>
                            <td><strong>{d.label}</strong></td>
                            <td>{(d.confidence * 100).toFixed(0)}%</td>
                            <td>({d.centroid[0].toFixed(0)}, {d.centroid[1].toFixed(0)})</td>
                            <td style={{ fontSize: "0.73rem", opacity: 0.7 }}>
                              [{d.bbox.map((v) => v.toFixed(0)).join(", ")}]
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Warnings */}
              {debug && debug.warnings.length > 0 && (
                <div className="sl-card">
                  <p className="sl-section-title">Warnings ({debug.warnings.length})</p>
                  <div className="sl-warnings-list">
                    {debug.warnings.map((w, i) => (
                      <div key={i} className="sl-warning-item">{w}</div>
                    ))}
                  </div>
                </div>
              )}

              {/* Timings */}
              {debug && (
                <div className="sl-card">
                  <p className="sl-section-title">Timings</p>
                  <div className="sl-geometry-panel">
                    {Object.entries(debug.timings).map(([key, ms]) => (
                      <div key={key} className="sl-geometry-item">
                        <strong>{key} </strong>
                        <span>{(ms as number).toFixed(1)}ms</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sweep results */}
              {sweepRows.length > 0 && (
                <div className="sl-card">
                  <p className="sl-section-title">Top Inset Sweep Results</p>
                  <div className="sl-sweep-wrap">
                    <table className="sl-sweep-table">
                      <thead>
                        <tr>
                          <th>Top %</th>
                          <th>Pieces</th>
                          <th>Ambig</th>
                          <th>Dropped</th>
                          <th>Scale px</th>
                          <th>Score</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sweepRows.map((row) => (
                          <tr key={row.topRatio} className={row.score === bestSweepScore ? "sl-best-row" : ""}>
                            <td>{(row.topRatio * 100).toFixed(1)}%</td>
                            <td>{row.pieces}</td>
                            <td>{row.ambiguous}</td>
                            <td>{row.dropped}</td>
                            <td>{row.cellSpacingPx.toFixed(2)}</td>
                            <td>{row.score.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p style={{ fontSize: "0.78rem", color: "var(--ink-soft)", marginTop: "0.4rem" }}>
                    Best row highlighted. Score = pieces×1.5 − ambig×0.6 − dropped×1.2.
                    Cell spacing should stay near {expectedCellSpacingPx.toFixed(3)} for current margin.
                  </p>
                </div>
              )}

              {/* Debug JSON */}
              {debug && (
                <div>
                  <button className="sl-json-toggle" type="button" onClick={() => setJsonOpen((v) => !v)}>
                    {jsonOpen ? "▼" : "▶"} Debug JSON
                  </button>
                  {jsonOpen && (
                    <pre className="sl-json-pre">
                      {JSON.stringify(debug, null, 2)}
                    </pre>
                  )}
                </div>
              )}

              {/* Error from failed run */}
              {selectedEntry.status === "fail" && selectedEntry.error && (
                <div className="sl-card">
                  <p className="sl-section-title">Error</p>
                  <div className="sl-warning-item" style={{ color: "#ffc4c4", borderLeftColor: "rgba(255,99,99,0.5)", background: "rgba(255,99,99,0.1)" }}>
                    {selectedEntry.error}
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
