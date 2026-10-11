import { useState } from 'react';
import type { Position } from '@kagaribi/core';
import { positionsForPlayersLeft } from '@kagaribi/core';
import type { OcrReadout } from '@kagaribi/ocr';
import {
  buildBoardState,
  lineText,
  reconcilePositions,
  toggleAllin,
  RAISE_RANGE_PRESETS,
  type AnteScheme,
  type BoardForm,
} from '../formModel';
import { HandPicker } from './HandGrid';
import { ImageModal } from './ImageModal';
import { Modal } from './ui';

const ACT_LABEL: Record<string, string> = { F: 'FOLD', P: 'ALL IN', C: 'CALL', R: 'RAISE' };

/** 手入力モーダル。妥当なら onSubmit(form) で条件確認へ。写真経由なら元画像と照合しながら直せる。 */
export function InputForm(props: Readonly<{
  form: BoardForm;
  onFormChange: (f: BoardForm) => void;
  onSubmit: (form: BoardForm) => void;
  imageUrl: string | null;
  readout?: OcrReadout;
  onClose: () => void;
}>): JSX.Element {
  const { form, onFormChange } = props;
  // ハンドが空（写真でハンドだけ読めなかった）なら、最初から表を開いて選んでもらう。
  const [showGrid, setShowGrid] = useState(!props.form.heroHand);
  const [showImage, setShowImage] = useState(false);
  const positions = positionsForPlayersLeft(form.playersLeft);
  const set = (patch: Partial<BoardForm>): void => onFormChange({ ...form, ...patch });
  const setStack = (pos: Position, v: string): void => onFormChange({ ...form, stacks: { ...form.stacks, [pos]: v } });
  const preview = buildBoardState(form);
  // レイズした人の候補: HERO より前の席（スクショで HERO 自身がレイズしていたら HERO も）。
  const heroAt = positions.indexOf(form.heroPos);
  const raiserAt = form.raiser ? positions.indexOf(form.raiser) : -1;
  const raiserOptions = positions.filter((p, i) => i < heroAt || (p === form.heroPos && form.line?.[p] === 'R'));

  return (
    <Modal
      eyebrow="MANUAL"
      title="手入力"
      onClose={props.onClose}
      headActions={
        props.imageUrl ? (
          <button type="button" className="btn sm" onClick={() => setShowImage(true)}>
            IMAGE
          </button>
        ) : undefined
      }
      foot={
        <button type="button" className="btn primary big" disabled={!preview.ok} onClick={() => props.onSubmit(form)}>
          この内容で確認する
        </button>
      }
    >
      <div className="lbl">PLAYERS</div>
      <div className="seg">
        {[2, 3, 4, 5, 6].map((n) => (
          <button
            key={n}
            type="button"
            aria-pressed={form.playersLeft === n}
            onClick={() => onFormChange(reconcilePositions({ ...form, playersLeft: n, line: undefined }))}
          >
            {n}
          </button>
        ))}
      </div>

      <div className="fgrid">
        <div>
          <label className="lbl" htmlFor="f-sb">SB</label>
          <input id="f-sb" className="tin" inputMode="decimal" value={form.sb} onChange={(e) => set({ sb: e.target.value })} />
        </div>
        <div>
          <label className="lbl" htmlFor="f-bb">BB</label>
          <input id="f-bb" className="tin" inputMode="decimal" value={form.bb} onChange={(e) => set({ bb: e.target.value })} />
        </div>
        <div>
          <label className="lbl" htmlFor="f-as">ANTE</label>
          <select id="f-as" className="tin" value={form.anteScheme} onChange={(e) => set({ anteScheme: e.target.value as AnteScheme })}>
            <option value="none">なし</option>
            <option value="all">全員アンティ (all)</option>
            <option value="bb">BB アンティ (bb)</option>
          </select>
        </div>
        <div>
          <label className="lbl" htmlFor="f-aa">ANTE (bb)</label>
          <input
            id="f-aa"
            className="tin"
            inputMode="decimal"
            value={form.anteAmount}
            disabled={form.anteScheme === 'none'}
            onChange={(e) => set({ anteAmount: e.target.value })}
          />
        </div>
      </div>

      <div className="lbl">STACKS (bb) ・ ポジションを押して HERO を選ぶ</div>
      <div className="seats-in">
        {positions.map((pos, i) => {
          const hero = form.heroPos === pos;
          // HERO より前の席は、右のボタンで「前の人のオールイン」を切り替えられる。
          const act = form.line?.[pos] ?? (pos === form.raiser ? 'R' : i < heroAt ? 'F' : undefined);
          const canToggle = i < heroAt && pos !== form.raiser && i > raiserAt && form.line?.[form.heroPos] !== 'R';
          return (
            <div key={pos} className={`seat-in${hero ? ' hero' : ''}`}>
              <button
                type="button"
                className={`pos${hero ? ' hero' : ''}`}
                aria-pressed={hero}
                onClick={() => set({ heroPos: pos, line: undefined })}
              >
                {pos}
              </button>
              <input
                className="tin"
                inputMode="decimal"
                aria-label={`${pos} のスタック`}
                value={form.stacks[pos] ?? ''}
                onChange={(e) => setStack(pos, e.target.value)}
              />
              {hero ? (
                <span className="u">HERO</span>
              ) : act ? (
                <button
                  type="button"
                  className={`act a-${act}`}
                  disabled={!canToggle}
                  aria-label={`${pos} のアクション`}
                  aria-pressed={act === 'P' || act === 'C'}
                  onClick={() => set({ line: toggleAllin(form, pos) })}
                >
                  {ACT_LABEL[act] ?? act}
                </button>
              ) : (
                <span className="u">BB</span>
              )}
            </div>
          );
        })}
      </div>

      {heroAt > 0 && (
        <p className="hint">HERO より前の席は、右のボタンで FOLD / ALL IN を切り替えられます（前の人のオールインに対する判断になります）。</p>
      )}

      <label className="lbl" htmlFor="f-rs">RAISE ・ 最初に参加した人のレイズ</label>
      <div className="fgrid">
        <div>
          <select
            id="f-rs"
            className="tin"
            value={form.raiser ?? ''}
            onChange={(e) => set({ raiser: e.target.value as Position | '', raiseTo: form.raiseTo ?? '2', line: undefined })}
          >
            <option value="">なし（オールインかフォールドだけ）</option>
            {raiserOptions.map((p) => (
              <option key={p} value={p}>
                {p === form.heroPos ? `${p}（HERO・オールインを受けた）` : `${p} がレイズ`}
              </option>
            ))}
          </select>
        </div>
        <div>
          <input
            className="tin"
            inputMode="decimal"
            aria-label="レイズ額（bb）"
            value={form.raiser ? (form.raiseTo ?? '2') : ''}
            placeholder="2"
            disabled={!form.raiser}
            onChange={(e) => set({ raiseTo: e.target.value })}
          />
        </div>
      </div>
      {form.raiser && (
        <>
          <label className="lbl" htmlFor="f-rr">RAISE RANGE ・ レイズする人のレンジ</label>
          <select id="f-rr" className="tin" value={form.raiseRange ?? ''} onChange={(e) => set({ raiseRange: e.target.value })}>
            <option value="">ソルバーが決める（強いハンドの罠だけになりやすい）</option>
            {RAISE_RANGE_PRESETS.map((p) => (
              <option key={p} value={String(p)}>
                上位 {p}% でレイズすると仮定
              </option>
            ))}
          </select>
        </>
      )}
      {form.line && lineText(positions, form.line) !== 'なし' && (
        <p className="hint">
          アクション: {lineText(positions, form.line)}。結果はこのアクションに対する判断として表示します（HERO や人数を変えると消えます）。
          {form.raiser ? ' レイズの後はオールインかフォールドだけのモデルで解きます。' : ''}
        </p>
      )}
      {form.raiser && !form.line && (
        <p className="hint">
          {form.raiser} より前と、{form.raiser} から HERO までの席はフォールドした扱いです。レイズの後はオールインかフォールドだけのモデルで解きます。
        </p>
      )}

      <div className="lbl">HAND</div>
      <button type="button" className="handbtn" aria-expanded={showGrid} onClick={() => setShowGrid((s) => !s)}>
        {form.heroHand || 'ハンドを選んでください'}
        <span>{showGrid ? 'CLOSE ▲' : 'SELECT ▼'}</span>
      </button>
      {showGrid && (
        <HandPicker
          value={form.heroHand}
          onChange={(h) => {
            set({ heroHand: h });
            setShowGrid(false);
          }}
        />
      )}

      {!preview.ok && preview.issues.length > 0 && (
        <ul className="issues">
          {preview.issues.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {showImage && props.imageUrl && (
        <ImageModal src={props.imageUrl} readout={props.readout} onClose={() => setShowImage(false)} />
      )}
    </Modal>
  );
}
