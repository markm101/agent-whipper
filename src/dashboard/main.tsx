// The base styles load first, so each part's own CSS can override them
import './styles/tokens.css'
import './styles/base.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { SourceProvider } from './data/hooks.tsx'
import { createMockSource } from './data/mock/source.ts'

// The mock until whip-server exists; an HTTP source with the same interface replaces it
const source = createMockSource()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SourceProvider source={source}>
      <App />
    </SourceProvider>
  </StrictMode>,
)
