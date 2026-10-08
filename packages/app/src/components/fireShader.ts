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
  vec2 p = vec2((uv.x - 0.5) * aspect, uv.y);
  float t = uTime;

  // 揺らぎ: 上へ流れる二段のドメインワープ。高いところほど大きく捻れる（根元は落ち着き、先端が踊る）。
  vec2 q = vec2(p.x * 2.6, p.y * 1.5);
  vec2 w = vec2(
    fbm(q + vec2(0.0, -t * 0.55)),
    fbm(q + vec2(5.2, 1.3) + vec2(0.0, -t * 0.7))
  );
  vec2 w2 = vec2(
    fbm(q * 1.7 + w * 1.3 + vec2(1.7, 9.2) + vec2(0.0, -t * 1.1)),
    fbm(q * 1.7 + w * 1.3 + vec2(8.3, 2.8) + vec2(0.0, -t * 1.25))
  );
  float lift = 0.05 + 0.32 * smoothstep(0.0, 0.7, uv.y);
  vec2 pd = p + vec2(w2.x * 0.9, w2.y * 0.55) * lift;

  // 舌: x 方向に並ぶ数本の炎の高さ。ゆっくり伸び縮みし、端ほど低い。
  float edge = 1.0 - 0.35 * smoothstep(0.25, 1.0, abs(p.x) / max(aspect * 0.5, 0.45));
  float cols = clamp(0.5 + 0.9 * noise(vec2(pd.x * 5.2 + 7.0, t * 0.42)), 0.0, 1.0);
  float cols2 = clamp(0.5 + 0.9 * noise(vec2(pd.x * 12.0 - 3.0, t * 1.1)), 0.0, 1.0);
  float tongue = (0.36 + 0.72 * cols * cols + 0.16 * cols2 * cols) * edge;

  // 細部: 速く細かい乱流で輪郭をちぎり、細い火の筋を出す。
  float detail = fbm(pd * vec2(4.2, 2.6) + w2 * 0.8 + vec2(0.0, -t * 2.1));
  float body = 1.0 - pd.y / max(tongue, 0.05);
  float heat = clamp(body + detail * (0.9 + 0.7 * uv.y) - 0.02, 0.0, 1.0);
  heat = pow(heat, 1.35);

  vec3 c0 = vec3(0.24, 0.015, 0.01);
  vec3 c1 = vec3(0.78, 0.12, 0.02);
  vec3 c2 = vec3(1.00, 0.40, 0.05);
  vec3 c3 = vec3(1.00, 0.68, 0.22);
  vec3 c4 = vec3(1.00, 0.92, 0.72);
  vec3 col = mix(c0, c1, smoothstep(0.0, 0.22, heat));
  col = mix(col, c2, smoothstep(0.18, 0.48, heat));
  col = mix(col, c3, smoothstep(0.48, 0.78, heat));
  col = mix(col, c4, smoothstep(0.88, 1.0, heat) * 0.8);
  float alpha = smoothstep(0.0, 0.26, heat);

  // 根元のやわらかな照り返し（炎の無い所も、ごく薄く暖色に染める）。
  float glow = exp(-uv.y * 4.2) * 0.22;
  col = mix(col, c1, clamp(glow * 2.0, 0.0, 1.0) * (1.0 - alpha));
  alpha = max(alpha, glow);

  // 火の粉: 上昇しながら揺れる小さな光点（2 層・セルごとに一部だけ灯す）。
  float sparks = 0.0;
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float sc = 16.0 + fl * 11.0;
    vec2 ep = p * sc;
    ep.y -= t * (1.6 + fl * 1.1);
    ep.x += sin(ep.y * 0.31 + fl * 2.7 + t * 0.5) * 0.9;
    vec2 id = floor(ep);
    vec2 gv = fract(ep) - 0.5;
    vec2 r = hash2(id + fl * 37.0);
    float on = step(0.9, r.x);
    vec2 o = (hash2(id + 11.0) - 0.5) * 0.6;
    float d = length(gv - o);
    float life = 1.0 - smoothstep(0.15, 0.9, uv.y + r.y * 0.25);
    float tw = 0.55 + 0.45 * sin(t * (4.0 + r.y * 5.0) + r.x * 60.0);
    sparks += on * smoothstep(0.11, 0.0, d) * life * tw * (0.6 + 0.4 * fl);
  }
  vec3 sc = mix(c2, c3, 0.6);
  col = mix(col, sc, clamp(sparks, 0.0, 1.0) * (1.0 - alpha * 0.6));
  alpha = max(alpha, clamp(sparks, 0.0, 1.0) * 0.9);

  gl_FragColor = vec4(col * alpha, alpha);
}
`;
