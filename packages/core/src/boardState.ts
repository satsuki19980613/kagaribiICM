/**
 * 盤面状態（IMPLEMENTATION_PLAN §3.1）。
 * OCR / 手入力の出力であり、Solver の入力。単位はすべて BB 換算。
 *
 * bet:   このストリートで既にコミットした総額（ブラインド・アンティのブラインド分を含む）
 * stack: ベット分を差し引いた残額（画面表示と同じ）
 * state: live | fold | allin | call | empty（empty は不在・接続切れ。残り人数から除外）
 */

import { GAME_MODES, type GameMode } from './gameMode.js';
import { POSITIONS, positionsMatchPlayersLeft, isValidPlayersLeft, type Position } from './positions.js';
import { isHandClass } from './cards.js';
import { ACTION_CHARS, type ActionChar } from './key.js';
import { arr, num, obj, oneOf, optional, rec, run, str, type Validator } from './validate.js';

export const SEAT_STATES = ['live', 'fold', 'allin', 'call', 'empty'] as const;
export type SeatState = (typeof SEAT_STATES)[number];

/** 読み取りの確かさ（0〜1）。どの項目も省略できる。 */
export interface SeatConfidence {
  stack?: number | undefined;
  bet?: number | undefined;
  state?: number | undefined;
}

export interface Seat {
  pos: Position;
  stack: number;
  state: SeatState;
  bet: number;
  name?: string | undefined;
  confidence?: SeatConfidence | undefined;
}

export interface Ante {
  scheme: 'all' | 'bb' | 'none';
  amount: number;
}

export interface Blinds {
  sb: number;
  bb: number;
}

export interface BoardState {
  street: 'preflop';
  blinds: Blinds;
  ante: Ante;
  heroHand: string;
  playersLeft: number;
  seats: Seat[];
  heroPos: Position;
  pot?: number | undefined;
  heroHandConfidence?: number | undefined;
  /**
   * どのゲームモードの局面か（プライズ表・開始スタックが決まる）。**省略時はクラブマッチ**。
   * `results.spot` は BoardState をそのまま jsonb で持つので、ここに足すだけで記録にも
   * Worker にも自動で流れる（DB マイグレーション不要）。v3 以前の記録は未指定＝クラブ。
   */
  gameMode?: GameMode | undefined;
  /**
   * ミニレイズ・ゲームで解くときのレイズ額（BB 単位の総ベット額, 例 2）。**省略時は AOF**。
   * 最初に参加する人だけがこの額までレイズでき、ほかは全員オールインかフォールドのみ
   * （さつき決定 2026-10-09 の B 案）。レイズした人はオールインを受けたらコールかフォールド。
   */
  raiseTo?: number | undefined;
  /**
   * レイズした人のレイズレンジを「上位 N%」と仮定して解く（N は 1〜100）。**省略時はレンジも
   * ソルバーが決める**（均衡のレンジ。罠だけの狭いレンジになりやすい）。raiseTo があるときだけ意味を持つ。
   */
  raiseRange?: number | undefined;
  /**
   * hero の判断までに起きたアクション（席 → 'F' / 'R' / 'P' / 'C'）。hero の決定ノードを
   * 結果画面の見出しに選ぶために使う。hero 自身が 'R' なら「レイズ後にオールインを受けた」判断。
   * 省略時は従来どおり（hero の未開ノード）。
   */
  line?: Partial<Record<Position, ActionChar>> | undefined;
}

/** BB 単位の額（0 以上の有限の数）。 */
const unitAmount = num({ finite: true, min: 0 });
/** 0〜1 の値（確かさ）。 */
const unitInterval = num({ min: 0, max: 1 });
const positiveAmount = num({ finite: true, above: 0 });

const seat: Validator<Seat> = obj<Seat>({
  pos: oneOf(POSITIONS),
  stack: unitAmount,
  state: oneOf(SEAT_STATES),
  bet: unitAmount,
  name: optional(str()),
  confidence: optional(
    obj<SeatConfidence>({ stack: optional(unitInterval), bet: optional(unitInterval), state: optional(unitInterval) }),
  ),
});

