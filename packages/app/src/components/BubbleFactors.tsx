import { formatBbDisplay, type BoardState } from '@kagaribi/core';
import { useMemo, useState } from 'react';
import { breakEvenEquity, bubbleFactorTable } from '../bubbleFactor';

/** BF 1.0（圧力なし）→ 0、3.5 以上 → 1。セルの色の濃さ。 */
const heat = (bf: number): number => Math.max(0, Math.min(1, (bf - 1) / 2.5));
const heatBg = (bf: number): string => `color-mix(in srgb, var(--cpu) ${Math.round(heat(bf) * 72)}%, transparent)`;

/**
 * 結果画面のバブルファクター表。行＝勝負する本人、列＝相手。セルを押すと上の説明が切り替わる。
 * 初期表示は HERO の行で、いちばん重い相手。
 */
export function BubbleFactors(props: { state: BoardState; heroPos: string }): JSX.Element | null {
  const table = useMemo(() => bubbleFactorTable(props.state), [props.state]);
  const heroIdx = table ? (table.positions as string[]).indexOf(props.heroPos) : -1;
  const initial = useMemo((): [number, number] | null => {
    if (!table || heroIdx < 0) return null;
    let best = -1;
    table.bf[heroIdx]!.forEach((v, j) => {
      if (v !== null && (best < 0 || v > table.bf[heroIdx]![best]!)) best = j;
    });
    return best < 0 ? null : [heroIdx, best];
  }, [table, heroIdx]);
  const [sel, setSel] = useState<[number, number] | null>(initial);
  if (!table) return null;
  const cur = sel ?? initial;
  const curBf = cur ? table.bf[cur[0]]![cur[1]] : null;
  const pos = table.positions;
  const bb = (i: number): string => `${formatBbDisplay(table.stacks[i]!)}bb`;

  return (
    <div className="panel">
      <div className="panel-h">
        <span className="eyebrow">BUBBLE FACTOR</span>
        <span className="rt">行＝判断する人 / 列＝相手</span>
      </div>

      {cur && curBf != null && (
        <div className="bfd" aria-live="polite">
          <div className="bfd-l">
            <span className="bfd-pair">
              <b className={cur[0] === heroIdx ? 'me' : ''}>{pos[cur[0]]}</b>
              <span className="bfd-vs">vs</span>
              <b className={cur[1] === heroIdx ? 'me' : ''}>{pos[cur[1]]}</b>
            </span>
            <b className="bfd-v" style={{ background: heatBg(curBf) }}>
              {curBf.toFixed(2)}
            </b>
          </div>
          <div className="bfd-r">
            <span className="statlbl">必要エクイティ</span>
            <b className="bfd-eq">
              {(breakEvenEquity(curBf) * 100).toFixed(0)}
              <span className="hs-unit">%</span>
            </b>
          </div>
          <p className="bfd-t">
            <b>{pos[cur[0]]}</b>（{bb(cur[0])}）が {pos[cur[1]]}（{bb(cur[1])}）とオールインになると、{pos[cur[0]]}{' '}
            は負けたときの損が勝ったときの得の <b>{curBf.toFixed(2)} 倍</b>。{pos[cur[0]]} がプッシュするときも、
            {pos[cur[1]]} のプッシュにコールするときも同じ値で、チップだけなら 50% のところ{' '}
            <b>{(breakEvenEquity(curBf) * 100).toFixed(0)}%</b> のエクイティが要ります。
          </p>
        </div>
      )}

      <table className="bft">
        <thead>
          <tr>
            <th className="rh corner">
              判断＼相手
            </th>
            {pos.map((p, j) => (
              <th key={p} scope="col" className={j === heroIdx ? 'me' : ''}>
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pos.map((p, i) => (
            <tr key={p} className={i === heroIdx ? 'me' : ''}>
              <th scope="row" className="rh">
                <span>{p}</span>
                <small>{bb(i)}</small>
              </th>
              {pos.map((q, j) => {
                const v = table.bf[i]![j];
                if (v == null) {
                  return (
                    <td key={q} className="dg">
                      —
                    </td>
                  );
                }
                const on = cur?.[0] === i && cur?.[1] === j;
                return (
                  <td key={q}>
                    <button
                      type="button"
                      className={on ? 'sel' : ''}
                      style={{ background: heatBg(v) }}
                      aria-pressed={on}
                      aria-label={`${p} が ${q} とオールイン: ${v.toFixed(2)}`}
                      onClick={() => setSel([i, j])}
                    >
                      {v.toFixed(2)}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bfl" aria-hidden="true">
        <span>1.0 軽い</span>
        <i />
        <span>3.5+ 重い</span>
      </div>
      <p className="hint">
        行の人が列の人とオールインになったときの、行の人にとっての重さです（負けたときの ICM の損 ÷ 勝ったときの得）。行の人がプッシュする側でもコールする側でも同じ値です。スタックはハンド開始時の値で、ポットの無い勝負として計算しています。セルを押すと詳しく表示します。
      </p>
    </div>
  );
}
