import { defineConfig } from 'vitest/config';

// OCR の評価（手元専用）。`npm test` の対象とは別にして、`npm run ocr:eval` でだけ動かす。
export default defineConfig({
  test: {
    include: ['scripts/ocr-eval/*.eval.ts'],
    environment: 'node',
    globals: false,
  },
});
