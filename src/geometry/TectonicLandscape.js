import * as THREE from 'three';

// 坐标系说明（石油井结构版，2026年版）：
//
//   X轴方向（从左到右）：
//     -130(深海左缘) → -75(洋中脊) → -30(印度陆地西岸均值)
//     → 0(印度东岸) → +10(亚欧板块开始) → +110(亚欧内陆)
//
//   Y轴方向（从下到上）：
//     -65(基底岩石底) → -50(不透水层底) → -38(储集层底)
//     → -28(储集层顶) → -15(浅层砂岩底) → 0 → +5(海平面) → +25(山顶)
//
//   Z轴方向：-56(后) → 0 → +56(前)，depth=112
//
//   地下分层（从下到上）：
//     基底岩石层 (Basement Rock)    Y: -65 ~ -50   厚15，深灰近黑
//     不透水底层 (Waterproof)       Y: -50 ~ -38   厚12，深棕灰，致密
//     储集层     (Reservoir)        Y: -38 ~ -28   厚10，波浪形拱起
//       └── Water  (地层水)         下 1/3
//       └── Oil    (石油)           中 1/3
//       └── Gas    (天然气)         上 1/3  (拱顶)
//     致密岩石隔层 (Cap Rock)       Y: -28 ~ -15   厚13，深棕
//     浅层砂岩/土层 (Surface Rock)  Y: -15 ~ 0     厚15，沙黄棕
//     地表地形                      Y:  0 ~ terrain

const S = {
    xMin: -130,
    xMax: 110,
    depth: 112,
    halfDepth: 56,
    frontZ: 56,
    backZ: -56,

    seaLevel: 5,

    // 地表岩石底（原岩石圈底）
    lithBottom: -15,

    // 地下分层边界（从下往上）
    basementBottom: -95,   // 基底岩石底（要足够深，容纳储集层底面最深 -80）
    basementTop:    -80,   // 基底岩石顶 / 不透水底层底
    waterproofBottom: -80, // 不透水底层底
    waterproofTop:    -63, // 不透水底层顶（向斜处平均储集层底，实际动态）
    reservoirBottom:  -63, // 储集层底（动态函数 reservoirBottomAt 的平均基准）
    reservoirTop:     -28, // 储集层顶（拱顶顶部，盖层底面）
    capRockBottom:    -28, // 盖层底（与储集层顶面衔接，动态弯曲）
    capRockTop:       -15, // 盖层顶 / 浅层砂岩底
    surfaceRockTop:     0, // 浅层砂岩顶（地表）

    // 油水/油气分界（固定水平线，仅供标签参考；实际分界由 waterOilBoundAt/oilGasBoundAt 计算）
    waterOilBound:  -44,   // 固定油水界面 Y（= OIL_WATER_LEVEL）
    oilGasBound:    -34,   // 固定油气界面 Y（= OIL_GAS_LEVEL）

    ridgeX: -75,
    coastMeanX: 0,
    indiaWestMeanX: -30,
    indiaEastMeanX: 0,
    eurasiaStartX: 10,
    mountainStartX: 14,
    mountainEndX: 80,
    snowBase: 12,
    plainMax: 5,
    indiaPeakMax: 10,
    eurAsiaPeakMax: 15,
    mountainWidth: 8,
};

/* ============================================================
   数学工具
============================================================ */
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function mix(a, b, t) {
    return a + (b - a) * t;
}

/** 与水面网格完全相同的波浪公式，用于竖直剖面海水上边界对齐 */
function seaWaveAt(x, z) {
    return Math.sin(x * 0.18 + z * 0.11) * 0.90
         + Math.sin(x * 0.31 - z * 0.19) * 0.55
         + Math.sin(x * 0.07 + z * 0.25) * 0.35
         + Math.cos(x * 0.24 - z * 0.08) * 0.20;
}

function smoothstep(edge0, edge1, value) {
    if (edge0 === edge1) return value < edge0 ? 0 : 1;
    const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
}

function gaussian(value, center, width) {
    const d = (value - center) / width;
    return Math.exp(-(d * d));
}

function signedNoise2D(x, z) {
    const a = Math.sin(x * 0.73 + z * 1.11 + 1.7);
    const b = Math.cos(x * 1.37 - z * 0.58 + 0.9);
    const c = Math.sin((x + z) * 0.41 - 1.3) * Math.cos((x - z) * 0.29 + 2.1);
    return a * 0.5 + b * 0.3 + c * 0.2;
}

function fbmNoise(x, z, octaves = 5, scale = 0.025, persistence = 0.55) {
    let sum = 0, amplitude = 1, frequency = scale, norm = 0;
    for (let i = 0; i < octaves; i++) {
        sum += signedNoise2D(x * frequency, z * frequency) * amplitude;
        norm += amplitude;
        amplitude *= persistence;
        frequency *= 2.03;
    }
    return sum / Math.max(norm, 1e-6);
}

function ridgedNoise(x, z, octaves = 5, scale = 0.035, persistence = 0.55) {
    let sum = 0, amplitude = 1, frequency = scale, norm = 0;
    for (let i = 0; i < octaves; i++) {
        const n = 1 - Math.abs(signedNoise2D(x * frequency, z * frequency));
        sum += n * amplitude;
        norm += amplitude;
        amplitude *= persistence;
        frequency *= 2.12;
    }
    return sum / Math.max(norm, 1e-6);
}

function warpedRidgedNoise(x, z, strength = 10) {
    const warpX = fbmNoise(x + 17.3, z - 6.1, 3, 0.08, 0.55) * strength;
    const warpZ = fbmNoise(x - 13.6, z + 4.8, 3, 0.08, 0.55) * strength * 0.7;
    return ridgedNoise(x + warpX, z + warpZ, 4, 0.075, 0.52);
}

/* ============================================================
   海岸线函数
============================================================ */
function indiaWestCoast(z) {
    const nz = z / S.halfDepth;
    const largeBend = Math.sin(nz * 2.1 + 0.4) * 5.5;
    const midBend   = Math.sin(nz * 5.8 - 0.7) * 2.2;
    const bayA      = gaussian(z, -8, 14) * 4.2;
    const bayB      = gaussian(z, 22, 11) * 2.6;
    const headland  = gaussian(z, -28, 12) * 3.1;
    const micro     = fbmNoise(z * 0.85, z * 0.3, 3, 0.22, 0.5) * 1.2;
    return clamp(
        S.indiaWestMeanX + largeBend + midBend - bayA - bayB + headland + micro,
        -44, -18
    );
}

function indiaEastCoast(z) {
    const nz = (z - S.frontZ) / (2 * S.halfDepth);
    const base = mix(-10, 15, -nz);
    const sBend = Math.sin(nz * Math.PI * 1.8 + 0.3) * 8.0;
    const detail = Math.sin(nz * Math.PI * 4.5 - 0.6) * 2.5
                 + Math.cos(nz * Math.PI * 3.2 + 1.1) * 1.5;
    const micro = fbmNoise(z * 0.6, z * 0.25, 3, 0.18, 0.5) * 1.5;
    return clamp(base + sBend + detail + micro, -20, 22);
}

/* ============================================================
   地壳下界
   - 陆地/海湾区域：Y=0 上下波动（±2）
   - 海洋区域：Y=-13 上下轻微波动（±1.5）
   - 海岸线附近 smoothstep 圆滑过渡
============================================================ */
function crustBottomAt(x, z) {
    const shore = indiaWestCoast(z);
    // 过渡区：从海岸线 shore（约X=-30）到 X=0，x < shore 时 t=0（海洋），x > 0 时 t=1（陆地/海湾）
    const t = smoothstep(shore, 0, x); // 0=海洋, 1=陆地/海湾
    const landWave  = fbmNoise(x * 0.05 + 1.3, z * 0.05 - 0.7, 3, 0.06, 0.5) * 3.0;  // ±3 波动
    const oceanWave = fbmNoise(x * 0.06 - 2.1, z * 0.06 + 3.4, 3, 0.04, 0.5) * 1.5;  // ±1.5 波动
    const landBot  = -6 + landWave;   // 陆地/海湾：Y=-6 附近
    const oceanBot = -13 + oceanWave; // 海洋：Y=-13 附近
    return mix(oceanBot, landBot, t);
}

/* ============================================================
   海底高度
============================================================ */
function oceanFloorHeight(x, z) {
    const shore = indiaWestCoast(z);
    const nx = clamp((x - S.xMin) / (shore - S.xMin + 1e-6), 0, 1);
    const ridgeCenter = S.ridgeX + Math.sin(z * 0.078) * 2.6;
    const trenchCenter = shore - 6.0 + Math.sin(z * 0.11 + 0.8) * 1.6;

    const abyssalPlain = mix(-8.5, -10.0, smoothstep(0.14, 0.84, nx));
    const ridgeMass    = 7.0 * gaussian(x, ridgeCenter, 7.8);
    const ridgeShoulder = 3.0 * gaussian(x, ridgeCenter, 17.0);
    const centralBasin = -1.5 * gaussian(x, mix(S.ridgeX + 16, shore - 26, 0.55), 15.0);
    const slopeRise    = 5.5 * smoothstep(shore - 28, shore - 9, x);
    const trench       = -6.0 * gaussian(x, trenchCenter, 4.2);
    const trenchTail   = -1.8 * gaussian(x, trenchCenter - 8, 9.5);
    const shelfNoise   = fbmNoise(x, z, 5, 0.045, 0.54) * mix(0.8, 0.25, smoothstep(shore - 22, shore - 2, x));

    return clamp(
        abyssalPlain + ridgeMass + ridgeShoulder + centralBasin + slopeRise + trench + trenchTail + shelfNoise,
        -13.0, S.seaLevel - 1.5
    );
}

function shelfBedHeight(x, z) {
    const westShore = indiaWestCoast(z);
    const d = x - westShore;
    const uplift   = smoothstep(-16, -2, d);
    const beachLift = smoothstep(-2, 6, d);
    const sandbars = fbmNoise(x, z, 4, 0.058, 0.52) * 0.55;
    const terracing = Math.sin((z + x * 0.28) * 0.2) * 0.3;
    return mix(S.seaLevel - 7.0, S.seaLevel + 0.6, uplift) + beachLift * 1.1 + sandbars + terracing;
}

function bayBedHeight(x, z) {
    const eastShore = indiaEastCoast(z);
    const bayCenter = eastShore + 2.5;
    const d = Math.abs(x - bayCenter);
    const depth = S.seaLevel - 5.0 - gaussian(z, 0, 25) * 2.0;
    const sideRise = smoothstep(2.5, 0, d) * (S.seaLevel - 0.5 - depth);
    return clamp(depth + sideRise + fbmNoise(x, z, 3, 0.08, 0.5) * 0.3, -14.0, S.seaLevel - 0.5);
}

/* ============================================================
   陆地高度函数（印度板块 + 亚欧板块）
============================================================ */
function indiaLandHeight(x, z) {
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const landWidth = Math.max(eastShore - westShore, 1);
    const nx = clamp((x - westShore) / landWidth, 0, 1);

    const coastRise = smoothstep(0.0, 0.12, nx) * 2.0;
    const plainBase = 2.5 * smoothstep(0.08, 0.40, nx);
    const roll1 = fbmNoise(x * 0.9, z * 0.8, 4, 0.035, 0.52) * 1.4;
    const roll2 = fbmNoise(x * 1.4 + 3.2, z * 1.2 - 5.1, 3, 0.055, 0.50) * 0.8;
    const roll3 = fbmNoise(x * 0.5 - 7.3, z * 0.4 + 2.9, 3, 0.018, 0.58) * 1.8;
    const plateauWave = Math.sin(x * 0.06 + z * 0.035) * 0.8
                      + Math.cos(x * 0.04 - z * 0.06) * 0.6;
    const plainDetail = roll1 + roll2 * 0.5 + roll3 * 0.4 + plateauWave * 0.4;

    const hillRaw = clamp(gaussian(nx, 0.72, 0.16), 0, 1);
    const hillSharp = Math.pow(hillRaw, 0.38);
    const mountainAmplitude = S.indiaPeakMax - S.seaLevel;
    const eastHill = mountainAmplitude * hillSharp;

    const ridgeMicro = clamp(ridgedNoise(x * 0.8 + z * 0.35, z * 1.0 - x * 0.2, 4, 0.10, 0.50), 0, 1);
    const detailNoise = ridgeMicro * hillRaw * 0.8 + fbmNoise(x + 5, z - 3, 3, 0.06, 0.48) * 0.4;

    const eastDrop = -4.5 * smoothstep(0.87, 1.0, nx);

    const h = S.seaLevel + coastRise + plainBase + plainDetail + eastHill + detailNoise + eastDrop;
    return clamp(h, S.seaLevel - 1.0, S.indiaPeakMax);
}

function mountainSpineX(z) {
    const bayEdge = indiaEastCoast(z) + 5.0;
    return bayEdge + 35.0;
}

function getMountainField(x, z) {
    const spineX = mountainSpineX(z);
    const distFromSpine = x - spineX;
    const mountainHalfWidth = 18.0;
    const mainWidth = 7.0;
    const mainCross = gaussian(x, spineX, mainWidth);
    const shoulderWidth = mainWidth * 1.6;
    const shoulderR = gaussian(x, spineX + mainWidth * 1.5, shoulderWidth) * 0.55;
    const shoulderL = gaussian(x, spineX - mainWidth * 1.2, shoulderWidth * 0.7) * 0.30;

    const rangeMask  = clamp(mainCross + shoulderL + shoulderR, 0, 1.0);
    const crestMask  = clamp(mainCross * 1.3, 0, 1.0);
    const flankMask  = clamp(shoulderL + shoulderR, 0, 0.9);

    const inRangeX = clamp(1.0 - smoothstep(0, mountainHalfWidth * 2.0, distFromSpine), 0, 1);
    const edgeFade = smoothstep(S.halfDepth, S.halfDepth - 10.0, Math.abs(z));
    const rangeEnvelope = inRangeX * edgeFade;

    return { spineX, distFromSpine, rangeMask, crestMask, flankMask, rangeEnvelope };
}

