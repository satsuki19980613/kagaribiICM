import { describe, it, expect } from 'vitest';
import {
  isTableConsistentBlinds,
  ALL_CLUB_MATCH_LEVELS,
  CLUB_MATCH_LEVELS,
  CLUB_MATCH_LEVELS_SLOW,
  CLUB_MATCH_LEVELS_VERY_SLOW,
  CLUB_MATCH_TOTAL_CHIPS,
  snapByBb,
  resolveBlindChips,
  TABLE_BB_OPTIONS,
  blindsUnresolved,
  withUserBlinds,
  anteBbOf,
  totalBbFromBbChips,
} from './blindLevels.js';

describe('blindLevels', () => {
  it('公式「通常」表は 16 レベル・SB=BB/2・単調増加', () => {
    expect(CLUB_MATCH_LEVELS).toHaveLength(16);
    for (const lv of CLUB_MATCH_LEVELS) expect(lv.sb).toBe(lv.bb / 2);
    for (let i = 1; i < CLUB_MATCH_LEVELS.length; i++) {
      expect(CLUB_MATCH_LEVELS[i]!.bb).toBeGreaterThan(CLUB_MATCH_LEVELS[i - 1]!.bb);
    }
  });

  it('公式表レベル1（100/200/50）が存在', () => {
    const lv = CLUB_MATCH_LEVELS.find((l) => l.bb === 200);
    expect(lv).toBeDefined();
    expect(lv!.sb).toBe(100);
    expect(lv!.ante).toBe(50);
    expect(lv!.level).toBe(1);
  });

  it('snapByBb: タイト（2%）一致で公式レベルへ・小誤読を補正', () => {
    expect(snapByBb(200)!.level).toBe(1);
    expect(snapByBb(203)!.level).toBe(1); // 1.5% 内
    expect(snapByBb(3800)!.level).toBe(9);
  });

  it('snapByBb: どの公式表にも無い BB はスナップしない', () => {
    // 700 は 660(ゆっくり7)/740(もっとゆっくり14) から 5〜6% 離れる → null（誤スナップしない）。
    expect(snapByBb(700)).toBeNull();
    expect(snapByBb(NaN)).toBeNull();
    expect(snapByBb(0)).toBeNull();
    expect(snapByBb(123456789)).toBeNull();
  });

  it('snapByBb: 「ゆっくり」の 800/960 は表に載ったので正しく一致する', () => {
    // 以前は表が「通常」だけだったため 800 は 780 へ誤スナップ（→ gate 2% で回避）、
    // 960 は「表に無い別スピード」として読み値採用だった。構造表の登録でどちらも厳密一致する。
    const s800 = snapByBb(800)!;
    expect(s800.speed).toBe('slow');
    expect(s800.level).toBe(8);
    expect(s800.ante).toBe(200);
    const s960 = snapByBb(960)!;
    expect(s960.speed).toBe('slow');
    expect(s960.level).toBe(9);
    expect(s960.ante).toBe(240);
  });

  it('snapByBb: BB が同じで ante だけ違う組は読み取った ante で decide する', () => {
    // BB=300 は「ゆっくり」lv3(ante 75) と「もっとゆっくり」lv5(ante 70) の両方にある。
    expect(snapByBb(300, 0.02, 75)!.speed).toBe('slow');
    expect(snapByBb(300, 0.02, 70)!.speed).toBe('veryslow');
    // BB=13000 は「通常」lv12(ante 3200) と「もっとゆっくり」lv43(ante 3300)。
    expect(snapByBb(13000, 0.02, 3200)!.speed).toBe('normal');
    expect(snapByBb(13000, 0.02, 3300)!.speed).toBe('veryslow');
  });

  it('公式表3種は SB=BB/2・単調増加・ante は 0.2〜0.3×BB', () => {
    expect(CLUB_MATCH_LEVELS_SLOW).toHaveLength(32);
    expect(CLUB_MATCH_LEVELS_VERY_SLOW).toHaveLength(59);
    for (const t of [CLUB_MATCH_LEVELS, CLUB_MATCH_LEVELS_SLOW, CLUB_MATCH_LEVELS_VERY_SLOW]) {
      let prev = 0;
      for (const lv of t) {
        expect(lv.sb).toBe(lv.bb / 2);
        expect(lv.bb).toBeGreaterThan(prev);
        expect(lv.ante / lv.bb).toBeGreaterThanOrEqual(0.2);
        expect(lv.ante / lv.bb).toBeLessThanOrEqual(0.3);
        prev = lv.bb;
      }
    }
    // 3 表とも最終レベルは 60000/30000/15000（構造表の実測）。
    for (const t of [CLUB_MATCH_LEVELS, CLUB_MATCH_LEVELS_SLOW, CLUB_MATCH_LEVELS_VERY_SLOW]) {
      const last = t[t.length - 1]!;
      expect([last.bb, last.sb, last.ante]).toEqual([60000, 30000, 15000]);
    }
    expect(ALL_CLUB_MATCH_LEVELS).toHaveLength(16 + 32 + 59);
  });

  it('resolveBlindChips: 公式「通常」はタイト一致で厳密値（142308＝レベル1）', () => {
    const r = resolveBlindChips(100, 200, 50)!;
    expect(r.level).toBe(1);
    expect(r.bb).toBe(200);
    expect(r.sb).toBe(100);
    expect(r.ante).toBe(50);
  });

  it('resolveBlindChips: 480/960/240 は「ゆっくり」lv9 として厳密一致する', () => {
    const r = resolveBlindChips(480, 960, 240)!;
    expect(r.speed).toBe('slow');
    expect(r.level).toBe(9);
    expect(r.bb).toBe(960);
    expect(r.sb).toBe(480);
    expect(r.ante).toBe(240);
    // 保存則: 総 BB = 90000/960 = 93.75。
    expect(totalBbFromBbChips(r.bb)).toBeCloseTo(93.75, 6);
  });

  it('resolveBlindChips: どの表にも無い構造は読み値採用・level=0・SB=BB/2', () => {
    const r = resolveBlindChips(350, 700, 175)!;
    expect(r.level).toBe(0);
    expect(r.speed).toBeUndefined();
    expect(r.bb).toBe(700);
    expect(r.sb).toBe(350);
    expect(r.ante).toBe(175);
  });

  it('resolveBlindChips: BB 誤読は SB×2 で救済／アンティ外れは 0.25×BB 近似', () => {
    // BB 欠測 → SB 480×2=960（別スピード扱い）。
    const r1 = resolveBlindChips(480, NaN, 240)!;
    expect(r1.bb).toBe(960);
    expect(r1.sb).toBe(480);
    // アンティが妥当域外（大きすぎ）→ 0.25×BB 近似。
    const r2 = resolveBlindChips(480, 960, 900)!;
    expect(r2.ante).toBe(240);
  });

  it('resolveBlindChips: BB も SB も読めなければ null（チェック無効）', () => {
    expect(resolveBlindChips(NaN, NaN, NaN)).toBeNull();
    expect(resolveBlindChips(0, 0, 0)).toBeNull();
  });

  it('isTableConsistentBlinds: 表のレベルに載り SB がちょうど半分の読みだけ通す', () => {
    expect(isTableConsistentBlinds(280, 560)).toBe(true); // 通常 lv4（実機 Pixel の本当の値）
    expect(isTableConsistentBlinds(330, 660)).toBe(true);
    // 読み位置がずれた実測の誤読（Pixel の従来位置: "3/88280/54"）。
    expect(isTableConsistentBlinds(3, 8828054)).toBe(false);
    // 数字の頭が切れた／「BB」の文字を巻き込んだ読みは SB が半分にならない。
    expect(isTableConsistentBlinds(80, 560)).toBe(false);
    expect(isTableConsistentBlinds(8280, 560)).toBe(false);
    // 両方の末尾が切れた読み（56 は表に無い）。
    expect(isTableConsistentBlinds(28, 56)).toBe(false);
    expect(isTableConsistentBlinds(NaN, 560)).toBe(false);
  });

  it('resolveBlindChips: 総チップ 90,000 を超える BB はヘッダ誤読として null（実機 Pixel フレーム）', () => {
    // 装飾テーマ卓でヘッダの 280/560 が SB 3 / BB 8,828,054 と読まれた実測値。BB を採用すると総 BB の
    // 理論値が 0.01 BB、SB×2 で救済すると BB 6 → 15,000 BB になり、どちらも誤って棄却される。
    expect(resolveBlindChips(3, 8828054, NaN)).toBeNull();
    // BB が壊れているときは、SB だけがもっともらしく見えても救済しない（同じヘッダの誤読）。
    expect(resolveBlindChips(280, 8828054, NaN)).toBeNull();
    // ただし SB とアンティが揃って同じレベルを指すなら、そのレベルと判断する（さつき提案 2026-10-08）。
    expect(resolveBlindChips(280, 8828054, 140)).toMatchObject({ sb: 280, bb: 560, ante: 140 });
    // BB が**読めなかった**ときの SB×2 救済は従来どおり。
    expect(resolveBlindChips(280, NaN, 140)!.bb).toBe(560);
    // 公式表の最大 BB（60,000）は落とさない。
    expect(resolveBlindChips(30000, 60000, 15000)).not.toBeNull();
  });

  it('resolveBlindChips: 最初のレベル（BB 200）より小さい BB もヘッダ誤読として null', () => {
    // ピンク系の卓でヘッダの 820/1640 が SB 6020 / BB 16 と読まれた実測値。総 BB の理論値が 5,625 BB に
    // なり「クラブマッチではない」と誤って棄却していた。
    expect(resolveBlindChips(6020, 16, 4)).toBeNull();
    // SB の読み 1 つが表に偶然一致しても（6020 ≒ SB 6000）、アンティが合わなければ決めない。
    expect(resolveBlindChips(6020, 16, NaN)).toBeNull();
    // BB が表に無くても、SB とアンティが揃えばそのレベル（1640 を 1840 と読み違えた想定）。
    expect(resolveBlindChips(820, 1840, 410)).toMatchObject({ sb: 820, bb: 1640, ante: 410 });
    // 公式表の最小 BB（200）は落とさない。
    expect(resolveBlindChips(100, 200, 50)).not.toBeNull();
  });

  it('anteBbOf: 各レベルのアンティは概ね 0.25×BB', () => {
    for (const lv of CLUB_MATCH_LEVELS) {
      expect(anteBbOf(lv)).toBeGreaterThan(0.24);
      expect(anteBbOf(lv)).toBeLessThan(0.27);
    }
  });

  it('totalBbFromBbChips: 90000/200 = 450・90000/960 = 93.75', () => {
    expect(CLUB_MATCH_TOTAL_CHIPS).toBe(90000);
    expect(totalBbFromBbChips(200)).toBeCloseTo(450, 6);
    expect(totalBbFromBbChips(960)).toBeCloseTo(93.75, 6);
  });
});

