/**
 * 画面の実ベット → root push/fold spot への復元（Plan 2-6 / SPEC §6.4-6.5）。
 *
 * solver は「全席 live・ブラインド投函済み・未開」の root を全木で解く
 * （nwaySolver: T = stack + bet + antePaid、state !== 'empty' の席のみ対象）。
 * 誰が既にフォールド/シューブしたかは結果画面のノード選択で扱う。したがって
 * OCR は画面の途中状態から root を逆算する:
 *
 *   fullBehind_i = screenStack_i + putIn_i          （ante は solver が別途加算）
 *   putIn_i      = folded ? 席のブラインド義務 : screenBet_i
 *   rootStack_i  = fullBehind_i - blindOb_i
 *   rootBet_i    = blindOb_i          （SB=sb, BB=bb, それ以外 0）
 *
 * これにより、シューブ済み席（screenStack=0, screenBet=全額）もフォールド済み席も
 * 「配られた時点の持ち込み」に戻り、solver が root から解ける。
 *
 * push/fold Nash はフォールドとオールインしか持たない。よって非オールインの
 * 自発的コミット（リンプ・3bet 等）を検出したら対象外エラーとする（§6.5）。
 * 例外は「最初に参加した 1 人のレイズ（3BB まで）」で、これはミニレイズ・ゲーム
 * （solver の solveRaiseGame・さつき決定 2026-10-09）として解く。そのとき state に
 * raiseTo（レイズ額）と line（hero の判断までのアクション）を載せる。
 */

/** 扱えるレイズ額の上限（BB）。最初の人のミニレイズ〜3BB オープンまで。 */
export const MAX_RAISE_TO = 3.05;

const orderIdx = (pos: Position): number => POSITIONS.indexOf(pos);

/** 行動順（UTG→BB）に並べ替えた facts。 */
function inActionOrder(facts: readonly SeatFacts[]): SeatFacts[] {
  return [...facts].sort((a, b) => orderIdx(a.pos) - orderIdx(b.pos));
}

/**
 * 画面に「最初の参加者のレイズ」があればその情報を返す（対象外判定は detectOutOfScope）。
 * line は hero の判断までのアクション（hero がレイズした本人なら全員分＋hero='R'）。
 */
export function raiseLine(
  facts: readonly SeatFacts[],
  heroPos: Position,
): { raiseTo: number; line: Partial<Record<Position, ActionChar>> } | null {
  const ordered = inActionOrder(facts);
  const r = ordered.find((f) => f.action === 'raise');
  if (!r) return null;
  const heroIsRaiser = r.pos === heroPos;
  const heroAt = orderIdx(heroPos);
  const line: Partial<Record<Position, ActionChar>> = {};
  let sawAllin = false;
  for (const f of ordered) {
    if (!heroIsRaiser && orderIdx(f.pos) >= heroAt) break;
    if (f.pos === r.pos) line[f.pos] = 'R';
    else if (f.action === 'allin' || f.action === 'call') {
      line[f.pos] = sawAllin ? 'C' : 'P';
      sawAllin = true;
    } else line[f.pos] = 'F';
  }
  return { raiseTo: Math.round(r.screenBet * 20) / 20, line };
}

/**
 * レイズの無い（AOF の）画面で、hero より前の席のアクション（オールイン＝'P'、それへのコール＝'C'、
 * それ以外＝'F'）。誰も参加していなければ null（hero の未開ノードがそのまま見出しになる）。
 * 結果画面が「前の人のオールインに対する判断」を最初から表示するために使う。
 */
export function allinLine(facts: readonly SeatFacts[], heroPos: Position): Partial<Record<Position, ActionChar>> | null {
  const heroAt = orderIdx(heroPos);
  const line: Partial<Record<Position, ActionChar>> = {};
  let sawAllin = false;
  for (const f of inActionOrder(facts)) {
    if (orderIdx(f.pos) >= heroAt) break;
    if (f.action === 'allin' || f.action === 'call') {
      line[f.pos] = sawAllin ? 'C' : 'P';
      sawAllin = true;
    } else line[f.pos] = 'F';
  }
  return sawAllin ? line : null;
}

