import { describe, it, expect } from 'vitest';
import type { Rgba } from './color.js';
import { edgeWidth } from './blurLevel.js';

const W = 400, H = 220;

/**
 * 暗い地に明るい縦の帯が並んだ画像。帯の縁は `ramp` 画素かけて暗から明へ移る
 * （1 ならくっきり、大きいほどぼけた輪郭）。
 */
function stripes(ramp: number, lo = 30, hi = 230): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  const period = 40;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = x % period;
      // 0..ramp で上がり、20..20+ramp で下がる。
      const up = Math.min(1, p / ramp), down = Math.min(1, Math.max(0, (p - 20) / ramp));
      const v = lo + (hi - lo) * (up - down);
      const s = (y * W + x) * 4;
      data[s] = v; data[s + 1] = v; data[s + 2] = v; data[s + 3] = 255;
    }
  return { w: W, h: H, data };
}

describe('edgeWidth', () => {
  it('くっきりした輪郭は 1 画素前後', () => {
    expect(edgeWidth(stripes(1))).toBeLessThan(1.5);
  });

  it('なだらかな輪郭ほど大きい（輪郭が移るのにかかる画素数に近い）', () => {
    const w3 = edgeWidth(stripes(3)), w6 = edgeWidth(stripes(6)), w10 = edgeWidth(stripes(10));
    expect(w3).toBeGreaterThan(2.5);
    expect(w3).toBeLessThan(3.5);
    expect(w6).toBeGreaterThan(5.5);
    expect(w6).toBeLessThan(6.5);
    expect(w10).toBeGreaterThan(w6);
  });

  it('画像全体の明るさや濃さが少し変わっても、幅は変わらない', () => {
    expect(edgeWidth(stripes(6, 20, 190))).toBeCloseTo(edgeWidth(stripes(6)), 1);
  });

  it('鋭い輪郭が混ざっていれば、鋭いほうを画像のぼけ具合とする（もともとなだらかな部分に引きずられない）', () => {
    const img = stripes(1);
    // 下半分だけ、なだらかな帯に置き換える。
    const soft = stripes(10);
    img.data.set(soft.data.subarray((H / 2) * W * 4), (H / 2) * W * 4);
    expect(edgeWidth(img)).toBeLessThan(1.5);
  });

  it('明暗差の大きい輪郭が無ければ測れない（0）', () => {
    const flat: Rgba = { w: W, h: H, data: new Uint8ClampedArray(W * H * 4).fill(128) };
    expect(edgeWidth(flat)).toBe(0);
    expect(edgeWidth(stripes(3, 100, 150))).toBe(0); // 明暗差 50 は輪郭として数えない
  });
});
