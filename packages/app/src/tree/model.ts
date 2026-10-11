/**
 * Action tree の純ロジック層（M4）。
 *
 * ソルバー出力（`SolveResultDto.nodes` の平坦なノード集合）を、モック準拠の
 * 「全ポジション常時表示・行内トグル（FOLD / PU・CA・OC）」ツリーとして
 * 駆動するための純関数群。IndexedDB や DOM は持ち込まない（Node で単体テスト）。
 *
 * キーはソルバーと同一文法（`@kagaribi/core` の `normalizeKey`＝全席を行動順に
 * 並べ未行動を `-` で埋める。最初のオールイン=`P`、以降のオールイン=`C`、フォールド=`F`）。
 * 各行の active ノードはこのキーで `result.nodes` から引く＝表示とソルバー出力が常に整合する。
 */

import { normalizeKey, parseKey, positionsForPlayersLeft, type ActionChar } from '@kagaribi/core';
import type { SolveNodeDto, SolveResultDto } from '../solverProtocol';

/** アグレッシブ側の表示ラベル（内部コードは PU→'P' / CA・OC→'C'）。 */
export type AggrLabel = 'PU' | 'CA' | 'OC';

export interface RowOption {
  /** 状態に書き込むアクション文字。 */
  code: ActionChar; // 'F' | 'P' | 'C' | 'R'
  label: 'FOLD' | AggrLabel | 'RAISE';
  /** アグレッシブ（オールイン系）か。true=黄ロックオン表示。 */
  aggressive: boolean;
}

export interface TreeRow {
  pos: string;
  seatIdx: number;
  /** 決定なし（BB のウォーク＝上流に誰も push していない最終席）。 */
  walk: boolean;
  /** この席で選べる選択肢（walk 行は空）。 */
  options: RowOption[];
  /** 現在この席に割り当てられているアクション。 */
  current: ActionChar;
  /** ミニレイズ・ゲームでレイズした人の 2 回目（オールインを受けた）の行。seatIdx は残り人数。 */
  second?: boolean;
}

/** ツリーの操作状態＝各席のアクション（行動順, 長さ=残り人数）＋選択中の行。 */
export interface TreeState {
  actions: ActionChar[];
  /** 選択中の行。残り人数と同じ値ならレイズした人の 2 回目の行。 */
  active: number;
  /** レイズした人の 2 回目の行動（'F' / 'C'）。 */
  resp?: ActionChar;
}

/** 席順（行動順）。UTG…BB。 */
export function orderOf(result: SolveResultDto): string[] {
  return positionsForPlayersLeft(result.playersLeft);
}

/** key→ノードの索引。 */
export function nodeIndex(result: SolveResultDto): Map<string, SolveNodeDto> {
  return new Map(result.nodes.map((n) => [n.key, n]));
}

function priorHasPush(actions: ActionChar[], i: number): boolean {
  for (let k = 0; k < i; k++) if (actions[k] === 'P') return true;
  return false;
}
function priorCallCount(actions: ActionChar[], i: number): number {
  let c = 0;
  for (let k = 0; k < i; k++) if (actions[k] === 'C') c++;
  return c;
}

/** 席 i の（上流文脈から決まる）アグレッシブ選択肢。 */
export function aggressiveFor(actions: ActionChar[], i: number): { code: 'P' | 'C'; label: AggrLabel } {
  if (!priorHasPush(actions, i)) return { code: 'P', label: 'PU' };
  if (priorCallCount(actions, i) === 0) return { code: 'C', label: 'CA' };
  return { code: 'C', label: 'OC' };
}

/** 席 i より前にレイズした人（ミニレイズ・ゲーム）。いなければ -1。 */
function priorRaise(actions: ActionChar[], i: number): number {
  for (let k = 0; k < i; k++) if (actions[k] === 'R') return k;
  return -1;
}

/** 席 i がウォーク（決定でない）か＝最終席かつ上流に push もレイズも無し。 */
export function isWalk(order: string[], actions: ActionChar[], i: number): boolean {
  return i === order.length - 1 && !priorHasPush(actions, i) && priorRaise(actions, i) < 0;
}

/**
 * レイズした人の 2 回目の行が要るか（レイズの後にオールインが入っている）。要るならその人の席番号。
 */