const boardState: Validator<BoardState> = obj<BoardState>({
  street: oneOf(['preflop']),
  blinds: obj<Blinds>({ sb: positiveAmount, bb: positiveAmount }),
  ante: obj<Ante>({ scheme: oneOf(['all', 'bb', 'none']), amount: unitAmount }),
  heroHand: str(isHandClass, 'invalid hand-class notation'),
  playersLeft: num({ int: true }),
  seats: arr(seat, { min: 2, max: 6 }),
  heroPos: oneOf(POSITIONS),
  pot: optional(unitAmount),
  heroHandConfidence: optional(unitInterval),
  gameMode: optional(oneOf(GAME_MODES)),
  raiseTo: optional(positiveAmount),
  raiseRange: optional(num({ finite: true, min: 1, max: 100 })),
  line: optional(rec(POSITIONS, oneOf(ACTION_CHARS))),
});

export interface ValidationResult {
  ok: boolean;
  issues: string[];
}

/**
 * 構造検証。失敗時は issues に「場所: 内容」の形でメッセージを詰める（例: `pot: expected a number`）。
 * 通ったときの value は、上で宣言した項目だけを写した新しいオブジェクト。
 */
export function parseBoardState(input: unknown): ValidationResult & { value?: BoardState } {
  return run(boardState, input);
}

/**
 * 構造検証を通過した盤面に対する意味論的検証。
 * empty 席は残り人数から除外して整合を確認する。
 */
export function checkBoardStateSemantics(state: BoardState): ValidationResult {
  const issues: string[] = [];

  if (!isValidPlayersLeft(state.playersLeft)) {
    issues.push(`playersLeft must be 2..6, got ${state.playersLeft}`);
  }

  const activeSeats = state.seats.filter((s) => s.state !== 'empty');

  if (activeSeats.length !== state.playersLeft) {
    issues.push(
      `active seats (${activeSeats.length}) must equal playersLeft (${state.playersLeft})`,
    );
  }

  const activePositions = activeSeats.map((s) => s.pos);
  const dup = activePositions.filter((p, i) => activePositions.indexOf(p) !== i);
  if (dup.length > 0) {
    issues.push(`duplicate positions among active seats: ${[...new Set(dup)].join(', ')}`);
  }

  if (
    isValidPlayersLeft(state.playersLeft) &&
    !positionsMatchPlayersLeft(activePositions, state.playersLeft)
  ) {
    issues.push(
      `active seat positions [${activePositions.join(', ')}] do not match the canonical set for ${state.playersLeft} players`,
    );
  }

  if (!activePositions.includes(state.heroPos)) {
    issues.push(`heroPos ${state.heroPos} is not among active seats`);
  }

  if (state.ante.scheme === 'none' && state.ante.amount !== 0) {
    issues.push(`ante.scheme is "none" but amount is ${state.ante.amount}`);
  }

  return { ok: issues.length === 0, issues };
}

/**
 * ポット・チェックサム（SPEC §6.3）: Σ(各席 bet) + アンティ寄与 ≒ pot。
 * アンティ寄与は scheme により決まる:
 *   all:  amount × アクティブ人数
 *   bb:   amount（総額）
 *   none: 0
 * 返り値は理論ポットと申告 pot の差の絶対値（pot 未指定なら null）。
 */
export function potChecksumDelta(state: BoardState): number | null {
  if (state.pot === undefined) return null;
  const activeSeats = state.seats.filter((s) => s.state !== 'empty');
  const betSum = activeSeats.reduce((acc, s) => acc + s.bet, 0);
  let anteContribution = 0;
  if (state.ante.scheme === 'all') anteContribution = state.ante.amount * activeSeats.length;
  else if (state.ante.scheme === 'bb') anteContribution = state.ante.amount;
  const theoretical = betSum + anteContribution;
  return Math.abs(theoretical - state.pot);
}
