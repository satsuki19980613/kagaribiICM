import { gameModeLabel } from '@kagaribi/core';
import { useState } from 'react';
import { aggregate, type SpotRecord } from '../records/model';
import { ConfirmDialog, Dots, PaneHead } from './ui';

const ACT: Record<string, string> = { PUSH: 'ALL IN', FOLD: 'FOLD' };

function fmtDate(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 記録タブ。計算を始めた時点で自動で残り、計算中 / 完了 / 失敗・中断の 3 状態を持つ。
 * 完了した行を開くと結果画面（自分の選択を編集できる）。
 */
export function RecordsView(props: {
  records: SpotRecord[];
  onOpen: (rec: SpotRecord) => void;
  onDelete: (rec: SpotRecord) => void;
  onRetry: (rec: SpotRecord) => void;
  jobRunning: boolean;
  onGoIcm: () => void;
}): JSX.Element {
  const { records } = props;
  const stats = aggregate(records);
  const [delTarget, setDelTarget] = useState<SpotRecord | null>(null);

  const meta = (r: SpotRecord): JSX.Element => (
    <span className="rec-sub">
      <span>
        {r.heroPos}・{r.playersLeft} LEFT
      </span>
      {(r.state.gameMode ?? 'club') !== 'club' && <span className="mtag c">{gameModeLabel(r.state.gameMode)}</span>}
      <span>{fmtDate(r.createdAt)}</span>
    </span>
  );

  return (
    <div className="pane">
      <PaneHead eyebrow="RECORDS" title="記録" />

      <div className="hs-grid two">
        <div className="hs-stat">
          <span className="statlbl">記録した場面</span>
          <b className="hs-val">{stats.count}</b>
        </div>
        <div className="hs-stat">
          <span className="statlbl">EV loss 累計</span>
          <b className={`hs-val${stats.totalEvLoss > 0 ? ' loss' : ''}`}>
            {stats.totalEvLoss > 0 ? '−' : ''}
            {stats.totalEvLoss.toFixed(3)}
            <span className="hs-unit">pt</span>
          </b>
        </div>
      </div>

      {records.length === 0 ? (
        <div className="empty">
          <span className="eyebrow">NO RECORDS</span>
          <p>ICM タブで計算すると、ここに自動で残ります。</p>
          <button type="button" className="btn sm" onClick={props.onGoIcm}>
            ICM へ
          </button>
        </div>
      ) : (
        <ul className="recs">
          {records.map((r) => {
            if (r.status === 'solving') {
              return (
                <li key={r.id} className="rec">
                  <div className="rec-main">
                    <span className="rec-hand">{r.heroHand}</span>
                    <span className="rec-run">
                      SOLVING
                      <Dots />
                    </span>
                    {meta(r)}
                  </div>
                  <span />
                </li>
              );
            }
            if (r.status === 'failed' || r.status === 'aborted') {
              return (
                <li key={r.id} className="rec">
                  <div className="rec-main">
                    <span className="rec-hand">{r.heroHand}</span>
                    <span className="rec-vd fold">{r.status === 'aborted' ? 'ABORTED' : 'FAILED'}</span>
                    {meta(r)}
                    <span />
                    <span className="rec-err">
                      {r.status === 'aborted' ? '計算の途中でアプリが閉じられました。' : (r.error ?? '計算に失敗しました。')}
                    </span>
                    <button type="button" className="btn sm rec-retry" disabled={props.jobRunning} onClick={() => props.onRetry(r)}>
                      再計算
                    </button>
                  </div>
                  <button type="button" className="rec-x" aria-label="削除" onClick={() => setDelTarget(r)} />
                </li>
              );
            }
            const hasLoss = r.heroAction != null && r.evLoss != null && r.evLoss > 0;
            return (
              <li key={r.id} className="rec">
                <button type="button" className="rec-main" onClick={() => props.onOpen(r)}>
                  <span className="rec-hand">{r.heroHand}</span>
                  <span className={`rec-vd ${r.verdict === 'PUSH' ? 'push' : 'fold'}`}>{ACT[r.verdict]}</span>
                  {meta(r)}
                  <span className="rec-act">
                    {r.heroAction == null ? (
                      <span style={{ color: 'var(--muted)' }}>未選択</span>
                    ) : hasLoss ? (
                      <>
                        {ACT[r.heroAction]} <span className="loss">−{(r.evLoss ?? 0).toFixed(3)}</span>
                      </>
                    ) : (
                      <>
                        {ACT[r.heroAction]} <span className="gain">✓</span>
                      </>
                    )}
                  </span>
                </button>
                <button type="button" className="rec-x" aria-label="削除" onClick={() => setDelTarget(r)} />
              </li>
            );
          })}
        </ul>
      )}

      {delTarget && (
        <ConfirmDialog
          eyebrow="DELETE"
          title="この記録を削除しますか？"
          body={`${delTarget.heroHand}・${delTarget.heroPos}・${fmtDate(delTarget.createdAt)}`}
          okLabel="削除する"
          danger
          onOk={() => props.onDelete(delTarget)}
          onClose={() => setDelTarget(null)}
        />
      )}
    </div>
  );
}
