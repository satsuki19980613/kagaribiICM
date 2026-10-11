import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { serviceWorker } from './plugins/swPlugin';

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

/**
 * OCR の評価ページ（/ocr-eval.html）に、手元の画像と正解（リポジトリ直下の ocr-local/。Git には入らない）を
 * 渡す。**開発サーバーでだけ**有効（apply: 'serve'）で、ビルドや本番の配信には何も足さない。
 * 画像は一覧の番号で指定させ、要求された文字列をファイル名として使わない。
 */
function ocrEvalDev(): Plugin {
  const dir = fileURLToPath(new URL('../../ocr-local/', import.meta.url));
  const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
  const readJson = (base: string, name: string): unknown => {
    try {
      return JSON.parse(readFileSync(base + name, 'utf8'));
    } catch {
      return null;
    }
  };
  return {
    name: 'kagaribi-ocr-eval',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ocr-eval', (req, res) => {
        // 画像の組は決まった名前だけ（既定の ocr-local/ と、ネットから集めた一時的な ocr-local/web/）。
        const query = new URLSearchParams((req.url ?? '').split('?')[1] ?? '');
        const base = query.get('set') === 'web' ? dir + 'web/' : dir;
        const imgDir = base + 'images/';
        const files = existsSync(imgDir) ? readdirSync(imgDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f)).sort() : [];
        const url = (req.url ?? '').split('?')[0]!;
        if (url === '/list') {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ files, truth: readJson(base, 'truth.json'), nodeRun: readJson(base, 'report.json') }));
          return;
        }
        const m = /^\/image\/(\d{1,6})$/.exec(url);
        const name = m ? files[Number(m[1])] : undefined;
        if (!name) {
          res.statusCode = 404;
          res.end('not found');
          return;
        }
        res.setHeader('Content-Type', types[name.split('.').pop()!.toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.end(readFileSync(imgDir + name));
      });
    },
  };
}

// base は相対: ローカル配信（npm start）でも GitHub Pages のサブパス配信でも同じビルドが動く。
export default defineConfig({
  base: './',
  plugins: [
    ocrEvalDev(),
    react(),
    // オフライン対応と更新（src/sw.ts）。更新は待機させ、アプリ側（pwaUpdate.ts）が入れ替える時機を決める。
    serviceWorker({
      source: fileURLToPath(new URL('./src/sw.ts', import.meta.url)),
      include: /\.(js|css|html|bin|json|svg|png|webp|webmanifest)$/,
      // 4人テーブル(~11MB)・3-way 結果テーブル(~21MB)は先に配らず、初回使用時にキャッシュする（sw.ts の RUNTIME）。
      // フォントも同じ（日本語は文字の範囲ごとに 100 以上のファイルに分かれる。拡張子が include に無い）。
      exclude: [/pf4way\.f16-.*\.bin$/, /wintie3-169\.u16-.*\.bin$/],
      maxBytes: 5 * 1024 * 1024,
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
