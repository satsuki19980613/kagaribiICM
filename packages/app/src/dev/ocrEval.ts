/**
 * OCR の評価ページ（開発サーバー専用。ビルドには含まれない）。
 *
 * **アプリと同じ経路**で ocr-local/ の画像を通す:
 *   画像ファイル → `prefillFromScreenshot`（ブラウザの createImageBitmap / Canvas で復号 → 読み取り）
 *   → `buildBoardState`（確認画面の局面）→ `solveInWorker`（計算用の Web Worker）
 * どれも App.tsx が呼んでいる関数そのもの。Node の評価（`npm run ocr:eval`）は復号が sharp で、
 * 色の変換や計算の Worker を通らないので、ここでしか見つからない差がある。
 *
 * 画像と正解は vite.config.ts の開発用ミドルウェア（/__ocr-eval/）が ocr-local/ から渡す。
 * URL に `?solve=0` を付けると計算を省く。`?set=web` は ocr-local/web/ の組を使う。
 */

import type { GameMode } from '@kagaribi/core';
import { prefillFromScreenshot } from '../ocr/screenshotPrefill';
import { decodeToRgba } from '../ocr/decodeImage';
import { buildBoardState } from '../formModel';
import { solveInWorker } from '../solverClient';
import { MAX_PLAYERS, solveOptsForN } from '../solveLimits';
import { headlineNode, verdictOf } from '../records/model';
import { checkFrame, comparePaths, pixelDigest, report, type Check, type EvalRun, type PixelDigest, type TruthFrame } from './ocrEvalCore';

interface Listing {
  readonly files: readonly string[];
  readonly truth: { readonly frames: readonly TruthFrame[] } | null;
  readonly nodeRun: EvalRun | null;
}

interface SolveRow {
  readonly file: string;
  readonly outcome: string;
  readonly ms: number;
}

const statusEl = document.getElementById('status')!;
const outEl = document.getElementById('out')!;
const linksEl = document.getElementById('links')!;
const say = (s: string): void => {
  statusEl.textContent = s;
};

function downloadLink(name: string, text: string, type: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.textContent = name;
  linksEl.appendChild(a);
}

async function main(): Promise<void> {
  const set = new URLSearchParams(location.search).get('set') === 'web' ? '?set=web' : '';
  const listing = (await (await fetch(`/__ocr-eval/list${set}`)).json()) as Listing;
  if (!listing.truth) {
    say('ocr-local/truth.json がありません。images/ にスクショ、truth.json に正解を置いてください。');
    return;
  }
  const withSolve = new URLSearchParams(location.search).get('solve') !== '0';
  const labelled = new Set(listing.truth.frames.map((f) => f.file));
  const unlabelled = listing.files.filter((f) => !labelled.has(f));
  const missing = listing.truth.frames.filter((f) => !listing.files.includes(f.file)).map((f) => f.file);

  const checks: Check[] = [];
  const errors: string[] = [];
  const digests: Record<string, PixelDigest> = {};
  const solves: SolveRow[] = [];
  let frames = 0;
  for (const t of listing.truth.frames) {
    const idx = listing.files.indexOf(t.file);
    if (idx < 0) continue;
    say(`${frames + 1} / ${listing.truth.frames.length - missing.length}: ${t.file}`);
    try {
      const blob = await (await fetch(`/__ocr-eval/image/${idx}${set}`)).blob();
      const file = new File([blob], t.file, { type: blob.type });
      const digest = pixelDigest(await decodeToRgba(file));
      digests[t.file] = digest;
      const mode: GameMode = t.gameMode ?? 'club';
      const res = await prefillFromScreenshot(file, mode);
      const fc = checkFrame(t, res, res.imageSize ?? { w: digest.w, h: digest.h });
      const tags = fc[0]?.tags ?? {};
      checks.push(...fc);

      // ここから先は App.tsx の「画像を選ぶ → 計算する」と同じ順番。
      if (res.ok && res.form) {
        const built = buildBoardState(res.form);
        const state = built.ok && built.state && built.state.playersLeft <= MAX_PLAYERS ? built.state : null;
        checks.push({ file: t.file, tags, field: '局面の組み立て', truth: 'ok', read: state ? 'ok' : `失敗(${built.issues.join(' / ')})`, ok: !!state });
        if (withSolve && state) {
          const t0 = performance.now();
          let outcome: string;
          try {
            const { result } = await solveInWorker(state, solveOptsForN(state.playersLeft));
            const head = headlineNode(result);
            outcome = head ? `ok（${head.actionType} ${verdictOf(head)}・${head.pct.toFixed(1)}%）` : 'ok（見出しのノードなし）';
          } catch (e) {
            outcome = `エラー: ${e instanceof Error ? e.message : String(e)}`;
          }
          solves.push({ file: t.file, outcome, ms: Math.round(performance.now() - t0) });
          const want = t.expect.ok ? t.expect.solve : undefined;
          if (want !== undefined) {
            const hit = want === 'ok' ? outcome.startsWith('ok') : outcome.startsWith('エラー') && outcome.includes(want);
            checks.push({ file: t.file, tags, field: '計算', truth: want, read: outcome, ok: hit });
          }
        }
      }
      frames++;
    } catch (e) {
      errors.push(`${t.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const run: EvalRun = { path: 'browser', frames, unlabelled, missing, errors, checks, digests };
  let md = report(frames, checks, unlabelled, missing, errors).replace('# OCR 評価レポート', '# OCR 評価レポート（ブラウザ＝アプリと同じ経路）');
  if (solves.length) {
    md += ['', '## 計算（アプリと同じ Worker）', '', '| 画像 | 結末 | 時間 |', '|---|---|---:|', ...solves.map((s) => `| ${s.file} | ${s.outcome} | ${s.ms} ms |`)].join('\n') + '\n';
  }
  md += listing.nodeRun
    ? comparePaths(listing.nodeRun, run)
    : '\n## 経路の差\n\nNode の結果（ocr-local/report.json）がありません。先に `npm run ocr:eval` を実行してください。\n';
  outEl.textContent = md;
  downloadLink('report-browser.md', md, 'text/markdown');
  downloadLink('report-browser.json', JSON.stringify({ ...run, solves }, null, 1), 'application/json');
  (window as unknown as { __ocrEval?: unknown }).__ocrEval = { run, solves, markdown: md };
  say(`完了: ${frames} 枚・${checks.length} 項目（誤り ${checks.filter((c) => !c.ok).length} 件）`);
}

main().catch((e: unknown) => say(`失敗: ${e instanceof Error ? e.message : String(e)}`));
