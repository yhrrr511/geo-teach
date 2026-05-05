// 岩浆片元着色器 v2.0
// 特性：
//   - 三色渐变：白热（中心）→ 橙黄 → 暗红（边缘）
//   - 随时间 uTime 脉动的亮度
//   - 噪声扰动边缘（使形状不规则）
//   - 透明度随粒子年龄 vRatio 衰减

uniform float uTime;
uniform float uIntensity;

varying float vAge;
varying float vLife;

// ─── 简单哈希噪声（无纹理依赖，纯计算）───────────────────
float hashF(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h) * 43758.5453);
}

float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
        mix(hashF(i),               hashF(i + vec2(1.0, 0.0)), u.x),
        mix(hashF(i + vec2(0.0,1.0)), hashF(i + vec2(1.0, 1.0)), u.x),
        u.y
    );
}

void main() {
    // 粒子生命进度
    float ratio = vLife > 0.0 ? clamp(vAge / vLife, 0.0, 1.0) : 1.0;

    // ─── 噪声扰动边缘 ──────────────────────────────────────
    // 在 gl_PointCoord 附近叠加噪声，使圆形边缘不规则
    vec2  pc     = gl_PointCoord - vec2(0.5);
    float angle  = atan(pc.y, pc.x);
    float nEdge  = noise2D(vec2(angle * 3.0, uTime * 2.0)) * 0.12;
    float d      = length(pc) - nEdge;

    if (d > 0.48) discard;

    // ─── 脉动亮度 ──────────────────────────────────────────
    float pulse = 0.85 + 0.15 * sin(uTime * 6.0 + angle * 2.0);

    // ─── 三色渐变 ──────────────────────────────────────────
    // 中心（d 小）→ 白热；中间 → 橙黄；边缘（ratio 大）→ 暗红
    vec3 hotWhite  = vec3(1.0, 0.96, 0.80);
    vec3 orange    = vec3(1.0, 0.50, 0.05);
    vec3 darkRed   = vec3(0.55, 0.06, 0.01);

    vec3 col;
    if (ratio < 0.30) {
        col = mix(hotWhite, orange,  ratio / 0.30);
    } else if (ratio < 0.72) {
        col = mix(orange,   darkRed, (ratio - 0.30) / 0.42);
    } else {
        col = darkRed;
    }

    // 中心 d=0 额外白热叠加
    float core   = exp(-d * 18.0);
    col += vec3(0.50, 0.32, 0.08) * core;

    // 应用脉动 + 强度
    col *= pulse * uIntensity;

    // ─── 透明度 ───────────────────────────────────────────
    float alpha = (1.0 - ratio) * smoothstep(0.48, 0.05, d);

    gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0));
}
