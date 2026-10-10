/**
 * OCR の評価（手元専用）。正解データと OCR の読み取りを突き合わせ、集計から問題を探す。
 *
 * 進め方（さつき決定 2026-10-10）:
 *   1. スクショを**目で見て**正解を決める（OCR の結果は見ない。見ると正解が OCR に引きずられる）
 *   2. 正解を静的なデータ（`ocr-local/truth.json`）にまとめる
 *   3. このスクリプトが全画像を OCR に通し、項目ごとに正誤を記録する
 *   4. 項目・席・テーマ・機種ごとに集計して、誤りが偏っているところを探す
 *
 * 画像と正解は `ocr-local/`（.gitignore 済み）に置く。他の人の名前が写ったスクショや、ゲーム画面の
 * 画像を公開リポジトリに入れないため。したがって CI では動かない（`npm test` の対象外）。
 *
 *   ocr-local/images/*.png|jpg|webp   スクショ
 *   ocr-local/truth.json              正解（形式は truth.example.json）
 *   ocr-local/report.md / report.json 出力
 *
 * 実行: `npm run ocr:eval`（別の場所を使うなら環境変数 OCR_EVAL_DIR）
 */

import { it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { GameMode, Position } from '@kagaribi/core';
import type { RawSeatRead, SeatAction } from '@kagaribi/ocr';
import { ocrPrefillFromRgba, type OcrPrefillResult } from '../../packages/app/src/ocr/prefill';
import { getBundledTemplates } from '../../packages/app/src/ocr/bundledTemplates';

const SLOTS = ['TL', 'TC', 'TR', 'BR', 'BC', 'BL'] as const;
type Slot = (typeof SLOTS)[number];

interface TruthSeat {
  /** 画面に表示されているスタック（BB）。 */
  readonly stack: number;
  /** 席の前に置かれているチップ（BB）。無ければ 0。 */
  readonly bet: number;
  /** 行動マーク。マークが無ければ 'none'。 */
  readonly action: SeatAction;
}

interface TruthFrame {
  readonly file: string;
  /** 出どころ（誰の・いつの・どこから）。 */
  readonly source?: string;
  /** 集計の切り口（theme / device / quality など自由）。 */
  readonly tags?: Record<string, string>;
  readonly gameMode?: GameMode;
  readonly displayMode: 'bb' | 'chips';
  readonly pot?: number;
  readonly heroHand?: string;
  readonly blindChips?: { readonly sb: number; readonly bb: number; readonly ante: number };
  /** D ボタンのある席・自分の席。 */
  readonly button?: Slot;
  readonly hero?: Slot;
  /** 席ごとの正解。書いていない席は空席。 */
  readonly seats?: Partial<Record<Slot, TruthSeat>>;
  /** 取り込みの結末。ok なら復元される内容、弾くなら理由コード（issueCodes.ts）。 */
  readonly expect:
    | { readonly ok: true; readonly heroPos: Position; readonly raiser?: Position; readonly raiseTo?: number }
    | { readonly ok: false; readonly code: string };
  readonly note?: string;
}

interface Check {
  readonly file: string;
  readonly tags: Record<string, string>;
  readonly slot?: Slot;
  readonly field: string;
  readonly truth: string;
  readonly read: string;
  readonly conf?: number;
  readonly ok: boolean;
}

const TOL = 0.051;
const num = (x: number): string => (Number.isFinite(x) ? String(Math.round(x * 100) / 100) : '未読');
const near = (a: number, b: number): boolean => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= TOL;

async function decode(path: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
}

/** 1 枚ぶんの突き合わせ。 */
function checkFrame(t: TruthFrame, r: OcrPrefillResult, size: { w: number; h: number }): Check[] {
  const tags = { aspect: (size.w / size.h).toFixed(2), ...(t.tags ?? {}) };
  const out: Check[] = [];
  const add = (field: string, truth: string, read: string, ok: boolean, extra: { slot?: Slot; conf?: number } = {}): void => {
    out.push({ file: t.file, tags, field, truth, read, ok, ...extra });
  };

  // --- 取り込みの結末 ---
  const codes = r.issueCodes ?? [];
  if (t.expect.ok) {
    add('結末', 'ok', r.ok ? 'ok' : `棄却(${codes.join(',') || '理由なし'})`, r.ok);
  } else {
    const hit = !r.ok && codes.includes(t.expect.code);
    add('結末', `棄却(${t.expect.code})`, r.ok ? 'ok' : `棄却(${codes.join(',') || '理由なし'})`, hit);
  }

  const ro = r.readout;
  if (!ro) return out;
  add('表示モード', t.displayMode, ro.displayMode ?? '不明', (ro.displayMode ?? 'bb') === t.displayMode);
  // チップ表示は取り込み対象外（早期に弾く）ので、席の中身は比べない。
  if (t.displayMode !== 'bb') return out;

  if (t.pot !== undefined) add('ポット', num(t.pot), num(ro.pot.value), near(ro.pot.value, t.pot), { conf: ro.pot.conf });
  if (t.heroHand !== undefined) add('ハンド', t.heroHand, ro.heroHand.value || '未読', ro.heroHand.value === t.heroHand, { conf: ro.heroHand.conf });
  if (t.blindChips) {
    const b = ro.blindChips;
    const same = !!b && b.sb === t.blindChips.sb && b.bb === t.blindChips.bb && b.ante === t.blindChips.ante;
    add('ブラインド', `${t.blindChips.sb}/${t.blindChips.bb}/${t.blindChips.ante}`, b ? `${b.sb}/${b.bb}/${b.ante}` : '未読', same);
  }

  // 席の読み取りは、総チップの照合で補正する**前**の生の値で比べる（抽出の精度を見るため）。
  const raw: readonly RawSeatRead[] = r.reads?.seats ?? ro.seats;
  const bySlot = new Map<string, RawSeatRead>(raw.map((s) => [s.id, s]));
  if (t.button) {
    const b = raw.filter((s) => s.isButton).map((s) => s.id).join(',') || 'なし';
    add('Dボタン', t.button, b, b === t.button);
  }
  if (t.hero) {
    const h = raw.filter((s) => s.isHero).map((s) => s.id).join(',') || 'なし';
    add('自分の席', t.hero, h, h === t.hero);
  }
  for (const slot of SLOTS) {
    const truth = t.seats?.[slot];
    const read = bySlot.get(slot);
    const readOcc = read && read.occupancy.value === 'occupied' ? '在席' : '空席';
    add('在席', truth ? '在席' : '空席', readOcc, (truth ? '在席' : '空席') === readOcc, { slot, ...(read ? { conf: read.occupancy.conf } : {}) });
    if (!truth) continue;
    const stack = read ? read.stack.value : NaN;
    add('スタック', num(truth.stack), num(stack), near(stack, truth.stack), { slot, ...(read ? { conf: read.stack.conf } : {}) });
    const action = read ? read.action.value : 'none';
    add('行動マーク', truth.action, action, action === truth.action, { slot, ...(read ? { conf: read.action.conf } : {}) });
    // フォールドした席のチップは読まない設計なので比べない。
    if (truth.action !== 'fold') {
      const bet = read ? read.bet.value : NaN;
      add('ベット', num(truth.bet), num(bet), near(bet, truth.bet), { slot, ...(read ? { conf: read.bet.conf } : {}) });
    }
  }

  // --- 復元した局面（確認画面に出る内容）---
  if (t.expect.ok && r.ok && r.form) {
    const f = r.form;
    add('復元: 自分の位置', t.expect.heroPos, f.heroPos, f.heroPos === t.expect.heroPos);
    const players = Object.keys(t.seats ?? {}).length;
    add('復元: 人数', String(players), String(f.playersLeft), f.playersLeft === players);
    add('復元: レイズした人', t.expect.raiser ?? 'なし', f.raiser || 'なし', (f.raiser || undefined) === t.expect.raiser);
    if (t.expect.raiseTo !== undefined) {
      add('復元: レイズ額', num(t.expect.raiseTo), f.raiseTo ?? '未読', near(Number(f.raiseTo), t.expect.raiseTo));
    }
    // 確認画面のスタック = 表示スタック ＋ 自分から出したチップ（ブラインドぶんは除く）。
    const sbBb = t.blindChips ? t.blindChips.sb / t.blindChips.bb : 0.5;
    for (const s of ro.seats) {
      const truth = t.seats?.[s.id as Slot];
      if (!truth || !s.pos) continue;
      const pos = s.pos as Position;
      const blindOb = pos === 'SB' ? sbBb : pos === 'BB' ? 1 : 0;
      const voluntary = truth.action === 'raise' || truth.action === 'call' || truth.action === 'allin';
      const expected = truth.stack + (voluntary ? truth.bet - blindOb : 0);
      const got = Number(f.stacks[pos]);
      add('復元: スタック', num(expected), num(got), near(got, expected), { slot: s.id as Slot });
    }
  }
  return out;
}

interface Tally { n: number; bad: number }
function tally(checks: readonly Check[], keyOf: (c: Check) => string | undefined): Map<string, Tally> {
  const m = new Map<string, Tally>();
  for (const c of checks) {
    const k = keyOf(c);
    if (k === undefined) continue;
    const t = m.get(k) ?? { n: 0, bad: 0 };
    t.n++;
    if (!c.ok) t.bad++;
    m.set(k, t);
  }
  return m;
}
const pct = (t: Tally): string => `${(((t.n - t.bad) / t.n) * 100).toFixed(1)}%`;

function report(frames: number, checks: readonly Check[], unlabelled: readonly string[], missing: readonly string[], errors: readonly string[]): string {
  const L: string[] = [];
  L.push('# OCR 評価レポート', '', `- 正解つきの画像: ${frames} 枚`, `- 突き合わせた項目: ${checks.length} 件（誤り ${checks.filter((c) => !c.ok).length} 件）`);
  if (unlabelled.length) L.push(`- 正解が未作成の画像: ${unlabelled.length} 枚（${unlabelled.join(', ')}）`);
  if (missing.length) L.push(`- 正解はあるが画像が無い: ${missing.join(', ')}`);
  if (errors.length) L.push(`- 読み込みで例外: ${errors.join(' / ')}`);

  const table = (title: string, m: Map<string, Tally>): void => {
    if (m.size === 0) return;
    L.push('', `## ${title}`, '', '| 区分 | 件数 | 誤り | 正答率 |', '|---|---:|---:|---:|');
    for (const [k, t] of [...m].sort((a, b) => b[1].bad / b[1].n - a[1].bad / a[1].n || b[1].n - a[1].n)) {
      L.push(`| ${k} | ${t.n} | ${t.bad} | ${pct(t)} |`);
    }
  };
  table('項目ごと', tally(checks, (c) => c.field));
  table('席ごと（席の項目だけ）', tally(checks, (c) => c.slot));
  const tagKeys = [...new Set(checks.flatMap((c) => Object.keys(c.tags)))];
  for (const key of tagKeys) table(`${key} ごと`, tally(checks, (c) => c.tags[key]));

  // 誤りが偏っているところ: 「項目 × 切り口」で、その項目の全体より誤り率が高い組を挙げる。
  const overall = tally(checks, (c) => c.field);
  const cands: { key: string; t: Tally; base: number }[] = [];
  const cut = (label: string, keyOf: (c: Check) => string | undefined): void => {
    for (const [k, t] of tally(checks, (c) => { const v = keyOf(c); return v === undefined ? undefined : `${c.field} × ${label}=${v}`; })) {
      const field = k.split(' × ')[0]!;
      const o = overall.get(field)!;
      const base = o.bad / o.n;
      if (t.bad >= 2 && t.bad / t.n > base * 1.5 && t.n < o.n) cands.push({ key: k, t, base });
    }
  };
  cut('席', (c) => c.slot);
  for (const key of tagKeys) cut(key, (c) => c.tags[key]);
  L.push('', '## 誤りが偏っているところ（問題の候補）', '');
  if (cands.length === 0) L.push('該当なし（誤りが 2 件以上あり、その項目の全体より 1.5 倍以上の誤り率の組）。');
  else {
    L.push('| 組 | 件数 | 誤り | 誤り率 | その項目の全体 |', '|---|---:|---:|---:|---:|');
    for (const c of cands.sort((a, b) => b.t.bad - a.t.bad)) {
      L.push(`| ${c.key} | ${c.t.n} | ${c.t.bad} | ${((c.t.bad / c.t.n) * 100).toFixed(0)}% | ${(c.base * 100).toFixed(0)}% |`);
    }
  }

  // 行動マークの取り違え。
  const acts = checks.filter((c) => c.field === '行動マーク');
  if (acts.length) {
    const labels = [...new Set(acts.flatMap((c) => [c.truth, c.read]))].sort();
    L.push('', '## 行動マークの取り違え（行＝正解、列＝読み取り）', '', `| | ${labels.join(' | ')} |`, `|---|${labels.map(() => '---:').join('|')}|`);
    for (const t of labels) {
      L.push(`| **${t}** | ${labels.map((r) => acts.filter((c) => c.truth === t && c.read === r).length || '').join(' | ')} |`);
    }
  }

  // 信頼度: 誤っているのに信頼度が高い読み取りは、確認画面で強調されないので特に危ない。
  const withConf = checks.filter((c) => c.conf !== undefined);
  if (withConf.length) {
    L.push('', '## 信頼度と正誤', '', '| 項目 | 正しい読みの平均 | 誤った読みの平均 | 誤りのうち信頼度 0.8 以上 |', '|---|---:|---:|---:|');
    for (const field of [...new Set(withConf.map((c) => c.field))]) {
      const xs = withConf.filter((c) => c.field === field);
      const good = xs.filter((c) => c.ok), bad = xs.filter((c) => !c.ok);
      const mean = (a: readonly Check[]): string => (a.length ? (a.reduce((s, c) => s + c.conf!, 0) / a.length).toFixed(2) : '—');
      L.push(`| ${field} | ${mean(good)} | ${mean(bad)} | ${bad.filter((c) => c.conf! >= 0.8).length} / ${bad.length} |`);
    }
  }

  const bad = checks.filter((c) => !c.ok);
  L.push('', '## 誤りの一覧', '');
  if (bad.length === 0) L.push('誤りなし。');
  else {
    L.push('| 画像 | 席 | 項目 | 正解 | 読み取り | 信頼度 |', '|---|---|---|---|---|---:|');
    for (const c of bad) L.push(`| ${c.file} | ${c.slot ?? ''} | ${c.field} | ${c.truth} | ${c.read} | ${c.conf !== undefined ? c.conf.toFixed(2) : ''} |`);
  }
  return L.join('\n') + '\n';
}

it('OCR の評価', async () => {
  const dir = resolve(process.env.OCR_EVAL_DIR ?? 'ocr-local');
  const truthPath = join(dir, 'truth.json');
  const imgDir = join(dir, 'images');
  if (!existsSync(truthPath) || !existsSync(imgDir)) {
    console.log(`評価用のデータがありません: ${dir}\n  images/ にスクショ、truth.json に正解を置いてください（形式は scripts/ocr-eval/truth.example.json）。`);
    return;
  }
  const truth = JSON.parse(readFileSync(truthPath, 'utf8')) as { frames: TruthFrame[] };
  const files = readdirSync(imgDir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  const labelled = new Set(truth.frames.map((f) => f.file));
  const unlabelled = files.filter((f) => !labelled.has(f));
  const missing = truth.frames.filter((f) => !files.includes(f.file)).map((f) => f.file);

  const templates = getBundledTemplates();
  const checks: Check[] = [];
  const errors: string[] = [];
  let frames = 0;
  for (const t of truth.frames) {
    if (!files.includes(t.file)) continue;
    try {
      const img = await decode(join(imgDir, t.file));
      const r = ocrPrefillFromRgba(img as never, templates, {}, t.gameMode ?? 'club');
      checks.push(...checkFrame(t, r, img));
      frames++;
    } catch (e) {
      errors.push(`${t.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const md = report(frames, checks, unlabelled, missing, errors);
  writeFileSync(join(dir, 'report.md'), md);
  writeFileSync(join(dir, 'report.json'), JSON.stringify({ frames, unlabelled, missing, errors, checks }, null, 1));
  console.log(md);
  console.log(`→ ${join(dir, 'report.md')}`);
}, 600_000);
