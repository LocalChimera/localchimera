import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import path from 'path'

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  resolve: {
    alias: {
      '@localchimera/browser-sdk': path.resolve(__dirname, '../../browser-sdk/dist/index.js'),
      '@localchimera/sdk': path.resolve(__dirname, '../../sdk'),
    },
  },
  build: {
    rollupOptions: {
      output: {},
    },
  },
  server: {
    port: 3002,
  },
})
