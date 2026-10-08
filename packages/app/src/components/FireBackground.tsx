import { useEffect, useRef } from 'react';
import { FRAG, VERT } from './fireShader';

/**
 * 背景の炎（WebGL フラグメントシェーダ）。
 *
 * 画面中央から細く縦に立ち上がる焚き火の炎。根元が広く先端へ細る輪郭に、縦に伸びて速く昇る
 * 乱流（ドメインワープした fBm）を足して閾値で切るので、細い舌が何本も立ち、先端がちぎれて昇る。
 * 温度に応じて深紅 → 橙 → 琥珀 → 白黄（芯）へ色を移し、炎の上には火の粉を舞わせる。
 * 出力は乗算済みアルファ（炎の無いところは透明）で、上に重ねたライト／ダークのベールから
 * ぼんやり透けて見える前提の強さにしてある。
 *
 * 負荷対策: 描画解像度は画面の CSS ピクセル数を上限 ~36 万画素に抑え、タブが裏に回ったら止める。
 * prefers-reduced-motion では 1 枚だけ描いて止める。WebGL が無い環境では何も描かない（ベールだけ）。
 */

const MAX_PIXELS = 360_000;
/** アニメーションの速さ（1 = シェーダの設計速度）。ゆったり燃えるよう落としてある。 */
const SPEED = 0.4 / 1.4 / 2.5;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.warn(gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

interface Gpu {
  gl: WebGLRenderingContext;
  uRes: WebGLUniformLocation | null;
  uTime: WebGLUniformLocation | null;
}

/** シェーダと全画面三角形を用意する。失敗したら null（その環境では炎を出さない）。 */
function setupGl(gl: WebGLRenderingContext): Gpu | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(prog, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  gl.clearColor(0, 0, 0, 0);
  return { gl, uRes: gl.getUniformLocation(prog, 'uRes'), uTime: gl.getUniformLocation(prog, 'uTime') };
}

export function FireBackground(): JSX.Element {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = host.current;
    if (!box) return undefined;
    // canvas は毎回作り直す（使い終えた context を後から拾わないように。開発時の StrictMode の
    // 二重実行でも、片付けで捨てた context に描こうとして炎が消える、が起きない）。
    const canvas = document.createElement('canvas');
    canvas.className = 'fire';
    canvas.setAttribute('aria-hidden', 'true');
    box.prepend(canvas);
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, powerPreference: 'low-power' });
    let gpu = gl ? setupGl(gl) : null;
    if (!gpu) {
      canvas.remove();
      return undefined;
    }

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let running = false;
    let lost = false;
    let last = performance.now();
    // 長時間でノイズ座標が大きくなり精度が落ちないよう、時間はゆっくり周回させる。
    let t = 20 + Math.random() * 100;

    function resize(): void {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const s = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
      const cw = Math.max(1, Math.round(w * s));
      const ch = Math.max(1, Math.round(h * s));
      if (canvas.width !== cw || canvas.height !== ch) {
        canvas.width = cw;
        canvas.height = ch;
      }
    }

    function draw(): void {
      if (!gpu || lost) return;
      const g = gpu.gl;
      g.viewport(0, 0, canvas.width, canvas.height);
      g.uniform2f(gpu.uRes, canvas.width, canvas.height);
      g.uniform1f(gpu.uTime, t);
      g.clear(g.COLOR_BUFFER_BIT);
      g.drawArrays(g.TRIANGLES, 0, 3);
    }

    function frame(now: number): void {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt * SPEED;
      if (t > 900) t -= 800;
      draw();
      raf = requestAnimationFrame(frame);
    }

    function start(): void {
      if (running || reduce || lost || document.visibilityState === 'hidden') return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function stop(): void {
      running = false;
      cancelAnimationFrame(raf);
    }
    function onVis(): void {
      if (document.visibilityState === 'hidden') stop();
      else start();
    }
    function onResize(): void {
      resize();
      if (!running) draw();
    }
    // GPU 側の都合で context が失われたら止めて隠し、戻ってきたら作り直して再開する。
    function onLost(e: Event): void {
      e.preventDefault();
      lost = true;
      stop();
      canvas.style.visibility = 'hidden';
    }
    function onRestored(): void {
      lost = false;
      gpu = gl ? setupGl(gl) : null;
      if (!gpu) return;
      canvas.style.visibility = '';
      draw();
      start();
    }

    resize();
    draw();
    start();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);
    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, []);

  return (
    <div ref={host} aria-hidden="true">
      <div className="veil" />
    </div>
  );
}