function continentHeight(x, z) {
    const bayRightEdge = indiaEastCoast(z) + 5.0;
    const shoreDistance = x - bayRightEdge;

    if (shoreDistance < 0) {
        return bayBedHeight(x, z);
    }

    const nx = clamp(shoreDistance / 100.0, 0, 1);

    const frontRamp = 1.8 * smoothstep(0.0, 0.06, nx);
    const forelandBasin = -1.0 * gaussian(shoreDistance, 14, 9);
    const roll1 = fbmNoise(x * 0.85, z * 0.72, 5, 0.022, 0.55) * 1.8;
    const roll2 = fbmNoise(x * 1.3 + 7.1, z * 1.1 - 3.2, 4, 0.038, 0.52) * 1.2;
    const roll3 = fbmNoise(x * 0.6 - 5.4, z * 0.5 + 11.7, 3, 0.015, 0.58) * 2.2;
    const plateauWave = Math.sin(x * 0.045 + z * 0.028) * 1.1
                      + Math.cos(x * 0.031 - z * 0.053) * 0.9;
    const baseRoll = roll1 + roll2 * 0.6 + roll3 * 0.4 + plateauWave * 0.5;
    const baseLand = S.seaLevel + frontRamp + forelandBasin + baseRoll;

    const field = getMountainField(x, z);
    const nz = (z + S.halfDepth) / S.depth;

    const PEAKS = [
        { c: 0.08, h: 0.55, w: 0.07 },
        { c: 0.22, h: 0.82, w: 0.08 },
        { c: 0.38, h: 1.00, w: 0.09 },
        { c: 0.54, h: 0.88, w: 0.08 },
        { c: 0.70, h: 0.72, w: 0.08 },
        { c: 0.88, h: 0.50, w: 0.07 },
    ];

    let peakEnvelopeZ = 0.0;
    for (const pk of PEAKS) {
        const dist = Math.abs(nz - pk.c) / pk.w;
        if (dist < 1.8) {
            const t = Math.max(0, 1.0 - dist / 1.8);
            peakEnvelopeZ += pk.h * t * t;
        }
    }

    const peakNoise = fbmNoise(z * 0.20, x * 0.04, 3, 0.06, 0.52) * 0.10;
    peakEnvelopeZ = clamp(peakEnvelopeZ + peakNoise, 0.0, 1.0);

    const crestProfile = clamp(field.crestMask, 0, 1.0);
    const flankProfile = clamp(field.flankMask, 0, 1.0);
    const mountainAmp = S.eurAsiaPeakMax - S.seaLevel;

    const mountainContrib = (
        crestProfile * 1.0 * mountainAmp * peakEnvelopeZ
        + flankProfile * 0.38 * mountainAmp * (0.5 + peakEnvelopeZ * 0.5)
    ) * field.rangeEnvelope;

    const ridgeMicro = clamp(ridgedNoise(x * 0.9 + z * 0.4, z * 1.2 - x * 0.3, 5, 0.09, 0.50), 0, 1);
    const microContrib = ridgeMicro * field.rangeEnvelope * 1.2;

    const rightDrop = -4.5 * smoothstep(0.75, 1.0, nx);

    const plainClamped = clamp(baseLand, S.seaLevel - 2.5, S.plainMax + 1.5);
    const finalHeight = plainClamped + mountainContrib + microContrib + rightDrop;

    return clamp(finalHeight, S.seaLevel - 3.0, S.eurAsiaPeakMax);
}

function terrainHeightAt(x, z) {
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const bayEnd    = eastShore + 5;

    if (x < westShore) {
        return oceanFloorHeight(x, z);
    } else if (x < eastShore) {
        return indiaLandHeight(x, z);
    } else if (x < bayEnd) {
        return bayBedHeight(x, z);
    } else {
        return continentHeight(x, z);
    }
}

function waterSurfaceHeight(x, z) {
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const bayEnd    = eastShore + 5;
    const inOcean = x < westShore;
    const inBay   = (x >= eastShore && x < bayEnd);
    if (!inOcean && !inBay) return -999;
    const fade  = smoothstep(S.xMin, S.xMin + 18, x) * (1 - smoothstep(westShore - 7.0, westShore + 0.8, x));
    const bayFade = inBay ? 1.0 : 0;
    const swell = Math.sin(x * 0.052 + z * 0.11) * 0.2 + Math.cos(x * 0.033 - z * 0.08) * 0.12;
    const shallowLift = smoothstep(westShore - 14, westShore - 2, x) * 0.3;
    return clamp(S.seaLevel + shallowLift + swell * (fade + bayFade * 0.5), S.seaLevel - 0.2, S.seaLevel + 0.3);
}

/* ============================================================
   ★ 地下储集层波浪形状函数
   最终正确设计：
   - 储集层顶面（盖层底面）= 纯粹弯曲的波浪线，完全不截断，确保是弧线
   - 储集层底面（不透水层顶面）= 小幅度波浪，约为顶面幅度的 1/2，
     使拱顶处层厚（约 18）、向斜处层薄（约 8）
   - 油水界面 = 固定绝对 Y 值（真正的水平线）← 地质科学：浮力使界面水平
   - 油气界面 = 固定绝对 Y 值（真正的水平线）← 气最轻，始终在最顶部
   - 颜色判断：某点 y 落在哪段区间 → 决定是水/油/气
     * y < OIL_WATER_LEVEL  → 含水层（地层水）
     * OIL_WATER_LEVEL ≤ y < OIL_GAS_LEVEL → 石油层
     * y ≥ OIL_GAS_LEVEL   → 天然气层
     （前提：y 在 reservoirBottom ~ reservoirTop 之间，即在储集层内）
   - 只有当储集层顶面高于 OIL_WATER_LEVEL 时，该拱顶区域才会出现石油
   - 只有当储集层顶面高于 OIL_GAS_LEVEL 时，该拱顶区域才会出现天然气
   - 两个背斜拱顶：左拱 x≈-65（海洋），右拱 x≈55（大陆）
============================================================ */

// ── 共享波浪驱动函数 ──────────────────────────────────────────
// 两个高斯拱顶 + 向斜谷 + 自然不规则起伏
// 拱顶峰值 wave ≈ +28~32，向斜谷 ≈ -10，平坦区 ≈ 0
function reservoirWave(x, z) {
    const arch1   = gaussian(x, -65, 24) * 32.0;   // 左拱（海洋）
    const arch2   = gaussian(x,  55, 22) * 30.0;   // 右拱（大陆，幅度30）
    const valley  = -gaussian(x, -10, 22) * 12.0;  // 两拱间向斜谷
    const undulation = Math.sin(x * 0.022 + 0.8) * 3.0
                     + Math.sin(x * 0.048 - 1.4) * 1.5
                     + fbmNoise(x * 0.03, z * 0.02, 2, 0.025, 0.5) * 1.8;
    return arch1 + arch2 + valley + undulation;
}

// ── 储集层顶面（大幅度波浪，不截断上限，确保是纯弧线）────────
// 拱顶处顶面需高于 OIL_WATER_LEVEL(-30) 才有油气，且不能穿透盖层顶(-15)
// 基准 -55，wave系数 1.0（大幅度）
//   拱顶（wave≈+30）：top = -55+30 = -25  →  顶面弧顶 -25，高于油水界面-30，有油气
//   向斜（wave≈-10）：top = -55-10 = -65  →  深埋，低于 -30，全是水
//   平坦（wave≈ 0）：top = -55            →  低于 -30，全是水
// 关键：不设上限，顶面自由弯曲，保证是弧线！
const RES_TOP_BASE = -55.0;
function reservoirTopAt(x, z) {
    const wave = reservoirWave(x, z);
    // 不设上限，让弧线自由弯曲；只设下限防止穿透地球
    return Math.max(RES_TOP_BASE + wave, -72.0);
}

// ── 储集层底面（动态幅度波浪）────────────────────────────────
// 设计目标：
//   - 接近最低端（向斜谷，wave 小）时底面波动幅度小，层厚变薄
//   - 接近最高端（拱顶，wave 大）时底面波动幅度大，层厚增大
//   - 左拱（海洋，x≈-65）和右拱（大陆，x≈55）有不同的幅度系数
//
// 实现方式：
//   1. wave 归一化到 [0,1]（wave_min≈-12，wave_max≈32，range=44）
//   2. 幅度系数 = mix(低幅系数, 高幅系数, 归一化wave)  → 越高越大
//   3. 左拱用较大幅度系数（海洋拱顶更宽），右拱用中等幅度系数
//   4. 用高斯权重混合左右拱顶的幅度，使过渡自然
//
// 效果：
//   向斜谷（wave≈-10）：幅度系数≈0.15 → bot≈-70+(-10×0.15)=-71.5，层薄≈6.5
//   平坦区（wave≈ 0）：幅度系数≈0.28 → bot=-70，层厚=15
//   右拱顶（wave≈+30）：幅度系数≈0.55 → bot≈-70+(30×0.55)=-53.5，层厚≈28.5
//   左拱顶（wave≈+32）：幅度系数≈0.85 → bot≈-70+(32×0.85)=-42.8，层厚≈24.2（底面上移6.4）
//   底面 wave 使用 x+10 计算，拱形整体向左平移10单位
const RES_BOT_BASE = -70.0;
function reservoirBottomAt(x, z) {
    // 底面拱形向左平移 5 个单位（偏移量可调），使底面与顶面错位，产生向左倾斜感
    const wave = reservoirWave(x + 5, z);

    // wave 归一化：wave_min=-12，wave_max=32（峰值），映射到 [0,1]
    const waveNorm = clamp((wave - (-12.0)) / (32.0 - (-12.0)), 0.0, 1.0);

    // 左拱（x≈-65）：幅度从低端0.15渐增到高端0.92（海洋侧拱顶底面再上移）
    const ampLeft  = mix(0.15, 0.92, waveNorm);
    // 右拱（x≈55）：幅度从低端0.15渐增到高端0.50（大陆侧拱顶稍平缓）
    const ampRight = mix(0.15, 0.50, waveNorm);

    // 用高斯权重在两拱顶之间平滑混合幅度系数
    const wLeft  = gaussian(x, -65, 35);   // 左拱影响范围（宽35）
    const wRight = gaussian(x,  55, 30);   // 右拱影响范围（宽30）
    const wSum   = wLeft + wRight + 1e-6;
    const amp    = (wLeft * ampLeft + wRight * ampRight) / wSum
                 + (1.0 - clamp(wLeft + wRight, 0, 1)) * mix(0.15, 0.45, waveNorm);
    // 最后一项：远离两拱顶的中间区域使用中间幅度

    return Math.max(RES_BOT_BASE + wave * amp, -82.0);
}

// 不透水底层顶面 = 储集层底面（紧贴）
function waterproofTopAt(x, z) {
    return reservoirBottomAt(x, z);
}

// ── 油水界面 & 油气界面：真正的固定水平线 ─────────────────────
// 地质科学原理：液体受浮力，油水/油气界面永远水平
// 只有某位置的储集层顶面高于对应界面，该区域才聚集油/气
//
// 设置（与 RES_TOP_BASE=-55，arch_peak≈+30 对应）：
//   拱顶顶面最高 ≈ -55+30 = -25
//   OIL_GAS_LEVEL = -34   → 顶面(-25) 比气界面(-34) 高 9，有天然气（气层厚9）
//   OIL_WATER_LEVEL = -44 → 顶面(-25) 比油水界面(-44) 高 19，有石油（油层厚10，气层厚9）
//   拱顶以外（顶面 ≤ -44）：全是地层水
const OIL_WATER_LEVEL = -44.0;   // 固定水平油水界面（Y 坐标）
const OIL_GAS_LEVEL   = -34.0;   // 固定水平油气界面（Y 坐标）

// waterOilBoundAt / oilGasBoundAt 用于几何体裁剪时确定上下顶点位置
// 返回在储集层内部被水平界面截断后的实际 Y 值
function waterOilBoundAt(x, z) {
    const top = reservoirTopAt(x, z);
    const bot = reservoirBottomAt(x, z);
    // 储集层顶面低于油水界面 → 全是水，"界面"贴着顶面（油厚度=0）
    if (top <= OIL_WATER_LEVEL) return top;
    // 否则油水界面就是固定水平值，夹在底面和顶面之间
    return clamp(OIL_WATER_LEVEL, bot, top);
}

function oilGasBoundAt(x, z) {
    const top = reservoirTopAt(x, z);
    const bot = reservoirBottomAt(x, z);
    // 储集层顶面低于油气界面 → 无天然气，"界面"贴着顶面（气厚度=0）
    if (top <= OIL_GAS_LEVEL) return top;
    // 否则油气界面就是固定水平值
    return clamp(OIL_GAS_LEVEL, bot, top);
}

/* ============================================================
   颜色函数
============================================================ */
// 地表地壳颜色（浅层砂岩，Y: -15 ~ 0）
function surfaceRockColor(x, y, z) {
    // 浅层：沙黄色到棕黄色，有层理纹路
    const layer = clamp((y - S.lithBottom) / (S.surfaceRockTop - S.lithBottom), 0, 1);
    const grain = fbmNoise(x * 0.15, z * 0.15, 3, 0.1, 0.5) * 0.06;
    const stripe = Math.sin(y * 1.8 + x * 0.05) * 0.03 + Math.cos(y * 2.6 - z * 0.03) * 0.02;
    return new THREE.Color(
        clamp(0.72 + layer * 0.08 + grain + stripe, 0, 1),
        clamp(0.58 + layer * 0.06 + grain * 0.8 + stripe * 0.7, 0, 1),
        clamp(0.34 + layer * 0.04 + grain * 0.4, 0, 1)
    );
}

// 盖层颜色（Cap Rock，Y: -28 ~ -15，深棕致密）
function capRockColor(x, y, z) {
    const layer = clamp((y - S.capRockBottom) / (S.capRockTop - S.capRockBottom), 0, 1);
    const grain = fbmNoise(x * 0.12, z * 0.14, 3, 0.08, 0.5) * 0.04;
    const stripe = Math.sin(y * 2.2 + x * 0.04) * 0.025;
    return new THREE.Color(
        clamp(0.42 + layer * 0.10 + grain + stripe, 0, 1),
        clamp(0.30 + layer * 0.07 + grain * 0.7 + stripe, 0, 1),
        clamp(0.18 + layer * 0.04 + grain * 0.3, 0, 1)
    );
}

// 储集层：地层水（Water，深蓝色）
function waterZoneColor(x, y, z) {
    const grain = fbmNoise(x * 0.18, z * 0.16, 3, 0.12, 0.5) * 0.03;
    return new THREE.Color(
        clamp(0.06 + grain, 0, 1),
        clamp(0.18 + grain * 0.5, 0, 1),
        clamp(0.55 + grain * 0.3, 0, 1)
    );
}

// 储集层：石油（Oil，纯黑）
function oilZoneColor(x, y, z) {
    const grain = fbmNoise(x * 0.20, z * 0.18, 3, 0.13, 0.5) * 0.02;
    const sheen = Math.sin(x * 0.15 + z * 0.12) * 0.01;
    return new THREE.Color(
        clamp(0.04 + grain + sheen, 0, 1),
        clamp(0.03 + grain * 0.5, 0, 1),
        clamp(0.02 + grain * 0.2, 0, 1)
    );
}

// 储集层：天然气（Gas，中性灰色）
function gasZoneColor(x, y, z) {
    const grain = fbmNoise(x * 0.16, z * 0.14, 3, 0.10, 0.5) * 0.04;
    return new THREE.Color(
        clamp(0.62 + grain, 0, 1),
        clamp(0.62 + grain * 0.8, 0, 1),
        clamp(0.62 + grain * 0.6, 0, 1)
    );
}

// 不透水底层颜色（Waterproof，深灰棕）
function waterproofLayerColor(x, y, z) {
    const layer = clamp((y - S.waterproofBottom) / (S.waterproofTop - S.waterproofBottom), 0, 1);
    const grain = fbmNoise(x * 0.10, z * 0.10, 3, 0.06, 0.5) * 0.04;
    const stripe = Math.sin(y * 1.5 + x * 0.03) * 0.02;
    return new THREE.Color(
        clamp(0.32 + layer * 0.06 + grain + stripe, 0, 1),
        clamp(0.24 + layer * 0.05 + grain * 0.6, 0, 1),
        clamp(0.17 + layer * 0.03 + grain * 0.3, 0, 1)
    );
}

