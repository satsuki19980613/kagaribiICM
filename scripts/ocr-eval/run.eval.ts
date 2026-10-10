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
 *
 * これは Node の経路（復号は sharp）。**アプリと同じ経路**（ブラウザの復号 → 読み取り → 局面の
 * 組み立て → 計算用 Worker）で確かめるには、`npm run dev` を動かして http://localhost:5180/ocr-eval.html を開く。
 * そのページは、ここが書き出した report.json と突き合わせて、経路による差も出す。
 */

import { it } from 'vitest';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ocrPrefillFromRgba } from '../../packages/app/src/ocr/prefill';
import { getBundledTemplates } from '../../packages/app/src/ocr/bundledTemplates';
import { checkFrame, pixelDigest, report, type Check, type EvalRun, type PixelDigest, type TruthFrame } from '../../packages/app/src/dev/ocrEvalCore';

async function decode(path: string): Promise<{ w: number; h: number; data: Uint8ClampedArray }> {
  const sharp = (await import('sharp')).default;
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length) };
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
  const digests: Record<string, PixelDigest> = {};
  let frames = 0;
  for (const t of truth.frames) {
    if (!files.includes(t.file)) continue;
    try {
      const img = await decode(join(imgDir, t.file));
      digests[t.file] = pixelDigest(img);
      const r = ocrPrefillFromRgba(img as never, templates, {}, t.gameMode ?? 'club');
      checks.push(...checkFrame(t, r, img));
      frames++;
    } catch (e) {
      errors.push(`${t.file}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const md = report(frames, checks, unlabelled, missing, errors);
  writeFileSync(join(dir, 'report.md'), md);
  const run: EvalRun = { path: 'node', frames, unlabelled, missing, errors, checks, digests };
  writeFileSync(join(dir, 'report.json'), JSON.stringify(run, null, 1));
  console.log(md);
  console.log(`→ ${join(dir, 'report.md')}`);
}, 600_000);