import { POSITIONS, type ActionChar, type BoardState, type Position, type Seat } from '@kagaribi/core';
import type { PhysicalSeat, RawReads, RawSeatRead, SeatAction } from './types.js';
import { derivePositions } from './positionDerivation.js';

const EPS = 1e-6;

function blindObligation(pos: Position, sb: number, bb: number): number {
  if (pos === 'SB') return sb;
  if (pos === 'BB') return bb;
  return 0;
}

/** 対象外検出（§6.5）。1 席ぶんの正規化事実。 */
export interface SeatFacts {
  /** 物理席 id（RawSeatRead との対応用）。 */
  readonly id: string;
  readonly pos: Position;
  readonly isHero: boolean;
  /** リプレイの行動ラベル（状態復元の主信号）。 */
  readonly action: SeatAction;
  readonly folded: boolean;
  readonly allin: boolean;
  readonly screenStack: number;
  readonly screenBet: number;
  readonly blindOb: number;
}

/**
 * push/fold で扱えない盤面を検出する（§6.5）。**行動ラベル駆動**。
 *
 * push/fold Nash はフォールドとオールインのみ。有効な終了フレームのラベルは
 *   fold / allin / call（ただしオールインが場にある場合のみ）/ check（BB のみ）
 * に限られる。
 * - raise（非オールインのオープン/ミニレイズ/3bet）→ 対象外
 * - call だがオールインが場に無い → リンプ（BB コール）や非オールインへのコール → 対象外
 * - hero が BB でオールイン・レイズ・リンプのいずれも無い → ウォーク（no decision）
 *
 * ベット額はラベルと矛盾する場合の補助チェックに使う（ラベルが主）。
 */
export function detectOutOfScope(
  facts: readonly SeatFacts[],
  heroPos: Position,
  ctx: { readonly potBlindsOnly?: boolean } = {},
): string[] {
  const issues: string[] = [];
  const anyAllin = facts.some((f) => f.action === 'allin');
  const ordered = inActionOrder(facts);
  const raises = ordered.filter((f) => f.action === 'raise');

  // 最初の参加者のレイズ 1 回だけはミニレイズ・ゲームとして扱える。
  const firstRaise = raises.length === 1 ? raises[0]! : null;
  if (raises.length > 1) {
    for (const f of raises.slice(1)) issues.push(`${f.pos} がレイズ（非オールイン）しています（2 回目のレイズ・3bet は扱えません）`);
  }
  if (firstRaise) {
    const before = ordered.filter((f) => orderIdx(f.pos) < orderIdx(firstRaise.pos));
    if (before.some((f) => f.action === 'allin' || f.action === 'call' || f.action === 'raise')) {
      issues.push(`${firstRaise.pos} がレイズ（非オールイン）しています（ほかの人が参加した後のレイズは扱えません）`);
    } else if (!(firstRaise.screenBet > 1 + EPS && firstRaise.screenBet <= MAX_RAISE_TO)) {
      issues.push(
        `${firstRaise.pos} がレイズ（非オールイン）${firstRaise.screenBet.toFixed(1)}bb しています（扱えるのは最初の人の 3bb までのレイズです）`,
      );
    }
    // レイズへのフラットコール（オールインでないコール）はゲームに無い。
    let allinSeen = false;
    for (const f of ordered) {
      if (f.action === 'allin') allinSeen = true;
      if (f.action === 'call' && !allinSeen) {
        issues.push(`${f.pos} がコール（リンプ/非オールインへのコール）しています（レイズへのコールは扱えません）`);
      }
    }
    // hero はレイズした人より後ろの席か、レイズした本人でなければならない（前の席はもう行動済み）。
    const hero = ordered.find((f) => f.isHero);
    if (hero && orderIdx(hero.pos) < orderIdx(firstRaise.pos)) {
      issues.push(`${firstRaise.pos} のレイズより前の席（自分）の判断は扱えません（行動マークの読み違いかもしれません）`);
    }
    // hero がレイズした本人なら、オールインを受けてもう一度判断する場面でなければならない。
    if (firstRaise.isHero && !ordered.some((f) => f.action === 'allin')) {
      issues.push('自分のレイズの後にオールインが入っていません（判断が残っていない画面です）');
    }
  }

  for (const f of facts) {
    if (f.action === 'raise') {
      // 上で判定済み（レイズはミニレイズ・ゲームの条件を満たせば対象内）。
    } else if (f.action === 'call' && !anyAllin && !firstRaise) {
      issues.push(`${f.pos} がコール（リンプ/非オールインへのコール）しています（push/fold では扱えません）`);
    } else if (f.action === 'none' && !f.folded) {
      // ラベルが無いのにベットが blind を超える＝読み落とし or 非対応アクション
      // ただしポットが「アンティ＋ブラインドだけ」と一致するなら、ブラインド以外のチップは場に無い
      // ＝このベット読みが誤読（potShowsBlindsOnly）。root はブラインド額で復元するので弾かない。
      const voluntary = f.screenBet - f.blindOb;
      if (voluntary > EPS && !ctx.potBlindsOnly) {
        issues.push(`${f.pos} に未分類のベット ${voluntary.toFixed(2)}bb があります（要手入力確認）`);
      }
    }
  }

  const contested = facts.some((f) => !f.isHero && (f.action === 'allin' || f.action === 'raise' || f.action === 'call'));
  if (heroPos === 'BB' && !contested) {
    issues.push('hero が BB で pot が未レイズです（ウォーク＝判断が存在しないため対象外）');
  }

  return issues;
}

