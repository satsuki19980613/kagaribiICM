import type { GameKind, GameMode } from '@kagaribi/core';
import { GAME_KINDS, GAME_KIND_LABELS, GAME_MODE_SPECS, MODES_BY_KIND } from '@kagaribi/core';

/**
 * ゲーム選択（2段セグメント）。上段＝ゲーム（クラブ／ランク／レジェンド）、下段＝その内訳
 * （ランクは STAGE、レジェンドは解くレート）。
 *
 * 下段は内訳の無いゲームでも描いたまま visibility:hidden で隠す（段が出没すると下のボタンが
 * 動き、押す瞬間にずれるため）。選択は系統ごとに保持する（往復しても STAGE 等が戻る）。
 */
export interface GameSel {
  kind: GameKind;
  /** 系統ごとに最後に選んだモード。 */
  last: { [K in GameKind]: GameMode };
}

export const DEFAULT_GAME_SEL: GameSel = {
  kind: 'club',
  last: { club: 'club', rank: 'rank-4', legend: 'legend-avg' },
};

export function selectedMode(sel: GameSel): GameMode {
  return sel.last[sel.kind];
}

export function selFromMode(mode: GameMode | undefined): GameSel {
  const spec = GAME_MODE_SPECS[mode ?? 'club'];
  return { kind: spec.kind, last: { ...DEFAULT_GAME_SEL.last, [spec.kind]: spec.id } };
}

export function GameModeSelect(props: Readonly<{
  sel: GameSel;
  onChange: (next: GameSel) => void;
  disabled?: boolean;
}>): JSX.Element {
  const { sel, disabled } = props;
  const variants = MODES_BY_KIND[sel.kind];
  const hasVariants = variants.length > 1;

  return (
    <div className="gmsel">
      <div className="seg">
        {GAME_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={sel.kind === k}
            disabled={disabled}
            onClick={() => props.onChange({ ...sel, kind: k })}
          >
            {GAME_KIND_LABELS[k]}
          </button>
        ))}
      </div>
      <div className={`seg sm${hasVariants ? '' : ' is-hidden'}`} aria-hidden={hasVariants ? undefined : true}>
        {(hasVariants ? variants : MODES_BY_KIND.legend).map((m) => {
          const spec = GAME_MODE_SPECS[m];
          return (
            <button
              key={m}
              type="button"
              aria-pressed={hasVariants && selectedMode(sel) === m}
              disabled={disabled || !hasVariants}
              onClick={() => props.onChange({ ...sel, last: { ...sel.last, [sel.kind]: m } })}
            >
              {spec.kind === 'rank' ? `STAGE ${spec.variant}` : spec.variant}
            </button>
          );
        })}
      </div>
    </div>
  );
}