// 基底岩石颜色（Basement Rock，深灰近黑）
function basementRockColor(x, y, z) {
    const layer = clamp((y - S.basementBottom) / (S.basementTop - S.basementBottom), 0, 1);
    const grain = fbmNoise(x * 0.08, z * 0.08, 3, 0.05, 0.5) * 0.03;
    return new THREE.Color(
        clamp(0.18 + layer * 0.08 + grain, 0, 1),
        clamp(0.14 + layer * 0.06 + grain * 0.6, 0, 1),
        clamp(0.12 + layer * 0.04 + grain * 0.4, 0, 1)
    );
}

function oceanCrustColorAt(x, y) {
    const warmth = gaussian(x, S.ridgeX, 18) * 0.2;
    const depthT = clamp((y - S.lithBottom) / (S.seaLevel - S.lithBottom), 0, 1);
    return new THREE.Color(
        0.12 + depthT * 0.05 + warmth * 0.22,
        0.12 + depthT * 0.05 + warmth * 0.08,
        0.17 + depthT * 0.04 + warmth * 0.03
    );
}

function continentCrustColorAt(x, y) {
    if (y > 13) return new THREE.Color(0.92, 0.94, 0.96);
    if (y > 10) return new THREE.Color(0.72, 0.70, 0.66);
    if (y > 7)  return new THREE.Color(0.60, 0.52, 0.42);
    if (y > 5)  return new THREE.Color(0.52, 0.56, 0.34);
    if (y > S.seaLevel + 1.0) return new THREE.Color(0.64, 0.58, 0.4);
    if (y > S.seaLevel - 2.0) return new THREE.Color(0.69, 0.62, 0.46);
    return new THREE.Color(0.38, 0.32, 0.26);
}

function oceanTopColorAt(x, y, z) {
    const westShore = indiaWestCoast(z);
    const ridgeGlow = gaussian(x, S.ridgeX, 16);
    const coastalTint = smoothstep(westShore - 22, westShore - 2, x);
    const depth = clamp((S.seaLevel - y) / 15.0, 0, 1);
    let r = mix(0.03, 0.10, ridgeGlow * 0.65) + coastalTint * 0.014;
    let g = mix(0.06, 0.16, ridgeGlow * 0.48) + coastalTint * 0.045;
    let b = mix(0.14, 0.32, 1.0 - depth * 0.44) + coastalTint * 0.12;
    return new THREE.Color(clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1));
}

function rockCliffColor(x, y, z) {
    const crack = fbmNoise(x * 0.8, z * 0.8, 3, 0.12, 0.5) * 0.06;
    const layerT = clamp((y - S.seaLevel) / 12.0, 0, 1);
    return new THREE.Color(
        clamp(0.38 + layerT * 0.16 + crack, 0, 1),
        clamp(0.30 + layerT * 0.10 + crack * 0.8, 0, 1),
        clamp(0.22 + layerT * 0.08 + crack * 0.5, 0, 1)
    );
}

function indiaLandTopColorAt(x, y, z) {
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const landWidth = Math.max(eastShore - westShore, 1);
    const nx = clamp((x - westShore) / landWidth, 0, 1);
    const eastCliffMask = smoothstep(0.82, 1.0, nx);
    const beachMask = smoothstep(S.seaLevel - 0.3, S.seaLevel + 2.0, y) * (1 - smoothstep(S.seaLevel + 2.5, S.seaLevel + 5.0, y));
    const grassMask = smoothstep(S.seaLevel + 1.5, 7.0, y) * (1 - smoothstep(7.5, 9.5, y));
    const hillRock  = smoothstep(7.5, 9.5, y) * (1 - smoothstep(9.5, 11.0, y));
    const eastFade  = smoothstep(0.55, 0.80, nx);

    let r = 0.72, g = 0.68, b = 0.52;
    r = mix(r, 0.88, beachMask); g = mix(g, 0.80, beachMask); b = mix(b, 0.58, beachMask);
    r = mix(r, 0.42, grassMask); g = mix(g, 0.65, grassMask); b = mix(b, 0.26, grassMask);
    r = mix(r, 0.62, hillRock);  g = mix(g, 0.56, hillRock);  b = mix(b, 0.44, hillRock);
    r = mix(r, 0.56, eastFade * 0.35); g = mix(g, 0.50, eastFade * 0.35); b = mix(b, 0.40, eastFade * 0.35);

    const cliff = rockCliffColor(x, y, z);
    r = mix(r, cliff.r, eastCliffMask);
    g = mix(g, cliff.g, eastCliffMask);
    b = mix(b, cliff.b, eastCliffMask);

    const noise = fbmNoise(x, z, 3, 0.06, 0.5) * 0.04;
    return new THREE.Color(clamp(r + noise, 0, 1), clamp(g + noise * 0.6, 0, 1), clamp(b, 0, 1));
}

function continentTopColorAt(x, y, z, slope) {
    const bayRightEdge = indiaEastCoast(z) + 5.0;
    const distFromBay = x - bayRightEdge;
    const bayCliffMask = smoothstep(12.0, 0.0, distFromBay);

    const snowLine = S.snowBase + fbmNoise(x, z, 3, 0.05, 0.55) * 1.2;
    const field = getMountainField(x, z);
    const wetCoastMask = 1 - smoothstep(S.seaLevel - 4.5, S.seaLevel + 1.0, y);
    const beachMask = smoothstep(S.seaLevel - 0.4, S.seaLevel + 2.3, y) * (1 - smoothstep(S.seaLevel + 2.5, S.seaLevel + 5.0, y));
    const grassMask = smoothstep(S.seaLevel + 1.5, 8.0, y) * (1 - smoothstep(8.5, 11.0, y));
    const alpineMask = smoothstep(8.0, 11.5, y) * (1 - smoothstep(snowLine - 0.8, snowLine + 1.2, y));
    const snowMask = smoothstep(snowLine - 1.0, snowLine + 1.5, y);
    const ridgeTint = clamp(field.rangeEnvelope * field.rangeMask * 0.7, 0, 1);
    const terrainNoise = fbmNoise(x, z, 4, 0.06, 0.5) * 0.030;

    let r = 0.79, g = 0.73, b = 0.61;
    r = mix(r, 0.52, grassMask); g = mix(g, 0.70, grassMask); b = mix(b, 0.38, grassMask);
    r = mix(r, 0.88, beachMask); g = mix(g, 0.80, beachMask); b = mix(b, 0.59, beachMask);
    r = mix(r, 0.62, alpineMask); g = mix(g, 0.57, alpineMask); b = mix(b, 0.48, alpineMask);
    r = mix(r, 0.97, snowMask); g = mix(g, 0.97, snowMask); b = mix(b, 1.0, snowMask);
    r = mix(r, 0.54, wetCoastMask); g = mix(g, 0.68, wetCoastMask); b = mix(b, 0.63, wetCoastMask);

    const cliffMask = clamp((slope - 0.18) / 0.48, 0, 1) * (1 - snowMask * 0.52);
    r = mix(r, 0.55, cliffMask); g = mix(g, 0.50, cliffMask); b = mix(b, 0.44, cliffMask);

    r += ridgeTint * 0.04 + terrainNoise; g += ridgeTint * 0.025 + terrainNoise * 0.75;
    b += ridgeTint * 0.010 + terrainNoise * 0.5;

    const cliff = rockCliffColor(x, y, z);
    r = mix(r, cliff.r, bayCliffMask * (1 - snowMask * 0.3));
    g = mix(g, cliff.g, bayCliffMask * (1 - snowMask * 0.3));
    b = mix(b, cliff.b, bayCliffMask * (1 - snowMask * 0.3));

    return new THREE.Color(clamp(r, 0, 1), clamp(g, 0, 1), clamp(b, 0, 1));
}

function waterColorAt(x, y, z) {
    const westShore = indiaWestCoast(z);
    const shallow = smoothstep(westShore - 22, westShore - 4, x);
    const depth = clamp((S.seaLevel - y) / 15.0, 0, 1);
    return new THREE.Color(
        mix(0.02, 0.06, shallow) * (1 - depth * 0.15),
        mix(0.18, 0.38, shallow) * (1 - depth * 0.22),
        mix(0.62, 0.85, shallow) * (1 - depth * 0.08)
    );
}

function bayWaterColorAt(x, y, z) {
    // 海湾水色接近大洋颜色，避免与大洋海水出现突兀色差
    return new THREE.Color(0.03, 0.12, 0.32);
}

/* ============================================================
   几何构建工具
============================================================ */
function assignVertexColors(geometry, colorFn) {
    const positions = geometry.getAttribute('position');
    const normals   = geometry.getAttribute('normal');
    const colors    = new Float32Array(positions.count * 3);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.itemSize > 2 ? positions.getZ(i) : 0;
        const normalY = normals ? normals.getY(i) : 1;
        const slope = 1 - clamp(normalY, 0, 1);
        const color = colorFn(x, y, z, slope, i);
        colors[i * 3] = color.r; colors[i * 3 + 1] = color.g; colors[i * 3 + 2] = color.b;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

function sampleProfile(zValue, xStart, xEnd, segments, heightFn) {
    const points = [];
    for (let i = 0; i <= segments; i++) {
        const t = i / segments;
        const x = mix(xStart, xEnd, t);
        points.push(new THREE.Vector2(x, heightFn(x, zValue)));
    }
    return points;
}

function createSolidSection(profile, bottomY, colorFn, materialOptions = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(profile[0].x, bottomY);
    shape.lineTo(profile[0].x, profile[0].y);
    for (let i = 1; i < profile.length; i++) shape.lineTo(profile[i].x, profile[i].y);
    shape.lineTo(profile[profile.length - 1].x, bottomY);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape, 180);
    geometry.computeVertexNormals();
    assignVertexColors(geometry, (x, y) => colorFn(x, y));
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide, ...materialOptions,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
}

function createFilledSection(topProfile, bottomProfile, colorFn, materialOptions = {}) {
    const shape = new THREE.Shape();
    shape.moveTo(topProfile[0].x, topProfile[0].y);
    for (let i = 1; i < topProfile.length; i++) shape.lineTo(topProfile[i].x, topProfile[i].y);
    for (let i = bottomProfile.length - 1; i >= 0; i--) shape.lineTo(bottomProfile[i].x, bottomProfile[i].y);
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape, 160);
    geometry.computeVertexNormals();
    assignVertexColors(geometry, (x, y) => colorFn(x, y, 0));
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.62, metalness: 0.02,
        transparent: true, opacity: 0.72, side: THREE.DoubleSide, ...materialOptions,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
}

function createHeightField(xStart, xEnd, depth, segX, segZ, heightFn, colorFn, materialOptions = {}) {
    const geometry = new THREE.PlaneGeometry(xEnd - xStart, depth, segX, segZ);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate((xStart + xEnd) * 0.5, 0, 0);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getZ(i);
        positions.setY(i, heightFn(x, z));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    assignVertexColors(geometry, colorFn);
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.9, metalness: 0.02, side: THREE.DoubleSide, ...materialOptions,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
}

function createGlowStrip(width, height, color, opacity) {
    return new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
            color, transparent: true, opacity, depthWrite: false,
            blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        })
    );
}

function createArrowGlyph(color = 0x74d8ff, dir = 1, scale = 1.0) {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
        color, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const bodyLen = 13.5 * scale, bodyW = 2.4 * scale, headR = 4.2 * scale, headL = 9.0 * scale;
    const body = new THREE.Mesh(new THREE.PlaneGeometry(bodyLen, bodyW), material);
    const head = new THREE.Mesh(new THREE.ConeGeometry(headR, headL, 3), material);
    body.rotation.x = -Math.PI * 0.5;
    head.rotation.x = -Math.PI * 0.5;
    head.rotation.z = dir === 1 ? -Math.PI * 0.5 : Math.PI * 0.5;
    head.position.x = dir * (bodyLen * 0.5 + headL * 0.3);
    if (dir === -1) body.position.x = 0;
    group.add(body, head);
    return group;
}

