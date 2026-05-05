// 板块顶点着色器 v2.0
// 增强特性：
//   - fBm 程序化地形动态噪声
//   - 俯冲板块前端曲线下沉
//   - 碰撞区域高斯隆起
//   - 裂谷中心下沉
//   - 板块边缘裙摆式下垂

uniform float uTime;
uniform float uIntensity;
uniform float uSubductionProgress;  // 俯冲进度 0~1
uniform vec3  uCollisionPoint;      // 碰撞点世界坐标
uniform float uCollisionStrength;   // 碰撞强度 0~1
uniform float uRiftWidth;           // 裂谷宽度（世界单位）
uniform float uRiftProgress;        // 裂谷下沉进度 0~1
uniform float uRiftCenterX;         // 裂谷中心 X
uniform float uLeadingEdgeX;        // 俯冲前缘 X
uniform float uBendDepth;           // 俯冲最大弯曲深度

varying vec3  vNormal;
varying vec3  vPosition;
varying vec3  vWorldPosition;
varying float vHeight;
varying float vSlope;   // 坡度（0=水平, 1=垂直）

// ─── 哈希函数 ───────────────────────────────────────────────
float hash(vec2 p) {
    float h = dot(p, vec2(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

float hash3(vec3 p) {
    float h = dot(p, vec3(127.1, 311.7, 74.7));
    return fract(sin(h) * 43758.5453123);
}

// ─── Value Noise（2D）────────────────────────────────────────
float noise2(vec2 p) {
    vec2  i = floor(p);
    vec2  f = fract(p);
    vec2  u = f * f * (3.0 - 2.0 * f); // smoothstep

    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ─── fBm（Fractional Brownian Motion）───────────────────────
float fbm(vec2 p) {
    float v  = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    // 4 倍频叠加
    for (int i = 0; i < 4; i++) {
        v   += amp  * noise2(p * freq);
        amp  *= 0.5;
        freq *= 2.1;
    }
    return v;
}

// ─── 动态 fBm（加入时间维度缓慢漂移）──────────────────────
float dynamicFbm(vec3 pos, float time) {
    vec2 p = pos.xz * 0.06 + vec2(time * 0.008, time * 0.005);
    return fbm(p) * 2.0 - 1.0;  // 映射到 -1 ~ +1
}

void main() {
    vec3  pos  = position;
    vec3  norm = normalize(normalMatrix * normal);

    // ─── 1. 程序化地形噪声（fBm）───────────────────────────
    float terrainNoise = dynamicFbm(pos, uTime) * 2.5 * uIntensity;
    pos.y += terrainNoise;

    // ─── 2. 碰撞区域高斯隆起 ────────────────────────────────
    float distToCollision = distance(pos.xz, uCollisionPoint.xz);
    float sigma  = 20.0 + uCollisionStrength * 25.0;
    float gauss  = exp(-(distToCollision * distToCollision) / (2.0 * sigma * sigma));
    float uplift = gauss * uCollisionStrength * 12.0;
    pos.y += uplift;

    // ─── 3. 俯冲弯曲：前端顶点按三次曲线下沉 ───────────────
    float relEdge = pos.x - uLeadingEdgeX;
    if (relEdge < 0.0) {
        float bendWidth = 35.0 + uSubductionProgress * 20.0;
        float t   = clamp(abs(relEdge) / bendWidth, 0.0, 1.0);
        float bend = t * t * (3.0 - 2.0 * t) * uBendDepth * uSubductionProgress;
        pos.y -= bend;
    }

    // ─── 4. 裂谷下沉：余弦形凹陷 ────────────────────────────
    float riftDist = abs(pos.x - uRiftCenterX);
    float halfRift = uRiftWidth * 0.5;
    if (riftDist < halfRift) {
        float tr    = riftDist / halfRift;
        float depth = (1.0 - tr * tr) * 14.0 * uRiftProgress;
        pos.y -= depth;
    }

    // ─── 5. 板块边缘裙摆式下垂（基于 fBm 扰动的边缘侵蚀）──
    // 使用顶点原始 Y 判断是否为低处边缘
    float edgeFactor = max(0.0, -position.y / 30.0);
    float edgeDrape  = edgeFactor * fbm(pos.xz * 0.03 + vec2(uTime * 0.003)) * 3.0;
    pos.y -= edgeDrape;

    // ─── 6. 轻微地震振动（高频小幅） ─────────────────────────
    float vibration = sin(uTime * 0.02 + pos.x * 0.08 + pos.z * 0.06) * 0.3 * uIntensity;
    pos.y += vibration;

    // ─── 输出 varying ────────────────────────────────────────
    vHeight        = pos.y;
    vPosition      = (modelViewMatrix * vec4(pos, 1.0)).xyz;
    vWorldPosition = pos;

    // 重新计算法线（近似：通过有限差分）
    float eps  = 0.5;
    vec3  posR = pos + vec3(eps, 0.0, 0.0);
    vec3  posF = pos + vec3(0.0, 0.0, eps);
    posR.y += dynamicFbm(posR, uTime) * 2.5 * uIntensity + gauss * uCollisionStrength * 12.0;
    posF.y += dynamicFbm(posF, uTime) * 2.5 * uIntensity + gauss * uCollisionStrength * 12.0;
    vec3 computedNorm = normalize(cross(posF - pos, posR - pos));
    vNormal = normalize(normalMatrix * computedNorm);

    // 坡度：法线与 Y 轴夹角
    vSlope  = 1.0 - abs(dot(normalize(vNormal), vec3(0.0, 1.0, 0.0)));

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
