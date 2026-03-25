import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Ensure ONNX WASM files are served correctly
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  server: {
    // Allow serving the ONNX model as a static asset
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
})
