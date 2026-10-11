/**
 * ぼけた画像の読み直し用の鮮鋭化（アンシャープマスク）。
 *
 * ぼけた画像では、隣り合う文字のにじみがつながり、輪郭の似た文字（6 と 5、B と 8）の差が消える。
 * どのしきい値でも読めなかった項目だけ、その周りを鮮鋭化した画像でもう一度読む（評価 2026-10-11:
 * 強くぼかした画像で、ヘッダのブラインドと 1 席のスタックが未読）。
 *
 * 画像全体ではなく、渡された矩形の中だけを書き換えた複製を返す。座標はそのまま使える。
 * 鮮鋭化は輪郭を強調するぶん、ノイズや圧縮のむらも強調する。普通に読めた項目には使わない。
 */

import type { Rect } from './types.js';
import type { Rgba } from './color.js';

export interface SharpenOptions {
  /** ぼかしの標準偏差（px）。既定 2。 */
  readonly sigma?: number;
  /** 強調の量。出力 = 元 + amount ×（元 − ぼかし）。既定 1.5。 */
  readonly amount?: number;
}

function gaussKernel(sigma: number): Float32Array {
  const r = Math.max(1, Math.ceil(3 * sigma));
  const k = new Float32Array(2 * r + 1);
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k[i + r] = v;
    sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] = k[i]! / sum;
  return k;
}

/** 矩形の中だけを鮮鋭化した複製を返す。矩形が画像の外なら、その部分は無視する。 */
export function sharpenRects(img: Rgba, rects: readonly Rect[], opts: SharpenOptions = {}): Rgba {
  const sigma = opts.sigma ?? 2;
  const amount = opts.amount ?? 1.5;
  const k = gaussKernel(sigma);
  const r = (k.length - 1) / 2;
  const out = new Uint8ClampedArray(img.data);
  for (const rect of rects) {
    const x0 = Math.max(0, Math.floor(rect.x)), y0 = Math.max(0, Math.floor(rect.y));
    const x1 = Math.min(img.w, Math.floor(rect.x) + rect.w), y1 = Math.min(img.h, Math.floor(rect.y) + rect.h);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) continue;
    // 縦のぼかしに必要なぶん、上下に r 行広げて横のぼかしを取る（端は画像の端で止める）。
    const ya = Math.max(0, y0 - r), yb = Math.min(img.h, y1 + r);
    const hh = yb - ya;
    const tmp = new Float32Array(w * hh);
    for (let c = 0; c < 3; c++) {
      for (let y = 0; y < hh; y++)
        for (let x = 0; x < w; x++) {
          let acc = 0;
          for (let i = -r; i <= r; i++) {
            const sx = Math.min(img.w - 1, Math.max(0, x0 + x + i));
            acc += k[i + r]! * img.data[((ya + y) * img.w + sx) * 4 + c]!;
          }
          tmp[y * w + x] = acc;
        }
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          let acc = 0;
          for (let i = -r; i <= r; i++) {
            const sy = Math.min(hh - 1, Math.max(0, y0 - ya + y + i));
            acc += k[i + r]! * tmp[sy * w + x]!;
          }
          const p = ((y0 + y) * img.w + (x0 + x)) * 4 + c;
          const v = img.data[p]!;
          out[p] = v + amount * (v - acc); // Uint8ClampedArray が 0〜255 に丸めて収める
        }
    }
  }
  return { w: img.w, h: img.h, data: out };
}
