import * as THREE from 'three';

// 坐标系说明（按设计稿重新规划，2026年版）：
//
//   X轴方向（从左到右）：
//     -130(深海左缘) → -75(洋中脊) → -70(浅海开始) → -30(印度陆地西岸均值)
//     → 0(印度东岸均值/俯冲带均值) → +10(亚欧板块开始) → +110(亚欧内陆)
//
//   Y轴方向（从下到上）：
//     -65(软流层底) → -15(软流层顶/岩石圈底) → 0(X轴) → +5(海平面) → +25(山顶)
//
//   Z轴方向：-56(后) → 0 → +56(前)，depth=112
//
//   宽度规划：
//     深海区  ≈ 50    X: -130 ~ -80
//     洋中脊  ≈ 10    X:  -80 ~  -70  (ridgeX=-75居中)
//     浅海区  ≈ 40    X:  -70 ~  -30
//     印度陆地  20(前)~50(后)  S型，海岸线曲折
//     S型海湾   ≈ 5   俯冲带上方
//     亚欧板块  100(前)~70(后)  X: +10 ~ +110
//
//   高度上限：
//     普通陆地（平原/低地）最高: Y最高 = +5
//     印度板块山脉最高: Y最高 = +10
//     亚欧板块山脉（喜马拉雅）最高: Y最高 = +15（S型走向，宽度≤8）
//     岩石圈高度差: 15（Y: -15 ~ 0）
//     软流层高度差: 50（Y: -65 ~ -15）

