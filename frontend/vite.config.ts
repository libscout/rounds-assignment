import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const { API_PROXY_TARGET, MOCK_SOURCE_TARGET } = loadEnv(mode, process.cwd(), ['API_', 'MOCK_'])
  const apiTarget = API_PROXY_TARGET || 'http://127.0.0.1:3000'
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': apiTarget,
        '^/dev/listing-source/advance$': {
          target: MOCK_SOURCE_TARGET || 'http://127.0.0.1:4002',
          rewrite: path => path.replace('/dev/listing-source/', '/control/'),
        },
      },
    },
    preview: { proxy: { '/api': apiTarget } },
  }
})
