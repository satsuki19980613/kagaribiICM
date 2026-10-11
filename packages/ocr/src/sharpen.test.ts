import { describe, it, expect } from 'vitest';
import type { Rgba } from './color.js';
import { sharpenRects } from './sharpen.js';

const W = 80, H = 40;

/** 左半分が暗く右半分が明るい画像の、境目をなだらかにしたもの（ぼけた輪郭に見立てる）。 */
function softEdge(): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = Math.min(1, Math.max(0, (x - 30) / 20)); // x=30〜50 で 40 → 220 に上がる
      const v = 40 + 180 * t;
      const s = (y * W + x) * 4;
      data[s] = v; data[s + 1] = v; data[s + 2] = v; data[s + 3] = 255;
    }
  return { w: W, h: H, data };
}
const at = (img: Rgba, x: number, y: number): number => img.data[(y * W + x) * 4]!;

describe('sharpenRects', () => {
  it('矩形の中の輪郭を立てる（境目の暗い側はより暗く、明るい側はより明るく）', () => {
    const src = softEdge();
    const out = sharpenRects(src, [{ x: 0, y: 0, w: W, h: H }]);
    expect(at(out, 33, 20)).toBeLessThan(at(src, 33, 20));
    expect(at(out, 47, 20)).toBeGreaterThan(at(src, 47, 20));
    // 平らな部分は変わらない。
    expect(at(out, 5, 20)).toBe(at(src, 5, 20));
    expect(at(out, 75, 20)).toBe(at(src, 75, 20));
  });

  it('矩形の外は書き換えない。元の画像も変えない', () => {
    const src = softEdge();
    const before = Uint8ClampedArray.from(src.data);
    const out = sharpenRects(src, [{ x: 0, y: 0, w: W, h: 10 }]);
    expect(Array.from(src.data)).toEqual(Array.from(before));
    expect(at(out, 33, 5)).toBeLessThan(at(src, 33, 5)); // 矩形の中
    expect(at(out, 33, 30)).toBe(at(src, 33, 30)); // 矩形の外
  });

  it('画像からはみ出す矩形は、画像の中の部分だけ扱う', () => {
    const src = softEdge();
    const out = sharpenRects(src, [{ x: -20, y: -20, w: 60, h: 40 }, { x: 500, y: 500, w: 10, h: 10 }]);
    expect(out.data.length).toBe(src.data.length);
    expect(at(out, 33, 10)).toBeLessThan(at(src, 33, 10));
    expect(at(out, 47, 10)).toBe(at(src, 47, 10)); // x=40 より右は矩形の外
  });
});
