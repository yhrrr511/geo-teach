/**
 * EurasiaPlate.js - 亚欧板块 v6.0
 *
 * 重大升级（v6.0）：
 *   - MeshStandardMaterial + vertexColors + map 纹理（草地+岩石凹凸）
 *   - 光照驱动：roughness/metalness 真实 PBR 着色
 *   - 顶点颜色作为乘色器：低地棕色、植被绿色、裸岩灰色、雪顶白色
 *   - bumpMap（brick_bump.jpg）增加岩石凹凸感
 *   - 侧面 MeshStandardMaterial 地质截面分层
 *   - 底面 MeshStandardMaterial + emissive 发光
 *
 * 比例：1 单位 ≈ 200 km
 */

import * as THREE from 'three';
import {
    fbm,
    domainWarpedFBM,
    applyErosion,
    getTerrainColor,
    buildPlateSide,
    computeDetailedNormals,
} from './PlateGeometry.js';
// 纹理路径（相对于 index.html 所在的 geo-teach/ 目录）
const TEXTURE_BASE = './assets/textures';

// ══════════════════════════════════════════════════════════════
//  内联噪声工具函数（超高精细地形专用）
// ══════════════════════════════════════════════════════════════

/**
 * 多层 fBm 噪声（8 层叠加）
 */
function fbmInline(x, z, octaves = 8) {
    let val = 0, amp = 0.5, freq = 1.0, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
        val += amp * (
            Math.sin(x * freq * 0.08 + z * freq * 0.06) * 0.5 +
            Math.cos(x * freq * 0.05 - z * freq * 0.09) * 0.3 +
            Math.sin(x * freq * 0.11 + z * freq * 0.04) * 0.2
        );
        maxAmp += amp;
        amp  *= 0.5;
        freq *= 2.1;
    }
    return val / maxAmp;
}

/**
 * 域扭曲 fBm（增加不规则感）
 */
function domainWarpInline(x, z, warpStrength = 0.8) {
    const wx = fbmInline(x + 1.7, z + 9.2, 4) * warpStrength;
    const wz = fbmInline(x + 8.3, z + 2.8, 4) * warpStrength;
    return fbmInline(x + wx, z + wz, 7);
}

/**
 * 宽阔山脉（喜马拉雅风格）：位于板块中后部
 */
