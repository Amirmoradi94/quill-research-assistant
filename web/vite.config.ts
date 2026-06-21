import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig(async () => {
  const disableTailwindVite = process.env.DISABLE_TAILWIND_VITE === '1'
  const disableReactVite = process.env.DISABLE_REACT_VITE === '1'
  const tailwindPlugin = disableTailwindVite
    ? []
    : [(await import('@tailwindcss/vite')).default()]
  const reactPlugin = disableReactVite ? [] : [react()]

  return {
    plugins: [...reactPlugin, ...tailwindPlugin],
    resolve: {
      alias: [
        { find: '@', replacement: path.resolve(__dirname, './src') },
        { find: /^lucide-react$/, replacement: path.resolve(__dirname, './src/lib/lucide-icons.ts') },
      ],
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        maxParallelFileOps: 20,
      },
    },
  }
})
