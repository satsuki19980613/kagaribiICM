/**
 * 解の構造（IMPLEMENTATION_PLAN §3.2）。Solver の出力 / App の入力。
 * 数値は EV / equity ともに実払い pt 建て（SPEC §2.2）。
 */

import { POSITIONS, type Position } from './positions.js';
import { isCanonicalKey } from './key.js';
import { isHandClass } from './cards.js';
import { arr, bool, num, obj, oneOf, rec, run, str, type Validator } from './validate.js';

export const ACTION_TYPES = ['PU', 'CA', 'OC'] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export interface NodeEquity {
  pre: number;
  post: number;
}

export interface Quality {
  exploitability: number;
  converged: boolean;
  iterations: number;
}

export interface SolutionNode {
  key: string;
  actor: Position;
  actionType: ActionType;
  pct: number;
  range: string;
  hands: string[];
  freq: Record<string, number>;
  ev: Record<string, number>;
  equity: Partial<Record<Position, NodeEquity>>;
  quality: Quality;
}

const HAND_KEY_MESSAGE = 'invalid hand-class key';
const finite = num({ finite: true });
/** ハンドの表記 → 値の表。 */
const byHand = (value: Validator<number>): Validator<Record<string, number>> =>
  rec<string, number>(isHandClass, value, HAND_KEY_MESSAGE) as Validator<Record<string, number>>;

const solutionNode: Validator<SolutionNode> = obj<SolutionNode>({
  key: str(isCanonicalKey, 'key is not in canonical form'),
  actor: oneOf(POSITIONS),
  actionType: oneOf(ACTION_TYPES),
  pct: num({ min: 0, max: 100 }),
  range: str(),
  hands: arr(str(isHandClass, HAND_KEY_MESSAGE)),
  freq: byHand(num({ min: 0, max: 1 })),
  ev: byHand(finite),
  equity: rec(POSITIONS, obj<NodeEquity>({ pre: finite, post: finite })),
  quality: obj<Quality>({
    exploitability: num({ finite: true, min: 0 }),
    converged: bool(),
    iterations: num({ int: true, min: 0 }),
  }),
});

export function parseSolutionNode(
  input: unknown,
): { ok: boolean; issues: string[]; value?: SolutionNode } {
  return run(solutionNode, input);
}
