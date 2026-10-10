// OCR の評価用に、正解つきの画像から「劣化させた複製」を作る（手元専用）。
//
// 正解は元の画像と同じなので、目で付け直す必要がない。1 枚の実物から、別の機種の解像度、
// SNS やメッセージアプリを通ったあとの画質（縮小・JPEG / WebP の再圧縮）、色のずれ、ぼけを作り、
// 「どの劣化で、どの項目から先に読めなくなるか」を集計で見る。
//
// これは**頑健さ**の検査で、新しい卓のテーマや画面の配置は増えない。そこは実物を足すしかない。
//
//   node scripts/ocr-eval/augment.mjs          （= npm run ocr:augment）
//   node scripts/ocr-eval/augment.mjs holdout  （別条件の組に入れ替える）
//   node scripts/ocr-eval/augment.mjs fresh    （さらに別条件。きつい条件を含む）
//   → ocr-local/images/aug__<種類>__<元の名前>.<拡張子> と、truth.json の generated な項目を作り直す
import { readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const dir = resolve(process.env.OCR_EVAL_DIR ?? 'ocr-local');
const imgDir = join(dir, 'images');
const truthPath = join(dir, 'truth.json');

/** 種類ごとの変換。kind は集計の切り口（variant より粗い）。 */
const VARIANTS = [
  // 別の機種の解像度（縦横比は元のまま）。
  ...[2796, 2532, 2340, 1792, 1560, 1280].map((w) => ({ name: `w${w}`, kind: '縮小・拡大', ext: 'png', run: (s) => s.resize({ width: w }).png() })),
  // 原寸のまま再圧縮。
  ...[90, 75, 60, 40].map((q) => ({ name: `jpeg${q}`, kind: 'JPEG', ext: 'jpg', run: (s) => s.jpeg({ quality: q }) })),
  { name: 'webp80', kind: 'WebP', ext: 'webp', run: (s) => s.webp({ quality: 80 }) },
  // SNS・メッセージアプリを通ったあとを想定（縮小＋再圧縮）。
  { name: 'w2048-jpeg85', kind: '縮小＋JPEG', ext: 'jpg', run: (s) => s.resize({ width: 2048 }).jpeg({ quality: 85 }) },
  { name: 'w1568-jpeg70', kind: '縮小＋JPEG', ext: 'jpg', run: (s) => s.resize({ width: 1568 }).jpeg({ quality: 70 }) },
  { name: 'w1280-jpeg60', kind: '縮小＋JPEG', ext: 'jpg', run: (s) => s.resize({ width: 1280 }).jpeg({ quality: 60 }) },
  // 色のずれ（広色域の画像を色の変換なしで開いた、明るさの調整がかかった、など）。
  { name: 'sat115', kind: '色', ext: 'png', run: (s) => s.modulate({ saturation: 1.15 }).png() },
  { name: 'sat87', kind: '色', ext: 'png', run: (s) => s.modulate({ saturation: 0.87 }).png() },
  { name: 'bright108', kind: '色', ext: 'png', run: (s) => s.modulate({ brightness: 1.08 }).png() },
  { name: 'bright92', kind: '色', ext: 'png', run: (s) => s.modulate({ brightness: 0.92 }).png() },
  { name: 'blur06', kind: 'ぼけ', ext: 'png', run: (s) => s.blur(0.6).png() },
];

// 調整に使っていない条件の組（`node scripts/ocr-eval/augment.mjs holdout`）。上の組で誤りを直したあと、
// その直し方がほかの条件でも通用するかを確かめるために使う。
const HOLDOUT = [
  ...[2208, 1920, 1440].map((w) => ({ name: `w${w}`, kind: '縮小・拡大', ext: 'png', run: (s) => s.resize({ width: w }).png() })),
  ...[85, 70, 50, 30].map((q) => ({ name: `jpeg${q}`, kind: 'JPEG', ext: 'jpg', run: (s) => s.jpeg({ quality: q }) })),
  { name: 'webp60', kind: 'WebP', ext: 'webp', run: (s) => s.webp({ quality: 60 }) },
  { name: 'w1920-jpeg80', kind: '縮小＋JPEG', ext: 'jpg', run: (s) => s.resize({ width: 1920 }).jpeg({ quality: 80 }) },
  { name: 'w1440-jpeg65', kind: '縮小＋JPEG', ext: 'jpg', run: (s) => s.resize({ width: 1440 }).jpeg({ quality: 65 }) },
  { name: 'sat125', kind: '色', ext: 'png', run: (s) => s.modulate({ saturation: 1.25 }).png() },
  { name: 'sat80', kind: '色', ext: 'png', run: (s) => s.modulate({ saturation: 0.8 }).png() },
  { name: 'bright112', kind: '色', ext: 'png', run: (s) => s.modulate({ brightness: 1.12 }).png() },
  { name: 'bright88', kind: '色', ext: 'png', run: (s) => s.modulate({ brightness: 0.88 }).png() },
  { name: 'gamma', kind: '色', ext: 'png', run: (s) => s.gamma(1.3).png() },
  { name: 'blur10', kind: 'ぼけ', ext: 'png', run: (s) => s.blur(1.0).png() },
  { name: 'sharpen', kind: 'ぼけ', ext: 'png', run: (s) => s.sharpen().png() },
];
// さらに別の条件（`... augment.mjs fresh`）。上の 2 組はどちらも調整に使ったので、直したあとの
// 「見ていない条件での成績」はこの組で測る。きつい条件も入れてあり、読めなくなる境目を見る。
const FRESH = [
  ...[2400, 1700, 1100].map((w) => ({ name: `w${w}`, kind: '縮小・拡大', ext: 'png', run: (s) => s.resize({ width: w }).png() })),
  ...[95, 55, 20].map((q) => ({ name: `jpeg${q}`, kind: 'JPEG', ext: 'jpg', run: (s) => s.jpeg({ quality: q }) })),
  { name: 'webp40', kind: 'WebP', ext: 'webp', run: (s) => s.webp({ quality: 40 }) },
  { name: 'w1700-jpeg75', kind: '縮小＋JPEG', ext: 'jpg', run: (s) => s.resize({ width: 1700 }).jpeg({ quality: 75 }) },
  { name: 'w1100-jpeg50', kind: '縮小＋JPEG', ext: 'jpg', run: (s) => s.resize({ width: 1100 }).jpeg({ quality: 50 }) },
  { name: 'sat135', kind: '色', ext: 'png', run: (s) => s.modulate({ saturation: 1.35 }).png() },
  { name: 'sat70', kind: '色', ext: 'png', run: (s) => s.modulate({ saturation: 0.7 }).png() },
  { name: 'bright120', kind: '色', ext: 'png', run: (s) => s.modulate({ brightness: 1.2 }).png() },
  { name: 'bright80', kind: '色', ext: 'png', run: (s) => s.modulate({ brightness: 0.8 }).png() },
  { name: 'gamma18', kind: '色', ext: 'png', run: (s) => s.gamma(1.8).png() },
  { name: 'hue8', kind: '色', ext: 'png', run: (s) => s.modulate({ hue: 8 }).png() },
  { name: 'blur15', kind: 'ぼけ', ext: 'png', run: (s) => s.blur(1.5).png() },
  { name: 'sat85-bright93-jpeg80', kind: '組み合わせ', ext: 'jpg', run: (s) => s.modulate({ saturation: 0.85, brightness: 0.93 }).jpeg({ quality: 80 }) },
  { name: 'w2000-sat110-jpeg70', kind: '組み合わせ', ext: 'jpg', run: (s) => s.resize({ width: 2000 }).modulate({ saturation: 1.1 }).jpeg({ quality: 70 }) },
];
const variants = process.argv[2] === 'holdout' ? HOLDOUT : process.argv[2] === 'fresh' ? FRESH : VARIANTS;

let truth;
try {
  truth = JSON.parse(readFileSync(truthPath, 'utf8'));
} catch (e) {
  console.error(`正解を読めません: ${truthPath}（${e instanceof Error ? e.message : e}）`);
  process.exit(1);
}
const originals = truth.frames.filter((f) => !f.generated);

// 前回の複製を消す。
for (const f of readdirSync(imgDir)) if (f.startsWith('aug__')) unlinkSync(join(imgDir, f));

const generated = [];
for (const base of originals) {
  let input;
  try {
    input = readFileSync(join(imgDir, base.file));
  } catch {
    continue; // 正解はあるが画像が無い
  }
  const stem = base.file.replace(/\.[^.]+$/, '');
  for (const v of variants) {
    const file = `aug__${v.name}__${stem}.${v.ext}`;
    writeFileSync(join(imgDir, file), await v.run(sharp(input)).toBuffer());
    generated.push({
      ...base,
      file,
      generated: true,
      source: `${base.file} の複製（${v.name}）`,
      tags: { ...(base.tags ?? {}), quality: v.kind, variant: v.name, base: base.file },
    });
  }
}
writeFileSync(truthPath, JSON.stringify({ frames: [...originals, ...generated] }, null, 2) + '\n');
console.log(`元の画像 ${originals.length} 枚 → 複製 ${generated.length} 枚を作りました（${imgDir}）`);
