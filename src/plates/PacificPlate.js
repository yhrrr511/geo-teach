/**
 * PacificPlate.js - 太平洋板块 v6.0
 *
 * 高精细度海洋板块地质截面效果：
 *   - 地形分辨率 200x140 段
 *   - 精细海底地形：深海平原、洋中脊（橙红岩浆）、俯冲斜坡
 *   - 顶点着色：洋中脊橙红 / 浅海深蓝灰 / 深海近黑蓝 / 俯冲带暗蓝黑
 *   - Water.js 真实水面（反射 + 法线波纹），备选 MeshStandardMaterial normalMap
 *   - 洋中脊发光 mesh（橙红脉冲）
 *   - 侧面地质截面分层：海水蓝 → 沉积层浅棕 → 玄武岩深灰 → 地幔橙红
 *   - 底面岩石圈发光（MeshStandardMaterial emissive）
 *
 * 比例：1 单位 ≈ 200 km
 */

import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import {
    fbm,
    domainWarpedFBM,
    applyErosion,
    getTerrainColor,
    buildPlateSide,
} from './PlateGeometry.js';

// ══════════════════════════════════════════════════════════════
//  内联噪声工具（不依赖 PlateGeometry.js 限制，海底地形专用）
// ══════════════════════════════════════════════════════════════

/**
 * 海底多层 fBm 噪声（内联定义，6 层叠加）
 */
function fbmSea(x, z, octaves = 6) {
    let val = 0, amp = 0.5, freq = 1.0, max = 0;
    for (let i = 0; i < octaves; i++) {
        val += amp * Math.sin(x * freq * 0.06 + z * freq * 0.08 + i * 1.3)
                   * Math.cos(z * freq * 0.05 - x * freq * 0.04 + i * 0.7);
        max += amp;
        amp  *= 0.5;
        freq *= 2.0;
    }
    return val / max;
}

/**
 * 洋中脊高度函数
 */
