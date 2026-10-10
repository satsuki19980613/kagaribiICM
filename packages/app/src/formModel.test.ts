import { describe, it, expect } from 'vitest';
import { buildBoardState, defaultForm, lineText, toggleAllin } from './formModel';
import { boardStateToForm } from './ocrPrefill';

describe('手入力のミニレイズ', () => {
  it('レイズした人を選ぶと raiseTo と line（その人より前と hero までは FOLD）が入る', () => {
    const f = { ...defaultForm(6), heroPos: 'BU' as const, raiser: 'HJ' as const, raiseTo: '2' };
    const r = buildBoardState(f);
    expect(r.ok).toBe(true);
    expect(r.state!.raiseTo).toBe(2);
    expect(r.state!.line).toEqual({ UTG: 'F', HJ: 'R', CO: 'F' });
  });

  it('HERO より後ろの人・3bb を超えるレイズは弾く', () => {
    expect(buildBoardState({ ...defaultForm(6), heroPos: 'CO', raiser: 'BU', raiseTo: '2' }).ok).toBe(false);
    expect(buildBoardState({ ...defaultForm(6), heroPos: 'BU', raiser: 'UTG', raiseTo: '4' }).ok).toBe(false);
  });

  it('レイズなしなら従来どおり（raiseTo も line も無い）', () => {
    const r = buildBoardState(defaultForm(4));
    expect(r.state!.raiseTo).toBeUndefined();
    expect(r.state!.line).toBeUndefined();
  });

  it('スクショの line は form を往復しても残る', () => {
    const f = { ...defaultForm(4), heroPos: 'CO' as const, raiser: 'CO' as const, raiseTo: '2', line: { CO: 'R', BU: 'F', SB: 'P', BB: 'F' } as const };
    const st = buildBoardState(f).state!;
    expect(st.line).toEqual({ CO: 'R', BU: 'F', SB: 'P', BB: 'F' });
    const back = boardStateToForm(st);
    expect(back.raiser).toBe('CO');
    expect(back.line).toEqual(st.line);
    expect(lineText(['CO', 'BU', 'SB', 'BB'], st.line!)).toBe('CO RAISE → SB ALL IN');
  });

  it('レイズの無い局面でも、スクショの「前の人のオールイン」は残る（hero より後ろの席が混じっていたら捨てる）', () => {
    const f = { ...defaultForm(4), heroPos: 'SB' as const, line: { CO: 'F', BU: 'P' } as const };
    const st = buildBoardState(f).state!;
    expect(st.raiseTo).toBeUndefined();
    expect(st.line).toEqual({ CO: 'F', BU: 'P' });
    expect(boardStateToForm(st).line).toEqual({ CO: 'F', BU: 'P' });
    const bad = buildBoardState({ ...defaultForm(4), heroPos: 'BU' as const, line: { CO: 'F', BU: 'P' } as const });
    expect(bad.ok).toBe(true);
    expect(bad.state!.line).toBeUndefined();
  });

  it('レイズレンジの仮定（上位 N%）は、レイズした人がいるときだけ state に入る', () => {
    const f = { ...defaultForm(6), heroPos: 'BU' as const, raiser: 'UTG' as const, raiseTo: '2', raiseRange: '20' };
    expect(buildBoardState(f).state!.raiseRange).toBe(20);
    expect(buildBoardState({ ...f, raiseRange: '' }).state!.raiseRange).toBeUndefined();
    expect(buildBoardState({ ...f, raiser: '' as const }).state!.raiseRange).toBeUndefined();
  });
});

describe('手入力の「前の人のオールイン」', () => {
  const base = { ...defaultForm(6), heroPos: 'SB' as const };

  it('押すとオールイン、もう一度押すと戻る。最初が P、2 人目からは C', () => {
    const l1 = toggleAllin(base, 'HJ');
    expect(l1).toEqual({ UTG: 'F', HJ: 'P', CO: 'F', BU: 'F' });
    const l2 = toggleAllin({ ...base, line: l1 }, 'BU');
    expect(l2).toEqual({ UTG: 'F', HJ: 'P', CO: 'F', BU: 'C' });
    // 先にいた人を外すと、残った人が最初のオールインになる。
    expect(toggleAllin({ ...base, line: l2 }, 'HJ')).toEqual({ UTG: 'F', HJ: 'F', CO: 'F', BU: 'P' });
    // 全員外すと line は無くなる（AOF の未開の場面）。
    expect(toggleAllin({ ...base, line: l1 }, 'HJ')).toBeUndefined();
    const st = buildBoardState({ ...base, line: l2 }).state!;
    expect(st.line).toEqual(l2);
    expect(st.raiseTo).toBeUndefined();
  });

  it('HERO 以降の席と、レイズした人より前の席は切り替えられない', () => {
    expect(toggleAllin(base, 'SB')).toBeUndefined();
    expect(toggleAllin(base, 'BB')).toBeUndefined();
    const raised = { ...base, raiser: 'HJ' as const, raiseTo: '2' };
    expect(toggleAllin(raised, 'UTG')).toBeUndefined();
    expect(toggleAllin(raised, 'HJ')).toBeUndefined();
    // レイズした人より後ろはオールインで返せる。
    const l = toggleAllin(raised, 'BU');
    expect(l).toEqual({ UTG: 'F', HJ: 'R', CO: 'F', BU: 'P' });
    const st = buildBoardState({ ...raised, line: l }).state!;
    expect(st.raiseTo).toBe(2);
    expect(st.line).toEqual(l);
    // オールインを外しても、レイズした人は残る。
    expect(toggleAllin({ ...raised, line: l }, 'BU')).toEqual({ UTG: 'F', HJ: 'R', CO: 'F', BU: 'F' });
  });
});
