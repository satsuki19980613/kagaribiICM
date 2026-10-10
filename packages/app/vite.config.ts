import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** public/_headers（Cloudflare が付ける応答ヘッダ）の全ページ共通ぶん。`npm run preview` でも同じ値を付けて、CSP で止まるものを手元で見つける。 */
function siteHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  let inAll = false;
  for (const line of readFileSync(new URL('./public/_headers', import.meta.url), 'utf8').split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      inAll = line.trim() === '/*';
      continue;
    }
    const i = line.indexOf(':');
    if (inAll && i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return headers;
}

// base は相対: ローカル配信（npm start）でも GitHub Pages のサブパス配信でも同じビルドが動く。
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 更新は prompt 方式: 新しい版は待機させ、アプリ側（main.tsx）が入れ替える時機を決める。
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Kagaribi ICM',
        short_name: 'Kagaribi ICM',
        description: 'ポーカーチェイスのスクショから push/fold ICM を計算（端末内で完結）',
        lang: 'ja',
        theme_color: '#0D0F13',
        background_color: '#0D0F13',
        display: 'standalone',
        orientation: 'any',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' },
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,bin,json,svg,png,webp}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        // 4人テーブル(~11MB)・3-way 結果テーブル(~21MB)は precache せず、初回使用時にキャッシュする。
        globIgnores: ['**/pf4way.f16-*.bin', '**/wintie3-169.u16-*.bin'],
        runtimeCaching: [
          {
            urlPattern: /pf4way\.f16-.*\.bin$/,
            handler: 'CacheFirst',
            options: { cacheName: 'pf4way-table', expiration: { maxEntries: 2 }, cacheableResponse: { statuses: [0, 200] } },
          },
          {
            urlPattern: /wintie3-169\.u16-.*\.bin$/,
            handler: 'CacheFirst',
            options: { cacheName: 'wintie3-table', expiration: { maxEntries: 2 }, cacheableResponse: { statuses: [0, 200] } },
          },
          // フォントはこのサイトから配る（src/fonts.css）。日本語は文字の範囲ごとに 100 以上のファイルに
          // 分かれるので precache せず、使ったものだけ初回にキャッシュする（以後はオフラインでも出る）。
          {
            urlPattern: /\.woff2?$/,
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 400 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  assetsInclude: ['**/*.bin'],
  // 本体チャンクの大半は OCR テンプレート（JSON）。分割しても初回に必ず要るのでまとめて置く。
  // フォントは必ず別ファイルにする（CSS に埋め込まれた data: のフォントは、public/_headers の font-src 'self' で止まる）。
  build: { chunkSizeWarningLimit: 1200, assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? false : undefined) },
  server: {
    port: 5180,
    // solver/artifacts の .bin/.meta を ?url で参照するためモノレポ上位を許可。
    fs: { allow: ['../..'] },
  },
  preview: { port: 4180, headers: siteHeaders() },
});
