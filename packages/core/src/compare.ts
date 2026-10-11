/**
 * 文字列を UTF-16 の符号単位の順で比べる（引数なしの `sort()` と同じ並び）。
 * ロケールに依らないので、どの環境でも同じ順になる。
 */
export function compareCodeUnits(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}