/* ============================================================
   海岸线泡沫
============================================================ */
function createShorelineFoam() {
    const points = [];
    const samples = 88;
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const z = mix(S.backZ + 4, S.frontZ - 4, t);
        const x = indiaWestCoast(z) + 0.45;
        points.push(new THREE.Vector3(x, S.seaLevel + 0.25, z));
    }
    const curve = new THREE.CatmullRomCurve3(points);
    const geometry = new THREE.TubeGeometry(curve, 200, 0.44, 10, false);
    const material = new THREE.MeshBasicMaterial({
        color: 0xe6fbff, transparent: true, opacity: 0.16,
        depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 7;
    return mesh;
}

/* ============================================================
   水面形状
============================================================ */
function createOceanWaterSurface(materialOptions = {}) {
    // 每行以当前 z 的海岸线为右边界，动态裁切，彻底不生成陆地区域顶点
    const xMin = S.xMin;
    const zMin = S.backZ, zMax = S.frontZ;
    const nx = 120, nz = 80;
    const dz = (zMax - zMin) / nz;

    const posArr = [];
    const idxArr = [];
    // rowStart[iz] = 该行第一个顶点在 posArr 中的索引（以顶点为单位）
    const rowStart = new Int32Array(nz + 1);
    let vtx = 0;

    for (let iz = 0; iz <= nz; iz++) {
        const z = zMin + iz * dz;
        const shore = indiaWestCoast(z) + 0.7; // 该行的海岸线右边界
        const xMax = shore;
        const dx = (xMax - xMin) / nx;
        rowStart[iz] = vtx;
        for (let ix = 0; ix <= nx; ix++) {
            const x = xMin + ix * dx;
            // 全部在海洋内，直接计算波浪高度
            const y = S.seaLevel
                + Math.sin(x * 0.18 + z * 0.11) * 0.90
                + Math.sin(x * 0.31 - z * 0.19) * 0.55
                + Math.sin(x * 0.07 + z * 0.25) * 0.35
                + Math.cos(x * 0.24 - z * 0.08) * 0.20;
            posArr.push(x, y, z);
            vtx++;
        }
    }
    // 每行都有 nx+1 个顶点，相邻行之间连接四边形
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const a = rowStart[iz]     + ix;
            const b = rowStart[iz]     + ix + 1;
            const c = rowStart[iz + 1] + ix;
            const d = rowStart[iz + 1] + ix + 1;
            idxArr.push(a, c, b, b, c, d);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geometry.setIndex(idxArr);
    geometry.computeVertexNormals();
    assignVertexColors(geometry, (x, y, z) => waterColorAt(x, y, z));

    const material = new THREE.MeshPhysicalMaterial({
        vertexColors: true, transparent: true, opacity: 0.76,
        roughness: 0.62, metalness: 0.02, ior: 1.33,
        thickness: 0.6, clearcoat: 0.08, clearcoatRoughness: 0.75,
        side: THREE.DoubleSide, ...materialOptions,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    return mesh;
}

function createBayWaterSurface(materialOptions = {}) {
    // 均匀网格，海湾范围 x: eastCoast ~ eastCoast+5
    const zMin = S.backZ, zMax = S.frontZ;
    const nx = 30, nz = 80;
    const dz = (zMax - zMin) / nz;

    const vertCount = (nx + 1) * (nz + 1);
    const posArr = new Float32Array(vertCount * 3);
    const idxArr = [];

    for (let iz = 0; iz <= nz; iz++) {
        for (let ix = 0; ix <= nx; ix++) {
            const z = zMin + iz * dz;
            const xLeft  = indiaEastCoast(z) + 0.3;
            const xRight = indiaEastCoast(z) + 5.0;
            const x = mix(xLeft, xRight, ix / nx);
            const wave =
                Math.sin(x * 0.18 + z * 0.11) * 0.70
                + Math.sin(x * 0.31 - z * 0.19) * 0.40
                + Math.cos(x * 0.24 - z * 0.08) * 0.25;
            const vi = (iz * (nx + 1) + ix) * 3;
            posArr[vi]     = x;
            posArr[vi + 1] = S.seaLevel + wave;
            posArr[vi + 2] = z;
        }
    }
    for (let iz = 0; iz < nz; iz++) {
        for (let ix = 0; ix < nx; ix++) {
            const a = iz * (nx + 1) + ix;
            const b = a + 1;
            const c = a + (nx + 1);
            const d = c + 1;
            idxArr.push(a, c, b, b, c, d);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    geometry.setIndex(idxArr);
    geometry.computeVertexNormals();
    assignVertexColors(geometry, (x, y, z) => bayWaterColorAt(x, y, z));

    const material = new THREE.MeshPhysicalMaterial({
        vertexColors: true, transparent: true, opacity: 0.55,
        roughness: 0.62, metalness: 0.02, ior: 1.33,
        thickness: 0.4, clearcoat: 0.04, clearcoatRoughness: 0.85,
        side: THREE.DoubleSide, ...materialOptions,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 6;
    return mesh;
}

/* ============================================================
   ★ 正面剖面板（前面板，z = frontZ）
   展示完整地质剖面，包含：
   - 基底岩石（Y: -65 ~ -50）
   - 不透水底层（Y: -50 ~ -38）
   - 储集层（水/油/气，Y: -38 ~ -28，波浪形拱起）
   - 盖层（Y: -28 ~ -15）
   - 浅层砂岩（Y: -15 ~ 0）
   - 地壳地形（Y: 0 ~ terrainHeight）
   - 海水层
============================================================ */
function createFrontProfilePanel(textures) {
    const group = new THREE.Group();
    group.name = 'FrontProfile';

    const z = S.frontZ;
    const segs = 400;

    // 采样前面板各区域的地形高度
    const profilePoints = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        const y = terrainHeightAt(x, z);
        profilePoints.push(new THREE.Vector2(x, y));
    }

    /* 1. 基底岩石层（最底层，深灰近黑） */
    const basementShape = new THREE.Shape();
    basementShape.moveTo(S.xMin, S.basementBottom);
    basementShape.lineTo(S.xMax, S.basementBottom);
    basementShape.lineTo(S.xMax, S.basementTop);
    basementShape.lineTo(S.xMin, S.basementTop);
    basementShape.closePath();
    const basementGeo = new THREE.ShapeGeometry(basementShape, 60);
    basementGeo.computeVertexNormals();
    assignVertexColors(basementGeo, (x, y) => basementRockColor(x, y, z));
    const basementMesh = new THREE.Mesh(basementGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.92, metalness: 0.04,
        side: THREE.DoubleSide,
    }));
    basementMesh.position.z = z + 0.01;
    group.add(basementMesh);

    /* 2. 不透水底层（Waterproof，深棕灰） */
    // 不透水层顶面随拱形起伏
    const wpSegs = 200;
    const wpTopProfile = [];
    for (let i = 0; i <= wpSegs; i++) {
        const t = i / wpSegs;
        const x = mix(S.xMin, S.xMax, t);
        wpTopProfile.push(new THREE.Vector2(x, waterproofTopAt(x, z)));
    }
    const waterproofShape = new THREE.Shape();
    waterproofShape.moveTo(S.xMin, S.waterproofBottom);
    waterproofShape.lineTo(S.xMax, S.waterproofBottom);
    for (let i = wpSegs; i >= 0; i--) {
        waterproofShape.lineTo(wpTopProfile[i].x, wpTopProfile[i].y);
    }
    waterproofShape.closePath();
    const waterproofGeo = new THREE.ShapeGeometry(waterproofShape, 120);
    waterproofGeo.computeVertexNormals();
    assignVertexColors(waterproofGeo, (x, y) => waterproofLayerColor(x, y, z));
    const waterproofMesh = new THREE.Mesh(waterproofGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.90, metalness: 0.02,
        side: THREE.DoubleSide,
    }));
    waterproofMesh.position.z = z + 0.02;
    group.add(waterproofMesh);

    /* 3. 储集层（Water / Oil / Gas，波浪形拱起） */
    const resSegs = 220;

    // 采样储集层各界面
    const resBottomPts = [], waterOilPts = [], oilGasPts = [], resTopPts = [];
    for (let i = 0; i <= resSegs; i++) {
        const t = i / resSegs;
        const x = mix(S.xMin, S.xMax, t);
        resBottomPts.push(new THREE.Vector2(x, reservoirBottomAt(x, z)));
        waterOilPts.push(new THREE.Vector2(x, waterOilBoundAt(x, z)));
        oilGasPts.push(new THREE.Vector2(x, oilGasBoundAt(x, z)));
        resTopPts.push(new THREE.Vector2(x, reservoirTopAt(x, z)));
    }

    // 3a. Water zone（地层水，蓝色，底部）
    const waterZoneShape = new THREE.Shape();
    waterZoneShape.moveTo(resBottomPts[0].x, resBottomPts[0].y);
    for (let i = 1; i <= resSegs; i++) waterZoneShape.lineTo(resBottomPts[i].x, resBottomPts[i].y);
    for (let i = resSegs; i >= 0; i--) waterZoneShape.lineTo(waterOilPts[i].x, waterOilPts[i].y);
    waterZoneShape.closePath();
    const waterZoneGeo = new THREE.ShapeGeometry(waterZoneShape, 160);
    waterZoneGeo.computeVertexNormals();
    assignVertexColors(waterZoneGeo, (x, y) => waterZoneColor(x, y, z));
    const waterZoneMesh = new THREE.Mesh(waterZoneGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.55, metalness: 0.04,
        emissive: new THREE.Color(0x000a2a), emissiveIntensity: 0.45,
        side: THREE.DoubleSide,
    }));
    waterZoneMesh.position.z = z + 0.03;
    group.add(waterZoneMesh);

    // 3b. Oil zone（石油，深棕黑）
    const oilZoneShape = new THREE.Shape();
    oilZoneShape.moveTo(waterOilPts[0].x, waterOilPts[0].y);
    for (let i = 1; i <= resSegs; i++) oilZoneShape.lineTo(waterOilPts[i].x, waterOilPts[i].y);
    for (let i = resSegs; i >= 0; i--) oilZoneShape.lineTo(oilGasPts[i].x, oilGasPts[i].y);
    oilZoneShape.closePath();
    const oilZoneGeo = new THREE.ShapeGeometry(oilZoneShape, 160);
    oilZoneGeo.computeVertexNormals();
    assignVertexColors(oilZoneGeo, (x, y) => oilZoneColor(x, y, z));
    const oilZoneMesh = new THREE.Mesh(oilZoneGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.30, metalness: 0.06,
        emissive: new THREE.Color(0x000000), emissiveIntensity: 0.0,
        side: THREE.DoubleSide,
    }));
    oilZoneMesh.position.z = z + 0.035;
    group.add(oilZoneMesh);

    // 3c. Gas zone（天然气，浅灰蓝，拱顶）
    const gasZoneShape = new THREE.Shape();
    gasZoneShape.moveTo(oilGasPts[0].x, oilGasPts[0].y);
    for (let i = 1; i <= resSegs; i++) gasZoneShape.lineTo(oilGasPts[i].x, oilGasPts[i].y);
    for (let i = resSegs; i >= 0; i--) gasZoneShape.lineTo(resTopPts[i].x, resTopPts[i].y);
    gasZoneShape.closePath();
    const gasZoneGeo = new THREE.ShapeGeometry(gasZoneShape, 160);
    gasZoneGeo.computeVertexNormals();
    assignVertexColors(gasZoneGeo, (x, y) => gasZoneColor(x, y, z));
    const gasZoneMesh = new THREE.Mesh(gasZoneGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.45, metalness: 0.02,
        transparent: true, opacity: 0.88,
        emissive: new THREE.Color(0x303030), emissiveIntensity: 0.15,
        side: THREE.DoubleSide,
    }));
    gasZoneMesh.position.z = z + 0.04;
    group.add(gasZoneMesh);

    /* 4. 盖层（Cap Rock，底面跟随储集层顶，顶面动态取 min(terrainHeight, capRockTop)） */
    const capSegs = 200;
    const capTopPts = [], capBottomPts = [];
    for (let i = 0; i <= capSegs; i++) {
        const t = i / capSegs;
        const x = mix(S.xMin, S.xMax, t);
        capTopPts.push(new THREE.Vector2(x, Math.min(terrainHeightAt(x, z), S.capRockTop)));
        capBottomPts.push(new THREE.Vector2(x, reservoirTopAt(x, z)));
    }
    const capRockShape = new THREE.Shape();
    capRockShape.moveTo(capTopPts[0].x, capTopPts[0].y);
    for (let i = 1; i <= capSegs; i++) capRockShape.lineTo(capTopPts[i].x, capTopPts[i].y);
    for (let i = capSegs; i >= 0; i--) capRockShape.lineTo(capBottomPts[i].x, capBottomPts[i].y);
    capRockShape.closePath();
    const capRockGeo = new THREE.ShapeGeometry(capRockShape, 160);
    capRockGeo.computeVertexNormals();
    assignVertexColors(capRockGeo, (x, y) => capRockColor(x, y, z));
    const capRockMesh = new THREE.Mesh(capRockGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.88, metalness: 0.02,
        side: THREE.DoubleSide,
    }));
    capRockMesh.position.z = z + 0.05;
    group.add(capRockMesh);

    /* 5 & 6. 浅层砂岩 + 地壳（使用 BufferGeometry 条带，共享 crustBottomAt 逐点采样，确保上下界精确对齐） */
    {
        const segsLC = 300; // 每层采样列数
        // 预先逐点计算三条边界（共享 x 坐标）
        const xs        = new Float32Array(segsLC + 1);
        const botFlat   = new Float32Array(segsLC + 1); // 浅层砂岩下界（固定 lithBottom）
        const midBound  = new Float32Array(segsLC + 1); // 分界线 = crustBottomAt（浅层砂岩上界 = 地壳下界）
        const topTerr   = new Float32Array(segsLC + 1); // 地壳上界（terrain）

        for (let i = 0; i <= segsLC; i++) {
            const x = mix(S.xMin, S.xMax, i / segsLC);
            xs[i]       = x;
            botFlat[i]  = S.lithBottom;
            const cBot  = crustBottomAt(x, z);
            const cTop  = terrainHeightAt(x, z);
            midBound[i] = cBot;
            topTerr[i]  = cTop;
        }

        // 通用：将两排点（bot[i], top[i]）构建为条带三角形 BufferGeometry
        // 当某列 yT <= yB 时（厚度=0或倒置），跳过该列的三角形，避免闪烁
        function buildStripGeo(xArr, botArr, topArr, colorFn) {
            const n = xArr.length;
            const posArr = [], colArr = [], idxArr = [];
            // 每列对应两个顶点的起始索引（-1 表示该列被跳过）
            const colVtx = new Int32Array(n).fill(-1);
            let vtx = 0;
            for (let i = 0; i < n; i++) {
                const x  = xArr[i];
                const yB = botArr[i];
                const yT = topArr[i];
                if (yT - yB < 0.001) continue; // 厚度过小跳过
                colVtx[i] = vtx;
                posArr.push(x, yB, 0,  x, yT, 0);
                const cB = colorFn(x, yB);
                colArr.push(cB.r, cB.g, cB.b);
                const cT = colorFn(x, yT);
                colArr.push(cT.r, cT.g, cT.b);
                vtx += 2;
            }
            // 只在相邻两列都有效时生成三角形
            for (let i = 0; i < n - 1; i++) {
                const a = colVtx[i], b = colVtx[i + 1];
                if (a < 0 || b < 0) continue;
                idxArr.push(a, a+1, b,  a+1, b+1, b);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
            geo.setAttribute('color',    new THREE.Float32BufferAttribute(colArr, 3));
            geo.setIndex(idxArr);
            geo.computeVertexNormals();
            return geo;
        }

        // 5. 浅层砂岩：下界 lithBottom → 上界 midBound（= crustBottomAt）
        const srGeo = buildStripGeo(xs, botFlat, midBound, (x, y) => surfaceRockColor(x, y, z));
        const srMesh = new THREE.Mesh(srGeo, new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.90, metalness: 0.01, side: THREE.DoubleSide,
        }));
        srMesh.position.z = z - 0.1;
        group.add(srMesh);

        // 6. 地壳：下界 midBound（= crustBottomAt）→ 上界 topTerr（terrain）
        const crColor = new THREE.Color(0.28, 0.28, 0.30);
        const crGeo = buildStripGeo(xs, midBound, topTerr, () => crColor);
        const crMesh = new THREE.Mesh(crGeo, new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.88, metalness: 0.01, side: THREE.DoubleSide,
        }));
        // 地壳 position.z 稍微靠后于地面前端（frontZ=56），让地面高度场能完整覆盖地壳顶部边缘
        crMesh.position.z = z - 0.1;
        crMesh.renderOrder = 2; // 渲染顺序低于水体（5），水体始终覆盖在地壳上
        group.add(crMesh);
    }

    /* 7. 海水层 */
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const bayEnd = eastShore + 5.0;

    // 大洋水体（上边界跟随波浪起伏，与水面网格对齐）
    const owSegs = 150;
    const oceanWaterShape = new THREE.Shape();
    // 上边界：从左向右逐点采样波浪高度
    oceanWaterShape.moveTo(S.xMin, S.seaLevel + seaWaveAt(S.xMin, z));
    for (let i = 1; i <= owSegs; i++) {
        const x = mix(S.xMin, westShore, i / owSegs);
        oceanWaterShape.lineTo(x, S.seaLevel + seaWaveAt(x, z));
    }
    // 下边界：从右向左逐点采样海底高度（clamp 防止超出模型底面）
    for (let i = owSegs; i >= 0; i--) {
        const x = mix(S.xMin, westShore, i / owSegs);
        const y = Math.max(Math.min(oceanFloorHeight(x, z), S.seaLevel - 0.1), S.basementBottom);
        oceanWaterShape.lineTo(x, y);
    }
    oceanWaterShape.closePath();
    const oceanWaterGeo = new THREE.ShapeGeometry(oceanWaterShape, 150);
    oceanWaterGeo.computeVertexNormals();
    assignVertexColors(oceanWaterGeo, (x, y) => waterColorAt(x, y, z));
    const oceanWaterMesh = new THREE.Mesh(oceanWaterGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.78,
        roughness: 0.65, metalness: 0.02,
        emissive: new THREE.Color(0x1270b0), emissiveIntensity: 0.55,
        side: THREE.DoubleSide,
    }));
    oceanWaterMesh.position.z = z + 0.09;
    oceanWaterMesh.renderOrder = 5;
    group.add(oceanWaterMesh);

    // 海湾水体（上边界跟随波浪起伏）
    const bwSegs = 60;
    const bayWaterShape = new THREE.Shape();
    // 上边界从左到右
    bayWaterShape.moveTo(eastShore, S.seaLevel + seaWaveAt(eastShore, z));
    for (let i = 1; i <= bwSegs; i++) {
        const x = mix(eastShore, bayEnd, i / bwSegs);
        bayWaterShape.lineTo(x, S.seaLevel + seaWaveAt(x, z));
    }
    // 下边界从右到左（clamp 防止超出模型底面）
    for (let i = bwSegs; i >= 0; i--) {
        const x = mix(eastShore, bayEnd, i / bwSegs);
        const y = Math.max(Math.min(bayBedHeight(x, z), S.seaLevel - 0.1), S.basementBottom);
        bayWaterShape.lineTo(x, y);
    }
    bayWaterShape.closePath();
    const bayWaterGeo = new THREE.ShapeGeometry(bayWaterShape, 60);
    bayWaterGeo.computeVertexNormals();
    assignVertexColors(bayWaterGeo, (x, y) => bayWaterColorAt(x, y, z));
    const bayWaterMesh = new THREE.Mesh(bayWaterGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, transparent: true, opacity: 0.65,
        roughness: 0.65, metalness: 0.02,
        emissive: new THREE.Color(0x061a2a), emissiveIntensity: 0.25,
        side: THREE.DoubleSide,
    }));
    bayWaterMesh.position.z = z + 0.10;
    bayWaterMesh.renderOrder = 6;
    group.add(bayWaterMesh);

    /* 8. 海平面线 */
    const seaLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(S.xMin, S.seaLevel, z + 0.11),
        new THREE.Vector3(westShore + 0.5, S.seaLevel, z + 0.11),
    ]);
    group.add(new THREE.Line(seaLineGeo, new THREE.LineBasicMaterial({
        color: 0x7dd8ff, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
    })));

    /* 9. 地层分界线（地下各层的边界线，增强可读性） */
    const layerLineColor = 0xaaaaaa;
    const layerLineOpacity = 0.30;
    const layerLineMat = new THREE.LineBasicMaterial({
        color: layerLineColor, transparent: true, opacity: layerLineOpacity, depthWrite: false,
    });
    // 盖层底/储集层顶（拱形）
    const capBottomLinePoints = [];
    for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const x = mix(S.xMin, S.xMax, t);
        capBottomLinePoints.push(new THREE.Vector3(x, reservoirTopAt(x, z), z + 0.12));
    }
    group.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(capBottomLinePoints), layerLineMat.clone()
    ));
    // 储集层底（不透水层顶，拱形）
    const resBottomLinePoints = [];
    for (let i = 0; i <= 120; i++) {
        const t = i / 120;
        const x = mix(S.xMin, S.xMax, t);
        resBottomLinePoints.push(new THREE.Vector3(x, reservoirBottomAt(x, z), z + 0.12));
    }
    group.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(resBottomLinePoints), layerLineMat.clone()
    ));
    // 不透水层底（水平）
    const wpBottomLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(S.xMin, S.waterproofBottom, z + 0.12),
        new THREE.Vector3(S.xMax, S.waterproofBottom, z + 0.12),
    ]);
    group.add(new THREE.Line(wpBottomLineGeo, layerLineMat.clone()));
    // 盖层顶/砂岩底（水平）
    const capTopLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(S.xMin, S.capRockTop, z + 0.12),
        new THREE.Vector3(S.xMax, S.capRockTop, z + 0.12),
    ]);
    group.add(new THREE.Line(capTopLineGeo, layerLineMat.clone()));
    // 砂岩顶/地表底（水平）
    const surfTopLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(S.xMin, S.surfaceRockTop, z + 0.12),
        new THREE.Vector3(S.xMax, S.surfaceRockTop, z + 0.12),
    ]);
    group.add(new THREE.Line(surfTopLineGeo, layerLineMat.clone()));

    return group;
}

