import { formatBbDisplay, type BoardState } from '@kagaribi/core';
import { useMemo, useState } from 'react';
import { breakEvenEquity, bubbleFactorTable } from '../bubbleFactor';

/** BF 1.0（圧力なし）→ 0、3.5 以上 → 1。セルの色の濃さ。 */
const heat = (bf: number): number => Math.max(0, Math.min(1, (bf - 1) / 2.5));
const heatBg = (bf: number): string => `color-mix(in srgb, var(--cpu) ${Math.round(heat(bf) * 72)}%, transparent)`;
const pct = (bf: number): string => (breakEvenEquity(bf) * 100).toFixed(0);

/**
 * 結果画面のバブルファクター表。行＝プッシャー（BB を除く）、列＝コーラー（UTG を除く）。AOF ではプッシャーは必ず
 * コーラーより前の席なので、行が列より後ろの組み合わせ（例 SB プッシュに UTG がコール）は
 * あり得ず「—」。セルの上段＝プッシャーの BF、下段＝コーラーの BF。セルを押すと上の説明が
 * 切り替わる。初期表示は HERO を含む組み合わせのうち、HERO 側の BF がいちばん重いもの。
 */
export function BubbleFactors(props: { state: BoardState; heroPos: string }): JSX.Element | null {
  const table = useMemo(() => bubbleFactorTable(props.state), [props.state]);
  const heroIdx = table ? (table.positions as string[]).indexOf(props.heroPos) : -1;
  const initial = useMemo((): [number, number] | null => {
    if (!table || heroIdx < 0) return null;
    let best: [number, number] | null = null;
    let bestV = -Infinity;
    table.positions.forEach((_, k) => {
      if (k === heroIdx) return;
      const v = table.bf[heroIdx]![k];
      if (v != null && v > bestV) {
        bestV = v;
        best = k > heroIdx ? [heroIdx, k] : [k, heroIdx];
      }
    });
    return best;
  }, [table, heroIdx]);
  const [sel, setSel] = useState<[number, number] | null>(null);
  if (!table) return null;
  const cur = sel ?? initial;
  const pos = table.positions;
  const bb = (i: number): string => `${formatBbDisplay(table.stacks[i]!)}bb`;
  // 最後の席（BB）はプッシャーにならず、最初の席（UTG）はコーラーにならないので行・列から外す。
  const rows = pos.slice(0, -1).map((_, i) => i);
  const cols = pos.slice(1).map((_, k) => k + 1);
  const pBf = cur ? table.bf[cur[0]]![cur[1]] : null;
  const cBf = cur ? table.bf[cur[1]]![cur[0]] : null;

  return (
    <div className="panel">
      <div className="panel-h">
        <span className="eyebrow">BUBBLE FACTOR</span>
        <span className="rt">行＝プッシャー / 列＝コーラー</span>
      </div>

      {cur && pBf != null && cBf != null && (
        <div className="bfd" aria-live="polite">
          <div className="bfd-side">
            <span className="statlbl">PUSH</span>
            <b className={`bfd-pos${cur[0] === heroIdx ? ' me' : ''}`}>{pos[cur[0]]}</b>
            <b className="bfd-v" style={{ background: heatBg(pBf) }}>
              {pBf.toFixed(2)}
            </b>
            <span className="bfd-eq">
              必要 <b>{pct(pBf)}%</b>
            </span>
          </div>
          <span className="bfd-arrow" aria-hidden="true" />
          <div className="bfd-side">
            <span className="statlbl">CALL</span>
            <b className={`bfd-pos${cur[1] === heroIdx ? ' me' : ''}`}>{pos[cur[1]]}</b>
            <b className="bfd-v" style={{ background: heatBg(cBf) }}>
              {cBf.toFixed(2)}
            </b>
            <span className="bfd-eq">
              必要 <b>{pct(cBf)}%</b>
            </span>
          </div>
          <p className="bfd-t">
            {pos[cur[0]]}（{bb(cur[0])}）のプッシュに {pos[cur[1]]}（{bb(cur[1])}）がコールしてオールインになる場面。
            負けたときの損は勝ったときの得の、{pos[cur[0]]} は <b>{pBf.toFixed(2)} 倍</b>、{pos[cur[1]]} は{' '}
            <b>{cBf.toFixed(2)} 倍</b>。チップだけならどちらも 50% のところ、{pos[cur[0]]} は <b>{pct(pBf)}%</b>、
            {pos[cur[1]]} は <b>{pct(cBf)}%</b> のエクイティが要ります。
          </p>
        </div>
      )}

      <table className="bft">
        <thead>
          <tr>
            <th className="rh corner">PUSH＼CALL</th>
            {cols.map((j) => (
              <th key={pos[j]} scope="col" className={j === heroIdx ? 'me' : ''}>
                {pos[j]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={pos[i]} className={i === heroIdx ? 'me' : ''}>
              <th scope="row" className="rh">
                <span>{pos[i]}</span>
                <small>{bb(i)}</small>
              </th>
              {cols.map((j) => {
                const p = pos[i]!;
                const q = pos[j]!;
                const vp = table.bf[i]![j];
                const vc = table.bf[j]![i];
                // プッシャー（行）がコーラー（列）より前の席の組み合わせだけがあり得る。
                if (j <= i || vp == null || vc == null) {
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
                      aria-pressed={on}
                      aria-label={`${p} のプッシュに ${q} がコール: ${p} ${vp.toFixed(2)}、${q} ${vc.toFixed(2)}`}
                      onClick={() => setSel([i, j])}
                    >
                      <span style={{ background: heatBg(vp) }}>{vp.toFixed(2)}</span>
                      <span style={{ background: heatBg(vc) }}>{vc.toFixed(2)}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="bfl" aria-hidden="true">
        <span className="bfl-key">
          <i>PUSH</i>
          <i>CALL</i>
        </span>
        <span className="bfl-txt">上＝プッシャー / 下＝コーラーの BF</span>
      </div>
      <div className="bfl" aria-hidden="true">
        <span>1.0 軽い</span>
        <i className="bfl-bar" />
        <span>3.5+ 重い</span>
      </div>
      <p className="hint">
        負けたときの ICM の損 ÷ 勝ったときの得。AOF ではプッシャーはコーラーより前の席なので、あり得ない組み合わせは「—」です。スタックはハンド開始時の値で、ポットの無い勝負として計算しています。セルを押すと詳しく表示します。
      </p>
    </div>
  );
}
