// 本番のサイトの確認（.github/workflows/live.yml から呼ぶ。手元でも `node scripts/live-check.mjs` で動く）。
// 読み取りだけで、何も書き込まない。README の「セキュリティとプライバシー」に書いたことのうち、外から確かめられるものを見る:
//   1. サイトが届く（index・マニフェスト・Service Worker・index が読む JS/CSS）
//   2. 保護ヘッダが付いている。特に CSP が「このサイト以外から読み込まない・このサイト以外へ送れない」形になっている
//   3. index.html が外部のファイルを読み込んでいない
//   4. 配っている JS/CSS に、想定外の外部の URL が入っていない
//   5. Mozilla HTTP Observatory の評価が A+ で、不合格の項目が無い
// 環境変数: SITE（既定 https://kagaribiicm.wsk641.workers.dev）、SKIP_OBSERVATORY=1 で 5 を飛ばす。

let SITE = process.env.SITE || 'https://kagaribiicm.wsk641.workers.dev';
while (SITE.endsWith('/')) SITE = SITE.slice(0, -1);
const HOST = new URL(SITE).host;

// サイトや Observatory から受け取った文字をそのまま出さない: 改行が入っていると、続きの行が
// GitHub Actions の命令（`::error::` など）として読まれる。
const oneLine = (v) => String(v).replace(/[\r\n]+/g, ' ');
/** 並べるものがあれば「（a, b）」、無ければ空。 */
const listed = (items) => (items.length ? `（${items.join(', ')}）` : '');

let failed = 0;
const ok = (msg) => console.log(`  ok   ${oneLine(msg)}`);
const warn = (msg) => console.log(`::warning::${oneLine(msg)}`);
const fail = (msg) => {
  failed++;
  console.log(`::error::${oneLine(msg)}`);
};
const check = (cond, msg) => (cond ? ok(msg) : fail(msg));

async function get(path) {
  const url = path.startsWith('http') ? path : `${SITE}/${path.replace(/^\.?\//, '')}`;
  const res = await fetch(url, { redirect: 'follow' });
  return { url, res, text: await res.text() };
}

/** CSP を { directive: [値...] } に分ける。 */
function parseCsp(v) {
  const out = {};
  for (const part of (v || '').split(';')) {
    const [name, ...vals] = part.trim().split(/\s+/);
    if (name) out[name.toLowerCase()] = vals;
  }
  return out;
}

/** ブラウザの中で完結する値（外へ通信しない）。 */
const LOCAL_SOURCES = new Set(["'self'", "'none'", 'data:', 'blob:', "'unsafe-inline'"]);

console.log(`== 1. サイトが届く（${SITE}）`);
const index = await get('');
check(index.res.status === 200, `index が 200（${index.res.status}）`);
check(index.text.includes('<div id="root">'), 'index にアプリの枠がある');
const STATIC_FILES = ['manifest.webmanifest', 'sw.js', 'theme.js', 'icon.svg'];
const staticFiles = await Promise.all(STATIC_FILES.map((p) => get(p)));
STATIC_FILES.forEach((p, i) => {
  const { res } = staticFiles[i];
  check(res.status === 200, `${p} が 200（${res.status}）`);
});

console.log('== 2. 保護ヘッダ');
const h = index.res.headers;
const csp = parseCsp(h.get('content-security-policy'));
check(Object.keys(csp).length > 0, 'Content-Security-Policy がある');
check((csp['default-src'] || []).join(' ') === "'self'", "CSP default-src は 'self' だけ");
check((csp['script-src'] || []).join(' ') === "'self'", "CSP script-src は 'self' だけ（インラインや eval を許さない）");
check((csp['object-src'] || []).join(' ') === "'none'", "CSP object-src は 'none'");
check((csp['frame-ancestors'] || []).join(' ') === "'none'", "CSP frame-ancestors は 'none'（ほかのサイトに埋め込めない）");
check((csp['base-uri'] || []).join(' ') === "'self'", "CSP base-uri は 'self'");
check((csp['form-action'] || []).join(' ') === "'self'", "CSP form-action は 'self'");
// どの directive にも、このサイト以外の宛先が無い＝ブラウザはこのサイト以外へ通信できない。
const externalSources = Object.entries(csp).flatMap(([d, vals]) => vals.filter((v) => !LOCAL_SOURCES.has(v)).map((v) => `${d} ${v}`));
check(externalSources.length === 0, `CSP に外部の宛先が無い${listed(externalSources)}`);
check(h.get('x-content-type-options') === 'nosniff', 'X-Content-Type-Options: nosniff');
check(/^(strict-origin-when-cross-origin|no-referrer|same-origin|strict-origin)$/.test(h.get('referrer-policy') || ''), `Referrer-Policy（${h.get('referrer-policy')}）`);
check(/max-age=\d{7,}/.test(h.get('strict-transport-security') || ''), `Strict-Transport-Security（${h.get('strict-transport-security')}）`);
check((h.get('permissions-policy') || '').includes('camera=()'), 'Permissions-Policy（カメラ・マイク・位置情報を使わない）');
check(h.get('cross-origin-opener-policy') === 'same-origin', 'Cross-Origin-Opener-Policy: same-origin');
check(!h.get('set-cookie'), 'Cookie を発行しない');

