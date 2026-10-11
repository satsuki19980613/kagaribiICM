/**
 * BB 表示（小数）モードの金額リーダ。SPEC §6.2。
 *
 * BB 表示ではスタック/ベット/ポットが "20.2 BB" / "13 BB"（整数値は小数点なし）で描かれ、
 * ヘッダの SB/BB・アンティだけは chips のまま（extract 側で別扱い）。chips モードとの違い:
 *  - 末尾に白文字 "BB" が付く（whiteMask が拾う）→ **スペース（最大ギャップ）で分離**して捨てる。
 *  - 小数点 "." は微小成分（実測 area≈42, h≈7, ベースライン）で、数字と整数の区別
 *    ("13"=13 か "1.3"=1.3 か)に必須 → 面積/高さの下限を下げて **必ず捕捉**する。
 *
 * 手順: whiteMask → 生 CCL（枠線/隅ノイズだけ除去）→ 左→右 → スペースで最初のクラスタ
 * （＝数値）を取り "BB" を捨てる → クラスタ内で背の低い成分は '.'、他は数字 NCC → parseAmount。
 *
 * chips 番号 "13,491" は連続一塊（スペース無し）＝ 1 クラスタなので、**2 クラスタに割れるか
 * どうか**が BB/chips の判別信号にもなる（hasBbSuffix / detectDisplayMode）。
 */

import type { DisplayMode, Gray, Rect, Read } from './types.js';
import type { Rgba } from './color.js';
import { crop, resize } from './raster.js';
import { bestMatch, matchConfidence, type Template } from './match.js';
import { parseAmount } from './digits.js';
import { grayFromRgba, whiteMask, DIGIT_NORM_H, type WhiteMaskOptions } from './numberField.js';

export interface BbAmountOptions extends WhiteMaskOptions {
  /** 数値の下限信頼度（未満なら低信頼フラグ）。既定 0.80。 */
  readonly confFloor?: number;
  /**
   * 桁受理の NCC 生スコア下限（未満の成分は数値組み立てから捨てる）。既定 0（無効＝旧挙動）。
   * 飾り（コーナー宝石/星）・端の 1px スリバー（隣プレート枠）・アイコン片（クラブ絵の 2 葉）は
   * 最良でも生スコア <0.35 で数字に化けるが、実桁は >=0.85 と明確に分離する
   * （実測: 飾り 0.09 / アイコン 0.20 / スリバー 0.32 vs 実桁 0.85-0.96）。stack/bet で 0.45 を渡すと
   * 先頭/末尾の偽桁を除去し "111.2"→"11.2" / "5.3"→"3" / ノイズのみ→NaN(bet=0) に落とす。
   * pot はセンター表示でこの種の縁ノイズが乗りにくく、既存の丸め込み(NaN 化で下流が棄却)を
   * 避けるため既定 0 のまま（呼び出し側が明示的に渡さない限り不変＝回帰なし）。
   */
  readonly scoreFloor?: number;
  /**
   * 採る数値の中心と、アンカー（nameCx）の横の距離の上限（px）。既定は無制限。
   * 探索領域は左右に広く、目当ての数値が読めないと、領域に入った別の数値（隣の席のベットなど）が
   * 「いちばん近い候補」として採られる（評価 2026-10-10: ポットが読めず、左上の席の 1 BB をポットとした）。
   */
  readonly maxAnchorDist?: number;
  /**
   * 数値の左のコロン（縦に並んだ 2 つの点）で、数値の並びを打ち切る。ポット（"Pot : 5 BB"）用。
   * 小さい画像では "Pot" の 3 文字が数字と読め、コロンの下の点が小数点と数えられて、ラベルごと数値に
   * なる（評価 2026-10-11: 幅 950 の JPEG で "Pot : 5 BB" を 902.5 と読んだ）。数値にコロンは入らない。
   * スタックやベットでは使わない（小数点の上に飾りの欠片が乗ると、コロンと見間違えて桁を落とす）。
   */
  readonly stopAtColon?: boolean;
}

interface RawComp extends Rect {
  readonly area: number;
}

/** 生 CCL（面積/高さフィルタ無し, 4 近傍）。左→右。 */
function rawComponents(bin: Gray): RawComp[] {
  const { w, h, data } = bin;
  if (w === 0 || h === 0) return [];
  const label = new Int32Array(w * h).fill(-1);
  const boxes: { x0: number; y0: number; x1: number; y1: number; area: number }[] = [];
  const st: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (data[i] === 0 || label[i] !== -1) continue;
    const id = boxes.length;
    boxes.push({ x0: w, y0: h, x1: -1, y1: -1, area: 0 });
    st.length = 0; st.push(i); label[i] = id;
    while (st.length) {
      const p = st.pop()!;
      const px = p % w, py = Math.trunc(p / w);
      const b = boxes[id]!; b.area++;
      if (px < b.x0) b.x0 = px;
      if (px > b.x1) b.x1 = px;
      if (py < b.y0) b.y0 = py;
      if (py > b.y1) b.y1 = py;
      if (px > 0 && data[p - 1]! > 0 && label[p - 1] === -1) { label[p - 1] = id; st.push(p - 1); }
      if (px < w - 1 && data[p + 1]! > 0 && label[p + 1] === -1) { label[p + 1] = id; st.push(p + 1); }
      if (py > 0 && data[p - w]! > 0 && label[p - w] === -1) { label[p - w] = id; st.push(p - w); }
      if (py < h - 1 && data[p + w]! > 0 && label[p + w] === -1) { label[p + w] = id; st.push(p + w); }
    }
  }
  return boxes
    .map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0 + 1, h: b.y1 - b.y0 + 1, area: b.area }))
    .sort((a, b) => a.x - b.x);
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
}

/**
 * 数字らしい生成分の共通フィルタ（枠線・隅ノイズ・幅広ブロブを除去）。
 * 除去: 面積 < 15 / 高さ < 5 / 幅がストリップ幅の 0.5 超（プレート枠線）/ w:h > 1.6（横線・ブロブ）。
 * h >= 0.9*領域高 は枠/手番グロー枠のエッジ（数字ではない）。h 下限は 4: folded/暗プレートで
 * 小数点 "." が薄くなり高さ 4px しか残らない場合がある（71.3→713 の欠落原因）。
 * area >= 15 で微小ノイズは除くので 4 でも安全。glyphComponents（クリーン読み）と
 * readAmountBb の弧較正（クリーンな兄弟グリフの検出）の両方で使う共通基準。
 */
function digitish(comps: readonly RawComp[], maskH: number, maskW: number): RawComp[] {
  return comps.filter(
    (c) => c.area >= 15 && c.h >= 4 && c.h < 0.9 * maskH && c.w <= 0.5 * maskW && c.w / c.h <= 1.6,
  );
}

/**
 * 数字＋小数点だけを残す（枠線・隅ノイズ・幅広ブロブ・背の高い飾りを除去）。
 * 標準グリフ高は tall 成分の中央値。標準グリフより十分高い成分は飾り（BL の宝石/星 h42 vs 数字 h26）。
 */
function glyphComponents(mask: Gray): RawComp[] {
  const base = digitish(rawComponents(mask), mask.h, mask.w);
  if (base.length === 0) return base;
  const maxH = Math.max(...base.map((c) => c.h));
  const glyphH = median(base.filter((c) => c.h >= 0.5 * maxH).map((c) => c.h));
  return base.filter((c) => c.h <= 1.4 * glyphH);
}


