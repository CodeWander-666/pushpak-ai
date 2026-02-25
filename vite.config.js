import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 3000,
    proxy: {
      '/upload': 'http://localhost:5000',
      '/status': 'http://localhost:5000',
      '/download': 'http://localhost:5000'
    }
  }
})