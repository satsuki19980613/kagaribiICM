/**
 * 0 以上 1 未満の乱数。`Math.random` と違い、`crypto` から取るので次の値を予測できない
 * （記録の id のように、ほかと重ならないことを当てにする値にも使える）。
 */
export function random01(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}
