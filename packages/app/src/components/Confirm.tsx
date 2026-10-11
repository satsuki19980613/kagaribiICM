import { formatBbDisplay, gameModeLabel, positionsForPlayersLeft, type BoardState } from '@kagaribi/core';
import { lineText, RAISE_RANGE_PRESETS } from '../formModel';
import type { OcrReadout } from '@kagaribi/ocr';
import { useState } from 'react';
import { BlindPick } from './BlindPick';
import { potRowView } from './confirmPot';
import { GameModeSelect, type GameSel } from './GameModeSelect';
import { ImageModal } from './ImageModal';
import { Back, Modal, PaneHead } from './ui';

export type ModeNote = { ok: boolean; text: string } | null;
/** 場のチップ合計が選んだゲームと合わないときの数値（BB 換算）。合っていれば null。 */
export type ChipMismatch = { read: number; theory: number } | null;

/**
 * 条件確認。読み取った内容を項目別に出し、低信頼の値には CHECK を付ける。写真経由なら
 * 検出人数をその場で直せ、ゲームを選び直して読み直せる。
 */
const Chk = (): JSX.Element => <span className="chk">CHECK</span>;

export function Confirm(props: Readonly<{
  state: BoardState;
  lowConfidenceFields: string[];
  imageUrl: string | null;
  readout?: OcrReadout;
  onBack: () => void;
  onEdit: () => void;
  onFixPlayers?: (n: number) => void;
  gameSel: GameSel;
  onGameModeChange: (next: GameSel) => void;
  onReread?: () => void;
  /** ヘッダのブラインドが読めなかったときだけ渡す（BB を選んで総チップのチェックを効かせる）。 */
  onPickBb?: (bb: number | null) => void;
  /** 手動で設定中の BB（チップ）。 */
  pickedBb?: number | null;
  modeNote: ModeNote;
  modeMismatch: ChipMismatch;
  stackRecovered: boolean;
  /** 画像がぼけていて、輪郭を立ててから読んだ（読んだ値はすべて強調されている）。 */
  blurry: boolean;
  unresolvedStacks: string[];
  blocked: boolean;
  onSolve: () => void;
  /** レイズした人のレンジの仮定を選び直す（null=ソルバーが決める）。レイズの入った局面だけ渡す。 */
  onRaiseRange?: (pct: number | null) => void;
}>): JSX.Element {
  const { state } = props;
  const [showImage, setShowImage] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const low = new Set(props.lowConfidenceFields);
  const pot = potRowView(state, props.readout);
  const stacksLow = state.seats.some((s) => low.has(`${s.pos}.stack`));
  const fromPhoto = !!props.imageUrl;
  // hero の判断までのアクション（前の人のオールイン・レイズ）。フォールドだけなら 'なし'。
  const actionText = state.line ? lineText(positionsForPlayersLeft(state.playersLeft), state.line) : 'なし';

  return (
    <div className="pane">
      <Back label="ICM" onClick={props.onBack} />
      <PaneHead eyebrow="CONFIRM" title="条件確認">
        <button type="button" className="hbtn" aria-label="この画面について" onClick={() => setShowInfo(true)}>
          <span className="q">?</span>
        </button>
        {fromPhoto && (
          <button type="button" className="btn sm" onClick={() => setShowImage(true)}>
            IMAGE
          </button>
        )}
      </PaneHead>

      {props.onPickBb && <BlindPick value={props.pickedBb ?? null} onPick={props.onPickBb} />}
      <GameModeSelect sel={props.gameSel} onChange={props.onGameModeChange} />
      {props.modeNote && <div className={`notice ${props.modeNote.ok ? 'ok' : 'warn'}`}>{props.modeNote.text}</div>}
      {props.onReread && (
        <button type="button" className="btn wide ghost" onClick={props.onReread}>
          選んだゲームで読み直す
        </button>
      )}
      {props.modeMismatch && (
        <div className="notice warn">
          チップの合計が「{gameModeLabel(state.gameMode)}」と合いません。読み取ったスタックとポットの合計は <b>{props.modeMismatch.read.toFixed(1)}bb</b> ですが、このゲームなら{' '}
          <b>{props.modeMismatch.theory.toFixed(1)}bb</b> のはずです（場のチップの合計は、開始人数 × 開始スタックで試合中ずっと変わりません）。ゲームと SB/BB の選択が合っているかご確認ください。
        </div>
      )}
      {props.unresolvedStacks.length > 0 && (
        <div className="notice warn">
          {props.unresolvedStacks.join('・')} のスタックが読み取れませんでした（<b>0bb</b> を仮に置いています）。「修正」から正しい値を入れてください。
        </div>
      )}
      {fromPhoto && props.blurry && (
        <div className="notice warn">
          画像がぼけているため、読み取りの確かさが下がっています。強調された値を、元の画像と見比べてご確認ください。
        </div>
      )}
      {props.stackRecovered && !props.modeMismatch && (
        <div className="notice">読み取れなかった 1 席のスタックを、選んだゲームの総チップから割り出しました。下の STACKS でご確認ください。</div>
      )}

      {fromPhoto && props.onFixPlayers && (
        <>
          <div className="list-h">
            <span className="eyebrow">PLAYERS</span>
            <span className="rt">検出人数 {state.playersLeft}</span>
          </div>
          <div className="seg">
            {[2, 3, 4, 5, 6].map((n) => (
              <button key={n} type="button" aria-pressed={state.playersLeft === n} onClick={() => props.onFixPlayers!(n)}>
                {n}
              </button>
            ))}
          </div>
        </>
      )}

      <div className="panel">
        <dl className="spec">
          <dt>BLINDS</dt>
          <dd>
            {state.blinds.sb} / {state.blinds.bb}
            {state.ante.scheme !== 'none' && <>　ANTE {state.ante.amount}{state.ante.scheme === 'bb' ? ' (BB)' : ''}</>}
          </dd>
          <dd className="tag" />
          <dt>HAND</dt>
          <dd style={{ fontSize: 18 }}>{state.heroHand}</dd>
          <dd className="tag" />
          <dt>HERO</dt>
          <dd>{state.heroPos}</dd>
          <dd className="tag" />
          <dt>PLAYERS</dt>
          <dd>{state.playersLeft}</dd>
          <dd className="tag">{stacksLow && <Chk />}</dd>
          <dt>POT</dt>
          <dd className={pot.ok ? '' : 'warn'}>{pot.text}</dd>
          <dd className="tag" />
          {state.line && actionText !== 'なし' && (
            <>
              <dt>ACTION</dt>
              <dd>{actionText.replace('RAISE', `RAISE ${formatBbDisplay(state.raiseTo ?? 2)}bb`)}</dd>
              <dd className="tag" />
            </>
          )}
        </dl>
      </div>
      {state.raiseTo !== undefined && (
        <div className="panel">
          <div className="panel-h">
            <span className="eyebrow">RAISE RANGE</span>
            <span className="rt">レイズする人のレンジ</span>
          </div>
          {props.onRaiseRange && (
            <div className="seg">
              <button type="button" aria-pressed={state.raiseRange === undefined} onClick={() => props.onRaiseRange!(null)}>
                AUTO
              </button>
              {RAISE_RANGE_PRESETS.map((p) => (
                <button key={p} type="button" aria-pressed={state.raiseRange === p} onClick={() => props.onRaiseRange!(p)}>
                  {p}%
                </button>
              ))}
            </div>
          )}
          <p className="hint">
            {state.raiseRange === undefined
              ? 'AUTO: レイズする人のレンジもソルバーが決めます。このモデルではレイズは強いハンドの罠になりやすく、レンジが狭く出ます。相手がもっと広くレイズしてくるなら、近い % を選んでください。'
              : `レイズする人は上位 ${state.raiseRange}% のハンドでレイズすると仮定します（ランダムなハンドに対する勝率の順）。`}{' '}
            レイズの後は全員オールインかフォールドだけ（フラットコールなし）のモデルです。
          </p>
        </div>
      )}

      <div className="list-h">
        <span className="eyebrow">STACKS</span>
      </div>
      <ul className="seats">
        {state.seats.map((s) => {
          const hero = s.pos === state.heroPos;
          const stackLow = low.has(`${s.pos}.stack`);
          const betLow = low.has(`${s.pos}.bet`);
          return (
            <li key={s.pos} className={`seat${hero ? ' hero' : ''}`}>
              <span className={`pos${hero ? ' hero' : ''}`}>{s.pos}</span>
              <span className={`stk${stackLow ? ' lowconf' : ''}`}>{formatBbDisplay(s.stack)}bb</span>
              <span className={`bet${betLow ? ' lowconf' : ''}`}>{s.bet > 0 ? `BET ${formatBbDisplay(s.bet)}` : ''}</span>
              <span className="tgs">{hero && <span className="tg">HERO</span>}</span>
            </li>
          );
        })}
      </ul>

      {props.blocked && <div className="notice warn">計算中です。完了してから計算できます。</div>}
      <div className="btns">
        <button type="button" className="btn ghost" onClick={props.onEdit}>
          修正
        </button>
        <button type="button" className="btn primary" disabled={props.blocked} onClick={props.onSolve}>
          計算する
        </button>
      </div>

      {showImage && props.imageUrl && (
        <ImageModal src={props.imageUrl} readout={props.readout} onClose={() => setShowImage(false)} />
      )}
      {showInfo && (
        <Modal eyebrow="CONFIRM" title="この画面について" onClose={() => setShowInfo(false)}>
          <h3><i className="gem" />CHECK の付いた項目</h3>
          <p>自動読み取りの信頼度が低めの値です。下線付きの値をご確認ください。</p>
          {fromPhoto && (
            <>
              <h3><i className="gem" />検出人数</h3>
              <p>フォールドした席のスタックが読み取れないと、その席が抜けて人数が少なく出ることがあります。実際の人数と違うときは選び直すと席を補います（補った席のスタックは STACKS でご確認ください）。</p>
            </>
          )}
          <h3><i className="gem" />ゲームの選択</h3>
          <p>ゲームによって順位ごとのポイントと開始スタックが違うため、どのゲームの局面かで結果が変わります。<b>ランクマッチ</b>は STAGE ごとに開始スタックも順位ごとのポイントも違います。<b>レジェンドマッチ</b>は「シーズン」と「ベース」の 2 つのレートが動き、<b>平均</b>は両方をならしたものです（迷ったら平均）。</p>
          {props.stackRecovered && (
            <>
              <h3><i className="gem c" />割り出したスタック</h3>
              <p>1 席だけ読み取れなかったスタックを、テーブル全体のチップが一定であることから逆算しました。選んだゲームの開始スタックを前提にしているため、ゲームが違うとこの席の値が大きく変わります。</p>
            </>
          )}
          <h3><i className="gem" />修正のしかた</h3>
          <p>違っていたら「修正」から直せます。直した内容がそのまま計算に使われます。</p>
        </Modal>
      )}
    </div>
  );
}