export function secondRowFor(actions: ActionChar[]): number {
  const r = priorRaise(actions, actions.length);
  if (r < 0) return -1;
  for (let k = r + 1; k < actions.length; k++) if (actions[k] === 'P' || actions[k] === 'C') return r;
  return -1;
}

/** 席 active の決定ノードのキー（上流の P/C/F/R を埋め、actor と下流は '-'）。2 回目の行は全席が埋まる。 */
export function keyForActive(order: string[], actions: ActionChar[], active: number): string {
  const map: Partial<Record<string, ActionChar>> = {};
  const upTo = Math.min(active, order.length);
  for (let k = 0; k < upTo; k++) map[order[k]!] = actions[k]!;
  return normalizeKey(order.length, map);
}

/** active 行の対応ノード（ウォーク／未知キーなら null）。 */
export function activeNode(result: SolveResultDto, state: TreeState): SolveNodeDto | null {
  const order = orderOf(result);
  if (state.active < order.length && isWalk(order, state.actions, state.active)) return null;
  const key = keyForActive(order, state.actions, state.active);
  return nodeIndex(result).get(key) ?? null;
}

/**
 * 初期状態。hero の決定ノード（未開プッシュ＝上流全フォールド）を active にし、
 * hero の推奨（heroFreq≥0.5 で push）を反映。以降の席は未到達＝フォールド。
 */
export function defaultState(result: SolveResultDto): TreeState {
  const order = orderOf(result);
  const n = order.length;
  const heroIdx = Math.max(0, order.indexOf(result.heroPos));
  const actions: ActionChar[] = new Array<ActionChar>(n).fill('F');
  const idx0 = nodeIndex(result);
  // 局面のアクションが分かっている（ミニレイズ・ゲーム）なら、その決定ノードから始める。
  const known = result.heroKey ? idx0.get(result.heroKey) : undefined;
  if (known && result.heroKey) {
    const entries = parseKey(result.heroKey).entries;
    entries.forEach((e, k) => (actions[k] = e.action === '-' ? 'F' : e.action));
    const rec = known.heroFreq >= 0.5;
    if (entries[heroIdx]?.action === 'R') return { actions, active: n, resp: rec ? 'C' : 'F' };
    actions[heroIdx] = rec ? aggressiveFor(actions, heroIdx).code : 'F';
    return { actions, active: heroIdx, resp: 'F' };
  }
  // hero の見出しノード（未開プッシュ）で推奨が push なら hero 席を 'P'。
  const idx = nodeIndex(result);
  const headKey = keyForActive(order, actions, heroIdx);
  const head = idx.get(headKey);
  actions[heroIdx] = head && head.heroFreq >= 0.5 ? 'P' : 'F';
  return { actions, active: heroIdx };
}

/** 席 i にアクション code を割り当て（下流は F にリセット、active=i）。 */
export function applyChoice(state: TreeState, i: number, code: ActionChar): TreeState {
  if (i >= state.actions.length) return { ...state, resp: code, active: i };
  const actions = state.actions.slice();
  actions[i] = code;
  for (let k = i + 1; k < actions.length; k++) actions[k] = 'F';
  return { actions, active: i, resp: 'F' };
}

/** 表示用の行配列（全席）。 */
export function treeRows(result: SolveResultDto, state: TreeState): TreeRow[] {
  const order = orderOf(result);
  const idx = nodeIndex(result);
  const rows: TreeRow[] = order.map((pos, i) => {
    const walk = isWalk(order, state.actions, i);
    if (walk) return { pos, seatIdx: i, walk: true, options: [], current: state.actions[i]! };
    const aggr = aggressiveFor(state.actions, i);
    const options: RowOption[] = [{ code: 'F', label: 'FOLD', aggressive: false }];
    // ミニレイズ・ゲームの未開ノードはレイズも選べる。
    if (idx.get(keyForActive(order, state.actions, i))?.raise) options.push({ code: 'R', label: 'RAISE', aggressive: true });
    options.push({ code: aggr.code, label: aggr.label, aggressive: true });
    return { pos, seatIdx: i, walk: false, options, current: state.actions[i]! };
  });
  const r = secondRowFor(state.actions);
  if (r >= 0) {
    rows.push({
      pos: order[r]!,
      seatIdx: order.length,
      walk: false,
      second: true,
      options: [
        { code: 'F', label: 'FOLD', aggressive: false },
        { code: 'C', label: 'CA', aggressive: true },
      ],
      current: state.resp ?? 'F',
    });
  }
  return rows;
}
