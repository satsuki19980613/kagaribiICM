import { useRef } from 'react';
import { GameModeSelect, type GameSel } from './GameModeSelect';
import { Guide } from './guide/Guide';
import { Dots, Modal } from './ui';

/**
 * 読み取れる条件。文言は OCR が実際に弾いている条件とそろえる
 * （gate.ts の streetGate・prefill.ts の BB 表示判定・spotReconstruction の detectOutOfScope・
 * extractAnchored の全画面前提・chipConsistency の公式ブラインド判定）。
 */
export const READ_CONDITIONS: { title: string; hint: string }[] = [
  { title: 'プリフロップの画面', hint: 'フロップ以降・ストリート表示が読めないものは対象外です' },
  { title: 'スタックが BB 表示', hint: '例: 20.2 BB。チップ総額表示（例: 19,453）は取り込めません' },
  {
    title: 'オールインとフォールドだけで進んだ場面',
    hint: 'レイズ・ミニレイズ・3bet・リンプ（非オールインへのコール）が入った局面は対象外です',
  },
  { title: '自分の判断がある場面', hint: '全員フォールドで BB に手番が回ったウォークは対象外です' },
  { title: '切り抜いていない全画面のスクショ', hint: '一部を切り抜くとスタックやポジションが読み取れません' },
  { title: 'Sit & Go の局面', hint: 'ブラインド構造が公式のもの（通常／ゆっくり／もっとゆっくり）である必要があります' },
];

export function ReadConditionsList(): JSX.Element {
  return (
    <ul className="check">
      {READ_CONDITIONS.map((c) => (
        <li key={c.title}>
          <div>
            {c.title}
            <small>{c.hint}</small>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** ヘッダの「?」。アニメーションの使い方ガイドと、読み取れる条件。 */
export function HelpModal(props: { onClose: () => void }): JSX.Element {
  return (
    <Modal eyebrow="HOW TO USE" title="使い方" size="guide" onClose={props.onClose}>
      <Guide />
      <h3>
        <i className="gem" />
        読み取れる条件
      </h3>
      <ReadConditionsList />
      <h3>
        <i className="gem" />
        データについて
      </h3>
      <p>対応形式は PNG / JPEG / WebP です。画像の解析と計算はすべてこの端末内で行い、どこにも送信しません。記録はこの端末のブラウザに保存されます。</p>
    </Modal>
  );
}

/** ICM タブの起点。ゲーム選択 → スクショ（または手入力）。 */
export function IcmInput(props: {
  onScreenshot: (file: File) => void;
  onManual: () => void;
  ocrBusy: boolean;
  /** 計算中は次の入力を受け付けない（同時 1 件）。 */
  blocked: boolean;
  gameSel: GameSel;
  onGameModeChange: (next: GameSel) => void;
  onHelp: () => void;
}): JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null);

  function onPick(e: React.ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) props.onScreenshot(file);
  }

  return (
    <div className="pane">
      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onPick} disabled={props.blocked} />

      {props.blocked && <div className="notice warn">計算中です。完了すると次の局面を読み込めます。</div>}

      <div className="list-h">
        <span className="eyebrow">GAME</span>
      </div>
      <GameModeSelect sel={props.gameSel} onChange={props.onGameModeChange} disabled={props.blocked || props.ocrBusy} />

      <div className="list-h">
        <span className="eyebrow">INPUT</span>
      </div>
      <button
        type="button"
        className="mbtn hot"
        disabled={props.ocrBusy || props.blocked}
        onClick={() => fileRef.current?.click()}
      >
        <span>
          SCREENSHOT
          <small>{props.ocrBusy ? '読み取り中…' : 'スクリーンショットから読み取る'}</small>
        </span>
        {props.ocrBusy ? <Dots /> : <span className="rt">＋</span>}
      </button>
      <button type="button" className="mbtn" disabled={props.blocked || props.ocrBusy} onClick={props.onManual}>
        <span>
          MANUAL
          <small>手入力する</small>
        </span>
        <span className="rt">→</span>
      </button>
      <button type="button" className="lnk" style={{ justifySelf: 'center' }} onClick={props.onHelp}>
        使い方・読み取れる条件
      </button>
    </div>
  );
}
