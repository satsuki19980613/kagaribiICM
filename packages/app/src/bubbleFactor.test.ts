import type { BoardState, GameMode, Position } from '@kagaribi/core';
import { describe, expect, it } from 'vitest';
import { breakEvenEquity, bubbleFactorTable } from './bubbleFactor';

// ハンド開始時 UTG 27 / CO 1 / BU 3.1 / SB 6.9 / BB 14.6・アンティ 0.25（HRC 照合の局面）。
function spot(gameMode: GameMode): BoardState {
  const total: Record<string, number> = { UTG: 27, CO: 1, BU: 3.1, SB: 6.9, BB: 14.6 };
  const ante = 0.25;
  return {
    street: 'preflop',
    blinds: { sb: 0.5, bb: 1 },
    ante: { scheme: 'all', amount: ante },
    heroHand: '66',
    playersLeft: 5,
    heroPos: 'SB',
    seats: (['UTG', 'CO', 'BU', 'SB', 'BB'] as Position[]).map((pos) => {
      const bet = pos === 'SB' ? 0.5 : pos === 'BB' ? 1 : 0;
      return { pos, stack: total[pos]! - bet - ante, state: 'live' as const, bet };
    }),
    pot: 2.75,
    gameMode,
  } as BoardState;
}

describe('bubbleFactorTable', () => {
  it('ハンド開始時のスタックで全組み合わせを出す（クラブ）', () => {
    const t = bubbleFactorTable(spot('club'))!;
    expect(t.positions).toEqual(['UTG', 'CO', 'BU', 'SB', 'BB']);
    expect(t.stacks.map((s) => Math.round(s * 10) / 10)).toEqual([27, 1, 3.1, 6.9, 14.6]);
    const at = (a: number, b: number): number => t.bf[a]![b]!;
    expect(at(3, 4)).toBeCloseTo(2.87, 2); // SB → BB
    expect(at(4, 3)).toBeCloseTo(1.21, 2); // BB → SB
    expect(at(4, 0)).toBeCloseTo(3.53, 2); // BB → UTG
    expect(at(0, 1)).toBeCloseTo(1.01, 2); // UTG → CO
    expect(t.bf[2]![2]).toBeNull();
  });

  it('ゲームモードのペイアウトで変わる（レジェンド・ベース）', () => {
    const t = bubbleFactorTable(spot('legend-base'))!;
    expect(t.bf[4]![0]).toBeCloseTo(4.72, 2);
    expect(t.bf[3]![4]).toBeCloseTo(3.26, 2);
  });

  it('必要エクイティは BF/(1+BF)', () => {
    expect(breakEvenEquity(1)).toBe(0.5);
    expect(breakEvenEquity(2)).toBeCloseTo(2 / 3, 10);
  });
});
