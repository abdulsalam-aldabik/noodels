import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'
import type { Plugin } from 'vite'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function debugDumpPlugin(): Plugin {
  return {
    name: 'scan-debug-dump-plugin',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__debug/scan', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end('Method Not Allowed')
          return
        }

        const chunks: Uint8Array[] = []
        req.on('data', (chunk) => {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        })

        req.on('end', async () => {
          try {
            const body = Buffer.concat(chunks).toString('utf-8')
            const parsed = JSON.parse(body) as {
              timestamp?: string
              sourceType?: string
              imageDataUrl?: string | null
              overlayDataUrl?: string | null
              artifacts?: Record<string, string | null | undefined>
              result?: unknown
            }

            const debugDir = resolve(server.config.root, '..', 'debug-output')
            await mkdir(debugDir, { recursive: true })

            const stamp = new Date().toISOString().replace(/[:.]/g, '-')
            const filePath = resolve(debugDir, `scan-debug-${stamp}.json`)
            const latestPath = resolve(debugDir, 'scan-debug-latest.json')

            const artifacts: Record<string, string | null | undefined> = {
              ...(parsed.artifacts ?? {}),
            }

            // Backward compatibility for old payload shape.
            if (!Object.prototype.hasOwnProperty.call(artifacts, 'raw')) {
              artifacts.raw = parsed.imageDataUrl ?? null
            }
            if (!Object.prototype.hasOwnProperty.call(artifacts, 'yolo')) {
              artifacts.yolo = parsed.overlayDataUrl ?? null
            }

            const artifactPaths: Record<string, string> = {}

            const sanitizeKey = (key: string): string =>
              key.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').slice(0, 48) || 'artifact'

            for (const [key, dataUrl] of Object.entries(artifacts)) {
              if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue
              const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
              if (!match) continue

              const safeKey = sanitizeKey(key)
              const ext = match[1] === 'jpeg' ? 'jpg' : match[1]
              const base64 = match[2]
              const buffer = Buffer.from(base64, 'base64')
              const artifactPath = resolve(debugDir, `scan-debug-${stamp}-${safeKey}.${ext}`)
              await writeFile(artifactPath, buffer)
              await writeFile(resolve(debugDir, `scan-debug-latest-${safeKey}.${ext}`), buffer)
              artifactPaths[safeKey] = artifactPath
            }

            const imagePath = artifactPaths.raw ?? null
            const overlayPath = artifactPaths.yolo ?? null

            const payload = JSON.stringify({
              timestamp: parsed.timestamp,
              sourceType: parsed.sourceType ?? null,
              imagePath,
              overlayPath,
              artifactPaths,
              result: parsed.result,
            }, null, 2)
            await writeFile(filePath, payload, 'utf-8')
            await writeFile(latestPath, payload, 'utf-8')

            res.statusCode = 200
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: true, filePath, imagePath, overlayPath, artifactPaths }))
          } catch (error) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, error: String(error) }))
          }
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), basicSsl(), debugDumpPlugin()],
  optimizeDeps: {
    // onnxruntime-web uses SharedArrayBuffer; exclude from Vite's pre-bundling
    // so it can manage its own WASM worker threads correctly.
    exclude: ['onnxruntime-web'],
  },
  server: {
    host: true,
    https: {},
    headers: {
      // Required for SharedArrayBuffer (used by ONNX Runtime Web WASM threads).
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
