import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import fs from 'node:fs'
import path from 'node:path'

// Receive debug bundles posted by the running app and write them to
// <projectRoot>/phone-debug/<bundle>/<file>. Dev-only.
//
// Usage from the client:
//   POST /__debug-save?bundle=2026-04-29T13-42-00&name=raw.png
//   body: <raw bytes of file>
//
// The middleware sanitizes both query params, ensures the resolved path is
// inside phone-debug/, creates the directory if missing, and pipes the
// request body to disk. Concurrent uploads to the same bundle are safe
// because each file is its own write stream.
function debugSavePlugin(): PluginOption {
  // Project root is one level up from webapp-v4 — keeps debug output out of
  // the build directory and visible in the repo root, which is where the
  // user looks for it.
  const projectRoot = path.resolve(__dirname, '..')
  const baseDir = path.join(projectRoot, 'phone-debug')
  const sanitize = (s: string, allowDot = false) => {
    const allowed = allowDot ? /[^a-zA-Z0-9_.-]/g : /[^a-zA-Z0-9_-]/g
    return s.replace(allowed, '_').slice(0, 128) || 'unnamed'
  }
  return {
    name: 'iq-noodles-debug-save',
    configureServer(server) {
      server.middlewares.use('/__debug-save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('method not allowed')
          return
        }
        const url = new URL(req.url ?? '', 'http://localhost')
        const bundle = sanitize(url.searchParams.get('bundle') ?? 'unbundled')
        const name = sanitize(url.searchParams.get('name') ?? 'file.bin', true)
        const targetDir = path.join(baseDir, bundle)
        const targetPath = path.join(targetDir, name)
        if (!targetPath.startsWith(baseDir + path.sep)) {
          res.statusCode = 403
          res.end('forbidden')
          return
        }
        try {
          fs.mkdirSync(targetDir, { recursive: true })
        } catch (err) {
          res.statusCode = 500
          res.end(`mkdir failed: ${String(err)}`)
          return
        }
        const stream = fs.createWriteStream(targetPath)
        req.pipe(stream)
        stream.on('finish', () => {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ saved: path.relative(projectRoot, targetPath) }))
        })
        stream.on('error', (err) => {
          res.statusCode = 500
          res.end(`write failed: ${String(err)}`)
        })
      })
    },
  }
}

// Serve the webapp-v4/test-images/ directory (committed fixture photos) at
// /test-images/* in dev. We keep fixtures outside public/ so they don't ship
// in production builds.
function testImagesPlugin(): PluginOption {
  const dir = path.resolve(__dirname, 'test-images')
  return {
    name: 'iq-noodles-test-images',
    configureServer(server) {
      server.middlewares.use('/test-images', (req, res, next) => {
        try {
          const url = (req.url ?? '').split('?')[0]
          const filePath = path.join(dir, decodeURIComponent(url))
          if (!filePath.startsWith(dir)) {
            res.statusCode = 403
            res.end('forbidden')
            return
          }
          if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
            next()
            return
          }
          const ext = path.extname(filePath).toLowerCase()
          const mime =
            ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.png'
                ? 'image/png'
                : 'application/octet-stream'
          res.setHeader('Content-Type', mime)
          res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
          fs.createReadStream(filePath).pipe(res)
        } catch {
          next()
        }
      })
    },
  }
}

export default defineConfig({
  // basicSsl: self-signed HTTPS in dev so the phone (on LAN, not localhost)
  // has a secure origin — required for navigator.mediaDevices.getUserMedia.
  plugins: [react(), basicSsl(), testImagesPlugin(), debugSavePlugin()],
  optimizeDeps: {
    // onnxruntime-web uses SharedArrayBuffer; exclude from Vite's pre-bundling
    // so it can manage its own WASM worker threads correctly.
    exclude: ['onnxruntime-web'],
  },
  server: {
    host: true,
    headers: {
      // Required for SharedArrayBuffer (used by ONNX Runtime Web WASM threads).
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
  preview: {
    host: true,
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
