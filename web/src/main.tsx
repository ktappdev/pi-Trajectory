import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { SessionPicker } from './pages/SessionPicker.tsx'
import { TrajectoryPage } from './pages/TrajectoryPage.tsx'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SessionPicker />} />
        <Route path="/s/:sessionId" element={<TrajectoryPage />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