function ridgeNoise(nx, nz) {
    // 整个右侧形成一个宽阔的高原/山脉带
    const dx = nx - 0.7;
    const dz = nz - 0.5;
    
    // 主山脉走向，沿Z轴，X轴有一定的高斯分布
    const ridgeLine = Math.exp(-dx * dx / 0.04) * 0.8;
    
    // 次级山峰叠加
    const peaks = fbmInline(nx * 12.0, nz * 12.0, 4) * 0.4;
    
    // 边缘衰减
    const edgeFade = smoothstep(Math.max(0, 1 - Math.abs(nz - 0.5) * 2));
    
    return Math.min(1.0, (ridgeLine + peaks) * edgeFade);
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

/**
 * 峭壁生成：使用绝对值 + 锐化产生尖锐山脊线
 */
function cliffRidge(x, z, scale = 0.15) {
    let v = 0;
    for (let i = 1; i <= 4; i++) {
        const f  = i * scale;
        const raw = Math.sin(x * f * 1.3 + z * f * 0.8) *
                    Math.cos(x * f * 0.6 - z * f * 1.1);
        v += Math.abs(raw) / i;
    }
    return v;
}

// ══════════════════════════════════════════════════════════════
//  内部常量
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  新坐标系（适配 main.js 的 S 常量）：
//    X轴: +20(消亡边界/俯冲带) → +160(亚欧板块内陆)
//    Z轴: depth=112, -56 to +56
//  亚欧板块（大陆）覆盖范围: X=+20 到 X=+160，宽140，深112
//  板块中心: X = (20 + 160) / 2 = 90
// ══════════════════════════════════════════════════════════════

const PLATE_W  = 140;   // 从 oceanEnd(+20) 到 xMax(+160)，宽140
const PLATE_D  = 112;   // 匹配 main.js 的 S.depth
const SEGS_X   = 200;
const SEGS_Z   = 150;

// 板块中心 X = (20 + 160) / 2 = 90
const INIT_X   = 90;
const INIT_Y   = 0;
const INIT_Z   = 0;

const THICKNESS = 18;

// ══════════════════════════════════════════════════════════════
//  强度系数辅助函数
// ══════════════════════════════════════════════════════════════

function getIntensityParams(intensity) {
    if (intensity < 1.0) {
        return {
            speedFactor:     0.5,
            deformFactor:    0.6,
            mountainFactor:  0.6,
            quakeDensity:    0.3,
            lavaMultiplier:  0.4,
            subductionAngle: 0.12,
        };
    } else if (intensity < 2.0) {
        return {
            speedFactor:     1.0,
            deformFactor:    1.0,
            mountainFactor:  1.0,
            quakeDensity:    1.0,
            lavaMultiplier:  1.0,
            subductionAngle: 0.22,
        };
    } else {
        return {
            speedFactor:     1.8,
            deformFactor:    1.6,
            mountainFactor:  1.6,
            quakeDensity:    3.0,
            lavaMultiplier:  3.0,
            subductionAngle: 0.35,
        };
    }
}

// ══════════════════════════════════════════════════════════════
//  顶点颜色计算（MeshStandardMaterial + map 乘色模式）
//  vertexColors=true 时，顶点色会乘以 map 颜色
//  · 设白色(1,1,1) → 显示原始纹理颜色
//  · 设绿色 → 把纹理染绿（植被区）
//  · 设灰白 → 把纹理漂白（雪顶/裸岩区）
// ══════════════════════════════════════════════════════════════

/**
 * 根据高度、坡度和坐标计算顶点颜色
 * 高度范围已降至 0~18，颜色分层（从低到高）：
 *   y < 1        沙棕（平原/海岸）       (0.62, 0.45, 0.22)
 *   y 1-5        亮绿（低地植被）        (0.30, 0.62, 0.22)
 *   y 5-9        中绿（山地植被）        (0.20, 0.45, 0.15)
 *   y 9-12       灰绿混合（岩地过渡）     (0.32, 0.40, 0.22)
 *   y 12-15      灰棕裸岩               (0.52, 0.46, 0.35)
 *   y > 15       浅灰高山岩石+雪         (0.78, 0.76, 0.70)
 *   陡坡(>0.55)  深灰棕岩面（山封岩面）  (0.48, 0.42, 0.32)
 */
function getVertexColor(h, slope, x, z) {
    let r, g, b;

    // 雪线以上（y > 35）：纯白雪顶
    if (h > 35) {
        const t = Math.min(1.0, (h - 35) / 10.0);
        r = lerp(0.82, 0.96, t);
        g = lerp(0.80, 0.94, t);
        b = lerp(0.78, 0.96, t);
    }
    // 高山裸岩（y = 22 ~ 35）：灰白色岩石
    else if (h > 22) {
        const t = (h - 22) / 13.0;
        r = lerp(0.55, 0.82, t);
        g = lerp(0.50, 0.80, t);
        b = lerp(0.42, 0.78, t);
    }
    // 山地裸岩（y = 14 ~ 22）：深灰棕岩石
    else if (h > 14) {
        const t = (h - 14) / 8.0;
        r = lerp(0.40, 0.55, t);
        g = lerp(0.36, 0.50, t);
        b = lerp(0.28, 0.42, t);
    }
    // 山腰植被（y = 8 ~ 14）：深绿
    else if (h > 8) {
        const t = (h - 8) / 6.0;
        r = lerp(0.22, 0.40, t);
        g = lerp(0.48, 0.36, t);
        b = lerp(0.16, 0.28, t);
    }
    // 山麓植被（y = 3 ~ 8）：亮绿
    else if (h > 3) {
        const t = (h - 3) / 5.0;
        r = lerp(0.28, 0.22, t);
        g = lerp(0.58, 0.48, t);
        b = lerp(0.18, 0.16, t);
    }
    // 低地平原（y = 1 ~ 3）：草绿
    else if (h > 1) {
        const t = (h - 1) / 2.0;
        r = lerp(0.55, 0.28, t);
        g = lerp(0.48, 0.58, t);
        b = lerp(0.25, 0.18, t);
    }
    // 海岸/平原（y ≤ 1）：沙棕
    else {
        r = 0.58;
        g = 0.48;
        b = 0.25;
    }

    // 陡坡岩面（slope > 0.6 的近垂直面变成灰色岩石）
    if (slope > 0.6) {
        const cliffT = Math.min(1.0, (slope - 0.6) / 0.3);
        r = r * (1 - cliffT) + 0.45 * cliffT;
        g = g * (1 - cliffT) + 0.40 * cliffT;
        b = b * (1 - cliffT) + 0.32 * cliffT;
    }

    // 细微噪声
    const noise = (Math.sin(x * 0.9 + z * 1.2) * Math.cos(x * 1.4 - z * 0.8)) * 0.02;
    return [
        Math.max(0, Math.min(1, r + noise)),
        Math.max(0, Math.min(1, g + noise * 0.8)),
        Math.max(0, Math.min(1, b + noise * 0.5)),
    ];
}

function lerp(a, b, t) {
    return a + (b - a) * t;
}

function lerpColor(c0, c1, t) {
    return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
}

// ══════════════════════════════════════════════════════════════
//  主类
// ══════════════════════════════════════════════════════════════

export class EurasiaPlate {
    constructor(scene) {
        this.scene = scene;

        /** 顶层 Group（所有子对象均挂载在此） */
        this.group = new THREE.Group();
        this.group.name = 'EurasiaPlate';
        this.group.position.set(INIT_X, INIT_Y, INIT_Z);

        // ── 公共成员（供外部访问）──
        this.mesh           = null;
        this.mountainMesh   = null;
        this.himalayaGroup  = null;
        this.islandArcGroup = null;
        this.bottomMesh     = null;
        this.sideMesh       = null;

        /** 强度裂缝线（强强度专用） */
        this._crackLines = null;

        /** 保存初始顶点（用于形变恢复） */
        this._originalVertices = null;

        /** 共享纹理资源（主板块 + 岛弧复用） */
        this._grassTex = null;
        this._snowTex = null;
        this._rockTex = null;
        this._rockBump = null;
        this._rockRoughness = null;
        this._surfaceFlowArrows = [];

        // ── 加载纹理 ──
        this._loadTextures();

        // ── 构建所有几何体 ──
        this._buildMainPlate();
        this._buildPlateBottom();
        this._buildGeologicalSides();
        this._buildIslandArc();

        scene.add(this.group);
    }

    // ──────────────────────────────────────────────────────────
    //  纹理加载（相对于 geo-teach/index.html）
    //  所有运行依赖都收拢到 geo-teach/assets/ 目录，便于本地直接打开
    // ──────────────────────────────────────────────────────────

    _loadTextures() {
        const loader = new THREE.TextureLoader();

        // 草地纹理（低地/植被区 map）
        const grassTex = loader.load('./assets/textures/terrain/grasslight-big.jpg');
        grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
        grassTex.repeat.set(10, 6);
        this._grassTex = grassTex;

        const snowTex = loader.load('./assets/textures/ambientcg/Ice002_1K-JPG_Color.jpg');
        snowTex.wrapS = snowTex.wrapT = THREE.RepeatWrapping;
        snowTex.repeat.set(4, 3);
        this._snowTex = snowTex;

        // 岩石漫反射（砖块纹理模拟裸岩）
        const rockTex = loader.load('./assets/textures/brick_diffuse.jpg');
        rockTex.wrapS = rockTex.wrapT = THREE.RepeatWrapping;
        rockTex.repeat.set(16, 10);
        this._rockTex = rockTex;

        // 岩石凹凸（bump map 增加立体感）
        const rockBump = loader.load('./assets/textures/brick_bump.jpg');
        rockBump.wrapS = rockBump.wrapT = THREE.RepeatWrapping;
        rockBump.repeat.set(16, 10);
        this._rockBump = rockBump;

        const rockRoughness = loader.load(`${TEXTURE_BASE}/brick_roughness.jpg`);
        rockRoughness.wrapS = rockRoughness.wrapT = THREE.RepeatWrapping;
        rockRoughness.repeat.set(16, 10);
        this._rockRoughness = rockRoughness;
    }

    // ──────────────────────────────────────────────────────────
    //  主板块几何体（超高精细地形 + 真实 PBR 材质）
    // ──────────────────────────────────────────────────────────

    _buildMainPlate() {
        const segsX = SEGS_X, segsZ = SEGS_Z;
        const geo = new THREE.PlaneGeometry(PLATE_W, PLATE_D, segsX, segsZ);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

        const pos   = geo.getAttribute('position');
        const arr   = pos.array;
        const vertW = segsX + 1;
        const vertH = segsZ + 1;
        const count = vertW * vertH;

        // ── 1. 超高精细高度图生成 ──
        const heightMap = new Float32Array(count);

        for (let vi = 0; vi < vertH; vi++) {
            for (let ui = 0; ui < vertW; ui++) {
                const idx = vi * vertW + ui;
                const x   = arr[idx * 3];
                const z   = arr[idx * 3 + 2];

                const nx = (x / PLATE_W) + 0.5;
                const nz = (z / PLATE_D) + 0.5;

                // ══════════════════════════════════════════════════════
                // 全新地形算法 v7.0 —— 严格对照设计稿
                //
                // nx: 0=左侧(碰撞边界/海湾), 1=右侧(内陆)
                //
                // 区域划分（对照设计稿）：
                //   nx 0.00 ~ 0.12 : 碰撞边缘悬崖（轻微隆起，不是主山脉）
                //   nx 0.12 ~ 0.55 : 喜马拉雅主山脉（极高、极尖锐的锥形单峰）
                //   nx 0.55 ~ 1.00 : 亚欧内陆平原（起伏平原，高度适中）
                //
                // ★★★ 关键：山脉在 nx=0.25~0.30 处达到峰值（板块偏左1/4处）
                //           山顶必须尖锐——使用 sharpCrest 幂函数
                // ══════════════════════════════════════════════════════

                // ──────────────────────────────────────────────────────
                // 区域 A：碰撞边缘悬崖（nx = 0 ~ 0.12）
                // 轻微隆起 + 陡峭悬崖壁，高度约 4~8 单位（不超过10）
                // ──────────────────────────────────────────────────────
                const collisionCliff = Math.exp(-Math.pow((nx - 0.04) / 0.035, 2)) * 7.0;

                // ──────────────────────────────────────────────────────
                // 区域 B：喜马拉雅主山脉（nx = 0.12 ~ 0.55）
                //
                // 山脉设计：
                //   • 山脊线 X 方向：高斯分布，中心在 nx=0.28
                //   • 沿 Z 轴连续延伸（整个板块深度方向）
                //   • 山顶极尖锐：使用 pow(rawHeight, 0.25) + sharpRidge
                //   • 最大高度：32 单位（产生雪顶）
                //   • 山脉左侧（向悬崖方向）快速陡降
                //   • 山脉右侧（向内陆方向）缓慢下降至高原
                // ──────────────────────────────────────────────────────

                // ══════════════════════════════════════════════════════
                // ★★★ 真正的锥形山峰算法 ★★★
                //
                // 核心思路：
                //   山峰高度 H(x, z) = peakHeightAtZ(z) × crossProfile(nx)
                //
                //   1. peakHeightAtZ(z)：沿山脊线（Z方向）的高度包络
                //      → 用一串"帐篷函数/三角形"产生多个离散山峰，各峰有不同高度
                //      → 这样从上面看是一串山峰，从侧面看是锯齿状山顶
                //
                //   2. crossProfile(nx)：垂直于山脊方向（X方向）的剖面
                //      → 山脊中心（nx=ridgeCenter）为最高点 = 1.0
                //      → 向左（海湾方向）急速陡降（悬崖）
                //      → 向右（内陆方向）缓慢下降（缓坡）
                //      → 这保证任何 nx≠ridgeCenter 的点都低于山脊
                //
                //   关键：不能再用 clamp(ridgeMask, 0, 1) 乘以 PEAK_HEIGHT
                //   因为 ridgeMask=1 时所有山脊点都是最大高度，形成平台
                //   正确做法：让 peakHeightAtZ 决定每处山脊的实际高度（有高有低）
                // ══════════════════════════════════════════════════════

                // ── 步骤1：Z轴方向的山峰高度包络 ──
                // 用多个三角形/锥形叠加，产生一串高低不同的山峰
                // 每个山峰是一个"帐篷函数"：在峰顶 z=zPeak 时最高，向两侧线性/幂次下降
                const PEAK_HEIGHT = 32.0;  // 最高山峰高度

                // 定义沿Z轴（nz: 0~1）分布的主山峰群
                // 每个峰：center（峰顶nz位置），height（该峰相对高度0~1），width（峰宽度）
                const peaks = [
                    { center: 0.18, height: 0.68, width: 0.12 },  // 后侧次峰
                    { center: 0.32, height: 0.95, width: 0.10 },  // 主峰（最高）
                    { center: 0.46, height: 0.82, width: 0.11 },  // 中段次峰
                    { center: 0.60, height: 0.72, width: 0.09 },  // 前段次峰
                    { center: 0.74, height: 0.55, width: 0.10 },  // 前侧小峰
                ];

                // 每个锥形峰：dist/width → 三角形，用幂函数控制尖锐度
                // peakShape(t) = max(0, 1 - t)^sharpness，t=归一化距离
                let peakHeightAtZ = 0;
                for (const pk of peaks) {
                    const dist = Math.abs(nz - pk.center) / pk.width;
                    if (dist < 1.5) {
                        // dist=0时 = pk.height，dist=1时 = 0（线性下降后接幂次锐化）
                        // pow 让山顶更尖（power > 1 → 锐化），山脚平缓
                        const shape = Math.max(0, 1.0 - dist);
                        // power=1.5 → 轻度锐化（不要过尖，保持山峰宽度）
                        peakHeightAtZ += pk.height * Math.pow(shape, 1.4);
                    }
                }
                // 加入小幅噪声，使峰顶不完全对称（自然感）
                const ridgeNoise = fbmInline(nz * 18.0, nx * 4.0, 4) * 0.08;
                peakHeightAtZ = Math.min(1.0, peakHeightAtZ + ridgeNoise * 0.5);

                // ── 步骤2：X轴方向的山脊剖面（横截面形状）──
                // 山脊中心 nx=ridgeCenter，向两侧下降
                const ridgeCenter = 0.28;
                // 左侧（海湾方向）：更陡，sigma小 → 悬崖
                const sigmaLeft  = 0.07;
                // 右侧（内陆方向）：更缓，sigma大 → 宽缓坡
                const sigmaRight = 0.16;

                const dNx = nx - ridgeCenter;
                const crossSigma = dNx < 0 ? sigmaLeft : sigmaRight;
                // 高斯截面：在山脊中心 = 1.0，向两侧衰减
                const crossProfile = Math.exp(-Math.pow(dNx / crossSigma, 2));

                // Z两端衰减（板块边缘）
                const ridgeZfade = 1.0 - Math.pow(Math.abs(nz - 0.5) * 2.2, 4.0) * 0.5;

                // ── 步骤3：合并得到最终山峰高度 ──
                // H = PEAK_HEIGHT × peakHeightAtZ(Z方向高低) × crossProfile(X方向剖面) × ridgeZfade(边缘衰减)
                // 关键：两者都是 0~1 的乘法，任何 dNx≠0 的点都会低于山脊线
                // 山脊线上（crossProfile=1）的高度 = PEAK_HEIGHT × peakHeightAtZ
                // 这使山脊线本身就是锯齿状起伏，而不是等高平台
                const mountainH = PEAK_HEIGHT * peakHeightAtZ * crossProfile * ridgeZfade;

                // ──────────────────────────────────────────────────────
                // 区域 C：亚欧内陆平原（nx = 0.55 ~ 1.0）
                // 有起伏的平原，高度 3~10 单位
                // ──────────────────────────────────────────────────────
                const plainBase = Math.max(0, (nx - 0.08) * 8.0) * 0.7;
                const plainRoll1 = fbmInline(x * 0.04,  z * 0.03,  5) * 2.8;
                const plainRoll2 = fbmInline(x * 0.08 + 3.1, z * 0.06 - 2.3, 4) * 1.6;
                const plainWave  = Math.sin(x * 0.045 + z * 0.03) * 1.2
                                 + Math.cos(x * 0.03  - z * 0.05) * 0.9;
                const plainH     = Math.max(2.0, plainBase + plainRoll1 * 0.5 + plainRoll2 * 0.4
                                         + plainWave * 0.5);

                // ──────────────────────────────────────────────────────
                // 融合三个区域
                // ──────────────────────────────────────────────────────
                // 山脉区域权重（nx=0.12~0.55，中心在0.28）
                const inMountainZone = Math.max(0, Math.min(1,
                    (nx - 0.08) / 0.08)) *               // 左侧过渡（0.08~0.16）
                    (1.0 - Math.max(0, Math.min(1, (nx - 0.50) / 0.12)));  // 右侧过渡（0.50~0.62）

                // 基础地形 = 平原（内陆部分）
                const baseLand = plainH;

                // 最终高度：平原 + 山脉叠加（山脉区域权重控制过渡）
                let h = lerp(baseLand, mountainH, inMountainZone);

                // 叠加碰撞边缘悬崖（始终叠加，但幅度不超过山脉）
                h += collisionCliff * (1.0 - inMountainZone * 0.8);

                // Z 轴边缘软化（防止板块边缘出界）
                const edgeZ = Math.abs(z) - PLATE_D * 0.44;
                if (edgeZ > 0) h -= edgeZ * 0.35;

                // 右侧内陆下降（防止右边太高）
                const rightDrop = Math.max(0, (nx - 0.85) / 0.15) * 4.0;
                h -= rightDrop;

                heightMap[idx] = Math.max(-1, h);
            }
        }

        // ── 2. 写回 position buffer ──
        for (let idx = 0; idx < count; idx++) {
            arr[idx * 3 + 1] = heightMap[idx];
        }
        pos.needsUpdate = true;

        // ── 3. 计算坡度并生成顶点色 ──
        geo.computeVertexNormals();
        const normals = geo.getAttribute('normal');
        const normArr = normals.array;
        const colors  = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const h     = arr[i * 3 + 1];
            const ny    = Math.abs(normArr[i * 3 + 1]);
            const slope = 1.0 - ny;

            const [r, g, b] = getVertexColor(h, slope, arr[i * 3], arr[i * 3 + 2]);
            colors[i * 3]     = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // ── 4. 保存原始顶点 ──
        this._originalVertices = new Float32Array(arr);

        // ── 5. MeshStandardMaterial（PBR + 纹理 + 顶点颜色乘色）──
        //   以草地纹理作为陆地底色，避免雪面贴图把整个大陆压暗成黑色
        const mat = new THREE.MeshStandardMaterial({
            map:          this._grassTex || this._rockTex || this._snowTex,
            bumpMap:      this._rockBump,
            roughnessMap: this._rockRoughness,
            bumpScale:    0.52,
            roughness:    0.98,
            metalness:    0.02,
            vertexColors: true,
            side:         THREE.FrontSide,
        });

        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.castShadow    = true;
        this.mesh.receiveShadow = true;
        this.mesh.name = 'EurasiaPlate_Terrain';
        this.group.add(this.mesh);

        // 兼容旧 API
        this.mountainMesh  = this.group;
        this.himalayaGroup = this.group;

        // ── 6. 发光边缘线 + 地表运动箭头 ──
        this._buildEdgeGlow();
        this._buildSurfaceFlowArrows();
    }

    _buildEdgeGlow() {
        const pts = [];
        for (let a = 0; a <= Math.PI * 2; a += Math.PI / 36) {
            pts.push(new THREE.Vector3(
                Math.cos(a) * (PLATE_W * 0.504) * (0.93 + Math.sin(a * 4) * 0.07),
                -0.4,
                Math.sin(a) * (PLATE_D * 0.504) * (0.93 + Math.cos(a * 3) * 0.07)
            ));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color:       0xffa940,
            transparent: true,
            opacity:     0.72,
        });
        const line = new THREE.Line(geo, mat);
        line.name = 'EurasiaPlate_EdgeGlow';
        this.group.add(line);
    }

    _buildSurfaceFlowArrows() {
        const arrowPositions = [
            { x: -28, y: 8, z: -18, sx: 7.2 },
            { x: 8, y: 10, z: -2, sx: 8.2 },
            { x: 34, y: 16, z: 14, sx: 9.0 },
        ];

        for (const def of arrowPositions) {
            const shape = new THREE.Shape();
            shape.moveTo(-def.sx, -1.7);
            shape.lineTo(def.sx * 0.15, -1.7);
            shape.lineTo(def.sx * 0.15, -3.1);
            shape.lineTo(def.sx, 0);
            shape.lineTo(def.sx * 0.15, 3.1);
            shape.lineTo(def.sx * 0.15, 1.7);
            shape.lineTo(-def.sx, 1.7);
            shape.closePath();

            const geo = new THREE.ShapeGeometry(shape);
            const mat = new THREE.MeshBasicMaterial({
                color: new THREE.Color(0x7eeeff),
                transparent: true,
                opacity: 0.75,
                side: THREE.DoubleSide,
                depthWrite: false,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.z = -0.22;
            mesh.position.set(def.x, def.y, def.z);
            mesh.userData = { baseX: def.x, baseY: def.y, phase: Math.random() * Math.PI * 2 };
            this.group.add(mesh);
            this._surfaceFlowArrows.push(mesh);
        }
    }

    // ──────────────────────────────────────────────────────────
    //  地质侧面（截面分层 MeshStandardMaterial）
    // ──────────────────────────────────────────────────────────

    _buildGeologicalSides() {
        const pos   = this.mesh.geometry.getAttribute('position');
        const arr   = pos.array;
        const vertW = SEGS_X + 1, vertH = SEGS_Z + 1;

        // 侧面分层颜色（从上到下，地质截面）
        const LAYER_COLORS = [
            [0.35, 0.55, 0.20],   // 顶层：绿色植被（土壤+植被）
            [0.42, 0.32, 0.20],   // 浅岩石：灰棕
            [0.25, 0.20, 0.15],   // 中岩石：深灰棕
            [0.32, 0.12, 0.06],   // 下地壳：棕红
            [0.55, 0.18, 0.02],   // 底部：橙红（岩石圈底）
        ];

        const collectEdge = (indices) => indices.map(idx => ({
            x: arr[idx * 3],
            y: arr[idx * 3 + 1],
            z: arr[idx * 3 + 2],
            origIdx: idx
        }));

        const bottomEdge = [];
        for (let i = 0; i < vertW; i++) {
            bottomEdge.push((vertH - 1) * vertW + i);
        }

        const rightEdge = [];
        for (let j = vertH - 1; j >= 0; j--) {
            rightEdge.push(j * vertW + (vertW - 1));
        }

        const topEdge = [];
        for (let i = vertW - 1; i >= 0; i--) {
            topEdge.push(i);
        }

        const leftEdge = [];
        for (let j = 0; j < vertH; j++) {
            leftEdge.push(j * vertW);
        }

        // 只保留面向镜头的前侧剖面，去掉其余三个挡板。
        const edgeSets = [
            { name: 'Side_South', indices: bottomEdge },
        ];

        this._crustSides = [];
        for (const { name, indices } of edgeSets) {
            const sampledIndices = indices.filter((_, i) => i % 4 === 0);
            if (sampledIndices.length < 2) continue;

            const profile = collectEdge(sampledIndices);
            const sideMesh = this._buildGeologicalSidePanel(
                profile,
                LAYER_COLORS,
                THICKNESS
            );
            if (sideMesh) {
                sideMesh.name = `EurasiaPlate_${name}`;
                this.group.add(sideMesh);
                if (!this.sideMesh) this.sideMesh = sideMesh;
                this._crustSides.push({ mesh: sideMesh, profile });
            }
        }
    }

    /**
     * 构建单个地质侧面板（MeshStandardMaterial + vertexColors）
     */
    _buildGeologicalSidePanel(topProfile, layerColors, depth) {
        if (topProfile.length < 2) return null;

        const n       = topProfile.length;
        const nLayers = layerColors.length;
        const layerH  = depth / (nLayers - 1);

        const verts  = [];
        const colArr = [];
        const idxArr = [];

        for (let li = 0; li < nLayers; li++) {
            const t    = li / (nLayers - 1);
            const yOff = -t * depth;
            const lc   = layerColors[li];

            for (let ni = 0; ni < n; ni++) {
                const pt = topProfile[ni];
                verts.push(pt.x, pt.y + yOff, pt.z);
                // 底层增加橙红亮度（模拟岩浆热辐射）
                const boost = li === nLayers - 1 ? 1.4 : 1.0;
                colArr.push(
                    Math.min(1, lc[0] * boost),
                    Math.min(1, lc[1] * boost),
                    Math.min(1, lc[2] * boost)
                );
            }
        }

        for (let li = 0; li < nLayers - 1; li++) {
            for (let ni = 0; ni < n - 1; ni++) {
                const a = li * n + ni;
                const b = li * n + ni + 1;
                const c = (li + 1) * n + ni;
                const d = (li + 1) * n + ni + 1;
                idxArr.push(a, c, b);
                idxArr.push(b, c, d);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('color',    new THREE.Float32BufferAttribute(colArr, 3));
        geo.setIndex(idxArr);
        geo.computeVertexNormals();

        // MeshStandardMaterial：vertexColors 驱动地质分层颜色，支持光照
        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness:    0.85,
            metalness:    0.05,
            side:         THREE.DoubleSide,
        });

        return new THREE.Mesh(geo, mat);
    }

    // ──────────────────────────────────────────────────────────
    //  板块底面（岩石圈底部，MeshStandardMaterial + emissive 发光）
    // ──────────────────────────────────────────────────────────

    _buildPlateBottom() {
        const geo = new THREE.PlaneGeometry(PLATE_W + 6, PLATE_D + 6, 32, 24);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2));

        const pos = geo.getAttribute('position');
        const arr = pos.array;

        for (let i = 0; i < arr.length; i += 3) {
            const bx = arr[i], bz = arr[i + 2];
            arr[i + 1] = -THICKNESS + fbmInline(bx * 0.06, bz * 0.06, 4) * 0.9 - 0.5;
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        // MeshStandardMaterial + emissive：橙红底部发光（岩石圈底部热辐射）
        this.bottomMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            color:             new THREE.Color(0.55, 0.20, 0.05),
            roughness:         0.75,
            metalness:         0.05,
            emissive:          new THREE.Color(0.15, 0.04, 0.0),
            emissiveIntensity: 0.5,
            side:              THREE.DoubleSide,
        }));
        this.bottomMesh.name = 'EurasiaPlate_Bottom';
        this.group.add(this.bottomMesh);
    }

    // ──────────────────────────────────────────────────────────
    //  东亚岛弧（MeshStandardMaterial + 草地纹理）
    // ──────────────────────────────────────────────────────────

    _buildIslandArc() {
        const arcGroup = new THREE.Group();
        arcGroup.name    = 'IslandArcs';
        arcGroup.visible = false;

        const islands = [
            { x: 63, z: -8,   r: 2.6, h: 5.0 },
            { x: 61, z: -3.5, r: 3.4, h: 5.5 },
            { x: 59, z:  1.0, r: 2.4, h: 4.0 },
            { x: 59, z:  4.5, r: 2.9, h: 4.5 },
            { x: 55, z: 12.0, r: 3.6, h: 4.2 },
            { x: 50, z: 16.0, r: 2.6, h: 3.2 },
            { x: 44, z: 18.0, r: 5.2, h: 3.8 },
            { x: 35, z: 20.0, r: 4.8, h: 3.4 },
        ];

        for (const isl of islands) {
            const geo = new THREE.SphereGeometry(isl.r, 14, 9, 0, Math.PI * 2, 0, Math.PI * 0.55);
            // MeshStandardMaterial + 草地纹理，支持光照
            const mat = new THREE.MeshStandardMaterial({
                color:     new THREE.Color(0.22, 0.50, 0.12),
                map:       this._grassTex,
                roughness: 0.85,
                metalness: 0.0,
            });
            const m = new THREE.Mesh(geo, mat);
            m.castShadow    = true;
            m.receiveShadow = true;
            const ty = (isl.h / isl.r) * 0.52;
            m.position.set(isl.x, isl.h * 0.25, isl.z);
            m.scale.set(1, 0, 1);
            m.userData.targetScaleY = ty;
            arcGroup.add(m);
        }

        this.islandArcGroup = arcGroup;
        this.group.add(arcGroup);
    }

    // ══════════════════════════════════════════════════════════
    //  动画更新
    // ══════════════════════════════════════════════════════════

    updateConvergent(time, intensity, clock) {
        const p = getIntensityParams(intensity);

        this._updateBottomGlow(intensity, time);
        this._deformCollisionFront(time, intensity, clock, p);

        if (this.islandArcGroup) {
            const arcP = Math.max(0, (time - 0.20) / 0.60);
            this.islandArcGroup.visible = arcP > 0.01;
            this.islandArcGroup.children.forEach((m, idx) => {
                const delay = idx * 0.04;
                const lp    = Math.max(0, arcP - delay);
                const ty    = (m.userData.targetScaleY || 0.8) * Math.min(1.2, p.mountainFactor);
                m.scale.y   = Math.min(ty, lp * ty * 2.8);
                m.scale.x   = m.scale.z = 0.55 + Math.min(0.45, lp * 2.2);
            });
        }

        this._updateSurfaceFlowArrows(time, clock);

        if (intensity >= 2.0) {
            this._updateCrackLines(time, clock, p);
        }
    }

    resetToInitial() {
        this.group.position.set(INIT_X, INIT_Y, INIT_Z);
        this.group.rotation.set(0, 0, 0);

        if (this.islandArcGroup) {
            this.islandArcGroup.visible = false;
            this.islandArcGroup.children.forEach(m => {
                m.scale.y = 0;
                m.scale.x = m.scale.z = 0.55;
            });
        }

        if (this._originalVertices && this.mesh) {
            const posAttr = this.mesh.geometry.getAttribute('position');
            posAttr.array.set(this._originalVertices);
            posAttr.needsUpdate = true;
            this.mesh.geometry.computeVertexNormals();
        }

        if (this._crackLines) this._crackLines.visible = false;

        if (this.bottomMesh) {
            // MeshStandardMaterial：通过 emissive + color 重置
            this.bottomMesh.material.color.setRGB(0.55, 0.20, 0.05);
            this.bottomMesh.material.emissiveIntensity = 0.5;
        }

        for (const arrow of this._surfaceFlowArrows) {
            arrow.material.opacity = 0.0;
            arrow.position.x = arrow.userData.baseX;
            arrow.position.y = arrow.userData.baseY;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  内部形变方法
    // ══════════════════════════════════════════════════════════

    _deformCollisionFront(time, intensity, clock, params) {
        if (!this._originalVertices || !this.mesh || time < 0.08) return;

        const pos  = this.mesh.geometry.getAttribute('position');
        const arr  = pos.array;
        const orig = this._originalVertices;

        const strength = Math.min(1.4 * params.deformFactor, intensity * 0.45) *
                         Math.max(0, time - 0.08);

        for (let i = 0; i < arr.length; i += 3) {
            const x = orig[i];
            const z = orig[i + 2];

            const frontFactor = Math.max(0, 1 - (x + PLATE_W * 0.5) / (PLATE_W * 0.60));

            const fold = Math.sin(z * 0.16 + clock * 1.6) *
                         Math.cos(x * 0.10 + clock * 1.0) *
                         strength * frontFactor;

            const quake = params.quakeDensity > 1
                ? Math.sin(x * 0.07 + clock * (7 + params.quakeDensity)) * 0.10 * strength
                : 0;

            arr[i + 1] = orig[i + 1] + fold + quake;
        }
        pos.needsUpdate = true;
        this.mesh.geometry.computeVertexNormals();

        // Update crust side panels
        if (this._crustSides) {
            for (const cs of this._crustSides) {
                const crustPos = cs.mesh.geometry.getAttribute('position');
                const crustArr = crustPos.array;
                const n = cs.profile.length;
                const nLayers = 5; // Eurasia has 5 layers
                const depth = THICKNESS;
                
                for (let li = 0; li < nLayers; li++) {
                    const t = li / (nLayers - 1);
                    const yOff = -t * depth;
                    for (let i = 0; i < n; i++) {
                        const pt = cs.profile[i];
                        const newY = arr[pt.origIdx * 3 + 1];
                        crustArr[(li * n + i) * 3 + 1] = newY + yOff;
                    }
                }
                crustPos.needsUpdate = true;
            }
        }
    }

    /**
     * 底面发光动态控制（MeshStandardMaterial → emissiveIntensity）
     */
    _updateBottomGlow(intensity, time) {
        if (!this.bottomMesh) return;
        const brightFactor = 0.8 + intensity * 0.45 + time * 0.2;
        this.bottomMesh.material.emissiveIntensity = Math.min(1.8, brightFactor);
    }

    _updateSurfaceFlowArrows(time, clock) {
        if (!this._surfaceFlowArrows.length) return;

        const progress = Math.max(0, Math.min(1, (time - 0.04) / 0.36));
        for (const arrow of this._surfaceFlowArrows) {
            arrow.material.opacity = progress * (0.55 + Math.sin(clock * 1.6 + arrow.userData.phase) * 0.2);
            arrow.position.x = arrow.userData.baseX - time * 5.5;
            arrow.position.y = arrow.userData.baseY + Math.sin(clock * 1.2 + arrow.userData.phase) * 0.35;
        }
    }

    /**
     * 强强度裂缝发光线
     */
    _updateCrackLines(time, clock, params) {
        if (!this._crackLines) {
            const pts    = [];
            const xEdge  = -PLATE_W * 0.45;
            const zRange = PLATE_D * 0.40;
            const segCnt = 42;
            for (let i = 0; i < segCnt; i++) {
                const z0  = (Math.random() - 0.5) * zRange * 2;
                const len = 1.5 + Math.random() * 3.0;
                const y0  = fbmInline(z0 * 0.25, i * 0.65, 3) * 3;
                pts.push(
                    new THREE.Vector3(xEdge,              y0,       z0),
                    new THREE.Vector3(xEdge + len * 0.45, y0 + len * 0.55, z0 + (Math.random() - 0.5) * 2)
                );
            }
            const cGeo = new THREE.BufferGeometry().setFromPoints(pts);
            const cMat = new THREE.LineBasicMaterial({
                color:       0xff4400,
                transparent: true,
                opacity:     0.0,
            });
            this._crackLines = new THREE.LineSegments(cGeo, cMat);
            this._crackLines.name = 'CrackLines';
            this.group.add(this._crackLines);
        }

        this._crackLines.visible = time > 0.3;
        if (this._crackLines.visible) {
            const pulse  = 0.4 + Math.sin(clock * 5.5) * 0.35;
            this._crackLines.material.opacity = pulse * Math.min(1, (time - 0.3) * 3);
            const r = Math.min(1, 0.80 + params.lavaMultiplier * 0.06);
            const g = Math.max(0, 0.18 - params.lavaMultiplier * 0.03);
            this._crackLines.material.color.setRGB(r, g, 0);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  公共 API
    // ══════════════════════════════════════════════════════════

    getCenter() { return this.group.position.clone(); }

    getEastBoundaryWorldX() { return this.group.position.x + PLATE_W * 0.498; }
}
