import { useMemo, useRef, useState } from "react";

import { ScanPipeline, type MapperVersion } from "../pipeline/ScanPipeline";
import type { LocalizationVersion, ScanResult } from "../pipeline/types";

import "../styles/app.css";

type Tab = "raw" | "yolo" | "corners" | "rectified" | "mapped" | "report";

const TAB_LABELS: Record<Tab, string> = {
  raw: "Raw",
  yolo: "YOLO",
  corners: "Corners",
  rectified: "Rectified",
  mapped: "Mapped",
  report: "Report",
};

const BUILT_IN_FIXTURES = [
  "/test-images/20260312_131204.jpg",
  "/test-images/20260324_142332.jpg",
  "/test-images/20260324_150837.jpg",
  "/test-images/20260414_144554.jpg",
];

async function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

async function loadFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    return await loadImage(url);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

export default function ScanLabPage() {
  const pipelinesRef = useRef<Partial<Record<string, ScanPipeline>>>({});
  const [loadingModel, setLoadingModel] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [tab, setTab] = useState<Tab>("mapped");
  const [mapperVersion, setMapperVersion] = useState<MapperVersion>("v2");
  const [locVersion, setLocVersion] = useState<LocalizationVersion>("pins");

  const artifactUrls = useMemo(() => {
    if (!result) return null;
    const a = result.artifacts;
    return {
      raw: a.raw ? URL.createObjectURL(a.raw) : null,
      yolo: a.yolo ? URL.createObjectURL(a.yolo) : null,
      corners: a.corners ? URL.createObjectURL(a.corners) : null,
      rectified: a.rectified ? URL.createObjectURL(a.rectified) : null,
      mapped: a.mapped ? URL.createObjectURL(a.mapped) : null,
    };
  }, [result]);

  async function ensurePipeline(mapper: MapperVersion, loc: LocalizationVersion): Promise<ScanPipeline> {
    const key = `${mapper}+${loc}`;
    const existing = pipelinesRef.current[key];
    if (existing) return existing;

    setLoadingModel(true);
    try {
      const pipeline = new ScanPipeline({ mapperVersion: mapper, localizationVersion: loc });
      await pipeline.ensureLoaded();
      pipelinesRef.current[key] = pipeline;
      return pipeline;
    } finally {
      setLoadingModel(false);
    }
  }

  function onMapperVersionChange(version: MapperVersion) {
    if (version === mapperVersion) return;
    setMapperVersion(version);
    setResult(null);
    setError(null);
  }

  function onLocVersionChange(version: LocalizationVersion) {
    if (version === locVersion) return;
    setLocVersion(version);
    setResult(null);
    setError(null);
  }

  async function runOnImage(image: HTMLImageElement) {
    setRunning(true);
    setError(null);
    try {
      const pipeline = await ensurePipeline(mapperVersion, locVersion);
      const r = await pipeline.run(image);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = await loadFile(f);
    await runOnImage(img);
  }

  async function onFixture(url: string) {
    try {
      const img = await loadImage(url);
      await runOnImage(img);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div className="iq-noodles-app">
      <header className="iq-noodles-header">
        <h1>Scan Lab</h1>
        <p className="iq-noodles-subtitle">
          Phase 2 — Inference · BoardLocator · Rectifier
        </p>
      </header>

      <main className="iq-noodles-main">
        <section className="iq-noodles-card">
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <strong>Mapper:</strong>
            {(["v1", "v2"] as const).map((version) => (
              <button
                key={version}
                onClick={() => onMapperVersionChange(version)}
                disabled={running || loadingModel}
                style={{
                  fontWeight: mapperVersion === version ? 700 : 400,
                  textDecoration: mapperVersion === version ? "underline" : "none",
                }}
              >
                {version.toUpperCase()}
              </button>
            ))}

            <span style={{ marginLeft: 16 }} />
            <strong>Localization:</strong>
            {(["corners", "pins"] as const).map((version) => (
              <button
                key={version}
                onClick={() => onLocVersionChange(version)}
                disabled={running || loadingModel}
                style={{
                  fontWeight: locVersion === version ? 700 : 400,
                  textDecoration: locVersion === version ? "underline" : "none",
                }}
              >
                {version.toUpperCase()}
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input type="file" accept="image/*" onChange={onFile} />
            {BUILT_IN_FIXTURES.map((url) => (
              <button key={url} onClick={() => onFixture(url)}>
                {url.split("/").pop()}
              </button>
            ))}
          </div>
          <p>
            {loadingModel
              ? "Loading YOLO model…"
              : running
                ? `Running pipeline (${mapperVersion.toUpperCase()})…`
                : `Idle (${mapperVersion.toUpperCase()}).`}
          </p>
          {error ? <p style={{ color: "#ff6b6b" }}>Error: {error}</p> : null}
        </section>

        {result ? (
          <section className="iq-noodles-card">
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
              {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    fontWeight: tab === t ? 700 : 400,
                    textDecoration: tab === t ? "underline" : "none",
                  }}
                >
                  {TAB_LABELS[t]}
                </button>
              ))}
            </div>

            {tab === "report" ? (
              <pre style={{ maxHeight: 480, overflow: "auto", background: "#111", color: "#ccc", padding: 12 }}>
                {result.artifacts.report}
              </pre>
            ) : artifactUrls && artifactUrls[tab] ? (
              <img
                src={artifactUrls[tab]!}
                alt={tab}
                style={{ maxWidth: "100%", maxHeight: 640, background: "#222" }}
              />
            ) : (
              <p>No artifact for this tab (pipeline may have failed before producing it).</p>
            )}

            <ul style={{ fontSize: 12, lineHeight: 1.5 }}>
              <li>mapper: <code>{result.telemetry.mapping.mapperVersion}</code></li>
              <li>status: <code>{result.status}</code></li>
              <li>localization: <code>{result.telemetry.localization.version}</code></li>
              <li>board corners source: <code>{result.boardRef.cornerSource}</code></li>
              <li>corner score: <code>{result.boardRef.cornerScore.toFixed(3)}</code></li>
              {result.telemetry.localization.pin && (
                <>
                  <li>pin status: <code>{result.telemetry.localization.pin.status}</code></li>
                  <li>pins detected: <code>{result.telemetry.localization.pin.detectedPinCount}</code> · matched: <code>{result.telemetry.localization.pin.matchedPinCount}</code></li>
                  <li>pin residual mean: <code>{result.telemetry.localization.pin.residualMeanCells.toFixed(3)}</code> · max: <code>{result.telemetry.localization.pin.residualMaxCells.toFixed(3)}</code></li>
                </>
              )}
              <li>
                cellSpacingPx:{" "}
                <code>{result.rectified?.cellSpacingPx.toFixed(3) ?? "—"}</code>
              </li>
              <li>
                detections:{" "}
                <code>{result.inference.detections.length}</code> ·
                duration:{" "}
                <code>{result.inference.durationMs.toFixed(0)} ms</code>
              </li>
              <li>
                placed: <code>{result.boardState?.placements.length ?? 0}</code> ·
                unassigned: <code>{result.boardState?.unassignedDetections.length ?? 0}</code> ·
                ambiguous: <code>{result.boardState?.placements.filter(p => p.ambiguous).length ?? 0}</code>
              </li>
              <li>
                avg confidence:{" "}
                <code>
                  {result.boardState && result.boardState.placements.length > 0
                    ? (result.boardState.placements.reduce((s, p) => s + p.confidence, 0) / result.boardState.placements.length * 100).toFixed(1) + "%"
                    : "—"}
                </code>
              </li>
            </ul>
          </section>
        ) : null}
      </main>
    </div>
  );
}
