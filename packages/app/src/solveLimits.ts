/**
 * 計算にかける局面の上限と、人数ごとの求解パラメータ。
 * 画面（App.tsx）と、開発用の OCR 評価ページ（dev/ocrEval.ts）が同じ値を使う。
 */

/** 対応人数の上限（ポーカーチェイスは 6 人卓）。 */
export const MAX_PLAYERS = 6;

/**
 * 人数に応じた求解パラメータ。ショーダウン MC は Web Worker 並列（mcPool）。
 * exploitability がしきい値に達すれば早期終了する。
 */
export function solveOptsForN(n: number): { maxIters?: number; samples?: number } {
  switch (n) {
    case 2:
      return {};
    case 3:
      return { maxIters: 1500, samples: 50_000 };
    case 4:
      return { maxIters: 2000, samples: 40_000 };
    case 5:
      return { maxIters: 3000, samples: 32_000 };
    default:
      return { maxIters: 3000, samples: 24_000 };
  }
}
