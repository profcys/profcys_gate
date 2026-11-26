import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 개발 시 `npm run dev` 는 dev/dev-server.mjs 가 이 설정으로 Vite 를 미들웨어 모드로 실행하고 /api 를 제공한다.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2020',
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
  test: {
    include: ['tests/unit/**/*.test.{ts,mjs}', 'tests/integration/**/*.test.{ts,mjs}'],
    environment: 'node',
  },
} as never);
