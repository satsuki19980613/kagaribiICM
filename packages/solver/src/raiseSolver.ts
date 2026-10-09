/**
 * ミニレイズ・ゲームのプリフロップ求解（さつき決定 2026-10-09 の B 案）。
 *
 * ## ゲームの定義
 * AOF（オールインかフォールドだけ）に「最初に参加する人だけのレイズ」を足したもの。
 *   - 未開（誰も参加していない）の席: FOLD / ALL IN / RAISE（`raiseTo` BB まで, 非オールイン）
 *   - それ以外の席: FOLD / ALL IN（オールインへはコール＝全額を賭ける）
 *   - レイズした人は 1 周したあと、オールインが入っていればコールかフォールド（2 回目の判断）
 * フラットコール（レイズへの非オールインのコール）は無い。したがってどの終局もオールインの
 * ショーダウンか不戦勝で、**フロップ以降の判断が残らない**（全員が全額を賭けるので、チップが
 * 残るのは最大スタックの 1 人だけ）。
 *
 * ## 解き方
 * nwaySolver と同じ「ショーダウン equity の先取り見積り + fictitious play（FP）」。ただし
 * レイズした人が 2 回判断するため、nwaySolver の (席, 前方オールイン集合) という平坦な
 * ノード表ではなく、行動履歴の木をそのまま作って下から値を伝える:
 *   - 終局（ショーダウン/不戦勝）: 参加者はクラス別 ICM 値（showdownExact / MC）、それ以外の席は
 *     周辺 ICM 値（定数）。refresh のたびに参加者の到達レンジから見積り直す。
 *   - 決定ノード: 手番以外の席は相手の行動を「レンジ比」の確率で混ぜる（card-blind, nwaySolver と
 *     同じ近似）。レイズした人の 2 回目のノードでは、その人の値はクラスごとの最善（コール/フォールドの
 *     大きい方）＝レイズの EV は「オールインされたら同じハンドで最善に応じる」前提で評価する。
 * 2 回目のノードで相手から見たコール確率は、レイズレンジの中でのコール割合（条件付き）。
 *
 * 同時オールインは既定 3 人まで（nwaySolver の maxActive と同じゲーム定義）。3 人がオールインした後の
 * 席と、その状態で 2 回目を迎えたレイズした人は自動でフォールド。
 */

import type { ActionChar, BoardState, Position } from '@kagaribi/core';
import { comboCount, formatRange, normalizeKey, parseHandClass, positionsForPlayersLeft } from '@kagaribi/core';
import { icmEquities, payoutsForPlayers } from './icm.js';
import { finalStacksFromShowdown } from './sidepot.js';
import { HAND_CLASS_ORDER } from './huEquity.js';
import type { ShowdownNode } from './showdownMc.js';
import { MC_SEED } from './mcConfig.js';
import { monotonizePush } from './monotonize.js';
import { computeShowdownMc, type ShowdownMcResult, type StratSpec } from './showdownJob.js';
import {
  computeShowdown2Exact,
  computeShowdown3Exact,
  exact3LookupCost,
  EPS_ARRIVAL,
  type WinTieTable,
  type Exact3DenseChunk,
} from './showdownExact.js';
import type { WinTie3Table } from './wintie3Table.js';
import type { McRunner, ShowdownMcJob } from './nwaySolver.js';

type F64 = Float64Array;
const NC = HAND_CLASS_ORDER.length; // 169
const TOTAL_COMBOS = 1326;
const COMBO: number[] = HAND_CLASS_ORDER.map((l) => comboCount(parseHandClass(l)!.kind));
const FULL = new Float64Array(NC).fill(1);

/** 手番の種類。PU=未開、RS=レイズにオールインで返す、CA/OC=オールインにコール、RC=レイズした人の 2 回目。 */
export type RaiseActionType = 'PU' | 'RS' | 'CA' | 'OC' | 'RC';

/** 行動の番号。0=フォールド、1=オールイン（プッシュ/コール）、2=レイズ。 */
const FOLD = 0;
const ALLIN = 1;
const RAISE = 2;

