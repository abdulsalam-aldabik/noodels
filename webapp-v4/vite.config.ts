import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { debugOutputPlugin } from './vite-plugins/debug-output-plugin'

export default defineConfig({
  plugins: [react(), debugOutputPlugin()],
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
    proxy: {
      // Proxy OpenCV.js through the dev server so it appears same-origin,
      // satisfying the COEP: require-corp policy.
      '/opencv-proxy': {
        target: 'https://docs.opencv.org',
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/opencv-proxy/, ''),
      },
    },
  },
})
