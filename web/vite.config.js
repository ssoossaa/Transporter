import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const api = `http://localhost:${process.env.API_PORT || 3001}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': api, '/files': api },
  },
})
