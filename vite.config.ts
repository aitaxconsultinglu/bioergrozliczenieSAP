import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// base musi odpowiadać nazwie repozytorium - aplikacja stoi pod
// aitaxconsultinglu.github.io/bioergrozliczenieSAP/, a nie w korzeniu domeny.
export default defineConfig({
  base: '/bioergrozliczenieSAP/',
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
