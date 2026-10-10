import { describe, it, expect } from 'vitest';
import { buildBoardState, defaultForm, lineText } from './formModel';
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
});