/* ============================================================
   背面剖面板（简化版，z = backZ）
============================================================ */
function createBackProfilePanel() {
    const group = new THREE.Group();
    group.name = 'BackProfile';
    const z = S.backZ;
    const segs = 160;

    /* 基底岩石 */
    const basementShape = new THREE.Shape();
    basementShape.moveTo(S.xMin, S.basementBottom);
    basementShape.lineTo(S.xMax, S.basementBottom);
    basementShape.lineTo(S.xMax, S.basementTop);
    basementShape.lineTo(S.xMin, S.basementTop);
    basementShape.closePath();
    const basementGeo = new THREE.ShapeGeometry(basementShape, 40);
    basementGeo.computeVertexNormals();
    assignVertexColors(basementGeo, (x, y) => basementRockColor(x, y, z));
    const basementMesh = new THREE.Mesh(basementGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.92, metalness: 0.04, side: THREE.DoubleSide,
    }));
    basementMesh.position.z = z - 0.01;
    group.add(basementMesh);

    /* 不透水层 */
    const wpTopProfile = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        wpTopProfile.push(new THREE.Vector2(x, waterproofTopAt(x, z)));
    }
    const waterproofShape = new THREE.Shape();
    waterproofShape.moveTo(S.xMin, S.waterproofBottom);
    waterproofShape.lineTo(S.xMax, S.waterproofBottom);
    for (let i = segs; i >= 0; i--) waterproofShape.lineTo(wpTopProfile[i].x, wpTopProfile[i].y);
    waterproofShape.closePath();
    const waterproofGeo = new THREE.ShapeGeometry(waterproofShape, 80);
    waterproofGeo.computeVertexNormals();
    assignVertexColors(waterproofGeo, (x, y) => waterproofLayerColor(x, y, z));
    const waterproofMesh = new THREE.Mesh(waterproofGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.90, metalness: 0.02, side: THREE.DoubleSide,
    }));
    waterproofMesh.position.z = z - 0.02;
    group.add(waterproofMesh);

    /* 储集层三分 */
    const resBottomPts = [], waterOilPts = [], oilGasPts = [], resTopPts = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        resBottomPts.push(new THREE.Vector2(x, reservoirBottomAt(x, z)));
        waterOilPts.push(new THREE.Vector2(x, waterOilBoundAt(x, z)));
        oilGasPts.push(new THREE.Vector2(x, oilGasBoundAt(x, z)));
        resTopPts.push(new THREE.Vector2(x, reservoirTopAt(x, z)));
    }
    // Water
    const wShape = new THREE.Shape();
    wShape.moveTo(resBottomPts[0].x, resBottomPts[0].y);
    for (let i = 1; i <= segs; i++) wShape.lineTo(resBottomPts[i].x, resBottomPts[i].y);
    for (let i = segs; i >= 0; i--) wShape.lineTo(waterOilPts[i].x, waterOilPts[i].y);
    wShape.closePath();
    const wGeo = new THREE.ShapeGeometry(wShape, 80);
    wGeo.computeVertexNormals();
    assignVertexColors(wGeo, (x, y) => waterZoneColor(x, y, z));
    const wMesh = new THREE.Mesh(wGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.55, metalness: 0.04,
        emissive: new THREE.Color(0x000a2a), emissiveIntensity: 0.45, side: THREE.DoubleSide,
    }));
    wMesh.position.z = z - 0.03;
    group.add(wMesh);
    // Oil
    const oShape = new THREE.Shape();
    oShape.moveTo(waterOilPts[0].x, waterOilPts[0].y);
    for (let i = 1; i <= segs; i++) oShape.lineTo(waterOilPts[i].x, waterOilPts[i].y);
    for (let i = segs; i >= 0; i--) oShape.lineTo(oilGasPts[i].x, oilGasPts[i].y);
    oShape.closePath();
    const oGeo = new THREE.ShapeGeometry(oShape, 80);
    oGeo.computeVertexNormals();
    assignVertexColors(oGeo, (x, y) => oilZoneColor(x, y, z));
    const oMesh = new THREE.Mesh(oGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.30, metalness: 0.06,
        emissive: new THREE.Color(0x000000), emissiveIntensity: 0.0, side: THREE.DoubleSide,
    }));
    oMesh.position.z = z - 0.035;
    group.add(oMesh);
    // Gas
    const gShape = new THREE.Shape();
    gShape.moveTo(oilGasPts[0].x, oilGasPts[0].y);
    for (let i = 1; i <= segs; i++) gShape.lineTo(oilGasPts[i].x, oilGasPts[i].y);
    for (let i = segs; i >= 0; i--) gShape.lineTo(resTopPts[i].x, resTopPts[i].y);
    gShape.closePath();
    const gGeo = new THREE.ShapeGeometry(gShape, 80);
    gGeo.computeVertexNormals();
    assignVertexColors(gGeo, (x, y) => gasZoneColor(x, y, z));
    const gMesh = new THREE.Mesh(gGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.45, metalness: 0.02,
        transparent: true, opacity: 0.88,
        emissive: new THREE.Color(0x303030), emissiveIntensity: 0.15, side: THREE.DoubleSide,
    }));
    gMesh.position.z = z - 0.04;
    group.add(gMesh);

    /* 盖层（顶面动态取 min(terrainHeight, capRockTop)，避免在海洋处突出） */
    {
        const cSegs = 160;
        const cTopPts = [], cBotPts = [];
        for (let i = 0; i <= cSegs; i++) {
            const t = i / cSegs;
            const x = mix(S.xMin, S.xMax, t);
            cTopPts.push(new THREE.Vector2(x, Math.min(terrainHeightAt(x, z), S.capRockTop)));
            cBotPts.push(new THREE.Vector2(x, reservoirTopAt(x, z)));
        }
        const cShape = new THREE.Shape();
        cShape.moveTo(cTopPts[0].x, cTopPts[0].y);
        for (let i = 1; i <= cSegs; i++) cShape.lineTo(cTopPts[i].x, cTopPts[i].y);
        for (let i = cSegs; i >= 0; i--) cShape.lineTo(cBotPts[i].x, cBotPts[i].y);
        cShape.closePath();
        const cGeo = new THREE.ShapeGeometry(cShape, 120);
        cGeo.computeVertexNormals();
        assignVertexColors(cGeo, (x, y) => capRockColor(x, y, z));
        const cMesh = new THREE.Mesh(cGeo, new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide,
        }));
        cMesh.position.z = z - 0.05;
        group.add(cMesh);
    }

    /* 背剖面：浅层砂岩 + 地壳（BufferGeometry 条带，共享 crustBottomAt 逐点采样） */
    {
        const segsB = 300;
        const xsB       = new Float32Array(segsB + 1);
        const botFlatB  = new Float32Array(segsB + 1);
        const midBoundB = new Float32Array(segsB + 1);
        const topTerrB  = new Float32Array(segsB + 1);
        for (let i = 0; i <= segsB; i++) {
            const x = mix(S.xMin, S.xMax, i / segsB);
            xsB[i]       = x;
            botFlatB[i]  = S.lithBottom;
            const cBotB  = crustBottomAt(x, z);
            const cTopB  = terrainHeightAt(x, z);
            midBoundB[i] = cBotB;
            topTerrB[i]  = cTopB;
        }

        function buildStripGeoB(xArr, botArr, topArr, colorFn) {
            const n = xArr.length;
            const posArr = [], colArr = [], idxArr = [];
            const colVtx = new Int32Array(n).fill(-1);
            let vtx = 0;
            for (let i = 0; i < n; i++) {
                const x  = xArr[i];
                const yB = botArr[i];
                const yT = topArr[i];
                if (yT - yB < 0.001) continue;
                colVtx[i] = vtx;
                posArr.push(x, yB, 0,  x, yT, 0);
                const cB = colorFn(x, yB);
                colArr.push(cB.r, cB.g, cB.b);
                const cT = colorFn(x, yT);
                colArr.push(cT.r, cT.g, cT.b);
                vtx += 2;
            }
            for (let i = 0; i < n - 1; i++) {
                const a = colVtx[i], b = colVtx[i + 1];
                if (a < 0 || b < 0) continue;
                idxArr.push(a, a+1, b,  a+1, b+1, b);
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
            geo.setAttribute('color',    new THREE.Float32BufferAttribute(colArr, 3));
            geo.setIndex(idxArr);
            geo.computeVertexNormals();
            return geo;
        }

        // 浅层砂岩
        const srGeo2 = buildStripGeoB(xsB, botFlatB, midBoundB, (x, y) => surfaceRockColor(x, y, z));
        const srMesh2 = new THREE.Mesh(srGeo2, new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.90, metalness: 0.01, side: THREE.DoubleSide,
        }));
        srMesh2.position.z = z - 0.06;
        group.add(srMesh2);

        // 地壳
        const crColorB = new THREE.Color(0.28, 0.28, 0.30);
        const crGeo2 = buildStripGeoB(xsB, midBoundB, topTerrB, () => crColorB);
        const crMesh2 = new THREE.Mesh(crGeo2, new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.88, metalness: 0.01, side: THREE.DoubleSide,
        }));
        crMesh2.position.z = z - 0.07;
        crMesh2.renderOrder = 2;
        group.add(crMesh2);
    }

    return group;
}

/* ============================================================
   ★ 地下分层 3D 体积面（顶视高度场）
   用于展示储集层在3D空间的分布
============================================================ */
function createSubsurfaceLayers(textures) {
    const group = new THREE.Group();
    group.name = 'SubsurfaceLayers';
    // 所有水平地层顶面已移除，避免在海洋中出现不必要的平面
    return group;
}

/* ============================================================
   纹理加载
============================================================ */
function configureTexture(texture, repeatX, repeatY) {
    if (!texture) return null;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    return texture;
}

function loadTextures(deps = {}) {
    const loader = new THREE.TextureLoader();
    const waterNormalTex = deps.waterNormalTex || loader.load('./assets/textures/ambientcg/Ice002_1K-JPG_NormalGL.jpg');
    configureTexture(waterNormalTex, 5, 4);
    const grassColor = loader.load('./assets/textures/terrain/grasslight-big.jpg');
    configureTexture(grassColor, 9, 7);
    const rockColor = loader.load('./assets/textures/brick_diffuse.jpg');
    configureTexture(rockColor, 18, 12);
    const rockBump = loader.load('./assets/textures/brick_bump.jpg');
    configureTexture(rockBump, 18, 12);
    const rockRoughness = loader.load('./assets/textures/brick_roughness.jpg');
    configureTexture(rockRoughness, 18, 12);
    const snowColor = loader.load('./assets/textures/ambientcg/Ice002_1K-JPG_Color.jpg');
    configureTexture(snowColor, 4.5, 3.5);
    const snowNormal = loader.load('./assets/textures/ambientcg/Ice002_1K-JPG_NormalGL.jpg');
    configureTexture(snowNormal, 4.5, 3.5);
    const snowRoughness = loader.load('./assets/textures/ambientcg/Ice002_1K-JPG_Roughness.jpg');
    configureTexture(snowRoughness, 4.5, 3.5);
    return { waterNormalTex, grassColor, rockColor, rockBump, rockRoughness, snowColor, snowNormal, snowRoughness };
}

