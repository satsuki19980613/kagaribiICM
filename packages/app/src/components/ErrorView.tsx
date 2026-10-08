import { useState } from 'react';
import type { OcrReadout } from '@kagaribi/ocr';
import { BlindPick } from './BlindPick';
import { GameModeSelect, type GameSel } from './GameModeSelect';
import { ImageModal } from './ImageModal';
import { ReadConditionsList } from './IcmInput';
import type { ModeNote } from './Confirm';
import { Back, PaneHead } from './ui';

/**
 * 計算できない理由の画面。写真経由なら「別の写真を選ぶ」と照合ビュー、ゲーム取り違えの
 * 可能性があるときはゲームを選び直して読み直せる。どの経路でも手入力へ戻れる。
 */
export function ErrorView(props: {
  issues: string[];
  onBack: () => void;
  onManual: () => void;
  /** 写真経路のときだけ渡す（別の写真を選ぶ）。 */
  onRetry?: () => void;
  imageUrl?: string;
  readout?: OcrReadout;
  gameSel?: GameSel;
  onGameModeChange?: (next: GameSel) => void;
  onReread?: () => void;
  /** ヘッダのブラインドが読めなかったときだけ渡す（BB を選んで読み直す）。 */
  onPickBb?: (bb: number | null) => void;
  /** 手動で設定中の BB（チップ）。 */
  pickedBb?: number | null;
  modeNote: ModeNote;
}): JSX.Element {
  const fromPhoto = !!props.onRetry;
  const canFixGame = !!props.onReread && !!props.gameSel && !!props.onGameModeChange;
  const [showImage, setShowImage] = useState(false);

  return (
    <div className="pane">
      <Back label="ICM" onClick={props.onBack} />
      <PaneHead eyebrow="ERROR" title="この内容では計算できません">
        {props.imageUrl && (
          <button type="button" className="btn sm" onClick={() => setShowImage(true)}>
            IMAGE
          </button>
        )}
      </PaneHead>

      {props.issues.length > 0 && (
        <div className="panel">
          <span className="eyebrow">ISSUES</span>
          <ul className="check">
            {props.issues.map((m) => (
              <li key={m} className="ng">
                <div>{m}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {props.onPickBb && (
        <BlindPick
          value={props.pickedBb ?? null}
          onPick={props.onPickBb}
          hint="画面左上のブラインド（例: SB/BB 820/1640）を読み取れませんでした。スクショと同じ SB/BB を選ぶと、その値で読み直します。"
          skippable={false}
        />
      )}

      {canFixGame && (
        <div className="panel">
          <span className="eyebrow">GAME</span>
          <p className="hint">選んだゲームと写真のゲームが違うと、場のチップ総量が合わず読み取れません。正しいゲームを選んで読み直せます。</p>
          <GameModeSelect sel={props.gameSel!} onChange={props.onGameModeChange!} />
          {props.modeNote && <div className={`notice ${props.modeNote.ok ? 'ok' : 'warn'}`}>{props.modeNote.text}</div>}
          <button type="button" className="btn wide" onClick={props.onReread}>
            選んだゲームで読み直す
          </button>
        </div>
      )}

      {fromPhoto && (
        <div className="panel">
          <span className="eyebrow">CONDITIONS</span>
          <ReadConditionsList />
        </div>
      )}

      <div className="btns">
        {fromPhoto && (
          <button type="button" className="btn primary" onClick={props.onRetry}>
            別の写真を選ぶ
          </button>
        )}
        <button type="button" className={`btn${fromPhoto ? ' ghost' : ' primary'}`} onClick={props.onManual}>
          {fromPhoto ? '読めた分を手で埋める' : '手入力する'}
        </button>
      </div>

      {showImage && props.imageUrl && (
        <ImageModal src={props.imageUrl} readout={props.readout} onClose={() => setShowImage(false)} />
      )}
    </div>
  );
}