/**
 * 読んだポットが「アンティ＋SB＋BB」だけと一致するか（＝ブラインド以外に誰もチップを出していない）。
 *
 * ポットは中央の大きな表示で安定して読めるので、席前の小さなベット表示より信頼できる。一致するなら、
 * 行動マークの無い席のベット読みがブラインドを超えていても誤読と判断できる（さつき指摘 2026-10-08。
 * 実測: ピンク系の卓で SB の「0.5 BB」を 5 と読んだが、ポット 2.8 = 5 人 × 0.25 + 0.5 + 1 で超過は無い）。
 * ポットは 0.1 BB 単位の表示なので、丸めとアンティの微変動（例 170/660）を人数に応じて許す。
 */
export function potShowsBlindsOnly(
  pot: number,
  players: number,
  ante: RawReads['ante'],
  sb: number,
  bb: number,
): boolean {
  if (!Number.isFinite(pot) || pot <= 0) return false;
  const a = ante.scheme === 'none' ? 0 : ante.amount.value;
  if (!Number.isFinite(a) || !Number.isFinite(sb) || !Number.isFinite(bb)) return false;
  const anteTotal = ante.scheme === 'all' ? players * a : a; // 'bb' は BB だけが払う
  return Math.abs(pot - (anteTotal + sb + bb)) <= 0.06 + 0.02 * players;
}

export interface ReconstructResult {
  readonly ok: boolean;
  readonly issues: string[];
  /** 成功時の root spot（solver 入力）。 */
  readonly state?: BoardState;
  /** 表示用の実プレゼンス（条件確認画面のため）。key は pos。 */
  readonly facts?: ReadonlyMap<Position, SeatFacts>;
}

/**
 * RawReads → root BoardState 復元 ＋ 対象外検出。
 * 構造検証は呼び出し側（pipeline / core.parseBoardState）で行う。
 */
