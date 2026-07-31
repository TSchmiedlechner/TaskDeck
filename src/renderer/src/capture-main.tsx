import React from 'react'
import { createRoot } from 'react-dom/client'
import { CaptureApp } from './CaptureApp'
import './global.css'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <CaptureApp />
  </React.StrictMode>
)
