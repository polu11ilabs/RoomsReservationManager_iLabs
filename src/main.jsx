import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import './index.css'

const root = document.getElementById('root')

try {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
} catch (e) {
  console.error('CRASH AL MOUNT:', e)
  document.body.innerHTML = '<pre style="color:red">' + e.message + '\n' + e.stack + '</pre>'
}
