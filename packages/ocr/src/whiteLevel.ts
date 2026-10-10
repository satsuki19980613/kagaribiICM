/**
 * 画像全体が暗く保存されているときの明るさの補正。
 *
 * 読み取りのしきい値（白文字 120〜235、カードの白 200 以上、行動マークの地の明るさ など）は、
 * 画面の白が 255 付近にある前提で決めてある。画像全体が暗く保存されていると（明るさを下げて
 * 書き出した、暗く写った画面を撮った等）、白文字そのものがしきい値を下回り、桁が欠けたり丸ごと
 * 読めなくなったりする（評価 2026-10-10: 明るさ 0.7 倍の画像で、白が 178 になり、しきい値 168 で
 * "3.1" の 3 だけが落ちて「1」〔信頼度 1.00〕と読んだ。ポットとハンドは未読）。
 *
 * 卓の画面には必ず純白の文字（スタック・ヘッダ）がある。色の付いていない画素のうち、いちばん明るい
 * 水準を「白」とし、それが 255 になるように全体を定数倍する。白が十分明るい普通の画像は何もしない
 * （同じ画像をそのまま返す）。
 */

import type { Rgba } from './color.js';

/** 「色が付いていない」と見なす彩度（max−min）の上限。 */
const NEUTRAL_MAX_SAT = 12;
/** 白の水準を決めるのに必要な画素の割合（2622×1206 で約 630 画素。文字 20 個ぶん程度）。 */
const WHITE_MIN_FRAC = 0.0002;
/** 白がこれ以上なら補正しない。 */
const WHITE_OK = 235;
/** 白がこれ未満なら補正しない（卓の画面ではない・白い部分が無い。無理に引き伸ばさない）。 */
const WHITE_MIN = 120;

/** 色の付いていない画素の、いちばん明るい水準（0〜255）。見つからなければ 255。 */
export function neutralWhiteLevel(img: Rgba): number {
  const hist = new Uint32Array(256);
  const n = img.w * img.h;
  for (let i = 0; i < n; i++) {
    const s = i * 4;
    const R = img.data[s]!, G = img.data[s + 1]!, B = img.data[s + 2]!;
    const mn = Math.min(R, G, B);
    if (Math.max(R, G, B) - mn <= NEUTRAL_MAX_SAT) hist[mn]!++;
  }
  const need = Math.max(1, Math.round(WHITE_MIN_FRAC * n));
  let acc = 0;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v]!;
    if (acc >= need) return v;
  }
  return 255;
}

/** 白が暗い画像を、白が 255 になるように定数倍する。補正が要らなければ同じ画像を返す。 */
export function stretchWhite(img: Rgba): Rgba {
  const white = neutralWhiteLevel(img);
  if (white >= WHITE_OK || white < WHITE_MIN) return img;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = Math.round((v * 255) / white);
  const data = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    data[i] = lut[img.data[i]!]!;
    data[i + 1] = lut[img.data[i + 1]!]!;
    data[i + 2] = lut[img.data[i + 2]!]!;
    data[i + 3] = img.data[i + 3]!;
  }
  return { w: img.w, h: img.h, data };
}
