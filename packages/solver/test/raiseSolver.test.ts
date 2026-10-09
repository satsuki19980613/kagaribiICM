import { describe, it, expect } from 'vitest';
import type { BoardState, Position } from '@kagaribi/core';
import { isCanonicalKey } from '@kagaribi/core';
import { solveRaiseGame } from '../src/raiseSolver.js';
import { solveMultiway } from '../src/nwaySolver.js';
import { loadHuWinTieTable } from '../src/huWinTieLoader.js';
import { loadWinTie3Table, winTie3ArtifactExists } from '../src/wintie3Loader.js';

const TIMEOUT = 180_000;

/** 画面表示のスタック（ブラインド・アンティを払った後）から局面を作る。アンティ 0.25 全員。 */
function spot(pos: Position[], stacks: number[], raiseTo?: number): BoardState {
  return {
    street: 'preflop',
    blinds: { sb: 0.5, bb: 1 },
    ante: { scheme: 'all', amount: 0.25 },
    heroHand: '66',
    playersLeft: pos.length,
    heroPos: pos[0]!,
    seats: pos.map((p, i) => ({ pos: p, stack: stacks[i]!, state: 'live' as const, bet: p === 'SB' ? 0.5 : p === 'BB' ? 1 : 0 })),
    gameMode: 'club',
    ...(raiseTo !== undefined ? { raiseTo } : {}),
  } as BoardState;
}

describe('solveRaiseGame', () => {
  const winTie = loadHuWinTieTable();

  it(
    'HU: 未開・レイズへのオールイン・2 回目・プッシュへのコールの 4 ノード',
    async () => {
      const r = await solveRaiseGame(spot(['SB', 'BB'], [9.5, 9], 2), { winTie });
      const byKey = new Map(r.nodes.map((n) => [n.key, n]));
      expect([...byKey.keys()].sort()).toEqual(['SB:-,BB:-', 'SB:P,BB:-', 'SB:R,BB:-', 'SB:R,BB:P']);
      for (const k of byKey.keys()) expect(isCanonicalKey(k)).toBe(true);
      const open = byKey.get('SB:-,BB:-')!;
      expect(open.actionType).toBe('PU');
      expect(open.raise).toBeDefined();
      expect(byKey.get('SB:R,BB:-')!.actionType).toBe('RS');
      const second = byKey.get('SB:R,BB:P')!;
      expect(second.actionType).toBe('RC');
      expect(second.actor).toBe('SB');
      // AA はどの判断でも降りない。
      expect(byKey.get('SB:R,BB:-')!.hands).toContain('AA');
      expect(second.hands).toContain('AA');
      expect(byKey.get('SB:P,BB:-')!.hands).toContain('AA');
      // 未開で AA はオールインかレイズのどちらか。
      expect(open.hands.includes('AA') || open.raise!.hands.includes('AA')).toBe(true);
      // ICM equity の合計は payout の合計（5+3）に保存される。
      const post = Object.values(r.equity).reduce((a, e) => a + e.post, 0);
      expect(post).toBeCloseTo(8, 6);
    },
    TIMEOUT,
  );

  it(
    'レイズできない（raiseTo ≤ BB）と AOF になり、nwaySolver とほぼ同じ解',
    async () => {
      if (!winTie3ArtifactExists()) return;
      const winTie3 = loadWinTie3Table();
      const st = spot(['CO', 'BU', 'SB', 'BB'], [12, 20, 8, 15]);
      const a = await solveRaiseGame({ ...st, raiseTo: 1 }, { winTie, winTie3, maxIters: 3000, targetExploitabilityPt: 0 });
      const b = await solveMultiway(st, {
        winTie, winTie3, workers: 0, maxIters: 3000, targetExploitabilityPt: 0, avgPower: 1, refreshSchedule: 'geometric',
      });
      const bm = new Map(b.nodes.map((n) => [n.key, n]));
      expect(a.nodes.length).toBe(b.nodes.length);
      for (const n of a.nodes) {
        const m = bm.get(n.key)!;
        expect(m).toBeDefined();
        expect(n.raise).toBeUndefined();
        // 4 人目のオールイン（打ち切り）は表示の扱いが違うので除く。
        if (n.actionType === 'OC' && n.key.split(',').filter((x) => /:[PC]$/.test(x)).length >= 3) continue;
        expect(Math.abs(n.pct - m.pct)).toBeLessThan(2.5);
      }
      expect(a.equity.CO!.post).toBeCloseTo(b.equity.CO!.post, 2);
    },
    TIMEOUT,
  );

  it(
    '4 人: レイズした人の 2 回目のノードがあり、キーは全席が埋まる',
    async () => {
      const r = await solveRaiseGame(spot(['CO', 'BU', 'SB', 'BB'], [12, 20, 8, 15], 2), { winTie, maxIters: 600 });
      const second = r.nodes.filter((n) => n.actionType === 'RC');
      expect(second.length).toBeGreaterThan(0);
      for (const n of second) {
        expect(n.key.includes(':-')).toBe(false);
        expect(n.key.split(',').find((x) => x.startsWith(`${n.actor}:`))).toBe(`${n.actor}:R`);
      }
      // レイズは最初に参加する人だけ（レイズの後のノードにレイズは無い）。
      for (const n of r.nodes) if (n.key.includes(':R')) expect(n.raise).toBeUndefined();
    },
    TIMEOUT,
  );
});
