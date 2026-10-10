import { describe, it, expect } from 'vitest';
import type { Rgba } from './color.js';
import { neutralWhiteLevel, stretchWhite } from './whiteLevel.js';

const W = 200, H = 100;

/** 色の付いた地（ピンク）に、白い帯（文字に見立てる）を置いた画像。scale で全体を暗くする。 */
function frame(scale: number, withWhite = true): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = 250 * scale; data[i * 4 + 1] = 140 * scale; data[i * 4 + 2] = 170 * scale; data[i * 4 + 3] = 255;
  }
  if (withWhite) {
    for (let y = 40; y < 50; y++)
      for (let x = 20; x < 120; x++) {
        const s = (y * W + x) * 4;
        data[s] = 255 * scale; data[s + 1] = 255 * scale; data[s + 2] = 255 * scale;
      }
  }
  return { w: W, h: H, data };
}
const px = (img: Rgba, x: number, y: number): number[] => Array.from(img.data.slice((y * W + x) * 4, (y * W + x) * 4 + 3));

describe('neutralWhiteLevel', () => {
  it('色の付いていない画素の、いちばん明るい水準を返す', () => {
    expect(neutralWhiteLevel(frame(1))).toBe(255);
    expect(neutralWhiteLevel(frame(0.7))).toBe(178);
  });

  it('白い部分が無ければ 255（補正しない側に倒す）', () => {
    expect(neutralWhiteLevel(frame(0.7, false))).toBe(255);
  });

  it('数画素だけの明るい点には引きずられない', () => {
    const img = frame(0.7);
    for (let x = 0; x < 3; x++) { img.data[x * 4] = 255; img.data[x * 4 + 1] = 255; img.data[x * 4 + 2] = 255; }
    expect(neutralWhiteLevel(img)).toBe(178);
  });
});

describe('stretchWhite', () => {
  it('白が十分明るい画像は、同じ画像をそのまま返す', () => {
    const img = frame(1);
    expect(stretchWhite(img)).toBe(img);
    const slightlyDim = frame(0.95); // 白 242
    expect(stretchWhite(slightlyDim)).toBe(slightlyDim);
  });

  it('全体が暗い画像は、白が 255 になるように定数倍する（色の比は保つ）', () => {
    const out = stretchWhite(frame(0.7));
    expect(px(out, 30, 45)).toEqual([255, 255, 255]);
    const [r, g, b] = px(out, 5, 5);
    // 元の地は (250,140,170)。暗くする前の値に、丸めの範囲で戻る。
    expect(Math.abs(r! - 250)).toBeLessThanOrEqual(3);
    expect(Math.abs(g! - 140)).toBeLessThanOrEqual(3);
    expect(Math.abs(b! - 170)).toBeLessThanOrEqual(3);
  });

  it('白い部分が無い・極端に暗い画像は触らない', () => {
    const noWhite = frame(0.7, false);
    expect(stretchWhite(noWhite)).toBe(noWhite);
    const veryDark = frame(0.3); // 白 77
    expect(stretchWhite(veryDark)).toBe(veryDark);
  });
});
