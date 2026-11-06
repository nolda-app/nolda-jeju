/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // 정적 약관 페이지는 SPA 셸(index.html)로 대체되면 안 된다 (구글 OAuth 심사 링크)
        navigateFallbackDenylist: [/^\/(privacy|terms)\.html$/],
        runtimeCaching: [{
          // 장소 목록 — 캐시를 먼저 보여주고 뒤에서 갱신 (서버가 잠들어 있어도 홈이 바로 뜬다)
          urlPattern: ({ url }) => url.pathname === '/places',
          handler: 'StaleWhileRevalidate',
          options: { cacheName: 'places', expiration: { maxEntries: 1, maxAgeSeconds: 7 * 24 * 3600 } },
        }],
      },
      manifest: {
        name: 'NOLDA',
        short_name: 'NOLDA',
        description: '오늘, 혼자서도 완벽하게 채워지는 하루 — AI 여가 코스 설계',
        theme_color: '#FF843A',
        background_color: '#faf8f3',
        display: 'standalone',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
