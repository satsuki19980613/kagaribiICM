import { useEffect, useRef, useState } from 'react';
import { GUIDE_STEPS, playStep, preloadSample } from './guideScript';

const n2 = (i: number): string => String(i).padStart(2, '0');

/**
 * 使い方ガイド（ヘルプのモーダル内）。ステップごとにアニメーションをループ再生し、
 * 前へ／次へ・区切りバー・左右スワイプ・矢印キーで移動する。
 */
export function Guide(): JSX.Element {
  const [cur, setCur] = useState(0);
  const [size, setSize] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const last = GUIDE_STEPS.length - 1;
  const go = (i: number): void => setCur(Math.max(0, Math.min(last, i)));

  useEffect(() => {
    void preloadSample();
  }, []);

  // 幅が変わったら組み直す（カメラの倍率と部品の縮小率がステージの大きさで決まるため）
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - w) < 8) return;
      w = el.clientWidth;
      setSize((s) => s + 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    return playStep(el, cur);
  }, [cur, size]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowRight') setCur((c) => Math.min(last, c + 1));
      else if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [last]);

  // 左右スワイプ
  const sx = useRef<{ x: number; y: number } | null>(null);

  return (
    <div className="gs">
      <div
        ref={stage}
        className="gs-stage"
        aria-hidden="true"
        onPointerDown={(e) => {
          sx.current = { x: e.clientX, y: e.clientY };
        }}
        onPointerUp={(e) => {
          const s = sx.current;
          sx.current = null;
          if (!s) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) go(cur + (dx < 0 ? 1 : -1));
        }}
        onPointerCancel={() => {
          sx.current = null;
        }}
      />
      {/* 全ステップの説明を重ねて置き、いちばん長いものの高さで固定する（切り替えで下のボタンが動かない） */}
      <div className="gs-caps" aria-live="polite">
        {GUIDE_STEPS.map((s, i) => (
          <div key={s.t} className={`gs-cap${i === cur ? ' on' : ''}`} aria-hidden={i !== cur}>
            <div className="gs-num">
              {n2(i + 1)} / {n2(GUIDE_STEPS.length)}
            </div>
            <h3>{s.t}</h3>
            <p>{s.p}</p>
            {s.n && <p className="gs-n">{s.n}</p>}
          </div>
        ))}
      </div>
      <div className="gs-nav">
        <button type="button" className="gs-btn prev" aria-label="前へ" disabled={cur === 0} onClick={() => go(cur - 1)} />
        <div className="gs-segs">
          {GUIDE_STEPS.map((s, i) => (
            <button
              key={s.t}
              type="button"
              className={`gs-seg${i === cur ? ' on' : i < cur ? ' done' : ''}`}
              aria-label={`${i + 1}. ${s.t}`}
              aria-current={i === cur ? 'step' : undefined}
              onClick={() => go(i)}
            />
          ))}
        </div>
        <button type="button" className="gs-btn next" aria-label="次へ" disabled={cur === last} onClick={() => go(cur + 1)} />
      </div>
    </div>
  );
}
