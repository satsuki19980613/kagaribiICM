import { describe, it, expect } from 'vitest';
import { arr, bool, num, obj, oneOf, optional, rec, run, str } from '../src/validate.js';

describe('validate', () => {
  it('数値: NaN・無限大・範囲・整数を区別して落とす', () => {
    expect(run(num(), 1.5).ok).toBe(true);
    expect(run(num(), Number.NaN).issues).toEqual([': expected a number']);
    expect(run(num(), '1').ok).toBe(false);
    expect(run(num(), undefined).issues).toEqual([': required']);
    expect(run(num(), Infinity).ok).toBe(true);
    expect(run(num({ finite: true }), Infinity).ok).toBe(false);
    expect(run(num({ min: 0, max: 1 }), -Infinity).ok).toBe(false);
    expect(run(num({ min: 0, max: 1 }), 1).ok).toBe(true);
    expect(run(num({ min: 0, max: 1 }), 1.01).issues).toEqual([': must be <= 1']);
    expect(run(num({ above: 0 }), 0).issues).toEqual([': must be > 0']);
    expect(run(num({ int: true }), 2.5).ok).toBe(false);
    expect(run(num({ int: true }), Infinity).ok).toBe(false);
  });

  it('文字列・真偽値・決まった値', () => {
    expect(run(str(), 'a').value).toBe('a');
    expect(run(str(), 1).ok).toBe(false);
    expect(run(str((s) => s.length === 2, 'two chars'), 'abc').issues).toEqual([': two chars']);
    expect(run(bool(), false).value).toBe(false);
    expect(run(bool(), 0).ok).toBe(false);
    expect(run(oneOf(['a', 'b']), 'b').value).toBe('b');
    expect(run(oneOf(['a', 'b']), 'c').issues).toEqual([': expected one of: a, b']);
    expect(run(oneOf(['a', 'b']), ['a']).ok).toBe(false);
  });

  it('省略できる項目は undefined だけを「無い」と見なす（null は通さない）', () => {
    expect(run(optional(num()), undefined).ok).toBe(true);
    expect(run(optional(num()), null).ok).toBe(false);
  });

  it('オブジェクト: 宣言した項目だけを写し、問題は場所つきですべて集める', () => {
    const v = obj<{ a: number; b?: string; c: { d: number } }>({
      a: num(),
      b: optional(str()),
      c: obj<{ d: number }>({ d: num({ min: 0 }) }),
    });
    const input = { a: 1, c: { d: 2, extra: true }, extra: 'x' };
    const r = run(v, input);
    expect(r.value).toEqual({ a: 1, c: { d: 2 } });
    expect(r.value).not.toBe(input);
    expect(Object.keys(r.value!)).toEqual(['a', 'c']); // 省略された項目は足さない
    expect(run(v, { a: 'x', b: 1, c: { d: -1 } }).issues).toEqual([
      'a: expected a number',
      'b: expected a string',
      'c.d: must be >= 0',
    ]);
    expect(run(v, { a: 1 }).issues).toEqual(['c: required']);
    expect(run(v, null).ok).toBe(false);
    expect(run(v, [1]).ok).toBe(false);
  });

  it('配列: 要素数の範囲と、穴（要素の無い位置）も調べる', () => {
    const v = arr(num(), { min: 2, max: 3 });
    expect(run(v, [1, 2]).value).toEqual([1, 2]);
    expect(run(v, [1]).issues).toEqual([': must have at least 2 items']);
    expect(run(v, [1, 2, 3, 4]).ok).toBe(false);
    expect(run(v, { 0: 1, 1: 2, length: 2 }).ok).toBe(false);
    const holes: unknown[] = [1, 2, 3];
    delete holes[1];
    expect(run(v, holes).issues).toEqual(['1: required']);
  });

  it('名前 → 値の表: 通らない名前は報告して写さない', () => {
    const v = rec(['x', 'y'], num());
    expect(run(v, { x: 1 }).value).toEqual({ x: 1 });
    expect(run(v, { x: 1, z: 2 }).issues).toEqual(['z: invalid key']);
    expect(run(v, { x: 'a' }).issues).toEqual(['x: expected a number']);
    const byCheck = rec<string, number>((k) => k.startsWith('k'), num(), 'bad name');
    expect(run(byCheck, { k1: 1, k2: 2 }).value).toEqual({ k1: 1, k2: 2 });
    expect(run(byCheck, { a: 1 }).issues).toEqual(['a: bad name']);
  });

  it('__proto__ という名前の項目で、返す値や Object.prototype を書き換えない', () => {
    const hostile = JSON.parse('{"x": 1, "__proto__": {"polluted": true}}') as unknown;
    const r = run(rec(['x', 'y'], num()), hostile);
    expect(r.ok).toBe(false);
    expect(r.issues).toEqual(['__proto__: invalid key']);
    expect(({} as { polluted?: boolean }).polluted).toBeUndefined();

    const o = run(obj<{ x: number }>({ x: num() }), hostile);
    expect(o.value).toEqual({ x: 1 });
    expect(Object.getPrototypeOf(o.value)).toBe(Object.prototype);
    expect((o.value as { polluted?: boolean }).polluted).toBeUndefined();
  });
});
