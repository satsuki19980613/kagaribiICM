import { RANKS, handLabel } from '../handGrid';

function kindOf(r: number, c: number): string {
  return r === c ? 'pair' : r < c ? 'suited' : 'offsuit';
}

/** 13×13 のハンド選択（タップで hero ハンドを選ぶ）。 */
export function HandPicker(props: { value: string; onChange: (hand: string) => void }): JSX.Element {
  return (
    <div className="hgrid" role="listbox" aria-label="ハンド">
      {RANKS.map((_, r) =>
        RANKS.map((__, c) => {
          const label = handLabel(r, c);
          const sel = label === props.value;
          return (
            <button
              key={label}
              type="button"
              role="option"
              aria-selected={sel}
              className={`hc ${kindOf(r, c)}${sel ? ' sel' : ''}`}
              onClick={() => props.onChange(label)}
            >
              {label}
            </button>
          );
        }),
      )}
    </div>
  );
}

/** 読み取り専用のレンジ表（レンジ入り=塗り、hero ハンド=枠）。 */
export function RangeGrid(props: { hands: readonly string[]; heroHand: string; alt?: readonly string[] }): JSX.Element {
  const inRange = new Set(props.hands);
  // alt＝もう 1 つの行動のレンジ（ミニレイズ・ゲームのレイズ）。青で塗る。
  const inAlt = new Set(props.alt ?? []);
  return (
    <div className="hgrid">
      {RANKS.map((_, r) =>
        RANKS.map((__, c) => {
          const label = handLabel(r, c);
          const on = inRange.has(label);
          const alt = !on && inAlt.has(label);
          const hero = label === props.heroHand;
          return (
            <div key={label} className={`hc ${kindOf(r, c)}${on ? ' on' : ''}${alt ? ' alt' : ''}${hero ? ' hero' : ''}`}>
              {label}
            </div>
          );
        }),
      )}
    </div>
  );
}
