/**
 * 手入力フォームの状態モデルと BoardState 組み立て・検証（Phase 3-1b）。
 * フォームは push/fold の「開始状態」（全席 live・ブラインド投函済み・未開）を捉える。
 * 上流アクション（誰が push/fold したか）は結果画面のノード選択で扱う（solver は全木を解く）。
 */

import type { ActionChar, BoardState, GameMode, Position } from '@kagaribi/core';
import {
  positionsForPlayersLeft,
  parseBoardState,
  checkBoardStateSemantics,
  potChecksumDelta,
  parseHandClass,
} from '@kagaribi/core';

export type AnteScheme = 'all' | 'bb' | 'none';

const ACTION_TEXT: Record<string, string> = { R: 'RAISE', P: 'ALL IN', C: 'CALL', F: 'FOLD' };

/** line（席 → アクション）を「UTG RAISE → HJ ALL IN」の形に。フォールドは省く。 */
export function lineText(order: readonly string[], line: Partial<Record<string, string>>): string {
  const parts = order.filter((p) => line[p] && line[p] !== 'F').map((p) => `${p} ${ACTION_TEXT[line[p]!] ?? line[p]}`);
  return parts.join(' → ') || 'なし';
}

export interface BoardForm {
  playersLeft: number;
  sb: string;
  bb: string;
  anteScheme: AnteScheme;
  anteAmount: string;
  heroPos: Position;
  heroHand: string;
  /** ポジション → スタック（bb, 画面表示＝ベット差引後）の入力文字列。 */
  stacks: Partial<Record<Position, string>>;
  /** どのゲームモードか（プライズ表が決まる）。UI のゲーム選択ボタンが唯一の根拠。 */
  gameMode: GameMode;
  /**
   * 最初に参加してレイズした人（ミニレイズ・ゲーム）。空なら AOF。手入力では hero より前の席を選ぶ
   * （その人より前と、その人から hero までの席はフォールドした扱い）。
   */
  raiser?: Position | '';
  /** レイズ額（BB, 総ベット額）の入力文字列。既定 "2"。 */
  raiseTo?: string;
  /** レイズした人のレンジの仮定（"10"=上位 10% など）。空ならソルバーが決める。 */
  raiseRange?: string;
  /**
   * スクショから読んだ hero の判断までのアクション。raiser を手で変えたら破棄する
   * （そのときは raiser 以外を全員フォールドとして組み立て直す）。
   */
  line?: Partial<Record<Position, ActionChar>>;
}

/**
 * 指定人数の既定フォーム（等スタック 15bb, blinds 0.5/1, **全員アンティ 0.25**）。
 * アンティ all 0.25 はこのゲームの標準であり、事前計算テーブル（HU/3人/4人）と同条件。
 * 呼び出し側（App.tsx）の既定人数は 4 人のまま据え置く（さつき決定）。5〜6 人は
 * 手入力で人数を切り替えれば直接求解の対象になる。
 */
export function defaultForm(playersLeft = 4, gameMode: GameMode = 'club'): BoardForm {
  const positions = positionsForPlayersLeft(playersLeft);
  const stacks: Partial<Record<Position, string>> = {};
  for (const p of positions) stacks[p] = '15';
  return {
    playersLeft,
    sb: '0.5',
    bb: '1',
    anteScheme: 'all',
    anteAmount: '0.25',
    heroPos: positions[0]!,
    heroHand: 'A5s',
    stacks,
    gameMode,
  };
}

/** レイズした人のレンジの仮定（上位 N%）の選択肢。 */
export const RAISE_RANGE_PRESETS = [10, 15, 20, 30] as const;

/**
 * 手入力: hero より前の席 pos の「オールインした／していない」を切り替えた line を返す。
 * 最初のオールインが 'P'、それ以降は 'C'（コール）、レイズした人は 'R'、ほかは 'F'。レイズした人より前の席と
 * レイズした人自身は切り替えられない（レイズは最初に参加した人だけ）。誰も参加していなければ undefined。
 */
export function toggleAllin(form: BoardForm, pos: Position): Partial<Record<Position, ActionChar>> | undefined {
  const order = positionsForPlayersLeft(form.playersLeft);
  const hi = order.indexOf(form.heroPos);
  const raiser = form.raiser || '';
  const ri = raiser ? order.indexOf(raiser) : -1;
  const pi = order.indexOf(pos);
  const cur = form.line ?? {};
  // hero がレイズした本人の line（スクショ由来・全員分）は手では組み替えない。
  if (cur[form.heroPos] === 'R') return form.line;
  if (pi < 0 || pi >= hi || pi <= ri) return form.line;
  const allin = new Set(order.slice(0, hi).filter((p) => cur[p] === 'P' || cur[p] === 'C'));
  if (allin.has(pos)) allin.delete(pos);
  else allin.add(pos);
  if (allin.size === 0 && !raiser) return undefined;
  const line: Partial<Record<Position, ActionChar>> = {};
  let first = true;
  for (const p of order.slice(0, hi)) {
    if (p === raiser) line[p] = 'R';
    else if (allin.has(p)) {
      line[p] = first ? 'P' : 'C';
      first = false;
    } else line[p] = 'F';
  }
  return line;
}