export interface RaiseGameOptions {
  maxIters?: number;
  refreshEvery?: number;
  /** 3 人以上のショーダウンを MC で見積もるときのサンプル数（exact3 が使えないときだけ）。 */
  samples?: number;
  seed?: number;
  avgPower?: number;
  targetExploitabilityPt?: number;
  /** 2 人ショーダウンの厳密表（無ければ MC）。 */
  winTie?: WinTieTable;
  /** 3 人ショーダウンの厳密表（無ければ MC）。 */
  winTie3?: WinTie3Table;
  /** 3 人ショーダウン 1 個を厳密に解く見積りコストの上限（超えたらその refresh は MC）。 */
  exact3Budget?: number;
  /** 3 人ショーダウンを厳密に解く到達確率の下限（既定 0.01%。下回るものは MC）。 */
  exact3MinReach?: number;
  /** 層化 MC で 1 クラスあたりに回すサンプル数（既定 16）。 */
  mcPerClass?: number;
  /**
   * 1 回の見積り直しで 3 人ショーダウンの厳密計算に使う計算量（表の参照回数）の上限。既定 500 万
   * （単スレで 1 秒弱）。最終評価だけはこの 4 倍まで使う。6 人卓の実測では、全部を MC にしても
   * 厳密に寄せても hero 側のレンジの差は 1〜2 ポイントで、時間は 2.5 倍違う。
   */
  exact3RefreshBudget?: number;
  /** ショーダウン見積りの並列ランナー（ブラウザの Web Worker プール）。 */
  mcRunner?: McRunner;
  /** 同時オールインの上限人数（既定 3）。 */
  maxActive?: number;
}

export interface RaiseRangeOut {
  pct: number;
  range: string;
  hands: string[];
  freq: Record<string, number>;
  /** その行動 − フォールド の EV 差（実払い pt）。 */
  ev: Record<string, number>;
}

export interface RaiseSolveNode extends RaiseRangeOut {
  key: string;
  actor: Position;
  actionType: RaiseActionType;
  equity: Record<string, { pre: number; post: number }>;
  quality: { exploitability: number; converged: boolean; iterations: number };
  /** 未開ノードでレイズできるときのレイズレンジ（主フィールドはオールインのレンジ）。 */
  raise?: RaiseRangeOut;
}

export interface RaiseSolveResult {
  nodes: RaiseSolveNode[];
  iterations: number;
  exploitabilityPt: number;
  converged: boolean;
  equity: Record<string, { pre: number; post: number }>;
  raiseTo: number;
}

interface DNode {
  actor: number;
  key: string;
  actionType: RaiseActionType;
  /** 選べる行動（FOLD/ALLIN/RAISE の番号）。打ち切りノードは [FOLD] だけ。 */
  acts: number[];
  /** acts と同順の子。>=0 は決定ノード、<0 は終局 -(index+1)。 */
  children: number[];
  /** RC ノードのとき、同じ人のレイズしたノード（レイズ頻度で事前分布を条件付ける）。 */
  respOf: number;
}

interface TNode {
  /** ショーダウン参加者（2 人以上）。不戦勝なら空。 */
  participants: number[];
  /** 不戦勝の勝者（ショーダウンなら -1）。 */
  winner: number;
  commits: number[];
  /** 参加者ごとの到達経路（[決定ノード, 行動] の列。積がその参加者の到達レンジ）。 */
  arrival: [number, number][][];
}

function popcount(x: number): number {
  let c = 0;
  while (x) {
    x &= x - 1;
    c++;
  }
  return c;
}

function rangeFraction(freq: F64): number {
  let w = 0;
  for (let c = 0; c < NC; c++) w += COMBO[c]! * freq[c]!;
  return w / TOTAL_COMBOS;
}

function nonEmpty(freq: F64): F64 {
  let w = 0;
  for (let c = 0; c < NC; c++) w += freq[c]!;
  return w > 1e-9 ? freq : FULL;
}

function nzCount(freq: F64): number {
  const r = nonEmpty(freq);
  let k = 0;
  for (let c = 0; c < NC; c++) if (r[c]! >= EPS_ARRIVAL) k++;
  return k;
}

