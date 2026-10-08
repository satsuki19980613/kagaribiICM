/**
 * D ボタン検出の合成テスト（画像非依存）。実画像は dev harness（probeButton）で
 * D 位置既知の 6-max chips 11 枚 11/11・conf≈0.99 を確認済み。ここでは
 * 「最大ゴールドブロブ→最近傍アンカー」の割り当てを固定する。
 */
import { describe, it, expect } from 'vitest';
import type { Rgba } from './color.js';
import type { Rect } from './types.js';
import { detectButtonSeat, goldDiscCenter, goldDiscCandidates, redDiscSeat, type FracPoint } from './button.js';

/** frame に金色の塗り円盤を1つ描く（cx,cy は割合, r は px）。 */
function drawDisc(img: Rgba, cxf: number, cyf: number, r: number): void {
  const cx = Math.round(cxf * img.w), cy = Math.round(cyf * img.h);
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
    if (x * x + y * y > r * r) continue;
    const px = cx + x, py = cy + y;
    if (px < 0 || py < 0 || px >= img.w || py >= img.h) continue;
    const s = (py * img.w + px) * 4; img.data[s] = 235; img.data[s + 1] = 185; img.data[s + 2] = 40;
  }
}

/** 暗背景に金色の塗り円盤を描いた frame（cx,cy は割合, r は px）。 */
function frameWithDisc(w: number, h: number, cxf: number, cyf: number, r: number): Rgba {
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) { data[i * 4] = 20; data[i * 4 + 1] = 60; data[i * 4 + 2] = 40; data[i * 4 + 3] = 255; }
  const img: Rgba = { w, h, data };
  drawDisc(img, cxf, cyf, r);
  return img;
}
const full = (b: Rgba): Rect => ({ x: 0, y: 0, w: b.w, h: b.h });
const ANCHORS: FracPoint[] = [{ x: 0.25, y: 0.5 }, { x: 0.75, y: 0.5 }];

describe('goldDiscCenter', () => {
  it('金色ディスクの中心を割合で返す', () => {
    const b = frameWithDisc(200, 200, 0.75, 0.5, 14);
    const d = goldDiscCenter(b, full(b));
    expect(d).not.toBeNull();
    expect(d!.cx).toBeCloseTo(0.75, 1);
    expect(d!.cy).toBeCloseTo(0.5, 1);
  });
  it('金色が無ければ null', () => {
    const b: Rgba = { w: 50, h: 50, data: new Uint8Array(50 * 50 * 4).fill(20) };
    expect(goldDiscCenter(b, full(b))).toBeNull();
  });
});

describe('detectButtonSeat', () => {
  it('ディスクに最も近い席 index を高信頼で返す', () => {
    const b = frameWithDisc(200, 200, 0.75, 0.5, 14);
    const r = detectButtonSeat(b, full(b), ANCHORS);
    expect(r.value).toBe(1);
    expect(r.conf).toBeGreaterThan(0.7);
  });
  it('反対側の席なら index 0', () => {
    const b = frameWithDisc(200, 200, 0.25, 0.5, 14);
    expect(detectButtonSeat(b, full(b), ANCHORS).value).toBe(0);
  });
  it('ディスク未検出は value=-1, conf=0', () => {
    const b: Rgba = { w: 50, h: 50, data: new Uint8Array(50 * 50 * 4).fill(20) };
    const r = detectButtonSeat(b, full(b), ANCHORS);
    expect(r.value).toBe(-1);
    expect(r.conf).toBe(0);
  });

  // 回帰: 中央の大きな金装飾（キャラ絵）に釣られず、席アンカー上の D ディスクを選ぶ。
  // 旧「最大ブロブ」方式は大装飾を拾って誤検出していた（ボリス局面 hero=SB 事件）。
  it('アンカーから遠い大装飾より、アンカー上の小ディスクを優先（最近傍優先）', () => {
    const b = frameWithDisc(400, 400, 0.55, 0.5, 40); // 大装飾: どのアンカーからも遠い
    drawDisc(b, 0.25, 0.5, 16); // anchor0 上に本物の D ディスク（小）
    const r = detectButtonSeat(b, full(b), ANCHORS);
    expect(r.value).toBe(0); // 大装飾(0.55, seat1寄り)でなく anchor0 の席
    expect(r.conf).toBeGreaterThan(0.7);
    // 候補は複数あり、goldDiscCenter（最大）は大装飾を指す＝最近傍選択が効いている。
    expect(goldDiscCandidates(b, full(b)).length).toBeGreaterThanOrEqual(2);
    expect(goldDiscCenter(b, full(b))!.cx).toBeCloseTo(0.55, 1);
  });
});

describe('redDiscSeat — 席ごとの D 位置で赤い D ディスクを確かめる（さつき提案 2026-10-09）', () => {
  const W = 1000, H = 460;
  const ANCHORS = [
    { x: 0.349, y: 0.276 }, { x: 0.569, y: 0.266 }, { x: 0.692, y: 0.276 },
    { x: 0.746, y: 0.549 }, { x: 0.603, y: 0.623 }, { x: 0.285, y: 0.549 },
  ];
  const TABLE = { x: 50, y: 55, w: 900, h: 313 };
  function frame(bg: [number, number, number]): Rgba {
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
    return { w: W, h: H, data };
  }
  /** 純赤の丸に黄色の「D」（中央を抜く）＝ D ディスク。 */
  function disc(img: Rgba, cx: number, cy: number, r: number): void {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y);
        if (d > r) continue;
        const inner = d < r * 0.65;
        const s = ((cy + y) * W + (cx + x)) * 4;
        img.data.set(inner ? [255, 240, 60] : [231, 0, 18], s);
      }
  }
  function dot(img: Rgba, cx: number, cy: number, r: number, rgb: [number, number, number]): void {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) if (Math.hypot(x, y) <= r) img.data.set(rgb, ((cy + y) * W + (cx + x)) * 4);
  }

  it('D 位置の近くにある赤い D ディスクの席を返す（金色の卓でも）', () => {
    const img = frame([200, 160, 40]); // 金のフェルト
    disc(img, Math.round(0.72 * W), Math.round(0.523 * H), 12); // BR
    expect(redDiscSeat(img, TABLE, ANCHORS)).toBe(3);
  });

  it('小さな赤い印・遠いハートは数えない', () => {
    const img = frame([240, 220, 235]);
    disc(img, Math.round(0.72 * W), Math.round(0.523 * H), 12);
    dot(img, Math.round(0.19 * W), Math.round(0.28 * H), 5, [230, 0, 20]); // 席の赤い印（小さい）
    dot(img, Math.round(0.45 * W), Math.round(0.71 * H), 13, [225, 0, 30]); // カードのハート（D 位置から遠い）
    expect(redDiscSeat(img, TABLE, ANCHORS)).toBe(3);
  });

  it('見つからない・2 つあるときは null（従来の金色ディスク検出に戻す）', () => {
    expect(redDiscSeat(frame([30, 90, 60]), TABLE, ANCHORS)).toBeNull();
    const img = frame([30, 90, 60]);
    disc(img, Math.round(0.72 * W), Math.round(0.523 * H), 12);
    disc(img, Math.round(0.30 * W), Math.round(0.53 * H), 12);
    expect(redDiscSeat(img, TABLE, ANCHORS)).toBeNull();
  });
});
