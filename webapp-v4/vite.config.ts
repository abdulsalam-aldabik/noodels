import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

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
  plugins: [react(), testImagesPlugin()],
  optimizeDeps: {
    // onnxruntime-web uses SharedArrayBuffer; exclude from Vite's pre-bundling
    // so it can manage its own WASM worker threads correctly.
    exclude: ['onnxruntime-web'],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by ONNX Runtime Web WASM threads).
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
