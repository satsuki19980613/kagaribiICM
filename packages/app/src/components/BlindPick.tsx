import { TABLE_BB_OPTIONS } from '@kagaribi/ocr';

/**
 * ヘッダのブラインドを読み取れなかったときの SB/BB 設定（さつき決定 2026-10-08）。画面の上の方に
 * 目立つ形で出して、手動での設定を促す。選ぶと総チップのチェック（ゲーム取り違えの警告・スタック
 * 読み違いの補正）が働く。BB 表示の計算そのものはブラインドのチップ額に依存しないので、選ばなくても
 * 計算はできる。表示はゲーム画面左上と同じ「SB/BB」の並び（例 820/1640）。
 */
export function BlindPick(props: { onPick: (bb: number) => void; hint?: string; skippable?: boolean }): JSX.Element {
  return (
    <div className="panel bpick">
      <span className="eyebrow">STRUCTURE</span>
      <b className="bpick-t">SB/BB を設定してください</b>
      <p className="hint">
        {props.hint ??
          '画面左上のブラインド（例: SB/BB 820/1640）を読み取れませんでした。スクショと同じ SB/BB を選ぶと、チップの合計からゲームの取り違えやスタックの読み違いを確かめられます。'}
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
      {props.skippable !== false && <p className="hint">選ばずに計算することもできます。</p>}
    </div>
  );
}
