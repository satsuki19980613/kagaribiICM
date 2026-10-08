/** 背景の炎のシェーダ（FireBackground.tsx が使う）。詳しくはそちらの冒頭を参照。 */

export const VERT = `
attribute vec2 aPos;
void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }
`;

export const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 uRes;
uniform float uTime;

vec2 hash2(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = dot(hash2(i) * 2.0 - 1.0, f);
  float b = dot(hash2(i + vec2(1.0, 0.0)) * 2.0 - 1.0, f - vec2(1.0, 0.0));
  float c = dot(hash2(i + vec2(0.0, 1.0)) * 2.0 - 1.0, f - vec2(0.0, 1.0));
  float d = dot(hash2(i + vec2(1.0, 1.0)) * 2.0 - 1.0, f - vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 ROT = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * noise(p); p = ROT * p; a *= 0.5; }
  return s;
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  // 画面の高さを 1 とした座標。x は中央が 0（端末の縦横比が変わっても炎の形は同じ）。
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  float t = uTime;

  // 炎全体の高さと根元の幅（画面の高さ基準）。焚き火らしく根元を広く、背を高く。
  // 全体の背丈もゆっくり不規則に伸び縮みする（薪が崩れる・空気が入るたびの勢いの変化）。
  float surge = 0.5 + 0.5 * noise(vec2(t * 0.23, 7.3)) + 0.25 * noise(vec2(t * 0.61, 2.1));
  float H = 1.02 * (0.9 + 0.16 * surge);
  float W = 0.27 * mix(0.78, 1.0, smoothstep(0.5, 1.2, aspect));
  float y = p.y + 0.02;
  float yn = clamp(y / H, 0.0, 1.0);

  // 傾き: 風向きのように左右へゆっくり不規則に寝る（上ほど大きく）。
  float lean = noise(vec2(t * 0.17, 11.0)) * 0.22 + noise(vec2(t * 0.47, 5.0)) * 0.08;
  float sway = lean * yn * yn + fbm(vec2(y * 1.3 - t * 0.7, t * 0.25)) * 0.08 * yn;
  vec2 q = vec2(p.x - sway, y);

  // 縦に引き伸ばした乱流（火の筋が上へ昇る）。
  vec2 fq = vec2(q.x * 8.5, y * 2.0 - t * 2.9);
  vec2 warp = vec2(fbm(fq + vec2(0.0, -t * 0.5)), fbm(fq * 1.3 + vec2(4.1, 2.3)));
  float flow = fbm(fq + warp * 1.9);
  float fine = fbm(vec2(q.x * 17.0, y * 4.6 - t * 4.4) + warp);

  // パフィング: 根元の幅ほどの高さで膨らみが生まれ、上へ昇りながら首がくびれてちぎれる
  // （実際の焚き火の周期的な渦の放出）。周期と位相はノイズで揺らして機械的にしない。
  float puffPhase = yn * 1.7 - t * 0.95 + noise(vec2(t * 0.3, 1.7)) * 0.6 + warp.y * 0.25;
  float puff = sin(6.2832 * puffPhase);
  float puffZone = smoothstep(0.18, 0.5, yn);

  // 舌: 横に並ぶ何本もの炎が、それぞれ勝手な高さで伸び縮みする。主役の舌の位置も漂う。
  float tx = q.x / W;
  float tongueA = 0.5 + 0.5 * noise(vec2(q.x * 9.0 + warp.x * 0.7, t * 0.8));
  float tongueB = 0.5 + 0.5 * noise(vec2(q.x * 21.0 - 5.0, t * 1.6));
  float lead = noise(vec2(t * 0.21, 3.3)) * 0.7;
  float leadT = exp(-pow((tx - lead) * 2.2, 2.0));
  float flare = smoothstep(0.05, 0.45, noise(vec2(q.x * 3.5 + 13.0, t * 0.3)));
  float tipH = (0.5 + 0.42 * tongueA + 0.14 * tongueB + 0.22 * flare + 0.3 * leadT)
             * (1.0 - 0.55 * smoothstep(0.0, 1.0, abs(tx)));

  // 輪郭: 全体は三角（根元が広く上へ細る）。膨らみの通り道では幅が呼吸する。
  float width = W * max(1.0 - yn * 0.86, 0.0) * (1.0 + 0.22 * puff * puffZone) + 0.004;
  float sx = abs(q.x) / width;
  float side = 1.0 - sx;
  float vert = 1.0 - yn / max(tipH, 0.05);
  float turb = flow * 0.9 + fine * 0.45;
  // 上の方は膨らみの「首」で場を落としてちぎる。
  float pinch = mix(1.0, 0.72 + 0.38 * (0.5 + 0.5 * puff), smoothstep(0.35, 0.75, yn));
  float field = (min(side * 1.25, vert * 1.2) + turb * (0.6 + 0.7 * yn)) * pinch;
  // 根元はほんの少し持ち上げてから点ける（地面に貼りつかないように）。
  field *= smoothstep(-0.08, 0.1, y);
  // 輪郭はぼんやり（広い幅でゆっくり立ち上げる）。
  float heat = smoothstep(-0.1, 1.0, field);
  // まばらさ: 細かな縦の隙間を開ける。根元はほぼ詰まっていて、上へ行くほど隙間が増えてばらける
  // （大きな穴が空かないよう、隙間は細かい模様だけで作る）。
  float gaps = fbm(vec2(q.x * 19.0, y * 4.2 - t * 3.4) + warp * 1.2);
  float gaps2 = fbm(vec2(q.x * 34.0 + 4.0, y * 7.0 - t * 5.0) + warp);
  float holes = smoothstep(-0.3, 0.2, gaps * 0.8 + gaps2 * 0.5);
  heat *= mix(1.0, holes, mix(0.1, 0.9, smoothstep(0.12, 0.8, yn)));

  // ちぎれて昇る炎の欠片（くびれた先が離れて上で燃え尽きる）。
  float wisp = smoothstep(0.38, 0.8, fbm(vec2(q.x * 7.0, y * 2.4 - t * 3.0)) + 0.3 + 0.12 * puff)
             * (1.0 - smoothstep(0.0, W * 0.75, abs(q.x - lead * W * 0.4)))
             * smoothstep(0.45, 0.8, yn) * (1.0 - smoothstep(0.85, 1.2, y / H));
  heat = max(heat, wisp * 0.4);

  // 温度: 根元の中央ほど高温（白黄）。煤が昇りながら冷えるので、上ほど橙 → 赤へ落ちていく。
  float core = (1.0 - smoothstep(0.0, 0.65, sx)) * (1.0 - smoothstep(0.0, 0.42, yn));
  float temp = clamp(heat * (0.7 + 0.3 * core) * (1.0 - 0.32 * yn) + fine * 0.14 * heat, 0.0, 1.0);

  vec3 c0 = vec3(0.30, 0.03, 0.01);
  vec3 c1 = vec3(0.85, 0.16, 0.02);
  vec3 c2 = vec3(1.00, 0.42, 0.05);
  vec3 c3 = vec3(1.00, 0.70, 0.22);
  vec3 c4 = vec3(1.00, 0.93, 0.70);
  vec3 col = mix(c0, c1, smoothstep(0.0, 0.25, temp));
  col = mix(col, c2, smoothstep(0.2, 0.5, temp));
  col = mix(col, c3, smoothstep(0.5, 0.78, temp));
  col = mix(col, c4, smoothstep(0.82, 1.0, temp));
  float alpha = smoothstep(0.03, 0.55, heat);

  // 根元のやわらかな照り返し。
  vec2 gp = vec2(p.x / (W * 3.2), (y - 0.04) / 0.22);
  float glow = exp(-dot(gp, gp)) * 0.5;
  col = mix(col, c1, clamp(glow, 0.0, 1.0) * (1.0 - alpha));
  alpha = max(alpha, glow * 0.7);

  // 火の粉: 炎から舞い上がり、揺れながら消える小さな光点。
  float sparks = 0.0;
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float sc = 22.0 + fl * 12.0;
    vec2 ep = vec2(p.x, y) * sc;
    ep.y -= t * (4.5 + fl * 2.0);
    ep.x += sin(ep.y * 0.4 + fl * 2.7 + t * 1.3) * 0.7;
    vec2 id = floor(ep);
    vec2 gv = fract(ep) - 0.5;
    vec2 r = hash2(id + fl * 37.0);
    vec2 o = (hash2(id + 11.0) - 0.5) * 0.6;
    float d = length(gv - o);
    // 炎の上に集まり、上へ行くほど横へ散って消える。
    float spread = W * (1.2 + 2.5 * yn);
    float near = 1.0 - smoothstep(spread * 0.4, spread, abs(p.x));
    float life = smoothstep(0.2, 0.45, yn) * (1.0 - smoothstep(0.75, 1.15, y / H + r.y * 0.3));
    float tw = 0.5 + 0.5 * sin(t * (7.0 + r.y * 6.0) + r.x * 60.0);
    sparks += step(0.88, r.x) * smoothstep(0.12, 0.0, d) * near * life * tw;
  }
  sparks = clamp(sparks, 0.0, 1.0);
  col = mix(col, c3, sparks * (1.0 - alpha * 0.6));
  alpha = max(alpha, sparks * 0.95);

  // ディザ: 薄い照り返しのグラデーションに縞（バンディング）が出ないよう、1/255 未満の揺らぎを足す。
  float dith = (hash2(gl_FragCoord.xy + fract(t) * 61.0).x - 0.5) / 255.0;
  alpha = clamp(alpha + dith * 2.0, 0.0, 1.0);
  gl_FragColor = vec4(clamp(col * alpha + dith, 0.0, 1.0), alpha);
}
`;