const S = {
    xMin: -130,          // 场景左边界（深海左翼）
    xMax: 110,           // 场景右边界（亚欧板块内陆）
    depth: 112,
    halfDepth: 56,
    frontZ: 56,
    backZ: -56,

    seaLevel: 5,         // 海平面（X轴上方5单位）
    lithBottom: -15,     // 岩石圈底（X轴下方15单位，高度差=15）
    mantleTop: -15,      // 软流层顶（与岩石圈底一致）
    mantleBottom: -65,   // 软流层底（高度差=50）

    ridgeX: -75,         // 洋中脊中心（深海区右侧，10宽居中）
    coastMeanX: 0,       // 印度板块东岸/俯冲带平均X位置

    // 印度板块陆地西岸均值（浅海东边界/印度陆地西边界）
    indiaWestMeanX: -30,
    // 印度板块陆地东岸均值（俯冲带/海湾西边界）
    indiaEastMeanX: 0,
    // 亚欧板块起始（俯冲带右侧）
    eurasiaStartX: 10,

    // 亚欧板块山脉（喜马拉雅）范围
    mountainStartX: 14,  // 山脉起始（紧靠俯冲带）
    mountainEndX: 80,    // 山脉结束

    snowBase: 12,        // 积雪线（Y>12开始有雪）

    // 高度上限
    plainMax: 5,         // 普通陆地最高点（平原/低地）
    indiaPeakMax: 10,    // 印度板块山脉最高点
    eurAsiaPeakMax: 15,  // 亚欧板块山脉最高点
    mountainWidth: 8,    // 亚欧山脉最大宽度（Z轴方向）
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
   indiaWestCoast(z): 印度板块西侧海岸线（朝浅海方向），均值 ≈ -30，曲折
   indiaEastCoast(z): 印度板块东侧海岸线（朝亚欧板块方向），S型
                      前侧(Z≈+56): x≈-10，后侧(Z≈-56): x≈+15，宽度20~50
============================================================ */
function indiaWestCoast(z) {
    // 印度板块西侧海岸线：均值约 -30，带曲折湾岬
    const nz = z / S.halfDepth;  // nz in [-1, 1]
    const largeBend = Math.sin(nz * 2.1 + 0.4) * 5.5;
    const midBend   = Math.sin(nz * 5.8 - 0.7) * 2.2;
    const bayA      = gaussian(z, -8, 14) * 4.2;
    const bayB      = gaussian(z, 22, 11) * 2.6;
    const headland  = gaussian(z, -28, 12) * 3.1;
    const micro     = fbmNoise(z * 0.85, z * 0.3, 3, 0.22, 0.5) * 1.2;
    return clamp(
        S.indiaWestMeanX + largeBend + midBend - bayA - bayB + headland + micro,
        -44,   // 浅海不超过此左边界
        -18    // 浅海不超过此右边界（确保浅海宽度）
    );
}

function indiaEastCoast(z) {
    // 印度板块东侧 S 型海岸线：
    //   前侧（Z=+56）x≈-10，后侧（Z=-56）x≈+15
    //   S型弯曲：大弯幅度±8，加细节±3
    const nz = (z - S.frontZ) / (2 * S.halfDepth);  // nz in [-1, 0]（前到后）
    // 线性基础：从前侧-10到后侧+15
    const base = mix(-10, 15, -nz);  // nz: 0(前)->-1(后)，所以 -nz: 0->1
    // S型弯曲
    const sBend = Math.sin(nz * Math.PI * 1.8 + 0.3) * 8.0;
    // 细节起伏
    const detail = Math.sin(nz * Math.PI * 4.5 - 0.6) * 2.5
                 + Math.cos(nz * Math.PI * 3.2 + 1.1) * 1.5;
    const micro = fbmNoise(z * 0.6, z * 0.25, 3, 0.18, 0.5) * 1.5;
    return clamp(base + sBend + detail + micro, -20, 22);
}

/* ============================================================
   海底高度
   注意：海平面 seaLevel = 5，海底范围严格在 -14 ~ 3.5 之间
   洋中脊顶部约 Y=3（低于海平面），深海底约 Y=-14
============================================================ */
function oceanFloorHeight(x, z) {
    // 海洋区域（xMin ~ indiaWestCoast(z)）
    const shore = indiaWestCoast(z);
    const nx = clamp((x - S.xMin) / (shore - S.xMin + 1e-6), 0, 1);
    const ridgeCenter = S.ridgeX + Math.sin(z * 0.078) * 2.6;
    const trenchCenter = shore - 6.0 + Math.sin(z * 0.11 + 0.8) * 1.6;

    // 深海平原基础：Y≈-8~-10，明显低于海平面5
    const abyssalPlain = mix(-8.5, -10.0, smoothstep(0.14, 0.84, nx));
    // 洋中脊：顶部约 Y=3（seaLevel=5，脊顶比海平面低2）
    const ridgeMass    = 11.5 * gaussian(x, ridgeCenter, 7.8);
    const ridgeShoulder = 4.5 * gaussian(x, ridgeCenter, 17.0);
    // 中央盆地轻微下沉
    const centralBasin = -1.5 * gaussian(x, mix(S.ridgeX + 16, shore - 26, 0.55), 15.0);
    // 大陆架上升坡
    const slopeRise    = 5.5 * smoothstep(shore - 28, shore - 9, x);
    // 海沟（俯冲带前）
    const trench       = -6.0 * gaussian(x, trenchCenter, 4.2);
    const trenchTail   = -1.8 * gaussian(x, trenchCenter - 8, 9.5);
    // 细节噪声：幅度减小
    const shelfNoise   = fbmNoise(x, z, 5, 0.045, 0.54) * mix(0.8, 0.25, smoothstep(shore - 22, shore - 2, x));

    // 最终值严格 clamp: 最高不超过 seaLevel-1.5 = 3.5，最低不低于 -13
    return clamp(
        abyssalPlain + ridgeMass + ridgeShoulder + centralBasin + slopeRise + trench + trenchTail + shelfNoise,
        -13.0, S.seaLevel - 1.5
    );
}

/* ============================================================
   浅海床高度（印度板块西岸内侧浅水区）
============================================================ */
function shelfBedHeight(x, z) {
    const westShore = indiaWestCoast(z);
    const d = x - westShore;
    const uplift   = smoothstep(-16, -2, d);
    const beachLift = smoothstep(-2, 6, d);
    const sandbars = fbmNoise(x, z, 4, 0.058, 0.52) * 0.55;
    const terracing = Math.sin((z + x * 0.28) * 0.2) * 0.3;
    return mix(S.seaLevel - 7.0, S.seaLevel + 0.6, uplift) + beachLift * 1.1 + sandbars + terracing;
}

/* ============================================================
   海湾（S型小海湾，宽≈5，俯冲带上方，介于印度东岸和亚欧板块之间）
   海湾底部是俯冲带，需要表现出来
============================================================ */
function bayBedHeight(x, z) {
    const eastShore = indiaEastCoast(z);
    // 海湾宽度约5，从东岸到东岸+5
    const bayCenter = eastShore + 2.5;
    const d = Math.abs(x - bayCenter);
    // 海湾底部比海平面低4~6，表现俯冲带下沉
    const depth = S.seaLevel - 5.0 - gaussian(z, 0, 25) * 2.0;
    // 两侧向上抬升（V型海湾剖面，模拟俯冲沟）
    const sideRise = smoothstep(2.5, 0, d) * (S.seaLevel - 0.5 - depth);
    return clamp(depth + sideRise + fbmNoise(x, z, 3, 0.08, 0.5) * 0.3, -14.0, S.seaLevel - 0.5);
}

/* ============================================================
   印度板块陆地高度函数
   范围：indiaWestCoast(z) <= x < indiaEastCoast(z)
   高度上限: +10 (indiaPeakMax)
   ★ 印度洋板块是大陆板块，地形有明显起伏
   ★ 东侧（靠海湾）有山脉，沿Z轴走向（与海湾S型相同走向）
============================================================ */
function indiaLandHeight(x, z) {
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const landWidth = Math.max(eastShore - westShore, 1);
    const nx = clamp((x - westShore) / landWidth, 0, 1);  // 0=西岸，1=东岸

    // 西侧海岸坡（缓坡上升）
    const coastRise = smoothstep(0.0, 0.12, nx) * 2.0;
    // 内陆平原（有起伏，不平坦）
    const plainBase = 2.5 * smoothstep(0.08, 0.40, nx);
    // ★ 大陆地形起伏：多层噪声叠加，使陆地有丘陵感
    const roll1 = fbmNoise(x * 0.9, z * 0.8, 4, 0.035, 0.52) * 1.4;
    const roll2 = fbmNoise(x * 1.4 + 3.2, z * 1.2 - 5.1, 3, 0.055, 0.50) * 0.8;
    const roll3 = fbmNoise(x * 0.5 - 7.3, z * 0.4 + 2.9, 3, 0.018, 0.58) * 1.8;
    // 大地形波动（高原感）
    const plateauWave = Math.sin(x * 0.06 + z * 0.035) * 0.8
                      + Math.cos(x * 0.04 - z * 0.06) * 0.6;
    const plainDetail = roll1 + roll2 * 0.5 + roll3 * 0.4 + plateauWave * 0.4;

    // ★ 东侧山脉（印度板块靠海湾一侧的山地）
    // 山脉沿东海岸（indiaEastCoast）走向，nx越大越靠近山脉
    // 山脉区域：nx ≈ 0.65 ~ 1.0
    const hillRaw = clamp(gaussian(nx, 0.72, 0.16), 0, 1);
    // 使用较尖锐的幂函数（幂<1 → 顶部急剧）
    const hillSharp = Math.pow(hillRaw, 0.38);
    // 山脉高度幅度
    const mountainAmplitude = S.indiaPeakMax - S.seaLevel;  // 10 - 5 = 5
    const eastHill = mountainAmplitude * hillSharp;

    // 山脉崎岖细节（ridgedNoise 使山脊线不单调）
    const ridgeMicro = clamp(ridgedNoise(x * 0.8 + z * 0.35, z * 1.0 - x * 0.2, 4, 0.10, 0.50), 0, 1);
    const detailNoise = ridgeMicro * hillRaw * 0.8 + fbmNoise(x + 5, z - 3, 3, 0.06, 0.48) * 0.4;

    // 东岸下坡（靠近海湾快速下降至海湾边缘）
    const eastDrop = -4.5 * smoothstep(0.87, 1.0, nx);

    const h = S.seaLevel + coastRise + plainBase + plainDetail + eastHill + detailNoise + eastDrop;
    return clamp(h, S.seaLevel - 1.0, S.indiaPeakMax);
}

/* ============================================================
   亚欧板块山脉系统（喜马拉雅）—— 沿Z轴方向走向，与海湾S型平行
   ★ 关键设计：山脉沿Z轴延伸（前后方向），山脊线的X坐标随Z的S型变化
   ★ 山脊线 X = indiaEastCoast(z) + 5（海湾右边界） + 内陆偏移35单位
   ★ 山脉宽度方向 = X轴方向，山脉在X轴上有一定宽度（~20单位）
   ★ 山脉在亚欧板块内部（距海湾30~40单位处），不是紧贴海湾
   山脉最高点: eurAsiaPeakMax = 15
============================================================ */

/**
 * 获取给定Z坐标处山脉主脊线的X坐标
 * 山脊位于亚欧板块内部（距海湾右边界约35单位），与海湾保持一定距离
 * 山脊的S型走向与海湾平行（indiaEastCoast(z) 的S型）
 */
function mountainSpineX(z) {
    // 山脊X = 海湾右边界（S型） + 内陆偏移（山脉在板块内部，不紧贴海湾）
    // 海湾右边界 ≈ indiaEastCoast(z) + 5，山脊在其右侧约35单位
    const bayEdge = indiaEastCoast(z) + 5.0;
    // 内陆偏移35：使山脉主脊在距海湾边界约35单位的内陆位置
    // 这样海湾边缘只有轻微悬崖，山脉主体在内陆
    return bayEdge + 35.0;
}

/**
 * 计算给定(x,z)点的山脉强度场
 * 山脉沿Z轴延伸，X轴为宽度方向
 * distFromSpine = x - mountainSpineX(z)  （正值=山脊右侧，负值=山脊左侧）
 */
function getMountainField(x, z) {
    // ★ 山脊线X坐标（随Z的S型变化，与海湾走向相同）
    const spineX = mountainSpineX(z);

    // 距山脊线的X方向距离（正值=内陆侧，负值=海湾侧）
    const distFromSpine = x - spineX;

    // ★ 山脉宽度加宽：20单位（比设计稿稍宽，使山脉更宏伟）
    const mountainHalfWidth = 18.0;  // 半宽18，总宽36

    // 主山脊剖面：用高斯函数控制X方向的宽度
    // sigma = 8（山脉主脊宽度约16单位）
    const mainWidth = 7.0;
    const mainCross = gaussian(x, spineX, mainWidth);

    // 山肩（山脊两侧的次级起伏）
    const shoulderWidth = mainWidth * 1.6;
    // 内陆侧山肩（山脊右侧，距山脊约12单位）
    const shoulderR = gaussian(x, spineX + mainWidth * 1.5, shoulderWidth) * 0.55;
    // 海湾侧山肩（山脊左侧，但这侧是悬崖，应更陡峭，山肩较小）
    const shoulderL = gaussian(x, spineX - mainWidth * 1.2, shoulderWidth * 0.7) * 0.30;

    const rangeMask  = clamp(mainCross + shoulderL + shoulderR, 0, 1.0);
    const crestMask  = clamp(mainCross * 1.3, 0, 1.0);
    const flankMask  = clamp(shoulderL + shoulderR, 0, 0.9);

    // ★ 山脉在X轴上的有效范围（防止山脉延伸到太右侧内陆）
    // 山脉中心在 x = spineX，向右（内陆方向）衰减
    const inRangeX = clamp(1.0 - smoothstep(0, mountainHalfWidth * 2.0, distFromSpine), 0, 1);
    // 山脊左侧（海湾侧）快速衰减
    const leftFade = clamp(1.0 - smoothstep(-mountainHalfWidth * 0.5, -mountainHalfWidth, distFromSpine - mountainHalfWidth * 0), 0, 1);

    // ★ 山脉纵向包络线（沿Z方向）：前后两端衰减，中段强
    // 山脉沿整个Z轴延伸，两端（z≈±48）略有衰减
    const edgeFade = smoothstep(S.halfDepth, S.halfDepth - 10.0, Math.abs(z));

    // 最终包络 = inRangeX（X方向范围）* edgeFade（Z方向衰减）
    const rangeEnvelope = inRangeX * edgeFade;

    return { spineX, distFromSpine, rangeMask, crestMask, flankMask, rangeEnvelope };
}

/* ============================================================
   亚欧板块大陆高度函数
   范围：x >= indiaEastCoast(z) + 5（俯冲带右侧）
   ★ 亚欧板块左缘严格跟随 indiaEastCoast(z)+5 的S型轮廓
   高度规则：
     - 普通陆地（平原/低地）最高 = S.plainMax = 5，且有明显起伏
     - 山脉最高 = S.eurAsiaPeakMax = 15
     - 山顶极尖锐（高幂次函数），山脚宽缓坡
     - 山脉沿Z轴走向（前后方向），山脊X随Z的S型变化
============================================================ */
function continentHeight(x, z) {
    // ★ 亚欧板块起始边界 = 海湾右侧 = indiaEastCoast(z) + 5
    const bayRightEdge = indiaEastCoast(z) + 5.0;  // S型边界
    const shoreDistance = x - bayRightEdge;         // 距S型边界的距离

    if (shoreDistance < 0) {
        return bayBedHeight(x, z);
    }

    // nx: 0=亚欧板块左缘(S型边界), 1=内陆右缘（100单位=xMax）
    const nx = clamp(shoreDistance / 100.0, 0, 1);

    // ── 基础陆地高度（有明显起伏，不再是一片平坦）──
    // 碰撞带前缘缓坡（靠近海湾侧轻微隆起）
    const frontRamp = 1.8 * smoothstep(0.0, 0.06, nx);
    // 山前盆地（轻微凹陷，模拟山前坳陷）
    const forelandBasin = -1.0 * gaussian(shoreDistance, 14, 9);
    // ★ 大陆起伏：增加大幅度的地形波动，使陆地不再平坦
    // 使用多层fbmNoise叠加，幅度增大
    const roll1 = fbmNoise(x * 0.85, z * 0.72, 5, 0.022, 0.55) * 1.8;
    const roll2 = fbmNoise(x * 1.3 + 7.1, z * 1.1 - 3.2, 4, 0.038, 0.52) * 1.2;
    const roll3 = fbmNoise(x * 0.6 - 5.4, z * 0.5 + 11.7, 3, 0.015, 0.58) * 2.2;
    // 中距离起伏（高原台地感）
    const plateauWave = Math.sin(x * 0.045 + z * 0.028) * 1.1
                      + Math.cos(x * 0.031 - z * 0.053) * 0.9;
    const baseRoll = roll1 + roll2 * 0.6 + roll3 * 0.4 + plateauWave * 0.5;
    // 基础高度（平原，seaLevel + 以下结构）
    const baseLand = S.seaLevel + frontRamp + forelandBasin + baseRoll;

    // ── 山脉系统（极尖锐山顶，沿Z轴S型走向）──
    const field = getMountainField(x, z);

    // ══════════════════════════════════════════════════════
    // ★ 6个离散山峰定义（Z轴方向高度包络）
    // 用锥形帐篷函数叠加：峰顶尖锐，两侧快速下降到0
    // 峰之间无叠加 → 真正的山谷（接近0），峰顶醒目（接近1）
    // Z范围 -56 ~ +56（halfDepth=56，depth=112）
    // ══════════════════════════════════════════════════════

    // nz: 将 z 从 [-56, +56] 映射到 [0, 1]
    const nz = (z + S.halfDepth) / S.depth;  // 0=后侧, 1=前侧

    // 6个山峰：每个峰有 center(nz位置), height(0~1), halfWidth(nz单位)
    // halfWidth 较小 → 峰宽窄，峰间山谷明显；较大 → 峰宽，连绵感强
    // 这里 halfWidth≈0.07~0.09 → 峰宽约 8~10 单位Z，峰间谷底清晰
    const PEAKS = [
        { c: 0.08, h: 0.55, w: 0.07 },  // 峰1：后侧小峰（末梢）
        { c: 0.22, h: 0.82, w: 0.08 },  // 峰2：后段主峰
        { c: 0.38, h: 1.00, w: 0.09 },  // 峰3：最高峰（喜马拉雅珠峰）
        { c: 0.54, h: 0.88, w: 0.08 },  // 峰4：中段次高峰
        { c: 0.70, h: 0.72, w: 0.08 },  // 峰5：前段次峰
        { c: 0.88, h: 0.50, w: 0.07 },  // 峰6：前侧小峰（末梢）
    ];

    let peakEnvelopeZ = 0.0;
    for (const pk of PEAKS) {
        const dist = Math.abs(nz - pk.c) / pk.w;
        if (dist < 1.8) {
            // 平滑锥形：pow(1-dist/1.8, 2) → 顶部圆润但峰间确实归零
            const t = Math.max(0, 1.0 - dist / 1.8);
            peakEnvelopeZ += pk.h * t * t;
        }
    }

    // 加入微量噪声（使各峰稍不对称，更自然）
    const peakNoise = fbmNoise(z * 0.20, x * 0.04, 3, 0.06, 0.52) * 0.10;
    peakEnvelopeZ = clamp(peakEnvelopeZ + peakNoise, 0.0, 1.0);

    // X方向剖面：高斯函数（山脊为峰值，两侧对称下降）
    const crestProfile = clamp(field.crestMask, 0, 1.0);
    const flankProfile = clamp(field.flankMask, 0, 1.0);

    // 山脉高度幅度
    const mountainAmp = S.eurAsiaPeakMax - S.seaLevel;  // 15 - 5 = 10

    // 最终高度 = amplitude × 横截面剖面 × Z方向峰高包络
    // 峰间山谷处 peakEnvelopeZ≈0 → 山脊高度极低（接近baseLand）
    // 峰顶处 peakEnvelopeZ=1 → 山脊高度最大
    const mountainContrib = (
        crestProfile * 1.0 * mountainAmp * peakEnvelopeZ
        + flankProfile * 0.38 * mountainAmp * (0.5 + peakEnvelopeZ * 0.5)
    ) * field.rangeEnvelope;

    // ★ 山脉周边崎岖起伏（增加山脉区域的复杂感）
    // ridgedNoise 产生"走脊"的崎岖感，但只在山脉区域附近有效
    const ridgeMicro = clamp(ridgedNoise(x * 0.9 + z * 0.4, z * 1.2 - x * 0.3, 5, 0.09, 0.50), 0, 1);
    // 只在山脉附近生效（rangeEnvelope控制范围）
    const microContrib = ridgeMicro * field.rangeEnvelope * 1.2;

    // 右侧内陆下降（x过大时回到平原高度）
    const rightDrop = -4.5 * smoothstep(0.75, 1.0, nx);

    // 最终高度 = 有起伏的基础陆地 + 山脉贡献
    // 注意：baseLand不再严格限高，允许平原有起伏（但平原峰值约plainMax）
    const plainClamped = clamp(baseLand, S.seaLevel - 2.5, S.plainMax + 1.5);
    const finalHeight = plainClamped + mountainContrib + microContrib + rightDrop;

    return clamp(finalHeight, S.seaLevel - 3.0, S.eurAsiaPeakMax);
}

/* ============================================================
   通用高度查询（根据X坐标自动选择区域）
   返回给定(x,z)的地形高度，用于前面板剖面
============================================================ */
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

/* ============================================================
   水面高度
============================================================ */
function waterSurfaceHeight(x, z) {
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const bayEnd    = eastShore + 5;

    // 海洋区域（深海+浅海）和海湾区域有水面
    const inOcean = x < westShore;
    const inBay   = (x >= eastShore && x < bayEnd);

    if (!inOcean && !inBay) return -999; // 陆地，无水面

    const fade  = smoothstep(S.xMin, S.xMin + 18, x) * (1 - smoothstep(westShore - 7.0, westShore + 0.8, x));
    const bayFade = inBay ? 1.0 : 0;
    const swell = Math.sin(x * 0.052 + z * 0.11) * 0.2 + Math.cos(x * 0.033 - z * 0.08) * 0.12;
    const shallowLift = smoothstep(westShore - 14, westShore - 2, x) * 0.3;

    // ★ 水面高度严格控制在 seaLevel 附近，不超过 seaLevel + 0.3
    return clamp(S.seaLevel + shallowLift + swell * (fade + bayFade * 0.5), S.seaLevel - 0.2, S.seaLevel + 0.3);
}

/* ============================================================
   颜色函数
============================================================ */
function mantleColorAt(x, y) {
    const dt = clamp((y - S.mantleBottom) / (S.mantleTop - S.mantleBottom), 0, 1);
    const swirl = 0.5 + 0.5 * Math.sin(x * 0.035 + y * 0.12);
    const heat = clamp(dt * 0.62 + swirl * 0.28, 0, 1);
    return new THREE.Color(
        mix(0.24, 1.0, heat),
        mix(0.04, 0.44, heat * heat),
        mix(0.01, 0.08, heat * 0.35)
    );
}

function oceanCrustColorAt(x, y) {
    const warmth = gaussian(x, S.ridgeX, 18) * 0.2 + gaussian(x, S.indiaWestMeanX - 6, 8) * 0.08;
    const depthT = clamp((y - S.lithBottom) / (S.seaLevel - S.lithBottom), 0, 1);
    return new THREE.Color(
        0.12 + depthT * 0.05 + warmth * 0.22,
        0.12 + depthT * 0.05 + warmth * 0.08,
        0.17 + depthT * 0.04 + warmth * 0.03
    );
}

function continentCrustColorAt(x, y) {
    // 调整颜色分层以匹配新的高度范围（最高15）
    if (y > 13) return new THREE.Color(0.92, 0.94, 0.96);  // 雪顶
    if (y > 10) return new THREE.Color(0.72, 0.70, 0.66);  // 高山裸岩
    if (y > 7)  return new THREE.Color(0.60, 0.52, 0.42);  // 山地岩石
    if (y > 5)  return new THREE.Color(0.52, 0.56, 0.34);  // 山腰植被
    if (y > S.seaLevel + 1.0) return new THREE.Color(0.64, 0.58, 0.4);   // 低地
    if (y > S.seaLevel - 2.0) return new THREE.Color(0.69, 0.62, 0.46);  // 平原
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

// ★ 岩石色：用于海湾相邻悬崖、俯冲带边缘
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
    // 印度板块陆地颜色：绿色植被为主，东侧（靠海湾）强制岩石色
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const landWidth = Math.max(eastShore - westShore, 1);
    const nx = clamp((x - westShore) / landWidth, 0, 1);

    // ★ 东侧靠海湾区域（nx > 0.85）强制岩石颜色（与海湾相接的悬崖）
    const eastCliffMask = smoothstep(0.82, 1.0, nx);

    // 颜色分层匹配新高度范围（印度板块山脉最高10）
    const beachMask = smoothstep(S.seaLevel - 0.3, S.seaLevel + 2.0, y) * (1 - smoothstep(S.seaLevel + 2.5, S.seaLevel + 5.0, y));
    const grassMask = smoothstep(S.seaLevel + 1.5, 7.0, y) * (1 - smoothstep(7.5, 9.5, y));
    const hillRock  = smoothstep(7.5, 9.5, y) * (1 - smoothstep(9.5, 11.0, y));
    const eastFade  = smoothstep(0.55, 0.80, nx);

    let r = 0.72, g = 0.68, b = 0.52;
    r = mix(r, 0.88, beachMask); g = mix(g, 0.80, beachMask); b = mix(b, 0.58, beachMask);
    r = mix(r, 0.42, grassMask); g = mix(g, 0.65, grassMask); b = mix(b, 0.26, grassMask);
    r = mix(r, 0.62, hillRock);  g = mix(g, 0.56, hillRock);  b = mix(b, 0.44, hillRock);
    r = mix(r, 0.56, eastFade * 0.35); g = mix(g, 0.50, eastFade * 0.35); b = mix(b, 0.40, eastFade * 0.35);

    // ★ 东侧悬崖：强制岩石色（靠近海湾，无植被）
    const cliff = rockCliffColor(x, y, z);
    r = mix(r, cliff.r, eastCliffMask);
    g = mix(g, cliff.g, eastCliffMask);
    b = mix(b, cliff.b, eastCliffMask);

    const noise = fbmNoise(x, z, 3, 0.06, 0.5) * 0.04;
    return new THREE.Color(clamp(r + noise, 0, 1), clamp(g + noise * 0.6, 0, 1), clamp(b, 0, 1));
}

function continentTopColorAt(x, y, z, slope) {
    // ★ 亚欧板块左侧（靠海湾一侧）强制岩石色
    const bayRightEdge = indiaEastCoast(z) + 5.0;
    const distFromBay = x - bayRightEdge;  // 距S型边界的距离（正值=在亚欧板块内）
    // 靠近海湾的前20单位：逐渐转为岩石色（悬崖）
    const bayCliffMask = smoothstep(12.0, 0.0, distFromBay);

    // 雪线调整为 snowBase=12，带噪声变化
    const snowLine = S.snowBase + fbmNoise(x, z, 3, 0.05, 0.55) * 1.2;
    const field = getMountainField(x, z);
    const wetCoastMask = 1 - smoothstep(S.seaLevel - 4.5, S.seaLevel + 1.0, y);
    const beachMask = smoothstep(S.seaLevel - 0.4, S.seaLevel + 2.3, y) * (1 - smoothstep(S.seaLevel + 2.5, S.seaLevel + 5.0, y));
    // 草地：seaLevel+1.5 到 8，在8~10过渡到岩石
    const grassMask = smoothstep(S.seaLevel + 1.5, 8.0, y) * (1 - smoothstep(8.5, 11.0, y));
    // 高山岩石区：8~12（雪线以下）
    const alpineMask = smoothstep(8.0, 11.5, y) * (1 - smoothstep(snowLine - 0.8, snowLine + 1.2, y));
    // 雪顶：超过雪线
    const snowMask = smoothstep(snowLine - 1.0, snowLine + 1.5, y);
    const ridgeTint = clamp(field.rangeEnvelope * field.rangeMask * 0.7, 0, 1);
    const terrainNoise = fbmNoise(x, z, 4, 0.06, 0.5) * 0.030;

    // 基础色：棕灰（平原低地）
    let r = 0.79, g = 0.73, b = 0.61;
    r = mix(r, 0.52, grassMask); g = mix(g, 0.70, grassMask); b = mix(b, 0.38, grassMask);
    r = mix(r, 0.88, beachMask); g = mix(g, 0.80, beachMask); b = mix(b, 0.59, beachMask);
    // 高山岩石（灰棕色，无植被）
    r = mix(r, 0.62, alpineMask); g = mix(g, 0.57, alpineMask); b = mix(b, 0.48, alpineMask);
    // 雪顶（白色）
    r = mix(r, 0.97, snowMask); g = mix(g, 0.97, snowMask); b = mix(b, 1.0, snowMask);
    r = mix(r, 0.54, wetCoastMask); g = mix(g, 0.68, wetCoastMask); b = mix(b, 0.63, wetCoastMask);

    // 陡坡岩壁（不被雪覆盖的部分变成岩石色）
    const cliffMask = clamp((slope - 0.18) / 0.48, 0, 1) * (1 - snowMask * 0.52);
    r = mix(r, 0.55, cliffMask); g = mix(g, 0.50, cliffMask); b = mix(b, 0.44, cliffMask);

    r += ridgeTint * 0.04 + terrainNoise; g += ridgeTint * 0.025 + terrainNoise * 0.75;
    b += ridgeTint * 0.010 + terrainNoise * 0.5;

    // ★ 靠近海湾的悬崖：覆盖岩石色（不被植被/雪覆盖）
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
    // 海湾水体颜色：比浅海稍暗，带点神秘感（俯冲带上方）
    return new THREE.Color(0.04, 0.20, 0.48);
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

function createConvectionVortex(cx, cy, radiusX, radiusY, color, opacity) {
    const curve = new THREE.EllipseCurve(cx, cy, radiusX, radiusY, 0, Math.PI * 2, false, 0);
    const points = curve.getPoints(72);
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
        color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    return new THREE.Line(geometry, material);
}

/* ============================================================
   海岸线泡沫（沿印度板块西岸）
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
   水面形状（海洋区域 + 海湾区域）
============================================================ */
function createOceanWaterSurface(materialOptions = {}) {
    // 海洋（深海+浅海）水面：从 xMin 到 indiaWestCoast 边界
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
        // ★ 水面高度严格控制在 seaLevel
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
    // 海湾水面：宽约5，S型，沿 indiaEastCoast 右侧
    // 范围从 backZ 到 frontZ（不缩进，确保与前后剖面板的海湾水体无缝连接）
    const samples = 80;
    const shape = new THREE.Shape();
    // 从后到前，沿海湾左岸（indiaEastCoast）
    for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const z = mix(S.backZ, S.frontZ, t);
        const x = indiaEastCoast(z) + 0.3;
        if (i === 0) shape.moveTo(x, z);
        else shape.lineTo(x, z);
    }
    // 再沿右岸（indiaEastCoast + 5）从前到后
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
        // ★ 海湾水面也严格在 seaLevel
        positions.setXYZ(i, x, S.seaLevel, z);
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    assignVertexColors(geometry, (x, y, z) => bayWaterColorAt(x, y, z));

    const material = new THREE.MeshPhysicalMaterial({
        vertexColors: true, transparent: true, opacity: 0.70,
        roughness: 0.60, metalness: 0.02, ior: 1.33,
        thickness: 0.5, clearcoat: 0.06, clearcoatRoughness: 0.78,
        side: THREE.DoubleSide, ...materialOptions,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.renderOrder = 6;
    return mesh;
}

/* ============================================================
   ★ 正面剖面板（前面板，z = frontZ）
   正交视图内容，展示完整地质剖面，包含：
   - 软流层（Y: -65 ~ -15）
   - 岩石圈地壳（Y: -15 ~ terrainHeight）
   - 海水层（Y: 海底 ~ seaLevel）
   - 地形表面（包含所有区域）
   - 俯冲带（清晰展示）
   注意：不透视，是2D形状贴在前面
============================================================ */
function createFrontProfilePanel(textures) {
    const group = new THREE.Group();
    group.name = 'FrontProfile';

    const z = S.frontZ;
    const segs = 400; // 高分辨率剖面

    // 采样前面板各区域的地形高度
    const profilePoints = [];
    for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        const x = mix(S.xMin, S.xMax, t);
        const y = terrainHeightAt(x, z);
        profilePoints.push(new THREE.Vector2(x, y));
    }

    /* 1. 软流层底板 */
    const mantleShape = new THREE.Shape();
    mantleShape.moveTo(S.xMin, S.mantleBottom);
    mantleShape.lineTo(S.xMax, S.mantleBottom);
    mantleShape.lineTo(S.xMax, S.mantleTop);
    mantleShape.lineTo(S.xMin, S.mantleTop);
    mantleShape.closePath();
    const mantleGeo = new THREE.ShapeGeometry(mantleShape, 80);
    mantleGeo.computeVertexNormals();
    assignVertexColors(mantleGeo, (x, y) => mantleColorAt(x, y));
    const mantleMesh = new THREE.Mesh(mantleGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.7, metalness: 0.02,
        emissive: new THREE.Color(0x5c1e04), emissiveIntensity: 1.6,
        side: THREE.DoubleSide,
    }));
    mantleMesh.position.z = z + 0.01;
    group.add(mantleMesh);

    /* 2. 地壳剖面（从 lithBottom 到地形表面） */
    // 分区域着色：海洋地壳 vs 大陆地壳 vs 印度陆地 vs 俯冲带
    const crustShape = new THREE.Shape();
    crustShape.moveTo(S.xMin, S.lithBottom);
    // 沿地形表面
    for (let i = 0; i <= segs; i++) {
        crustShape.lineTo(profilePoints[i].x, profilePoints[i].y);
    }
    crustShape.lineTo(S.xMax, S.lithBottom);
    crustShape.closePath();

    const crustGeo = new THREE.ShapeGeometry(crustShape, 300);
    crustGeo.computeVertexNormals();
    // 地壳颜色：根据X位置分区着色
    assignVertexColors(crustGeo, (x, y) => {
        const westShore = indiaWestCoast(z);
        const eastShore = indiaEastCoast(z);
        const bayEnd = eastShore + 5.0;

        if (x < westShore) {
            // 海洋地壳
            return oceanCrustColorAt(x, y);
        } else if (x < eastShore) {
            // 印度板块地壳
            return continentCrustColorAt(x, y);
        } else if (x < bayEnd) {
            // ★ 俯冲带/海湾：特殊颜色，偏红棕（岩石圈下沉）
            const subductT = clamp((y - S.lithBottom) / (-S.lithBottom + S.seaLevel), 0, 1);
            const glow = smoothstep(S.seaLevel - 4, S.seaLevel + 1, y) * 0.12;
            return new THREE.Color(
                mix(0.48, 0.72, subductT) + glow,
                mix(0.14, 0.32, subductT) + glow * 0.3,
                mix(0.10, 0.22, subductT) + glow * 0.2
            );
        } else {
            // 亚欧板块地壳
            return continentCrustColorAt(x, y);
        }
    });
    const crustMesh = new THREE.Mesh(crustGeo, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.88, metalness: 0.03,
        emissive: new THREE.Color(0x1b1004), emissiveIntensity: 0.18,
        side: THREE.DoubleSide,
    }));
    crustMesh.position.z = z + 0.02;
    group.add(crustMesh);

    /* 3. 海水层（海洋区域从海底到海平面） */
    const westShore = indiaWestCoast(z);
    const eastShore = indiaEastCoast(z);
    const bayEnd = eastShore + 5.0;

    // 3a. 大洋水体
    const oceanWaterShape = new THREE.Shape();
    oceanWaterShape.moveTo(S.xMin, S.seaLevel);
    oceanWaterShape.lineTo(westShore, S.seaLevel);
    // 沿海底从右到左
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
    oceanWaterMesh.position.z = z + 0.05;
    oceanWaterMesh.renderOrder = 5;
    group.add(oceanWaterMesh);

    // 3b. 海湾水体（俯冲带上方，特殊颜色）
    const bayWaterShape = new THREE.Shape();
    bayWaterShape.moveTo(eastShore, S.seaLevel);
    bayWaterShape.lineTo(bayEnd, S.seaLevel);
    // 沿海湾底从右到左
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
        vertexColors: true, transparent: true, opacity: 0.80,
        roughness: 0.62, metalness: 0.02,
        emissive: new THREE.Color(0x0c3d66), emissiveIntensity: 0.6,
        side: THREE.DoubleSide,
    }));
    bayWaterMesh.position.z = z + 0.06;
    bayWaterMesh.renderOrder = 6;
    group.add(bayWaterMesh);

    /* 4. ★ 俯冲带高亮线（清晰展示俯冲带位置）*/
    // 画一条从海湾底部向右下方延伸的俯冲线
    const subductPoints2D = [
        new THREE.Vector2(eastShore + 2.5, bayBedHeight(eastShore + 2.5, z)),
        new THREE.Vector2(eastShore + 8,   -5),
        new THREE.Vector2(eastShore + 16,  -12),
        new THREE.Vector2(eastShore + 28,  -20),
        new THREE.Vector2(eastShore + 44,  -30),
    ];
    // 用拉伸几何体画俯冲楔形
    const subductShape2D = new THREE.Shape();
    const halfW = 1.8;
    for (let i = 0; i < subductPoints2D.length; i++) {
        subductShape2D.lineTo(subductPoints2D[i].x, subductPoints2D[i].y + halfW);
    }
    for (let i = subductPoints2D.length - 1; i >= 0; i--) {
        subductShape2D.lineTo(subductPoints2D[i].x, subductPoints2D[i].y - halfW);
    }
    subductShape2D.closePath();
    const subductGeo2D = new THREE.ShapeGeometry(subductShape2D, 40);
    subductGeo2D.computeVertexNormals();
    assignVertexColors(subductGeo2D, (x, y) => {
        const t = clamp((y + 32) / 40, 0, 1);
        return new THREE.Color(
            mix(0.8, 0.55, t),
            mix(0.25, 0.15, t),
            mix(0.12, 0.08, t)
        );
    });
    const subductMesh2D = new THREE.Mesh(subductGeo2D, new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.65, metalness: 0.06,
        emissive: new THREE.Color(0x6f1a00), emissiveIntensity: 0.85,
        side: THREE.DoubleSide,
    }));
    subductMesh2D.position.z = z + 0.07;
    group.add(subductMesh2D);

    /* 5. 海平面线 */
    const seaLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(S.xMin, S.seaLevel, z + 0.08),
        new THREE.Vector3(westShore + 0.5, S.seaLevel, z + 0.08),
    ]);
    const seaLineMat = new THREE.LineBasicMaterial({
        color: 0x7dd8ff, transparent: true, opacity: 0.55,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    group.add(new THREE.Line(seaLineGeo, seaLineMat));

    /* 6. 岩石圈底界线 */
    const lithLineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(S.xMin, S.lithBottom, z + 0.09),
        new THREE.Vector3(S.xMax, S.lithBottom, z + 0.09),
    ]);
    const lithLineMat = new THREE.LineBasicMaterial({
        color: 0xff8844, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
    });
    group.add(new THREE.Line(lithLineGeo, lithLineMat));

    return group;
}