function antePaid(state: BoardState, pos: Position): number {
  const { scheme, amount } = state.ante;
  if (scheme === 'none') return 0;
  if (scheme === 'all') return amount;
  return pos === 'BB' ? amount : 0;
}

function mix(a: number, b: number, c: number): number {
  let h = (a ^ 0x9e3779b1) >>> 0;
  h = (Math.imul(h ^ b, 0x85ebca6b) + 0x165667b1) >>> 0;
  h = (Math.imul(h ^ c, 0xc2b2ae35) + 0x27d4eb2f) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** 木を作る。nodes は親が子より先に並ぶ（前順）。 */
function buildTree(state: BoardState, raiseTo: number, maxActive: number) {
  const n = state.playersLeft;
  const order = positionsForPlayersLeft(n);
  const last = n - 1;
  const seats = order.map((pos) => {
    const s = state.seats.find((x) => x.pos === pos && x.state !== 'empty');
    if (!s) throw new Error(`solveRaiseGame: missing live seat ${pos}`);
    return s;
  });
  const T = seats.map((s, i) => s.stack + s.bet + antePaid(state, order[i]!));
  const dead = seats.map((s, i) => s.bet + antePaid(state, order[i]!));
  const raiseCommit = order.map((pos, i) => Math.max(dead[i]!, raiseTo + antePaid(state, pos)));
  // レイズはオールインでないことが条件（レイズ後に少しでもチップが残る）。
  const canRaise = (i: number): boolean => T[i]! - raiseCommit[i]! > 1e-6 && raiseTo > state.blinds.bb;

  const nodes: DNode[] = [];
  const terms: TNode[] = [];
  const chars: ActionChar[] = new Array<ActionChar>(n).fill('-');
  const path: { node: number; act: number; actor: number }[] = [];

  const keyOf = (upTo: number): string => {
    const m: Partial<Record<Position, ActionChar>> = {};
    for (let j = 0; j < upTo; j++) m[order[j]!] = chars[j]!;
    return normalizeKey(n, m);
  };

  const mkTerm = (participants: number[], winner: number, R: number): number => {
    const commits = dead.slice();
    if (R >= 0) commits[R] = raiseCommit[R]!;
    for (const p of participants) commits[p] = T[p]!;
    // 不戦勝の勝者は全額を拠出した扱いにする（サイドポットの規則で、勝者は自分の拠出額までしか
    // 相手から取れないため。勝者には全額が戻るので値は変わらない）。
    if (winner >= 0) commits[winner] = T[winner]!;
    const arrival = participants.map((p) => path.filter((x) => x.actor === p).map((x) => [x.node, x.act] as [number, number]));
    terms.push({ participants, winner, commits, arrival });
    return -terms.length; // -(index+1)
  };

  const bitsOf = (S: number): number[] => {
    const out: number[] = [];
    for (let s = 0; s < n; s++) if (S & (1 << s)) out.push(s);
    return out;
  };

  /** S のオールイン集合で終わる終局（R はレイズしてフォールドした人, 無ければ -1）。 */
  const endWith = (S: number, R: number): number => {
    const ps = bitsOf(S);
    return ps.length === 1 ? mkTerm([], ps[0]!, R) : mkTerm(ps, -1, R);
  };

  const pushNode = (nd: DNode): number => {
    nodes.push(nd);
    return nodes.length - 1;
  };

  const build = (i: number, R: number, S: number): number => {
    if (i === n) {
      if (R < 0) return endWith(S, -1);
      if (S === 0) return mkTerm([], R, R); // レイズに全員フォールド
      // レイズした人の 2 回目（オールインを受けた）
      const truncated = popcount(S) >= maxActive;
      const m: Partial<Record<Position, ActionChar>> = {};
      for (let j = 0; j < n; j++) m[order[j]!] = chars[j]!;
      const respOf = path.find((x) => x.actor === R && x.act === RAISE)!.node;
      const id = pushNode({
        actor: R, key: normalizeKey(n, m), actionType: 'RC', acts: truncated ? [FOLD] : [FOLD, ALLIN], children: [], respOf,
      });
      const nd = nodes[id]!;
      path.push({ node: id, act: FOLD, actor: R });
      nd.children.push(endWith(S, R));
      path.pop();
      if (!truncated) {
        path.push({ node: id, act: ALLIN, actor: R });
        nd.children.push(mkTerm(bitsOf(S | (1 << R)), -1, -1));
        path.pop();
      }
      return id;
    }
    if (i === last && R < 0 && S === 0) return mkTerm([], last, -1); // BB のウォーク

    const unopened = R < 0 && S === 0;
    const pc = popcount(S);
    const truncated = pc >= maxActive;
    const actionType: RaiseActionType = unopened ? 'PU' : pc === 0 ? 'RS' : pc === 1 ? 'CA' : 'OC';
    const acts = truncated ? [FOLD] : unopened && canRaise(i) ? [FOLD, ALLIN, RAISE] : [FOLD, ALLIN];
    const id = pushNode({ actor: i, key: keyOf(i), actionType, acts, children: [], respOf: -1 });
    const nd = nodes[id]!;
    for (const a of acts) {
      path.push({ node: id, act: a, actor: i });
      if (a === FOLD) {
        chars[i] = 'F';
        nd.children.push(build(i + 1, R, S));
      } else if (a === ALLIN) {
        chars[i] = pc === 0 ? 'P' : 'C';
        nd.children.push(build(i + 1, R, S | (1 << i)));
      } else {
        chars[i] = 'R';
        nd.children.push(build(i + 1, i, S));
      }
      path.pop();
    }
    chars[i] = '-';
    return id;
  };
  build(0, -1, 0);

  const payouts = payoutsForPlayers(n, state.gameMode);
  // 不戦勝の終局は ICM が確定（refresh 不要）。
  const foldoutVal = terms.map((t) => {
    if (t.winner < 0) return null;
    const eligible = new Array<boolean>(n).fill(false);
    eligible[t.winner] = true;
    return icmEquities(finalStacksFromShowdown(T, t.commits, eligible, new Array<number>(n).fill(0)), payouts);
  });

  return { n, order, last, T, payouts, nodes, terms, foldoutVal };
}

type Tree = ReturnType<typeof buildTree>;

/**
 * ミニレイズ・ゲームを解く。playersLeft は 2..6。
 * raiseTo は state.raiseTo（無ければ 2BB）。
 */
export async function solveRaiseGame(state: BoardState, opts: RaiseGameOptions = {}): Promise<RaiseSolveResult> {
  const n = state.playersLeft;
  if (n < 2 || n > 6) throw new Error(`solveRaiseGame requires playersLeft 2..6, got ${n}`);
  const raiseTo = state.raiseTo ?? 2;
  const maxActive = opts.maxActive ?? 3;
  const tree = buildTree(state, raiseTo, maxActive);
  const { nodes, terms, foldoutVal, payouts } = tree;
  const maxIters = opts.maxIters ?? 2500;
  const refreshEvery = opts.refreshEvery ?? 100;
  const seed = opts.seed ?? MC_SEED;
  const samples = opts.samples ?? 30_000;
  const avgPower = opts.avgPower ?? 1;
  const exact3Budget = opts.exact3Budget ?? 6_000_000;
  const exact3MinReach = opts.exact3MinReach ?? 1e-4;
  const mcPerClass = opts.mcPerClass ?? 16;
  const exact3RefreshBudget = opts.exact3RefreshBudget ?? 5_000_000;

  // 戦略: ノード → 行動ごとのクラス別頻度（和は 1）。
  const strat: F64[][] = nodes.map((nd) => nd.acts.map(() => new Float64Array(NC).fill(1 / nd.acts.length)));

  // 終局の値: 席ごとのクラス別値（参加者）と、席ごとの周辺値（定数）。
  const termSeatVal: number[][] = terms.map((_, k) => foldoutVal[k] ?? new Array<number>(n).fill(0));
  const termPcEq: (Map<number, F64> | null)[] = terms.map(() => null);
  const termVals: F64[] = terms.map(() => new Float64Array(n * NC));
  const fillTermVals = (k: number): void => {
    const out = termVals[k]!;
    const sv = termSeatVal[k]!;
    const pe = termPcEq[k];
    for (let s = 0; s < n; s++) {
      const v = pe?.get(s);
      if (v) out.set(v, s * NC);
      else out.fill(sv[s]!, s * NC, (s + 1) * NC);
    }
  };
  for (let k = 0; k < terms.length; k++) fillTermVals(k);

  const arrivalRange = (k: number, p: number): F64 => {
    const r = new Float64Array(NC).fill(1);
    for (const [nid, act] of terms[k]!.arrival[p]!) {
      const f = strat[nid]![nodes[nid]!.acts.indexOf(act)]!;
      for (let c = 0; c < NC; c++) r[c]! *= f[c]!;
    }
    return nonEmpty(r);
  };

  /**
   * ショーダウンの見積り直し。3 人ショーダウンの厳密計算は 1 個 0.05〜1 秒かかり、6 人卓では
   * 40 個以上ある。そこで **到達確率の高い順に、1 回あたりの計算量の上限まで厳密**にし、残りは
   * 層化 MC で見積もる（到達確率が低い終局は EV への寄与もそれに比例して小さい）。少人数の卓は
   * 全部厳密になる。MC だけで反復すると、ばらつきのある EV で最善反応を取り続けるぶん解が
   * 少しずれる（3 人卓 BU12/SB8/BB15 で BU のプッシュ 33.6% ↔ 厳密 30.9%）。
   */
  const refresh = async (epoch: number, termReach: number[], final = false): Promise<void> => {
    const jobs: { k: number; job: ShowdownMcJob }[] = [];
    const inline: { k: number; run: () => ShowdownMcResult }[] = [];
    // 厳密に解く 3 人ショーダウンを、到達確率の高い順に予算まで選ぶ。
    const exactSet = new Set<number>();
    if (opts.winTie3) {
      const cand: { k: number; reach: number; cost: number }[] = [];
      for (let k = 0; k < terms.length; k++) {
        if (terms[k]!.participants.length !== 3 || termReach[k]! < exact3MinReach) continue;
        const r3 = terms[k]!.participants.map((_, p) => arrivalRange(k, p));
        const cost = exact3LookupCost(nzCount(r3[0]!), nzCount(r3[1]!), nzCount(r3[2]!));
        if (cost <= exact3Budget) cand.push({ k, reach: termReach[k]!, cost });
      }
      cand.sort((a, b) => b.reach - a.reach);
      let used = 0;
      const budget = final ? exact3RefreshBudget * 4 : exact3RefreshBudget;
      for (const c of cand) {
        if (used + c.cost > budget && exactSet.size > 0) break;
        exactSet.add(c.k);
        used += c.cost;
      }
    }
    for (let k = 0; k < terms.length; k++) {
      const t = terms[k]!;
      if (t.participants.length < 2) continue;
      // ほぼ到達しない終局は最初と最後だけ見積もる（途中は前回の値のまま）。
      if (epoch > 0 && !final && termReach[k]! < 1e-6 && termPcEq[k]) continue;
      const node: ShowdownNode = { preHandStacks: tree.T, commits: t.commits, participants: t.participants, payouts };
      const ranges = t.participants.map((_, p) => arrivalRange(k, p));
      if (t.participants.length === 2 && opts.winTie) {
        inline.push({ k, run: () => computeShowdown2Exact(node, ranges, opts.winTie!) });
        continue;
      }
      const exact3 = exactSet.has(k);
      // MC は層化（参加者ごとに全 169 クラスを同じ本数ずつ評価）。コンボ数比例の MC だと
      // AA のような少数コンボのクラスにほとんどサンプルが落ちず、コール判断が壊れる。
      const strat: StratSpec = { cand: t.participants.map(() => undefined), mOc: mcPerClass, mLow: mcPerClass, sMarg: 500 };
      if (opts.mcRunner) {
        jobs.push({ k, job: { node, ranges, samples: exact3 ? 0 : samples, seed: mix(seed, epoch, k), exact3, strat: exact3 ? undefined : strat } });
      } else if (exact3) {
        inline.push({ k, run: () => computeShowdown3Exact(node, ranges, opts.winTie3!) });
      } else {
        inline.push({ k, run: () => computeShowdownMc(node, ranges, samples, mix(seed, epoch, k), strat) });
      }
    }
    const store = (k: number, res: ShowdownMcResult): void => {
      const m = new Map<number, F64>();
      terms[k]!.participants.forEach((p, i) => m.set(p, res.pcEq[i]!));
      termPcEq[k] = m;
      termSeatVal[k] = res.seatMarginal;
      fillTermVals(k);
    };
    const pending = jobs.length > 0 && opts.mcRunner ? opts.mcRunner(jobs.map((j) => j.job)) : null;
    for (const it of inline) store(it.k, it.run());
    if (pending) {
      const res = (await pending) as (ShowdownMcResult | Exact3DenseChunk)[];
      jobs.forEach((j, i) => store(j.k, res[i] as ShowdownMcResult));
    }
  };

  // --- 1 反復ぶんの値の計算（下から） ---
  const nodeVals: F64[] = nodes.map(() => new Float64Array(n * NC));
  const actProb: number[][] = nodes.map((nd) => nd.acts.map(() => 0));
  const valsOf = (ref: number): F64 => (ref >= 0 ? nodeVals[ref]! : termVals[-ref - 1]!);

  const computeProbs = (): void => {
    for (let d = 0; d < nodes.length; d++) {
      const nd = nodes[d]!;
      const st = strat[d]!;
      if (nd.respOf < 0) {
        for (let a = 0; a < nd.acts.length; a++) actProb[d]![a] = rangeFraction(st[a]!);
        continue;
      }
      // レイズした人の 2 回目: レイズレンジの中での割合（条件付き）。
      const prior = strat[nd.respOf]![nodes[nd.respOf]!.acts.indexOf(RAISE)]!;
      let den = 0;
      for (let c = 0; c < NC; c++) den += COMBO[c]! * prior[c]!;
      for (let a = 0; a < nd.acts.length; a++) {
        let num = 0;
        for (let c = 0; c < NC; c++) num += COMBO[c]! * prior[c]! * st[a]![c]!;
        actProb[d]![a] = den > 1e-12 ? num / den : rangeFraction(st[a]!);
      }
    }
  };

  const computeVals = (): void => {
    computeProbs();
    for (let d = nodes.length - 1; d >= 0; d--) {
      const nd = nodes[d]!;
      const out = nodeVals[d]!;
      const kids = nd.children.map(valsOf);
      const p = nd.actor;
      const st = strat[d]!;
      const pr = actProb[d]!;
      for (let s = 0; s < n; s++) {
        const o = s * NC;
        if (s !== p) {
          for (let c = 0; c < NC; c++) {
            let v = 0;
            for (let a = 0; a < kids.length; a++) v += pr[a]! * kids[a]![o + c]!;
            out[o + c] = v;
          }
        } else if (nd.respOf >= 0) {
          // 自分の 2 回目はクラスごとに最善を取る（レイズの EV はこれを前提に評価する）。
          for (let c = 0; c < NC; c++) {
            let best = -Infinity;
            for (let a = 0; a < kids.length; a++) best = Math.max(best, kids[a]![o + c]!);
            out[o + c] = best;
          }
        } else {
          for (let c = 0; c < NC; c++) {
            let v = 0;
            for (let a = 0; a < kids.length; a++) v += st[a]![c]! * kids[a]![o + c]!;
            out[o + c] = v;
          }
        }
      }
    }
  };

  /** ノード d で手番の人が行動 a を取ったときのクラス別 EV。 */
  const evOf = (d: number, a: number): F64 => {
    const nd = nodes[d]!;
    const o = nd.actor * NC;
    return valsOf(nd.children[a]!).subarray(o, o + NC);
  };

  const reachOf = (): { node: number[]; term: number[] } => {
    const rn = new Array<number>(nodes.length).fill(0);
    const rt = new Array<number>(terms.length).fill(0);
    rn[0] = 1;
    for (let d = 0; d < nodes.length; d++) {
      const r = rn[d]!;
      if (r === 0) continue;
      const nd = nodes[d]!;
      nd.children.forEach((ch, a) => {
        const q = r * actProb[d]![a]!;
        if (ch >= 0) rn[ch]! += q;
        else rt[-ch - 1]! += q;
      });
    }
    return { node: rn, term: rt };
  };

  const exploitability = (): number => {
    const { node: rn } = reachOf();
    let total = 0;
    for (let d = 0; d < nodes.length; d++) {
      const r = rn[d]!;
      const nd = nodes[d]!;
      if (r === 0 || nd.acts.length < 2) continue;
      const evs = nd.acts.map((_, a) => evOf(d, a));
      const st = strat[d]!;
      const prior = nd.respOf >= 0 ? strat[nd.respOf]![nodes[nd.respOf]!.acts.indexOf(RAISE)]! : FULL;
      let num = 0;
      let den = 0;
      for (let c = 0; c < NC; c++) {
        const w = COMBO[c]! * prior[c]!;
        let best = -Infinity;
        let cur = 0;
        for (let a = 0; a < evs.length; a++) {
          best = Math.max(best, evs[a]![c]!);
          cur += st[a]![c]! * evs[a]![c]!;
        }
        num += w * (best - cur);
        den += w;
      }
      if (den > 0) total += r * (num / den);
    }
    return total;
  };

  // 収束しきい値（nwaySolver と同じ尺度: 振れ幅をクラブの「総和÷振れ幅」で換算）。
  const spanPt = Math.max(...payouts) - Math.min(...payouts);
  const clubPayouts = payoutsForPlayers(payouts.length, 'club');
  const clubPool = clubPayouts.reduce((a, b) => a + b, 0);
  const clubSpan = Math.max(...clubPayouts) - Math.min(...clubPayouts);
  const scalePt = spanPt * (clubSpan > 0 ? clubPool / clubSpan : 1);
  const targetExpl = opts.targetExploitabilityPt ?? scalePt * (opts.winTie3 !== undefined ? 0.0002 : 0.0015);

  let nextRefresh = refreshEvery;
  const isRefresh = (t: number): boolean => {
    if (t < nextRefresh) return false;
    nextRefresh += nextRefresh < 1000 ? refreshEvery : nextRefresh < 3000 ? refreshEvery * 2 : refreshEvery * 4;
    return true;
  };

  computeProbs();
  await refresh(0, reachOf().term);
  let iterations = 0;
  let expl = Number.POSITIVE_INFINITY;
  for (let t = 1; t <= maxIters; t++) {
    iterations = t;
    const rp = isRefresh(t);
    if (rp) {
      computeProbs();
      await refresh(Math.floor(t / refreshEvery), reachOf().term);
    }
    computeVals();
    const w = (avgPower + 1) / (t + avgPower + 1);
    for (let d = 0; d < nodes.length; d++) {
      const nd = nodes[d]!;
      if (nd.acts.length < 2) continue;
      const evs = nd.acts.map((_, a) => evOf(d, a));
      const st = strat[d]!;
      for (let c = 0; c < NC; c++) {
        let br = 0;
        for (let a = 1; a < evs.length; a++) if (evs[a]![c]! >= evs[br]![c]!) br = a;
        for (let a = 0; a < evs.length; a++) st[a]![c]! += w * ((a === br ? 1 : 0) - st[a]![c]!);
      }
    }
    if (rp || t === maxIters) {
      computeVals();
      expl = exploitability();
      if (expl <= targetExpl) break;
    }
  }

  computeProbs();
  await refresh(0x7fffffff, reachOf().term, true);
  computeVals();
  expl = exploitability();
  const converged = expl <= targetExpl;
  return buildOutput(tree, strat, evOf, reachOf, termSeatVal, raiseTo, { exploitability: expl, converged, iterations });
}

function buildOutput(
  tree: Tree,
  strat: F64[][],
  evOf: (d: number, a: number) => F64,
  reachOf: () => { node: number[]; term: number[] },
  termSeatVal: number[][],
  raiseTo: number,
  quality: { exploitability: number; converged: boolean; iterations: number },
): RaiseSolveResult {
  const { n, order, nodes, T, payouts } = tree;
  const pre = icmEquities(T, payouts);
  const { term: rt } = reachOf();
  const post = new Array<number>(n).fill(0);
  rt.forEach((q, k) => {
    if (q === 0) return;
    for (let s = 0; s < n; s++) post[s]! += q * termSeatVal[k]![s]!;
  });
  const equity: Record<string, { pre: number; post: number }> = {};
  for (let s = 0; s < n; s++) equity[order[s]!] = { pre: pre[s]!, post: post[s]! };

  const rangeOut = (inRange: boolean[], evDiff: F64 | null): RaiseRangeOut => {
    const hands: string[] = [];
    const freq: Record<string, number> = {};
    const ev: Record<string, number> = {};
    let w = 0;
    for (let c = 0; c < NC; c++) {
      const label = HAND_CLASS_ORDER[c]!;
      freq[label] = inRange[c] ? 1 : 0;
      ev[label] = evDiff ? evDiff[c]! : 0;
      if (inRange[c]) {
        hands.push(label);
        w += COMBO[c]!;
      }
    }
    return { pct: (w / TOTAL_COMBOS) * 100, range: formatRange(hands), hands, freq, ev };
  };
  const diff = (d: number, a: number): F64 => {
    const ea = evOf(d, a);
    const ef = evOf(d, 0);
    const out = new Float64Array(NC);
    for (let c = 0; c < NC; c++) out[c] = ea[c]! - ef[c]!;
    return out;
  };

  // 3 択（FOLD / ALL IN / RAISE）: 平均頻度がいちばん高い行動で塗り分ける。
  const split = nodes.map((nd, d) => {
    if (nd.acts.length !== 3) return null;
    const st = strat[d]!;
    const shove: boolean[] = [];
    const raise: boolean[] = [];
    for (let c = 0; c < NC; c++) {
      let best = 0;
      for (let a = 1; a < 3; a++) if (st[a]![c]! > st[best]![c]!) best = a;
      shove.push(best === 1);
      raise.push(best === 2);
    }
    return { shove, raise };
  });

  const out: RaiseSolveNode[] = nodes.map((nd, d) => {
    const base = { key: nd.key, actor: order[nd.actor]!, actionType: nd.actionType, equity, quality };
    const st = strat[d]!;
    if (nd.acts.length < 2) return { ...base, ...rangeOut(new Array<boolean>(NC).fill(false), null) };
    if (nd.acts.length === 2) {
      const push = monotonizePush({ classOrder: HAND_CLASS_ORDER, values: st[1]!, combos: COMBO, threshold: 0.5 });
      // レイズした人の 2 回目は、レイズしたハンドの中だけを表示する（レイズしないハンドの
      // 「もし来たら」の判断は実際には起きないので、混ぜると誤解を招く）。
      // ただし freq（hero の判定に使う）は絞らない。hero が実際にレイズしたハンドが均衡のレイズ
      // レンジの外でも、そのハンドで今コールすべきかは答える。
      const raised = nd.respOf >= 0 ? split[nd.respOf]?.raise : undefined;
      if (!raised) return { ...base, ...rangeOut(push, diff(d, 1)) };
      const full = rangeOut(push, diff(d, 1));
      return { ...base, ...rangeOut(push.map((v, c) => v && raised[c]!), diff(d, 1)), freq: full.freq };
    }
    const sp = split[d]!;
    return { ...base, ...rangeOut(sp.shove, diff(d, 1)), raise: rangeOut(sp.raise, diff(d, 2)) };
  });

  return { nodes: out, iterations: quality.iterations, exploitabilityPt: quality.exploitability, converged: quality.converged, equity, raiseTo };
}
