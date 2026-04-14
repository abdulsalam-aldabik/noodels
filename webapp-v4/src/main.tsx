import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { ComponentType } from 'react'

async function resolvePage(): Promise<ComponentType> {
  const path = globalThis.location.pathname.replace(/\/+$/, '') || '/'

  if (import.meta.env.DEV && path === '/dev/scan-lab') {
    const module = await import('./dev/ScanLabPage')
    return module.default
  }

  if (import.meta.env.DEV && path === '/dev/rectified-grid-lab') {
    const module = await import('./dev/RectifiedGridLabPage')
    return module.default
  }

  if (import.meta.env.DEV && path === '/dev/piece-calibration') {
    const module = await import('./dev/PieceCalibrationPage')
    return module.default
  }

  const module = await import('./app/IQNoodlesApp')
  return module.default
}

const Page = await resolvePage()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Page />
  </StrictMode>,
)
