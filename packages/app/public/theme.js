// 保存したテーマを、最初の描画より前に当てる（明るい画面が一瞬見えるのを防ぐ）。
try {
  const t = localStorage.getItem('kg-theme');
  if (t) document.documentElement.dataset.theme = t;
} catch {
  // localStorage が使えない環境では、既定のテーマのまま表示する。
}
