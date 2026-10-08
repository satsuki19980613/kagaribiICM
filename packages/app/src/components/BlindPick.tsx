import { TABLE_BB_OPTIONS } from '@kagaribi/ocr';

/**
 * ヘッダのブラインドを読み取れなかったときの BB 選択（さつき決定 2026-10-08）。
 * 選ぶと総チップ保存チェック（ゲーム取り違えの警告・スタック読み違いの補正）が働く。
 * BB 表示の計算そのものはブラインドのチップ額に依存しないので、選ばなくても計算できる。
 * 表示はゲーム画面左上と同じ「SB/BB」の並び（例 820/1640）。
 */
export function BlindPick(props: { onPick: (bb: number) => void; hint?: string }): JSX.Element {
  return (
    <div className="panel">
      <div className="panel-h">
        <span className="eyebrow">BLINDS</span>
        <span className="rt">任意</span>
      </div>
      <p className="hint">
        {props.hint ??
          '画面左上のブラインド（SB/BB）を読み取れませんでした。スクショの SB/BB を選ぶと、チップの合計からゲームの取り違えやスタックの読み違いを確かめます（選ばなくても計算できます）。'}
      </p>
      <select
        className="tin"
        value=""
        aria-label="スクショの SB/BB"
        onChange={(e) => {
          const bb = Number(e.target.value);
          if (bb > 0) props.onPick(bb);
        }}
      >
        <option value="">SB/BB を選ぶ</option>
        {TABLE_BB_OPTIONS.map((bb) => (
          <option key={bb} value={bb}>
            {bb / 2}/{bb}
          </option>
        ))}
      </select>
    </div>
  );
}
