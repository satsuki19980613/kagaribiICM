/**
 * PWA の更新（vite-plugin-pwa の prompt 方式）。新しい版は待機させ、入れ替える時機は App が決める
 * （使用中に裏で入れ替えると、開いている画面の下で古いファイルが消えるため）。
 */
import { registerSW } from 'virtual:pwa-register';

let update: ((reload?: boolean) => Promise<void>) | null = null;
let ready = false;
const listeners = new Set<() => void>();

export function initPwa(): void {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  update = registerSW({
    immediate: true,
    onNeedRefresh() {
      ready = true;
      for (const l of listeners) l();
    },
  });
}

/** 新しい版が待機したら呼ぶ（既に待機していれば即座に呼ぶ）。 */
export function onUpdateReady(fn: () => void): () => void {
  listeners.add(fn);
  if (ready) fn();
  return () => listeners.delete(fn);
}

export function applyUpdate(): void {
  void update?.(true);
}
