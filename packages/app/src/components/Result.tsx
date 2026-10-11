import { formatBbDisplay, gameModeLabel, positionsForPlayersLeft, type BoardState, type GameMode } from '@kagaribi/core';
import { useState } from 'react';
import type { SolveResultDto } from '../solverProtocol';
import { evLossOf, headlineNode, verdictOf, type HeroAction } from '../records/model';
import { ActionTree } from './ActionTree';
import { BubbleFactors } from './BubbleFactors';
import { Back } from './ui';

/** pt の単位。表示はクラブ尺度に換算している（記録一覧で横比較するため）。 */
function ptUnit(mode: GameMode | undefined): string {
  return (mode ?? 'club') === 'club' ? 'pt' : 'pt（クラブ換算）';
}
const ACTION_EN: Record<string, string> = {
  PU: 'OPEN PUSH',
  CA: 'CALL',
  OC: 'OVERCALL',
  RS: 'PUSH vs RAISE',
  RC: 'CALL (2ND)',
};
/** コール系の判断（オールインを受ける側）。見出しの PUSH を CALL と出す。 */
const CALL_TYPES = new Set(['CA', 'OC', 'RC']);
const fmtEv = (v: number): string => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`;

/** ミニレイズ・ゲームの局面の説明（例「UTG の 2bb レイズ → HJ ALL IN に対する判断」）。 */
function raiseLineText(state: BoardState): string {
  const line = state.line ?? {};
  const order = positionsForPlayersLeft(state.playersLeft);
  const parts = order
    .filter((p) => line[p] && line[p] !== 'F')
    .map((p) => (line[p] === 'R' ? `${p} の ${formatBbDisplay(state.raiseTo ?? 2)}bb レイズ` : `${p} ${line[p] === 'P' ? 'ALL IN' : 'CALL'}`));
  const text = parts.join(' → ');
  return `${text}${/[A-Za-z]$/.test(text) ? ' ' : ''}に対する判断`;
}

/** hero の判断までに、フォールド以外のアクション（前の人のオールインなど）があるか。 */
function hasAction(state: BoardState): boolean {
  return Object.values(state.line ?? {}).some((a) => a !== 'F');
}

/** 計算結果。自分の選択（ALL IN / FOLD / 未選択）は押した時点で記録に保存する。 */
export function Result(props: Readonly<{
  state: BoardState;
  result: SolveResultDto;
  ms: number;
  heroAction: HeroAction | null;
  onSelectAction: (action: HeroAction | null) => Promise<void>;
  onBack: () => void;
}>): JSX.Element {
  const { result, state } = props;
  const headline = headlineNode(result);
  const heroSeat = state.seats.find((s) => s.pos === result.heroPos);
  const [action, setAction] = useState<HeroAction | null>(props.heroAction);
  const [saving, setSaving] = useState(false);
  const verdict = headline ? verdictOf(headline) : null;
  const evLoss = action != null && headline ? evLossOf(headline.heroEv, action) : null;
  const club = (state.gameMode ?? 'club') === 'club';

  async function select(a: HeroAction | null): Promise<void> {
    if (saving || a === action) return;
    const prev = action;
    setAction(a);
    setSaving(true);
    try {
      await props.onSelectAction(a);
    } catch {
      setAction(prev);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pane">
      <Back label="RECORDS" onClick={props.onBack} />

      {headline && verdict ? (
        <div className={`panel verdict-panel${verdict === 'FOLD' ? ' fold' : ''}`}>
          <div className="panel-h">
            <span className="eyebrow">VERDICT</span>
            <span className={`mtag${club ? '' : ' c'}`}>{gameModeLabel(state.gameMode)}</span>
          </div>
          <div className="vtop">
            <div className={`verdict${verdict === 'FOLD' ? ' fold' : ''}`}>
              {verdict === 'PUSH' && CALL_TYPES.has(headline.actionType) ? 'CALL' : verdict}
            </div>
            <div className="vhand">{result.heroHand}</div>
          </div>
          <div className="vmeta">
            <span className="num">{result.heroPos}</span>
            {heroSeat && <span className="num">{formatBbDisplay(heroSeat.stack)}bb</span>}
            <span className="num">{result.playersLeft} LEFT</span>
            <span className="num">
              {ACTION_EN[headline.actionType] ?? headline.actionType} {headline.pct.toFixed(1)}%
            </span>
          </div>
          {result.raiseTo !== undefined ? (
            <p className="hint">
              {raiseLineText(state)}。レイズの後はオールインかフォールドだけのモデルで、
              {state.raiseRange !== undefined
                ? `レイズする人は上位 ${state.raiseRange}% でレイズすると仮定しています。`
                : 'レイズする人のレンジもソルバーが決めています（狭く出やすいので、相手が広くレイズするなら条件確認で % を選んでください）。'}
            </p>
          ) : (
            result.heroKey && hasAction(state) && <p className="hint">{raiseLineText(state)}。</p>
          )}
          <div className="hs-grid two">
            <div className="hs-stat">
              <span className="statlbl">EV（フォールド比）</span>
              <b className={`hs-val ${headline.heroEv >= 0 ? 'c-push' : 'c-fold'}`}>
                {fmtEv(headline.heroEv)}
                <span className="hs-unit">{ptUnit(state.gameMode)}</span>
              </b>
            </div>
            <div className="hs-stat">
              <span className="statlbl">RANGE</span>
              <b className="hs-val">
                {headline.pct.toFixed(1)}
                <span className="hs-unit">%</span>
              </b>
            </div>
          </div>
        </div>
      ) : (
        <div className="notice">hero の決定がありません（BB のウォーク等）。下の ACTION TREE をご覧ください。</div>
      )}

      {headline && (
        <div className="panel">
          <div className="panel-h">
            <span className="eyebrow">MY CHOICE</span>
            <span className="rt">この局面で自分が選んだ行動</span>
          </div>
          <div className="seg">
            {(
              [
                { v: 'PUSH' as HeroAction, label: 'ALL IN' },
                { v: 'FOLD' as HeroAction, label: 'FOLD' },
                { v: null, label: '未選択' },
              ] as const
            ).map((o) => (
              <button key={o.label} type="button" aria-pressed={action === o.v} disabled={saving} onClick={() => void select(o.v)}>
                {o.label}
              </button>
            ))}
          </div>
          {evLoss !== null && (
            <div className={`notice ${evLoss > 0 ? 'warn' : 'ok'}`}>
              {evLoss > 0 ? (
                <>
                  EV loss <b>−{evLoss.toFixed(3)}</b> pt（最適は {verdict === 'PUSH' ? 'ALL IN' : 'FOLD'}）
                </>
              ) : (
                <>EV loss <b>0</b>（最適な選択）</>
              )}
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <span className="eyebrow">ACTION TREE</span>
        <ActionTree result={result} stacks={Object.fromEntries(state.seats.map((s) => [s.pos, s.stack]))} />
      </div>

      <BubbleFactors state={state} heroPos={result.heroPos} />

      <div className="panel">
        <div className="panel-h">
          <span className="eyebrow">ICM EQUITY</span>
          <span className="rt">{ptUnit(state.gameMode)}</span>
        </div>
        <table className="tbl">
          <thead>
            <tr>
              <th>POS</th>
              <th>PRE</th>
              <th>POST</th>
              <th>DIFF</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(result.equity).map(([pos, e]) => {
              const d = e.post - e.pre;
              return (
                <tr key={pos} className={pos === result.heroPos ? 'me' : ''}>
                  <td>{pos}</td>
                  <td>{e.pre.toFixed(3)}</td>
                  <td>{e.post.toFixed(3)}</td>
                  <td className={d > 0 ? 'gain' : d < 0 ? 'loss' : ''}>{fmtEv(d)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <span className="eyebrow">SOLVER</span>
        <div className="hs-grid">
          <div className="hs-stat">
            <span className="statlbl">求解時間</span>
            <b className="hs-val">
              {(props.ms / 1000).toFixed(2)}
              <span className="hs-unit">s</span>
            </b>
          </div>
          <div className="hs-stat">
            <span className="statlbl">ITERATIONS</span>
            <b className="hs-val">{result.iterations}</b>
          </div>
          <div className="hs-stat">
            <span className="statlbl">EXPLOITABILITY</span>
            <b className="hs-val">
              {result.exploitabilityPt.toFixed(4)}
              <span className="hs-unit">pt</span>
            </b>
          </div>
        </div>
        {!result.converged && (
          <div className="notice warn">収束が不十分です。ボーダー付近のハンドのプッシュ/フォールドは目安として扱ってください。</div>
        )}
      </div>

      <button type="button" className="btn ghost wide" onClick={props.onBack}>
        記録一覧に戻る
      </button>
    </div>
  );
}
