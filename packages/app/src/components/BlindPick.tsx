import { TABLE_BB_OPTIONS } from '@kagaribi/ocr';

/**
 * ヘッダのブラインドを読み取れなかったときの SB/BB 設定（さつき決定 2026-10-08）。画面の上の方に
 * 目立つ形で出して、手動での設定を促す。選ぶと総チップのチェック（ゲーム取り違えの警告・スタック
 * 読み違いの補正）が働く。BB 表示の計算そのものはブラインドのチップ額に依存しないので、選ばなくても
 * 計算はできる。選んだ後も出したままにして、選び直し・設定の取り消しができる。
 * 表示はゲーム画面左上と同じ「SB/BB」の並び（例 820/1640）。
 */
export function BlindPick(props: {
  /** 設定中の BB（チップ）。未設定は null。 */
  value: number | null;
  /** null は設定の取り消し。 */
  onPick: (bb: number | null) => void;
  hint?: string;
  skippable?: boolean;
}): JSX.Element {
  const set = props.value !== null;
  return (
    <div className={`panel bpick${set ? ' set' : ''}`}>
      <span className="eyebrow">STRUCTURE</span>
      <b className="bpick-t">{set ? 'SB/BB（手動で設定）' : 'SB/BB を設定してください'}</b>
      <p className="hint">
        {set
          ? 'スクショ左上の SB/BB と違っていたら、選び直してください。'
          : (props.hint ??
            '画面左上のブラインド（例: SB/BB 820/1640）を読み取れませんでした。スクショと同じ SB/BB を選ぶと、チップの合計からゲームの取り違えやスタックの読み違いを確かめられます。')}
      </p>
      <select
        className="tin"
        value={props.value ?? ''}
        aria-label="スクショの SB/BB"
        onChange={(e) => {
          const bb = Number(e.target.value);
          props.onPick(bb > 0 ? bb : null);
        }}
      >
        <option value="">{set ? '設定しない' : 'SB/BB を選ぶ'}</option>
        {TABLE_BB_OPTIONS.map((bb) => (
          <option key={bb} value={bb}>
            {bb / 2}/{bb}
          </option>
        ))}
      </select>
      {!set && props.skippable !== false && <p className="hint">選ばずに計算することもできます。</p>}
    </div>
  );
}
