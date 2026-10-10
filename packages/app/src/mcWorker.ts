/**
 * ショーダウン MC の下請け Web Worker（Phase 3-1x）。
 * 求解 Web Worker（solver.worker.ts）から入れ子で起動され、1 メッセージ =
 * ショーダウン集合 1 個分のジョブ。通常は computeShowdownMc を呼ぶだけの薄いラッパだが、
 * `exact3` / `exact3Chunk` ジョブは Node の nwayWorker.ts と同じ契約で
 * computeShowdown3Exact / computeShowdown3ExactDenseChunk に振り分ける
 * （3人ショーダウンの厳密計算を並列プールへ chunk 分割して投げる経路, nwaySolver.ts の
 * mcRunnerParallelism 参照）。
 *
 * 3-way テーブル（wintie3-169.*, 約21MB）は worker ごとに**遅延・1 回だけ** fetch する
 * （exact3/exact3Chunk ジョブが来て初めて読む。MC のみの求解では一切触らない。ブラウザの
 * HTTP キャッシュが効くため、worker 台数ぶん fetch しても実コストは軽い）。
 */

import {
  computeShowdownMc,
  computeShowdown3Exact,
  computeShowdown3ExactDenseChunk,
  loadWinTie3TableBrowser,
  type ShowdownMcJob,
  type ShowdownNode,
  type StratSpec,
  type ShowdownMcResult,
  type Exact3DenseChunk,
  type WinTie3Table,
} from '@kagaribi/solver';
// 3-way オールイン結果テーブル（同上の静的アセット、?url でハッシュ付き URL に解決）。
import wt3BinUrl from '../../solver/artifacts/wintie3-169.u16.bin?url';
import wt3MetaUrl from '../../solver/artifacts/wintie3-169.meta.json?url';

interface Req {
  job: ShowdownMcJob;
}

let winTie3Promise: Promise<WinTie3Table> | null = null;
function getWinTie3(): Promise<WinTie3Table> {
  winTie3Promise ??= loadWinTie3TableBrowser({ meta: wt3MetaUrl, bin: wt3BinUrl });
  return winTie3Promise;
}

/** 0..n-1 の整数だけを通す（席番号・ハンドクラスの番号）。配列の添字に使う前に必ず通す。 */
function indexBelow(x: unknown, n: number): number {
  for (let i = 0; i < n; i++) if (x === i) return i;
  throw new Error('invalid index in showdown job');
}

/** ハンドクラスの数（13×13）。 */
const N_CLASSES = 169;

/**
 * 受け取ったジョブの形を確かめ、確かめた値だけで組み直す（席数 2〜6、配列の長さ、参加者の席番号）。
 * おかしければ計算しない。
 */
function checkedNode(node: ShowdownNode): ShowdownNode {
  const n = node.preHandStacks.length;
  if (!(n >= 2 && n <= 6) || node.commits.length !== n || node.payouts.length !== n) {
    throw new Error('invalid showdown job');
  }
  const participants: number[] = [];
  for (const p of node.participants) participants.push(indexBelow(p, n));
  return { preHandStacks: node.preHandStacks, commits: node.commits, participants, payouts: node.payouts };
}

/** 層化 MC の指定も同じく組み直す（候補クラスの番号は 0..168 だけ）。 */
function checkedStrat(strat: StratSpec | undefined): StratSpec | undefined {
  if (!strat) return undefined;
  const cand: (Int16Array | undefined)[] = [];
  for (const c of strat.cand) {
    if (!c) {
      cand.push(undefined);
      continue;
    }
    const out = new Int16Array(c.length);
    for (let q = 0; q < c.length; q++) out[q] = indexBelow(c[q], N_CLASSES);
    cand.push(out);
  }
  return { cand, mOc: strat.mOc, mLow: strat.mLow, sMarg: strat.sMarg };
}

self.onmessage = async (e: MessageEvent<Req>): Promise<void> => {
  // 専用ワーカーに届くのは、起動したページ（このアプリ）からのメッセージだけ。その origin は空文字になる。
  if (e.origin !== '' && e.origin !== self.location.origin) return;
  const { job } = e.data;
  try {
    const node = checkedNode(job.node);
    let res: ShowdownMcResult | Exact3DenseChunk;
    if (job.exact3Chunk) {
      const table = await getWinTie3();
      res = computeShowdown3ExactDenseChunk(node, job.ranges, table, job.exact3Chunk.lo, job.exact3Chunk.hi);
    } else if (job.exact3) {
      const table = await getWinTie3();
      res = computeShowdown3Exact(node, job.ranges, table);
    } else {
      res = computeShowdownMc(node, job.ranges, job.samples, job.seed, checkedStrat(job.strat));
    }
    self.postMessage({ ok: true, res });
  } catch (err) {
    self.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
