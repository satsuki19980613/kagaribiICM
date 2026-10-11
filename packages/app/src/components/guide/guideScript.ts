import { GAME_KIND_LABELS, GAME_KINDS, GAME_MODE_SPECS, MODES_BY_KIND, gameModeLabel, type GameKind, type GameMode } from '@kagaribi/core';
import sampleUrl from '../../assets/guide-sample.webp';

/**
 * 使い方ガイドのアニメーション。各ステップを 1 回ずつ順に再生し（最後の次は最初へ戻る）、実際の画面と同じ部品（.seg / .mbtn / .seats / .rec /
 * .verdict-panel）を縮小して動かす。スクショは見本画像（guide-sample.webp）を使い、読み取る場所へ
 * カメラを寄せて見せる（小さい画面でも数字が読めるように）。
 *
 * 見本の値は、この画像を実際に読み取って計算した結果（クラブマッチ・3 人・BU 15.9bb・72o → FOLD）。
 */

const STOP = Symbol('stop');
const EASE = 'cubic-bezier(.2,.8,.2,1)';
const IW = 2000;
const IH = 818;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
// 見本画像の中の読み取り位置（画像のピクセル座標）
const R = {
  full: { x: 0, y: 0, w: IW, h: IH },
  blinds: { x: 215, y: 4, w: 445, h: 88 },
  street: { x: 465, y: 40, w: 195, h: 50 },
  hero: { x: 885, y: 478, w: 490, h: 192 },
  heroStack: { x: 1085, y: 578, w: 285, h: 92 },
  sb: { x: 895, y: 100, w: 295, h: 142 },
  bb: { x: 1295, y: 380, w: 450, h: 176 },
  pot: { x: 858, y: 244, w: 364, h: 54 },
} satisfies Record<string, Rect>;

// 一度だけ読み込んでおき、各ループでは decode 済みのものを表示する
let sampleReady: Promise<void> | null = null;
function preloadSample(): Promise<void> {
  if (!sampleReady) {
    const img = new Image();
    img.src = sampleUrl;
    sampleReady = img.decode().catch(() => undefined);
  }
  return sampleReady;
}

/* ---------- timing ---------- */
class Ctx {
  private alive = true;
  private anims: Animation[] = [];
  constructor(readonly reduce: boolean) {}
  ok(): void {
    if (!this.alive) throw STOP;
  }
  /** await しない効果（パルス等）が止められたときに unhandled rejection にしない。 */
  private quiet(p: Promise<void>): Promise<void> {
    p.catch(() => undefined);
    return p;
  }
  wait(ms: number): Promise<void> {
    return this.quiet(new Promise<void>((r) => setTimeout(r, this.reduce ? 0 : ms)).then(() => this.ok()));
  }
  anim(el: Element, kf: Keyframe[], o: KeyframeAnimationOptions): Promise<void> {
    if (this.reduce) return this.quiet(Promise.resolve().then(() => this.ok()));
    const a = el.animate(kf, o);
    this.anims.push(a);
    return this.quiet(
      a.finished.then(
        () => {
          const k = this.anims.indexOf(a);
          if (k >= 0 && !o.fill) this.anims.splice(k, 1);
          this.ok();
        },
        () => this.ok(),
      ),
    );
  }
  halt(): void {
    this.alive = false;
    for (const a of this.anims) a.cancel();
    this.anims = [];
  }
}

/* ---------- stage ---------- */
interface Stage {
  root: HTMLElement;
  scene: HTMLElement;
  body: HTMLElement;
  strip: HTMLElement;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  e.innerHTML = html;
  return e;
}
const q = <T extends Element = HTMLElement>(root: ParentNode, s: string): T => root.querySelector(s) as T;

/** 実際の画面の部品を縮小して中央に置く（幅 340px で組み、ステージに収まる倍率にする）。 */
function mini(st: Stage, html: string): HTMLElement {
  const m = el('div', 'gs-mini', html);
  st.body.append(m);
  fit(st, m);
  return m;
}
function fit(st: Stage, m: HTMLElement): void {
  const W = st.body.clientWidth;
  const H = st.body.clientHeight;
  const s = Math.min(1.12, (W - 28) / m.offsetWidth, (H - 20) / m.offsetHeight);
  m.style.transform = `translate(-50%,-50%) scale(${s})`;
}
async function swap(x: Ctx, st: Stage, from: HTMLElement, html: string): Promise<HTMLElement> {
  await x.anim(from, [{ opacity: 1 }, { opacity: 0 }], { duration: 200, easing: 'ease-in', fill: 'forwards' });
  from.remove();
  const m = mini(st, html);
  await x.anim(m, [{ opacity: 0, translate: '0 6px' }, { opacity: 1, translate: '0 0' }], { duration: 280, easing: EASE });
  return m;
}

