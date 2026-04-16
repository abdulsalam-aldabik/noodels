import { useState } from "react";

import "../styles/app.css";

type Phase = "idle" | "capture" | "mapped";

/**
 * Minimal shell so the app boots while the vision pipeline is rebuilt in
 * phases. Phase 4 will replace this with a full capture → scan → render flow.
 */
export default function IQNoodlesApp() {
  const [phase, setPhase] = useState<Phase>("idle");

  return (
    <div className="iq-noodles-app">
      <header className="iq-noodles-header">
        <h1>IQ Noodles</h1>
        <p className="iq-noodles-subtitle">Vision pipeline — rebuild in progress</p>
      </header>

      <main className="iq-noodles-main">
        <section className="iq-noodles-card">
          <h2>Status</h2>
          <ul>
            <li>Board contracts: defined</li>
            <li>Board localization: scaffolding</li>
            <li>Rectification: scaffolding</li>
            <li>Piece mapping: pending</li>
          </ul>
          <p>
            Open <a href="/dev/scan-lab">/dev/scan-lab</a> to run the developer
            scan harness on a local image.
          </p>
          <div className="iq-noodles-actions">
            <button onClick={() => setPhase("capture")}>Start scan</button>
            {phase !== "idle" ? (
              <button onClick={() => setPhase("idle")}>Reset</button>
            ) : null}
          </div>
          <p>Current phase: <code>{phase}</code></p>
        </section>
      </main>
    </div>
  );
}