/** 人数変更時: ポジション集合に合わせて stacks/heroPos を整える（既存値は保持）。 */
export function reconcilePositions(form: BoardForm): BoardForm {
  const positions = positionsForPlayersLeft(form.playersLeft);
  const stacks: Partial<Record<Position, string>> = {};
  for (const p of positions) stacks[p] = form.stacks[p] ?? '15';
  const heroPos = positions.includes(form.heroPos) ? form.heroPos : positions[0]!;
  // 人数が変わると席の並びが変わるので、スクショから読んだアクションは捨てる。レイズした人は、
  // 新しい並びでも hero より前にいるときだけ残す。
  const raiser = form.raiser && positions.indexOf(form.raiser) >= 0 && positions.indexOf(form.raiser) < positions.indexOf(heroPos) ? form.raiser : '';
  return { ...form, stacks, heroPos, line: undefined, raiser };
}

function num(s: string): number {
  return Number((s ?? '').trim());
}

export interface BuildResult {
  ok: boolean;
  state?: BoardState;
  issues: string[];
  /** ポット検算の差（|delta|）。null は pot 未算出。 */
  potDelta: number | null;
}

/** フォーム → BoardState 組み立て + zod/意味論/ハンド/ポット検算。 */
export function buildBoardState(form: BoardForm): BuildResult {
  const issues: string[] = [];
  const sb = num(form.sb);
  const bb = num(form.bb);
  const anteAmount = form.anteScheme === 'none' ? 0 : num(form.anteAmount);

  if (!Number.isFinite(sb) || sb <= 0) issues.push('SB は正の数で入力してください');
  if (!Number.isFinite(bb) || bb <= 0) issues.push('BB は正の数で入力してください');
  if (Number.isFinite(sb) && Number.isFinite(bb) && sb >= bb) issues.push('SB は BB より小さくしてください');
  if (form.anteScheme !== 'none' && (!Number.isFinite(anteAmount) || anteAmount < 0)) {
    issues.push('アンティ額は 0 以上で入力してください');
  }
  if (!parseHandClass(form.heroHand)) issues.push(`hero ハンド "${form.heroHand}" が不正です`);

  const positions = positionsForPlayersLeft(form.playersLeft);
  const seats = positions.map((pos) => {
    const stack = num(form.stacks[pos] ?? '');
    if (!Number.isFinite(stack) || stack <= 0) issues.push(`${pos} のスタックを正の数で入力してください`);
    const bet = pos === 'SB' ? sb : pos === 'BB' ? bb : 0;
    return { pos, stack, state: 'live' as const, bet };
  });

  const ante =
    form.anteScheme === 'none'
      ? { scheme: 'none' as const, amount: 0 }
      : { scheme: form.anteScheme, amount: anteAmount };

  const anteContribution = ante.scheme === 'all' ? ante.amount * seats.length : ante.scheme === 'bb' ? ante.amount : 0;
  const potBets = seats.reduce((a, s) => a + s.bet, 0);

  const candidate = {
    street: 'preflop',
    blinds: { sb, bb },
    ante,
    heroHand: form.heroHand,
    playersLeft: form.playersLeft,
    seats,
    heroPos: form.heroPos,
    pot: potBets + anteContribution,
    gameMode: form.gameMode,
  };

  // ミニレイズ・ゲーム（最初の参加者のレイズ）。
  const raiser = form.raiser || '';
  let raiseFields: { raiseTo?: number; raiseRange?: number; line?: Partial<Record<Position, ActionChar>> } = {};
  if (raiser) {
    const raiseTo = num(form.raiseTo ?? '2');
    const order = positions;
    const ri = order.indexOf(raiser);
    const hi = order.indexOf(form.heroPos);
    const line = form.line ?? Object.fromEntries(order.slice(0, hi).map((p) => [p, p === raiser ? 'R' : 'F']));
    const heroResponds = line[form.heroPos] === 'R';
    if (ri < 0) issues.push(`レイズした人 ${raiser} がこの人数の卓にいません`);
    else if (!heroResponds && ri >= hi) issues.push('レイズした人は HERO より前の席を選んでください');
    const rs = seats[ri];
    if (!Number.isFinite(raiseTo) || raiseTo <= bb || raiseTo > 3.05) {
      issues.push('レイズ額は BB より大きく 3bb 以下で入力してください');
    } else if (rs && rs.stack + rs.bet <= raiseTo) {
      issues.push(`${raiser} のスタックではレイズ ${raiseTo}bb がオールインになります（オールインとして扱ってください）`);
    }
    const rr = num(form.raiseRange ?? '');
    const assumed = form.raiseRange && Number.isFinite(rr) && rr >= 1 && rr <= 100 ? { raiseRange: rr } : {};
    raiseFields = { raiseTo, line, ...assumed };
  }

  // レイズの無い局面でも、スクショから読んだ「前の人のオールイン」は残す（結果画面の見出しに使う）。
  // hero より前の席の F / P / C だけを通す（hero や人数を変えたら InputForm が line を捨てる）。
  if (!raiser && form.line) {
    const hi = positions.indexOf(form.heroPos);
    const before = positions.slice(0, hi);
    const ok = Object.entries(form.line).every(([p, a]) => before.includes(p as Position) && (a === 'F' || a === 'P' || a === 'C'));
    if (ok && Object.values(form.line).some((a) => a === 'P')) raiseFields = { line: form.line };
  }

  const parsed = parseBoardState({ ...candidate, ...raiseFields });
  if (!parsed.ok) {
    return { ok: false, issues: [...issues, ...parsed.issues], potDelta: null };
  }
  const sem = checkBoardStateSemantics(parsed.value!);
  const potDelta = potChecksumDelta(parsed.value!);
  const all = [...issues, ...sem.issues];
  return { ok: all.length === 0, state: all.length === 0 ? parsed.value : undefined, issues: all, potDelta };
}
