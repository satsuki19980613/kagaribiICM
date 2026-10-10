import { describe, it, expect } from 'vitest';
import { solveMultiway } from '@kagaribi/solver';
import type { BoardState } from '@kagaribi/core';
import { buildBoardState, defaultForm } from '../formModel';
import type { SolveNodeDto, SolveResultDto } from '../solverProtocol';
import { headlineNode, heroNodeKey } from '../records/model';
import {
  activeNode,
  aggressiveFor,
  applyChoice,
  defaultState,
  isWalk,
  keyForActive,
  orderOf,
  treeRows,
  type TreeState,
} from './model';

/** 実ソルバー出力を DTO 化（worker の toDto と同型）。 */
async function solveDto(n: number, heroPos: string): Promise<{ state: BoardState; dto: SolveResultDto }> {
  const form = { ...defaultForm(n), heroPos: heroPos as never };
  const built = buildBoardState(form);
  if (!built.ok || !built.state) throw new Error(`build failed: ${built.issues.join(', ')}`);
  const state = built.state;
  // 決定的に（workers:0 の単一スレッド経路, 反復控えめ）。
  const r = (await solveMultiway(state, { workers: 0, maxIters: 200, samples: 4000 })) as unknown as {
    nodes: { key: string; actor: string; actionType: string; pct: number; range: string; hands: string[]; freq: Record<string, number>; ev: Record<string, number> }[];
    iterations: number;
    exploitabilityPt: number;
    converged: boolean;
    equity: Record<string, { pre: number; post: number }>;
  };
  const nodes: SolveNodeDto[] = r.nodes.map((nd) => ({
    key: nd.key,
    actor: nd.actor,
    actionType: nd.actionType,
    pct: nd.pct,
    range: nd.range,
    hands: nd.hands,
    heroFreq: nd.freq[state.heroHand] ?? 0,
    heroEv: nd.ev[state.heroHand] ?? 0,
  }));
  return {
    state,
    dto: {
      playersLeft: n,
      heroPos: state.heroPos,
      heroHand: state.heroHand,
      iterations: r.iterations,
      exploitabilityPt: r.exploitabilityPt,
      converged: r.converged,
      equity: r.equity,
      nodes,
    },
  };
}

/** 全ての到達可能状態を BFS で列挙（各行の各選択肢を再帰的に押す）。 */
function reachableActiveKeys(dto: SolveResultDto): Set<string> {
  const order = orderOf(dto);
  const seen = new Set<string>();
  const visited = new Set<string>();
  const walk = (st: TreeState): void => {
    const sig = st.actions.join('') + '@' + st.active;
    if (visited.has(sig)) return;
    visited.add(sig);
    if (!isWalk(order, st.actions, st.active)) seen.add(keyForActive(order, st.actions, st.active));
    // 各行のトグルを試す。
    const rows = treeRows(dto, st);
    for (const row of rows) {
      if (row.walk) continue;
      for (const opt of row.options) {
        walk(applyChoice(st, row.seatIdx, opt.code));
      }
    }
  };
  walk(defaultState(dto));
  return seen;
}

describe('Action tree モデル（実ソルバー出力と整合）', () => {
  it('3-way: 既定状態の active ノード = 見出しノード', async () => {
    const { dto } = await solveDto(3, 'BU');
    const node = activeNode(dto, defaultState(dto));
    expect(node).not.toBeNull();
    expect(node!.key).toBe(headlineNode(dto)!.key);
  }, 30_000);

  it('3-way: ツリーで到達できる active キーは全て実ノードに存在する', async () => {
    const { dto } = await solveDto(3, 'BU');
    const idx = new Set(dto.nodes.map((n) => n.key));
    for (const key of reachableActiveKeys(dto)) {
      expect(idx.has(key), `未知キー: ${key}`).toBe(true);
    }
  }, 30_000);

  it('3-way: 決定ノード（ウォーク以外）は全てツリーから到達できる', async () => {
    const { dto } = await solveDto(3, 'BU');
    const reachable = reachableActiveKeys(dto);
    for (const n of dto.nodes) {
      expect(reachable.has(n.key), `到達不能ノード: ${n.key} (${n.actor}/${n.actionType})`).toBe(true);
    }
  }, 30_000);

  it('4-way: 全決定ノードが双方向に整合（到達 ⇔ 実在）', async () => {
    const { dto } = await solveDto(4, 'CO');
    const idx = new Set(dto.nodes.map((n) => n.key));
    const reachable = reachableActiveKeys(dto);
    expect([...reachable].sort()).toEqual([...idx].sort());
  }, 60_000);

  it('aggressiveFor: 上流の文脈で PU→CA→OC を切り替える', () => {
    expect(aggressiveFor(['-', '-', '-'], 0)).toEqual({ code: 'P', label: 'PU' });
    expect(aggressiveFor(['P', '-', '-'], 1)).toEqual({ code: 'C', label: 'CA' });
    expect(aggressiveFor(['P', 'C', '-'], 2)).toEqual({ code: 'C', label: 'OC' });
    expect(aggressiveFor(['F', 'P', '-'], 2)).toEqual({ code: 'C', label: 'CA' });
  });
});