/** 数字ごとの「囲まれた穴」の数（このゲームの書体）。 */
const DIGIT_HOLES: Readonly<Record<string, number>> = { '0': 1, '1': 0, '2': 0, '3': 0, '4': 1, '5': 0, '6': 1, '7': 0, '8': 2, '9': 1 };
/**
 * 文字の一致で選んだ数字と、穴の数が合う数字との一致の差がこれ未満なら、穴の数で決め直す。
 *
 * 決め直すのは「成分の穴の数が、選んだ数字と合わない」ときだけなので、差だけで決まるわけではない。
 * 実測（幅 1100 に縮小して JPEG 50 で保存した画像）: 6 を 5〔0.82〕と読み、6 は 0.73 で差 0.09、
 * 成分の穴は 1 つ（＝6）。同じ画像の本物の 5 は、6 との差が 0.17〜0.19 で穴は 0。
 */
const HOLE_TIE_GAP = 0.12;

/** 成分の外接矩形の中で、縁につながっていない背景のかたまり（＝穴）を数える。小さすぎるものは無視。 */
function countHoles(mask: Gray, c: Rect): number {
  const w = c.w + 2, h = c.h + 2; // 1px の余白を足して、外側の背景を 1 つにつなぐ
  const bg = new Uint8Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x >= 1 && x <= c.w && y >= 1 && y <= c.h;
      bg[y * w + x] = inside && mask.data[(c.y + y - 1) * mask.w + (c.x + x - 1)] ? 0 : 1;
    }
  const seen = new Uint8Array(w * h);
  const fill = (start: number): number => {
    const st = [start];
    seen[start] = 1;
    let area = 0;
    while (st.length) {
      const p = st.pop()!;
      area++;
      const px = p % w, py = Math.trunc(p / w);
      for (const q of [px > 0 ? p - 1 : -1, px < w - 1 ? p + 1 : -1, py > 0 ? p - w : -1, py < h - 1 ? p + w : -1]) {
        if (q >= 0 && bg[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    return area;
  };
  fill(0); // 外側
  let holes = 0;
  const minArea = Math.max(2, Math.round(0.01 * c.w * c.h));
  for (let i = 0; i < w * h; i++) if (bg[i] && !seen[i] && fill(i) >= minArea) holes++;
  return holes;
}

/**
 * 「線の明るさ」で切り直すときの位置（地の明るさを 0、線の明るさを 1 として）。
 *
 * 実測（評価 2026-10-11）: にじみで埋まった 5 のすき間は 0.42 より上で開く。本物の 6 の輪は、縮小して
 * 引き伸ばした画像で 0.70 まで、縮小して再圧縮した画像で 0.75 まで閉じたまま。その間に置く。
 */
const STROKE_LEVEL = 0.55;

/**
 * 成分の外接矩形を、**その文字の線の明るさ**を基準に切り直したマスク（矩形の左上が原点）。
 *
 * 文字のマスクは固定のしきい値で作るので、ぼけた画像では、線と線の間の狭いすき間がにじみで埋まり、
 * 開いているはずの部分が閉じて見える（実測: 5 の左下の開いた部分が埋まり、穴が 1 つ＝6 と同じ形に
 * なった。埋まった部分の明るさは 212 で、線は 250 前後、地は 180）。線そのものは、にじみより明るい。
 * 地（マスクの外の画素の中央値）と線（マスクの中の画素の上位 1 割の位置）の間で切り直せば、
 * にじみで埋まったすき間は開き、本物の線で囲まれた穴は閉じたまま残る。
 */
function strokeMask(mask: Gray, strip: Gray, c: Rect): Gray | null {
  const ink: number[] = [], bg: number[] = [];
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const i = (c.y + y) * mask.w + c.x + x;
      (mask.data[i] ? ink : bg).push(strip.data[i]!);
    }
  if (ink.length === 0 || bg.length === 0) return null;
  ink.sort((p, q) => p - q);
  bg.sort((p, q) => p - q);
  const stroke = ink[Math.floor(0.9 * (ink.length - 1))]!;
  const base = bg[Math.floor(0.5 * (bg.length - 1))]!;
  if (stroke <= base) return null;
  const cut = base + STROKE_LEVEL * (stroke - base);
  const data = new Uint8Array(c.w * c.h);
  for (let y = 0; y < c.h; y++)
    for (let x = 0; x < c.w; x++) {
      const i = (c.y + y) * mask.w + c.x + x;
      if (mask.data[i] && strip.data[i]! >= cut) data[y * c.w + x] = 255;
    }
  return { w: c.w, h: c.h, data };
}

/**
 * 成分の穴の数。文字のマスクと、線の明るさで切り直したマスクの**両方で同じ数**になったときだけ返す
 * （食い違えば null ＝ 穴の数は当てにならない）。
 */
export function robustHoles(mask: Gray, strip: Gray, c: Rect): number | null {
  const holes = countHoles(mask, c);
  const strict = strokeMask(mask, strip, c);
  if (!strict) return holes;
  return countHoles(strict, { x: 0, y: 0, w: c.w, h: c.h }) === holes ? holes : null;
}

/**
 * 文字の一致で選んだ数字と、成分の穴の数が合わないとき、穴の数が合う数字のうち一致のいちばん良い
 * ものが僅差なら、そちらを採る。
 *
 * 縮小して再圧縮した画像では、6 と 5、8 と 3 のように輪郭の似た数字の一致が僅差になり、取り違える
 * （評価 2026-10-10: 14.6 を 14.5 と読んだ。6〔下に輪がある〕と 5〔輪が無い〕は穴の数で見分けられる）。
 * 僅差の相手は 2 位とは限らない（実測: ぼけた画像の 8 が、6〔0.77〕・3〔0.77〕の順で、8 はその下。
 * 穴は 2 つで、穴が 2 つの数字は 8 だけ）。一致に差があるときは何もしない。
 *
 * 決め直した桁は、文字の一致と穴の数が食い違ったということなので、呼び側が信頼度を下げる。
 */
function breakTieByHoles(
  mask: Gray,
  strip: Gray,
  comp: Rect,
  templates: readonly Template[],
  m: { label: string; score: number },
): { label: string; flipped: boolean } {
  const keep = { label: m.label, flipped: false };
  const expected = DIGIT_HOLES[m.label];
  if (expected === undefined) return keep;
  const holes = robustHoles(mask, strip, comp);
  if (holes === null || holes === expected) return keep;
  const sameHoles = templates.filter((t) => DIGIT_HOLES[t.label] === holes);
  if (sameHoles.length === 0) return keep;
  const alt = bestMatch(normGlyph(strip, comp), sameHoles);
  return m.score - alt.score < HOLE_TIE_GAP ? { label: alt.label, flipped: true } : keep;
}

function normGlyph(strip: Gray, r: Rect): Gray {
  const g = crop(strip, r);
  const nw = Math.max(1, Math.round((g.w * DIGIT_NORM_H) / g.h));
  return resize(g, nw, DIGIT_NORM_H);
}

/**
 * 端に接する「幅広の白い横帯」（アバター発光弧・プレート下線）を薄く剥がす。弧も数字も白なので
 * 色では分離できないが、弧は端に接する高 fill の薄い帯（数字の上下端行は疎）なので幾何で剥がせる。
 * 端から連続して fill > bandFrac×幅 の行のみ黒化。各端は領域高の maxFrac（弧の想定厚み）までに
 * 厳しく制限し数字本体を食わない。帯が無ければ恒等（通常フレームは不変＝回帰なし）。
 */
function stripEdgeBands(mask: Gray, bandFrac = 0.5, maxFrac = 0.12): Gray {
  const { w, h, data } = mask;
  if (h < 8) return mask;
  const thr = bandFrac * w;
  const cap = Math.max(1, Math.floor(h * maxFrac));
  const rowFill = (y: number): number => {
    let c = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) if (data[row + x]) c++;
    return c;
  };
  let top = 0; while (top < cap && rowFill(top) > thr) top++;
  let bot = 0; while (bot < cap && rowFill(h - 1 - bot) > thr) bot++;
  if (top === 0 && bot === 0) return mask;
  const out = new Uint8Array(data);
  for (let y = 0; y < top; y++) out.fill(0, y * w, y * w + w);
  for (let y = 0; y < bot; y++) out.fill(0, (h - 1 - y) * w, (h - 1 - y) * w + w);
  return { w, h, data: out };
}

/**
 * 成分を「弧ブリッジ刈り込み」する（iPhone コーナー席のアバター発光弧が先頭桁の上端に融合し
 * 幅広ブロブ化する問題への対策。exp_band.ts の readBand で iOS 12/12・Android 65/66（現行と同一
 * ＝回帰なし）を確認済みの手法をそのまま移植）。
 *
 * 列ごとに縦方向の最大連続ラン長を求め、長さ >= N を「支持あり」とする。ギャップ <= 2N は
 * 同一クラスタへ橋渡し（グリフ内部の曲線起因の穴を跨ぐが、無関係に離れた弧の残骸までは跨がない）。
 * 最初（最も左）のクラスタだけを採用し、そこから外の部分（弧の残り／クロップ右端付近で接線が
 * 急峻になり列単独では「弧なのに縦ランが長い」偽陽性を起こす箇所）を切り捨てる。
 * 画素内容は元マスク（開放前）から再取得するので、"9" の輪や "B" の腹のような細いストローク
 * （弧の厚みと同オーダー）を千切らずに済む。クラスタが見つからなければ元の成分をそのまま返す。
 */
function trimArcBridge(mask: Gray, c: RawComp, N: number): RawComp {
  const { w, h, data } = mask;
  const y0 = Math.max(0, c.y - 1), y1 = Math.min(h, c.y + c.h + 1);
  const supported: boolean[] = new Array(c.w).fill(false);
  for (let xi = 0; xi < c.w; xi++) {
    const x = c.x + xi;
    let run = 0, maxRun = 0;
    for (let y = y0; y < y1; y++) {
      if (data[y * w + x]) { run++; if (run > maxRun) maxRun = run; } else run = 0;
    }
    supported[xi] = maxRun >= N;
  }
  const R = N;
  const clusters: { x0: number; x1: number }[] = [];
  let curStart = -1, lastTrue = -1;
  for (let xi = 0; xi < c.w; xi++) {
    if (supported[xi]) {
      if (curStart < 0) curStart = xi;
      lastTrue = xi;
    } else if (curStart >= 0 && xi - lastTrue > 2 * R) { clusters.push({ x0: curStart, x1: lastTrue }); curStart = -1; }
  }
  if (curStart >= 0) clusters.push({ x0: curStart, x1: lastTrue });
  if (clusters.length === 0) return c;
  const first = clusters[0]!;
  const nx0 = c.x + first.x0, nx1 = c.x + first.x1 + 1;
  let ny0 = h, ny1 = 0, area = 0;
  for (let x = nx0; x < nx1; x++) for (let y = y0; y < y1; y++) if (data[y * w + x]) {
    area++;
    if (y < ny0) ny0 = y;
    if (y + 1 > ny1) ny1 = y + 1;
  }
  if (ny1 <= ny0) return c;
  return { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0, area };
}

/**
 * BB 表示の金額を読む（"20.2 BB" → 20.2, "13 BB" → 13）。値は表示どおり **BB**（正規化不要）。
 * templates は数字 0-9（'.' は成分の低さで判定するのでテンプレ不要）。
 * 数字が無ければ value=NaN, conf=0。
 *
 * 接尾辞 "BB" の切り離しは **NCC アンカー**（`letters` に "B" テンプレを渡す）で行う。
 * 旧実装は「末尾 tall 2 個＝BB」と位置決め打ちだったため、席の右にある UI 装飾
 * （手番シェブロン ▼ 等）が余分な tall 成分を作ると BB でなく装飾を切ってしまい、
 * "BB" を数字 "88" として採用する誤読が起きた（実 iPhone TR 27.7→17.788）。
 * letters があれば最初の英字（"B"）で数値を打ち切り、以降（BB・シェブロン・名前）を捨てる。
 * letters が無い場合は従来どおり大きなギャップで数値末尾を推定する。
 *
 * さらに、先頭桁がアバターの発光リング/弧（iPhone コーナー席）に融合し幅広ブロブ化して
 * glyphComponents 相当の w/h<=1.6 フィルタで丸ごと落とされるケース（実 iPhone TL "19.2"→"9"、
 * "21.2"→"11.2" 相当の誤読）を **弧ブリッジ刈り込み**（trimArcBridge, exp_band.ts の readBand で
 * iOS 12/12・Android 65/66=現行同等 を確認済みの手法）で数字として復元する。
 * 刈り込みは「幅広ブロブ（w/h>1.6）または典型幅の 1.35 倍超」という **suspect ゲート**を通った
 * 成分にしか適用しない（フックだけの小さな融合で比率はまだ壊れていないケースも拾うため 1.35 倍
 * 判定も使うが、通常のクリーンな数字はどちらの条件にも掛からず刈り込み関数自体を一切通らない
 * ＝クリーン読みは旧実装とビット互換）。
 */
export function readAmountBb(
  img: Rgba,
  rect: Rect,
  templates: readonly Template[],
  opts: BbAmountOptions = {},
  letters?: readonly Template[],
): Read<number> {
  const minCh = opts.minCh ?? 120;
  const maxSat = opts.maxSat ?? 80;
  const strip = grayFromRgba(img, rect);
  const mask = stripEdgeBands(whiteMask(img, rect, { minCh, maxSat }));
  const rawAll = rawComponents(mask);

  // ---- 較正: クリーンな（弧に融合していない）兄弟グリフから glyphH・normalW（"1" 以外の典型幅）を推定 ----
  const preClean = digitish(rawAll, mask.h, mask.w);
  let glyphH: number;
  let normalW: number;
  if (preClean.length > 0) {
    const maxHc = Math.max(...preClean.map((c) => c.h));
    const tallOnes = preClean.filter((c) => c.h >= 0.5 * maxHc);
    glyphH = median(tallOnes.map((c) => c.h));
    normalW = median(tallOnes.map((c) => c.w));
  } else {
    // クリーンな兄弟が皆無（全桁が弧に融合等）→ ストリップ高から粗く見積もる。
    glyphH = rawAll.length > 0 ? Math.max(...rawAll.map((c) => c.h)) : Math.round(mask.h * 0.7);
    normalW = glyphH * 0.8;
  }
  // N: 弧の想定厚み（実測 2-6px）より上、実数字ストローク高より下にクランプ。
  let N = Math.round(0.35 * glyphH);
  N = Math.max(4, Math.min(N, Math.max(4, glyphH - 3)));

  // ---- 弧ブリッジ刈り込み: suspect（幅広ブロブ or 典型幅の1.35倍超）な成分だけ trimArcBridge を通す ----
  const salvaged: RawComp[] = [];
  for (const c of rawAll) {
    if (c.area < 15 || c.h < 4 || c.h >= 0.9 * mask.h || c.w > 0.5 * mask.w) continue;
    const needsTrim = c.w / c.h > 1.6 || c.w > 1.35 * normalW;
    const use = needsTrim ? trimArcBridge(mask, c, N) : c;
    if (use.area >= 15 && use.h >= 4 && use.w / use.h <= 1.6) salvaged.push(use);
  }
  salvaged.sort((a, b) => a.x - b.x);
  const gValid = salvaged.filter((c) => c.h <= 1.4 * glyphH);
  if (gValid.length === 0) return { value: Number.NaN, conf: 0 };

  const maxH2 = Math.max(...gValid.map((c) => c.h));
  const tallCut = 0.45 * maxH2;
  const tall = gValid.filter((c) => c.h >= tallCut);
  if (tall.length < 3) return { value: Number.NaN, conf: 0 }; // 数字 1 個 ＋ "BB" 未満は読めない

  // 末尾 "BB" の位置を **letters NCC**（右端の隣接 "B" ペア）で特定する。席の右にある UI 装飾
  // （手番シェブロン ▼ 等）が BB の右に余分な tall 成分を作っても、BB ペア以降を数値スパンから
  // 外せる。旧実装の「末尾 tall 2 個＝BB」決め打ちは、その装飾を BB と誤って落とし、本物の BB を
  // 数字 "88" として採用していた（実 iPhone TR 27.7→17.788 の主因）。B ペアが見つからない場合
  // （B の誤読・ベット帯で B が数字化する等）は **旧来どおり末尾 tall 2 個を BB** とみなす
  // ＝クリーンなフレームでは挙動不変（回帰なし）。
  const isB = (c: RawComp): boolean =>
    letters !== undefined && bestMatch(normGlyph(strip, c), [...templates, ...letters]).label === 'B';
  let suffixStart = -1;
  if (letters) for (let i = tall.length - 1; i >= 1; i--) if (isB(tall[i]!) && isB(tall[i - 1]!)) { suffixStart = i - 1; break; }
  const numTall = suffixStart >= 0 ? tall.slice(0, suffixStart) : tall.slice(0, -2);
  if (numTall.length === 0) return { value: Number.NaN, conf: 0 };
  const firstX = numTall[0]!.x;
  const lastTall = numTall.at(-1)!;
  const lastX = lastTall.x + lastTall.w;
  const digitBottom = median(numTall.map((c) => c.y + c.h));

  // ---- 小数点は刈り込みで消えうる（w/h<=1.6 の最終フィルタで弧の残骸ごと落ちる場合がある）ので、
  // gValid ではなく **生マスクの小成分**（背が低い・面積小・ベースライン付近・数値スパン内）から
  // 別途拾い、x 座標で数字列の隙間へ挿し込む。 ----
  const dots = rawAll.filter(
    (c) =>
      c.h <= 0.45 * glyphH &&
      c.h >= 2 &&
      c.area >= 4 &&
      c.x >= firstX - 2 &&
      c.x + c.w <= lastX + 2 &&
      Math.abs(c.y + c.h - digitBottom) <= 0.3 * glyphH,
  );

  type Item = { readonly x: number; readonly dot: boolean; readonly comp: RawComp };
  const items: Item[] = [
    ...numTall.map((c) => ({ x: c.x, dot: false, comp: c })),
    ...dots.map((c) => ({ x: c.x, dot: true, comp: c })),
  ].sort((a, b) => a.x - b.x);

  const scoreFloor = opts.scoreFloor ?? 0; // 既定 0＝旧挙動（呼び出し側が明示した席のみ有効）
  let text = '';
  let minScore = 1;
  for (const it of items) {
    if (it.dot) {
      text += '.'; // 小数点
      continue;
    }
    const m = bestMatch(normGlyph(strip, it.comp), templates);
    if (m.score < scoreFloor) continue; // 飾り/スリバー/アイコン片を桁として採用しない
    text += m.label;
    const s = matchConfidence(m);
    if (s < minScore) minScore = s;
  }
  const value = parseAmount(text);
  if (value === null) return { value: Number.NaN, conf: 0 };
  let conf = Math.max(0, Math.min(1, minScore));
  // 刈り込み後もなお左端(x<=2)に幅広 tall 塊が残る＝弧が刈りきれなかった残留ブリッジ。低信頼フラグ
  // して確認画面で強調 → 利用者修正に回す（サイレントな高信頼誤読を防ぐ）。gValid は既に
  // w/h<=1.6 を満たす成分のみなのでこの条件（w/h>2.0）は通常発生しないが、将来の閾値変更に
  // 対する保険として残す（exp_band.ts の readBand と同じ設計）。
  const stillClipped = gValid.some((c) => c.x <= 2 && c.h >= 0.7 * maxH2 && c.w / c.h > 2.0);
  if (stillClipped) conf = Math.min(conf, 0.4);
  return { value, conf };
}

/** "BB" の 2 文字の間の隙間の上限（文字の高さ比）。実測 0.1〜0.2。数値と単位の間の空白は 0.5〜0.7。 */
const BB_TIGHT_GAP = 0.35;
/** B の右に詰まった成分を 2 つ目の B と認める、B テンプレとの一致の下限。 */
const B_SECOND_MIN = 0.5;
/**
 * 数字と読めた成分を 1 つ目の B と認める、B テンプレとの一致の下限。
 *
 * この組は並び方（右隣が B と読めて詰まっている・左は空いている）でほぼ決まるので、一致は低めでよい。
 * 数値の最後の桁は、単位との間に空白があるので B に詰まらない。実測（幅 950 の JPEG 45）: "0.5 BB" と
 * "1 BB" の 1 つ目の B が 6・3 と読め、B との一致は 0.63〜0.64 だった。
 */
const B_FIRST_MIN = 0.55;
/** 2 文字とも数字と読めたときに、どちらにも求める B テンプレとの一致の下限。 */
const B_BOTH_MIN = 0.8;
/** 1 つ目の B の左の空白が、2 文字の隙間よりこれだけ（文字の高さ比）広いこと。 */
const BB_SPACE_MARGIN = 0.25;
/**
 * 読みの**構造**に疑いがあるとき（数値の並びの中の成分を落とした・欠片がある・数字の左に読めていない塊がある）の
 * 信頼度の上限。文字の一致が良くても、桁が欠けているかもしれない読みはこれ以下に抑える。
 */
export const STRUCT_DOUBT_CONF = 0.5;
/**
 * 隣り合う桁の中心の間隔（文字の高さ比）のしきい値。実測: 小数点なし 0.98〜1.12、あり 1.29〜1.47。
 *  - 小数点があるのに、これ未満: 疑う（値は変えない）。
 *  - 小数点が無いのに、INSERT 以上 MISSING 以下: 小数点を補う。MISSING を超えたら桁が抜けているとして疑う。
 */
const DOT_DOUBT_PITCH = 1.15;
const DOT_INSERT_PITCH = 1.25;
const DOT_MISSING_PITCH = 1.7;
/** 数字の左の「読めていない塊」と見なす隙間の上限（文字の高さ比）。桁どうしの隙間は 0.1〜0.2、小数点をはさんで 0.5 前後。 */
const LEFTOVER_MAX_GAP = 0.6;
/** 穴の数で決め直した桁に付ける信頼度の上限（確認画面で強調される）。 */
const TIE_FLIP_CONF = 0.7;
/** 領域の端に接した成分を「切れた文字」と見なす、一致の下限。 */
const CLIPPED_MIN_SCORE = 0.4;
/** 先頭の数字を拾い直すときの、数字テンプレとの一致の下限（飾り線の誤一致は実測 0.79 まで）。 */
const LEAD_MIN_SCORE = 0.85;
/** 先頭の数字を拾い直す窓に必要なインクの割合（何も無い場所を照合しない）。 */
const LEAD_MIN_INK = 0.3;

/**
 * 名前アンカー方式の BB スタック読取（ディレクタの two-anchor 設計）。SPEC §6.2 拡張。
 *
 * 目的（ローカライズの頑健化）: BB 表示の席近傍には "BB" が複数現れうる——(1) スタックの "BB"
 * （数字の直後・黄色名の直上）, (2) **BB ポジションの紫バッジ**（アバター左上）, (3) テーブル felt 上の
 * 白い "BB" 位置ラベル（左下）, (4) 隣席のスタック "BB"（広域クロップの端）。現行 readAmountBb は
 * タイトに較正した stack 矩形＋「最右の BB ペア」で (1) を正しく取れているが、矩形がドリフト/拡大
 * すると (2)(3) がクロップに入り、バッジの "BB" が数字化して誤読する（例 "12.9"→"8812.9"）。
 *
 * 実測（scripts/_probeNA2, Android GT 20枚＋iPhone GT 2枚 の bb 席）で判別子は明快:
 *   - stack-BB は **直左に数字を持つ**（digitLeft=40/40, 数字→BBの隙間 <~2 グリフ幅）。
 *   - バッジ/felt/隣席の "BB" は **直左に数字を持たない**（15/15）。
 *   - stack-BB は黄色名の中心に最も近い（dx/Nh∈[-1.05,+4.59]）, バッジ/felt は遠く左（dx/Nh∈[-8.93,-3.89]）。
 * よって選択規則は「**直左に数字の連続塊を持つ BB トークンのうち、黄色名中心に最も近いもの**」。
 * その BB の**直左の連続数字塊だけ**を数値スパンにする（バッジ由来の左方 B を数字に化けさせない）。
 *
 * これは readAmountBb の「最右 BB ペア＋その左の全 tall」より広域ノイズに強い。**安全策**として
 * extract は現行 readAmountBb を主とし、これは NaN 時のフォールバックにのみ使う（クリーン席は
 * 現行パスのまま＝ビット不変・回帰なし）。stackRect は現行と同じ席矩形を渡し、この関数が内部で
 * 左方（バッジ側）へ広げて探索する。nameCx（黄色名中心 x, 画像絶対 px）が与えられればアンカーに使う。
 */
export function readAmountBbAnchored(
  img: Rgba,
  stackRect: Rect,
  templates: readonly Template[],
  opts: BbAmountOptions = {},
  letters?: readonly Template[],
  nameCx?: number,
): Read<number> {
  const info = { clipped: false };
  const first = readAnchoredOnce(img, stackRect, templates, opts, letters, nameCx, 0.6, info);
  if (!info.clipped) return first;
  // 文字が探索領域の上端か下端で切れている: 領域の縦位置がずれている（名前の高さを小さく見積もった
  // 画像で起きる。評価 2026-10-10: 縮小して再圧縮した画像で「1 BB」「2 BB」の上が切れて未読）。
  // 縦に広げてもう一度読み、読めたほう・一致の良いほうを採る。
  const wide = { clipped: false, tokenCy: Number.NaN };
  const second = readAnchoredOnce(img, stackRect, templates, opts, letters, nameCx, 1.6, wide);
  // 広げた領域には別の数値（ベットの下にある hero のスタックなど）も入る。読めた数値が、元の領域の
  // 端から矩形の半分以内に無ければ、切れていた文字の読み直しではないので採らない。
  const top = stackRect.y - 0.6 * stackRect.h, bottom = stackRect.y + 1.6 * stackRect.h;
  const near = wide.tokenCy >= top - 0.5 * stackRect.h && wide.tokenCy <= bottom + 0.5 * stackRect.h;
  if (near && Number.isFinite(second.value) && (!Number.isFinite(first.value) || second.conf > first.conf)) return second;
  return first;
}

function readAnchoredOnce(
  img: Rgba,
  stackRect: Rect,
  templates: readonly Template[],
  opts: BbAmountOptions,
  letters: readonly Template[] | undefined,
  nameCx: number | undefined,
  /** 上下に広げる量（矩形の高さ比）。 */
  grow: number,
  /** 文字らしい成分が領域の上端・下端に接していたら clipped を立てる。tokenCy は採った数値の縦の中心（画像座標）。 */
  info: { clipped: boolean; tokenCy?: number },
): Read<number> {
  const minCh = opts.minCh ?? 120;
  const maxSat = opts.maxSat ?? 80;
  // 探索領域: 矩形がどちら向きにドリフトしても stack を含むよう左右対称に広げる（ドリフトは
  // 対称なので左右非対称だと片方向で stack を外す＝drift 掃引で実証）。上下は stack 近傍に留め、
  // 上のカード pip・下の名前を帯外へ落とす。バッジ（左上）・felt/隣席の "BB" は領域に入りうるが
  // 「直左に数字」判別子＋名前アンカーで stack-BB だけを選ぶ。whiteMask は画像外を内部クランプ。
  const left = Math.round(stackRect.w * 1.5);
  const right = Math.round(stackRect.w * 0.7);
  const up = Math.round(stackRect.h * grow);
  const down = Math.round(stackRect.h * grow);
  const region: Rect = { x: stackRect.x - left, y: stackRect.y - up, w: stackRect.w + left + right, h: stackRect.h + up + down };

  const strip = grayFromRgba(img, region);
  const mask = stripEdgeBands(whiteMask(img, region, { minCh, maxSat }));
  const rawAll = rawComponents(mask);

  // 広域領域では card pip 等の**背の高い白ブロブ**が混じるため、readAmountBb の
  // 「median 高さで較正」だと glyphH が pip 側へ引っ張られ数字が全滅する。そこで**尺度は BB の
  // "B" 高さ**に委ねる（BB→数字の高さは rigid ＝同一, sd 0.022 の実証; SPEC §6.2 冒頭）。まず通常
  // グリフ（w/h<=1.6）だけを NCC 分類し、隣接 B,B ペアを見つけ、その B 高さ gh を基準に直左の
  // 連続数字塊を採る（高さ [0.6,1.5]gh・同一ベースライン）。pip は 'B'/数字に化けても高さで弾かれる。
  const lset = letters ?? [];
  const narrow = rawAll
    .filter((c) => c.area >= 15 && c.h >= 6 && c.h < 0.9 * mask.h && c.w <= 0.5 * mask.w && c.w / c.h <= 1.6)
    .sort((a, b) => a.x - b.x);
  if (narrow.length < 3) return { value: Number.NaN, conf: 0 };
  const labeled = narrow.map((c) => {
    const g = normGlyph(strip, c);
    const m = bestMatch(g, [...templates, ...lset]);
    // "8" と読めた成分が B にもよく似ているか（"BB" の 2 文字目を 8 と取り違えた場合の救済に使う）。
    const bScore = m.label !== 'B' && lset.length > 0 ? bestMatch(g, lset).score : 0;
    return { c, label: m.label, score: m.score, bScore };
  });
  // 数字か B にそこそこ一致する成分が、領域の上端か下端に接している＝文字が切れている。
  // 切れた文字の一致は低い（実測: 上 3 割が切れた "BB" は、どちらも 0 に 0.47〜0.49）ので、下限は低めに置く。
  if (labeled.some((l) => l.score >= CLIPPED_MIN_SCORE && (l.c.y <= 0 || l.c.y + l.c.h >= mask.h) && l.c.h >= 8)) info.clipped = true;
  const isDigit = (l: string): boolean => l.length === 1 && l >= '0' && l <= '9';
  // 隣り合う 2 成分が "BB" の組か（どちらも B と読め、同じ高さ・近接・同じベースライン）。
  // i の右隣の「同じ行の成分」。x 順の並びには、行の外の小さな欠片（上の飾り・下のバッジの一部）が
  // 挟まることがあり、単純に i+1 を見ると "BB" の 2 文字が隣どうしにならない（実測: ピンクの卓の
  // 「1 BB」で、B と B の間の x に、上の飾りの欠片が入って未読になっていた）。
  const nextInRow = (i: number): number => {
    const a = labeled[i];
    if (!a) return -1;
    for (let j = i + 1; j < labeled.length; j++) {
      const c = labeled[j]!.c;
      const overlap = Math.min(a.c.y + a.c.h, c.y + c.h) - Math.max(a.c.y, c.y);
      if (overlap >= 0.5 * a.c.h && c.h >= 0.6 * a.c.h) return j;
    }
    return -1;
  };
  // i の左隣の「同じ行の成分」。
  const prevInRow = (i: number): number => {
    const a = labeled[i];
    if (!a) return -1;
    for (let j = i - 1; j >= 0; j--) {
      const c = labeled[j]!.c;
      const overlap = Math.min(a.c.y + a.c.h, c.y + c.h) - Math.max(a.c.y, c.y);
      if (overlap >= 0.5 * a.c.h && c.h >= 0.6 * a.c.h) return j;
    }
    return -1;
  };
  /**
   * i と右隣が "BB" の組か。同じ高さ・近接・同じベースラインで、次のどれか:
   *  1. どちらも B と読めた。
   *  2. 1 文字目が B で、2 文字目は **すぐ右に詰まっている**（数字と読めていても、B にある程度似ていればよい）。
   *     表示は必ず「数値 BB」で終わり、B の後ろに詰めて置かれるのは 2 つ目の B だけなので、並び方で決める
   *     （実測: 縮小・再圧縮した画像で 2 文字目だけ 8 や 6 と読め、"BB" が見つからず未読になった）。
   *  3. 2 文字目が B で、1 文字目は B によく似た数字と読めていて、**2 文字の間は詰まっているのに、その左は
   *     空いている**（数値と単位の間の空白）。1 文字目だけ 8 と読めた場合（実測: ポットの「5 BB」が
   *     "5 8B" になり、近くのベットの 1 BB をポットとして読んだ）。左が詰まっていれば本物の数字なので認めない。
   */
  const isBbPair = (i: number): boolean => {
    const a = labeled[i], b = labeled[nextInRow(i)];
    if (!a || !b) return false;
    const gh = (a.c.h + b.c.h) / 2;
    const gap = b.c.x - (a.c.x + a.c.w);
    if (Math.abs(a.c.h - b.c.h) > 0.35 * gh) return false; // 同程度の高さ
    if (gap > 0.9 * gh) return false; // BB は近接
    if (Math.abs((a.c.y + a.c.h) - (b.c.y + b.c.h)) > 0.3 * gh) return false; // 同一ベースライン
    const aB = a.label === 'B' && a.score >= 0.5;
    const bB = b.label === 'B' && b.score >= 0.5;
    if (aB && bB) return true;
    const tight = gap <= BB_TIGHT_GAP * gh;
    if (aB) return tight && b.bScore >= B_SECOND_MIN;
    // 1 文字目が B と読めていない: 2 文字が詰まっていて、その左が空いている（数値と単位の間の空白）こと。
    // 2 文字目も数字と読めているなら（小さな画像では B が両方とも 8 と読めることがある）、どちらも
    // B によく似ていることを求める。
    if (!tight || a.bScore < B_FIRST_MIN) return false;
    if (!bB && (a.bScore < B_BOTH_MIN || b.bScore < B_BOTH_MIN)) return false;
    const prev = labeled[prevInRow(i)];
    return !!prev && a.c.x - (prev.c.x + prev.c.w) >= gap + BB_SPACE_MARGIN * gh;
  };

  // BB トークン列挙。各トークンの B 高さ gh を尺度に、直左の連続数字塊を集める。
  interface Cand { digitRun: number[]; gh: number; bbX0: number; bbBottom: number; cx: number; broken: boolean; atColon: boolean }
  const cands: Cand[] = [];
  let consumed = -1; // ここまでの成分は、すでに "BB" の組として使った
  for (let i = 0; i + 1 < labeled.length; i++) {
    if (i <= consumed || !isBbPair(i)) continue;
    // B と読める成分が 3 つ以上並んでいたら、**右端の 2 つ**が "BB"（表示は必ず「数値 BB」で終わる）。
    // 左側の「B」は、B と取り違えた数字（"8" "0" が多い）。左から組にすると、"98 BB" の "8B" を
    // 接尾辞と見なして 9 と読んでしまう（実測: 縮小した画像で 98→9、2.8→2。信頼度は高いまま）。
    const j = nextInRow(i);
    if (isBbPair(j)) continue;
    const a = labeled[i]!, b = labeled[j]!;
    const gh = (a.c.h + b.c.h) / 2;
    const bbBottom = (a.c.y + a.c.h + b.c.y + b.c.h) / 2;
    const run: number[] = [];
    const fragments: number[] = []; // 数字の行にある、小数点らしくない背の低い成分の x
    let atColon = false; // 数値の左端がコロンだった（それより左は数値ではない）
    let ref = a.c.x;
    for (let k = i - 1; k >= 0; k--) {
      const g = labeled[k]!;
      if (ref - (g.c.x + g.c.w) > 1.2 * gh) break; // 大きな隙間＝数値の左端（バッジまでは届かない）
      // B と同じ高さの帯に掛からない成分（ベット下の "SB" バッジ・上の飾り片等）は数値の一部ではない。
      // 打ち切らずに飛ばす（打ち切ると "0.5" の "0" まで届かず "5" と読む。実測: ピンク系の卓の SB ベット）。
      if (g.c.y + g.c.h <= bbBottom - gh || g.c.y >= bbBottom) continue;
      // 背の低い成分（小数点候補・NCC で数字ラベルに化けても桁ではない）はスキップして左へ継続。
      if (g.c.h < 0.6 * gh) {
        // すぐ上に同じくらいの点が重なっていれば、コロンの下の点。数値はここで終わり。
        if (
          opts.stopAtColon &&
          rawAll.some(
            (c) =>
              c !== g.c &&
              c.h < 0.6 * gh &&
              c.area >= 0.4 * g.c.area &&
              c.area <= 2.5 * g.c.area &&
              Math.abs(c.x + c.w / 2 - (g.c.x + g.c.w / 2)) <= 0.15 * gh &&
              c.y + c.h <= g.c.y &&
              c.y >= bbBottom - 1.2 * gh,
          )
        ) {
          atColon = true;
          break;
        }
        const dotLike = g.c.h <= 0.45 * gh && g.c.w <= 0.45 * gh && Math.abs(g.c.y + g.c.h - bbBottom) <= 0.3 * gh;
        if (!dotLike) fragments.push(g.c.x);
        ref = g.c.x;
        continue;
      }
      // 背の高い非数字で打ち切る。ただし "BB" の直左に続く「B」は、上のとおり B と取り違えた数字
      // なので数値に含める（桁の文字は、あとで数字のテンプレだけで読み直す）。
      if (!isDigit(g.label) && g.label !== 'B') break;
      if (g.c.h > 1.5 * gh) break; // 数字高は B 高と同程度（rigid）
      if (Math.abs(g.c.y + g.c.h - bbBottom) > 0.35 * gh) break; // 同一ベースライン
      run.unshift(k);
      ref = g.c.x;
    }
    if (run.length === 0) continue; // 直左に数字が無い＝バッジ/felt/隣席（判別子）→除外
    const firstC = labeled[run[0]!]!.c;
    // 数値の並びの中（先頭の桁より右）に、小数点でも桁でもない欠片がある: しきい値が高すぎて桁が欠け、
    // 欠片になって飛ばされた（評価 2026-10-11: ぼけた画像を 215 で読み、"14.6" の 4 と 6 が欠片になって
    // 1〔信頼度 0.90〕と読んだ）。
    const broken = fragments.some((x) => x > firstC.x);
    cands.push({ digitRun: run, gh, bbX0: a.c.x, bbBottom, cx: (firstC.x + a.c.x) / 2 + region.x, broken, atColon });
    consumed = j; // ペア消費
  }
  if (cands.length === 0) return { value: Number.NaN, conf: 0 };

  // 選択: 名前中心に最も近い候補。nameCx が無ければ最右（stack は最右, バッジは左）。
  const chosen = nameCx !== undefined
    ? cands.reduce((best, c) => (Math.abs(c.cx - nameCx) < Math.abs(best.cx - nameCx) ? c : best), cands[0]!)
    : cands.reduce((best, c) => (c.cx > best.cx ? c : best), cands[0]!);

  if (nameCx !== undefined && opts.maxAnchorDist !== undefined && Math.abs(chosen.cx - nameCx) > opts.maxAnchorDist) {
    return { value: Number.NaN, conf: 0 };
  }
  const gh = chosen.gh;
  info.tokenCy = region.y + chosen.bbBottom - gh / 2;
  let N = Math.round(0.35 * gh);
  N = Math.max(4, Math.min(N, Math.max(4, gh - 3)));
  const numTall: RawComp[] = chosen.digitRun.map((k) => labeled[k]!.c);
  const core = new Set<RawComp>(numTall);
  // 先頭桁がアバター発光弧に融合し幅広ブロブ化して narrow から漏れるケース（iOS コーナー
  // "19.2"→"9.2"）: 現行 run の左に、弧刈り込みで数字化できる幅広ブロブがあれば復元して前置。
  // コロンで打ち切った数値では行わない（コロンの左はラベルの文字）。
  if (!chosen.atColon) {
    const leftX = numTall[0]!.x;
    let blob: RawComp | null = null;
    for (const c of rawAll) {
      if (c.w / c.h <= 1.6) continue; // 幅広のみ
      if (c.h < 0.7 * gh || c.h > 1.8 * gh) continue;
      if (c.x + c.w > leftX + 2 || leftX - (c.x + c.w) > 1.2 * gh) continue; // run の直左
      if (Math.abs(c.y + c.h - chosen.bbBottom) > 0.5 * gh) continue;
      if (!blob || c.x > blob.x) blob = c;
    }
    if (blob) {
      const t = trimArcBridge(mask, blob, N);
      if (t.area >= 15 && t.h >= 0.6 * gh && t.w / t.h <= 1.6) numTall.unshift(t);
    }
  }
  numTall.sort((a, b) => a.x - b.x);
  // 先頭の数字が札の飾り線（楕円の枠など）とつながって 1 つの大きな成分になり、数字として拾えて
  // いない場合がある（実測: 明るくした画像で "0.5" の 0 が飾り線と融合し、5 と読んだ。信頼度は高いまま）。
  // 成分に頼らず、いまの先頭のすぐ左を **数字 1 文字ぶんの窓**で数字テンプレと照合し、はっきり一致
  // したら先頭に足す。窓の幅は B の幅（"1" 以外の数字と同じ）。幅の狭い窓は使わない —— 0 の左の
  // 縦線だけで "1" に 0.93 で一致してしまう（実測）。
  // コロンで打ち切った数値は、左へ拾い直さない（コロンの左はラベルの文字）。
  for (let round = 0; round < 2 && !chosen.atColon; round++) {
    const first = numTall[0]!;
    const gw = Math.round(labeled.find((l) => l.c.x === chosen.bbX0)?.c.w ?? first.w);
    const top = Math.round(chosen.bbBottom - gh), h = Math.round(gh);
    let best: { x: number; label: string; score: number } | null = null;
    for (let x0 = first.x - gw - 1; x0 >= Math.max(0, first.x - gw - Math.round(0.9 * gh)); x0--) {
      if (top < 0 || top + h > mask.h) break;
      let ink = 0;
      for (let y = top; y < top + h; y++) for (let x = x0; x < x0 + gw; x++) if (mask.data[y * mask.w + x]) ink++;
      if (ink < LEAD_MIN_INK * gw * h) continue;
      const m = bestMatch(normGlyph(strip, { x: x0, y: top, w: gw, h }), templates);
      if (!best || m.score > best.score) best = { x: x0, label: m.label, score: m.score };
    }
    if (!best || best.score < LEAD_MIN_SCORE || !isDigit(best.label)) break;
    numTall.unshift({ x: best.x, y: top, w: gw, h, area: gw * h });
  }
  const firstX = numTall[0]!.x;
  const lastTall = numTall.at(-1)!;
  const lastX = lastTall.x + lastTall.w;
  const digitBottom = median(numTall.map((c) => c.y + c.h));

  // 小数点は生マスクの小成分から拾う（readAmountBb と同一の基準, gh を尺度に）。
  const dots = rawAll.filter(
    (c) =>
      c.h <= 0.45 * gh &&
      c.h >= 2 &&
      c.area >= 4 &&
      c.x >= firstX - 2 &&
      c.x + c.w <= lastX + 2 &&
      Math.abs(c.y + c.h - digitBottom) <= 0.3 * gh,
  );

  type Item = { readonly x: number; readonly dot: boolean; readonly comp: RawComp };
  const items: Item[] = [
    ...numTall.map((c) => ({ x: c.x, dot: false, comp: c })),
    ...dots.map((c) => ({ x: c.x, dot: true, comp: c })),
  ].sort((a, b) => a.x - b.x);

  const scoreFloor = opts.scoreFloor ?? 0;
  let minScore = 1;
  let dropped = false;
  const toks: { readonly comp: RawComp; readonly ch: string }[] = [];
  for (const it of items) {
    if (it.dot) { toks.push({ comp: it.comp, ch: '.' }); continue; }
    const m = bestMatch(normGlyph(strip, it.comp), templates);
    if (m.score < scoreFloor) {
      // 数値の並びの中の成分を「数字ではない」として落とした: 桁が 1 つ欠けた読みかもしれないので、
      // 自信のある読みとしては扱わない（評価 2026-10-10: "98" の 9 を落とした ".8" が 0.86 で採用された）。
      // 左に足してみた成分（弧の刈り込み）が数字でなかっただけの場合は数えない。
      if (core.has(it.comp)) dropped = true;
      continue;
    }
    const tie = breakTieByHoles(mask, strip, it.comp, templates, m);
    toks.push({ comp: it.comp, ch: tie.label });
    const s = tie.flipped ? Math.min(matchConfidence(m), TIE_FLIP_CONF) : matchConfidence(m);
    if (s < minScore) minScore = s;
  }
  // 小数点と、桁どうしの間隔の整合。桁の中心の間隔は、小数点をはさまなければ文字の高さの 0.9〜1.1 倍、
  // はさめば 1.3〜1.5 倍（小数点の幅ぶん広い）。ぼけた画像では、桁の間のにじみを小数点と数えたり
  // （98 → 9.8）、暗くなった小数点を落としたりする（96.5 → 965）ので、間隔と食い違う読みを直す・疑う。
  let text = '';
  let dotDoubt = false, dotInserted = false;
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k]!;
    text += t.ch;
    if (t.ch === '.') continue;
    let n = k + 1, hasDot = false;
    while (toks[n]?.ch === '.') { hasDot = true; n++; }
    const next = toks[n];
    if (!next) continue;
    const pitch = next.comp.x + next.comp.w / 2 - (t.comp.x + t.comp.w / 2);
    if (hasDot) {
      // 小数点が入るだけの間隔が無い: にじみを小数点と数えたかもしれない。
      if (pitch < DOT_DOUBT_PITCH * gh) dotDoubt = true;
    } else if (pitch >= DOT_INSERT_PITCH * gh) {
      // 小数点 1 つぶん空いているのに、点が見つからなかった: 補う。もっと広ければ桁が抜けている。
      if (pitch <= DOT_MISSING_PITCH * gh) { text += '.'; dotInserted = true; }
      else dotDoubt = true;
    }
  }
  // 表示は "0.5 BB" の形で、0 で始まる 2 桁以上の数（"05"）は存在しない。小数点（数 px の点）を
  // 拾えなかっただけなので補い、確認画面で強調されるよう信頼度を下げる。
  if (/^0\d/.test(text)) {
    text = `0.${text.slice(1)}`;
    minScore = Math.min(minScore, 0.7);
  }
  // 小数点で始まる数（".8"）は表示に無い。先頭の桁を拾えていないので、読めなかったことにする。
  if (text.startsWith('.')) return { value: Number.NaN, conf: 0 };
  if (dropped || dotDoubt || chosen.broken) minScore = Math.min(minScore, STRUCT_DOUBT_CONF);
  if (dotInserted) minScore = Math.min(minScore, 0.7);
  // 採った数字のすぐ左に、数字と同じ高さの塊が残っている: 隣り合う桁どうしがつながって 1 つの塊になり
  // （ぼけた画像・縮小した画像で起きる）、数字として拾えなかった桁かもしれない。右側の桁だけを読んだ
  // 数値を、自信のある読みとしては扱わない（評価 2026-10-10: ぼかした画像で "96.5" の 9 と 6 が
  // つながり、5〔信頼度 0.82〕と読んだ）。
  const leftover = rawAll.some(
    (c) =>
      c.x + c.w <= firstX + 1 &&
      firstX - (c.x + c.w) <= LEFTOVER_MAX_GAP * gh &&
      c.h >= 0.6 * gh &&
      c.h <= 1.8 * gh &&
      c.w >= 0.3 * gh &&
      Math.min(c.y + c.h, digitBottom) - Math.max(c.y, digitBottom - gh) >= 0.6 * gh,
  );
  if (leftover) minScore = Math.min(minScore, STRUCT_DOUBT_CONF);
  const value = parseAmount(text);
  if (value === null) return { value: Number.NaN, conf: 0 };
  return { value, conf: Math.max(0, Math.min(1, minScore)) };
}