function ridgeHeight(nx) {
    const ridgeCenter = 0.38;
    const d = Math.abs(nx - ridgeCenter);
    return Math.max(0, 1 - d / 0.08) * 6;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(t) { return t * t * (3 - 2 * t); }

// ══════════════════════════════════════════════════════════════
//  内部常量
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
//  新坐标系（适配 main.js 的 S 常量）：
//    X轴: -140(深海左缘) → -90(洋中脊) → +20(消亡边界/俯冲带)
//    Z轴: depth=112, -56 to +56
//  印度洋板块（海洋）覆盖范围: X=-140 到 X=+20，宽160，深112
//  板块中心: X = (-140+20)/2 = -60
// ══════════════════════════════════════════════════════════════

const PLATE_W   = 160;   // 从 xMin(-140) 到 oceanEnd(+20)，宽160
const PLATE_D   = 112;   // 匹配 main.js 的 S.depth
const SEGS_X    = 200;
const SEGS_Z    = 140;

// 板块中心 X = (-140 + 20) / 2 = -60
const INIT_X    = -60;
const INIT_Y    = 0;
const INIT_Z    = 0;

const THICKNESS = 6;

// 洋中脊在世界坐标 X=-90；板块中心INIT_X=-60，板块左边界=-60-80=-140
// 洋中脊局部坐标 = ridgeX - INIT_X = -90 - (-60) = -30
const RIDGE_X_LOCAL = -30;

// ══════════════════════════════════════════════════════════════
//  顶点着色系统（海底地形）- 改为更真实的深海配色
// ══════════════════════════════════════════════════════════════

/**
 * 根据高度、X 位置（归一化）以及世界坐标计算海底顶点颜色
 * 配色改为更真实：洋中脊亮橙红 / 海底深蓝灰 / 深海近黑蓝
 */
function getSeafloorColor(h, nx, x, z) {
    let r, g, b;

    // 洋中脊顶部（h > -1）：亮橙红，有发光感
    if (h > -1) {
        const t = Math.max(0, (h + 1) / 1.5);
        if (t > 0.85) {
            const coreT = (t - 0.85) / 0.15;
            r = lerp(0.95, 1.0, coreT);
            g = lerp(0.35, 0.55, coreT);
            b = lerp(0.02, 0.08, coreT);
        } else {
            r = lerp(0.65, 0.95, t);
            g = lerp(0.18, 0.35, t);
            b = lerp(0.02, 0.04, t);
        }
        return [r, g, b];
    }

    // 洋中脊侧翼（-3 to -1）：暗红橙
    if (h > -3 && nx > 0.28 && nx < 0.52) {
        const t = (h + 3) / 2;
        r = lerp(0.20, 0.65, t);
        g = lerp(0.05, 0.18, t);
        b = lerp(0.01, 0.02, t);
        return [r, g, b];
    }

    // 浅海区（nx > 0.6）：明亮蓝色（靠近大陆浅海）
    if (h > -5 && nx > 0.6) {
        r = 0.04;
        g = 0.18;
        b = 0.55;
    }
    // 海底平原（-6 to -3）：深蓝灰
    else if (h > -6) {
        const t = (h + 6) / 3;
        r = lerp(0.05, 0.08, t);
        g = lerp(0.09, 0.12, t);
        b = lerp(0.22, 0.28, t);
    }
    // 深海（< -6）：近黑蓝
    else if (h > -10) {
        const t = (h + 10) / 4;
        r = lerp(0.02, 0.05, t);
        g = lerp(0.04, 0.09, t);
        b = lerp(0.12, 0.22, t);
    }
    // 超深区：近黑蓝底色
    else {
        r = 0.03;
        g = 0.05;
        b = 0.15;
    }

    // 程序化网格纹理（更细微，亮度叠加 0.08）
    const gridX = Math.pow(Math.abs(Math.sin(x * 0.8)), 12) * 0.25;
    const gridZ = Math.pow(Math.abs(Math.sin(z * 0.8)), 12) * 0.25;
    const grid  = gridX + gridZ;
    r = Math.min(1.0, r + grid * 0.02);
    g = Math.min(1.0, g + grid * 0.04);
    b = Math.min(1.0, b + grid * 0.08);

    return [r, g, b];
}

// ══════════════════════════════════════════════════════════════
//  强度系数
// ══════════════════════════════════════════════════════════════

function getIntensityParams(intensity) {
    if (intensity < 1.0) {
        return {
            speedFactor:     0.5,
            deformFactor:    0.6,
            quakeDensity:    0.3,
            lavaMultiplier:  0.4,
            subductionAngle: 0.12,
            ridgePulse:      0.3,
        };
    } else if (intensity < 2.0) {
        return {
            speedFactor:     1.0,
            deformFactor:    1.0,
            quakeDensity:    1.0,
            lavaMultiplier:  1.0,
            subductionAngle: 0.24,
            ridgePulse:      0.6,
        };
    } else {
        return {
            speedFactor:     1.8,
            deformFactor:    1.6,
            quakeDensity:    3.0,
            lavaMultiplier:  3.0,
            subductionAngle: 0.42,
            ridgePulse:      1.0,
        };
    }
}

// ══════════════════════════════════════════════════════════════
//  主类
// ══════════════════════════════════════════════════════════════

export class PacificPlate {
    constructor(scene) {
        this.scene = scene;

        /** 顶层 Group */
        this.group = new THREE.Group();
        this.group.name = 'PacificPlate';
        this.group.position.set(INIT_X, INIT_Y, INIT_Z);

        // 公共成员
        this.mesh           = null;  // 主海底地形 Mesh
        this.waterMesh      = null;  // 海水层（Water.js 或备选）
        this._useWaterJs    = false; // 是否成功使用 Water.js
        this.ridgeGlowMesh  = null;  // 洋中脊发光面
        this.bottomMesh     = null;  // 板块底面
        this.sideMesh       = null;  // 板块侧面（截面）

        /** 兼容旧 API */
        this.trenchGroup   = null;
        this.seamountGroup = null;

        this._originalGroupX = INIT_X;
        this._originalGroupY = INIT_Y;
        this._originalVertices = null;
        this._crackLines = null;
        this._waterFlowTexture = null;
        this._foamOverlay = null;

        // 构建所有几何体
        this._buildSeafloor();
        this._buildWaterLayer();
        this._buildRidgeGlow();
        this._buildGeologicalSides();
        this._buildPlateBottom();
        this._buildEdgeGlow();

        scene.add(this.group);
    }

    // ──────────────────────────────────────────────────────────
    //  海底地形（高分辨率 + 程序化地质截面着色）
    //  改为 MeshStandardMaterial 以配合光照 + emissive
    // ──────────────────────────────────────────────────────────

    _buildSeafloor() {
        const geo = new THREE.PlaneGeometry(PLATE_W, PLATE_D, SEGS_X, SEGS_Z);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

        const pos   = geo.getAttribute('position');
        const arr   = pos.array;
        const vertW = SEGS_X + 1;
        const vertH = SEGS_Z + 1;
        const count = vertW * vertH;

        // ── 1. 高度图生成 ──
        for (let vi = 0; vi < vertH; vi++) {
            for (let ui = 0; ui < vertW; ui++) {
                const idx = vi * vertW + ui;
                const x   = arr[idx * 3];
                const z   = arr[idx * 3 + 2];

                const nx = (x / PLATE_W) + 0.5;

                let h;

                if (nx < 0.33) {
                    const basin = nx / 0.33;
                    const base = lerp(-10.8, -8.2, basin);
                    const detail = fbmSea(x * 0.92, z * 0.85, 6) * 1.8;
                    h = base + detail;
                } else if (nx < 0.48) {
                    const ridgeBlend = (nx - 0.33) / 0.15;
                    const ridgeCore = ridgeHeight(nx) * 1.15;
                    const base = lerp(-8.0, -2.6, ridgeBlend);
                    const detail = fbmSea(x * 0.72, z * 0.9, 5) * 0.95;
                    h = base + ridgeCore + detail;
                } else if (nx < 0.72) {
                    const shelf = (nx - 0.48) / 0.24;
                    const terrace = Math.sin(shelf * Math.PI) * 0.9;
                    const base = lerp(-3.8, -6.5, shelf);
                    const detail = fbmSea(x * 0.85, z, 6) * 1.2;
                    h = base + terrace + detail;
                } else {
                    const st = (nx - 0.72) / 0.28;
                    const trenchShape = Math.pow(st, 1.55);
                    const base = lerp(-6.8, -15.5, trenchShape);
                    const detail = fbmSea(x * 1.05, z * 1.1, 6) * (0.9 - st * 0.28);
                    const trenchLip = Math.exp(-Math.pow((nx - 0.77) / 0.055, 2)) * 2.2;
                    h = base + detail - trenchLip;
                }

                // 边缘软化
                const edgeX = Math.abs(x) - PLATE_W * 0.46;
                const edgeZ = Math.abs(z) - PLATE_D * 0.45;
                if (edgeX > 0) h -= edgeX * 0.18;
                if (edgeZ > 0) h -= edgeZ * 0.18;

                arr[idx * 3 + 1] = Math.max(-13, Math.min(1.0, h));
            }
        }
        pos.needsUpdate = true;

        // ── 2. 顶点着色 ──
        geo.computeVertexNormals();
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const x  = arr[i * 3];
            const h  = arr[i * 3 + 1];
            const nx = (x / PLATE_W) + 0.5;
            const z  = arr[i * 3 + 2];
            const [r, g, b] = getSeafloorColor(h, nx, x, z);
            colors[i * 3]     = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        // ── 3. 保存初始顶点 ──
        this._originalVertices = new Float32Array(arr);

        // ── 4. 改为 MeshStandardMaterial，支持光照与 emissive ──
        const mat = new THREE.MeshStandardMaterial({
            vertexColors:       true,
            roughness:          0.92,
            metalness:          0.05,
            emissive:           new THREE.Color(0.02, 0.04, 0.08),
            emissiveIntensity:  0.2,
            side:               THREE.FrontSide,
        });

        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.receiveShadow = false;
        this.mesh.castShadow    = false;
        this.mesh.name = 'PacificPlate_Seafloor';
        this.group.add(this.mesh);
    }

    // ──────────────────────────────────────────────────────────
    //  海水层 - 使用 Water.js 真实水面
    //  Water.js 的 geometry 需要是 XY 平面，通过 rotation.x = -PI/2 放平
    // ──────────────────────────────────────────────────────────

    _buildWaterLayer() {
        // Water.js 需要 XY 平面 geometry（不旋转 geometry）
        const geo = new THREE.PlaneGeometry(PLATE_W, PLATE_D);

        try {
            const textureLoader = new THREE.TextureLoader();
            // 优先使用 water 目录下的法线图，备选 waternormals.jpg
            const waterNormals = textureLoader.load(
                './assets/textures/water/Water_1_M_Normal.jpg',
                undefined,
                undefined,
                () => {
                    // 加载失败时尝试备用路径（已静默处理）
                }
            );
            waterNormals.wrapS = waterNormals.wrapT = THREE.RepeatWrapping;

            const waterFlow = textureLoader.load('./assets/textures/water/Water_1_M_Flow.jpg');
            waterFlow.wrapS = waterFlow.wrapT = THREE.RepeatWrapping;
            waterFlow.repeat.set(4, 2.5);
            this._waterFlowTexture = waterFlow;

            this.waterMesh = new Water(geo, {
                textureWidth:   1024,
                textureHeight:  1024,
                waterNormals:   waterNormals,
                sunDirection:   new THREE.Vector3(0.78, 0.92, 0.34).normalize(),
                sunColor:       0xffffff,
                waterColor:     0x0a5fc8,
                distortionScale: 3.8,
                fog:            false,
                alpha:          0.96,
            });

            // Water.js 默认是 XY 平面，需要旋转到水平 XZ 平面
            this.waterMesh.rotation.x = -Math.PI / 2;
            this.waterMesh.position.y = 2.35;
            this.waterMesh.name = 'PacificPlate_Water';
            this._useWaterJs = true;
            this.group.add(this.waterMesh);
            this._buildFoamOverlay();

        } catch (e) {
            console.warn('[PacificPlate] Water.js 初始化失败，使用备选方案:', e);
            this._buildWaterLayerFallback(geo);
        }
    }

    /**
     * 备选水面方案：MeshStandardMaterial + normalMap 模拟
     */
    _buildWaterLayerFallback(geo) {
        // 旋转 geometry 到 XZ 平面
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

        const textureLoader = new THREE.TextureLoader();
        const waterNormal = textureLoader.load('./assets/textures/water/Water_1_M_Normal.jpg');
        waterNormal.wrapS = waterNormal.wrapT = THREE.RepeatWrapping;
        waterNormal.repeat.set(6, 4);

        this._waterFlowTexture = textureLoader.load('./assets/textures/water/Water_1_M_Flow.jpg');
        this._waterFlowTexture.wrapS = this._waterFlowTexture.wrapT = THREE.RepeatWrapping;
        this._waterFlowTexture.repeat.set(4, 2.5);

        const mat = new THREE.MeshStandardMaterial({
            color:       new THREE.Color(0.02, 0.16, 0.52),
            normalMap:   waterNormal,
            normalScale: new THREE.Vector2(0.95, 0.7),
            roughness:   0.08,
            metalness:   0.72,
            transparent: true,
            opacity:     0.86,
            side:        THREE.DoubleSide,
            depthWrite:  false,
        });

        this.waterMesh = new THREE.Mesh(geo, mat);
        this.waterMesh.position.y = 2.35;
        this.waterMesh.name = 'PacificPlate_Water';
        this._useWaterJs = false;
        this.group.add(this.waterMesh);
        this._buildFoamOverlay();
    }

    _buildFoamOverlay() {
        const geo = new THREE.PlaneGeometry(PLATE_W, PLATE_D, 1, 1);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

        const textureLoader = new THREE.TextureLoader();
        const foamTex = textureLoader.load('./assets/textures/lava/cloud.png');
        foamTex.wrapS = foamTex.wrapT = THREE.RepeatWrapping;
        foamTex.repeat.set(4.5, 2.8);

        const mat = new THREE.MeshBasicMaterial({
            map: foamTex,
            color: new THREE.Color(0xa7ecff),
            transparent: true,
            opacity: 0.24,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide,
        });

        this._foamOverlay = new THREE.Mesh(geo, mat);
        this._foamOverlay.position.y = 2.55;
        this._foamOverlay.name = 'PacificPlate_FoamOverlay';
        this.group.add(this._foamOverlay);
    }

    // ──────────────────────────────────────────────────────────
    //  洋中脊发光面（半透明橙红脉冲）- 改为 MeshStandardMaterial
    // ──────────────────────────────────────────────────────────

    _buildRidgeGlow() {
        const ridgeLen   = PLATE_D * 0.82;
        const ridgeWidth = 5.0;
        const geo = new THREE.PlaneGeometry(ridgeWidth, ridgeLen, 10, 50);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

        const pos = geo.getAttribute('position');
        const arr = pos.array;
        for (let i = 0; i < arr.length; i += 3) {
            const x = arr[i], z = arr[i + 2];
            arr[i + 1] = -0.5 + fbmSea(x * 0.5, z * 0.07, 4) * 1.8;
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            color:             new THREE.Color(1.0, 0.54, 0.10),
            emissive:          new THREE.Color(1.0, 0.30, 0.02),
            emissiveIntensity: 1.8,
            transparent:       true,
            opacity:           0.85,
            side:              THREE.DoubleSide,
            depthWrite:        false,
        });

        this.ridgeGlowMesh = new THREE.Mesh(geo, mat);
        this.ridgeGlowMesh.position.set(RIDGE_X_LOCAL, 0, 0);
        this.ridgeGlowMesh.name = 'PacificPlate_RidgeGlow';
        this.group.add(this.ridgeGlowMesh);
    }

    // ──────────────────────────────────────────────────────────
    //  地质侧面截面 - 改为 MeshStandardMaterial
    // ──────────────────────────────────────────────────────────

    _buildGeologicalSides() {
        const pos   = this.mesh.geometry.getAttribute('position');
        const arr   = pos.array;
        const vertW = SEGS_X + 1;
        const vertH = SEGS_Z + 1;

        // 地质截面分层颜色（MeshStandardMaterial 顶点色）
        const LAYER_COLORS = [
            [0.38, 0.28, 0.18],   // 沉积层灰棕 (Removed 海水蓝层 from crust)
            [0.18, 0.15, 0.12],   // 玄武岩暗灰
            [0.30, 0.10, 0.05],   // 下地壳棕红
            [0.60, 0.20, 0.02],   // 地幔橙红
        ];

        const collectEdge = (indices) => indices.map(idx => ({
            x: arr[idx * 3],
            y: arr[idx * 3 + 1],
            z: arr[idx * 3 + 2],
            origIdx: idx
        }));

        const bottomIdxs = [];
        for (let i = 0; i < vertW; i++) {
            bottomIdxs.push((vertH - 1) * vertW + i);
        }
        const rightIdxs = [];
        for (let j = vertH - 1; j >= 0; j--) {
            rightIdxs.push(j * vertW + (vertW - 1));
        }
        const topIdxs = [];
        for (let i = vertW - 1; i >= 0; i--) {
            topIdxs.push(i);
        }
        const leftIdxs = [];
        for (let j = 0; j < vertH; j++) {
            leftIdxs.push(j * vertW);
        }

        const edgeSets = [
            { name: 'Side_South', indices: bottomIdxs },
            { name: 'Side_East',  indices: rightIdxs  },
            { name: 'Side_North', indices: topIdxs    },
            { name: 'Side_West',  indices: leftIdxs   },
        ];

        this._crustSides = [];
        for (const { name, indices } of edgeSets) {
            const sampled = indices.filter((_, i) => i % 3 === 0);
            if (sampled.length < 2) continue;

            const profile = collectEdge(sampled);
            const sideMesh = this._buildSidePanel(profile, LAYER_COLORS, THICKNESS);
            if (sideMesh) {
                sideMesh.name = `PacificPlate_${name}`;
                if (!this.sideMesh) this.sideMesh = sideMesh;
                this.group.add(sideMesh);
                this._crustSides.push({ mesh: sideMesh, profile });
            }
            
            // Build water volume side panel
            const waterMesh = this._buildWaterSidePanel(profile);
            if (waterMesh) {
                waterMesh.name = `PacificPlate_Water_${name}`;
                this.group.add(waterMesh);
                // Save water side mesh to update later
                if (!this._waterSides) this._waterSides = [];
                this._waterSides.push({ mesh: waterMesh, profile });
            }
        }
    }

    _buildWaterSidePanel(profile) {
        if (profile.length < 2) return null;
        const n = profile.length;
        const verts = [];
        const idxArr = [];
        
        // 2 layers: top (sea level), bottom (sea floor)
        for (let i = 0; i < n; i++) {
            const pt = profile[i];
            verts.push(pt.x, 2.35, pt.z); // Top
        }
        for (let i = 0; i < n; i++) {
            const pt = profile[i];
            verts.push(pt.x, pt.y, pt.z); // Bottom
        }
        
        for (let i = 0; i < n - 1; i++) {
            const a = i;
            const b = i + 1;
            const c = n + i;
            const d = n + i + 1;
            idxArr.push(a, c, b);
            idxArr.push(b, c, d);
        }
        
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setIndex(idxArr);
        geo.computeVertexNormals();
        
        const mat = new THREE.MeshBasicMaterial({
            color: 0x0a5fc8,
            transparent: true,
            opacity: 0.65,
            side: THREE.DoubleSide,
            depthWrite: false,
        });
        
        return new THREE.Mesh(geo, mat);
    }

    /**
     * 构建地质截面侧面板 - MeshStandardMaterial
     */
    _buildSidePanel(topProfile, layerColors, depth) {
        if (topProfile.length < 2) return null;

        const n       = topProfile.length;
        const nLayers = layerColors.length;

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

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness:    0.80,
            metalness:    0.08,
            side:         THREE.DoubleSide,
        });

        return new THREE.Mesh(geo, mat);
    }

    // ──────────────────────────────────────────────────────────
    //  板块底面（岩石圈底）- 改为 MeshStandardMaterial + emissive
    // ──────────────────────────────────────────────────────────

    _buildPlateBottom() {
        const geo = new THREE.PlaneGeometry(PLATE_W + 4, PLATE_D + 4, 30, 22);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI / 2)); // 朝下

        const pos = geo.getAttribute('position');
        const arr = pos.array;

        for (let i = 0; i < arr.length; i += 3) {
            const bx = arr[i], bz = arr[i + 2];
            arr[i + 1] = -THICKNESS - 4 + fbmSea(bx * 0.04, bz * 0.04, 4) * 0.7;
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            color:             new THREE.Color(0.50, 0.15, 0.02),
            emissive:          new THREE.Color(0.2, 0.05, 0.0),
            emissiveIntensity: 0.6,
            roughness:         0.75,
            metalness:         0.08,
            side:              THREE.DoubleSide,
        });

        this.bottomMesh = new THREE.Mesh(geo, mat);
        this.bottomMesh.name = 'PacificPlate_Bottom';
        this.group.add(this.bottomMesh);
    }

    // ──────────────────────────────────────────────────────────
    //  边缘发光线
    // ──────────────────────────────────────────────────────────

    _buildEdgeGlow() {
        const pts = [];
        for (let a = 0; a <= Math.PI * 2; a += Math.PI / 28) {
            pts.push(new THREE.Vector3(
                Math.cos(a) * (PLATE_W * 0.505),
                -0.5,
                Math.sin(a) * (PLATE_D * 0.505)
            ));
        }
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({
            color:       0x0066dd,
            transparent: true,
            opacity:     0.55,
        });
        const line = new THREE.Line(geo, mat);
        line.name = 'PacificPlate_EdgeGlow';
        this.group.add(line);
    }

    // ══════════════════════════════════════════════════════════
    //  动画更新
    // ══════════════════════════════════════════════════════════

    /**
     * 碰撞（汇聚）边界动画 - 俯冲动画
     */
    updateConvergent(time, intensity, clock) {
        const p        = getIntensityParams(intensity);
        const subStart = 0.08;
        const progress = Math.max(0, (time - subStart) / (1 - subStart));
        const spd      = progress * intensity * p.speedFactor;

        this.group.position.x = this._originalGroupX + spd * 78;
        this.group.rotation.z = -spd * p.subductionAngle;
        this.group.position.y = this._originalGroupY - spd * 22 * 0.28 * p.deformFactor;

        this._deformSubductionFront(progress, intensity, clock, p);

        // 水面更新
        this._updateWaterWave(clock, progress);

        this._updateRidgeGlow(clock, progress, p);
        this._updateBottomGlow(intensity, progress);

        if (intensity >= 2.0 && progress > 0.2) {
            const wave = Math.sin(clock * (6 + p.quakeDensity) + progress * 10)
                       * 0.25 * progress * (intensity - 0.9) * p.deformFactor;
            if (this.mesh) this.mesh.position.y = wave;
            this._updateCrackLines(progress, clock, p);
        }
    }

    /**
     * 张裂（发散）边界动画
     */
    updateDivergent(time, intensity, clock) {
        const p        = getIntensityParams(intensity);
        const progress = Math.max(0, (time - 0.1) / 0.8);

        this.group.position.x = this._originalGroupX - progress * intensity * p.speedFactor * 50;
        this.group.position.y = this._originalGroupY + Math.sin(clock * 1.1) * 1.0 * progress;
        this.group.rotation.z = 0;

        if (this._originalVertices && this.mesh) {
            const posAttr = this.mesh.geometry.getAttribute('position');
            posAttr.array.set(this._originalVertices);
            posAttr.needsUpdate = true;
        }

        this._updateWaterWave(clock, progress);
        this._updateRidgeGlow(clock, progress * 1.6, p);
        this._updateBottomGlow(intensity * 0.5, progress);
    }

    /**
     * 重置到初始状态
     */
    resetToInitial() {
        this.group.position.set(this._originalGroupX, this._originalGroupY, 0);
        this.group.rotation.set(0, 0, 0);

        if (this.mesh) this.mesh.position.y = 0;

        if (this._originalVertices && this.mesh) {
            const posAttr = this.mesh.geometry.getAttribute('position');
            posAttr.array.set(this._originalVertices);
            posAttr.needsUpdate = true;
            this.mesh.geometry.computeVertexNormals();
        }

        if (this._crackLines) this._crackLines.visible = false;

        // MeshStandardMaterial - 重置 emissiveIntensity
        if (this.bottomMesh && this.bottomMesh.material) {
            this.bottomMesh.material.emissiveIntensity = 0.6;
        }

        if (this.ridgeGlowMesh && this.ridgeGlowMesh.material) {
            this.ridgeGlowMesh.material.opacity           = 0.65;
            this.ridgeGlowMesh.material.emissiveIntensity = 1.2;
        }
    }

    // ══════════════════════════════════════════════════════════
    //  内部形变 & 动画方法
    // ══════════════════════════════════════════════════════════

    _deformSubductionFront(progress, intensity, clock, params) {
        if (!this._originalVertices || !this.mesh || progress < 0.05) return;

        const pos  = this.mesh.geometry.getAttribute('position');
        const arr  = pos.array;
        const orig = this._originalVertices;

        for (let i = 0; i < arr.length; i += 3) {
            const x      = orig[i];
            const nx     = (x / PLATE_W) + 0.5;
            const frontT = Math.max(0, (nx - 0.60) / 0.40);

            if (frontT < 0.01) {
                arr[i + 1] = orig[i + 1];
                continue;
            }

            const sink      = smoothstep(frontT);
            const sinkDepth = sink * progress * intensity * 10 * params.deformFactor;

            const quake = params.quakeDensity > 1
                ? Math.sin(x * 0.14 + clock * 7) * 0.07 * progress * params.deformFactor
                : 0;

            arr[i + 1] = orig[i + 1] - sinkDepth + quake;
        }
        pos.needsUpdate = true;
        this.mesh.geometry.computeVertexNormals();
        
        // Update water side panels
        if (this._waterSides) {
            for (const ws of this._waterSides) {
                const waterPos = ws.mesh.geometry.getAttribute('position');
                const waterArr = waterPos.array;
                const n = ws.profile.length;
                for (let i = 0; i < n; i++) {
                    const pt = ws.profile[i];
                    // Bottom vertices are in the second half of the buffer
                    waterArr[(n + i) * 3 + 1] = arr[pt.origIdx * 3 + 1];
                }
                waterPos.needsUpdate = true;
            }
        }

        // Update crust side panels
        if (this._crustSides) {
            for (const cs of this._crustSides) {
                const crustPos = cs.mesh.geometry.getAttribute('position');
                const crustArr = crustPos.array;
                const n = cs.profile.length;
                const nLayers = 4; // We have 4 colors now!
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
     * 水面动态更新
     * - Water.js：更新 time uniform
     * - 备选方案：更新 normalMap repeat（模拟流动效果）
     */
    _updateWaterWave(clock, progress) {
        if (!this.waterMesh) return;

        if (this._useWaterJs) {
            // Water.js 通过 time uniform 驱动波纹动画
            if (this.waterMesh.material && this.waterMesh.material.uniforms &&
                this.waterMesh.material.uniforms['time']) {
                this.waterMesh.material.uniforms['time'].value += 1.0 / 60.0;
            }
        } else {
            // 备选方案：通过位移顶点实现波纹
            const pos = this.waterMesh.geometry.getAttribute('position');
            if (!pos) return;
            const arr = pos.array;
            const amp = 0.28 + progress * 0.12;
            for (let i = 0; i < arr.length; i += 3) {
                const x = arr[i], z = arr[i + 2];
                arr[i + 1] = 2.35
                    + Math.sin(x * 0.18 + z * 0.12 + clock * 1.2) * amp
                    + Math.cos(x * 0.10 - z * 0.15 + clock * 0.8) * (amp * 0.7)
                    + Math.sin(x * 0.28 + z * 0.25 + clock * 1.6) * (amp * 0.4);
            }
            pos.needsUpdate = true;
        }

        if (this._waterFlowTexture) {
            this._waterFlowTexture.offset.x = (clock * 0.018) % 1;
            this._waterFlowTexture.offset.y = (clock * 0.006) % 1;
        }

        if (this._foamOverlay) {
            this._foamOverlay.material.map.offset.x = (clock * 0.01) % 1;
            this._foamOverlay.material.map.offset.y = (clock * 0.004) % 1;
            this._foamOverlay.material.opacity = 0.16 + progress * 0.16 + Math.sin(clock * 0.9) * 0.03;
        }
    }

    /**
     * 洋中脊脉冲发光动画 - 使用 MeshStandardMaterial emissiveIntensity
     */
    _updateRidgeGlow(clock, progress, params) {
        if (!this.ridgeGlowMesh) return;
        const pulse       = 0.65 + Math.sin(clock * 2.6) * 0.35 * params.ridgePulse;
        const baseOpacity = 0.58 + progress * 0.18;
        this.ridgeGlowMesh.material.opacity = Math.min(0.96, baseOpacity * pulse);

        // 用 emissiveIntensity 控制发光强度
        const glow = 1.1 + pulse * 0.9 * params.ridgePulse;
        this.ridgeGlowMesh.material.emissiveIntensity = Math.min(3.0, glow * 1.15);

        if (params.lavaMultiplier >= 3) {
            this.ridgeGlowMesh.material.emissive.setRGB(1.0, 0.3, 0.02);
            this.ridgeGlowMesh.material.color.setRGB(1.0, 0.45, 0.05);
        } else {
            this.ridgeGlowMesh.material.emissive.setRGB(0.8, 0.2, 0.0);
            this.ridgeGlowMesh.material.color.setRGB(0.95, 0.35, 0.0);
        }
    }

    /**
     * 底面发光更新 - 使用 MeshStandardMaterial emissiveIntensity
     */
    _updateBottomGlow(lp, normalizedTime) {
        if (!this.bottomMesh) return;
        const brightFactor = lp * (0.7 + normalizedTime * 0.7);
        this.bottomMesh.material.emissiveIntensity = Math.min(2.0, 0.9 + brightFactor * 1.2);
    }

    /**
     * 强强度裂缝发光线
     */
    _updateCrackLines(progress, clock, params) {
        if (!this._crackLines) {
            const pts    = [];
            const xEdge  = PLATE_W * 0.38;
            const zRange = PLATE_D * 0.40;
            const segCount = 48;
            for (let i = 0; i < segCount; i++) {
                const z0   = (Math.random() - 0.5) * zRange * 2;
                const len  = 1.2 + Math.random() * 3.0;
                const y0   = -3 + fbmSea(z0 * 0.20, i * 0.55, 3) * 1.5;
                pts.push(
                    new THREE.Vector3(xEdge,             y0,           z0),
                    new THREE.Vector3(xEdge + len * 0.5, y0 + len * 0.5, z0 + (Math.random() - 0.5))
                );
            }
            const geo = new THREE.BufferGeometry().setFromPoints(pts);
            const mat = new THREE.LineBasicMaterial({
                color:       0xff5500,
                transparent: true,
                opacity:     0.0,
            });
            this._crackLines = new THREE.LineSegments(geo, mat);
            this._crackLines.name = 'PacificPlate_CrackLines';
            this.group.add(this._crackLines);
        }

        this._crackLines.visible = progress > 0.25;
        if (this._crackLines.visible) {
            const pulse = 0.5 + Math.sin(clock * 6) * 0.38;
            this._crackLines.material.opacity = pulse * Math.min(1, (progress - 0.25) * 3);
            const r = Math.min(1, 0.85 + params.lavaMultiplier * 0.05);
            const g = Math.max(0, 0.20 - params.lavaMultiplier * 0.04);
            this._crackLines.material.color.setRGB(r, g, 0);
        }
    }

    // ══════════════════════════════════════════════════════════
    //  公共 API
    // ══════════════════════════════════════════════════════════

    getCenter() { return this.group.position.clone(); }

    getEastBoundaryWorldX() { return this.group.position.x + PLATE_W * 0.497; }
}
