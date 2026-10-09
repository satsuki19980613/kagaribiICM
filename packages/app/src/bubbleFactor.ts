import { POSITIONS, type BoardState, type Position } from '@kagaribi/core';
import { icmEquities, payoutsForPlayers } from '@kagaribi/solver';

/**
 * 局面の全席組み合わせのバブルファクター（さつき要望 2026-10-09）。
 *
 * BF(a, b) = a が b と「小さい方のスタック全部」を賭けて勝負したとき、
 *            負けたときの ICM 損失 ÷ 勝ったときの ICM 利得（ポットなし）。
 * 五分の勝負を受けるのに必要なエクイティは BF / (1 + BF)。
 *
 * スタックはハンド開始時（ブラインド・アンティを払う前）＝ stack + bet + ante。局面の途中
 * （誰かがプッシュ済み）でも、席どうしの「力関係」を見る表なので開始時の値で揃える。
 */
export interface BubbleFactorTable {
  /** アクション順（UTG→BB）。 */
  positions: Position[];
  /** ハンド開始時のスタック（bb）。positions と同順。 */
  stacks: number[];
  /** bf[a][b]。a === b と計算不能（利得が 0 以下）は null。 */
  bf: (number | null)[][];
}

function antePaid(state: BoardState, pos: Position): number {
  const { scheme, amount } = state.ante;
  if (scheme === 'none') return 0;
  if (scheme === 'all') return amount;
  return pos === 'BB' ? amount : 0;
}

export function bubbleFactorTable(state: BoardState): BubbleFactorTable | null {
  // アクション順（UTG→BB）に並べる。AOF ではプッシャーは必ずコーラーより前の席。
  const seats = state.seats
    .filter((s) => s.state !== 'empty')
    .sort((x, y) => POSITIONS.indexOf(x.pos) - POSITIONS.indexOf(y.pos));
  const n = seats.length;
  if (n < 2) return null;
  const positions = seats.map((s) => s.pos);
  const stacks = seats.map((s) => s.stack + s.bet + antePaid(state, s.pos));
  if (stacks.some((s) => !(s > 0) || !Number.isFinite(s))) return null;
  const payouts = payoutsForPlayers(n, state.gameMode);
  const e0 = icmEquities(stacks, payouts);
  const bf = positions.map((_, a) =>
    positions.map((__, b) => {
      if (a === b) return null;
      const x = Math.min(stacks[a]!, stacks[b]!);
      const win = [...stacks];
      win[a]! += x;
      win[b]! -= x;
      const lose = [...stacks];
      lose[a]! -= x;
      lose[b]! += x;
      // 飛んだ席は 0 スタックで残す（icmEquities がその席を最下位に置く）。
      const gain = icmEquities(win, payouts)[a]! - e0[a]!;
      const loss = e0[a]! - icmEquities(lose, payouts)[a]!;
      return gain > 1e-12 ? loss / gain : null;
    }),
  );
  return { positions, stacks, bf };
}

/** 五分の勝負（ポットなし）を受けるのに必要なエクイティ。 */
export const breakEvenEquity = (bf: number): number => bf / (1 + bf);
