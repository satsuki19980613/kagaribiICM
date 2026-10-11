/**
 * 入力の構造検証（外部ライブラリを使わない、小さな組み立て部品）。
 *
 * 検証器は「値・その場所・問題の一覧」を受け取り、問題があれば `場所: 内容` の形で一覧に足す。
 * 途中で止めず、見つかった問題をすべて集める。返す値は、**宣言した項目だけ**を写した新しい
 * オブジェクト（宣言に無い項目は捨てる）。問題が 1 件でもあれば、返した値は使わない（`run` が捨てる）。
 */

export type Validator<T> = (input: unknown, path: string, issues: string[]) => T;

const at = (path: string, key: string | number): string => (path === '' ? String(key) : `${path}.${key}`);

function fail(issues: string[], path: string, message: string): void {
  issues.push(`${path}: ${message}`);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export interface NumberRule {
  /** この値以上。 */
  readonly min?: number;
  /** この値以下。 */
  readonly max?: number;
  /** この値より大きい（等しいものは通さない）。 */
  readonly above?: number;
  /** 無限大を通さない。 */
  readonly finite?: boolean;
  /** 整数だけ通す。 */
  readonly int?: boolean;
}

/** 数値（NaN は数値として扱わない）。 */
export function num(rule: NumberRule = {}): Validator<number> {
  return (input, path, issues) => {
    if (typeof input !== 'number' || Number.isNaN(input)) {
      fail(issues, path, input === undefined ? 'required' : 'expected a number');
      return Number.NaN;
    }
    if (rule.finite && !Number.isFinite(input)) fail(issues, path, 'must be finite');
    if (rule.int && !Number.isInteger(input)) fail(issues, path, 'must be an integer');
    if (rule.min !== undefined && input < rule.min) fail(issues, path, `must be >= ${rule.min}`);
    if (rule.above !== undefined && input <= rule.above) fail(issues, path, `must be > ${rule.above}`);
    if (rule.max !== undefined && input > rule.max) fail(issues, path, `must be <= ${rule.max}`);
    return input;
  };
}

/** 文字列。`check` を渡すと、通らないものを `message` で落とす。 */
export function str(check?: (s: string) => boolean, message = 'invalid value'): Validator<string> {
  return (input, path, issues) => {
    if (typeof input !== 'string') {
      fail(issues, path, input === undefined ? 'required' : 'expected a string');
      return '';
    }
    if (check && !check(input)) fail(issues, path, message);
    return input;
  };
}

export function bool(): Validator<boolean> {
  return (input, path, issues) => {
    if (typeof input !== 'boolean') fail(issues, path, input === undefined ? 'required' : 'expected a boolean');
    return input === true;
  };
}

/** 決まった文字列のどれか。 */
export function oneOf<const T extends readonly string[]>(values: T): Validator<T[number]> {
  return (input, path, issues) => {
    if (typeof input !== 'string' || !values.includes(input)) {
      fail(issues, path, input === undefined ? 'required' : `expected one of: ${values.join(', ')}`);
    }
    return input as T[number];
  };
}

/** 無くてもよい項目（undefined だけを「無い」と見なす。null は通さない）。 */
export function optional<T>(inner: Validator<T>): Validator<T | undefined> {
  return (input, path, issues) => (input === undefined ? undefined : inner(input, path, issues));
}

/** オブジェクト。宣言した項目だけを検証して写す。 */
export function obj<T extends object>(shape: { readonly [K in keyof T]-?: Validator<T[K]> }): Validator<T> {
  const fields = Object.entries(shape) as [string, Validator<unknown>][];
  return (input, path, issues) => {
    const out: Record<string, unknown> = {};
    if (!isRecord(input)) {
      fail(issues, path, input === undefined ? 'required' : 'expected an object');
      return out as T;
    }
    for (const [key, field] of fields) {
      const value = field(input[key], at(path, key), issues);
      if (value !== undefined) out[key] = value;
    }
    return out as T;
  };
}

/** 配列。要素数の下限・上限を指定できる。 */
export function arr<T>(item: Validator<T>, size: { readonly min?: number; readonly max?: number } = {}): Validator<T[]> {
  return (input, path, issues) => {
    if (!Array.isArray(input)) {
      fail(issues, path, input === undefined ? 'required' : 'expected an array');
      return [];
    }
    if (size.min !== undefined && input.length < size.min) fail(issues, path, `must have at least ${size.min} items`);
    if (size.max !== undefined && input.length > size.max) fail(issues, path, `must have at most ${size.max} items`);
    // Array.from は穴（要素の無い位置）も undefined として回る。map は穴を飛ばしてしまう。
    return Array.from(input, (v: unknown, i) => item(v, at(path, i), issues));
  };
}

/**
 * 名前 → 値の表。名前は `key`（決まった名前の一覧か、判定関数）を通ったものだけ受け付ける。
 * 通らない名前は問題として報告し、**写さない**（`__proto__` のような名前を出力に書かないため）。
 */
export function rec<K extends string, V>(
  key: readonly K[] | ((k: string) => boolean),
  value: Validator<V>,
  keyMessage = 'invalid key',
): Validator<Partial<Record<K, V>>> {
  const keyOk = typeof key === 'function' ? key : (k: string) => (key as readonly string[]).includes(k);
  return (input, path, issues) => {
    const out: Partial<Record<K, V>> = {};
    if (!isRecord(input)) {
      fail(issues, path, input === undefined ? 'required' : 'expected an object');
      return out;
    }
    for (const k of Object.keys(input)) {
      if (!keyOk(k)) {
        fail(issues, at(path, k), keyMessage);
        continue;
      }
      out[k as K] = value(input[k], at(path, k), issues);
    }
    return out;
  };
}

export interface Parsed<T> {
  ok: boolean;
  issues: string[];
  value?: T;
}

/** 検証を走らせる。問題があれば値は返さない。 */
export function run<T>(validator: Validator<T>, input: unknown): Parsed<T> {
  const issues: string[] = [];
  const value = validator(input, '', issues);
  return issues.length > 0 ? { ok: false, issues } : { ok: true, issues, value };
}
