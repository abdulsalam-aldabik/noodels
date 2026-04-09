import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import type { ComponentType } from 'react'

async function resolvePage(): Promise<ComponentType> {
  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (import.meta.env.DEV && path === '/dev/piece-calibration') {
    const module = await import('./dev/PieceCalibrationPage')
    return module.default
  }

  const module = await import('./app/IQNoodlesApp')
  return module.default
}

async function bootstrap() {
  const Page = await resolvePage()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  )
}

void bootstrap()
