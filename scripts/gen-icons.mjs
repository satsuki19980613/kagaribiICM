// public/icon.svg から PWA 用 PNG を生成する（npm run icons）。
// maskable は背景を残したまま <g id="mark"> だけを 80% のセーフゾーンへ縮める。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';

const PUBLIC = resolve(dirname(fileURLToPath(import.meta.url)), '../packages/app/public');
const svg = readFileSync(resolve(PUBLIC, 'icon.svg'), 'utf8');
const maskable = svg.replace('<g id="mark">', '<g id="mark" transform="translate(50 50) scale(.8) translate(-50 -50)">');

for (const [file, size, src] of [
  ['apple-touch-icon.png', 180, svg],
  ['icon-192.png', 192, svg],
  ['icon-512.png', 512, svg],
  ['icon-maskable-512.png', 512, maskable],
  ['favicon-32.png', 32, svg],
]) {
  const png = new Resvg(src, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(resolve(PUBLIC, file), png);
  console.log(`${file} (${size}px)`);
}
