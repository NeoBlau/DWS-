import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { useApp } from './store'
import * as actions from './utils/actions'

// test hook for automated UI checks (dev server only)
if (import.meta.env.DEV) Object.assign(window, { __app: useApp, __act: actions })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
