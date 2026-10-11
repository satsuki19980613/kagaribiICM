/**
 * ビルドの最後に Service Worker（dist/sw.js）を作る Vite プラグイン。
 *
 * 出力フォルダのファイルを調べて「先に配っておくファイルの一覧」を作り、src/sw.ts を変換したものの
 * 先頭に書き足す。一覧の作り方（どれを入れ、どれに内容のハッシュを付けるか）は `listPrecache` にまとめ、
 * テストできるようにしてある。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { transformWithEsbuild, type Plugin, type ResolvedConfig } from 'vite';

export interface PrecacheEntry {
  /** 出力フォルダからの相対パス（/ 区切り）。 */
  url: string;
  /** 内容のハッシュ。名前にハッシュが入っているファイルは null。 */
  revision: string | null;
}

export interface BuiltFile {
  /** 出力フォルダからの相対パス（/ 区切り）。 */
  readonly path: string;
  readonly bytes: number;
  readonly read: () => Uint8Array;
}

export interface PrecacheRules {
  /** 一覧に入れるファイル（パスに対する条件）。 */
  readonly include: RegExp;
  /** include に合っても入れないもの（初めて使ったときにキャッシュする大きな表など）。 */
  readonly exclude?: readonly RegExp[];
  /** これより大きいファイルは入れない（導入のたびに全部を取るので、重いものは入れられない）。 */
  readonly maxBytes: number;
}

export interface PrecacheList {
  readonly entries: PrecacheEntry[];
  /** 大きすぎて入れなかったファイル。 */
  readonly tooLarge: string[];
  /** 一覧全体のハッシュ。キャッシュの名前に使う（配るものが変われば、名前も変わる）。 */
  readonly version: string;
}

/** Service Worker 自身。一覧には入れない（ブラウザが別に取りに行く）。 */
export const SW_FILE = 'sw.js';
/** Vite が付ける「内容のハッシュ入りの名前」（assets/名前-ハッシュ8文字.拡張子）。 */
const HASHED_NAME = /^assets\/.+-[\w-]{8}\.[\w.]+$/;

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

/** 環境の言語設定によらない、決まった並び順。 */
function byCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function listPrecache(files: readonly BuiltFile[], rules: PrecacheRules): PrecacheList {
  const entries: PrecacheEntry[] = [];
  const tooLarge: string[] = [];
  for (const file of files) {
    if (file.path === SW_FILE || !rules.include.test(file.path)) continue;
    if (rules.exclude?.some((r) => r.test(file.path))) continue;
    if (file.bytes > rules.maxBytes) {
      tooLarge.push(file.path);
      continue;
    }
    entries.push({ url: file.path, revision: HASHED_NAME.test(file.path) ? null : sha256(file.read()).slice(0, 32) });
  }
  entries.sort((a, b) => byCodeUnits(a.url, b.url));
  tooLarge.sort(byCodeUnits);
  return { entries, tooLarge, version: sha256(JSON.stringify(entries)).slice(0, 16) };
}

function walk(dir: string, prefix = ''): BuiltFile[] {
  const out: BuiltFile[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...walk(full, `${prefix}${name}/`));
    else out.push({ path: prefix + name, bytes: stat.size, read: () => readFileSync(full) });
  }
  return out;
}

/** sw.js の中身を組み立てる（一覧 + 変換済みの本体）。 */
export function renderServiceWorker(list: PrecacheList, body: string): string {
  return `const PRECACHE_VERSION=${JSON.stringify(list.version)},PRECACHE_MANIFEST=${JSON.stringify(list.entries)};\n${body}`;
}

export interface ServiceWorkerOptions extends PrecacheRules {
  /** Service Worker のソース（TypeScript）。 */
  readonly source: string;
}

export function serviceWorker(options: ServiceWorkerOptions): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'kagaribi-service-worker',
    apply: 'build',
    configResolved(resolved) {
      config = resolved;
    },
    // 出力フォルダが出そろってから（public/ の写しも済んでから）作る。
    async closeBundle() {
      const outDir = resolve(config.root, config.build.outDir);
      // ビルドが途中で失敗したときは作らない。
      if (!existsSync(join(outDir, 'index.html'))) return;
      const list = listPrecache(walk(outDir), options);
      for (const path of list.tooLarge) config.logger.warn(`service worker: ${path} は大きすぎるので、先には配らない`);
      const built = await transformWithEsbuild(readFileSync(options.source, 'utf8'), options.source, {
        format: 'iife',
        minify: true,
        target: 'es2020',
        sourcemap: false,
      });
      writeFileSync(join(outDir, SW_FILE), renderServiceWorker(list, built.code));
      config.logger.info(`service worker: ${list.entries.length} 個のファイルを先に配る（版 ${list.version}）`);
    },
  };
}
