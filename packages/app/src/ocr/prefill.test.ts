import { describe, it, expect } from 'vitest';
import type { ExtractTemplates, Rgba } from '@kagaribi/ocr';
import { ocrPrefillFromRgba, BLURRY_ISSUE, NOT_TABLE_ISSUE } from './prefill';

/** bestMatch は空テンプレで throw するので、各種 1 グリフだけ与える。 */
const glyph = (label: string) => ({ label, img: { w: 1, h: 1, data: Uint8Array.from([255]) } });
const templates: ExtractTemplates = {
  digits: [glyph('0')],
  ranks: [glyph('A')],
  actions: [glyph('レイズ')],
  letters: [glyph('B')],
};

/** 全ゼロ（黒一色）の Rgba。占有・数字・カードいずれも検出されない。 */
function blackRgba(w: number, h: number): Rgba {
  return { w, h, data: new Uint8Array(w * h * 4) };
}

describe('ocrPrefillFromRgba', () => {
  it('黒一色フレームは対象外として ok=false・issues を返す（例外を投げない）', () => {
    const res = ocrPrefillFromRgba(blackRgba(800, 370), templates);
    expect(res.ok).toBe(false);
    expect(Array.isArray(res.issues)).toBe(true);
    expect(res.issues.length).toBeGreaterThan(0);
    expect(res.form).toBeUndefined();
    expect(Array.isArray(res.lowConfidenceFields)).toBe(true);
  });

  it('結果は常に issues / lowConfidenceFields を配列で持つ（契約）', () => {
    const res = ocrPrefillFromRgba(blackRgba(400, 185), templates);
    expect(res).toHaveProperty('ok');
    expect(res.issues).toBeInstanceOf(Array);
    expect(res.lowConfidenceFields).toBeInstanceOf(Array);
  });

  it('何も読めないフレームは取り込み拒否＝ok=false・「卓の画面として読み取れません」（チップ表示とは区別する）', () => {
    // 黒一色はスタックもポットもハンドも読めない。BB 表示と判定できないので取り込まないが、
    // チップ表示の卓ではないので、チップ表示のメッセージは出さない。
    const res = ocrPrefillFromRgba(blackRgba(800, 370), templates);
    expect(res.ok).toBe(false);
    expect(res.issues).toContain(NOT_TABLE_ISSUE);
    expect(res.form).toBeUndefined();
  });

  it('強くぼけた画像は「画像がぼけていて読み取れません」で断る（卓ではない・チップ表示、とは区別する）', () => {
    // どの輪郭も 12 画素かけてなだらかに移る縞模様（＝強くぼけた画像の輪郭）。
    const w = 800, h = 370;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const p = x % 60;
        const v = 30 + 200 * (Math.min(1, p / 12) - Math.min(1, Math.max(0, (p - 30) / 12)));
        const s = (y * w + x) * 4;
        data[s] = v; data[s + 1] = v; data[s + 2] = v; data[s + 3] = 255;
      }
    const res = ocrPrefillFromRgba({ w, h, data }, templates);
    expect(res.ok).toBe(false);
    expect(res.issues).toEqual([BLURRY_ISSUE]);
    expect(res.issueCodes).toContain('image_blurry');
    expect(res.blurry).toBe(true);
    // 同じ縞でも、輪郭がくっきりしていれば「ぼけ」とは言わない。
    const crisp = Uint8Array.from(data);
    for (let i = 0; i < w * h; i++) { const v = crisp[i * 4]! >= 130 ? 230 : 30; crisp[i * 4] = v; crisp[i * 4 + 1] = v; crisp[i * 4 + 2] = v; }
    const res2 = ocrPrefillFromRgba({ w, h, data: crisp }, templates);
    expect(res2.issues).not.toContain(BLURRY_ISSUE);
    expect(res2.blurry).toBeUndefined();
  });

  it('棄却でも readout / issueCodes / imageSize を返す（照合ビューは失敗画像でも見せる・SPEC §5.2.3）', () => {
    const res = ocrPrefillFromRgba(blackRgba(800, 370), templates);
    expect(res.ok).toBe(false);
    expect(res.readout).toBeDefined();
    expect(res.readout!.issues).toContain(NOT_TABLE_ISSUE);
    expect(res.readout!.issueCodes).toContain('not_table_screen');
    expect(Array.isArray(res.readout!.seats)).toBe(true);
    expect(res.issueCodes).toEqual(res.readout!.issueCodes);
    expect(res.imageSize).toEqual({ w: 800, h: 370 });
  });
});
