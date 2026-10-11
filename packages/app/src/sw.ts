/**
 * Service Worker（オフラインで動かすためのキャッシュと、版の入れ替え）。
 *
 * ビルドの最後に plugins/swPlugin.ts がこのファイルを変換し、配るファイルの一覧（PRECACHE_MANIFEST）を
 * 先頭に書き足して dist/sw.js に置く。外部のライブラリは使わない。
 *
 * - **導入時**: 一覧のファイルをすべて、この版専用のキャッシュに入れる。1 つでも取れなければ導入を
 *   やめる（前の版がそのまま動き続ける）。名前に内容のハッシュが入ったファイルは、前の版のキャッシュに
 *   あればそこから写す（大きな表を更新のたびに取り直さない）。
 * - **入れ替え**: 新しい版は待機する。ページ（pwaUpdate.ts）から SKIP_WAITING が届いたら有効になり、
 *   前の版のキャッシュを消す。使用中に裏で入れ替わることはない。
 * - **応答**: 一覧のファイルはキャッシュから返す。ページ遷移には index.html を返す。大きな表とフォントは
 *   一覧に入れず、初めて使ったときにキャッシュする。それ以外（ほかのサイト・GET 以外）には手を出さない。
 */
export {};

interface PrecacheEntry {
  /** sw.js から見た相対 URL。 */
  readonly url: string;
  /** 内容のハッシュ。名前にハッシュが入っているファイル（内容が変われば名前も変わる）は null。 */
  readonly revision: string | null;
}

/** plugins/swPlugin.ts が sw.js の先頭に書き足す。 */
declare const PRECACHE_MANIFEST: readonly PrecacheEntry[];
declare const PRECACHE_VERSION: string;

const sw = self as unknown as ServiceWorkerGlobalScope;

const PRECACHE_PREFIX = 'kagaribi-precache-';
const PRECACHE = PRECACHE_PREFIX + PRECACHE_VERSION;
/** 以前の版（workbox）が使っていたキャッシュ。写し元に使い、入れ替えのときに消す。 */
const LEGACY_PRECACHE_PREFIX = 'workbox-precache';
const LEGACY_DATABASE = 'workbox-expiration';
/** ページ遷移に返すファイル。 */
const SHELL = 'index.html';

interface RuntimeRule {
  readonly test: RegExp;
  readonly cacheName: string;
  /** これを超えたら古いものから消す。 */
  readonly maxEntries: number;
}

/** 一覧に入れず、初めて使ったときにキャッシュするもの。 */
const RUNTIME: readonly RuntimeRule[] = [
  // 4 人テーブル（約 11MB）と 3-way 結果テーブル（約 21MB）。名前が変わったら古いほうは押し出される。
  { test: /pf4way\.f16-.*\.bin$/, cacheName: 'pf4way-table', maxEntries: 2 },
  { test: /wintie3-169\.u16-.*\.bin$/, cacheName: 'wintie3-table', maxEntries: 2 },
  // フォントは文字の範囲ごとに 100 以上のファイルに分かれる。使ったものだけ残す。
  { test: /\.woff2?$/, cacheName: 'fonts', maxEntries: 400 },
];

const absolute = (url: string): string => new URL(url, sw.registration.scope).href;
const isOtherPrecache = (name: string): boolean =>
  name !== PRECACHE && (name.startsWith(PRECACHE_PREFIX) || name.startsWith(LEGACY_PRECACHE_PREFIX));

/** 一覧のファイル（絶対 URL。? 以降は含めない）。 */
const precached = new Set(PRECACHE_MANIFEST.map((e) => absolute(e.url)));

async function findInCaches(names: readonly string[], url: string): Promise<Response | undefined> {
  for (const name of names) {
    const hit = await (await caches.open(name)).match(url, { ignoreVary: true });
    if (hit) return hit;
  }
  return undefined;
}

async function download(url: string, fresh: boolean): Promise<Response> {
  // 名前にハッシュの無いファイルは、ブラウザの HTTP キャッシュを通さずに取り直す。
  const res = await fetch(new Request(url, { cache: fresh ? 'reload' : 'default', credentials: 'same-origin' }));
  if (res.status !== 200) throw new Error(`precache: ${url} -> ${res.status}`);
  // 転送を経た応答は、ページ遷移の応答としては使えない（ブラウザが拒む）。中身だけを写し直す。
  return res.redirected ? new Response(res.body, { status: res.status, statusText: res.statusText, headers: res.headers }) : res;
}

async function install(): Promise<void> {
  const others = (await caches.keys()).filter(isOtherPrecache);
  const cache = await caches.open(PRECACHE);
  await Promise.all(
    PRECACHE_MANIFEST.map(async (entry) => {
      const url = absolute(entry.url);
      // 同じ版の導入が前に途中で止まっていたら、入っているものはそのまま使う。
      if (await cache.match(url, { ignoreVary: true })) return;
      const copied = entry.revision === null ? await findInCaches(others, url) : undefined;
      await cache.put(url, copied ?? (await download(url, entry.revision !== null)));
    }),
  );
}

async function activate(): Promise<void> {
  const others = (await caches.keys()).filter(isOtherPrecache);
  await Promise.all(others.map((name) => caches.delete(name)));
  try {
    indexedDB.deleteDatabase(LEGACY_DATABASE);
  } catch {
    /* 消せなくても動作には関係ない */
  }
  // 開いているページを、すぐこの版の管理下に置く。
  await sw.clients.claim();
}

async function fromPrecache(url: string, request: Request): Promise<Response> {
  const hit = await (await caches.open(PRECACHE)).match(url, { ignoreVary: true });
  // ブラウザがキャッシュを消していたら、ネットワークから取る。
  return hit ?? fetch(request);
}

async function store(rule: RuntimeRule, request: Request, response: Response): Promise<void> {
  const cache = await caches.open(rule.cacheName);
  await cache.put(request, response);
  const keys = await cache.keys(); // 入れた順
  await Promise.all(keys.slice(0, Math.max(0, keys.length - rule.maxEntries)).map((k) => cache.delete(k)));
}

async function cacheFirst(rule: RuntimeRule, event: FetchEvent): Promise<Response> {
  const hit = await (await caches.open(rule.cacheName)).match(event.request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(event.request);
  // 保存はページへの応答を待たせずに行う（大きな表は保存に時間がかかる）。
  if (response.status === 200) event.waitUntil(store(rule, event.request, response.clone()).catch(() => undefined));
  return response;
}

sw.addEventListener('install', (event) => {
  event.waitUntil(install());
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(activate());
});

sw.addEventListener('message', (event) => {
  // このサイトのページからの合図だけを受ける。
  if (event.origin !== '' && event.origin !== sw.location.origin) return;
  const data = event.data as { type?: unknown } | null;
  if (data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  const plain = url.origin + url.pathname;
  if (precached.has(plain)) {
    event.respondWith(fromPrecache(plain, request));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(fromPrecache(absolute(SHELL), request));
    return;
  }
  const rule = RUNTIME.find((r) => r.test.test(url.pathname));
  if (rule) event.respondWith(cacheFirst(rule, event));
});
