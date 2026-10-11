import { describe, it, expect } from 'vitest';
import { runOcrPipeline } from './pipeline.js';
import { reconstructSpot } from './spotReconstruction.js';
import type { RawReads, RawSeatRead, Occupancy, SeatAction, AnteScheme } from './types.js';

interface SeatSpec {
  id: string;
  hero?: boolean;
  button?: boolean;
  occupancy?: Occupancy;
  action?: SeatAction;
  stack: number;
  bet: number;
  conf?: number;
}

function seat(s: SeatSpec): RawSeatRead {
  const c = s.conf ?? 1;
  return {
    id: s.id,
    isHero: s.hero ?? false,
    isButton: s.button ?? false,
    occupancy: { value: s.occupancy ?? 'occupied', conf: c },
    action: { value: s.action ?? 'none', conf: c },
    stack: { value: s.stack, conf: c },
    bet: { value: s.bet, conf: c },
  };
}

function mkReads(o: {
  street?: string;
  sb?: number;
  bb?: number;
  ante?: { scheme: AnteScheme; amount: number };
  pot: number;
  hand?: string;
  handConf?: number;
  seats: SeatSpec[];
}): RawReads {
  const ante = o.ante ?? { scheme: 'none' as AnteScheme, amount: 0 };
  return {
    street: { value: o.street ?? 'プリフロップ', conf: 1 },
    blinds: { sb: { value: o.sb ?? 0.5, conf: 1 }, bb: { value: o.bb ?? 1, conf: 1 } },
    ante: { scheme: ante.scheme, amount: { value: ante.amount, conf: 1 } },
    pot: { value: o.pot, conf: 1 },
    heroHand: { value: o.hand ?? 'A5s', conf: o.handConf ?? 1 },
    seats: o.seats.map(seat),
  };
}

