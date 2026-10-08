import { useEffect } from 'react';

const AUTO_CLOSE_MS = 5000;

/** 計算完了 / 失敗の通知。本文タップで onTap（結果・記録へ）、5 秒で自動的に消える。 */
export function Toast(props: { message: string; kind: 'done' | 'err'; go?: string; onTap: () => void; onClose: () => void }): JSX.Element {
  const { onClose } = props;
  useEffect(() => {
    const t = window.setTimeout(onClose, AUTO_CLOSE_MS);
    return () => window.clearTimeout(t);
  }, [onClose]);

  return (
    <div
      className={`toast${props.kind === 'err' ? ' err' : ''}`}
      role="status"
      onClick={() => {
        props.onTap();
        props.onClose();
      }}
    >
      <span>{props.message}</span>
      {props.go && <span className="go">{props.go} →</span>}
      <button
        type="button"
        className="tx"
        aria-label="閉じる"
        onClick={(e) => {
          e.stopPropagation();
          props.onClose();
        }}
      />
    </div>
  );
}
