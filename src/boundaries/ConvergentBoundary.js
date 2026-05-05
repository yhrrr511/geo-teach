/**
 * 消亡边界（俯冲带）v5.0 - 高精细地质截面版
 *
 * 核心视觉元素：
 * 1. 俯冲截面（60x20 段曲面，冷蓝灰→热橙渐变，非线性弯曲板片）
 * 2. 俯冲楔（Forearc Wedge）- 三角形楔形深灰棕区域，顶点分层着色
 * 3. 岩浆通道（3-5 个纵向 CylinderGeometry，橙红半透明，脉冲动画）
 * 4. 接触线（TubeGeometry，发光青蓝，随时间微动）
 * 5. 俯冲带标签（"俯冲带"，白色）
 * 6. 自发光设计，不依赖外部光照
 *
 * 坐标系：eurasiaPlate 在 x=+50，pacificPlate 在 x=-60
 * 公共 API 保持不变：activate(), deactivate(), update(time, intensity, clock)
 */

import * as THREE from 'three';

// ──── 工具函数 ────────────────────────────────────────────────
function noise2D(x, y) {
    return Math.sin(x * 1.3 + y * 0.7) * Math.cos(y * 1.1 - x * 0.5) * 0.5
         + Math.sin(x * 2.1 - y * 1.7) * 0.3;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export class ConvergentBoundary {
    constructor(scene, eurasiaPlate, pacificPlate, particleSystem) {
        this.scene     = scene;
        this.eurasia   = eurasiaPlate;
        this.pacific   = pacificPlate;
        this.particles = particleSystem;
        this.isActive  = false;

        // ── 几何体句柄 ──
        this.slabMesh        = null;   // 俯冲板片曲面
        this.forearc         = null;   // 俯冲楔（前弧楔）
        this.magmaChannels   = [];     // 岩浆通道数组
        this.contactTube     = null;   // 接触线（TubeGeometry）
        this.subductionLabel = null;   // "俯冲带"标签

        // ── 内部帧计数 ──
        this._frameCount = 0;

        // ── 接触线控制点（用于微动）──
        this._contactCurvePoints = null;

        // ── 海水流动箭头 mesh 数组 ──
        this._flowArrows = [];
    }

    // ════════════════════════════════════════════════════════════
    //  公共 API
    // ════════════════════════════════════════════════════════════
    activate() {
        this.isActive = true;
        this._buildSubductionSlab();
        this._buildForearc();
        this._buildMagmaChannels();
        this._buildContactLine();
        this._buildSubductionLabel();
        this._buildFlowArrows();
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

        // 板块运动
        this.pacific.updateConvergent(time, intensity, clock);
        this.eurasia.updateConvergent(time, intensity, clock);

        // 各子系统更新
        this._updateSubductionSlab(time, intensity, clock);
        this._updateForearc(time, intensity, clock);
        this._updateMagmaChannels(time, intensity, clock);
        this._updateContactLine(time, intensity, clock);
        this._updateSubductionLabel(time, intensity, clock);
        this._updateFlowArrows(time, intensity, clock);
    }

    // ════════════════════════════════════════════════════════════
    //  清理
    // ════════════════════════════════════════════════════════════
    _removeAll() {
        const targets = [
            this.slabMesh, this.forearc, this.contactTube, this.subductionLabel,
            ...this.magmaChannels
        ];
        targets.forEach(obj => {
            if (!obj) return;
            this.scene.remove(obj);
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                else obj.material.dispose();
            }
        });
        this.slabMesh      = null;
        this.forearc       = null;
        this.magmaChannels = [];
        this.contactTube   = null;
        this.subductionLabel = null;

        // 清理 flow arrows
        for (const arrow of this._flowArrows) {
            this.scene.remove(arrow);
            if (arrow.geometry) arrow.geometry.dispose();
            if (arrow.material) arrow.material.dispose();
        }
        this._flowArrows = [];
    }

    // ════════════════════════════════════════════════════════════
    //  1. 俯冲板片（60x20 段曲面，冷蓝→热橙渐变，非线性弯曲）
    // ════════════════════════════════════════════════════════════
    _buildSubductionSlab() {
        const segX = 90, segZ = 28;
        const geo = new THREE.PlaneGeometry(128, 40, segX, segZ);
        const pos = geo.getAttribute('position');
        const colors = [];

        // PlaneGeometry 默认在 XY 平面，我们需要旋转到 XZ 平面后再处理
        // 先收集顶点信息，按照 task 要求设计曲面形状
        const totalX = segX + 1;
        const totalZ = segZ + 1;

        for (let j = 0; j < totalZ; j++) {
            for (let i = 0; i < totalX; i++) {
                const idx = j * totalX + i;

                // nx: 0=左侧（太平洋，前锋），1=右侧（亚欧侧深处）
                const nx = i / segX;
                // nz: 0~1 沿 Z 方向（南北）
                const nz = j / segZ;

                // 非线性弯曲俯冲深度：前段较平，后段快速扎入地幔
                const arcSag = Math.sin(nx * Math.PI) * 2.0;
                const subductDepth = Math.pow(nx, 1.45) * 28.0 + arcSag;

                // 微幅噪声，增加自然感
                const noiseVal = noise2D(nx * 5.0, nz * 3.8) * 1.0;

                // 修改 Y 坐标（PlaneGeometry 默认在 XY 平面，Y 为垂直方向）
                const currentX = pos.getX(idx);
                const currentY = pos.getY(idx);
                pos.setY(idx, currentY - subductDepth + noiseVal);

                // 颜色渐变：冷蓝灰(nx=0) → 暖橙(nx=0.6) → 热橙红(nx=1.0)
                let r, g, b;
                if (nx < 0.45) {
                    // 前端：冷蓝灰（更蓝更鲜明）→ 中性灰棕
                    const s = nx / 0.45;
                    r = THREE.MathUtils.lerp(0.15, 0.60, s);
                    g = THREE.MathUtils.lerp(0.22, 0.28, s);
                    b = THREE.MathUtils.lerp(0.55, 0.18, s);
                } else if (nx < 0.75) {
                    // 中部：灰棕 → 热橙
                    const s = (nx - 0.45) / 0.30;
                    r = THREE.MathUtils.lerp(0.60, 0.88, s);
                    g = THREE.MathUtils.lerp(0.28, 0.18, s);
                    b = THREE.MathUtils.lerp(0.18, 0.04, s);
                } else {
                    // 深部（进入地幔）：热橙 → 橙红
                    const s = (nx - 0.75) / 0.25;
                    r = THREE.MathUtils.lerp(0.88, 0.95, s);
                    g = THREE.MathUtils.lerp(0.18, 0.08, s);
                    b = THREE.MathUtils.lerp(0.04, 0.02, s);
                }

                // 加入微噪声，让颜色更自然
                const cn = noise2D(nx * 6, nz * 5) * 0.04;
                colors.push(
                    clamp(r + cn, 0, 1),
                    clamp(g + cn * 0.3, 0, 1),
                    clamp(b, 0, 1)
                );
            }
        }

        pos.needsUpdate = true;
        geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.68,
            metalness: 0.08,
            emissive: new THREE.Color(0.26, 0.08, 0.02),
            emissiveIntensity: 0.35,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.0,
        });

        this.slabMesh = new THREE.Mesh(geo, mat);
        this.slabMesh.name = 'SubductionSlab';
        // 旋转板片：使其从 XY 平面转到接近水平（XZ 平面），但保留一定倾斜
        // 绕 X 轴旋转 -90 度，使 Y 轴变为深度轴
        this.slabMesh.rotation.x = -Math.PI / 2;
        // 再绕 Z 轴倾斜，模拟更明显的俯冲板片入幔
        this.slabMesh.rotation.z = THREE.MathUtils.degToRad(13);
        this.scene.add(this.slabMesh);
    }

    _updateSubductionSlab(time, intensity, clock) {
        if (!this.slabMesh) return;

        const speedFactor = intensity < 1.0 ? 0.6 : (intensity >= 2.0 ? 1.8 : 1.0);
        const progress = clamp((time - 0.05) / 0.80, 0, 1) * speedFactor;

        // 不透明度淡入
        const opacity = clamp(progress * 1.5, 0, 1);
        this.slabMesh.material.opacity = opacity;

        // 俯冲板片轻微发光，增强视觉深度感
        // const pulse = Math.sin(clock * 1.6) * 0.06 * progress;
        // const emBase = progress * intensity * 0.3;
        // this.slabMesh.material.emissiveIntensity = clamp(emBase + pulse, 0, 0.8);

        // // 高强度时整体更红
        // if (intensity >= 2.0) {
        //     this.slabMesh.material.emissive.setRGB(0.25, 0.04, 0.0);
        // } else {
        //     this.slabMesh.material.emissive.setRGB(0.12, 0.02, 0.0);
        // }

        const pulse = 0.75 + Math.sin(clock * 1.4) * 0.2;
        this.slabMesh.material.emissiveIntensity = clamp((0.3 + progress * 0.9) * intensity * pulse, 0.2, 1.8);

        // 位置跟随太平洋板块
        const pacX = this.pacific.group.position.x + 54;
        this.slabMesh.position.set(pacX - 58, -progress * 5.5, 0);
    }

    // ════════════════════════════════════════════════════════════
    //  2. 俯冲楔（Forearc Wedge）- 三角形楔形区域
    // ════════════════════════════════════════════════════════════
    _buildForearc() {
        // 俯冲楔：横截面为三角形（尖端朝太平洋侧，底部在右侧大陆下方）
        // 在 Z 方向延伸，形成3D楔形体
        const segsZ = 30;
        const lenZ = 70;
        const verts = [];
        const indices = [];
        const colors = [];

        // 楔形截面（XY 平面）：
        //   顶点 A（尖端）：x=0, y=0.5
        //   顶点 B（右上）：x=28, y=0.5
        //   顶点 C（右下）：x=28, y=-14
        // 沿 Z 方向拉伸，加入噪声扰动

        const stride = 3; // 每个截面 3 个顶点

        for (let iz = 0; iz <= segsZ; iz++) {
            const z = (iz / segsZ - 0.5) * lenZ;
            const n = noise2D(iz * 0.3, 4.5) * 0.7;

            // A: 尖端（前锋）
            verts.push(0, 0.5 + n * 0.2, z);
            // B: 右上（大陆表面）
            verts.push(28 + n * 0.5, 0.5, z);
            // C: 右下（板片深处，斜下方）
            verts.push(26 + n * 0.4, -13.5 + n * 0.3, z);

            // 顶点颜色分层：
            // A 尖端：最深灰棕（受压最强）
            colors.push(0.22, 0.14, 0.08);  // A
            // B 右上：中等棕色（大陆岩石）
            colors.push(0.38, 0.26, 0.14);  // B
            // C 右下：深灰（深部岩石，接近地幔温度）
            colors.push(0.18, 0.10, 0.06);  // C
        }

        // 生成三角形面片（沿 Z 方向相邻截面之间）
        for (let iz = 0; iz < segsZ; iz++) {
            const base = iz * stride;
            const next = base + stride;

            // A-B 面（上侧）
            indices.push(base + 0, next + 0, base + 1);
            indices.push(next + 0, next + 1, base + 1);

            // B-C 面（右侧）
            indices.push(base + 1, next + 1, base + 2);
            indices.push(next + 1, next + 2, base + 2);

            // A-C 面（底面，斜面）
            indices.push(base + 0, base + 2, next + 0);
            indices.push(next + 0, base + 2, next + 2);
        }

        // 两端封口（可选，增加体积感）
        // 前端封口（iz=0）
        indices.push(0, 2, 1);
        // 后端封口（iz=segsZ）
        const lastBase = segsZ * stride;
        indices.push(lastBase + 0, lastBase + 1, lastBase + 2);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        geo.setIndex(indices);
        geo.computeVertexNormals();

        const mat = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.76,
            metalness: 0.05,
            emissive: new THREE.Color(0.18, 0.06, 0.02),
            emissiveIntensity: 0.18,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.0,
        });

        this.forearc = new THREE.Mesh(geo, mat);
        this.forearc.name = 'ForearWedge';
        this.scene.add(this.forearc);
    }

    _updateForearc(time, intensity, clock) {
        if (!this.forearc) return;

        const speedFactor = intensity < 1.0 ? 0.6 : (intensity >= 2.0 ? 1.8 : 1.0);
        const progress = clamp((time - 0.08) / 0.82, 0, 1) * speedFactor;

        const pacX = this.pacific.group.position.x + 54;
        this.forearc.position.set(pacX - 2, 0, 0);

        this.forearc.material.opacity = clamp(progress * 1.15, 0, 0.96);
        this.forearc.material.emissiveIntensity = 0.08 + progress * 0.22;
    }

    // ════════════════════════════════════════════════════════════
    //  3. 岩浆通道（3-5 个纵向橙红色圆柱体，脉冲发光）
    // ════════════════════════════════════════════════════════════
    _buildMagmaChannels() {
        // 岩浆通道分布在俯冲带后方（x=40~80 相对于板块接触处）
        const channelDefs = [
            { relX: 42, z: -18, radiusTop: 0.8, radiusBot: 1.4, height: 18 },
            { relX: 52, z:  -8, radiusTop: 1.0, radiusBot: 1.6, height: 22 },
            { relX: 60, z:   2, radiusTop: 0.9, radiusBot: 1.5, height: 20 },
            { relX: 68, z:  12, radiusTop: 0.7, radiusBot: 1.2, height: 16 },
            { relX: 55, z:  22, radiusTop: 0.8, radiusBot: 1.3, height: 19 },
        ];

        this._channelDefs = channelDefs;

        channelDefs.forEach((def, idx) => {
            const geo = new THREE.CylinderGeometry(
                def.radiusTop, def.radiusBot,
                def.height,
                12, 6,  // 12段圆周，6段高度
                true    // openEnded，顶端开口增加穿透感
            );

            // 给圆柱体顶点着色（从底部暗红 → 顶部亮橙）
            const pos = geo.getAttribute('position');
            const vCount = pos.count;
            const cArr = new Float32Array(vCount * 3);
            for (let i = 0; i < vCount; i++) {
                const yVal = pos.getY(i);
                const nt = clamp((yVal + def.height * 0.5) / def.height, 0, 1);
                // 底部：深红 (0.6, 0.0, 0.0)，顶部：亮橙 (1.0, 0.45, 0.0)
                cArr[i * 3]     = THREE.MathUtils.lerp(0.55, 1.0, nt);
                cArr[i * 3 + 1] = THREE.MathUtils.lerp(0.0,  0.42, nt);
                cArr[i * 3 + 2] = 0.0;
            }
            geo.setAttribute('color', new THREE.BufferAttribute(cArr, 3));

            const mat = new THREE.MeshStandardMaterial({
                vertexColors: true,
                emissive: new THREE.Color(0.5, 0.1, 0.0),
                emissiveIntensity: 0.0,
                transparent: true,
                opacity: 0.0,
                side: THREE.DoubleSide,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.name = `MagmaChannel_${idx}`;
            mesh.userData = { def, idx, phaseOffset: idx * 0.8 };
            this.scene.add(mesh);
            this.magmaChannels.push(mesh);
        });
    }

    _updateMagmaChannels(time, intensity, clock) {
        if (!this.magmaChannels.length) return;

        const speedFactor = intensity < 1.0 ? 0.6 : (intensity >= 2.0 ? 1.8 : 1.0);
        const progress = clamp((time - 0.18) / 0.72, 0, 1) * speedFactor;

        const pacX = this.pacific.group.position.x + 54;

        this.magmaChannels.forEach((mesh, idx) => {
            const def = mesh.userData.def;
            const phase = mesh.userData.phaseOffset;

            // 通道位置（跟随板块）
            const chX = pacX + def.relX - 54;
            mesh.position.set(chX, -def.height * 0.5 + 0.5, def.z);

            // 每个通道逐步显示（稍有延迟）
            const delay = idx * 0.08;
            const lp = clamp((progress - delay) / (1.0 - delay), 0, 1);

            // 脉冲：使用不同相位，造成独立跳动感
            const pulseFreq = 1.4 + idx * 0.25;
            const pulse = 0.5 + Math.sin(clock * pulseFreq + phase) * 0.5;

            // 透明度：随进度淡入 + 脉冲
            const baseOp = lp * 0.62;
            mesh.material.opacity = clamp(baseOp * (0.5 + pulse * 0.5), 0, 0.75);

            // 岩浆通道动态发光
            const emBase = lp * intensity * 0.45;
            mesh.material.emissiveIntensity = clamp(emBase * (0.6 + pulse * 0.8), 0, 1.5);

            // 高强度：通道更红更亮
            if (intensity >= 2.0) {
                mesh.material.emissive.setRGB(0.8, 0.12, 0.0);
            } else {
                mesh.material.emissive.setRGB(0.5, 0.08, 0.0);
            }
        });
    }

    // ════════════════════════════════════════════════════════════
    //  4. 接触线（TubeGeometry，发光青蓝，随时间微动）
    // ════════════════════════════════════════════════════════════
    _buildContactLine() {
        // 初始接触线控制点（沿 Z 轴，略有起伏）
        this._contactCurvePoints = [];
        for (let i = 0; i <= 40; i++) {
            const z = (i / 40 - 0.5) * 75;
            const n = noise2D(i * 0.25, 7.0) * 1.2;
            this._contactCurvePoints.push(new THREE.Vector3(0, 0.3 + n * 0.3, z));
        }

        const curve = new THREE.CatmullRomCurve3(this._contactCurvePoints);
        const geo = new THREE.TubeGeometry(curve, 60, 0.22, 8, false);

        const mat = new THREE.MeshStandardMaterial({
            color: new THREE.Color(0.533, 0.867, 1.0),
            emissive: new THREE.Color(0.1, 0.4, 0.6),
            emissiveIntensity: 0.0,
            transparent: true,
            opacity: 0.0,
            roughness: 0.2,
            metalness: 0.3,
        });

        this.contactTube = new THREE.Mesh(geo, mat);
        this.contactTube.name = 'ContactTube';
        this.scene.add(this.contactTube);
    }

    _updateContactLine(time, intensity, clock) {
        if (!this.contactTube) return;

        const progress = clamp((time - 0.04) / 0.88, 0, 1);

        const pacX = this.pacific.group.position.x + 54;
        const euX  = this.eurasia.group.position.x + 55;
        const centerX = (pacX + euX) * 0.5;

        // 微动：每 30 帧重建一次接触线几何体
        if (this._frameCount % 30 === 0 && progress > 0.05) {
            this.contactTube.geometry.dispose();
            const animPts = this._contactCurvePoints.map((pt, i) => {
                const drift = Math.sin(clock * 0.8 + i * 0.18) * 0.35;
                return new THREE.Vector3(pt.x, pt.y + drift, pt.z);
            });
            const newCurve = new THREE.CatmullRomCurve3(animPts);
            this.contactTube.geometry = new THREE.TubeGeometry(newCurve, 60, 0.22, 8, false);
        }

        this.contactTube.position.x = centerX;

        // 发光脉冲（稍慢频率 1.8）
        const pulse = 0.55 + Math.sin(clock * 1.8) * 0.45;
        this.contactTube.material.opacity = clamp(progress * 0.9 * pulse, 0, 0.85);
        // 接触线动态发光
        this.contactTube.material.emissiveIntensity = clamp(
            progress * 1.0 * pulse * intensity,
            0, 2.0
        );

        // 颜色随强度偏移：低强度白蓝，高强度更亮
        const blueShift = clamp(intensity - 1.0, 0, 1);
        this.contactTube.material.color.setRGB(
            0.533 + blueShift * 0.267,
            0.867 - blueShift * 0.067,
            1.0
        );
        this.contactTube.material.emissive.setRGB(
            0.267 + blueShift * 0.2,
            0.667 - blueShift * 0.067,
            0.933
        );
    }

    // ════════════════════════════════════════════════════════════
    //  5. "俯冲带"标签
    // ════════════════════════════════════════════════════════════
    _buildSubductionLabel() {
        // 使用 Canvas 渲染文字为贴图
        const canvas = document.createElement('canvas');
        canvas.width  = 256;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');

        ctx.clearRect(0, 0, 256, 64);
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillRect(0, 0, 256, 64);

        // 白色文字，带细描边
        ctx.font = 'bold 28px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        // 外发光效果
        ctx.shadowColor = 'rgba(100, 220, 255, 0.9)';
        ctx.shadowBlur  = 14;
        ctx.fillStyle   = '#ffffff';
        ctx.fillText('俯冲带', 128, 32);

        const texture = new THREE.CanvasTexture(canvas);
        const geo = new THREE.PlaneGeometry(16, 4);
        const mat = new THREE.MeshStandardMaterial({
            map: texture,
            transparent: true,
            opacity: 0.0,
            depthWrite: false,
            side: THREE.DoubleSide,
            roughness: 0.5,
            metalness: 0.0,
        });

        this.subductionLabel = new THREE.Mesh(geo, mat);
        this.subductionLabel.name = 'SubductionLabel';
        this.scene.add(this.subductionLabel);
    }

    // ════════════════════════════════════════════════════════════
    //  6. 海水流动方向箭头（太平洋板块表面，青蓝色，指示板块运动方向）
    // ════════════════════════════════════════════════════════════
    _buildFlowArrows() {
        // 箭头分布在太平洋板块的海水区域
        const arrowPositions = [
            { x: -92, y: 4.6,  z: -25 },
            { x: -72, y: 4.2,  z: 4  },
            { x: -54, y: 4.8,  z: -18 },
            { x: -100, y: 4.2, z: 20 },
            { x: -78, y: 4.6,  z: 28 },
            { x: -60, y: 4.0,  z: -4 },
            { x: -86, y: 5.0,  z: 2 },
            { x: -44, y: 4.3,  z: 16 },
        ];

        for (const pos of arrowPositions) {
            // 创建扁平箭头几何体（在 XZ 平面上，朝 +X 方向）
            const arrowVerts = new Float32Array([
                // 箭头头部三角形
                 3.0, 0,  0,    // 箭头尖端
                -0.5, 0, -1.5,  // 左翼
                -0.5, 0,  1.5,  // 右翼
                // 箭头杆
                -2.5, 0, -0.5,  // 左下
                 0.0, 0, -0.5,  // 右下
                -2.5, 0,  0.5,  // 左上
                 0.0, 0,  0.5,  // 右上
            ]);

            const arrowIndices = [
                0, 1, 2,       // 箭头头部
                3, 5, 4,       // 杆左三角
                4, 5, 6,       // 杆右三角
            ];

            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.Float32BufferAttribute(arrowVerts, 3));
            geo.setIndex(arrowIndices);
            geo.computeVertexNormals();

            const mat = new THREE.MeshStandardMaterial({
                color: new THREE.Color(0.3, 0.85, 1.0),  // 青蓝色
                emissive: new THREE.Color(0.1, 0.4, 0.6),
                emissiveIntensity: 0.5,
                transparent: true,
                opacity: 0.0,
                side: THREE.DoubleSide,
                depthWrite: false,
                roughness: 0.3,
                metalness: 0.2,
            });

            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(pos.x, pos.y, pos.z);
            mesh.userData = { phase: Math.random() * Math.PI * 2, initX: pos.x };
            this.scene.add(mesh);
            this._flowArrows.push(mesh);
        }
    }

    _updateFlowArrows(time, intensity, clock) {
        if (!this._flowArrows.length) return;
        const progress = Math.min(time * 2, 1.0);  // 快速淡入

        for (const arrow of this._flowArrows) {
            const pulse = 0.6 + Math.sin(clock * 1.8 + arrow.userData.phase) * 0.4;
            arrow.material.opacity = progress * 0.7 * pulse;

            // 箭头随板块轻微移动（跟随 pacific plate 的运动趋势）
            arrow.position.x = arrow.userData.initX + Math.sin(clock * 0.6 + arrow.userData.phase) * 2.2 + time * 6.0;
        }
    }

    _updateSubductionLabel(time, intensity, clock) {
        if (!this.subductionLabel) return;

        const progress = clamp((time - 0.06) / 0.85, 0, 1);

        const pacX = this.pacific.group.position.x + 54;
        const euX  = this.eurasia.group.position.x + 55;
        const centerX = (pacX + euX) * 0.5;

        // 标签位置：接触线附近，抬高一些避免和地形重叠
        this.subductionLabel.position.set(centerX, 10.5, -7);
        // 始终朝向相机（面向 Z 轴正方向）
        this.subductionLabel.rotation.set(0, 0, 0);

        // 缓慢出现
        const pulse = 0.7 + Math.sin(clock * 1.2) * 0.3;
        this.subductionLabel.material.opacity = clamp(progress * pulse, 0, 0.95);
    }
}
