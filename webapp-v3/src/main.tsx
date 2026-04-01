import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import IQNoodlesApp from './iq-noodles-app/IQNoodlesApp'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <IQNoodlesApp />
  </StrictMode>,
)