/* ============================================================
   俯冲板片
============================================================ */
function buildSubductionSlab(depth) {
    // 俯冲板片从消亡边界（平均X≈+5）斜插，角度约25°
    const centerline = [
        new THREE.Vector2(5,  -1),
        new THREE.Vector2(14, -6),
        new THREE.Vector2(26, -14),
        new THREE.Vector2(42, -24),
        new THREE.Vector2(60, -34),
        new THREE.Vector2(80, -43),
    ];
    const thickness = 4.5;
    const upper = [], lower = [];
    for (let i = 0; i < centerline.length; i++) {
        const prev = centerline[Math.max(0, i - 1)];
        const next = centerline[Math.min(centerline.length - 1, i + 1)];
        const tangent = next.clone().sub(prev).normalize();
        const normal = new THREE.Vector2(-tangent.y, tangent.x).multiplyScalar(thickness);
        upper.push(centerline[i].clone().add(normal));
        lower.push(centerline[i].clone().sub(normal));
    }
    const shape = new THREE.Shape();
    shape.moveTo(upper[0].x, upper[0].y);
    for (let i = 1; i < upper.length; i++) shape.lineTo(upper[i].x, upper[i].y);
    for (let i = lower.length - 1; i >= 0; i--) shape.lineTo(lower[i].x, lower[i].y);
    shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, steps: 1, curveSegments: 56 });
    geometry.computeVertexNormals();
    assignVertexColors(geometry, (x, y) => {
        const t = clamp((y + 45) / 45, 0, 1);
        const glow = smoothstep(-5, 8, x) * 0.08;
        return new THREE.Color(
            mix(0.56, 0.84, t) + glow,
            mix(0.18, 0.34, t) + glow * 0.24,
            mix(0.22, 0.44, t) + glow * 0.16
        );
    });
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true, roughness: 0.72, metalness: 0.04,
        emissive: new THREE.Color(0x35181f), emissiveIntensity: 0.38,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.z = -depth * 0.5;
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
}

