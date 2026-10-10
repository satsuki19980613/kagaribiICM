/**
 * スクショ（File/Blob）→ Rgba 復号（ブラウザ専用）。
 *
 * OCR パイプラインは Rgba（{w,h,data}）を入力に取る。dev では Node の PNG コーデックで
 * 復号するが、アプリでは端末内の Canvas で復号する（SPEC §8: 端末ローカル完結）。
 * ここはブラウザ API（createImageBitmap / Canvas）に依存するので、純ロジック側
 * （prefill.ts の ocrPrefillFromRgba）とは分離してテスト境界を保つ。
 */

import type { Rgba } from '@kagaribi/ocr';

/** 画像 Blob（PNG/JPEG など）を Canvas で復号して Rgba に変換する。 */
export async function decodeToRgba(blob: Blob): Promise<Rgba> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2D Canvas コンテキストを取得できませんでした');
    ctx.drawImage(bitmap, 0, 0);
    const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    // ImageData.data は Uint8ClampedArray（Rgba.data が受け付ける）。
    return { w: id.width, h: id.height, data: id.data };
  } finally {
    bitmap.close();
  }
}

/**
 * 確認用に表示する画像の URL を作る。**選ばれたファイルをそのまま表示せず**、ブラウザで復号して
 * Canvas に描き直したもの（必ずラスタ画像）を blob: URL にする。画像として復号できないファイルは
 * 表示されず、写真に付いているメタデータ（撮影情報など）も描き直しで落ちる。
 * 使い終わったら URL.revokeObjectURL で解放すること。
 */
export async function rasterPreviewUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D Canvas コンテキストを取得できませんでした');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.92));
    if (!blob) throw new Error('画像を描き直せませんでした');
    return URL.createObjectURL(blob);
  } finally {
    bitmap.close();
  }
}
