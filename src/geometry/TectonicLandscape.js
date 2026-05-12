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
    basementBottom: -80,   // 基底岩石底
    basementTop:    -65,   // 基底岩石顶 / 不透水底层底
    waterproofBottom: -65, // 不透水底层底
    waterproofTop:    -50, // 不透水底层顶 / 储集层底
    reservoirBottom:  -50, // 储集层底（地层水底）
    reservoirTop:     -28, // 储集层顶（拱顶顶部）
    capRockBottom:    -28, // 盖层底
    capRockTop:       -15, // 盖层顶 / 浅层砂岩底
    surfaceRockTop:     0, // 浅层砂岩顶（地表）

    // 储集层内三分：water/oil/gas 边界
    // 地层水在底部，石油在中间，天然气在拱顶
    // 这些是"平均"高度，实际储集层面随拱形波动
    waterOilBound:  -43,   // 水-油边界（在储集层内，向上）
    oilGasBound:    -36,   // 油-气边界（拱顶附近）

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
   海底高度
============================================================ */
function oceanFloorHeight(x, z) {
    const shore = indiaWestCoast(z);
    const nx = clamp((x - S.xMin) / (shore - S.xMin + 1e-6), 0, 1);
    const ridgeCenter = S.ridgeX + Math.sin(z * 0.078) * 2.6;
    const trenchCenter = shore - 6.0 + Math.sin(z * 0.11 + 0.8) * 1.6;

    const abyssalPlain = mix(-8.5, -10.0, smoothstep(0.14, 0.84, nx));
    const ridgeMass    = 11.5 * gaussian(x, ridgeCenter, 7.8);
    const ridgeShoulder = 4.5 * gaussian(x, ridgeCenter, 17.0);
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
   按图，储集层（含水/油/气）呈波浪形拱起，有两个背斜拱顶
   左拱（陆地下方）和右拱（海洋/大陆架下方）
   返回：给定 x 位置的储集层内部界面偏移量（拱起高度）
============================================================ */
function reservoirArch(x, z) {
    // 两个背斜拱顶：左拱中心约 x=-20，右拱中心约 x=60
    const arch1 = gaussian(x, -20, 30) * 16.0;  // 左拱，幅度16，宽30
    const arch2 = gaussian(x, 62, 28) * 14.0;   // 右拱，幅度14，宽28
    // 额外的小起伏（地层不平）
    const undulation = fbmNoise(x * 0.04, z * 0.03, 3, 0.04, 0.5) * 3.0
                     + Math.sin(x * 0.025 + z * 0.018) * 2.5;
    return arch1 + arch2 + undulation;
}

// 储集层顶面高度（拱顶）
function reservoirTopAt(x, z) {
    const arch = reservoirArch(x, z);
    // 拱顶可以侵入盖层（盖层下部随储集层相应变形）
    return clamp(S.reservoirTop + arch, S.reservoirBottom + 1.0, S.capRockTop - 2.0);
}

// 不透水底层顶面高度（与储集层底面一致，随拱形略有起伏）
function waterproofTopAt(x, z) {
    // 不透水层顶面也稍微跟随拱形（岩层同步弯曲）
    const arch = reservoirArch(x, z) * 0.65;
    return clamp(S.waterproofTop + arch, S.basementTop + 0.5, S.reservoirBottom + 15.0);
}

// 储集层底面高度（不透水层顶 = 储集层底）
function reservoirBottomAt(x, z) {
    return waterproofTopAt(x, z);
}

// 油水边界面高度（在储集层内，水在底部，油在上方）
function waterOilBoundAt(x, z) {
    const archBottom = reservoirBottomAt(x, z);
    const archTop    = reservoirTopAt(x, z);
    const thickness  = archTop - archBottom;
    // 水层占储集层下方约 35%
    return archBottom + thickness * 0.35;
}

// 油气边界面高度（油在中间，气在拱顶）
function oilGasBoundAt(x, z) {
    const archBottom = reservoirBottomAt(x, z);
    const archTop    = reservoirTopAt(x, z);
    const thickness  = archTop - archBottom;
    // 油层占储集层约 35%（从水油边界到油气边界）
    // 气层在最顶部约 30%
    return archBottom + thickness * 0.70;
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
    const shorelineSamples = 84;
    const shape = new THREE.Shape();
    shape.moveTo(S.xMin, S.backZ);
    shape.lineTo(S.xMin, S.frontZ);
    for (let i = 0; i <= shorelineSamples; i++) {
        const t = i / shorelineSamples;
        const z = mix(S.frontZ, S.backZ, t);
        const x = indiaWestCoast(z) + 0.7;
        shape.lineTo(x, z);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape, 240);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getY(i);
        positions.setXYZ(i, x, S.seaLevel, z);
    }
    positions.needsUpdate = true;
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
    const samples = 80;
    const shape = new THREE.Shape();
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const z = mix(S.backZ, S.frontZ, t);
        const x = indiaEastCoast(z) + 0.3;
        if (i === 0) shape.moveTo(x, z);
        else shape.lineTo(x, z);
    }
    for (let i = samples; i >= 0; i--) {
        const t = i / samples;
        const z = mix(S.backZ, S.frontZ, t);
        const x = indiaEastCoast(z) + 5.0;
        shape.lineTo(x, z);
    }
    shape.closePath();

    const geometry = new THREE.ShapeGeometry(shape, 160);
    const positions = geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i), z = positions.getY(i);
        positions.setXYZ(i, x, S.seaLevel, z);
    }
    positions.needsUpdate = true;
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

    /* 4. 盖层（Cap Rock，Y: -28 ~ -15，深棕致密） */
    // 盖层底面跟随储集层顶面，顶面平
    const capSegs = 200;
    const capBottomPts = [];
    for (let i = 0; i <= capSegs; i++) {
        const t = i / capSegs;
        const x = mix(S.xMin, S.xMax, t);
        capBottomPts.push(new THREE.Vector2(x, reservoirTopAt(x, z)));
    }
    const capRockShape = new THREE.Shape();
    capRockShape.moveTo(S.xMin, S.capRockTop);
    capRockShape.lineTo(S.xMax, S.capRockTop);
    for (let i = capSegs; i >= 0; i--) {
        capRockShape.lineTo(capBottomPts[i].x, capBottomPts[i].y);
    }
    capRockShape.closePath();
    const capRockGeo = new THREE.ShapeGeometry(capRockShape, 140);
    capRockGeo.computeVertexNormals();
    assignVertexColors(capRockGeo, (x, y) => capRockColor(x, y, z));
    const capRockMesh = new THREE.Mesh(capRockGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.88, metalness: 0.02,
        side: THREE.DoubleSide,
    }));
    capRockMesh.position.z = z + 0.05;
    group.add(capRockMesh);

    /* 5. 浅层砂岩/土层（Y: -15 ~ 0，沙黄色） */
    const surfaceRockShape = new THREE.Shape();
    surfaceRockShape.moveTo(S.xMin, S.lithBottom);
    surfaceRockShape.lineTo(S.xMax, S.lithBottom);
    surfaceRockShape.lineTo(S.xMax, S.surfaceRockTop);
    surfaceRockShape.lineTo(S.xMin, S.surfaceRockTop);
    surfaceRockShape.closePath();
    const surfaceRockGeo = new THREE.ShapeGeometry(surfaceRockShape, 80);
    surfaceRockGeo.computeVertexNormals();
    assignVertexColors(surfaceRockGeo, (x, y) => surfaceRockColor(x, y, z));
    const surfaceRockMesh = new THREE.Mesh(surfaceRockGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.90, metalness: 0.01,
        side: THREE.DoubleSide,
    }));
    surfaceRockMesh.position.z = z + 0.06;
    group.add(surfaceRockMesh);

    /* 6. 地壳剖面（从 lithBottom/surfaceRockTop=0 到地形表面） */
    const crustShape = new THREE.Shape();
    crustShape.moveTo(S.xMin, S.surfaceRockTop);
    for (let i = 0; i <= segs; i++) {
        crustShape.lineTo(profilePoints[i].x, profilePoints[i].y);
    }
    crustShape.lineTo(S.xMax, S.surfaceRockTop);
    crustShape.closePath();

    const crustGeo = new THREE.ShapeGeometry(crustShape, 300);
    crustGeo.computeVertexNormals();
    assignVertexColors(crustGeo, (x, y) => {
        const westShore = indiaWestCoast(z);
        const eastShore = indiaEastCoast(z);
        const bayEnd = eastShore + 5.0;
        if (x < westShore) return oceanCrustColorAt(x, y);
        else if (x < eastShore) return continentCrustColorAt(x, y);
        else if (x < bayEnd) {
            const subductT = clamp((y - S.lithBottom) / (-S.lithBottom + S.seaLevel), 0, 1);
            return new THREE.Color(
                mix(0.48, 0.72, subductT),
                mix(0.14, 0.32, subductT),
                mix(0.10, 0.22, subductT)
            );
        } else {
            return continentCrustColorAt(x, y);
        }
    });
    const crustMesh = new THREE.Mesh(crustGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.88, metalness: 0.03,
        emissive: new THREE.Color(0x1b1004), emissiveIntensity: 0.12,
        side: THREE.DoubleSide,
    }));
    crustMesh.position.z = z + 0.07;
    group.add(crustMesh);

    /* 7. 海水层 */
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const bayEnd = eastShore + 5.0;

    // 大洋水体
    const oceanWaterShape = new THREE.Shape();
    oceanWaterShape.moveTo(S.xMin, S.seaLevel);
    oceanWaterShape.lineTo(westShore, S.seaLevel);
    for (let i = segs; i >= 0; i--) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        if (x >= S.xMin && x <= westShore) {
            const y = Math.min(oceanFloorHeight(x, z), S.seaLevel - 0.1);
            oceanWaterShape.lineTo(x, y);
        }
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

    // 海湾水体
    const bayWaterShape = new THREE.Shape();
    bayWaterShape.moveTo(eastShore, S.seaLevel);
    bayWaterShape.lineTo(bayEnd, S.seaLevel);
    for (let i = segs; i >= 0; i--) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        if (x >= eastShore && x <= bayEnd) {
            const y = Math.min(bayBedHeight(x, z), S.seaLevel - 0.1);
            bayWaterShape.lineTo(x, y);
        }
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

    /* 盖层 */
    const capBottomPts = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        capBottomPts.push(new THREE.Vector2(x, reservoirTopAt(x, z)));
    }
    const cShape = new THREE.Shape();
    cShape.moveTo(S.xMin, S.capRockTop);
    cShape.lineTo(S.xMax, S.capRockTop);
    for (let i = segs; i >= 0; i--) cShape.lineTo(capBottomPts[i].x, capBottomPts[i].y);
    cShape.closePath();
    const cGeo = new THREE.ShapeGeometry(cShape, 80);
    cGeo.computeVertexNormals();
    assignVertexColors(cGeo, (x, y) => capRockColor(x, y, z));
    const cMesh = new THREE.Mesh(cGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide,
    }));
    cMesh.position.z = z - 0.05;
    group.add(cMesh);

    /* 浅层砂岩 */
    const sShape = new THREE.Shape();
    sShape.moveTo(S.xMin, S.lithBottom);
    sShape.lineTo(S.xMax, S.lithBottom);
    sShape.lineTo(S.xMax, S.surfaceRockTop);
    sShape.lineTo(S.xMin, S.surfaceRockTop);
    sShape.closePath();
    const sGeo = new THREE.ShapeGeometry(sShape, 40);
    sGeo.computeVertexNormals();
    assignVertexColors(sGeo, (x, y) => surfaceRockColor(x, y, z));
    const sMesh = new THREE.Mesh(sGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.90, metalness: 0.01, side: THREE.DoubleSide,
    }));
    sMesh.position.z = z - 0.06;
    group.add(sMesh);

    /* 地壳（地表以上部分） */
    const profilePts = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        profilePts.push(new THREE.Vector2(x, terrainHeightAt(x, z)));
    }
    const crShape = new THREE.Shape();
    crShape.moveTo(S.xMin, S.surfaceRockTop);
    for (const p of profilePts) crShape.lineTo(p.x, p.y);
    crShape.lineTo(S.xMax, S.surfaceRockTop);
    crShape.closePath();
    const crGeo = new THREE.ShapeGeometry(crShape, 160);
    crGeo.computeVertexNormals();
    assignVertexColors(crGeo, (x, y) => continentCrustColorAt(x, y));
    const crMesh = new THREE.Mesh(crGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.88, metalness: 0.02, side: THREE.DoubleSide,
    }));
    crMesh.position.z = z - 0.07;
    group.add(crMesh);

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

    /* ——— 辅助函数：建造矩形分层面板（从 yBot 到 yTop，Z 从 backZ 到 frontZ） ——— */
    function addLayer(yBot, yTop, colorFn, matOpts = {}) {
        const geo = new THREE.PlaneGeometry(S.depth, yTop - yBot, segs, ySegs);
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

    /* ——— 各地层（从底到顶） ——— */
    // 1. 基底岩石
    addLayer(S.basementBottom, S.basementTop,
        (x, y, z) => basementRockColor(x, y, z),
        { roughness: 0.92, metalness: 0.04 });

    // 2. 不透水层（随拱形起伏——侧面取 x=xPosition 处的平均）
    addLayer(S.waterproofBottom, S.waterproofTop,
        (x, y, z) => waterproofLayerColor(x, y, z));

    // 3. 储集层（水/油/气，用渐变色按 Y 高度区分）
    addLayer(S.reservoirBottom, S.reservoirTop,
        (x, y, z) => {
            const resBottom = reservoirBottomAt(x, z);
            const resTop    = reservoirTopAt(x, z);
            const woBound   = waterOilBoundAt(x, z);
            const ogBound   = oilGasBoundAt(x, z);
            if (y <= woBound)  return waterZoneColor(x, y, z);
            if (y <= ogBound)  return oilZoneColor(x, y, z);
            return gasZoneColor(x, y, z);
        },
        { emissive: new THREE.Color(0x060402), emissiveIntensity: 0.10 });

    // 4. 盖层
    addLayer(S.capRockBottom, S.capRockTop,
        (x, y, z) => capRockColor(x, y, z));

    // 5. 浅层砂岩
    addLayer(S.lithBottom, S.surfaceRockTop,
        (x, y, z) => surfaceRockColor(x, y, z));

    /* ——— 地形以上部分（海洋侧壁带水体，陆地侧壁带岩石纹理） ——— */
    // 用逐列构建的 BufferGeometry 精确跟随地形高度
    const posArr = [], idxArr = [], uvArr = [], colArr = [];
    for (let i = 0; i <= segs; i++) {
        const t  = i / segs;
        const zv = mix(S.backZ, S.frontZ, t);
        const topY  = terrainHeightAt(xPosition, zv);
        const botY  = S.surfaceRockTop; // Y=0，地表底
        posArr.push(xPosition, topY, zv);
        posArr.push(xPosition, botY, zv);
        uvArr.push(t, 1.0);
        uvArr.push(t, 0.0);
        const cTop = continentCrustColorAt(xPosition, topY);
        const cBot = continentCrustColorAt(xPosition, botY);
        colArr.push(cTop.r, cTop.g, cTop.b);
        colArr.push(cBot.r, cBot.g, cBot.b);
    }
    for (let i = 0; i < segs; i++) {
        const a = i * 2, b = i * 2 + 1, c = (i + 1) * 2, d = (i + 1) * 2 + 1;
        idxArr.push(a, b, c, b, d, c);
    }
    const crustGeo = new THREE.BufferGeometry();
    crustGeo.setAttribute('position', new THREE.Float32BufferAttribute(posArr, 3));
    crustGeo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvArr, 2));
    crustGeo.setAttribute('color',    new THREE.Float32BufferAttribute(colArr, 3));
    crustGeo.setIndex(idxArr);
    crustGeo.computeVertexNormals();
    const crustMat = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.94, metalness: 0.01,
        map: textures.rockColor, bumpMap: textures.rockBump,
        roughnessMap: textures.rockRoughness, bumpScale: 0.35,
        side: THREE.DoubleSide,
    });
    group.add(new THREE.Mesh(crustGeo, crustMat));

    /* ——— 海水（仅左侧海洋端出现） ——— */
    const isOceanSide = xPosition <= S.xMin + 1;
    if (isOceanSide) {
        const westShore = indiaWestCoast(0);
        const wPosArr = [], wIdxArr = [], wColArr = [];
        for (let i = 0; i <= segs; i++) {
            const t  = i / segs;
            const zv = mix(S.backZ, S.frontZ, t);
            const ws = indiaWestCoast(zv);
            if (xPosition > ws) continue; // 不在海洋区域则跳过
            const floorY = Math.min(oceanFloorHeight(xPosition, zv), S.seaLevel - 0.1);
            wPosArr.push(xPosition, S.seaLevel, zv);
            wPosArr.push(xPosition, floorY, zv);
            const w = i;
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
    const waterBedProfileBack = sampleProfile(S.backZ, S.xMin, westShore0 + 0.8, 180, (x, z) => (
        Math.min(oceanFloorHeight(x, z), S.seaLevel - 0.1)
    ));
    const waterTopProfileBack = waterBedProfileBack.map(p => new THREE.Vector2(p.x, S.seaLevel));
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
        bayBackShape.moveTo(eastShoreBack, S.seaLevel);
        bayBackShape.lineTo(bayEndBack, S.seaLevel);
        for (let i = segs; i >= 0; i--) {
            const t = i / segs;
            const x = mix(eastShoreBack, bayEndBack, t);
            const y = Math.min(bayBedHeight(x, zBack), S.seaLevel - 0.1);
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
    // 陆地油井：位于右侧亚欧大陆，放在剪面图正面边缘（frontZ）
    // 这样从剪面角度就能看到笔直的油管
    {
        const lwX = 40;
        const lwZ = S.frontZ; // 放在剪面图正面边缘
        const lwSurfaceY = continentHeight(lwX, lwZ);
        // 油层位于 oilGasBound 处
        const lwOilLayerY = oilGasBoundAt(lwX, lwZ) - 2;
        const landWell = createLandOilWell(lwX, lwZ, lwSurfaceY, lwOilLayerY);
        root.add(landWell);
    }

    /* ===== 13. 海上钻井平台 ===== */
    // 海洋油井：在大洋中部（海洋区域），位于右侧海洋拱顶区域上方
    // 左拱中心约 x = -20（陆地一侧），右拱中心约 x = -80（海洋方向）
    // 在海洋中选择一个位置
    {
        const owX = -55;  // 海洋区域（-130 到 indiaWestCoast(-55) 大概在-30左右），-55 在海洋内
        const owZ = 10;   // 稍偏前
        const owSeaLevel = S.seaLevel;
        const owSeabedY = oceanFloorHeight(owX, owZ);
        // 油层深度：在油气边界处
        const owOilLayerY = oilGasBoundAt(owX, owZ) - 2;
        const offshorePlatform = createOffshoreOilPlatform(owX, owZ, owSeaLevel, owSeabedY, owOilLayerY);
        root.add(offshorePlatform);
    }

    /* ===== 锚点（用于 CSS2D 标签定位）===== */
    const anchors = {
        ridge:         new THREE.Vector3(S.ridgeX + 6, S.seaLevel + 18, -8),
        india:         new THREE.Vector3(-15, S.seaLevel + 12, -18),
        eurasia:       new THREE.Vector3(80, S.eurAsiaPeakMax + 12, 18),
        // 石油地下锚点（用于标签）
        gasZone:       new THREE.Vector3(-15, S.oilGasBound + 3, S.frontZ),
        oilZone:       new THREE.Vector3(-15, (S.waterOilBound + S.oilGasBound) * 0.5, S.frontZ),
        waterZone:     new THREE.Vector3(-15, S.reservoirBottom + 2, S.frontZ),
        waterproof:    new THREE.Vector3(40, S.waterproofBottom + 3, S.frontZ),
        capRock:       new THREE.Vector3(-50, S.capRockBottom + 3, S.frontZ),
    };

    return {
        update(progress, intensity, boundaryType) {
            // 静态模型：ridgeGlowStrip 已移除，无需动态更新
        },
        getAnchors() { return anchors; },
    };
}