function createSnowCapMesh(sourceGeometry, textures) {
    const geometry = sourceGeometry.clone();
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
        const snowLine = S.snowBase + fbmNoise(x, z, 3, 0.05, 0.55) * 1.2;
        if (y < snowLine) {
            positions.setY(i, y - 2.0);
        } else {
            const puff = gaussian(y, snowLine + 1.5, 3.5) * 0.12;
            positions.setY(i, y + 0.06 + puff);
        }
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff, map: textures.snowColor, normalMap: textures.snowNormal,
        roughnessMap: textures.snowRoughness, transparent: true, opacity: 0.9,
        roughness: 0.95, metalness: 0.0, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
}

function createMountainDetailMesh(sourceGeometry, textures) {
    const geometry = sourceGeometry.clone();
    const positions = geometry.getAttribute('position');
    const colors = new Float32Array(positions.count * 4);
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i);
        const field = getMountainField(x, z);
        const rockMask  = clamp(field.rangeEnvelope * field.rangeMask * 0.78, 0, 1);
        const sharpMask = clamp(field.rangeEnvelope * field.crestMask, 0, 1);
        const snowLine = S.snowBase + fbmNoise(x, z, 3, 0.05, 0.55) * 1.2;
        const snowMask = smoothstep(snowLine - 1.0, snowLine + 1.5, y);
        const crag = clamp(ridgedNoise(x * 2.0 + 4.0, z * 2.5 - 2.0, 4, 0.13, 0.44), 0, 1);
        const alpha = clamp((rockMask - 0.16) / 0.58, 0, 1) * smoothstep(S.seaLevel + 2.0, 9.0, y);
        const lift = alpha * (0.02 + sharpMask * 0.08 + crag * 0.12);
        positions.setY(i, y + lift);
        let r = mix(0.56, 0.92, snowMask), g = mix(0.53, 0.94, snowMask), b = mix(0.49, 0.98, snowMask);
        r = mix(r, 0.46, sharpMask * 0.65); g = mix(g, 0.43, sharpMask * 0.65); b = mix(b, 0.39, sharpMask * 0.65);
        colors[i * 4] = clamp(r + crag * 0.04, 0, 1);
        colors[i * 4 + 1] = clamp(g + crag * 0.03, 0, 1);
        colors[i * 4 + 2] = clamp(b + crag * 0.02, 0, 1);
        colors[i * 4 + 3] = alpha;
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    const material = new THREE.MeshStandardMaterial({
        map: textures.rockColor, bumpMap: textures.rockBump, roughnessMap: textures.rockRoughness,
        bumpScale: 0.45, roughness: 0.98, metalness: 0.02, vertexColors: true,
        transparent: true, opacity: 1.0, alphaTest: 0.08,
        depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
}

/* ============================================================
   侧壁（带完整地层剖面，X 固定，Z 为横轴，Y 为纵轴）
============================================================ */
function createLayeredSideWall(xPosition, textures) {
    const group = new THREE.Group();
    group.name = `SideWall_${xPosition > 0 ? 'Right' : 'Left'}`;

    // 侧面剖面沿 Z 轴方向采样地形高度
    const segs = 160;     // Z 轴分段数
    const ySegs = 12;     // Y 轴分段数（用于分层赋色）
    // 侧壁 Z 范围稍微缩短，避免与正面板(z=+56)和背面板(z=-56)共面导致 Z-fighting
    const wallBackZ  = S.backZ  + 0.15;
    const wallFrontZ = S.frontZ - 0.15;
    const wallDepth  = wallFrontZ - wallBackZ;

    /* ——— 辅助函数：建造矩形分层面板（从 yBot 到 yTop，Z 从 wallBackZ 到 wallFrontZ） ——— */
    function addLayer(yBot, yTop, colorFn, matOpts = {}) {
        const geo = new THREE.PlaneGeometry(wallDepth, yTop - yBot, segs, ySegs);
        const pos = geo.getAttribute('position');
        // PlaneGeometry 未旋转时：pos.getX(i) ∈ [-depth/2, +depth/2] → 旋转后对应场景 Z
        //                          pos.getY(i) ∈ [-h/2, +h/2]         → 旋转后对应场景 Y（相对中心）
        // mesh.position.y = (yBot + yTop) * 0.5，所以场景 Y = pos.getY(i) + (yBot + yTop) * 0.5
        const colors = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
            const zScene = pos.getX(i);                          // 旋转后 = 场景 Z
            const yScene = pos.getY(i) + (yBot + yTop) * 0.5;   // 绝对场景 Y
            const c = colorFn(xPosition, yScene, zScene);
            colors[i * 3]     = c.r;
            colors[i * 3 + 1] = c.g;
            colors[i * 3 + 2] = c.b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.90, metalness: 0.02,
            side: THREE.DoubleSide, ...matOpts,
        });
        const mesh = new THREE.Mesh(geo, mat);
        // 旋转：让平面面向 X 轴方向（法线沿 X）
        mesh.rotation.y = Math.PI * 0.5;
        mesh.position.set(xPosition, (yBot + yTop) * 0.5, 0);
        group.add(mesh);
    }

    /* ——— 辅助函数：逐列沿 Z 轴采样动态上下界，构建精确轮廓的 BufferGeometry ——— */
    // botFn(z)/topFn(z) 返回该 Z 处的底/顶 Y 坐标
    // ySubdiv：在底顶之间插入的 Y 细分层数（越多颜色边界越精确）
    // layerOrder：层序号（0=最底层），用于 polygonOffset 消除相邻层 Z-fighting
    function addDynamicLayer(botFn, topFn, colorFn, ySubdiv = 8, matOpts = {}, layerOrder = 0) {
        const posArr = [], colArr = [], idxArr = [];
        const rows = ySubdiv + 1; // 每列的顶点行数（含首尾）

        for (let i = 0; i <= segs; i++) {
            const t  = i / segs;
            const zv = mix(wallBackZ, wallFrontZ, t);
            const yBot = botFn(zv);
            const yTop = topFn(zv);
            for (let j = 0; j < rows; j++) {
                const tj = j / (rows - 1);
                const yv = yBot + (yTop - yBot) * tj;
                posArr.push(xPosition, yv, zv);
                const c = colorFn(xPosition, yv, zv);
                colArr.push(c.r, c.g, c.b);
            }
        }
        // 构建索引
        for (let i = 0; i < segs; i++) {
            for (let j = 0; j < rows - 1; j++) {
                const a = i * rows + j;
                const b = i * rows + j + 1;
                const c = (i + 1) * rows + j;
                const d = (i + 1) * rows + j + 1;
                idxArr.push(a, b, c, b, d, c);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
        geo.setAttribute('color',    new THREE.Float32BufferAttribute(colArr, 3));
        geo.setIndex(idxArr);
        geo.computeVertexNormals();
        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true, roughness: 0.90, metalness: 0.02,
            side: THREE.DoubleSide,
            // polygonOffset 让每层在深度缓冲中微小错开，消除共面 Z-fighting
            polygonOffset: true,
            polygonOffsetFactor: -layerOrder,
            polygonOffsetUnits: -layerOrder,
            ...matOpts,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = layerOrder;
        group.add(mesh);
    }

    /* ——— 各地层（从底到顶） ——— */
    // 1. 基底岩石（固定平坦，用静态 addLayer 即可；加 polygonOffset 避免与正/背面板共面冲突）
    addLayer(S.basementBottom, S.basementTop,
        (x, y, z) => basementRockColor(x, y, z),
        { roughness: 0.92, metalness: 0.04, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

    // 2. 不透水层（动态底面：固定底，动态顶=储集层底面）
    addDynamicLayer(
        () => S.waterproofBottom,
        (zv) => reservoirBottomAt(xPosition, zv),
        (x, y, z) => waterproofLayerColor(x, y, z),
        6, {}, 1
    );

    // 3-a. 储集层含水段（动态：底=reservoirBottom，顶=油水界面）
    addDynamicLayer(
        (zv) => reservoirBottomAt(xPosition, zv),
        (zv) => waterOilBoundAt(xPosition, zv),
        (x, y, z) => waterZoneColor(x, y, z),
        4,
        { emissive: new THREE.Color(0x020408), emissiveIntensity: 0.08 },
        2
    );

    // 3-b. 储集层石油段（动态：底=油水界面，顶=油气界面）
    addDynamicLayer(
        (zv) => waterOilBoundAt(xPosition, zv),
        (zv) => oilGasBoundAt(xPosition, zv),
        (x, y, z) => oilZoneColor(x, y, z),
        4,
        { emissive: new THREE.Color(0x060402), emissiveIntensity: 0.10 },
        3
    );

    // 3-c. 储集层天然气段（动态：底=油气界面，顶=储集层顶面）
    addDynamicLayer(
        (zv) => oilGasBoundAt(xPosition, zv),
        (zv) => reservoirTopAt(xPosition, zv),
        (x, y, z) => gasZoneColor(x, y, z),
        4,
        { emissive: new THREE.Color(0x060402), emissiveIntensity: 0.10 },
        4
    );

    // 4. 盖层（动态：底=储集层顶面，顶=固定 capRockTop）
    addDynamicLayer(
        (zv) => reservoirTopAt(xPosition, zv),
        () => S.capRockTop,
        (x, y, z) => capRockColor(x, y, z),
        6, {}, 5
    );

    // 5. 浅层砂岩：下界 S.lithBottom，上界 = crustBottomAt（与正/背剖面对齐）
    addDynamicLayer(
        () => S.lithBottom,
        (zv) => crustBottomAt(xPosition, zv),
        (x, y, z) => surfaceRockColor(x, y, z),
        4, { polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 }, 6
    );

    // 5b. 地壳下段：crustBottomAt → S.surfaceRockTop(Y=0)，深灰色，与正/背剖面对齐
    addDynamicLayer(
        (zv) => crustBottomAt(xPosition, zv),
        (zv) => Math.min(terrainHeightAt(xPosition, zv), S.surfaceRockTop),
        () => new THREE.Color(0.28, 0.28, 0.30),
        4, { polygonOffset: true, polygonOffsetFactor: -7, polygonOffsetUnits: -7 }, 7
    );

    /* ——— 地形以上部分（海洋侧壁带水体，陆地侧壁带岩石纹理） ——— */
    // 只在陆地区域（topY > botY）绘制地形面，海洋区域 topY = 海底高度 < 0 = botY，跳过
    // 用逐列构建的 BufferGeometry 精确跟随地形高度
    {
        const cPosArr = [], cIdxArr = [], cUvArr = [], cColArr = [];
        // 记录每列的顶点起始 index（-1 表示该列跳过）
        const colStart = [];
        let vtxCount = 0;
        for (let i = 0; i <= segs; i++) {
            const t  = i / segs;
            const zv = mix(wallBackZ, wallFrontZ, t);
            const topY = terrainHeightAt(xPosition, zv);
            const botY = S.surfaceRockTop; // Y=0
            if (topY <= botY) {
                // 海洋区域：地形低于地表底，跳过此列
                colStart.push(-1);
                continue;
            }
            colStart.push(vtxCount);
            cPosArr.push(xPosition, topY, zv);
            cPosArr.push(xPosition, botY, zv);
            cUvArr.push(t, 1.0);
            cUvArr.push(t, 0.0);
            const crustGrayColor = new THREE.Color(0.28, 0.28, 0.30);
            const cTop = crustGrayColor;
            const cBot = crustGrayColor;
            cColArr.push(cTop.r, cTop.g, cTop.b);
            cColArr.push(cBot.r, cBot.g, cBot.b);
            vtxCount += 2;
        }
        // 只在相邻两列都有效时生成三角形
        for (let i = 0; i < segs; i++) {
            const sa = colStart[i], sb = colStart[i + 1];
            if (sa < 0 || sb < 0) continue;
            const a = sa, b = sa + 1, c = sb, d = sb + 1;
            cIdxArr.push(a, b, c, b, d, c);
        }
        if (cPosArr.length >= 9) {
            const crustGeo = new THREE.BufferGeometry();
            crustGeo.setAttribute('position', new THREE.Float32BufferAttribute(cPosArr, 3));
            crustGeo.setAttribute('uv',       new THREE.Float32BufferAttribute(cUvArr, 2));
            crustGeo.setAttribute('color',    new THREE.Float32BufferAttribute(cColArr, 3));
            crustGeo.setIndex(cIdxArr);
            crustGeo.computeVertexNormals();
            const crustMat = new THREE.MeshStandardMaterial({
                vertexColors: true, roughness: 0.88, metalness: 0.01,
                side: THREE.DoubleSide,
                polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -8,
            });
            group.add(new THREE.Mesh(crustGeo, crustMat));
        }
    }

    /* ——— 海水（仅左侧海洋端出现） ——— */
    const isOceanSide = xPosition <= S.xMin + 1;
    if (isOceanSide) {
        const westShore = indiaWestCoast(0);
        const wPosArr = [], wIdxArr = [], wColArr = [];
        for (let i = 0; i <= segs; i++) {
            const t  = i / segs;
            const zv = mix(wallBackZ, wallFrontZ, t);
            const ws = indiaWestCoast(zv);
            if (xPosition > ws) continue; // 不在海洋区域则跳过
            const floorY = Math.max(Math.min(oceanFloorHeight(xPosition, zv), S.seaLevel - 0.1), S.basementBottom); // clamp 防止超出底面
            const topY = S.seaLevel + seaWaveAt(xPosition, zv); // 上边界跟随波浪起伏
            wPosArr.push(xPosition, topY, zv);
            wPosArr.push(xPosition, floorY, zv);
            wColArr.push(0.04, 0.22, 0.62);
            wColArr.push(0.02, 0.12, 0.42);
        }
        if (wPosArr.length >= 12) {
            const wCnt = wPosArr.length / 3;
            for (let i = 0; i < wCnt / 2 - 1; i++) {
                const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
                wIdxArr.push(a, b, c, b, d, c);
            }
            const wGeo = new THREE.BufferGeometry();
            wGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPosArr, 3));
            wGeo.setAttribute('color',    new THREE.Float32BufferAttribute(wColArr, 3));
            wGeo.setIndex(wIdxArr);
            wGeo.computeVertexNormals();
            const wMat = new THREE.MeshStandardMaterial({
                vertexColors: true, transparent: true, opacity: 0.70,
                emissive: new THREE.Color(0x0c4d78), emissiveIntensity: 0.45,
                roughness: 0.65, metalness: 0.02, side: THREE.DoubleSide,
            });
            group.add(new THREE.Mesh(wGeo, wMat));
        }
    }

    return group;
}

function createWaterSideWall(xPosition, floorHeight) {
    const geometry = new THREE.PlaneGeometry(S.depth, Math.max(S.seaLevel - floorHeight, 2));
    const material = new THREE.MeshStandardMaterial({
        color: 0x1065a0, transparent: true, opacity: 0.72,
        emissive: new THREE.Color(0x0c4d78), emissiveIntensity: 0.45,
        roughness: 0.65, metalness: 0.02, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = Math.PI * 0.5;
    mesh.position.set(xPosition, (S.seaLevel + floorHeight) * 0.5, 0);
    mesh.receiveShadow = true;
    return mesh;
}

/* ============================================================
   ★ 油井结构创建函数
   oil well structure: 4 legs, center pipe, top platform
============================================================ */

/**
 * 创建一个油井塔架（钻井塔）模型
 * @param {number} scale - 缩放比例
 * @param {boolean} isOffshore - 是否是海上油井（影响平台样式）
 * @returns {THREE.Group}
 */
function createOilWellTower(scale = 1.0, isOffshore = false) {
    const group = new THREE.Group();

    const metalMat = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a, roughness: 0.6, metalness: 0.8,
    });
    const darkMetalMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, roughness: 0.5, metalness: 0.9,
    });
    const platformMat = new THREE.MeshStandardMaterial({
        color: 0x555555, roughness: 0.7, metalness: 0.6,
    });

    const towerH = 10 * scale;     // 塔架高度
    const towerBase = 4 * scale;   // 塔架底部宽度
    const towerTop = 1.2 * scale;  // 塔架顶部宽度

    // ── 四条腿（从底部四角到顶部中心区域，形成梯形框架） ──
    const legPositions = [
        [-towerBase * 0.5,  towerBase * 0.5],
        [ towerBase * 0.5,  towerBase * 0.5],
        [ towerBase * 0.5, -towerBase * 0.5],
        [-towerBase * 0.5, -towerBase * 0.5],
    ];
    const legTopPositions = [
        [-towerTop * 0.5,  towerTop * 0.5],
        [ towerTop * 0.5,  towerTop * 0.5],
        [ towerTop * 0.5, -towerTop * 0.5],
        [-towerTop * 0.5, -towerTop * 0.5],
    ];

    for (let i = 0; i < 4; i++) {
        const [bx, bz] = legPositions[i];
        const [tx, tz] = legTopPositions[i];

        // 计算腿的中心点和方向
        const startVec = new THREE.Vector3(bx, 0, bz);
        const endVec   = new THREE.Vector3(tx, towerH, tz);
        const midPoint = startVec.clone().add(endVec).multiplyScalar(0.5);
        const legDir   = endVec.clone().sub(startVec);
        const legLen   = legDir.length();

        const legGeo = new THREE.CylinderGeometry(0.10 * scale, 0.12 * scale, legLen, 5);
        const legMesh = new THREE.Mesh(legGeo, metalMat.clone());
        legMesh.position.copy(midPoint);
        // 让圆柱对准腿方向
        const axis = new THREE.Vector3(0, 1, 0);
        legMesh.quaternion.setFromUnitVectors(axis, legDir.clone().normalize());
        group.add(legMesh);
    }

    // ── 横撑（每隔一定高度加水平撑杆，增强塔架的真实感） ──
    const braceHeights = [towerH * 0.3, towerH * 0.6];
    for (const bh of braceHeights) {
        const t = bh / towerH;
        const bw = mix(towerBase, towerTop, t);
        // X方向两根横撑
        for (const z of [-bw * 0.5, bw * 0.5]) {
            const braceGeo = new THREE.CylinderGeometry(0.06 * scale, 0.06 * scale, bw, 4);
            const braceMesh = new THREE.Mesh(braceGeo, darkMetalMat.clone());
            braceMesh.rotation.z = Math.PI * 0.5;
            braceMesh.position.set(0, bh, z);
            group.add(braceMesh);
        }
        // Z方向两根横撑
        for (const x of [-bw * 0.5, bw * 0.5]) {
            const braceGeo = new THREE.CylinderGeometry(0.06 * scale, 0.06 * scale, bw, 4);
            const braceMesh = new THREE.Mesh(braceGeo, darkMetalMat.clone());
            braceMesh.rotation.x = Math.PI * 0.5;
            braceMesh.position.set(x, bh, 0);
            group.add(braceMesh);
        }
    }

    // ── 斜撑（X形交叉斜撑，视觉效果更真实） ──
    const xBraceSections = [[0, towerH * 0.3], [towerH * 0.3, towerH * 0.6], [towerH * 0.6, towerH]];
    for (const [y0, y1] of xBraceSections) {
        const t0 = y0 / towerH, t1 = y1 / towerH;
        const w0 = mix(towerBase, towerTop, t0);
        const w1 = mix(towerBase, towerTop, t1);
        // 前后面的X交叉
        for (const zSign of [-1, 1]) {
            const p1 = new THREE.Vector3(-w0 * 0.5, y0, zSign * w0 * 0.5);
            const p2 = new THREE.Vector3( w1 * 0.5, y1, zSign * w1 * 0.5);
            const mid = p1.clone().add(p2).multiplyScalar(0.5);
            const dir = p2.clone().sub(p1);
            const len = dir.length();
            const dGeo = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, len, 4);
            const dMesh = new THREE.Mesh(dGeo, darkMetalMat.clone());
            dMesh.position.copy(mid);
            dMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
            group.add(dMesh);

            const q1 = new THREE.Vector3( w0 * 0.5, y0, zSign * w0 * 0.5);
            const q2 = new THREE.Vector3(-w1 * 0.5, y1, zSign * w1 * 0.5);
            const midQ = q1.clone().add(q2).multiplyScalar(0.5);
            const dirQ = q2.clone().sub(q1);
            const lenQ = dirQ.length();
            const dGeoQ = new THREE.CylinderGeometry(0.05 * scale, 0.05 * scale, lenQ, 4);
            const dMeshQ = new THREE.Mesh(dGeoQ, darkMetalMat.clone());
            dMeshQ.position.copy(midQ);
            dMeshQ.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirQ.clone().normalize());
            group.add(dMeshQ);
        }
    }

    // ── 顶部平台 ──
    const platW = towerTop * 2.2;
    const platH = 0.3 * scale;
    const platGeo = new THREE.BoxGeometry(platW, platH, platW);
    const platMesh = new THREE.Mesh(platGeo, platformMat.clone());
    platMesh.position.set(0, towerH + platH * 0.5, 0);
    group.add(platMesh);

    // 顶部小结构（顶部三角架）
    const topCapGeo = new THREE.ConeGeometry(0.4 * scale, 1.5 * scale, 4);
    const topCapMesh = new THREE.Mesh(topCapGeo, metalMat.clone());
    topCapMesh.position.set(0, towerH + platH + 0.75 * scale, 0);
    group.add(topCapMesh);

    return group;
}

