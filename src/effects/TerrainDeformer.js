/**
 * 地形形变器 v2.0
 *
 * 实现四种高级地形形变：
 *  1. 地震颤动 (applyEarthquake)  — 周期性随机顶点微位移
 *  2. 碰撞隆起 (applyCollisionUplift) — 高斯分布高度隆起
 *  3. 俯冲弯曲 (applySubductionBend) — 前端顶点曲线下沉
 *  4. 裂谷下沉 (applyRiftSubsidence) — 扩张中心顶点逐渐下沉
 *
 * 同时保留旧版 addUplift / addSubsidence API（向下兼容）。
 */

export class TerrainDeformer {
    constructor() {
        /** 旧版变形记录（向下兼容） */
        this.deformations = [];

        /**
         * 顶点原始坐标缓存
         * key: BufferGeometry uuid → Float32Array（原始 y 坐标快照）
         * @type {Map<string, Float32Array>}
         */
        this._origY = new Map();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 内部辅助
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 获取（或初始化）几何体的原始 Y 坐标快照
     * @param {THREE.BufferGeometry} geometry
     * @returns {Float32Array}
     */
    _getOrigY(geometry) {
        const key = geometry.uuid;
        if (!this._origY.has(key)) {
            const positions = geometry.getAttribute('position').array;
            const orig = new Float32Array(positions.length / 3);
            for (let i = 0; i < orig.length; i++) {
                orig[i] = positions[i * 3 + 1];
            }
            this._origY.set(key, orig);
        }
        return this._origY.get(key);
    }

    /**
     * 简单哈希函数（用于确定性伪随机，避免每帧 Math.random() 累积漂移）
     * @param {number} seed
     * @returns {number} -1~1
     */
    _hash(seed) {
        const s = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
        return (s - Math.floor(s)) * 2 - 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 新 API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 地震颤动：对整个板块顶点施加周期性小振幅随机位移
     * @param {THREE.Mesh} mesh           目标网格
     * @param {number} centerX            震中 X 坐标
     * @param {number} centerZ            震中 Z 坐标
     * @param {number} magnitude          地震震级 0~1
     * @param {THREE.Clock} clock         时间时钟（驱动周期）
     */
    applyEarthquake(mesh, centerX, centerZ, magnitude, clock) {
        if (!mesh || !mesh.geometry) return;
        const t          = clock ? clock.getElapsedTime() : 0;
        const positions  = mesh.geometry.getAttribute('position');
        const posArr     = positions.array;
        const origY      = this._getOrigY(mesh.geometry);

        // 震动幅度随 magnitude 增大，并随时间高频振荡
        const amp    = magnitude * 0.8;
        const freq   = 12 + magnitude * 18;
        const decay  = 80; // 影响范围衰减系数

        for (let i = 0; i < posArr.length / 3; i++) {
            const i3  = i * 3;
            const vx  = posArr[i3];
            const vz  = posArr[i3 + 2];
            const dist = Math.sqrt((vx - centerX) ** 2 + (vz - centerZ) ** 2);

            // 距震中越近振幅越大
            const influence = Math.exp(-dist / decay);
            const shake     = Math.sin(t * freq + this._hash(i) * 5.0) * amp * influence;

            posArr[i3 + 1] = origY[i] + shake;
        }

        positions.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
    }

    /**
     * 碰撞隆起：从碰撞点中心，按高斯分布进行高度隆起
     * @param {THREE.Mesh} mesh           目标网格
     * @param {number} collisionX         碰撞点 X 坐标
     * @param {number} progress           隆起进度 0~1
     * @param {number} intensity          最大隆起高度
     */
    applyCollisionUplift(mesh, collisionX, progress, intensity) {
        if (!mesh || !mesh.geometry) return;
        const positions = mesh.geometry.getAttribute('position');
        const posArr    = positions.array;
        const origY     = this._getOrigY(mesh.geometry);

        // 高斯分布半径：随进度从窄到宽扩展
        const sigma      = 20 + progress * 30;
        const maxHeight  = intensity * progress;

        for (let i = 0; i < posArr.length / 3; i++) {
            const i3   = i * 3;
            const vx   = posArr[i3];
            const dist = Math.abs(vx - collisionX);

            // 高斯隆起
            const gauss = Math.exp(-(dist * dist) / (2 * sigma * sigma));
            posArr[i3 + 1] = origY[i] + gauss * maxHeight;
        }

        positions.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
    }

    /**
     * 俯冲弯曲：对俯冲板块前端顶点按曲线函数进行弯曲下沉
     * @param {THREE.Mesh} mesh           目标网格
     * @param {number} leadingEdgeX       俯冲前缘 X 坐标
     * @param {number} progress           俯冲进度 0~1
     * @param {number} intensity          最大弯曲深度
     */
    applySubductionBend(mesh, leadingEdgeX, progress, intensity) {
        if (!mesh || !mesh.geometry) return;
        const positions = mesh.geometry.getAttribute('position');
        const posArr    = positions.array;
        const origY     = this._getOrigY(mesh.geometry);

        // 弯曲影响宽度
        const bendWidth = 30 + progress * 20;
        const maxBend   = intensity * progress;

        for (let i = 0; i < posArr.length / 3; i++) {
            const i3   = i * 3;
            const vx   = posArr[i3];
            // 仅对前缘前方（x < leadingEdgeX）的顶点施加弯曲
            const rel  = vx - leadingEdgeX;
            if (rel > 0) {
                posArr[i3 + 1] = origY[i];
                continue;
            }

            const t   = Math.min(1.0, Math.abs(rel) / bendWidth);
            // 三次曲线弯曲函数：t^2*(3-2t)，使末端平滑
            const bend = t * t * (3 - 2 * t) * maxBend;
            posArr[i3 + 1] = origY[i] - bend;
        }

        positions.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
    }

    /**
     * 裂谷下沉：对扩张中心顶点按时间逐渐下沉，形成地堑形态
     * @param {THREE.Mesh} mesh           目标网格
     * @param {number} riftCenterX        裂谷中心 X 坐标
     * @param {number} progress           下沉进度 0~1
     * @param {number} width              裂谷影响宽度
     */
    applyRiftSubsidence(mesh, riftCenterX, progress, width) {
        if (!mesh || !mesh.geometry) return;
        const positions  = mesh.geometry.getAttribute('position');
        const posArr     = positions.array;
        const origY      = this._getOrigY(mesh.geometry);

        const maxDepth   = 15 * progress; // 最大下沉深度
        const halfWidth  = width * 0.5;

        for (let i = 0; i < posArr.length / 3; i++) {
            const i3   = i * 3;
            const vx   = posArr[i3];
            const dist = Math.abs(vx - riftCenterX);

            if (dist > halfWidth) {
                posArr[i3 + 1] = origY[i];
                continue;
            }

            // 余弦形凹陷：中心最深，边缘平滑过渡
            const t     = dist / halfWidth; // 0(中心) ~ 1(边缘)
            const subs  = (1 - Math.cos(t * Math.PI)) * 0.5 * maxDepth;
            // 中心更深 → 反转：中心下沉最多
            const depth = (1 - (1 - Math.cos(t * Math.PI)) * 0.5) * maxDepth;
            posArr[i3 + 1] = origY[i] - depth;
        }

        positions.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 旧版 API（向下兼容）
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 添加隆起效果（旧版 API）
     * @param {THREE.BufferGeometry} geometry
     * @param {{x:number, z:number}} position
     * @param {number} radius
     * @param {number} height
     */
    addUplift(geometry, position, radius, height) {
        const deformation = {
            type: 'uplift',
            position,
            radius,
            height,
            strength: 1.0,
        };
        this.deformations.push(deformation);
        this.applyDeformation(geometry, deformation);
    }

    /**
     * 添加下沉效果（旧版 API）
     * @param {THREE.BufferGeometry} geometry
     * @param {{x:number, z:number}} position
     * @param {number} radius
     * @param {number} depth
     */
    addSubsidence(geometry, position, radius, depth) {
        const deformation = {
            type: 'subsidence',
            position,
            radius,
            depth,
            strength: 1.0,
        };
        this.deformations.push(deformation);
        this.applyDeformation(geometry, deformation);
    }

    /**
     * 应用变形到几何体（旧版 API）
     * @param {THREE.BufferGeometry} geometry
     * @param {object} deformation
     */
    applyDeformation(geometry, deformation) {
        const positions = geometry.getAttribute('position');
        const posArray  = positions.array;

        for (let i = 0; i < posArray.length; i += 3) {
            const x    = posArray[i];
            const z    = posArray[i + 2];
            const dist = Math.sqrt(
                (x - deformation.position.x) ** 2 +
                (z - deformation.position.z) ** 2
            );

            if (dist < deformation.radius) {
                const influence = (1 - dist / deformation.radius) * deformation.strength;
                if (deformation.type === 'uplift') {
                    posArray[i + 1] += influence * deformation.height;
                } else if (deformation.type === 'subsidence') {
                    posArray[i + 1] -= influence * deformation.depth;
                }
            }
        }

        positions.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    /**
     * 更新变形强度（旧版 API）
     * @param {number} index
     * @param {number} strength
     */
    updateStrength(index, strength) {
        if (index >= 0 && index < this.deformations.length) {
            this.deformations[index].strength = strength;
        }
    }

    /**
     * 清空所有变形记录和顶点缓存
     */
    clear() {
        this.deformations = [];
        this._origY.clear();
    }
}
