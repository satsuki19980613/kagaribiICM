/**
 * PWA の更新。新しい版は待機させ、入れ替える時機は App が決める
 * （使用中に裏で入れ替えると、開いている画面の下で古いファイルが消えるため）。
 *
 * Service Worker の本体は sw.ts。ここはページの側で、登録と、新しい版が待機したことの検出と、
 * 入れ替えの合図を受け持つ。
 */

/** sw.ts が受け取る合図。以前の版（workbox）と同じ形にしてあり、古いページからの合図もそのまま通る。 */
const SKIP_WAITING = { type: 'SKIP_WAITING' } as const;

let registration: ServiceWorkerRegistration | null = null;
let ready = false;
const listeners = new Set<() => void>();

function notifyReady(): void {
  if (ready) return;
  ready = true;
  // 新しい版が有効になったら（このページでも、ほかのタブで入れ替えたときでも）読み込み直す。
  navigator.serviceWorker.addEventListener('controllerchange', () => globalThis.location.reload(), { once: true });
  for (const l of listeners) l();
}

/** 導入中の版を見張る。導入が済んで待機に入ったら知らせる。 */
function watch(worker: ServiceWorker | null): void {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    // 初めての導入（まだどの版もこのページを受け持っていない）は、そのまま有効になるので知らせない。
    if (worker.state === 'installed' && navigator.serviceWorker.controller) notifyReady();
  });
}

export function initPwa(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      registration = reg;
      // 前に開いたときに入った版が、待機したままになっている。
      if (reg.waiting && navigator.serviceWorker.controller) notifyReady();
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
    })
    .catch(() => {
      /* 登録できなくても、アプリはオンラインでそのまま動く */
    });
}

/** 新しい版が待機したら呼ぶ（既に待機していれば即座に呼ぶ）。 */
export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn);
  if (ready) fn();
  return () => listeners.delete(fn);
}

export function applyUpdate(): void {
  registration?.waiting?.postMessage(SKIP_WAITING);
}