console.log('== 3. index.html が外部のファイルを読み込んでいない');
const refs = [...index.text.matchAll(/<(?:script|link|img)\b[^>]*?\b(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
const outside = refs.filter((r) => /^(https?:)?\/\//.test(r) && new URL(r, SITE).host !== HOST);
check(outside.length === 0, `外部の src / href が無い${listed(outside)}`);
check(!/<script(?![^>]*\bsrc=)[^>]*>[^<]*\S/.test(index.text), 'インラインのスクリプトが無い');

console.log('== 4. 配っている JS/CSS に想定外の外部の URL が無い');
// 文字列として入っているだけで通信はしないもの（XML の名前空間、ライブラリのエラーメッセージの案内先）。
const KNOWN_STRINGS = new Set(['www.w3.org', 'reactjs.org', 'react.dev', 'bit.ly']);
const assets = new Set(refs.filter((r) => /\.(js|css)$/.test(r) && !outside.includes(r)));
const sw = staticFiles[STATIC_FILES.indexOf('sw.js')];
// sw.js の先頭にある「先に配るファイルの一覧」から、JS と CSS を拾う（{"url":"assets/…","revision":…}）。
for (const m of sw.text.matchAll(/"?url"?:"([^"]+\.(?:js|css))"/g)) assets.add(m[1]);
let scanned = 0;
const unknown = new Map();
const assetList = [...assets];
const fetched = await Promise.all(assetList.map((a) => get(a)));
for (const [i, a] of assetList.entries()) {
  const r = fetched[i];
  if (r.res.status !== 200) {
    fail(`${a} が ${r.res.status}`);
    continue;
  }
  scanned++;
  // CSP が data: のフォントを許していないのに CSS に埋め込まれていると、ブラウザが止めて代わりのフォントになる。
  if (a.endsWith('.css') && !(csp['font-src'] || []).includes('data:') && /url\(["']?data:font\//.test(r.text)) {
    fail(`${a} に data: のフォントが埋め込まれている（font-src で止まる）`);
  }
  for (const m of r.text.matchAll(/https?:\/\/([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g)) {
    const host = m[1].toLowerCase();
    if (host !== HOST && !KNOWN_STRINGS.has(host)) unknown.set(host, a);
  }
}
check(scanned > 0, `${scanned} 個の JS/CSS を読んだ`);
const unknownList = [...unknown].map(([k, v]) => `${k} in ${v}`);
check(unknown.size === 0, `想定外の外部の URL が無い${listed(unknownList)}`);

if (process.env.SKIP_OBSERVATORY !== '1') {
  console.log('== 5. Mozilla HTTP Observatory');
  try {
    const res = await fetch(`https://observatory-api.mdn.mozilla.net/api/v2/scan?host=${HOST}`, { method: 'POST' });
    const j = await res.json();
    if (!res.ok || j.error) {
      // Observatory 側の都合（混雑・一時的な失敗）は、こちらの失敗にしない。
      warn(`Observatory から結果を取れなかった（${res.status} ${j.error || ''}）`);
    } else {
      console.log(oneLine(`  grade ${j.grade} / score ${j.score} / passed ${j.tests_passed}/${j.tests_quantity}（${j.scanned_at}）`));
      console.log(oneLine(`  ${j.details_url}`));
      check(j.grade === 'A+', `評価が A+（${j.grade}）`);
      check(j.tests_failed === 0, `不合格の項目が無い（${j.tests_failed}）`);
    }
  } catch (e) {
    warn(`Observatory に届かなかった（${e instanceof Error ? e.message : e}）`);
  }
}

console.log(failed === 0 ? '\nすべて通った' : `\n${failed} 件の失敗`);
process.exit(failed === 0 ? 0 : 1);