/**
 * 创建陆地油井（包含地表以上的井架，以及从地表穿透到石油层的油管）
 * @param {number} x - 油井 X 坐标
 * @param {number} z - 油井 Z 坐标
 * @param {number} surfaceY - 地表高度（井架基座所在高度）
 * @param {number} oilLayerY - 石油层深度（油管底部高度）
 * @returns {THREE.Group}
 */
function createLandOilWell(x, z, surfaceY, oilLayerY) {
    const group = new THREE.Group();
    group.name = 'LandOilWell';

    const scale = 0.9;

    // ── 油井塔架 ──
    const tower = createOilWellTower(scale, false);
    tower.position.set(x, surfaceY, z);
    group.add(tower);

    // ── 中心油管（从塔顶往下穿透到石油层） ──
    // 管顶位于塔架顶部平台处
    const towerH = 10 * scale;
    const platH  = 0.3 * scale;
    const pipeTopY = surfaceY + towerH + platH;
    const pipeLen  = pipeTopY - oilLayerY;
    const pipeGeo = new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, pipeLen, 8);
    const pipeMat = new THREE.MeshStandardMaterial({
        color: 0x333333, roughness: 0.4, metalness: 0.95,
    });
    const pipeMesh = new THREE.Mesh(pipeGeo, pipeMat);
    pipeMesh.position.set(x, pipeTopY - pipeLen * 0.5, z);
    group.add(pipeMesh);

    // 油管在石油层内延伸的末端（发光效果，表示正在抽油）
    const pipeTipGeo = new THREE.CylinderGeometry(0.2 * scale, 0.1 * scale, 1.0, 8);
    const pipeTipMat = new THREE.MeshStandardMaterial({
        color: 0x1a0a00, roughness: 0.3, metalness: 0.8,
        emissive: new THREE.Color(0x3a2000), emissiveIntensity: 0.8,
    });
    const pipeTipMesh = new THREE.Mesh(pipeTipGeo, pipeTipMat);
    pipeTipMesh.position.set(x, oilLayerY + 0.5, z);
    group.add(pipeTipMesh);

    return group;
}

/**
 * 创建海上钻井平台（包含海面以上的平台结构、支柱入水、以及油管深入海底到石油层）
 * @param {number} x - 油井 X 坐标
 * @param {number} z - 油井 Z 坐标
 * @param {number} seaLevel - 海平面高度
 * @param {number} seabedY - 海床高度
 * @param {number} oilLayerY - 石油层深度（油管底部高度）
 * @returns {THREE.Group}
 */
function createOffshoreOilPlatform(x, z, seaLevel, seabedY, oilLayerY) {
    const group = new THREE.Group();
    group.name = 'OffshoreOilPlatform';

    const scale = 1.1;
    const platformY = seaLevel + 3.5 * scale; // 平台高于海面的高度

    // ── 海上平台（大型水平平台板） ──
    const platW = 8 * scale;
    const platD = 8 * scale;
    const platH = 0.6 * scale;
    const platMat = new THREE.MeshStandardMaterial({
        color: 0x666666, roughness: 0.8, metalness: 0.5,
    });
    const platGeo = new THREE.BoxGeometry(platW, platH, platD);
    const platMesh = new THREE.Mesh(platGeo, platMat);
    platMesh.position.set(x, platformY, z);
    platMesh.castShadow = true;
    platMesh.receiveShadow = true;
    group.add(platMesh);

    // ── 平台四条支柱（从平台底面延伸到海底） ──
    const legOffsets = [
        [-platW * 0.35, -platD * 0.35],
        [ platW * 0.35, -platD * 0.35],
        [ platW * 0.35,  platD * 0.35],
        [-platW * 0.35,  platD * 0.35],
    ];
    const legLen = platformY - platH * 0.5 - seabedY;
    const legMat = new THREE.MeshStandardMaterial({
        color: 0x4a4a4a, roughness: 0.6, metalness: 0.8,
    });
    for (const [ox, oz] of legOffsets) {
        const legGeo = new THREE.CylinderGeometry(0.35 * scale, 0.40 * scale, legLen, 8);
        const legMesh = new THREE.Mesh(legGeo, legMat.clone());
        legMesh.position.set(x + ox, seabedY + legLen * 0.5, z + oz);
        legMesh.castShadow = true;
        group.add(legMesh);

        // 水线附近的横向加固箍
        const ringY = seaLevel - 1.5;
        const ringGeo = new THREE.TorusGeometry(0.45 * scale, 0.07 * scale, 6, 12);
        const ringMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.7, metalness: 0.7 });
        const ringMesh = new THREE.Mesh(ringGeo, ringMat);
        ringMesh.rotation.x = Math.PI * 0.5;
        ringMesh.position.set(x + ox, ringY, z + oz);
        group.add(ringMesh);
    }

    // ── 支柱间的横向支撑（X形）──
    const braceY1 = seaLevel - 4;
    const braceY2 = seaLevel - 8;
    const bw = platW * 0.7;
    const darkLegMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.7 });
    for (const [y, xOff, zOff] of [[braceY1, 0, 0], [braceY2, 0, 0]]) {
        // 平行于X方向的两根
        for (const zs of [-bw * 0.5, bw * 0.5]) {
            const bGeo = new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, bw, 6);
            const bMesh = new THREE.Mesh(bGeo, darkLegMat.clone());
            bMesh.rotation.z = Math.PI * 0.5;
            bMesh.position.set(x, y, z + zs);
            group.add(bMesh);
        }
        // 平行于Z方向的两根
        for (const xs of [-bw * 0.5, bw * 0.5]) {
            const bGeo = new THREE.CylinderGeometry(0.12 * scale, 0.12 * scale, bw, 6);
            const bMesh = new THREE.Mesh(bGeo, darkLegMat.clone());
            bMesh.rotation.x = Math.PI * 0.5;
            bMesh.position.set(x + xs, y, z);
            group.add(bMesh);
        }
    }

    // ── 平台上方的钻井塔架 ──
    const tower = createOilWellTower(scale * 0.85, true);
    tower.position.set(x, platformY + platH * 0.5, z);
    group.add(tower);

    // ── 中心油管（从塔顶往下穿过海水、海底一直到石油层） ──
    // 管顶位于塔架顶部平台处（tower 创建时 scale = scale*0.85）
    const towerScaleOff = scale * 0.85;
    const towerHOff     = 10 * towerScaleOff;
    const towerPlatHOff = 0.3 * towerScaleOff;
    // tower.position.y = platformY + platH*0.5，塔架本身底部在此处
    const towerBaseY = platformY + platH * 0.5;
    const pipeTopY   = towerBaseY + towerHOff + towerPlatHOff;
    const pipeMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, roughness: 0.4, metalness: 0.95,
    });

    // 塔顶到海面以上的油管
    const aboveWaterLen = pipeTopY - seaLevel;
    const pipeAboveGeo = new THREE.CylinderGeometry(0.18 * scale, 0.18 * scale, aboveWaterLen, 8);
    const pipeAboveMesh = new THREE.Mesh(pipeAboveGeo, pipeMat.clone());
    pipeAboveMesh.position.set(x, seaLevel + aboveWaterLen * 0.5, z);
    group.add(pipeAboveMesh);

    // 海面以下（穿过海水到海底）的油管
    const underwaterLen = seaLevel - seabedY;
    const pipeUnderGeo = new THREE.CylinderGeometry(0.18 * scale, 0.18 * scale, underwaterLen, 8);
    const pipeUnderMat = new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, roughness: 0.4, metalness: 0.95,
        transparent: true, opacity: 0.85,
    });
    const pipeUnderMesh = new THREE.Mesh(pipeUnderGeo, pipeUnderMat);
    pipeUnderMesh.position.set(x, seabedY + underwaterLen * 0.5, z);
    group.add(pipeUnderMesh);

    // 海底以下到石油层的深部油管
    const deepLen = seabedY - oilLayerY;
    if (deepLen > 0.5) {
        const pipeDeepGeo = new THREE.CylinderGeometry(0.15 * scale, 0.15 * scale, deepLen, 8);
        const pipeDeepMesh = new THREE.Mesh(pipeDeepGeo, pipeMat.clone());
        pipeDeepMesh.position.set(x, oilLayerY + deepLen * 0.5, z);
        group.add(pipeDeepMesh);
    }

    // 油管在石油层内延伸的末端（发光效果）
    const pipeTipGeo = new THREE.CylinderGeometry(0.22 * scale, 0.12 * scale, 1.2, 8);
    const pipeTipMat = new THREE.MeshStandardMaterial({
        color: 0x1a0a00, roughness: 0.3, metalness: 0.8,
        emissive: new THREE.Color(0x3a2000), emissiveIntensity: 0.8,
    });
    const pipeTipMesh = new THREE.Mesh(pipeTipGeo, pipeTipMat);
    pipeTipMesh.position.set(x, oilLayerY + 0.6, z);
    group.add(pipeTipMesh);

    return group;
}