describe('ミニレイズ・ゲームのツリー', () => {
  const node = (key: string, actor: string, actionType: string, heroFreq: number, raise?: boolean): SolveNodeDto => ({
    key, actor, actionType, pct: 20, range: 'AA', hands: ['AA'], heroFreq, heroEv: 0,
    ...(raise ? { raise: { pct: 10, range: 'KK', hands: ['KK'], heroFreq: 0, heroEv: 0 } } : {}),
  });
  const result = (heroPos: string, heroKey: string): SolveResultDto => ({
    playersLeft: 2, heroPos, heroHand: 'AA', iterations: 1, exploitabilityPt: 0, converged: true, equity: {},
    raiseTo: 2, heroKey,
    nodes: [
      node('SB:-,BB:-', 'SB', 'PU', 0, true),
      node('SB:P,BB:-', 'BB', 'CA', 1),
      node('SB:R,BB:-', 'BB', 'RS', 1),
      node('SB:R,BB:P', 'SB', 'RC', 1),
    ],
  });

  it('hero のキーから始まり、未開の行にだけ RAISE が出る', () => {
    const r = result('BB', 'SB:R,BB:-');
    const st = defaultState(r);
    expect(st.actions).toEqual(['R', 'P']);
    expect(st.active).toBe(1);
    expect(activeNode(r, st)!.key).toBe('SB:R,BB:-');
    const rows = treeRows(r, st);
    expect(rows[0]!.options.map((o) => o.label)).toEqual(['FOLD', 'RAISE', 'PU']);
    expect(rows[1]!.options.map((o) => o.label)).toEqual(['FOLD', 'PU']);
    // BB がオールインしたのでレイズした SB の 2 回目の行が出る。
    expect(rows[2]!.second).toBe(true);
    expect(rows[2]!.pos).toBe('SB');
    const st2 = applyChoice(st, 2, 'C');
    expect(activeNode(r, st2)!.key).toBe('SB:R,BB:P');
  });

  it('hero がレイズした本人なら 2 回目の行から始まる', () => {
    const r = result('SB', 'SB:R,BB:P');
    const st = defaultState(r);
    expect(st.active).toBe(2);
    expect(st.resp).toBe('C');
    expect(activeNode(r, st)!.key).toBe('SB:R,BB:P');
    // BB をフォールドに戻すと 2 回目の行は消える。
    const st2 = applyChoice(st, 1, 'F');
    expect(treeRows(r, st2).some((x) => x.second)).toBe(false);
  });
});

describe('AOF で前の人がオールインしている場面', () => {
  const node = (key: string, actor: string, actionType: string, heroFreq: number): SolveNodeDto => ({
    key, actor, actionType, pct: 20, range: 'AA', hands: ['AA'], heroFreq, heroEv: 0.1,
  });
  const result: SolveResultDto = {
    playersLeft: 3, heroPos: 'SB', heroHand: 'AA', iterations: 1, exploitabilityPt: 0, converged: true, equity: {},
    heroKey: 'BU:P,SB:-,BB:-',
    nodes: [
      node('BU:-,SB:-,BB:-', 'BU', 'PU', 0),
      node('BU:F,SB:-,BB:-', 'SB', 'PU', 0),
      node('BU:P,SB:-,BB:-', 'SB', 'CA', 1),
      node('BU:P,SB:C,BB:-', 'BB', 'OC', 0),
    ],
  };

  it('見出しは「自分が最初に動く場合」ではなく、オールインに対するコールのノード', () => {
    const head = headlineNode(result)!;
    expect(head.key).toBe('BU:P,SB:-,BB:-');
    expect(head.actionType).toBe('CA');
  });

  it('ツリーは BU のオールインを選んだ状態で、hero の行から始まる', () => {
    const st = defaultState(result);
    expect(st.actions).toEqual(['P', 'C', 'F']);
    expect(st.active).toBe(1);
    expect(activeNode(result, st)!.key).toBe('BU:P,SB:-,BB:-');
    expect(treeRows(result, st).some((r) => r.second)).toBe(false);
  });
});

describe('実ソルバーの出力で、前の人のオールインに対するノードが見出しになる', () => {
  it('4 人・BU が CO のオールインを受けた場面（worker と同じ手順で heroKey を付ける）', async () => {
    const { state, dto } = await solveDto(4, 'BU');
    const spot: BoardState = { ...state, line: { CO: 'P' } };
    const key = heroNodeKey(spot)!;
    expect(key).toBe('CO:P,BU:-,SB:-,BB:-');
    // worker は、キーに当たるノードが hero のものなら heroKey を付ける。
    expect(dto.nodes.some((n) => n.key === key && n.actor === spot.heroPos)).toBe(true);
    const withKey: SolveResultDto = { ...dto, heroKey: key };
    const head = headlineNode(withKey)!;
    expect(head.actionType).toBe('CA');
    expect(head.key).toBe(key);
    // heroKey が無い従来の結果は、これまでどおり未開のノード。
    expect(headlineNode(dto)!.actionType).toBe('PU');
    const st = defaultState(withKey);
    expect(st.actions[0]).toBe('P');
    expect(st.active).toBe(1);
  }, 120_000);
});
