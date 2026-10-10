import { describe, it, expect } from 'vitest';
import type { ExtractTemplates, Rgba } from '@kagaribi/ocr';
import { ocrPrefillFromRgba, NOT_TABLE_ISSUE } from './prefill';

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
