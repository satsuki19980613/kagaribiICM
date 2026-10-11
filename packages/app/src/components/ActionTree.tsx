import { formatBbDisplay } from '@kagaribi/core';
import { useEffect, useState } from 'react';
import type { SolveResultDto } from '../solverProtocol';
import { activeNode, aggressiveFor, applyChoice, defaultState, orderOf, treeRows, type TreeState } from '../tree/model';
import { RangeGrid } from './HandGrid';

/**
 * Action tree。全ポジションを行動順に並べ、各行の FOLD / PU・CA・OC を切り替えると、
 * 選んでいる行の決定ノードのレンジ表・頻度・記法が連動する。BB のウォークは no decision。
 */
export function ActionTree(props: Readonly<{ result: SolveResultDto; stacks: Record<string, number> }>): JSX.Element {
  const { result, stacks } = props;
  const [state, setState] = useState<TreeState>(() => defaultState(result));
  useEffect(() => setState(defaultState(result)), [result]);

  const order = orderOf(result);
  const rows = treeRows(result, state);
  const node = activeNode(result, state);
  const activeRow = rows.find((r) => r.seatIdx === state.active);
  const second = activeRow?.second ?? false;
  const activePos = activeRow?.pos ?? order[state.active] ?? '';
  const activeWalk = activeRow?.walk ?? false;
  const aggrLabel = activeWalk ? null : second ? 'CA' : aggressiveFor(state.actions, state.active).label;
  const raise = node?.raise ?? null;
  const pct = node?.pct ?? 0;
  const rpct = raise?.pct ?? 0;
  const fold = Math.max(0, 100 - pct - rpct);
  const isHeroRow = activePos === result.heroPos;
  const fmtPct = (v: number): string => `${v.toFixed(v >= 10 ? 0 : 1)}%`;

  return (
    <>
      <div className="tree">
        {rows.map((row) => (
          <div key={`${row.pos}${row.second ? '-2' : ''}`} className="arow" data-active={String(state.active === row.seatIdx)}>
            <span className={`pos${row.pos === result.heroPos ? ' hero' : ''}`}>{row.pos}</span>
            <span className="stk">
              {row.second ? <span className="snd">2ND</span> : stacks[row.pos] != null ? `${formatBbDisplay(stacks[row.pos]!)}bb` : ''}
            </span>
            {row.walk ? (
              <span className="term">NO DECISION</span>
            ) : (
              <div className="seg">
                {row.options.map((opt) => (
                  <button
                    key={opt.label}
                    type="button"
                    className={opt.code === 'R' ? 'agg rz' : opt.aggressive ? 'agg' : undefined}
                    aria-pressed={row.current === opt.code}
                    onClick={() => setState((s) => applyChoice(s, row.seatIdx, opt.code))}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="panel-h" style={{ marginTop: 4 }}>
        <span className="eyebrow">
          {activeWalk || !node
            ? `${activePos} — NO DECISION`
            : `${activePos}${second ? ' (2ND)' : ''} — ${raise ? 'RAISE / PU' : aggrLabel} RANGE`}
        </span>
        {!isHeroRow && <span className="rt">HERO 以外の行を表示中</span>}
      </div>

      {activeWalk || !node ? (
        <div className="freq">
          <div className="ff" style={{ width: '100%' }}>全員フォールドで BB が取ります</div>
        </div>
      ) : (
        <>
          <div className="freq">
            {rpct > 0 && <div className="fr" style={{ width: `${rpct}%` }}>{fmtPct(rpct)}</div>}
            {pct > 0 && <div className="fp" style={{ width: `${pct}%` }}>{fmtPct(pct)}</div>}
            {fold > 0 && <div className="ff" style={{ width: `${fold}%` }}>{fmtPct(fold)}</div>}
          </div>
          <RangeGrid hands={node.hands} alt={raise?.hands} heroHand={isHeroRow ? result.heroHand : ''} />
          <div className="legend">
            {raise && (
              <span>
                <i style={{ background: 'var(--you)' }} />
                RAISE {result.raiseTo ?? 2}bb
              </span>
            )}
            <span>
              <i style={{ background: 'var(--cpu)' }} />
              {aggrLabel === 'PU' ? 'PUSH' : 'CALL'}
            </span>
            <span>
              <i style={{ background: 'var(--cell)', boxShadow: 'inset 0 0 0 1px var(--hair-2)' }} />FOLD
            </span>
            {isHeroRow && (
              <span>
                <i style={{ boxShadow: 'inset 0 0 0 2px var(--you)' }} />HERO のハンド
              </span>
            )}
          </div>
          {raise && <p className="rangestr">RAISE: {raise.range || '(空)'}</p>}
          <p className="rangestr">{raise ? 'PUSH: ' : ''}{node.range || '(空)'}</p>
        </>
      )}
    </>
  );
}