/**
 * スタックの末尾 2 背高成分が "B","B" か（＝BB 表示）を NCC で確認。SPEC §6.2 のモード判定。
 * digits＋letters（"B"）でマッチし、末尾 2 tall が両方 'B' なら true。chips は数字で終わるので false。
 * 実画像 hero 101/101 で chips/BB を完全分離（ピッチ判定より確実）。成分 3 未満は false。
 */
export function stackEndsWithBb(
  img: Rgba,
  rect: Rect,
  digitTemplates: readonly Template[],
  letterTemplates: readonly Template[],
  opts: WhiteMaskOptions = {},
): boolean {
  const minCh = opts.minCh ?? 120;
  const maxSat = opts.maxSat ?? 80;
  const strip = grayFromRgba(img, rect);
  const comps = glyphComponents(whiteMask(img, rect, { minCh, maxSat }));
  if (comps.length < 3) return false;
  const maxH = Math.max(...comps.map((c) => c.h));
  const tall = comps.filter((c) => c.h >= 0.45 * maxH);
  if (tall.length < 3) return false;
  const all = [...digitTemplates, ...letterTemplates];
  const last2 = tall.slice(-2);
  return last2.every((c) => bestMatch(normGlyph(strip, c), all).label === 'B');
}

/**
 * フレームの数値表示モードを判定（'bb' | 'chips'）。SPEC §6.2。
 * hero スタックが最もクリーンなので主判定に使い、読めなければ他の occupied 席を順に見る。
 * どの席も読めなければ chips（既定）にフォールバック。
 */
export function detectDisplayMode(
  img: Rgba,
  stackRects: readonly Rect[],
  digitTemplates: readonly Template[],
  letterTemplates: readonly Template[],
  opts: WhiteMaskOptions = {},
): DisplayMode {
  for (const rect of stackRects) {
    const comps = glyphComponents(whiteMask(img, rect, { minCh: opts.minCh ?? 120, maxSat: opts.maxSat ?? 80 }));
    if (comps.length < 3) continue; // 空席/読めない席は飛ばす
    return stackEndsWithBb(img, rect, digitTemplates, letterTemplates, opts) ? 'bb' : 'chips';
  }
  return 'chips';
}
