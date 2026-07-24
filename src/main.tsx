import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { initDataSource } from '@/lib/data'

const rootEl = document.getElementById('root')!

// Branded splash while the live data source initialises (instant in mock mode)
rootEl.innerHTML = `
  <div style="min-height:100vh;background:#f3f1ea;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;font-family:Inter,-apple-system,sans-serif">
    <div style="width:34px;height:34px;border-radius:50%;border:3px solid #e2eeed;border-top-color:#c9a460;animation:gts 0.9s linear infinite"></div>
    <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:#8a6826;font-weight:600">Greentek Alliance</div>
    <style>@keyframes gts{to{transform:rotate(360deg)}}</style>
  </div>`

initDataSource().finally(() => {
  createRoot(rootEl).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
})