export function reconstructSpot(
  reads: RawReads,
  /** potRead: 画面から読んだポット（総チップ保存チェックで計算値に置き換える前の値）。既定は reads.pot。 */
  opts: { readonly potRead?: number } = {},
): ReconstructResult {
  const issues: string[] = [];
  const sb = reads.blinds.sb.value;
  const bb = reads.blinds.bb.value;

  const ring: PhysicalSeat[] = reads.seats.map((s) => ({
    id: s.id,
    occupied: s.occupancy.value !== 'empty',
    isButton: s.isButton,
    isHero: s.isHero,
  }));

  const derived = derivePositions(ring);
  if (!derived.ok) return { ok: false, issues: derived.issues };

  const bySeatId = new Map<string, RawSeatRead>(reads.seats.map((s) => [s.id, s]));

  const facts: SeatFacts[] = [];
  const rootSeats: Seat[] = [];
  for (const [id, pos] of derived.byId) {
    const raw = bySeatId.get(id)!;
    const action: SeatAction = raw.action.value;
    const folded = action === 'fold';
    const allin = action === 'allin';
    const screenStack = raw.stack.value;
    const screenBet = raw.bet.value;
    const blindOb = blindObligation(pos, sb, bb);

    facts.push({ id, pos, isHero: raw.isHero, action, folded, allin, screenStack, screenBet, blindOb });

    // root への逆算に使う「この席が場に出したチップ」。
    //  - レイズ/コール/オールインの席: 読んだチップ額（オールイン額など）。
    //  - それ以外（未行動・フォールド）: 席のブラインド義務そのもの（SB 0.5 / BB 1 / 他 0）。
    //    行動マークが無い席が場に置けるのはブラインドだけなので、チップを読む必要がない
    //    （さつき指摘 2026-09-11）。読んだ額を使うと、チップ 1 枚の読み漏らしがそのまま
    //    スタックのずれになる（実測: Pixel 実機フレームで BB の 1 BB を読み漏らし、BB のスタックが
    //    1 少なく復元された）。読んだ額は facts.screenBet に残し、ブラインドを超えるチップ
    //    （＝マークの読み落とし）の検出（detectOutOfScope）にはそちらを使う。
    const voluntary = action === 'allin' || action === 'call' || action === 'raise';
    const putIn = voluntary ? screenBet : blindOb;
    // 占有は検出できたがスタック数字が読めない席（seatPresence のみで occupied）: root 復元に
    // 使える数値が無い。ここで席を落とすと 6-max が 5-max として黙って誤解される（本バグ）。
    // 代わりに 0 を仮置きして席を残し（人数は正しい）、raw.stack.conf(=0) 由来で
    // lowConfidenceFields に `${pos}.stack` が載る（確認画面で手入力）。構造検証は finite/nonnegative を
    // 要求するので NaN は渡せない。※solver へは仮値 0 が入るため確認画面での修正が前提（§6.1 プリフィル）。
    const stackFinite = Number.isFinite(screenStack);
    const fullBehind = (stackFinite ? screenStack : 0) + putIn;
    const rootStack = stackFinite ? fullBehind - blindOb : Math.max(0, fullBehind - blindOb);

    rootSeats.push({
      pos,
      stack: rootStack,
      bet: blindOb,
      state: 'live',
      confidence: {
        stack: raw.stack.conf,
        bet: raw.bet.conf,
        state: Math.min(raw.occupancy.conf, raw.action.conf),
      },
    });
  }

  const potBlindsOnly = potShowsBlindsOnly(opts.potRead ?? reads.pot.value, derived.playersLeft, reads.ante, sb, bb);
  issues.push(...detectOutOfScope(facts, derived.heroPos, { potBlindsOnly }));
  // 対象外で棄却するときも facts を返す。ポジション導出自体は成功しているので、
  // 「元画像とOCR結果」の照合ビュー（SPEC §5.2.3）が席 ID ではなくポジションで並べられる。
  if (issues.length > 0) {
    return { ok: false, issues, facts: new Map<Position, SeatFacts>(facts.map((f) => [f.pos, f])) };
  }

  const anteAmount = reads.ante.scheme === 'none' ? 0 : reads.ante.amount.value;

  const state: BoardState = {
    street: 'preflop',
    blinds: { sb, bb },
    ante: { scheme: reads.ante.scheme, amount: anteAmount },
    heroHand: reads.heroHand.value,
    playersLeft: derived.playersLeft,
    seats: rootSeats,
    heroPos: derived.heroPos,
    // pot は画面の実読み取り値を保持（solver は pot を使わない）。root の理論ベット和とは
    // 別物なので、チェックサム（confidence.ts）で screen 値どうしを突き合わせる。
    pot: reads.pot.value,
    heroHandConfidence: reads.heroHand.conf,
  };

  const raised = raiseLine(facts, derived.heroPos);
  const pushed = raised ? null : allinLine(facts, derived.heroPos);
  const solveState: BoardState = raised
    ? { ...state, raiseTo: raised.raiseTo, line: raised.line }
    : pushed
      ? { ...state, line: pushed }
      : state;

  const factsMap = new Map<Position, SeatFacts>(facts.map((f) => [f.pos, f]));
  return { ok: true, issues: [], state: solveState, facts: factsMap };
}
