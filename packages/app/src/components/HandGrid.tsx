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
export function RangeGrid(props: { hands: readonly string[]; heroHand: string }): JSX.Element {
  const inRange = new Set(props.hands);
  return (
    <div className="hgrid">
      {RANKS.map((_, r) =>
        RANKS.map((__, c) => {
          const label = handLabel(r, c);
          const on = inRange.has(label);
          const hero = label === props.heroHand;
          return (
            <div key={label} className={`hc ${kindOf(r, c)}${on ? ' on' : ''}${hero ? ' hero' : ''}`}>
              {label}
            </div>
          );
        }),
      )}
    </div>
  );
}
