import { useEffect, useRef } from 'react';
import { FRAG, VERT } from './fireShader';

/**
 * 背景の炎（WebGL フラグメントシェーダ）。
 *
 * 炎本体はドメインワープした fBm ノイズを上へ流し、x 方向にゆっくり揺れる「舌」の高さで
 * 輪郭を作る。温度に応じて深紅 → 橙 → 琥珀 → 白黄へ色を移し、上空には細かな火の粉を漂わせる。
 * 出力は乗算済みアルファ（炎の無いところは透明）で、上に重ねたライト／ダークのベールから
 * ぼんやり透けて見える前提の強さにしてある。
 *
 * 負荷対策: 描画解像度は画面の CSS ピクセル数を上限 ~36 万画素に抑え、タブが裏に回ったら止める。
 * prefers-reduced-motion では 1 枚だけ描いて止める。WebGL が無い環境では何も描かない（ベールだけ）。
 */

const MAX_PIXELS = 360_000;

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

export function FireBackground(): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return undefined;
    const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, powerPreference: 'low-power' });
    if (!gl) return undefined;
    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return undefined;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return undefined;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    gl.clearColor(0, 0, 0, 0);

    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let running = false;
    let last = performance.now();
    // 長時間でノイズ座標が大きくなり精度が落ちないよう、時間はゆっくり周回させる。
    let t = 20 + Math.random() * 100;

    function resize(): void {
      const w = window.innerWidth;
      const h = window.innerHeight;
      const s = Math.min(1, Math.sqrt(MAX_PIXELS / (w * h)));
      const cw = Math.max(1, Math.round(w * s));
      const ch = Math.max(1, Math.round(h * s));
      if (canvas!.width !== cw || canvas!.height !== ch) {
        canvas!.width = cw;
        canvas!.height = ch;
        gl!.viewport(0, 0, cw, ch);
      }
    }

    function draw(): void {
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform1f(uTime, t);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    }

    function frame(now: number): void {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      t += dt;
      if (t > 900) t -= 800;
      draw();
      raf = requestAnimationFrame(frame);
    }

    function start(): void {
      if (running || reduce) return;
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

    resize();
    draw();
    start();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      stop();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  return (
    <>
      <canvas ref={ref} className="fire" aria-hidden="true" />
      <div className="veil" aria-hidden="true" />
    </>
  );
}
