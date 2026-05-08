# IQ Noodles — Production Deployment Guide

## Running Locally (Boss Testing)

```bash
cd webapp-v4
npm install
npm run build
npm run preview
```

Open the URL printed in the terminal on any device on the same LAN.
No HTTPS certificate needed when accessing via `localhost` or `127.0.0.1`.

> **Note:** The camera requires a secure origin. On LAN (non-localhost), you must access the app via HTTPS. See hosting options below.

---

## Hosting Options

### Netlify
1. Push the repo to GitHub.
2. Connect the repo on [netlify.com](https://netlify.com).
3. Set build settings:
   - **Base directory:** `webapp-v4`
   - **Build command:** `npm run build`
   - **Publish directory:** `webapp-v4/dist`
4. Deploy. The `public/_headers` file is picked up automatically — no extra config needed.

### Vercel
1. Push the repo to GitHub.
2. Import the project on [vercel.com](https://vercel.com).
3. Set:
   - **Root directory:** `webapp-v4`
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
4. Deploy. The `vercel.json` file is picked up automatically.

### nginx (own server)
Build the app and copy `dist/` to your server's web root, then add to your nginx `server` block:

```nginx
add_header Cross-Origin-Embedder-Policy "require-corp" always;
add_header Cross-Origin-Opener-Policy   "same-origin"  always;
```

> **Why these headers?** ONNX Runtime Web uses SharedArrayBuffer for WASM multi-threading. Browsers block SharedArrayBuffer unless both COOP and COEP headers are present on every response.

---

## Dev vs Production

| Feature | Dev (`npm run dev`) | Production (`npm run build`) |
|---|---|---|
| Debug Panel (3D tuning sliders) | Visible via "Show Debug Panel" button | Removed from bundle |
| Scan Lab page (`/dev/scan-lab`) | Accessible | Removed from bundle |
| Piece Calibration (`/dev/piece-calibration`) | Accessible | Removed from bundle |
| Debug canvas artifacts (per-scan PNGs) | Rendered and saved to `phone-debug/` | Not rendered |
| Capture diagnostics (`console.info`) | Logged to console | Suppressed |
| `phone-debug/` folder | Auto-created by dev server | Never written |

---

## What Was Cleaned Up for Production

| File | Change |
|---|---|
| `src/app/IQNoodlesApp.tsx` | DebugPanel component gated behind `import.meta.env.DEV` |
| `src/ui/ControlBar.tsx` | "Show Debug Panel" toggle button gated behind `import.meta.env.DEV` |
| `src/pipeline/ScanPipeline.ts` | Canvas artifact rendering disabled by default in production |
| `src/app/CameraCaptureView.tsx` | Capture diagnostics log gated behind `import.meta.env.DEV` |
| `vite.config.ts` | Added `preview.headers` with COOP/COEP so `npm run preview` works |
| `public/_headers` | Netlify response headers (COOP/COEP) |
| `vercel.json` | Vercel response headers (COOP/COEP) |
| `.gitignore` | Added `webapp-v4/dist/` — build artifacts no longer committed |