/* ============================================================
   主函数：createTectonicLandscape
============================================================ */
export function createTectonicLandscape(scene, deps = {}) {
    const root = new THREE.Group();
    root.name = 'TectonicLandscape';
    scene.add(root);

    const textures = loadTextures(deps);

    const westShore0  = indiaWestCoast(0);
    const eastShore0  = indiaEastCoast(0);
    const bayEnd0     = eastShore0 + 5;

    /* ===== 1. 地下分层体积面（3D顶面，从底往上） ===== */
    const subsurfaceLayers = createSubsurfaceLayers(textures);
    root.add(subsurfaceLayers);

    /* ===== 2. 正面完整剖面板（含所有地下分层） ===== */
    const frontPanel = createFrontProfilePanel(textures);
    root.add(frontPanel);

    /* ===== 3. 背面剖面板 ===== */
    const backPanel = createBackProfilePanel();
    root.add(backPanel);

    /* ===== 4. 海底顶面 3D 高度场（深海+浅海） ===== */
    const oceanFloorTop = createHeightField(
        S.xMin, S.indiaWestMeanX - 5, S.depth, 200, 96, oceanFloorHeight, oceanTopColorAt,
        { roughness: 0.98, metalness: 0.02, emissive: new THREE.Color(0x0f1726), emissiveIntensity: 0.16 }
    );
    root.add(oceanFloorTop);

    /* ===== 5. 海水层（背面面板） ===== */
    // xEnd 使用背面真实海岸线，避免海水超出陆地区域
    const westShoreBack = indiaWestCoast(S.backZ);
    const waterBedProfileBack = sampleProfile(S.backZ, S.xMin, westShoreBack, 180, (x, z) => (
        Math.max(Math.min(oceanFloorHeight(x, z), S.seaLevel - 0.1), S.basementBottom)
    ));
    const waterTopProfileBack = waterBedProfileBack.map(p => new THREE.Vector2(p.x, S.seaLevel + seaWaveAt(p.x, S.backZ)));
    const waterBack = createFilledSection(waterTopProfileBack, waterBedProfileBack, waterColorAt, {
        opacity: 0.78, emissive: new THREE.Color(0x1270b0), emissiveIntensity: 0.65,
    });
    waterBack.position.z = S.backZ - 0.1;
    waterBack.renderOrder = 5;
    root.add(waterBack);

    // 海面 3D 高度场
    const waterSurface = createOceanWaterSurface({
        emissive: new THREE.Color(0x1270b0), emissiveIntensity: 0.44,
        normalMap: textures.waterNormalTex, normalScale: new THREE.Vector2(0.24, 0.24),
    });
    waterSurface.renderOrder = 6;
    root.add(waterSurface);

    /* ===== 6. 海湾（S型小海湾） ===== */
    const bayWater = createBayWaterSurface({
        emissive: new THREE.Color(0x061a2a), emissiveIntensity: 0.2,
        normalMap: textures.waterNormalTex, normalScale: new THREE.Vector2(0.15, 0.15),
    });
    root.add(bayWater);

    // 背面海湾水体
    {
        const zBack = S.backZ;
        const eastShoreBack = indiaEastCoast(zBack);
        const bayEndBack    = eastShoreBack + 5.0;
        const segs = 40;
        const bayBackShape = new THREE.Shape();
        // 上边界跟随波浪起伏
        bayBackShape.moveTo(eastShoreBack, S.seaLevel + seaWaveAt(eastShoreBack, zBack));
        for (let i = 1; i <= segs; i++) {
            const x = mix(eastShoreBack, bayEndBack, i / segs);
            bayBackShape.lineTo(x, S.seaLevel + seaWaveAt(x, zBack));
        }
        // 下边界从右到左（clamp 防止超出模型底面）
        for (let i = segs; i >= 0; i--) {
            const t = i / segs;
            const x = mix(eastShoreBack, bayEndBack, t);
            const y = Math.max(Math.min(bayBedHeight(x, zBack), S.seaLevel - 0.1), S.basementBottom);
            bayBackShape.lineTo(x, y);
        }
        bayBackShape.closePath();
        const bayBackGeo = new THREE.ShapeGeometry(bayBackShape, 40);
        bayBackGeo.computeVertexNormals();
        assignVertexColors(bayBackGeo, (x, y) => bayWaterColorAt(x, y, zBack));
        const bayBackMesh = new THREE.Mesh(bayBackGeo, new THREE.MeshStandardMaterial({
            vertexColors: true, transparent: true, opacity: 0.60,
            roughness: 0.65, metalness: 0.02,
            emissive: new THREE.Color(0x061a2a), emissiveIntensity: 0.25,
            side: THREE.DoubleSide,
        }));
        bayBackMesh.position.z = zBack - 0.06;
        bayBackMesh.renderOrder = 6;
        root.add(bayBackMesh);
    }

    /* ===== 7. 印度板块陆地 3D 高度场 ===== */
    const indiaLandTop = createHeightField(
        S.indiaWestMeanX - 15, S.indiaEastMeanX + 30, S.depth, 150, 80,
        (x, z) => {
            const west = indiaWestCoast(z);
            const east = indiaEastCoast(z);
            const bayEnd = east + 5.0;
            if (x < west) return oceanFloorHeight(x, z);
            if (x >= bayEnd) return continentHeight(x, z);
            if (x >= east) return bayBedHeight(x, z);
            return indiaLandHeight(x, z);
        },
        (x, y, z, slope) => {
            const west = indiaWestCoast(z);
            const east = indiaEastCoast(z);
            const bayEnd = east + 5.0;
            if (x < west) return oceanTopColorAt(x, y, z);
            if (x >= bayEnd) return continentTopColorAt(x, y, z, slope);
            if (x >= east) return oceanTopColorAt(x, y, z); // 海湾水面用海底色，避免蓝绿色水平面
            return indiaLandTopColorAt(x, y, z);
        },
        {
            map: textures.grassColor, bumpMap: textures.rockBump,
            roughnessMap: textures.rockRoughness, bumpScale: 0.7,
            roughness: 0.94, metalness: 0.01,
            emissive: new THREE.Color(0x0a1105), emissiveIntensity: 0.06,
        }
    );
    root.add(indiaLandTop);

    // 印度板块高度场右端封边侧壁
    {
        const wallX = S.indiaEastMeanX + 30;
        const segZ = 80;
        const posArr = [], idxArr = [], uvArr = [];
        for (let i = 0; i <= segZ; i++) {
            const t  = i / segZ;
            const zv = mix(S.backZ, S.frontZ, t);
            const topY = terrainHeightAt(wallX, zv);
            const botY = S.basementBottom;
            posArr.push(wallX, topY, zv, wallX, botY, zv);
            uvArr.push(t, 1.0, t, 0.0);
        }
        for (let i = 0; i < segZ; i++) {
            const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
            idxArr.push(a, b, c, b, d, c);
        }
        const wallGeo = new THREE.BufferGeometry();
        wallGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
        wallGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvArr, 2));
        wallGeo.setIndex(idxArr);
        wallGeo.computeVertexNormals();
        const wallMat = new THREE.MeshStandardMaterial({
            color: 0x6e6057,
            map: textures.rockColor, bumpMap: textures.rockBump,
            roughnessMap: textures.rockRoughness, bumpScale: 0.4,
            roughness: 0.97, metalness: 0.01, side: THREE.DoubleSide,
        });
        root.add(new THREE.Mesh(wallGeo, wallMat));
    }

    /* ===== 8. 亚欧板块大陆 3D 高度场 ===== */
    const landGroup = new THREE.Group();
    landGroup.name = 'TectonicLandscapeLand';
    root.add(landGroup);

    const continentTop = createHeightField(
        S.eurasiaStartX - 15, S.xMax, S.depth, 380, 220,
        continentHeight, continentTopColorAt,
        {
            map: textures.grassColor, bumpMap: textures.rockBump, roughnessMap: textures.rockRoughness,
            bumpScale: 0.95, roughness: 0.96, metalness: 0.01,
            emissive: new THREE.Color(0x111009), emissiveIntensity: 0.06,
        }
    );
    landGroup.add(continentTop);

    const mountainDetailMesh = createMountainDetailMesh(continentTop.geometry, textures);
    landGroup.add(mountainDetailMesh);
    const snowCaps = createSnowCapMesh(continentTop.geometry, textures);
    landGroup.add(snowCaps);

    /* ===== 9. 海岸线泡沫 ===== */
    const shorelineFoam = createShorelineFoam();
    root.add(shorelineFoam);

    /* ===== 10. 侧壁封面（完整地层剖面） ===== */
    // 左侧（海洋一侧）完整分层剖面
    root.add(createLayeredSideWall(S.xMin, textures));
    // 右侧（大陆一侧）完整分层剖面
    root.add(createLayeredSideWall(S.xMax, textures));

    // 底部封面（basementBottom = -65，水平填充整个底部）
    {
        const btmW = S.xMax - S.xMin;   // 240
        const btmD = S.depth;            // 112
        const centerX = (S.xMin + S.xMax) * 0.5;  // -10

        // 用 BufferGeometry 手动构建，顶点直接用绝对坐标，避免旋转/平移叠加问题
        const btmSegX = 60, btmSegZ = 28;
        const btmPosArr = [], btmUvArr = [], btmIdxArr = [];
        for (let iz = 0; iz <= btmSegZ; iz++) {
            for (let ix = 0; ix <= btmSegX; ix++) {
                const x = S.xMin + (btmW / btmSegX) * ix;
                const z = S.backZ + (btmD / btmSegZ) * iz;
                btmPosArr.push(x, S.basementBottom, z);
                btmUvArr.push(ix / btmSegX * (btmW / 8), iz / btmSegZ * (btmD / 8));
            }
        }
        for (let iz = 0; iz < btmSegZ; iz++) {
            for (let ix = 0; ix < btmSegX; ix++) {
                const a = iz * (btmSegX + 1) + ix;
                const b = a + 1;
                const c = a + (btmSegX + 1);
                const d = c + 1;
                btmIdxArr.push(a, c, b, b, c, d);
            }
        }
        const btmGeo = new THREE.BufferGeometry();
        btmGeo.setAttribute('position', new THREE.Float32BufferAttribute(btmPosArr, 3));
        btmGeo.setAttribute('uv',       new THREE.Float32BufferAttribute(btmUvArr, 2));
        btmGeo.setIndex(btmIdxArr);
        btmGeo.computeVertexNormals();

        // 深土色材质，带岩石纹理
        const btmRockColor = textures.rockColor.clone();
        btmRockColor.wrapS = btmRockColor.wrapT = THREE.RepeatWrapping;
        btmRockColor.repeat.set(24, 10);
        btmRockColor.needsUpdate = true;
        const btmBump = textures.rockBump.clone();
        btmBump.wrapS = btmBump.wrapT = THREE.RepeatWrapping;
        btmBump.repeat.set(24, 10);
        btmBump.needsUpdate = true;
        const btmMat = new THREE.MeshStandardMaterial({
            color: 0x241a10,
            map: btmRockColor,
            bumpMap: btmBump,
            bumpScale: 0.5,
            roughness: 0.97,
            metalness: 0.03,
            emissive: new THREE.Color(0x1a1208),
            emissiveIntensity: 0.6,
            side: THREE.DoubleSide,
        });
        const bottomPlane = new THREE.Mesh(btmGeo, btmMat);
        bottomPlane.receiveShadow = true;
        root.add(bottomPlane);
    }

    /* ===== 11. 洋中脊发光（已移除：水平矩形面在俯视图中造成视觉干扰）===== */
    // ridgeGlowStrip 已删除

    /* ===== 12. 陆地油井 ===== */
    // 右拱顶中心在 x≈55（亚欧大陆内陆），陆地油井放在拱顶正上方
    // 油井放在剖面正面边缘（frontZ），从剖面角度可见笔直油管穿入油层
    {
        const lwX = 55;
        const lwZ = S.frontZ;
        const lwSurfaceY = continentHeight(lwX, lwZ);
        // 油管深入到油层中间位置（油水界面 ~ 油气界面之间）
        const lwOilLayerY = (waterOilBoundAt(lwX, lwZ) + oilGasBoundAt(lwX, lwZ)) * 0.5;
        const landWell = createLandOilWell(lwX, lwZ, lwSurfaceY, lwOilLayerY);
        root.add(landWell);
    }

    /* ===== 13. 海上钻井平台 ===== */
    // 左拱顶中心在 x≈-65（大洋中部，完全在海洋区域内）
    // 海上平台位于左拱顶正上方的海面
    {
        const owX = -65;   // 左拱顶 x 坐标，深海区域
        const owZ = 5;     // 略偏前（剖面可见）
        const owSeaLevel = S.seaLevel;
        const owSeabedY = oceanFloorHeight(owX, owZ);
        // 油管深入到油层中间位置
        const owOilLayerY = (waterOilBoundAt(owX, owZ) + oilGasBoundAt(owX, owZ)) * 0.5;
        const offshorePlatform = createOffshoreOilPlatform(owX, owZ, owSeaLevel, owSeabedY, owOilLayerY);
        root.add(offshorePlatform);
    }

    /* ===== 锚点（用于 CSS2D 标签定位）===== */
    const anchors = {
        ridge:         new THREE.Vector3(S.ridgeX + 6, S.seaLevel + 18, -8),
        india:         new THREE.Vector3(-15, S.seaLevel + 12, -18),
        eurasia:       new THREE.Vector3(80, S.eurAsiaPeakMax + 12, 18),
        // 石油地下锚点（用于标签）— 使用右拱顶(x=55)的实际动态高度
        gasZone:       new THREE.Vector3(55, oilGasBoundAt(55, S.frontZ) + 1.5, S.frontZ),
        oilZone:       new THREE.Vector3(55, (waterOilBoundAt(55, S.frontZ) + oilGasBoundAt(55, S.frontZ)) * 0.5, S.frontZ),
        waterZone:     new THREE.Vector3(55, reservoirBottomAt(55, S.frontZ) + 2, S.frontZ),
        waterproof:    new THREE.Vector3(40, waterproofTopAt(40, S.frontZ) - 3, S.frontZ),
        capRock:       new THREE.Vector3(-50, S.capRockBottom + 3, S.frontZ),
    };

    return {
        update(progress, intensity, boundaryType) {
            // 静态模型：ridgeGlowStrip 已移除，无需动态更新
        },
        getAnchors() { return anchors; },
    };
}