describe('pipeline — 正常系（root spot 復元）', () => {
  it('5人・全席フレッシュ（hero UTG）', () => {
    // clockwiseFromButton(5) = [BU, SB, BB, UTG, CO]
    const r = runOcrPipeline(
      mkReads({
        pot: 1.5,
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', hero: true, stack: 15, bet: 0 },
          { id: 'CO', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const st = r.state!;
    expect(st.playersLeft).toBe(5);
    expect(st.heroPos).toBe('UTG');
    // root: 全席 live、SB/BB のみ bet、各 full behind 15
    const byPos = Object.fromEntries(st.seats.map((s) => [s.pos, s]));
    expect(byPos['SB']!.bet).toBe(0.5);
    expect(byPos['SB']!.stack).toBeCloseTo(14.5);
    expect(byPos['BB']!.bet).toBe(1);
    expect(byPos['BB']!.stack).toBeCloseTo(14);
    expect(byPos['UTG']!.bet).toBe(0);
    expect(byPos['UTG']!.stack).toBe(15);
    expect(st.seats.every((s) => s.state === 'live')).toBe(true);
    expect(r.checksum!.ok).toBe(true);
  });

  it('シューブ＋フォールドが混在しても root に戻る（valid）', () => {
    // UTG フォールド、CO オールイン15、hero BU が直面
    const r = runOcrPipeline(
      mkReads({
        pot: 16.5,
        seats: [
          { id: 'BU', hero: true, button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', action: 'fold', stack: 15, bet: 0 },
          { id: 'CO', action: 'allin', stack: 0, bet: 15 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const st = r.state!;
    expect(st.playersLeft).toBe(5);
    expect(st.heroPos).toBe('BU');
    const byPos = Object.fromEntries(st.seats.map((s) => [s.pos, s]));
    // シューブ CO は root で full 15 behind, bet 0, live
    expect(byPos['CO']!.stack).toBe(15);
    expect(byPos['CO']!.bet).toBe(0);
    expect(byPos['CO']!.state).toBe('live');
    // フォールド UTG も root で live・full behind
    expect(byPos['UTG']!.stack).toBe(15);
    expect(byPos['UTG']!.state).toBe('live');
    expect(r.checksum!.ok).toBe(true);
  });

  it('empty 席は playersLeft から除外される', () => {
    // 6 物理席中 2 empty → 4人
    const r = runOcrPipeline(
      mkReads({
        pot: 1.5,
        seats: [
          { id: 's0', button: true, stack: 20, bet: 0 },
          { id: 's1', occupancy: 'empty', stack: 0, bet: 0 },
          { id: 's2', stack: 19.5, bet: 0.5 },
          { id: 's3', stack: 19, bet: 1 },
          { id: 's4', hero: true, stack: 20, bet: 0 },
          { id: 's5', occupancy: 'empty', stack: 0, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.state!.playersLeft).toBe(4);
    expect(r.state!.seats).toHaveLength(4);
  });

  it('ante all を含む root（solver 入力に ante を素通し）', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 2.0, // 0.5+1 + 0.1*5
        ante: { scheme: 'all', amount: 0.1 },
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', hero: true, stack: 15, bet: 0 },
          { id: 'CO', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.state!.ante).toEqual({ scheme: 'all', amount: 0.1 });
    expect(r.checksum!.ok).toBe(true);
  });
});

describe('pipeline — 対象外検出（§6.5）', () => {
  it('リンプ（非ブラインド席が BB をコール）を弾く', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 3.5,
        seats: [
          { id: 'BU', button: true, action: 'call', stack: 14, bet: 1 }, // リンプ
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', hero: true, stack: 15, bet: 0 },
          { id: 'CO', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/リンプ|レイズ|3bet/);
  });

  it('ミニレイズ（SB が非オールインで増額）を弾く', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 4,
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', action: 'raise', stack: 13, bet: 2.5 }, // レイズ
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', hero: true, stack: 15, bet: 0 },
          { id: 'CO', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/レイズ|3bet|リンプ/);
  });

  it('前の人がオールインしている AOF の場面は、hero までのアクションを line に載せる', () => {
    // clockwiseFromButton(5) = [BU, SB, BB, UTG, CO]。UTG フォールド、CO オールイン、hero BU。
    const r = runOcrPipeline(
      mkReads({
        pot: 16.5,
        seats: [
          { id: 'BU', button: true, hero: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', action: 'fold', stack: 15, bet: 0 },
          { id: 'CO', action: 'allin', stack: 0, bet: 15 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.state!.raiseTo).toBeUndefined();
    expect(r.state!.line).toEqual({ UTG: 'F', CO: 'P' });
  });

  it('誰も参加していない場面には line を付けない（従来どおり）', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 1.5,
        seats: [
          { id: 'BU', button: true, hero: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', action: 'fold', stack: 15, bet: 0 },
          { id: 'CO', action: 'fold', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.state!.line).toBeUndefined();
  });

  it('最初の人のミニレイズはミニレイズ・ゲームとして通す（line・raiseTo を載せる）', () => {
    // clockwiseFromButton(5) = [BU, SB, BB, UTG, CO]。UTG が 2bb にレイズ、hero CO。
    const r = runOcrPipeline(
      mkReads({
        pot: 3.5,
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', action: 'raise', stack: 13, bet: 2 },
          { id: 'CO', hero: true, stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.state!.raiseTo).toBe(2);
    expect(r.state!.line).toEqual({ UTG: 'R' });
    const utg = r.state!.seats.find((x) => x.pos === 'UTG')!;
    expect(utg.stack).toBeCloseTo(15); // 2bb を戻した持ち込み
  });

  it('レイズした本人がオールインを受けた場面は全員のアクションを line に載せる', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 18.5,
        seats: [
          { id: 'BU', button: true, action: 'fold', stack: 15, bet: 0 },
          { id: 'SB', action: 'fold', stack: 14.5, bet: 0 },
          { id: 'BB', action: 'allin', stack: 0, bet: 15 },
          { id: 'UTG', hero: true, action: 'raise', stack: 13, bet: 2 },
          { id: 'CO', action: 'fold', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.state!.line).toEqual({ UTG: 'R', CO: 'F', BU: 'F', SB: 'F', BB: 'P' });
  });

  it('レイズへのフラットコールと 3bet は弾く', () => {
    const flat = runOcrPipeline(
      mkReads({
        pot: 5.5,
        seats: [
          { id: 'BU', button: true, hero: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', action: 'raise', stack: 13, bet: 2 },
          { id: 'CO', action: 'call', stack: 13, bet: 2 },
        ],
      }),
    );
    expect(flat.ok).toBe(false);
    expect(flat.issues.join()).toMatch(/コール/);
    const big = runOcrPipeline(
      mkReads({
        pot: 5.5,
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', action: 'raise', stack: 11, bet: 4 },
          { id: 'CO', hero: true, stack: 15, bet: 0 },
        ],
      }),
    );
    expect(big.ok).toBe(false);
    expect(big.issues.join()).toMatch(/3bb までのレイズ/);
  });

  it('ウォーク（hero BB・全員フォールド）を no decision として弾く', () => {
    // 3人: clockwiseFromButton(3)=[BU,SB,BB]。BU/SB フォールド、hero BB
    const r = runOcrPipeline(
      mkReads({
        pot: 1.5,
        seats: [
          { id: 'BU', button: true, action: 'fold', stack: 15, bet: 0 },
          { id: 'SB', action: 'fold', stack: 14.5, bet: 0 },
          { id: 'BB', hero: true, stack: 14, bet: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/ウォーク|判断が存在しない/);
  });

  it('hero BB でもオールインに直面していれば通す', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 16.5,
        seats: [
          { id: 'BU', button: true, action: 'allin', stack: 0, bet: 15 },
          { id: 'SB', action: 'fold', stack: 14.5, bet: 0 },
          { id: 'BB', hero: true, stack: 14, bet: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.state!.heroPos).toBe('BB');
  });

  it('オールインを「コール」した席（カバー）は push/fold 有効（ラベル駆動の要）', () => {
    // 4人: CO オールイン10、BB がカバーしてコール（stack 残あり）、hero BU 直面
    // clockwiseFromButton(4) = [BU, SB, BB, CO]
    const r = runOcrPipeline(
      mkReads({
        pot: 21.5,
        seats: [
          { id: 'BU', hero: true, button: true, stack: 20, bet: 0 },
          { id: 'SB', action: 'fold', stack: 19.5, bet: 0 },
          { id: 'BB', action: 'call', stack: 10, bet: 10 }, // カバーしてコール（非オールイン）
          { id: 'CO', action: 'allin', stack: 0, bet: 10 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const byPos = Object.fromEntries(r.state!.seats.map((s) => [s.pos, s]));
    // BB は root で full behind 20（10 stack + 10 コール）→ blind 1 は rootBet 側、stack は 19
    expect(byPos['BB']!.stack).toBe(19);
    expect(byPos['BB']!.bet).toBe(1);
    expect(byPos['BB']!.stack + byPos['BB']!.bet).toBe(20);
    expect(byPos['CO']!.stack).toBe(10);
  });
});

describe('pipeline — gate（§6.3 #8）', () => {
  it('フロップ画面を弾く', () => {
    const r = runOcrPipeline(
      mkReads({
        street: 'フロップ',
        pot: 1.5,
        seats: [
          { id: 'SB', button: true, hero: true, stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/プリフロップ|flop/i);
  });

  it('英語表記 preflop も通す', () => {
    const r = runOcrPipeline(
      mkReads({
        street: 'Pre-Flop',
        pot: 1.5,
        seats: [
          { id: 'SB', button: true, hero: true, stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
  });
});

describe('pipeline — 信頼度・チェックサム（§6.3 / Plan 2-8）', () => {
  it('低信頼のスタックが Position keyed で強調される', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 1.5,
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', hero: true, stack: 15, bet: 0, conf: 0.4 }, // 低信頼
          { id: 'CO', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.lowConfidenceFields).toContain('UTG.stack');
    // UTG は行動マークが無い（未行動）ので、ベットは席順から決まるブラインド額（0）で確定して
    // いる。チップの読みが怪しくても要確認にはしない（さつき指摘 2026-09-11・confidence.ts）。
    expect(r.lowConfidenceFields).not.toContain('UTG.bet');
  });

  it('ポット・チェックサム不一致で pot と各 bet が強調される', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 99, // 明らかに不一致
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', hero: true, stack: 15, bet: 0 },
          { id: 'CO', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.checksum!.ok).toBe(false);
    expect(r.lowConfidenceFields).toContain('pot');
    expect(r.lowConfidenceFields).toContain('SB.bet');
  });

  it('低信頼の手札が強調される', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 1.5,
        handConf: 0.3,
        seats: [
          { id: 'SB', button: true, hero: true, stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
        ],
      }),
    );
    expect(r.lowConfidenceFields).toContain('heroHand');
  });
});

describe('reconstructSpot — 直接', () => {
  it('ボタン検出漏れは issues を返す', () => {
    const recon = reconstructSpot(
      mkReads({
        pot: 1.5,
        seats: [
          { id: 'SB', hero: true, stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
        ],
      }),
    );
    expect(recon.ok).toBe(false);
    expect(recon.issues.join()).toMatch(/ボタン/);
  });
});

describe('pipeline — 同じ生読み値をゲームモードだけ変えて通し直す（確認画面の切り替え・2026-09-12 レビュー）', () => {
  /** 5 人・CO のスタックだけ未読（NaN）・BB 800 チップ（アンティ無し）。 */
  const readsWithUnreadCo = (): RawReads => ({
    ...mkReads({
      pot: 1.5,
      seats: [
        { id: 'BU', button: true, stack: 30, bet: 0 },
        { id: 'SB', stack: 24.5, bet: 0.5 },
        { id: 'BB', stack: 19, bet: 1 },
        { id: 'UTG', hero: true, stack: 20, bet: 0 },
        { id: 'CO', stack: NaN, bet: 0 },
      ],
    }),
    displayMode: 'bb',
    blindChips: { sb: 400, bb: 800, ante: 0, level: 5 },
  });
  const coStack = (r: ReturnType<typeof runOcrPipeline>): number | undefined =>
    r.state?.seats.find((s) => s.pos === 'CO')?.stack;

  it('復元値は選んだモードの総チップに追従する（club 112.5bb / legend 150bb）', () => {
    const club = runOcrPipeline(readsWithUnreadCo(), { gameMode: 'club' });
    const legend = runOcrPipeline(readsWithUnreadCo(), { gameMode: 'legend-avg' });
    expect(club.ok).toBe(true);
    expect(legend.ok).toBe(true);
    expect(club.state?.gameMode).toBe('club');
    expect(legend.state?.gameMode).toBe('legend-avg');
    // 読めた席 93.5 + デッドポット 1.5 = 95 → club 112.5−95 = 17.5 / legend 150−95 = 55
    expect(coStack(club)).toBe(17.5);
    expect(coStack(legend)).toBe(55);
    expect(club.chipCheck?.modeDependentRecovery).toBe(true);
    expect(legend.chipCheck?.modeDependentRecovery).toBe(true);
    expect(club.unresolvedStacks).toEqual([]);
  });

  it('総チップが小さいモード（rank-3: 75bb）では復元できず、未読席＋取り違えの疑いを返す', () => {
    const r = runOcrPipeline(readsWithUnreadCo(), { gameMode: 'rank-3' });
    expect(r.ok).toBe(true);
    expect(r.unresolvedStacks).toEqual(['CO']);
    expect(r.chipCheck?.mode).toBe('multi-unreadable-skip');
    expect(r.chipCheck?.modeMismatch).toBe(true);
    expect(r.chipCheck?.modeDependentRecovery).toBeUndefined();
  });
});

describe('pipeline — 自分のハンドだけ読めなかった（さつき報告 2026-10-08）', () => {
  it('計算はできないが、ハンド以外を復元した盤面を返して手入力に回す', () => {
    const r = runOcrPipeline(
      mkReads({
        pot: 1.5,
        hand: '',
        seats: [
          { id: 'BU', button: true, stack: 15, bet: 0 },
          { id: 'SB', stack: 14.5, bet: 0.5 },
          { id: 'BB', stack: 14, bet: 1 },
          { id: 'UTG', hero: true, stack: 15, bet: 0 },
          { id: 'CO', stack: 15, bet: 0 },
        ],
      }),
    );
    expect(r.ok).toBe(false);
    // zod の英語メッセージ（heroHand: invalid hand-class notation）ではなく、次にすることを伝える。
    expect(r.issues.join()).toMatch(/自分のハンドを読み取れませんでした/);
    expect(r.readout.issueCodes).toContain('hero_hand_unreadable');
    expect(r.partialState?.heroPos).toBe('UTG');
    expect(r.partialState?.playersLeft).toBe(5);
  });
  it('読めたように見えても信頼度がごく低いハンドは、読めなかった扱いにする（誤ったハンドで計算しない）', () => {
    const base = mkReads({
      pot: 1.5,
      hand: '86s',
      seats: [
        { id: 'BU', button: true, stack: 15, bet: 0 },
        { id: 'SB', stack: 14.5, bet: 0.5 },
        { id: 'BB', stack: 14, bet: 1 },
        { id: 'UTG', hero: true, stack: 15, bet: 0 },
        { id: 'CO', stack: 15, bet: 0 },
      ],
    });
    const r = runOcrPipeline({ ...base, heroHand: { value: '86s', conf: 0.06 } });
    expect(r.ok).toBe(false);
    expect(r.readout.issueCodes).toContain('hero_hand_unreadable');
    expect(r.partialState?.heroPos).toBe('UTG');
    // 信頼度が普通なら、同じ読みはそのまま通る。
    expect(runOcrPipeline({ ...base, heroHand: { value: '86s', conf: 0.8 } }).ok).toBe(true);
  });
});