/* ============================================================
   雪帽和山脉细节
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
        // 雪线调整为 snowBase=12，噪声范围缩小以适应新的高度范围（最高15）
        const snowLine = S.snowBase + fbmNoise(x, z, 3, 0.05, 0.55) * 1.2;
        if (y < snowLine) {
            positions.setY(i, y - 2.0);
        } else {
            // 山顶尖锐，雪帽厚度减小（山顶高度有限）
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
        // 雪线和雪帽与新高度范围匹配
        const snowLine = S.snowBase + fbmNoise(x, z, 3, 0.05, 0.55) * 1.2;
        const snowMask = smoothstep(snowLine - 1.0, snowLine + 1.5, y);
        const crag = clamp(ridgedNoise(x * 2.0 + 4.0, z * 2.5 - 2.0, 4, 0.13, 0.44), 0, 1);
        // 山脉细节从 seaLevel+2 开始，到达 S.eurAsiaPeakMax 上方
        const alpha = clamp((rockMask - 0.16) / 0.58, 0, 1) * smoothstep(S.seaLevel + 2.0, 9.0, y);
        // 山顶尖锐时，lift 减小（避免平顶）
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
   侧壁
============================================================ */
function createRockSideWall(xPosition, topHeight, textures, tint) {
    const geometry = new THREE.PlaneGeometry(S.depth, Math.max(topHeight - S.lithBottom, 2));
    const material = new THREE.MeshStandardMaterial({
        color: tint, map: textures.rockColor, bumpMap: textures.rockBump,
        roughnessMap: textures.rockRoughness, bumpScale: 0.45, roughness: 1.0,
        metalness: 0.01, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = Math.PI * 0.5;
    mesh.position.set(xPosition, (topHeight + S.lithBottom) * 0.5, 0);
    mesh.castShadow = true; mesh.receiveShadow = true;
    return mesh;
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

function createMantleSideWall(xPosition) {
    const geometry = new THREE.PlaneGeometry(S.depth, S.mantleTop - S.mantleBottom);
    const material = new THREE.MeshStandardMaterial({
        color: 0x581203, emissive: new THREE.Color(0xff5a1b), emissiveIntensity: 1.15,
        roughness: 0.84, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.y = Math.PI * 0.5;
    mesh.position.set(xPosition, (S.mantleTop + S.mantleBottom) * 0.5, 0);
    mesh.receiveShadow = true;
    return mesh;
}

/* ============================================================
   主函数：createTectonicLandscape
============================================================ */
export function createTectonicLandscape(scene, deps = {}) {
    const root = new THREE.Group();
    root.name = 'TectonicLandscape';
    scene.add(root);

    const textures = loadTextures(deps);

    // 前视图（z=0）处的海岸线位置
    const westShore0  = indiaWestCoast(0);
    const eastShore0  = indiaEastCoast(0);
    const bayEnd0     = eastShore0 + 5;

    /* ===== 1. 软流层（最底层） ===== */
    // ★ 软流层正面和背面，用实体2D形状（确保高度差=50正确）
    const mantleFront = createSolidSection(
        [new THREE.Vector2(S.xMin, S.mantleTop), new THREE.Vector2(S.xMax, S.mantleTop)],
        S.mantleBottom, mantleColorAt,
        { roughness: 0.7, metalness: 0.02, emissive: new THREE.Color(0x5c1e04), emissiveIntensity: 1.6 }
    );
    mantleFront.position.z = S.frontZ;
    root.add(mantleFront);
    const mantleBack = mantleFront.clone();
    mantleBack.position.z = S.backZ;
    root.add(mantleBack);

    // 软流层顶面
    const mantleTopGeometry = new THREE.PlaneGeometry(S.xMax - S.xMin, S.depth, 56, 28);
    const mantleTopPositions = mantleTopGeometry.getAttribute('position');
    const mantleTopColors = new Float32Array(mantleTopPositions.count * 3);
    for (let i = 0; i < mantleTopPositions.count; i++) {
        const u = (mantleTopPositions.getX(i) + (S.xMax - S.xMin) * 0.5) / (S.xMax - S.xMin);
        const v = (mantleTopPositions.getY(i) + S.depth * 0.5) / S.depth;
        const heat = gaussian(u, 0.48, 0.34) * gaussian(v, 0.5, 0.42) * 0.68 + 0.24;
        mantleTopColors[i * 3]     = mix(0.3, 0.92, heat);
        mantleTopColors[i * 3 + 1] = mix(0.05, 0.34, heat * heat);
        mantleTopColors[i * 3 + 2] = mix(0.02, 0.08, heat * 0.3);
    }
    mantleTopGeometry.setAttribute('color', new THREE.BufferAttribute(mantleTopColors, 3));
    const mantleTopMesh = new THREE.Mesh(mantleTopGeometry, new THREE.MeshStandardMaterial({
        vertexColors: true, emissive: new THREE.Color(0xff5a1b), emissiveIntensity: 1.0,
        roughness: 0.82, metalness: 0.0, side: THREE.DoubleSide,
    }));
    mantleTopMesh.rotation.x = -Math.PI * 0.5;
    // ★ 软流层顶部严格在 Y = mantleTop = -15
    mantleTopMesh.position.set((S.xMin + S.xMax) * 0.5, S.mantleTop + 0.1, 0);
    mantleTopMesh.receiveShadow = true;
    root.add(mantleTopMesh);

    const mantleGlow = createGlowStrip(S.xMax - S.xMin - 8, 16, 0xff7a3f, 0.32);
    mantleGlow.rotation.x = -Math.PI * 0.5;
    mantleGlow.position.set((S.xMin + S.xMax) * 0.5, S.mantleTop + 0.55, 0);
    root.add(mantleGlow);

    const mantleBottomPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(S.xMax - S.xMin, S.depth, 1, 1),
        new THREE.MeshStandardMaterial({
            color: 0x3a0d02, emissive: new THREE.Color(0xff3300), emissiveIntensity: 0.8, roughness: 0.9,
        })
    );
    mantleBottomPlane.rotation.x = -Math.PI * 0.5;
    // ★ 软流层底部严格在 Y = mantleBottom = -65
    mantleBottomPlane.position.set((S.xMin + S.xMax) * 0.5, S.mantleBottom, 0);
    root.add(mantleBottomPlane);

    // 软流层对流涡旋（前面板）
    const vortexGroup = new THREE.Group();
    vortexGroup.position.z = S.frontZ + 0.2;
    // 左涡（印度洋板块下方，X≈-50）
    vortexGroup.add(createConvectionVortex(-55, -38, 30, 10, 0xff6a00, 0.28));
    // 右涡（亚欧板块下方，X≈+50）
    vortexGroup.add(createConvectionVortex(50, -40, 28, 10, 0xff4500, 0.24));
    // 中部涡旋（俯冲带下方热柱附近）
    vortexGroup.add(createConvectionVortex(8, -42, 18, 7, 0xff8c00, 0.18));
    root.add(vortexGroup);

    /* ===== 2. 岩石圈 — 海洋地壳（背面面板） ===== */
    // 背面用简单的剖面（不带俯冲带细节）
    const oceanProfileBack = sampleProfile(S.backZ, S.xMin, westShore0, 120, oceanFloorHeight);

    const oceanCrustBack = createSolidSection(oceanProfileBack, S.lithBottom, oceanCrustColorAt, {
        emissive: new THREE.Color(0x1a0d06), emissiveIntensity: 0.3,
    });
    oceanCrustBack.position.z = S.backZ - 0.04;
    root.add(oceanCrustBack);

    // 背面完整地壳剖面
    const fullProfileBack = sampleProfile(S.backZ, S.xMin, S.xMax, 300, terrainHeightAt);
    const fullCrustBack = createSolidSection(fullProfileBack, S.lithBottom, continentCrustColorAt, {
        emissive: new THREE.Color(0x1b1004), emissiveIntensity: 0.2,
    });
    fullCrustBack.position.z = S.backZ - 0.02;
    root.add(fullCrustBack);

    /* ===== 3. ★ 正面完整剖面板（包含俯冲带展示） ===== */
    const frontPanel = createFrontProfilePanel(textures);
    root.add(frontPanel);

    /* ===== 4. 海底顶面 3D 高度场（深海+浅海） ===== */
    const oceanFloorTop = createHeightField(
        S.xMin, S.indiaWestMeanX - 5, S.depth, 200, 96, oceanFloorHeight, oceanTopColorAt,
        { roughness: 0.98, metalness: 0.02, emissive: new THREE.Color(0x0f1726), emissiveIntensity: 0.16 }
    );
    root.add(oceanFloorTop);

    // 洋中脊发光
    const ridgeGlow = createGlowStrip(22, S.depth - 10, 0x6ad8ff, 0.16);
    ridgeGlow.rotation.x = -Math.PI * 0.5;
    ridgeGlow.position.set(S.ridgeX, oceanFloorHeight(S.ridgeX, 0) + 0.25, 0);
    root.add(ridgeGlow);

    // 海沟/浅海前缘发光
    const trenchGlow = createGlowStrip(16, S.depth - 10, 0x8fd6ff, 0.1);
    trenchGlow.rotation.x = -Math.PI * 0.5;
    trenchGlow.position.set(westShore0 - 6, oceanFloorHeight(westShore0 - 6, 0) + 0.22, 0);
    root.add(trenchGlow);

    /* ===== 5. 海水层（背面面板） ===== */
    // 背面海水
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

    /* ===== 6. 海湾（俯冲带上方S型小海湾） ===== */
    // 海湾水面
    const bayWater = createBayWaterSurface({
        emissive: new THREE.Color(0x0c3d66), emissiveIntensity: 0.5,
        normalMap: textures.waterNormalTex, normalScale: new THREE.Vector2(0.15, 0.15),
    });
    root.add(bayWater);

    // ★ 背面（z = backZ）海湾水体垂直剖面
    // 与正面剖面板的海湾水体对称，确保从背面看海湾有蓝色水体封面
    {
        const zBack = S.backZ;
        const eastShoreBack = indiaEastCoast(zBack);
        const bayEndBack    = eastShoreBack + 5.0;
        const segs = 40;

        const bayBackShape = new THREE.Shape();
        bayBackShape.moveTo(eastShoreBack, S.seaLevel);
        bayBackShape.lineTo(bayEndBack, S.seaLevel);
        // 沿海湾底从右到左
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
            vertexColors: true, transparent: true, opacity: 0.80,
            roughness: 0.62, metalness: 0.02,
            emissive: new THREE.Color(0x0c3d66), emissiveIntensity: 0.6,
            side: THREE.DoubleSide,
        }));
        bayBackMesh.position.z = zBack - 0.06;
        bayBackMesh.renderOrder = 6;
        root.add(bayBackMesh);
    }

    /* ===== 7. 印度板块陆地 3D 高度场 ===== */
    // 印度陆地范围：x从 indiaWestMeanX-15 到 indiaEastMeanX+30
    // 注意：indiaEastCoast(z) 最大可达约+20，bayEnd 最大可达约+25，
    // 需要右边界足够宽（+30）才能覆盖所有z值的海湾范围，避免缺口
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
            if (x >= east) return bayWaterColorAt(x, y, z);
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

    // ★ 印度板块高度场右端封边侧壁（沿Z轴，x=+30处的垂直切面）
    // 用带高度起伏的条带几何体，上边缘跟随地形，下边缘到lithBottom
    // 解决从斜视角看到高度场右侧黑洞的缺口问题
    {
        const wallX = S.indiaEastMeanX + 30;  // x=+30，indiaLandTop右侧边（扩展以覆盖完整海湾范围）
        const segZ = 80;
        const zStart = S.backZ;
        const zEnd   = S.frontZ;
        const posArr = [];
        const idxArr = [];
        const uvArr  = [];

        for (let i = 0; i <= segZ; i++) {
            const t  = i / segZ;
            const zv = mix(zStart, zEnd, t);
            // 上边缘：该位置的地形高度（印度陆地/海湾床，取较大值）
            const topY = terrainHeightAt(wallX, zv);
            // 下边缘：岩石圈底部
            const botY = S.lithBottom;
            posArr.push(wallX, topY, zv);   // 上
            posArr.push(wallX, botY, zv);   // 下
            uvArr.push(t, 1.0);  // 上
            uvArr.push(t, 0.0);  // 下
        }
        // 每个四边形由两个三角形组成
        for (let i = 0; i < segZ; i++) {
            const a = i * 2;      // 当前列上
            const b = i * 2 + 1;  // 当前列下
            const c = (i + 1) * 2;     // 下一列上
            const d = (i + 1) * 2 + 1; // 下一列下
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
        const wallMesh = new THREE.Mesh(wallGeo, wallMat);
        wallMesh.castShadow = true; wallMesh.receiveShadow = true;
        root.add(wallMesh);
    }

    /* ===== 8. 亚欧板块大陆 3D 高度场 ===== */
    const landGroup = new THREE.Group();
    landGroup.name = 'TectonicLandscapeLand';
    root.add(landGroup);

    // ★ 亚欧板块高度场：起始点从 eurasiaStartX-15（更靠左，覆盖S型边界变化区域）
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

    /* ===== 10. 侧壁封面 ===== */
    const leftOceanHeight = oceanFloorHeight(S.xMin, 0);
    root.add(createRockSideWall(S.xMin, leftOceanHeight, textures, 0x6d665e));
    root.add(createWaterSideWall(S.xMin, leftOceanHeight));

    const rightContinentHeight = continentHeight(S.xMax, 0);
    landGroup.add(createRockSideWall(S.xMax, rightContinentHeight, textures, 0x8b857d));

    root.add(createMantleSideWall(S.xMin));
    root.add(createMantleSideWall(S.xMax));

    /* ===== 11. 俯冲板片（3D斜插） ===== */
    const slabGroup = new THREE.Group();
    const slabMesh = buildSubductionSlab(S.depth - 6);
    slabGroup.add(slabMesh);

    const slabGlow = createGlowStrip(80, 8, 0xff7d2a, 0.18);
    slabGlow.rotation.set(0, 0, -0.42);
    slabGlow.position.set(35, -22, S.frontZ - 0.6);
    slabGroup.add(slabGlow);
    root.add(slabGroup);

    /* ===== 12. 岩浆上涌柱 ===== */
    const magmaColumn = new THREE.Mesh(
        new THREE.CylinderGeometry(4.5, 9, 20, 18, 1, true),
        new THREE.MeshBasicMaterial({
            color: 0xff7a30, transparent: true, opacity: 0.34,
            depthWrite: false, blending: THREE.AdditiveBlending,
        })
    );
    magmaColumn.position.set(55, -5, 0);
    root.add(magmaColumn);

    /* ===== 13. 方向箭头 ===== */

    // A类：洋中脊扩张箭头（生长边界，双向离散）
    const ridgeArrowsLeft = [];
    [
        { x: S.ridgeX - 15, y: S.seaLevel + 1.0, z: -22 },
        { x: S.ridgeX - 18, y: S.seaLevel + 0.8, z:   5 },
        { x: S.ridgeX - 13, y: S.seaLevel + 1.2, z:  26 },
    ].forEach(cfg => {
        const arrow = createArrowGlyph(0x90e0ff, -1, 1.1);
        arrow.position.set(cfg.x, cfg.y, cfg.z);
        root.add(arrow); ridgeArrowsLeft.push(arrow);
    });

    const ridgeArrowsRight = [];
    [
        { x: S.ridgeX + 15, y: S.seaLevel + 1.0, z: -18 },
        { x: S.ridgeX + 18, y: S.seaLevel + 0.8, z:   8 },
        { x: S.ridgeX + 13, y: S.seaLevel + 1.2, z:  28 },
    ].forEach(cfg => {
        const arrow = createArrowGlyph(0x90e0ff, +1, 1.1);
        arrow.position.set(cfg.x, cfg.y, cfg.z);
        root.add(arrow); ridgeArrowsRight.push(arrow);
    });

    // B类：印度洋板块运动箭头（向右→）—— 海洋区域 + 印度陆地区域各一排
    const oceanArrows = [];
    [
        { x: -55, y: S.seaLevel + 0.8, z: -18 },
        { x: -40, y: S.seaLevel + 0.6, z:   6 },
        { x: -22, y: S.seaLevel + 0.9, z:  22 },
    ].forEach(cfg => {
        const arrow = createArrowGlyph(0x5cc8ff, +1, 1.0);
        arrow.position.set(cfg.x, cfg.y, cfg.z);
        root.add(arrow); oceanArrows.push(arrow);
    });

    // C类：亚欧板块对冲箭头（向左←）
    const landArrows = [];
    [
        { x: 40,  z: -10 },
        { x: 80,  z:  14 },
    ].forEach(cfg => {
        const arrow = createArrowGlyph(0x5cc8ff, -1, 1.0);
        arrow.position.set(cfg.x, continentHeight(cfg.x, cfg.z) + 4, cfg.z);
        landGroup.add(arrow); landArrows.push(arrow);
    });

    /* ===== 生长边界专用视觉元素（初始隐藏）===== */
    const divergentGroup = new THREE.Group();
    divergentGroup.name = 'DivergentEffects';
    divergentGroup.visible = false;
    root.add(divergentGroup);

    // 1. 洋中脊裂谷核心发光带（裂谷中轴，橙红色岩浆）
    const riftCoreGlow = createGlowStrip(4, S.depth - 6, 0xff5500, 0.0);
    riftCoreGlow.rotation.x = -Math.PI * 0.5;
    riftCoreGlow.position.set(S.ridgeX, oceanFloorHeight(S.ridgeX, 0) + 1.2, 0);
    divergentGroup.add(riftCoreGlow);

    // 2. 裂谷外缘辉光（宽发光带，橙黄色）
    const riftOuterGlow = createGlowStrip(18, S.depth - 4, 0xff8c20, 0.0);
    riftOuterGlow.rotation.x = -Math.PI * 0.5;
    riftOuterGlow.position.set(S.ridgeX, oceanFloorHeight(S.ridgeX, 0) + 0.5, 0);
    divergentGroup.add(riftOuterGlow);

    // 3. 岩浆喷出柱（洋中脊上方，多个喷出点）
    const magmaVentsDiv = [];
    [
        { xOff: 0,    z:  -30, r: 3.5, h: 14, col: 0xff6a00, opa: 0.0 },
        { xOff: 1.5,  z:    4, r: 2.8, h: 12, col: 0xff4500, opa: 0.0 },
        { xOff: -1.0, z:   28, r: 3.0, h: 13, col: 0xff5500, opa: 0.0 },
        { xOff: 0.8,  z:  -12, r: 2.2, h: 10, col: 0xff7000, opa: 0.0 },
        { xOff: -0.5, z:   18, r: 2.5, h: 11, col: 0xff6000, opa: 0.0 },
    ].forEach(cfg => {
        const vent = new THREE.Mesh(
            new THREE.CylinderGeometry(cfg.r * 0.3, cfg.r, cfg.h, 12, 1, true),
            new THREE.MeshBasicMaterial({
                color: cfg.col, transparent: true, opacity: cfg.opa,
                depthWrite: false, blending: THREE.AdditiveBlending,
            })
        );
        const ridgeY = oceanFloorHeight(S.ridgeX + cfg.xOff, cfg.z);
        vent.position.set(S.ridgeX + cfg.xOff, ridgeY + cfg.h * 0.5, cfg.z);
        divergentGroup.add(vent);
        magmaVentsDiv.push({ mesh: vent, baseY: ridgeY, h: cfg.h, xOff: cfg.xOff, z: cfg.z });
    });

    // 4. 新洋壳向两侧"挤出"的发光板块（左右各一片，模拟新生洋壳）
    const newCrustLeft = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 2.5, S.depth - 12),
        new THREE.MeshBasicMaterial({
            color: 0xff7020, transparent: true, opacity: 0.0,
            depthWrite: false, blending: THREE.AdditiveBlending,
        })
    );
    newCrustLeft.position.set(S.ridgeX - 0.25, oceanFloorHeight(S.ridgeX, 0) - 0.5, 0);
    divergentGroup.add(newCrustLeft);

    const newCrustRight = newCrustLeft.clone();
    newCrustRight.position.set(S.ridgeX + 0.25, oceanFloorHeight(S.ridgeX, 0) - 0.5, 0);
    divergentGroup.add(newCrustRight);

    // 5. 裂谷两侧"地壳下沉"效果 —— 两侧板块逐渐向外偏移的组（左块/右块）
    const divergentLeftBlock = new THREE.Group();
    divergentLeftBlock.name = 'DivergentLeft';
    root.add(divergentLeftBlock);

    const divergentRightBlock = new THREE.Group();
    divergentRightBlock.name = 'DivergentRight';
    root.add(divergentRightBlock);

    // 6. 裂谷热液喷口发光粒子（用小球模拟热液柱）
    const hydroVents = [];
    [
        { xOff: -1.2, z: -24 },
        { xOff:  1.4, z:  10 },
        { xOff: -0.6, z:  34 },
    ].forEach(cfg => {
        const ventGlow = new THREE.Mesh(
            new THREE.SphereGeometry(1.8, 8, 8),
            new THREE.MeshBasicMaterial({
                color: 0x00e5ff, transparent: true, opacity: 0.0,
                depthWrite: false, blending: THREE.AdditiveBlending,
            })
        );
        const y = oceanFloorHeight(S.ridgeX + cfg.xOff, cfg.z);
        ventGlow.position.set(S.ridgeX + cfg.xOff, y + 1.5, cfg.z);
        divergentGroup.add(ventGlow);
        hydroVents.push({ mesh: ventGlow, baseY: y });
    });

    // 7. 裂谷扩张示意线（裂谷缝隙中轴线，前面板）
    const riftLinePoints = [];
    for (let i = 0; i <= 80; i++) {
        const t = i / 80;
        const z = S.frontZ + 0.4;
        const y = mix(S.mantleTop, oceanFloorHeight(S.ridgeX, 0) + 1.0, t);
        riftLinePoints.push(new THREE.Vector3(S.ridgeX, y, z));
    }
    const riftLineGeo = new THREE.BufferGeometry().setFromPoints(riftLinePoints);
    const riftLineMat = new THREE.LineBasicMaterial({
        color: 0xff6600, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false, linewidth: 2,
    });
    const riftLine = new THREE.Line(riftLineGeo, riftLineMat);
    divergentGroup.add(riftLine);

    // 8. 扩张速度标注箭头（更大更明显的左右扩张箭头，叠加在普通扩张箭头之上）
    const divArrowsLeft = [];
    [
        { x: S.ridgeX - 22, y: S.seaLevel + 2.0, z: -28 },
        { x: S.ridgeX - 26, y: S.seaLevel + 1.8, z:   0 },
        { x: S.ridgeX - 20, y: S.seaLevel + 2.2, z:  30 },
    ].forEach(cfg => {
        const arrow = createArrowGlyph(0xff9900, -1, 1.5);
        arrow.position.set(cfg.x, cfg.y, cfg.z);
        arrow.visible = false;
        divergentGroup.add(arrow);
        divArrowsLeft.push({ mesh: arrow, baseX: cfg.x, baseY: cfg.y });
    });

    const divArrowsRight = [];
    [
        { x: S.ridgeX + 22, y: S.seaLevel + 2.0, z: -22 },
        { x: S.ridgeX + 26, y: S.seaLevel + 1.8, z:   5 },
        { x: S.ridgeX + 20, y: S.seaLevel + 2.2, z:  32 },
    ].forEach(cfg => {
        const arrow = createArrowGlyph(0xff9900, +1, 1.5);
        arrow.position.set(cfg.x, cfg.y, cfg.z);
        arrow.visible = false;
        divergentGroup.add(arrow);
        divArrowsRight.push({ mesh: arrow, baseX: cfg.x, baseY: cfg.y });
    });

    /* ===== 14. 底部发光 ===== */
    const baseGlow = createGlowStrip(S.xMax - S.xMin + 18, 18, 0xff6d2e, 0.12);
    baseGlow.rotation.x = -Math.PI * 0.5;
    baseGlow.position.set((S.xMin + S.xMax) * 0.5, S.mantleBottom + 1.5, 0);
    root.add(baseGlow);

    /* ===== 锚点 ===== */
    const anchors = {
        ridge:         new THREE.Vector3(),
        shallowSea:    new THREE.Vector3(),
        india:         new THREE.Vector3(),
        eurasia:       new THREE.Vector3(),
        lithosphere:   new THREE.Vector3(),
        asthenosphere: new THREE.Vector3(),
        subduction:    new THREE.Vector3(),
        himalaya:      new THREE.Vector3(),
    };

    function getLandLocalY(x, z) { return continentHeight(x, z) * landGroup.scale.y; }
    function getLandWorldY(x, z)  { return landGroup.position.y + getLandLocalY(x, z); }

    function updateAnchors(progress) {
        anchors.india.set(-15, S.seaLevel + 10, -15);
        anchors.ridge.set(S.ridgeX + 6, oceanFloorHeight(S.ridgeX, -6) + 11, -8);
        anchors.shallowSea.set(-50, S.seaLevel + 8 + progress * 0.3, 5);
        anchors.eurasia.set(80, getLandWorldY(80, 16) + 13, 16);
        anchors.lithosphere.set(-60, -6, S.frontZ);
        anchors.asthenosphere.set(10, -42, S.frontZ);
        anchors.subduction.set(S.coastMeanX + 5 + progress * 2.5, -10 - progress * 1.8, S.frontZ);
        anchors.himalaya.set(45, getLandWorldY(45, 0) + 6, 0);
    }
    updateAnchors(0);

    return {
        update(progress, intensity, boundaryType) {
            const converge = boundaryType === 'convergent';
            const t = performance.now() * 0.001;  // 秒数，用于动态脉动

            /* ===============================================================
               消亡边界（convergent）逻辑
            =============================================================== */
            if (converge) {
                const pT = progress;
                const intensityGain = 0.76 + intensity * 0.18;
                const landScale = 0.99 + pT * 0.1 * intensityGain;

                // 大陆板块抬升
                landGroup.scale.y = landScale;
                landGroup.position.y = S.lithBottom * (1 - landScale) * 0.65;
                landGroup.position.x = pT * 1.2;
                mountainDetailMesh.scale.copy(landGroup.scale);
                mountainDetailMesh.position.copy(landGroup.position);
                snowCaps.scale.copy(landGroup.scale);
                snowCaps.position.copy(landGroup.position);

                // 俯冲板片
                slabGroup.visible = true;
                slabGroup.position.x = pT * 4.8;
                slabGroup.position.y = -pT * 2.5;
                slabGroup.rotation.z = -0.04 - pT * 0.08 * intensityGain;

                // 消亡边界岩浆柱
                magmaColumn.visible = true;
                magmaColumn.scale.y = 0.86 + pT * 0.34 * intensityGain;
                magmaColumn.material.opacity = 0.22 + pT * 0.16 + intensity * 0.03;

                // 水面
                waterSurface.material.opacity = 0.68 + intensity * 0.03;
                waterBack.material.opacity    = 0.42 + intensity * 0.03;
                shorelineFoam.material.opacity = 0.14 + pT * 0.08 + intensity * 0.02;

                // ★ 海湾（特提斯海）随时间演化逐渐消失
                // 地质逻辑：印度板块俯冲 → 特提斯海关闭 → 海湾消失 → 喜马拉雅隆起
                // progress 0.0~0.3：海湾完整存在（特提斯海）
                // progress 0.3~0.8：海湾逐渐缩小变窄（海水退缩）
                // progress 0.8~1.0：海湾完全消失（陆陆碰撞完成）
                {
                    const bayFade = 1.0 - Math.max(0, (pT - 0.30) / 0.55);  // 0.30开始消退，0.85完全消失
                    const bayOpacity = Math.max(0, Math.min(0.70, 0.70 * bayFade));
                    bayWater.material.opacity = bayOpacity;
                    bayWater.visible = bayOpacity > 0.01;
                    // 海湾水面随俯冲逐渐抬升（陆地将海湾挤压）
                    const bayLift = pT * 0.8 * (1.0 - bayFade);
                    bayWater.position.y = bayLift;
                }

                // 发光强度
                ridgeGlow.material.opacity  = 0.12 + intensity * 0.03;
                trenchGlow.material.opacity = 0.08 + pT * 0.07;
                mantleGlow.material.opacity = 0.2 + pT * 0.1 + intensity * 0.03;
                baseGlow.material.opacity   = 0.1 + intensity * 0.03;
                slabGlow.material.opacity   = 0.08 + pT * 0.1;

                // 消亡边界时显示普通扩张箭头，隐藏生长边界专属箭头
                ridgeArrowsLeft.forEach((arrow, idx) => {
                    arrow.visible = true;
                    arrow.position.y = S.seaLevel + 0.8 + Math.sin(t * 1.2 + idx) * 0.3;
                });
                ridgeArrowsRight.forEach((arrow, idx) => {
                    arrow.visible = true;
                    arrow.position.y = S.seaLevel + 0.8 + Math.sin(t * 1.2 + idx + 1) * 0.3;
                });

                // 印度洋板块向右运动箭头
                oceanArrows.forEach((arrow, index) => {
                    arrow.visible = true;
                    arrow.position.y = S.seaLevel + 0.6 + pT * 0.3 + index * 0.05;
                });

                // 亚欧板块对冲箭头随大陆抬升
                landArrows[0].position.y = getLandLocalY(40, -10) + 4;
                landArrows[1].position.y = getLandLocalY(80, 14) + 4;

                // 隐藏生长边界专用元素
                divergentGroup.visible = false;

                if (deps.magmaLight1) deps.magmaLight1.intensity = 6.2 + intensity * 0.8 + pT * 1.8;
                if (deps.magmaLight2) deps.magmaLight2.intensity = 4.2 + pT * 1.4;
                if (deps.subductionLight) deps.subductionLight.intensity = 3.0 + pT * 1.35;
                if (deps.bloomPass) {
                    deps.bloomPass.strength  = 0.28 + intensity * 0.08 + pT * 0.08;
                    deps.bloomPass.radius    = 0.82;
                    deps.bloomPass.threshold = 0.57;
                }

                updateAnchors(pT);

            /* ===============================================================
               生长边界（divergent）逻辑 —— 用 progress 驱动张裂演化
               阶段划分：
                 0.00 ~ 0.15  洋底裂解萌发，裂谷初现
                 0.15 ~ 0.40  中脊形成，岩浆上涌增强
                 0.40 ~ 0.70  洋壳扩张，两侧板块加速分离
                 0.70 ~ 1.00  稳定扩张，新洋壳持续生成
            =============================================================== */
            } else {
                const pD = progress;  // 0~1 生长边界进度
                const intensityGain = 0.76 + intensity * 0.18;

                // ── 消亡边界相关元素恢复静态/隐藏 ──
                landGroup.scale.y = 1.0;
                landGroup.position.y = 0;
                landGroup.position.x = 0;
                mountainDetailMesh.scale.copy(landGroup.scale);
                mountainDetailMesh.position.copy(landGroup.position);
                snowCaps.scale.copy(landGroup.scale);
                snowCaps.position.copy(landGroup.position);

                slabGroup.visible = false;
                magmaColumn.visible = false;

                // 消亡边界箭头隐藏（生长边界用专属箭头）
                oceanArrows.forEach(a => { a.visible = false; });
                // 普通洋中脊扩张箭头也隐藏，用生长边界专属大箭头替代
                ridgeArrowsLeft.forEach(a => { a.visible = false; });
                ridgeArrowsRight.forEach(a => { a.visible = false; });
                landArrows.forEach(a => { a.visible = false; });

                // ★ 生长边界模式下，海湾（特提斯海）完整保留
                bayWater.material.opacity = 0.70;
                bayWater.visible = true;
                bayWater.position.y = 0;

                // ── 显示生长边界专用元素 ──
                divergentGroup.visible = true;

                // 阶段分值（分四阶段渐进）
                const phase1 = smoothstep(0.0,  0.2,  pD);  // 裂解萌发
                const phase2 = smoothstep(0.15, 0.45, pD);  // 中脊形成
                const phase3 = smoothstep(0.4,  0.72, pD);  // 洋壳扩张
                const phase4 = smoothstep(0.68, 1.0,  pD);  // 稳定扩张

                // ─── 1. 裂谷核心发光 ───
                // 随阶段逐步增亮，并有脉动
                const riftPulse  = 0.85 + Math.sin(t * 2.8) * 0.15;
                const riftCore   = (phase1 * 0.15 + phase2 * 0.28 + phase3 * 0.20 + phase4 * 0.12) * intensityGain * riftPulse;
                const riftOuter  = (phase1 * 0.08 + phase2 * 0.18 + phase3 * 0.14 + phase4 * 0.10) * intensityGain * riftPulse;
                riftCoreGlow.material.opacity  = clamp(riftCore,  0, 0.75);
                riftOuterGlow.material.opacity = clamp(riftOuter, 0, 0.50);

                // 裂谷示意线
                riftLineMat.opacity = clamp(phase2 * 0.65 * intensityGain, 0, 0.7);

                // 洋中脊整体发光随裂解增强
                ridgeGlow.material.opacity = 0.12 + phase1 * 0.18 + phase2 * 0.26 + phase3 * 0.14
                    + Math.sin(t * 1.8) * 0.04 * phase2;

                // ─── 2. 岩浆喷出柱 ───
                magmaVentsDiv.forEach((vent, idx) => {
                    const stagger = idx * 0.08;  // 各喷口错开启动时机
                    const ventPhase = smoothstep(0.1 + stagger, 0.4 + stagger, pD);
                    const pulse = 0.82 + Math.sin(t * (1.6 + idx * 0.4) + idx * 1.3) * 0.18;
                    const targetOpa = clamp(ventPhase * (0.32 + phase3 * 0.18 + phase4 * 0.08) * intensityGain * pulse, 0, 0.65);
                    vent.mesh.material.opacity = targetOpa;
                    // 喷口随时间略微升高（岩浆上涌）
                    const ventLift = ventPhase * 2.5 * (0.9 + Math.sin(t * 1.1 + idx) * 0.1);
                    vent.mesh.position.y = vent.baseY + vent.h * 0.5 + ventLift;
                    vent.mesh.scale.y = 1.0 + ventPhase * 0.5 + Math.sin(t * 2.2 + idx) * 0.12 * ventPhase;
                });

                // ─── 3. 新洋壳侧向"挤出"光带 ───
                const crustBrightness = clamp(phase2 * 0.22 + phase3 * 0.18 + phase4 * 0.12, 0, 0.45)
                    * intensityGain * (0.9 + Math.sin(t * 1.5) * 0.1);
                newCrustLeft.material.opacity  = crustBrightness;
                newCrustRight.material.opacity = crustBrightness;
                // 新洋壳向两侧移动（模拟板块分离）
                const crustSpread = phase2 * 1.8 + phase3 * 2.5 + phase4 * 1.2;
                newCrustLeft.position.x  = S.ridgeX - 0.25 - crustSpread;
                newCrustRight.position.x = S.ridgeX + 0.25 + crustSpread;

                // ─── 4. 热液喷口（蓝白光球）───
                hydroVents.forEach((hv, idx) => {
                    const hvPhase = smoothstep(0.25 + idx * 0.12, 0.55 + idx * 0.1, pD);
                    const hvPulse = 0.8 + Math.sin(t * (2.4 + idx * 0.7) + idx * 2.1) * 0.2;
                    hv.mesh.material.opacity = clamp(hvPhase * 0.55 * intensityGain * hvPulse, 0, 0.65);
                    hv.mesh.position.y = hv.baseY + 1.5 + hvPhase * 2.5 + Math.sin(t * 1.8 + idx) * 0.4 * hvPhase;
                    hv.mesh.scale.setScalar(1.0 + hvPhase * 0.6 + Math.sin(t * 2.8 + idx) * 0.15 * hvPhase);
                });

                // ─── 5. 大型扩张箭头（橙色，沿海水面，更明显）───
                const arrowVis = phase1 > 0.1;
                divArrowsLeft.forEach((a, idx) => {
                    a.mesh.visible = arrowVis;
                    // 随阶段向外移动（板块分离）
                    const drift = phase2 * 8 + phase3 * 12 + phase4 * 8;
                    a.mesh.position.x = a.baseX - drift;
                    a.mesh.position.y = a.baseY + Math.sin(t * 1.3 + idx) * 0.4;
                    // 透明度脉动
                    const opacity = clamp(phase1 * 0.5 + phase2 * 0.4 + phase3 * 0.1, 0, 0.95);
                    a.mesh.children.forEach(child => {
                        if (child.material) child.material.opacity = opacity;
                    });
                });
                divArrowsRight.forEach((a, idx) => {
                    a.mesh.visible = arrowVis;
                    const drift = phase2 * 8 + phase3 * 12 + phase4 * 8;
                    a.mesh.position.x = a.baseX + drift;
                    a.mesh.position.y = a.baseY + Math.sin(t * 1.3 + idx + 1) * 0.4;
                    const opacity = clamp(phase1 * 0.5 + phase2 * 0.4 + phase3 * 0.1, 0, 0.95);
                    a.mesh.children.forEach(child => {
                        if (child.material) child.material.opacity = opacity;
                    });
                });

                // ─── 6. 水面、软流层、地幔 ───
                waterSurface.material.opacity = 0.68 + intensity * 0.02;
                waterBack.material.opacity    = 0.42 + intensity * 0.02;
                shorelineFoam.material.opacity = 0.14 + intensity * 0.02;
                trenchGlow.material.opacity    = 0.06;  // 消亡边界特有，生长边界减弱
                mantleGlow.material.opacity    = 0.22 + phase2 * 0.18 + phase3 * 0.10 + intensity * 0.03
                    + Math.sin(t * 1.4) * 0.04 * phase2;
                baseGlow.material.opacity      = 0.12 + phase1 * 0.04 + intensity * 0.03;

                // ─── 7. 灯光效果（洋中脊方向的岩浆光） ───
                if (deps.magmaLight2) {
                    // 洋中脊附近的发光增强（对应 magmaLight2 位置 X=-55）
                    deps.magmaLight2.intensity = 4.2 + phase2 * 4.5 + phase3 * 3.0
                        + Math.sin(t * 2.2) * 0.6 * phase2 * intensityGain;
                }
                if (deps.magmaLight1) {
                    // 俯冲带灯光（生长边界弱化）
                    deps.magmaLight1.intensity = 3.0 + intensity * 0.4;
                }
                if (deps.subductionLight) {
                    deps.subductionLight.intensity = 1.5 + phase2 * 2.5
                        + Math.sin(t * 3.0) * 0.4 * phase2 * intensityGain;
                }
                if (deps.bloomPass) {
                    // 生长边界开花效果随裂解增强
                    deps.bloomPass.strength  = 0.22 + phase2 * 0.22 + phase3 * 0.14 + intensity * 0.06
                        + Math.sin(t * 2.0) * 0.03 * phase2;
                    deps.bloomPass.radius    = 0.78 + phase3 * 0.12;
                    deps.bloomPass.threshold = 0.60 - phase2 * 0.08;
                }

                // ─── 8. 锚点（生长边界模式下调整部分标签位置）───
                updateAnchors(0.0);  // 消亡边界地形不变
            }
        },
        getAnchors() { return anchors; },
    };
}