describe('ヘッダが読めないときの BB 選択（さつき決定 2026-10-08）', () => {
  const base = {
    street: { value: 'preflop' as const, conf: 0.8 },
    blinds: { sb: { value: 0.5, conf: 0.8 }, bb: { value: 1, conf: 0.8 } },
    ante: { scheme: 'all' as const, amount: { value: 0.25, conf: 0.6 } },
    pot: { value: 2.8, conf: 0.8 },
    heroHand: { value: '66', conf: 0.8 },
    seats: [],
    displayMode: 'bb' as const,
  };

  it('選択肢は 3 構造の BB を重複なく昇順に並べる', () => {
    expect(TABLE_BB_OPTIONS[0]).toBe(200);
    expect(TABLE_BB_OPTIONS.at(-1)).toBe(60000);
    expect(TABLE_BB_OPTIONS).toContain(1640);
    expect(new Set(TABLE_BB_OPTIONS).size).toBe(TABLE_BB_OPTIONS.length);
    expect([...TABLE_BB_OPTIONS].sort((a, b) => a - b)).toEqual(TABLE_BB_OPTIONS);
  });

  it('blindChips が無い・表に無い（level 0）ときだけ未解決', () => {
    expect(blindsUnresolved(base)).toBe(true);
    expect(blindsUnresolved({ ...base, blindChips: { sb: 450, bb: 900, ante: 225, level: 0 } })).toBe(true);
    expect(blindsUnresolved({ ...base, blindChips: { sb: 820, bb: 1640, ante: 410, level: 7 } })).toBe(false);
    expect(blindsUnresolved({ ...base, displayMode: 'chips' })).toBe(false);
  });

  it('選んだ BB を表のレベルとして載せる（同じ BB の別構造は読んだアンティで選ぶ）', () => {
    expect(withUserBlinds(base, 1640).blindChips).toMatchObject({ sb: 820, bb: 1640, ante: 410 });
    expect(blindsUnresolved(withUserBlinds(base, 1640))).toBe(false);
    // BB 300: ゆっくり 75 / もっとゆっくり 70。アンティ 0.25 BB（=75）に近い方。
    expect(withUserBlinds(base, 300).blindChips?.ante).toBe(75);
    // 表に無い BB は変えない。
    expect(withUserBlinds(base, 1234)).toBe(base);
  });
});
