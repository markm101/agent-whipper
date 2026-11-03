import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: 'src/dashboard',
  plugins: [react()],
  server: { host: '127.0.0.1', port: 5320, strictPort: true },
  build: { outDir: '../../dist/dashboard', emptyOutDir: true, target: 'es2022' },
})
