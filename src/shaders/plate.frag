// 板块片元着色器 v2.0
// 特性：
//   - 基于高度的 PBR 风格分层颜色（深海/浅海/平原/丘陵/山地/雪峰）
//   - 基于坡度 (vSlope) 的颜色调制（坡度大的地方颜色更深，露出岩石面）
//   - Lambert 漫反射 + 环境光
//   - Fresnel 边缘发光（板块边缘微微发光）

uniform vec3  uLightPosition;  // 主光源位置（世界空间）
uniform vec3  uAmbient;        // 环境光颜色
uniform float uTime;

varying vec3  vNormal;
varying vec3  vPosition;       // 视空间位置
varying vec3  vWorldPosition;
varying float vHeight;
varying float vSlope;

// 高度颜色分层（PBR 近似，颜色单位均在线性空间）
vec3 heightColor(float h) {
    // ── 深海（h < -25）
    if (h < -25.0) return vec3(0.04, 0.09, 0.22);

    // ── 中深海（-25 ~ -10）
    if (h < -10.0) {
        float t = (h + 25.0) / 15.0;
        return mix(vec3(0.04, 0.09, 0.22), vec3(0.08, 0.20, 0.40), t);
    }

    // ── 浅海（-10 ~ 0）
    if (h < 0.0) {
        float t = (h + 10.0) / 10.0;
        return mix(vec3(0.08, 0.20, 0.40), vec3(0.18, 0.38, 0.55), t);
    }

    // ── 海岸沙滩（0 ~ 4）
    if (h < 4.0) {
        float t = h / 4.0;
        return mix(vec3(0.72, 0.65, 0.48), vec3(0.58, 0.62, 0.32), t);
    }

    // ── 平原草地（4 ~ 15）
    if (h < 15.0) {
        float t = (h - 4.0) / 11.0;
        return mix(vec3(0.28, 0.50, 0.22), vec3(0.34, 0.44, 0.20), t);
    }

    // ── 丘陵（15 ~ 30）
    if (h < 30.0) {
        float t = (h - 15.0) / 15.0;
        return mix(vec3(0.34, 0.44, 0.20), vec3(0.55, 0.46, 0.32), t);
    }

    // ── 山地（30 ~ 55）
    if (h < 55.0) {
        float t = (h - 30.0) / 25.0;
        return mix(vec3(0.55, 0.46, 0.32), vec3(0.62, 0.60, 0.55), t);
    }

    // ── 雪峰（h >= 55）
    float t = clamp((h - 55.0) / 20.0, 0.0, 1.0);
    return mix(vec3(0.62, 0.60, 0.55), vec3(0.95, 0.97, 1.00), t);
}

// 岩石面颜色（坡度大时露出）
vec3 rockColor(float h) {
    if (h < 0.0)  return vec3(0.12, 0.18, 0.28);
    if (h < 20.0) return vec3(0.38, 0.34, 0.28);
    return vec3(0.48, 0.46, 0.44);
}

void main() {
    vec3 normal   = normalize(vNormal);
    vec3 viewDir  = normalize(-vPosition);

    // ─── 主光源方向（视空间近似）────────────────────────
    vec3 lightDir = normalize(uLightPosition - vWorldPosition);
    // 转到视空间（简化：直接使用 normalMatrix * lightDir 效果）
    vec3 lightDirV = normalize((vec4(lightDir, 0.0)).xyz);

    // ─── Lambert 漫反射 ──────────────────────────────────
    float diffuse  = max(0.0, dot(normal, lightDirV)) * 0.72 + 0.28;

    // ─── 高度分层基础颜色 ────────────────────────────────
    vec3 baseColor = heightColor(vHeight);

    // ─── 坡度调制：坡度大的地方颜色更深（岩石面） ─────
    vec3 rock = rockColor(vHeight);
    // vSlope: 0=水平, 趋近1=陡峭；超过 0.4 开始混入岩石色
    float slopeMix = smoothstep(0.35, 0.75, vSlope);
    baseColor = mix(baseColor, rock, slopeMix);

    // ─── 光照组合 ────────────────────────────────────────
    vec3 finalColor = baseColor * diffuse + uAmbient * baseColor * 0.18;

    // ─── Fresnel 边缘发光 ────────────────────────────────
    float fresnel = pow(1.0 - abs(dot(viewDir, normal)), 3.2);

    // 水下边缘：蓝色发光；陆地边缘：橙黄发光（热点）
    vec3 fresnelColor;
    if (vHeight < 0.0) {
        fresnelColor = vec3(0.15, 0.45, 0.85);
    } else {
        fresnelColor = vec3(0.90, 0.55, 0.15);
    }
    finalColor += fresnelColor * fresnel * 0.28;

    // ─── 高山微弱自发光（雪峰反光感） ───────────────────
    if (vHeight > 45.0) {
        float snowGlow = clamp((vHeight - 45.0) / 25.0, 0.0, 1.0);
        finalColor += vec3(0.8, 0.88, 1.0) * snowGlow * 0.12;
    }

    gl_FragColor = vec4(finalColor, 1.0);
}
