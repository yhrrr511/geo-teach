/**
 * 生长边界（洋中脊）v5.0 - 高精细地质截面版
 *
 * 核心视觉元素：
 * 1. 洋中脊隆起（PlaneGeometry 60x80，60x80 段，高斯横截面，顶点色从橙红→深蓝灰）
 * 2. 裂谷缝隙（中央深色裂缝，BufferGeometry 手动构建，底部橙红发光）
 * 3. 热液喷口（5 个 CylinderGeometry(1,2,15,12) 橙红柱体，脉冲动画）
 * 4. 地幔上涌（裂谷正下方锥形体，底部白热→顶部橙红，半透明）
 * 5. 海底扩张痕迹（两侧新洋壳，颜色由橙红→深蓝灰）
 * 6. 纯自发光，不依赖外部光照
 *
 * 公共 API：activate(), deactivate(), update(time, intensity, clock)
 */

import * as THREE from 'three';

// ──── 工具函数 ────────────────────────────────────────────────
function noise2D(x, y) {
    return Math.sin(x * 1.3 + y * 0.7) * Math.cos(y * 1.1 - x * 0.5) * 0.5
         + Math.sin(x * 2.1 - y * 1.7) * 0.3;
}

function fbm(x, z, octaves = 5) {
    let val = 0, amp = 0.5, freq = 1.0, maxAmp = 0;
    for (let i = 0; i < octaves; i++) {
        val += amp * Math.sin(x * freq * 0.12 + z * freq * 0.08)
                   * Math.cos(z * freq * 0.10 - x * freq * 0.06);
        maxAmp += amp;
        amp  *= 0.52;
        freq *= 2.0;
    }
    return val / maxAmp;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function lerp(a, b, t) { return a + (b - a) * t; }

export class DivergentBoundary {
    constructor(scene, eurasiaPlate, pacificPlate, particleSystem) {
        this.scene    = scene;
        this.eurasia  = eurasiaPlate;
        this.pacific  = pacificPlate;
        this.particles = particleSystem;
        this.isActive  = false;

        // ── 几何体句柄 ──
        this.ridgeSystem      = null;   // 洋中脊主体 Group
        this.ridgeMesh        = null;   // 洋中脊地形 Mesh
        this.riftCrackMesh    = null;   // 裂谷缝隙 Mesh
        this.riftGlowMesh     = null;   // 裂谷底发光 Mesh
        this.ventGroup        = null;   // 热液喷口 Group
        this.mantleUpswell    = null;   // 地幔上涌锥体
        this.seafloorSpreads  = [];     // 海底扩张层（两侧）

        // ── 内部状态 ──
        this._frameCount = 0;
        this._ridgeInitY = -6;
        this._lastRebuildFrame = -999;
    }

    // ════════════════════════════════════════════════════════════
    //  公共 API
    // ════════════════════════════════════════════════════════════

    activate() {
        this.isActive = true;
        this._buildRidgeSystem();
        this._buildRiftCrack();
        this._buildHydrothermalVents();
        this._buildMantleUpswell();
        this._buildSeafloorSpreads();
        this.eurasia.resetToInitial();
        this.pacific.resetToInitial();
    }

    deactivate() {
        this.isActive = false;
        this._removeAll();
        this.eurasia.resetToInitial();
        this.pacific.resetToInitial();
        this.particles.clearMagma();
    }

    update(time, intensity, clock) {
        if (!this.isActive) return;
        this._frameCount++;

        const speedFactor = intensity < 1.0 ? 0.5 : (intensity >= 2.0 ? 1.6 : 1.0);
        const progress = clamp((time - 0.05) / 0.90, 0, 1) * speedFactor;

        this._updatePlateDivergence(progress, intensity, clock);
        this._updateRidgeSystem(progress, intensity, clock);
        this._updateRiftCrack(progress, intensity, clock);
        this._updateHydrothermalVents(progress, intensity, clock);
        this._updateMantleUpswell(progress, intensity, clock);
        this._updateSeafloorSpreads(progress, intensity, clock);
        this._spawnRidgeMagma(progress, intensity, clock);
    }

    // ════════════════════════════════════════════════════════════
    //  清理
    // ════════════════════════════════════════════════════════════

    _removeAll() {
        const targets = [
            this.ridgeSystem, this.ventGroup, this.mantleUpswell,
        ];
        targets.forEach(obj => {
            if (!obj) return;
            this.scene.remove(obj);
            obj.traverse(child => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
                    else child.material.dispose();
                }
            });
        });
        this.seafloorSpreads.forEach(m => {
            this.scene.remove(m);
            if (m.geometry) m.geometry.dispose();
            if (m.material) m.material.dispose();
        });

        this.ridgeSystem     = null;
        this.ridgeMesh       = null;
        this.riftCrackMesh   = null;
        this.riftGlowMesh    = null;
        this.ventGroup       = null;
        this.mantleUpswell   = null;
        this.seafloorSpreads = [];
    }

    // ════════════════════════════════════════════════════════════
    //  1. 洋中脊主体（PlaneGeometry 60x80，60x80 段）
    // ════════════════════════════════════════════════════════════

    /**
     * _buildRidgeSystem
     * 中央洋中脊隆起（宽约 30 单位，高约 8 单位）
     * 使用 PlaneGeometry(60, 80, 60, 80) 段数
     * 顶点颜色：中心橙红 -> 外围深蓝灰
     */
    _buildRidgeSystem() {
        this.ridgeSystem = new THREE.Group();
        this.ridgeSystem.name = 'RidgeSystem';

        // 构建主山脊 mesh
        this.ridgeMesh = this._createRidgeMesh();
        this.ridgeMesh.name = 'RidgeMesh';
        this.ridgeSystem.add(this.ridgeMesh);

        this.ridgeSystem.position.set(this._getMidX(), this._ridgeInitY, 0);
        this.ridgeSystem.scale.y = 0;
        this.scene.add(this.ridgeSystem);
    }

    _createRidgeMesh() {
        const ridgeW = 60;   // 总宽度（两侧各 30 单位）
        const ridgeL = 80;   // 沿Z轴长度
        const segsX  = 60;
        const segsZ  = 80;
        const ridgeCrestH = 8.0;  // 中心山脊最大高度
        const ridgeFalloff = 22;  // 高斯σ（控制山脊宽度，约±15内是明显隆起）

        const geo = new THREE.PlaneGeometry(ridgeW, ridgeL, segsX, segsZ);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

        const pos   = geo.getAttribute('position');
        const arr   = pos.array;
        const count = arr.length / 3;
        const colors = new Float32Array(count * 3);

        for (let i = 0; i < count; i++) {
            const x = arr[i * 3];
            const z = arr[i * 3 + 2];

            // 高斯横截面：中心最高，向两侧指数衰减
            const gaussH = ridgeCrestH * Math.exp(-0.5 * (x / ridgeFalloff) * (x / ridgeFalloff) * 9.0);

            // 加入 fbm 噪声细节
            const noiseH = fbm(x * 0.15, z * 0.08, 5) * 1.4
                         + noise2D(x * 0.25, z * 0.12) * 0.6;

            // 中央裂谷凹陷（最顶部中心有一条窄缝）
            const crackDepth = Math.max(0, 1.0 - Math.abs(x) / 3.0) * 1.5;

            arr[i * 3 + 1] = gaussH + noiseH - crackDepth;

            // ── 顶点颜色：中心橙红 → 近侧暗红棕 → 外围深蓝灰（老海底）──
            const t = clamp(Math.abs(x) / (ridgeW * 0.5), 0, 1); // 0=中心, 1=边缘
            let r, g, b;

            if (t < 0.08) {
                // 中心热液带：亮橙白
                const s = t / 0.08;
                r = lerp(1.0,  0.98, s);
                g = lerp(0.55, 0.28, s);
                b = lerp(0.05, 0.0,  s);
            } else if (t < 0.20) {
                // 近轴橙红区
                const s = (t - 0.08) / 0.12;
                r = lerp(0.98, 0.90, s);
                g = lerp(0.28, 0.18, s);
                b = 0.0;
            } else if (t < 0.40) {
                // 扩张轴附近：暗红→棕红
                const s = (t - 0.20) / 0.20;
                r = lerp(0.90, 0.60, s);
                g = lerp(0.18, 0.10, s);
                b = lerp(0.0,  0.02, s);
            } else if (t < 0.65) {
                // 新洋壳：棕→深棕灰
                const s = (t - 0.40) / 0.25;
                r = lerp(0.60, 0.22, s);
                g = lerp(0.10, 0.14, s);
                b = lerp(0.02, 0.10, s);
            } else {
                // 老海底：深蓝灰
                const s = clamp((t - 0.65) / 0.35, 0, 1);
                r = lerp(0.22, 0.06, s);
                g = lerp(0.14, 0.08, s);
                b = lerp(0.10, 0.18, s);
            }
            colors[i * 3]     = r;
            colors[i * 3 + 1] = g;
            colors[i * 3 + 2] = b;
        }

        pos.needsUpdate = true;
        geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.75,
            metalness: 0.05,
            side:         THREE.DoubleSide,
        });

        return new THREE.Mesh(geo, mat);
    }

    _updateRidgeSystem(progress, intensity, clock) {
        if (!this.ridgeSystem) return;

        const ridgeP = clamp((progress - 0.02) / 0.85, 0, 1);

        this.ridgeSystem.scale.y = ridgeP;
        this.ridgeSystem.position.x = this._getMidX();
        this.ridgeSystem.position.y = this._ridgeInitY + ridgeP * 8
            * (intensity < 1.0 ? 0.6 : intensity >= 2.0 ? 1.5 : 1.0);

        // 洋中脊中心热流脉冲发光
        if (this.ridgeMesh) {
            const flowPulse = 0.55 + Math.sin(clock * 2.2) * 0.45;
            const glow = clamp((0.20 + ridgeP * 0.95) * intensity * flowPulse, 0, 2.2);
            this.ridgeMesh.material.emissiveIntensity = glow;

            // 随强度颜色更白热
            const heatT = clamp((intensity - 1.0) / 2.0, 0, 1);
            const emR = 0.40 + heatT * 0.60;
            const emG = heatT * 0.15;
            this.ridgeMesh.material.emissive.setRGB(emR, emG, 0);

            if (intensity >= 2.0) {
                const hotPulse = 0.5 + Math.sin(clock * 5.5) * 0.5;
                this.ridgeMesh.material.emissiveIntensity =
                    clamp(glow * 1.5 * hotPulse, 0, 2.8);
            }
        }
    }

    // ════════════════════════════════════════════════════════════
    //  2. 裂谷缝隙（中央深色裂缝 + 底部橙红发光）
    // ════════════════════════════════════════════════════════════

    _buildRiftCrack() {
        // 裂缝主体：中央深色V形槽，手动 BufferGeometry 构建
        const lenZ  = 80;
        const segsZ = 60;
        const halfW = 2.0;   // 缝宽约 4 单位
        const depth = 3.5;

        const verts = [], indices = [], colors = [];

        for (let iz = 0; iz <= segsZ; iz++) {
            const z = (iz / segsZ - 0.5) * lenZ;
            const n = noise2D(iz * 0.45, 3.1) * 0.35;

            // 4 顶点截面：左顶 | 左壁 | 右壁 | 右顶
            //   左顶（裂缝口左侧）
            verts.push(-halfW,     n * 0.3,           z);
            colors.push(0.05, 0.03, 0.03);  // 近黑深色

            //   左壁底
            verts.push(-halfW * 0.25, -depth + n * 0.4, z);
            colors.push(0.45, 0.08, 0.0);   // 橙红（岩浆）

            //   右壁底
            verts.push(halfW * 0.25,  -depth + n * 0.4, z);
            colors.push(0.45, 0.08, 0.0);   // 橙红

            //   右顶
            verts.push(halfW,      n * 0.3,           z);
            colors.push(0.05, 0.03, 0.03);  // 近黑
        }

        const stride = 4;
        for (let iz = 0; iz < segsZ; iz++) {
            const b = iz * stride;
            for (let ix = 0; ix < 3; ix++) {
                const a0 = b + ix,     a1 = b + ix + 1;
                const b0 = a0 + stride, b1 = a1 + stride;
                indices.push(a0, b0, a1, a1, b0, b1);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        this.riftCrackMesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.75,
            metalness: 0.05,
            side:         THREE.DoubleSide,
        }));
        this.riftCrackMesh.name = 'RiftCrack';

        // 裂缝底部独立发光带（亮橙线）
        const glowPts = [];
        for (let i = 0; i <= 48; i++) {
            const z = (i / 48 - 0.5) * lenZ;
            const n = noise2D(i * 0.4, 7.3) * 0.25;
            glowPts.push(new THREE.Vector3(0, -depth + n, z));
        }
        const glowGeo = new THREE.BufferGeometry().setFromPoints(glowPts);
        const glowMat = new THREE.LineBasicMaterial({
            color: 0xff4400, transparent: true, opacity: 0.0,
        });
        this.riftGlowMesh = new THREE.Line(glowGeo, glowMat);
        this.riftGlowMesh.name = 'RiftGlow';

        // 添加到 ridgeSystem（随洋中脊一起运动）
        if (this.ridgeSystem) {
            this.ridgeSystem.add(this.riftCrackMesh);
            this.ridgeSystem.add(this.riftGlowMesh);
        }
    }

    _updateRiftCrack(progress, intensity, clock) {
        if (!this.riftCrackMesh) return;

        const crackP = clamp((progress - 0.03) / 0.88, 0, 1);

        // 裂谷中心发光脉冲
        const pulse = 0.5 + Math.sin(clock * 3.5) * 0.5;
        this.riftCrackMesh.material.emissiveIntensity =
            clamp(crackP * 1.4 * intensity * pulse, 0, 2.0);

        // 随强度颜色更白热
        if (intensity >= 2.0) {
            this.riftCrackMesh.material.emissive.setRGB(
                0.75 + Math.sin(clock * 6) * 0.1,
                0.25 + Math.sin(clock * 6) * 0.05,
                0.0
            );
        }

        // 裂缝底部橙红发光线
        if (this.riftGlowMesh) {
            const glowPulse = 0.4 + Math.sin(clock * 4.2) * 0.6;
            this.riftGlowMesh.material.opacity =
                clamp(crackP * 0.85 * intensity * glowPulse, 0, 0.90);
            const hue = Math.max(0, 0.04 - crackP * 0.02);
            this.riftGlowMesh.material.color.setHSL(hue, 1.0, 0.45 + crackP * 0.15);
        }
    }

    // ════════════════════════════════════════════════════════════
    //  3. 热液喷口（5 个 CylinderGeometry(1, 2, 15, 12)）
    // ════════════════════════════════════════════════════════════

    _buildHydrothermalVents() {
        this.ventGroup = new THREE.Group();
        this.ventGroup.name = 'HydrothermalVents';

        // 5 个喷口，沿 Z 轴分布于裂谷中
        const ventZs = [-30, -15, 0, 15, 30];

        for (let vi = 0; vi < 5; vi++) {
            const vg = new THREE.Group();
            vg.name = `VentGroup_${vi}`;

            // 主岩浆柱：CylinderGeometry(1, 2, 15, 12) 橙红半透明
            const cylGeo = new THREE.CylinderGeometry(1, 2, 15, 12, 6, false);
            // 顶点着色：底部白热，顶部橙红
            const cylCount = cylGeo.getAttribute('position').count;
            const cylColors = new Float32Array(cylCount * 3);
            const cylPos = cylGeo.getAttribute('position');
            for (let j = 0; j < cylCount; j++) {
                const py = cylPos.getY(j);
                // y范围: -7.5 ~ +7.5, 底部最热
                const t = clamp((py + 7.5) / 15.0, 0, 1); // 0=底, 1=顶
                // 底部白热 (1,0.8,0.3) → 顶部橙红 (0.9,0.2,0)
                cylColors[j * 3]     = lerp(1.0,  0.90, t);
                cylColors[j * 3 + 1] = lerp(0.80, 0.18, t);
                cylColors[j * 3 + 2] = lerp(0.30, 0.0,  t);
            }
            cylGeo.setAttribute('color', new THREE.BufferAttribute(cylColors, 3));

            const cylMat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                roughness:    0.75,
                metalness:    0.05,
                transparent:  true,
                opacity:      0.0,
                side:         THREE.DoubleSide,
            });
            const cyl = new THREE.Mesh(cylGeo, cylMat);
            cyl.name = `VentCyl_${vi}`;
            cyl.position.set(0, 7.5, 0); // 底部对齐到 y=0
            cyl.scale.y = 0;
            vg.add(cyl);

            // 顶部发光盘（脉冲）
            const topGeo = new THREE.CircleGeometry(1.2, 12);
            const topMat = new THREE.MeshStandardMaterial({
                color: 0xff8800, transparent: true, opacity: 0.0,
                emissive: new THREE.Color(0.5, 0.2, 0.0),
                emissiveIntensity: 0.5,
                roughness: 0.5,
                metalness: 0.1,
            });
            const top = new THREE.Mesh(topGeo, topMat);
            top.rotation.x = -Math.PI / 2;
            top.position.set(0, 15.2, 0);
            top.name = `VentTop_${vi}`;
            vg.add(top);

            // 底座黑岩锥（颜色提亮约1.5倍适配 MeshBasicMaterial 纯色显示）
            const baseGeo = new THREE.CylinderGeometry(0.5, 1.5, 3, 10);
            const baseMat = new THREE.MeshStandardMaterial({
                color: 0x1a0c0c,
                roughness: 0.9,
                metalness: 0.1,
            });
            const base = new THREE.Mesh(baseGeo, baseMat);
            base.position.set(0, 1.5, 0);
            base.scale.y = 0;
            base.name = `VentBase_${vi}`;
            vg.add(base);

            vg.position.set(0, -3.5, ventZs[vi]);
            this.ventGroup.add(vg);
        }

        // 热液喷口 group 添加到 ridgeSystem，随洋中脊运动
        if (this.ridgeSystem) {
            this.ridgeSystem.add(this.ventGroup);
        } else {
            this.scene.add(this.ventGroup);
        }
    }

    _updateHydrothermalVents(progress, intensity, clock) {
        if (!this.ventGroup) return;

        const ventP = clamp((progress - 0.08) / 0.80, 0, 1);
        const activeCount = intensity < 1.0 ? 3 : 5;

        this.ventGroup.children.forEach((vg, vi) => {
            vg.visible = vi < activeCount;
            if (vi >= activeCount) return;

            const delay = vi * 0.08;
            const vp = clamp(ventP - delay, 0, 1);

            vg.children.forEach(child => {
                if (child.name?.startsWith('VentBase_')) {
                    child.scale.y = clamp(vp * 3.0, 0, 1);
                } else if (child.name?.startsWith('VentCyl_')) {
                    child.scale.y = clamp((vp - 0.10) * 2.5, 0, 1);
                    if (child.material) {
                        // 热液噴口岁浆柱动态发光
                        const pulseFreq = intensity >= 2.0 ? 5.5 : (intensity < 1.0 ? 2.0 : 3.5);
                        const pulse = 0.5 + Math.sin(clock * pulseFreq + vi * 1.1) * 0.5;
                        child.material.emissiveIntensity = clamp(vp * 1.8 * intensity * pulse, 0, 2.5);
                        child.material.opacity = clamp(vp * 0.72 * (0.6 + pulse * 0.4), 0, 0.80);

                        if (intensity >= 2.0) {
                            const hotPulse = 0.4 + Math.sin(clock * 7.0 + vi) * 0.6;
                            child.material.emissive.setRGB(
                                0.80 + hotPulse * 0.20,
                                0.30 + hotPulse * 0.15,
                                hotPulse * 0.05
                            );
                        } else {
                            child.material.emissive.setRGB(0.70, 0.20, 0.0);
                        }
                    }
                } else if (child.name?.startsWith('VentTop_')) {
                    const pulseFreq = intensity >= 2.0 ? 6.0 : 3.2;
                    const topPulse = clamp(Math.sin(clock * pulseFreq + vi * 0.9) * 0.5 + 0.5, 0, 1);
                    child.material.opacity = clamp(topPulse * 0.90 * vp, 0, 0.95);
                    // 颜色随强度变化
                    if (intensity >= 2.0) {
                        child.material.color.setRGB(1.0, 0.8 + topPulse * 0.2, 0.3 + topPulse * 0.4);
                    } else {
                        child.material.color.setRGB(1.0, 0.5 + topPulse * 0.2, 0.0);
                    }
                }
            });
        });
    }

    // ════════════════════════════════════════════════════════════
    //  4. 地幔上涌（裂谷正下方锥形体）
    // ════════════════════════════════════════════════════════════

    _buildMantleUpswell() {
        const group = new THREE.Group();
        group.name = 'MantleUpswell';

        // 主锥形体：底部白热，顶部橙红，半透明
        // ConeGeometry(底面半径, 高, 段数)
        const coneGeo = new THREE.CylinderGeometry(1.5, 12, 22, 18, 8, true);
        const coneCount = coneGeo.getAttribute('position').count;
        const coneColors = new Float32Array(coneCount * 3);
        const conePos = coneGeo.getAttribute('position');

        for (let i = 0; i < coneCount; i++) {
            const py = conePos.getY(i);
            // y范围: -11 ~ +11, 底部最热（白热），顶部橙红
            const t = clamp((py + 11) / 22.0, 0, 1); // 0=底, 1=顶
            // 底部白热 (1, 0.9, 0.5) → 顶部橙红 (0.85, 0.18, 0)
            coneColors[i * 3]     = lerp(1.0,  0.85, t);
            coneColors[i * 3 + 1] = lerp(0.90, 0.18, t);
            coneColors[i * 3 + 2] = lerp(0.50, 0.0,  t);
        }
        coneGeo.setAttribute('color', new THREE.BufferAttribute(coneColors, 3));

        const coneMat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness:    0.75,
            metalness:    0.05,
            transparent:  true,
            opacity:      0.0,
            side:         THREE.DoubleSide,
        });

        const cone = new THREE.Mesh(coneGeo, coneMat);
        cone.name = 'MantleConeMesh';
        cone.position.y = -12; // 从底部升起
        group.add(cone);

        // 顶部热点圆盘（与裂谷底部对齐）
        const discGeo = new THREE.CircleGeometry(2.5, 20);
        const discMat = new THREE.MeshStandardMaterial({
            color: 0xff5500, transparent: true, opacity: 0.0,
            emissive: new THREE.Color(0.5, 0.15, 0.0),
            emissiveIntensity: 0.5,
            roughness: 0.5,
            metalness: 0.1,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = -1;
        disc.name = 'MantleDisc';
        group.add(disc);

        this.mantleUpswell = group;
        // 地幔上涌添加到 ridgeSystem
        if (this.ridgeSystem) {
            this.ridgeSystem.add(this.mantleUpswell);
        } else {
            this.scene.add(this.mantleUpswell);
        }
    }

    _updateMantleUpswell(progress, intensity, clock) {
        if (!this.mantleUpswell) return;

        const upswellP = clamp((progress - 0.06) / 0.82, 0, 1);

        // 透明度变化（随进度出现）
        const pulse = 0.5 + Math.sin(clock * 1.8) * 0.5;
        const cone = this.mantleUpswell.getObjectByName('MantleConeMesh');
        if (cone) {
            cone.material.opacity = clamp(upswellP * 0.60 * (0.5 + pulse * 0.5), 0, 0.70);
                // 地幔上涌动态发光
            cone.material.emissiveIntensity = clamp(0.55 + pulse * 0.65, 0, 1.8);
            cone.position.y = -12 + upswellP * 6; // 向上涌动

            if (intensity >= 2.0) {
                const hotPulse = 0.4 + Math.sin(clock * 4.5) * 0.6;
                cone.material.emissive.setRGB(0.75, 0.30 + hotPulse * 0.10, 0.0);
                cone.material.emissiveIntensity = clamp(1.0 + hotPulse * 0.8, 0, 2.5);
            }
        }

        const disc = this.mantleUpswell.getObjectByName('MantleDisc');
        if (disc) {
            disc.material.opacity = clamp(upswellP * 0.80 * (0.4 + pulse * 0.6), 0, 0.88);
        }
    }

    // ════════════════════════════════════════════════════════════
    //  5. 海底扩张痕迹（两侧新洋壳，颜色从橙红→深蓝灰）
    // ════════════════════════════════════════════════════════════

    _buildSeafloorSpreads() {
        // 每侧 4 层，颜色从内到外：橙红 → 棕红 → 深灰 → 深蓝灰
        const layerColors = [
            { r: 0.85, g: 0.18, b: 0.02 },  // 最内层：橙红（新生洋壳）
            { r: 0.50, g: 0.10, b: 0.05 },  // 棕红
            { r: 0.20, g: 0.12, b: 0.10 },  // 深灰棕
            { r: 0.06, g: 0.08, b: 0.18 },  // 最外层：深蓝灰（老洋壳）
        ];
        const layerWidth = 10; // 每层宽度

        for (let li = 0; li < 4; li++) {
            const offset = (li + 1) * layerWidth;
            const col = layerColors[li];
            const t = li / 3;

            for (const side of [-1, 1]) {
                const geo = this._createSpreadLayerGeo(li);
                // MeshStandardMaterial 支持光照，不需要提亮颜色
                const mat = new THREE.MeshStandardMaterial({
                    color:       new THREE.Color(col.r, col.g, col.b),
                    roughness:   0.75,
                    metalness:   0.05,
                    transparent: true,
                    opacity:     0.0,
                });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(this._getMidX() + side * offset, this._ridgeInitY - 0.5, 0);
                mesh.userData = { side, layerIndex: li, offset, delay: li * 0.07 };
                this.scene.add(mesh);
                this.seafloorSpreads.push(mesh);
            }
        }
    }

    _createSpreadLayerGeo(layerIndex) {
        const geo = new THREE.PlaneGeometry(10, 80, 5, 20);
        geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        const pos = geo.getAttribute('position');
        const arr = pos.array;
        for (let j = 0; j < arr.length; j += 3) {
            const x = arr[j], z = arr[j + 2];
            arr[j + 1] += Math.sin(z * 0.14 + layerIndex * 0.7) * 0.45
                        + fbm(x * 0.30, z * 0.16, 4) * 0.40;
        }
        pos.needsUpdate = true;
        geo.computeVertexNormals();
        return geo;
    }

    _updateSeafloorSpreads(progress, intensity, clock) {
        const midX = this._getMidX();

        for (const mesh of this.seafloorSpreads) {
            const { side, layerIndex, offset, delay } = mesh.userData;
            const localP = clamp(progress - delay, 0, 1);

            // 透明度淡入
            const maxOpa = 1.0 - layerIndex * 0.10;
            mesh.material.opacity = clamp(localP * 2.0, 0, maxOpa);

            // 向两侧扩展
            mesh.position.x = midX + side * offset * (0.75 + progress * 0.40);
            mesh.position.y = this._ridgeInitY - 0.5 + progress * 3
                * (intensity < 1.0 ? 0.6 : intensity >= 2.0 ? 1.5 : 1.0);

            // 海底扇张内层热流发光
            if (layerIndex === 0) {
                const spreadPulse = Math.sin(clock * 3.5) * 0.15 * intensity;
                mesh.material.emissiveIntensity = clamp((0.45 + spreadPulse) * localP, 0, 1.2);
                mesh.material.emissive.setRGB(0.6, 0.10, 0.0);
                if (intensity >= 2.0) {
                    mesh.material.emissiveIntensity = clamp((0.65 + spreadPulse * 1.5) * localP, 0, 1.8);
                }
            } else if (layerIndex === 1) {
                mesh.material.emissiveIntensity = clamp(0.18 * localP * (1 - progress * 0.20), 0, 0.6);
                mesh.material.emissive.setRGB(0.3, 0.05, 0.0);
            }
        }
    }

    // ════════════════════════════════════════════════════════════
    //  6. 板块分离运动
    // ════════════════════════════════════════════════════════════

    _updatePlateDivergence(progress, intensity, clock) {
        const moveAmount = progress * intensity * 34;
        this.eurasia.group.position.x = 50 + moveAmount;
        this.eurasia.group.position.y = Math.sin(clock * 0.7) * 0.55 * progress;
        this.pacific.updateDivergent(progress, intensity, clock);
    }

    // ════════════════════════════════════════════════════════════
    //  7. 洋中脊岩浆粒子
    // ════════════════════════════════════════════════════════════

    _spawnRidgeMagma(progress, intensity, clock) {
        if (progress < 0.03) return;
        if (this._frameCount % 3 !== 0) return;

        const midX = this._getMidX();
        const ridgeH = this._ridgeInitY
            + clamp((progress - 0.02) / 0.85, 0, 1)
            * 8 * (intensity < 1.0 ? 0.6 : intensity >= 2.0 ? 1.5 : 1.0)
            + 10;

        const spawnCount = intensity < 1.0
            ? Math.floor(1 + intensity * 2)
            : (intensity >= 2.0 ? Math.floor(5 + intensity * 4) : Math.floor(3 + intensity * 3));

        for (let i = 0; i < spawnCount; i++) {
            const z    = (Math.random() - 0.5) * 70;
            const xOff = (Math.random() - 0.5) * 3;
            const upSpeed = intensity >= 2.0
                ? 2.2 + Math.random() * 3.0
                : 1.4 + Math.random() * 2.0 + intensity * 0.4;

            this.particles.spawnMagma(
                midX + xOff, ridgeH, z,
                [(Math.random() - 0.5) * 0.9, upSpeed, (Math.random() - 0.5) * 0.9],
                1.0 + Math.random() * 0.8, true
            );
        }

        // 热液喷口白烟（每5帧）
        if (progress > 0.12 && this._frameCount % 5 === 0) {
            const activeCount = intensity < 1.0 ? 3 : 5;
            const ventZs = [-30, -15, 0, 15, 30];
            for (let vi = 0; vi < activeCount; vi++) {
                if (Math.random() > (intensity >= 2.0 ? 0.28 : 0.45)) {
                    this.particles.spawnHydroSmoke(
                        midX, ridgeH - 3, ventZs[vi],
                        [
                            (Math.random() - 0.5) * 0.30,
                            0.7 + Math.random() * 1.2,
                            (Math.random() - 0.5) * 0.30,
                        ]
                    );
                }
            }
        }
    }

    // ════════════════════════════════════════════════════════════
    //  工具
    // ════════════════════════════════════════════════════════════

    /** 计算两板块之间的中间 X 坐标 */
    _getMidX() {
        return (this.eurasia.group.position.x + this.pacific.group.position.x) / 2 - 30;
    }
}
