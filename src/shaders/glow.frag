// 发光片元着色器 v2.0
// 特性：
//   - 指数衰减光晕（比线性更自然、更真实）
//   - 支持彩色（uniform vec3 uGlowColor）
//   - 支持脉冲动画（uniform float uPulse，0~1 振幅）
//   - 双层光晕：外层柔和大晕 + 内层高亮核心

uniform float uGlowIntensity;  // 整体强度
uniform vec3  uGlowColor;      // 光晕颜色
uniform float uPulse;          // 脉冲因子（0~1），由外部 JS 驱动

varying vec3 vNormal;
varying vec3 vPosition;

void main() {
    vec3  viewDir  = normalize(-vPosition);
    vec3  normal   = normalize(vNormal);

    // ─── Fresnel 边缘发光 ─────────────────────────────────
    float cosTheta  = abs(dot(viewDir, normal));
    float fresnelBase = 1.0 - cosTheta;

    // 指数衰减（比 pow(x, n) 更平滑）
    // 外层宽光晕
    float haloGlow   = exp(-cosTheta * 2.8) * uGlowIntensity;
    // 内层亮核（边缘薄层高亮）
    float edgeGlow   = exp(-cosTheta * 6.5) * uGlowIntensity * 0.6;

    // 两层叠加
    float glow = (haloGlow + edgeGlow) * uPulse;

    // ─── 颜色 ────────────────────────────────────────────
    // 核心偏白热，外层保持原色
    vec3 coreBoost = vec3(0.3, 0.2, 0.1) * edgeGlow;
    vec3 finalColor = uGlowColor * glow + coreBoost;

    // Alpha：使用 haloGlow 驱动，边缘最透明处自然消失
    float alpha = clamp(haloGlow * uPulse, 0.0, 1.0);

    gl_FragColor = vec4(finalColor, alpha);
}