/** 指でタップする印。押した部品も少し沈ませる。 */
async function tap(x: Ctx, st: Stage, target: Element): Promise<void> {
  const S = st.root.getBoundingClientRect();
  const r = target.getBoundingClientRect();
  const d = el('i', 'gs-tap');
  d.style.left = `${r.left - S.left + r.width / 2}px`;
  d.style.top = `${r.top - S.top + r.height / 2}px`;
  st.root.append(d);
  try {
    await x.anim(d, [{ opacity: 0, scale: '1.7' }, { opacity: 1, scale: '1' }], { duration: 340, easing: EASE, fill: 'forwards' });
    void x.anim(target, [{ scale: '1' }, { scale: '.96' }, { scale: '1' }], { duration: 240, easing: 'ease-out' });
    await x.anim(d, [{ opacity: 1, scale: '1' }, { opacity: 0, scale: '.6' }], { duration: 280, delay: 120, easing: 'ease-in', fill: 'forwards' });
  } finally {
    d.remove();
  }
}
function pulse(x: Ctx, e: Element): Promise<void> {
  return x.anim(e, [{ scale: '1' }, { scale: '1.08' }, { scale: '1' }], { duration: 420, easing: 'ease-out' });
}
function strip(x: Ctx, st: Stage, html: string): void {
  st.strip.innerHTML = html;
  const c = st.strip.firstElementChild;
  if (c) void x.anim(c, [{ opacity: 0, translate: '0 4px' }, { opacity: 1, translate: '0 0' }], { duration: 260, easing: EASE });
}
const read = (k: string, v: string, s = ''): string =>
  `<span class="gs-r"><span class="eyebrow">${k}</span><b>${v}</b>${s ? `<span>${s}</span>` : ''}</span>`;
const ok = (t: string, v = ''): string => `<span class="gs-r"><i class="gem"></i><span class="gs-t">${t}</span>${v ? `<b>${v}</b>` : ''}</span>`;
const note = (k: string, t: string): string => `<span class="gs-r"><span class="eyebrow">${k}</span><span class="gs-t">${t}</span></span>`;

/* ---------- camera（見本スクショ） ---------- */
interface View {
  tx: number;
  ty: number;
  z: number;
}
interface Cam {
  el: HTMLElement;
  img: HTMLImageElement;
  box: HTMLElement;
  W: number;
  H: number;
  s0: number;
  v: View;
}
const tf = (v: View): string => `translate(${v.tx}px,${v.ty}px) scale(${v.z})`;

async function camera(st: Stage): Promise<Cam> {
  await preloadSample();
  const c = el('div', 'gs-cam', `<img src="${sampleUrl}" alt="" draggable="false"><i class="gs-box"></i><i class="gs-flash"></i>`);
  st.body.append(c);
  const W = c.clientWidth;
  const H = c.clientHeight;
  const s0 = Math.min(W / IW, H / IH);
  const img = q<HTMLImageElement>(c, 'img');
  img.style.width = `${IW * s0}px`;
  img.style.height = `${IH * s0}px`;
  const cam: Cam = { el: c, img, box: q(c, '.gs-box'), W, H, s0, v: { tx: 0, ty: 0, z: 1 } };
  cam.v = view(cam, null);
  img.style.transform = tf(cam.v);
  return cam;
}
/** 領域が画面の 8 割ほどに収まる倍率で、その中心へ寄せる（画像の外は見せない）。 */
function view(c: Cam, r: Rect | null): View {
  const z = r ? Math.max(1, Math.min(4.2, (0.84 * c.W) / (r.w * c.s0), (0.66 * c.H) / (r.h * c.s0))) : 1;
  const w = IW * c.s0 * z;
  const h = IH * c.s0 * z;
  const cx = r ? r.x + r.w / 2 : IW / 2;
  const cy = r ? r.y + r.h / 2 : IH / 2;
  const clamp = (t: number, size: number, frame: number): number => (size <= frame ? (frame - size) / 2 : Math.min(0, Math.max(frame - size, t)));
  return { z, tx: clamp(c.W / 2 - z * c.s0 * cx, w, c.W), ty: clamp(c.H / 2 - z * c.s0 * cy, h, c.H) };
}
async function look(x: Ctx, c: Cam, r: Rect | null, dur = 900): Promise<void> {
  const from = tf(c.v);
  const v = view(c, r);
  c.v = v;
  if (c.box.style.opacity === '1') {
    c.box.style.opacity = '0';
    void x.anim(c.box, [{ opacity: 1 }, { opacity: 0 }], { duration: 180 });
  }
  c.img.style.transform = tf(v);
  await x.anim(c.img, [{ transform: from }, { transform: tf(v) }], { duration: dur, easing: EASE });
  if (!r) return;
  const k = v.z * c.s0;
  const pad = 4;
  Object.assign(c.box.style, {
    left: `${v.tx + r.x * k - pad}px`,
    top: `${v.ty + r.y * k - pad}px`,
    width: `${r.w * k + pad * 2}px`,
    height: `${r.h * k + pad * 2}px`,
    opacity: '1',
  });
  await x.anim(c.box, [{ opacity: 0, scale: '1.06' }, { opacity: 1, scale: '1' }], { duration: 300, easing: EASE });
}

