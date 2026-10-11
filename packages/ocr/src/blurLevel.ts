/**
 * 画像のぼけ具合（輪郭の幅）を測る。
 *
 * くっきりした画面の輪郭（白い文字やカードの縁）は 1〜2 画素で暗から明へ移る。ぼけた画像では、
 * 同じ輪郭が何画素にもわたってなだらかに移る。**明暗差の大きい輪郭**だけを選び、「明暗差 ÷ いちばん
 * 急な 1 画素ぶんの変化」をその輪郭の幅とする（ガウスぼけなら標準偏差の約 2.5 倍になる）。
 *
 * 画面にはもともとなだらかな部分（背景のグラデーション・影）もあるので、全体の平均ではなく、
 * **鋭いほうの輪郭**（幅の小さいほうから 2 割の位置）を画像のぼけ具合とする。くっきりした画像は
 * 鋭い輪郭を必ず持ち、ぼけた画像はどの輪郭もなだらかになる。
 */

import type { Rgba } from './color.js';

/** 輪郭と見なす明暗差の下限（0〜255）。 */
const MIN_CONTRAST = 100;
/** 1 つの輪郭をたどる最大の画素数（片側）。 */
const MAX_REACH = 16;
/** 調べる行の間隔（画像の高さに対して約 200 行）。 */
const ROWS = 200;
/** 幅を決めるのに必要な輪郭の数。これ未満なら測れない（0 を返す）。 */
const MIN_EDGES = 50;

/**
 * 輪郭の幅（画素）。くっきりした画像で 1〜2、ぼけるほど大きい。測れなければ 0。
 */
export function edgeWidth(img: Rgba): number {
  const { w, h, data } = img;
  if (w < 8 || h < 8) return 0;
  const step = Math.max(1, Math.floor(h / ROWS));
  const row = new Float32Array(w);
  const widths: number[] = [];
  for (let y = Math.floor(step / 2); y < h; y += step) {
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      row[x] = (data[s]! + 2 * data[s + 1]! + data[s + 2]!) / 4;
    }
    let x = 1;
    while (x < w - 1) {
      const dir = Math.sign(row[x + 1]! - row[x]!);
      if (dir === 0) { x++; continue; }
      // 同じ向きに変わり続ける区間（＝1 つの輪郭）をたどる。
      let end = x, steepest = 0;
      while (end < w - 1 && end - x < 2 * MAX_REACH && Math.sign(row[end + 1]! - row[end]!) === dir) {
        steepest = Math.max(steepest, Math.abs(row[end + 1]! - row[end]!));
        end++;
      }
      const contrast = Math.abs(row[end]! - row[x]!);
      if (contrast >= MIN_CONTRAST && steepest > 0) widths.push(contrast / steepest);
      x = Math.max(end, x + 1);
    }
  }
  if (widths.length < MIN_EDGES) return 0;
  widths.sort((a, b) => a - b);
  return widths[Math.floor(0.2 * (widths.length - 1))]!;
}
