import { useState } from 'react';
import type { OcrReadout } from '@kagaribi/ocr';
import { buildOcrReadoutView } from './ocrReadoutView';
import { Modal } from './ui';

/**
 * 元画像 × OCR 結果の照合。画像タップで全体表示／原寸を切り替える。readout があれば
 * 席ごとの読み取り値（ポジション・hero/D・スタック・bet）と読めなかった理由を下に出す。
 */
export function ImageModal(props: { src: string; readout?: OcrReadout; onClose: () => void }): JSX.Element {
  const [zoom, setZoom] = useState(false);
  const view = props.readout ? buildOcrReadoutView(props.readout) : null;
  // 表示するのは、読み込んだスクショから作ったブラウザ内の画像（blob:）だけ。
  const src = props.src.startsWith('blob:') ? props.src : '';

  return (
    <Modal eyebrow="IMAGE" title={view ? '元画像と読み取り結果' : '元画像'} size="wide" onClose={props.onClose}>
      <div className={`imgv${zoom ? ' zoom' : ''}`} onClick={() => setZoom((z) => !z)}>
        {src && <img src={src} alt="読み取り元のスクリーンショット" />}
      </div>

      {view && (
        <>
          <h3>
            <i className="gem" />
            SEATS
          </h3>
          <ul className="seats">
            {view.seats.map((s) => (
              <li key={s.id} className={`seat${s.isHero ? ' hero' : ''}`}>
                <span className={`pos${s.isHero ? ' hero' : ''}`}>{s.posLabel}</span>
                <span className={`stk${s.stackLow ? ' lowconf' : ''}`}>{s.stackText}</span>
                <span className={`bet${s.betLow ? ' lowconf' : ''}`}>{s.betText ? `BET ${s.betText}` : ''}</span>
                <span className="tgs">
                  {s.isHero && <span className="tg">HERO</span>}
                  {s.isButton && <span className="tg d">D</span>}
                </span>
              </li>
            ))}
          </ul>
          {view.chipCheckNote && <p className="hint" style={{ marginTop: 8 }}>{view.chipCheckNote}</p>}
          {view.issues.length > 0 && (
            <>
              <h3>
                <i className="gem c" />
                読み取れなかった理由
              </h3>
              <ul className="check">
                {view.issues.map((m) => (
                  <li key={m} className="ng">
                    <div>{m}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Modal>
  );
}