/* ---------- 部品（実際の画面と同じマークアップ） ---------- */
function gameSel(kind: GameKind, mode: GameMode): string {
  const variants = MODES_BY_KIND[kind];
  const has = variants.length > 1;
  const top = GAME_KINDS.map((k) => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${GAME_KIND_LABELS[k]}</button>`).join('');
  const sub = (has ? variants : MODES_BY_KIND.legend)
    .map((m) => {
      const s = GAME_MODE_SPECS[m];
      return `<button type="button" data-m="${m}" aria-pressed="${has && m === mode}">${s.kind === 'rank' ? `STAGE ${s.variant}` : s.variant}</button>`;
    })
    .join('');
  return `<div class="seg">${top}</div><div class="seg sm${has ? '' : ' is-hidden'}">${sub}</div>`;
}
const INPUT = (shotSub = 'スクリーンショットから読み取る', rt = '<span class="rt">＋</span>'): string =>
  `<button type="button" class="mbtn hot"><span>SCREENSHOT<small>${shotSub}</small></span>${rt}</button>` +
  `<button type="button" class="mbtn"><span>MANUAL<small>手入力する</small></span><span class="rt">→</span></button>`;
const DOTS = '<span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>';
const SEATS =
  '<ul class="seats">' +
  '<li class="seat hero"><span class="pos hero">BU</span><span class="stk">15.9bb</span><span class="bet"></span><span class="tgs"><span class="tg">HERO</span></span></li>' +
  '<li class="seat"><span class="pos">SB</span><span class="stk">73.5bb</span><span class="bet">BET 0.5</span><span class="tgs"></span></li>' +
  '<li class="seat"><span class="pos">BB</span><span class="stk">23.6bb</span><span class="bet">BET 1</span><span class="tgs"></span></li>' +
  '</ul>';
const SPEC =
  '<div class="panel"><dl class="spec">' +
  '<dt>BLINDS</dt><dd>0.5 / 1　ANTE 0.2564</dd><dd class="tag"></dd>' +
  '<dt>HAND</dt><dd style="font-size:18px">72o</dd><dd class="tag"></dd>' +
  '<dt>HERO</dt><dd>BU</dd><dd class="tag"></dd>' +
  '<dt>PLAYERS</dt><dd>3</dd><dd class="tag"></dd>' +
  '<dt>POT</dt><dd>一致 (2.3bb)</dd><dd class="tag"></dd>' +
  '</dl></div>';
const recRow = (right: string, act: string): string =>
  '<ul class="recs"><li class="rec"><div class="rec-main">' +
  `<span class="rec-hand">72o</span>${right}` +
  '<span class="rec-sub"><span>BU・3 LEFT</span><span>2026/10/08 19:22</span></span>' +
  `<span class="rec-act">${act}</span>` +
  '</div><span></span></li></ul>';
const VERDICT =
  '<div class="panel verdict-panel fold">' +
  '<div class="panel-h"><span class="eyebrow">VERDICT</span><span class="mtag">クラブマッチ</span></div>' +
  '<div class="vtop"><div class="verdict fold">FOLD</div><div class="vhand">72o</div></div>' +
  '<div class="vmeta"><span class="num">BU</span><span class="num">15.9bb</span><span class="num">3 LEFT</span><span class="num">OPEN PUSH 15.5%</span></div>' +
  '<div class="hs-grid two">' +
  '<div class="hs-stat"><span class="statlbl">EV（フォールド比）</span><b class="hs-val c-fold">−0.051<span class="hs-unit">pt</span></b></div>' +
  '<div class="hs-stat"><span class="statlbl">RANGE</span><b class="hs-val">15.5<span class="hs-unit">%</span></b></div>' +
  '</div></div>';
const CHOICE =
  '<div class="panel"><div class="panel-h"><span class="eyebrow">MY CHOICE</span><span class="rt">この局面で自分が選んだ行動</span></div>' +
  '<div class="seg"><button type="button" data-a="PUSH" aria-pressed="false">ALL IN</button><button type="button" data-a="FOLD" aria-pressed="false">FOLD</button><button type="button" data-a="" aria-pressed="true">未選択</button></div>' +
  '<div class="gs-slot"></div></div>';

/* ---------- steps ---------- */
async function stepGame(x: Ctx, st: Stage): Promise<void> {
  let kind: GameKind = 'club';
  let mode: GameMode = 'club';
  const m = mini(st, `<div class="list-h"><span class="eyebrow">GAME</span></div><div class="gmsel">${gameSel(kind, mode)}</div><div class="list-h"><span class="eyebrow">INPUT</span></div>${INPUT()}`);
  const gm = q(m, '.gmsel');
  const set = (k: GameKind, md: GameMode): void => {
    kind = k;
    mode = md;
    gm.innerHTML = gameSel(kind, mode);
    strip(x, st, read('GAME', gameModeLabel(mode)));
  };
  strip(x, st, read('GAME', gameModeLabel(mode)));
  await x.wait(1000);
  await tap(x, st, q(gm, '[data-k="rank"]'));
  set('rank', 'rank-4');
  await x.wait(900);
  await tap(x, st, q(gm, '[data-m="rank-5"]'));
  set('rank', 'rank-5');
  await x.wait(1200);
  await tap(x, st, q(gm, '[data-k="legend"]'));
  set('legend', 'legend-avg');
  await x.wait(1300);
  await tap(x, st, q(gm, '[data-k="club"]'));
  set('club', 'club');
  await x.wait(1800);
}

async function stepShot(x: Ctx, st: Stage): Promise<void> {
  const c = await camera(st);
  await x.wait(600);
  // シャッター
  void x.anim(c.img, [{ scale: '1.03' }, { scale: '1' }], { duration: 500, easing: EASE });
  await x.anim(q(c.el, '.gs-flash'), [{ opacity: 0 }, { opacity: 0.85, offset: 0.2 }, { opacity: 0 }], { duration: 520, easing: 'ease-out' });
  strip(x, st, note('SCREENSHOT', '自分の手番のプリフロップ'));
  await x.wait(1300);
  await look(x, c, R.street);
  strip(x, st, ok('プリフロップの画面'));
  await x.wait(1700);
  await look(x, c, R.heroStack);
  strip(x, st, ok('スタックが BB 表示', '15.9 BB'));
  await x.wait(1700);
  await look(x, c, R.full);
  strip(x, st, ok('切り抜かない全画面'));
  await x.wait(2000);
}

async function stepLoad(x: Ctx, st: Stage): Promise<void> {
  let m = mini(st, `<div class="list-h"><span class="eyebrow">INPUT</span></div>${INPUT()}`);
  strip(x, st, note('PC', 'ドラッグ＆ドロップ・貼り付けでも'));
  await preloadSample();
  await x.wait(800);
  const shot = q(m, '.mbtn.hot');
  await tap(x, st, shot);
  // 写真の選択（端末のピッカー）
  const sheet = el(
    'div',
    'gs-sheet',
    `<span class="eyebrow">PHOTOS</span><div class="gs-ths"><i class="gs-th"></i><i class="gs-th on" style="background-image:url('${sampleUrl}')"></i><i class="gs-th"></i></div>`,
  );
  st.body.append(sheet);
  await x.anim(sheet, [{ translate: '0 100%' }, { translate: '0 0' }], { duration: 380, easing: EASE });
  await x.wait(500);
  await tap(x, st, q(sheet, '.gs-th.on'));
  void x.anim(sheet, [{ translate: '0 0' }, { translate: '0 100%' }], { duration: 320, easing: 'ease-in', fill: 'forwards' });
  m.innerHTML = `<div class="list-h"><span class="eyebrow">INPUT</span></div>${INPUT('読み取り中…', DOTS)}`;
  await x.wait(1600);
  sheet.remove();
  await swap(x, st, m, `<div class="pane-h"><span class="eyebrow">CONFIRM</span><b>条件確認</b></div>${SPEC}`);
  strip(x, st, note('CONFIRM', '読み取り結果を確認'));
  await x.wait(2400);
}

const READS: { r: Rect; html: string }[] = [
  { r: R.blinds, html: read('BLINDS', '0.5 / 1', 'ANTE 0.2564') },
  { r: R.hero, html: read('HAND', '72o', 'HERO BU・15.9bb') },
  { r: R.sb, html: read('SB', '73.5bb', 'BET 0.5') },
  { r: R.bb, html: read('BB', '23.6bb', 'BET 1') },
  { r: R.pot, html: read('POT', '2.3bb', '一致') },
];
async function stepVerify(x: Ctx, st: Stage): Promise<void> {
  const c = await camera(st);
  strip(x, st, note('CHECK', '元画像と照らし合わせる'));
  await x.wait(900);
  for (const it of READS) {
    await look(x, c, it.r);
    strip(x, st, it.html);
    await x.wait(1700);
  }
  await look(x, c, null, 700);
  // 読み取った STACKS を画像の上に重ねる
  void x.anim(c.el, [{ opacity: 1 }, { opacity: 0.28 }], { duration: 360, fill: 'forwards' });
  const m = mini(st, `<div class="list-h"><span class="eyebrow">STACKS</span></div>${SEATS}<div class="btns"><button type="button" class="btn ghost">修正</button><button type="button" class="btn primary">計算する</button></div>`);
  await x.anim(m, [{ opacity: 0, translate: '0 8px' }, { opacity: 1, translate: '0 0' }], { duration: 320, easing: EASE });
  strip(x, st, note('FIX', '違っていたら「修正」'));
  await x.wait(1400);
  await pulse(x, q(m, '.btn.ghost'));
  await x.wait(1600);
}

async function stepCalc(x: Ctx, st: Stage): Promise<void> {
  let m = mini(st, `<div class="list-h"><span class="eyebrow">STACKS</span></div>${SEATS}<div class="btns"><button type="button" class="btn ghost">修正</button><button type="button" class="btn primary">計算する</button></div>`);
  strip(x, st, note('SOLVE', '計算する'));
  await x.wait(800);
  await tap(x, st, q(m, '.btn.primary'));
  m = await swap(x, st, m, `<div class="pane-h"><span class="eyebrow">RECORDS</span><b>記録</b></div>${recRow(`<span class="rec-run">SOLVING${DOTS}</span>`, '')}`);
  strip(x, st, note('記録', '計算中も他の画面を使える'));
  await x.wait(2000);
  m.innerHTML = `<div class="pane-h"><span class="eyebrow">RECORDS</span><b>記録</b></div>${recRow('<span class="rec-vd fold">FOLD</span>', '<span style="color:var(--muted)">未選択</span>')}`;
  await pulse(x, q(m, '.rec-vd'));
  strip(x, st, read('DONE', 'FOLD', '72o・BU'));
  await x.wait(1100);
  await tap(x, st, q(m, '.rec-main'));
  await swap(x, st, m, VERDICT);
  strip(x, st, `<span class="gs-r"><b class="c-push">PUSH</b><span>オレンジ</span><b class="c-fold">FOLD</b><span>青</span></span>`);
  await x.wait(3000);
}

async function stepChoice(x: Ctx, st: Stage): Promise<void> {
  let m = mini(st, CHOICE);
  const choose = (a: '' | 'PUSH' | 'FOLD'): void => {
    m.querySelectorAll<HTMLElement>('[data-a]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.a === a)));
    q(m, '.gs-slot').innerHTML =
      a === 'PUSH'
        ? '<div class="notice warn">EV loss <b>−0.051</b> pt（最適は FOLD）</div>'
        : a === 'FOLD'
          ? '<div class="notice ok">EV loss <b>0</b>（最適な選択）</div>'
          : '';
    fit(st, m);
  };
  choose('');
  strip(x, st, note('MY CHOICE', '実際に選んだ行動'));
  await x.wait(900);
  await tap(x, st, q(m, '[data-a="PUSH"]'));
  choose('PUSH');
  strip(x, st, read('EV LOSS', '−0.051', 'pt'));
  await x.wait(1900);
  await tap(x, st, q(m, '[data-a="FOLD"]'));
  choose('FOLD');
  strip(x, st, read('EV LOSS', '0', '最適な選択'));
  await x.wait(1500);
  m = await swap(
    x,
    st,
    m,
    '<div class="pane-h"><span class="eyebrow">RECORDS</span><b>記録</b></div>' +
      '<div class="hs-grid two"><div class="hs-stat"><span class="statlbl">記録した場面</span><b class="hs-val">1</b></div>' +
      '<div class="hs-stat"><span class="statlbl">EV loss 累計</span><b class="hs-val">0.000<span class="hs-unit">pt</span></b></div></div>' +
      recRow('<span class="rec-vd fold">FOLD</span>', 'FOLD <span class="gain">✓</span>'),
  );
  strip(x, st, note('記録', 'EV loss を累計'));
  await x.wait(2600);
}

export interface GuideStep {
  t: string;
  p: string;
  n?: string;
  run: (x: Ctx, st: Stage) => Promise<void>;
}
export const GUIDE_STEPS: GuideStep[] = [
  {
    t: 'ゲームを選ぶ',
    p: '最初に、遊んでいるゲームを選ぶ。ゲームごとに順位のポイントと開始スタックが違い、結果が変わる。',
    n: 'スクショからは判別できない。ランクは STAGE、レジェンドは解くレート（迷ったら平均）も選ぶ。',
    run: stepGame,
  },
  {
    t: 'スクショを撮る',
    p: '自分の手番が回ってきたプリフロップで、画面全体のスクリーンショットを撮る。',
    n: 'スタックは BB 表示にしておく。切り抜くとスタックやポジションが読み取れない。',
    run: stepShot,
  },
  {
    t: '読み込む',
    p: 'SCREENSHOT を押して、撮ったスクショを選ぶ。画像の解析はこの端末の中で行う。',
    n: 'PC はこの画面へのドラッグ＆ドロップや、貼り付け（Ctrl / ⌘ + V）でも読み込める。',
    run: stepLoad,
  },
  {
    t: '読み取りを確かめる',
    p: '読み取ったブラインド・ハンド・ポジション・スタックが、元の画像と合っているかを確かめる。',
    n: '違っていたら「修正」。人数がずれたら PLAYERS で補正、ゲームを選び直したら「選んだゲームで読み直す」。',
    run: stepVerify,
  },
  {
    t: '計算して結果を見る',
    p: '「計算する」を押すと記録タブに移り、終わると判定が出る。PUSH はオレンジ、FOLD は青。',
    n: '計算中も他の画面を使える（同時に計算できるのは 1 件）。行を押すと EV・レンジ・Action tree を見られる。',
    run: stepCalc,
  },
  {
    t: '自分の選択を記録',
    p: '結果画面の MY CHOICE で、実際に選んだ行動を記録する。最適でなければ EV loss が出る。',
    n: 'EV loss は記録タブで累計される。',
    run: stepChoice,
  },
];

/** ステップ i を 1 回再生し、終わったら onDone（次のステップへ進める）。返り値で止める。 */
export function playStep(root: HTMLElement, i: number, onDone: () => void): () => void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const x = new Ctx(reduce);
  root.innerHTML = '<div class="gs-scene"><div class="gs-body"></div><div class="gs-strip" aria-hidden="true"></div></div>';
  const st: Stage = { root, scene: q(root, '.gs-scene'), body: q(root, '.gs-body'), strip: q(root, '.gs-strip') };
  void (async () => {
    try {
      void x.anim(st.scene, [{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
      await GUIDE_STEPS[i]!.run(x, st);
      // 動きを減らす設定では最後の状態で止め、自動では進めない
      if (reduce) return;
      await x.anim(st.scene, [{ opacity: 1 }, { opacity: 0 }], { duration: 280, easing: 'ease-in' });
      st.scene.style.opacity = '0';
      onDone();
    } catch (e) {
      if (e !== STOP) throw e;
    }
  })();
  return () => {
    x.halt();
    root.innerHTML = '';
  };
}

export { preloadSample };
