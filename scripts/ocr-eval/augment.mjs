// OCR の評価用に、正解つきの画像から「劣化させた複製」を作る（手元専用）。
//
// 正解は元の画像と同じなので、目で付け直す必要がない。1 枚の実物から、別の機種の解像度、
// SNS やメッセージアプリを通ったあとの画質（縮小・JPEG / WebP の再圧縮）、色のずれ、ぼけを作り、
// 「どの劣化で、どの項目から先に読めなくなるか」を集計で見る。
//
// これは**頑健さ**の検査で、新しい卓のテーマや画面の配置は増えない。そこは実物を足すしかない。
//
//   node scripts/ocr-eval/augment.mjs     （= npm run ocr:augment）
//   → ocr-local/images/aug__<種類>__<元の名前>.<拡張子> と、truth.json の generated な項目を作り直す
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const dir = resolve(process.env.OCR_EVAL_DIR ?? 'ocr-local');
const imgDir = join(dir, 'images');
const truthPath = join(dir, 'truth.json');
if (!existsSync(truthPath)) {
  console.error(`正解がありません: ${truthPath}`);
  process.exit(1);
}

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

const truth = JSON.parse(readFileSync(truthPath, 'utf8'));
const originals = truth.frames.filter((f) => !f.generated);

// 前回の複製を消す。
for (const f of readdirSync(imgDir)) if (f.startsWith('aug__')) unlinkSync(join(imgDir, f));

const generated = [];
for (const base of originals) {
  const src = join(imgDir, base.file);
  if (!existsSync(src)) continue;
  const stem = base.file.replace(/\.[^.]+$/, '');
  for (const v of VARIANTS) {
    const file = `aug__${v.name}__${stem}.${v.ext}`;
    await v.run(sharp(src)).toFile(join(imgDir, file));
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
