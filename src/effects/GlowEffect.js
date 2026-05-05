/**
 * 发光效果管理器 v2.0
 *
 * 支持三种发光类型：
 *  - PointGlow  : 点光源光晕（用于岩浆喷口）
 *  - EdgeGlow   : 边缘发光线（用于板块边界）
 *  - VolumeGlow : 体积发光面（用于洋中脊热流）
 *
 * 所有光晕支持颜色和强度动态调整。
 *
 * API:
 *   addPointGlow(position, color, size, scene)  → GlowSprite
 *   addEdgeGlow(points, color, width, scene)    → GlowLine
 *   addVolumeGlow(position, color, size, scene) → GlowVolume
 *   updateGlow(glow, intensity, clock)          → void
 *   removeGlow(glow, scene)                     → void
 */

import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────────────────────
//  点光晕着色器（Sprite 贴图：指数衰减光晕）
// ─────────────────────────────────────────────────────────────────────────────
const POINT_GLOW_VERT = /* glsl */`
    uniform float uSize;
    void main(){
        vec4 mvPos = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        gl_PointSize = uSize * (400.0 / -mvPos.z);
        gl_Position  = projectionMatrix * mvPos;
    }
`;

const POINT_GLOW_FRAG = /* glsl */`
    uniform vec3  uGlowColor;
    uniform float uIntensity;
    uniform float uPulse;

    void main(){
        float d     = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;

        // 指数衰减光晕（比线性更自然）
        float glow  = exp(-d * 7.0) * uIntensity * uPulse;
        float halo  = exp(-d * 3.0) * 0.4 * uIntensity * uPulse;
        float alpha = clamp(glow + halo, 0.0, 1.0);

        gl_FragColor = vec4(uGlowColor * (glow + halo * 0.5), alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  边缘发光线着色器
// ─────────────────────────────────────────────────────────────────────────────
const EDGE_GLOW_VERT = /* glsl */`
    attribute float lineAlpha;
    varying  float vAlpha;
    void main(){
        vAlpha      = lineAlpha;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const EDGE_GLOW_FRAG = /* glsl */`
    uniform vec3  uGlowColor;
    uniform float uIntensity;
    uniform float uPulse;
    varying float vAlpha;

    void main(){
        float alpha = vAlpha * uIntensity * uPulse;
        gl_FragColor = vec4(uGlowColor, clamp(alpha, 0.0, 1.0));
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  体积发光面着色器（平面 + 指数径向衰减）
// ─────────────────────────────────────────────────────────────────────────────
const VOLUME_GLOW_VERT = /* glsl */`
    varying vec2 vUv;
    void main(){
        vUv         = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
`;

const VOLUME_GLOW_FRAG = /* glsl */`
    uniform vec3  uGlowColor;
    uniform float uIntensity;
    uniform float uPulse;
    varying vec2  vUv;

    void main(){
        vec2  center = vec2(0.5, 0.5);
        float d      = length(vUv - center) * 2.0; // 0~1
        // 指数衰减径向光晕
        float glow   = exp(-d * 3.5) * uIntensity * uPulse;
        float alpha  = clamp(glow, 0.0, 1.0);
        gl_FragColor = vec4(uGlowColor, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  GlowEffect 主类
// ─────────────────────────────────────────────────────────────────────────────
export class GlowEffect {
    /**
     * @param {THREE.Scene} scene
     * @param {THREE.Object3D[]} glowObjects 兼容旧 API：传入后自动为其增强 emissive
     */
    constructor(scene, glowObjects = []) {
        this.scene       = scene;
        this.glowObjects = glowObjects;
        this.glowLayer   = 1;
        /** @type {Array<THREE.Points|THREE.Line|THREE.Mesh>} 所有托管的光晕对象 */
        this._glowItems  = [];

        // 兼容旧逻辑
        this.initializeGlowEffects();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 旧 API 兼容（保留）
    // ─────────────────────────────────────────────────────────────────────────
    initializeGlowEffects() {
        for (const obj of this.glowObjects) {
            this.addGlowToObject(obj);
        }
    }

    addGlowToObject(object) {
        object.traverse((child) => {
            if (child instanceof THREE.Mesh && child.material) {
                const ei = child.material.emissiveIntensity || 0.1;
                child.material.emissiveIntensity = ei * 1.5;
            }
        });
    }

    update() {
        const time = performance.now() * 0.001;
        for (const obj of this.glowObjects) {
            obj.traverse((child) => {
                if (child instanceof THREE.Mesh && child.material) {
                    const pulse = 0.5 + Math.sin(time * 2) * 0.3;
                    child.material.emissiveIntensity = (child.material.emissiveIntensity || 0.1) * pulse;
                }
            });
        }
    }

    addGlowObject(object) {
        this.glowObjects.push(object);
        this.addGlowToObject(object);
    }

    removeGlowObject(object) {
        const index = this.glowObjects.indexOf(object);
        if (index > -1) this.glowObjects.splice(index, 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 新 API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 添加点光源光晕（PointGlow）
     * 适用于岩浆喷口等局部热点
     * @param {THREE.Vector3} position    世界坐标位置
     * @param {THREE.Color|number} color  光晕颜色
     * @param {number} size               光晕尺寸（像素基准）
     * @param {THREE.Scene} [scene]       目标场景（默认 this.scene）
     * @returns {{mesh: THREE.Points, type: 'point', uniforms: object}} GlowSprite 对象
     */
    addPointGlow(position, color, size = 40, scene) {
        const targetScene = scene || this.scene;
        const col = new THREE.Color(color);

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(
            new Float32Array([position.x, position.y, position.z]), 3
        ));

        const uniforms = {
            uGlowColor: { value: col },
            uSize:      { value: size },
            uIntensity: { value: 1.0 },
            uPulse:     { value: 1.0 },
        };

        const mat  = new THREE.ShaderMaterial({
            vertexShader:   POINT_GLOW_VERT,
            fragmentShader: POINT_GLOW_FRAG,
            uniforms,
            transparent: true,
            blending:    THREE.AdditiveBlending,
            depthWrite:  false,
        });

        const mesh      = new THREE.Points(geo, mat);
        mesh.name       = 'PointGlow';
        const glowSprite = { mesh, type: 'point', uniforms, _baseIntensity: 1.0 };

        targetScene.add(mesh);
        this._glowItems.push(glowSprite);
        return glowSprite;
    }

    /**
     * 添加边缘发光线（EdgeGlow）
     * 适用于板块边界
     * @param {THREE.Vector3[]} points    构成折线的顶点数组
     * @param {THREE.Color|number} color  光晕颜色
     * @param {number} width              线宽（部分浏览器忽略）
     * @param {THREE.Scene} [scene]       目标场景
     * @returns {{mesh: THREE.Line, type: 'edge', uniforms: object}} GlowLine 对象
     */
    addEdgeGlow(points, color, width = 2, scene) {
        const targetScene = scene || this.scene;
        const col = new THREE.Color(color);

        const posArr = new Float32Array(points.length * 3);
        const alpArr = new Float32Array(points.length);

        for (let i = 0; i < points.length; i++) {
            posArr[i * 3]     = points[i].x;
            posArr[i * 3 + 1] = points[i].y;
            posArr[i * 3 + 2] = points[i].z;
            // 端点淡出，中间最亮
            const t = i / (points.length - 1);
            alpArr[i] = Math.sin(t * Math.PI);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position',  new THREE.BufferAttribute(posArr, 3));
        geo.setAttribute('lineAlpha', new THREE.BufferAttribute(alpArr, 1));

        const uniforms = {
            uGlowColor: { value: col },
            uIntensity: { value: 1.0 },
            uPulse:     { value: 1.0 },
        };

        const mat = new THREE.ShaderMaterial({
            vertexShader:   EDGE_GLOW_VERT,
            fragmentShader: EDGE_GLOW_FRAG,
            uniforms,
            transparent: true,
            blending:    THREE.AdditiveBlending,
            depthWrite:  false,
            linewidth:   width,
        });

        const mesh   = new THREE.Line(geo, mat);
        mesh.name    = 'EdgeGlow';
        const glowLine = { mesh, type: 'edge', uniforms, _baseIntensity: 1.0 };

        targetScene.add(mesh);
        this._glowItems.push(glowLine);
        return glowLine;
    }

    /**
     * 添加体积发光面（VolumeGlow）
     * 适用于洋中脊热流、深部热点
     * @param {THREE.Vector3} position    中心位置
     * @param {THREE.Color|number} color  光晕颜色
     * @param {number} size               面片尺寸
     * @param {THREE.Scene} [scene]       目标场景
     * @returns {{mesh: THREE.Mesh, type: 'volume', uniforms: object}} GlowVolume 对象
     */
    addVolumeGlow(position, color, size = 30, scene) {
        const targetScene = scene || this.scene;
        const col = new THREE.Color(color);

        const geo = new THREE.PlaneGeometry(size, size);
        const uniforms = {
            uGlowColor: { value: col },
            uIntensity: { value: 1.0 },
            uPulse:     { value: 1.0 },
        };

        const mat = new THREE.ShaderMaterial({
            vertexShader:   VOLUME_GLOW_VERT,
            fragmentShader: VOLUME_GLOW_FRAG,
            uniforms,
            transparent: true,
            blending:    THREE.AdditiveBlending,
            depthWrite:  false,
            side:        THREE.DoubleSide,
        });

        const mesh    = new THREE.Mesh(geo, mat);
        mesh.position.copy(position);
        mesh.name     = 'VolumeGlow';
        const glowVol = { mesh, type: 'volume', uniforms, _baseIntensity: 1.0 };

        targetScene.add(mesh);
        this._glowItems.push(glowVol);
        return glowVol;
    }

    /**
     * 动态更新发光状态（强度 + 脉搏动画）
     * @param {{uniforms: object, _baseIntensity: number}} glow  addPointGlow / addEdgeGlow / addVolumeGlow 返回的对象
     * @param {number} intensity      基础强度（0~2）
     * @param {THREE.Clock} [clock]   用于驱动脉冲动画
     */
    updateGlow(glow, intensity, clock) {
        if (!glow || !glow.uniforms) return;
        glow._baseIntensity = intensity;
        glow.uniforms.uIntensity.value = intensity;

        if (clock) {
            const t = clock.getElapsedTime();
            // 脉搏：缓慢呼吸式
            glow.uniforms.uPulse.value = 0.75 + 0.25 * Math.sin(t * 1.8 + (glow._phase || 0));
        } else {
            glow.uniforms.uPulse.value = 1.0;
        }
    }

    /**
     * 从场景中移除并销毁光晕
     * @param {{mesh: THREE.Object3D}} glow
     * @param {THREE.Scene} [scene]
     */
    removeGlow(glow, scene) {
        if (!glow || !glow.mesh) return;
        const targetScene = scene || this.scene;
        targetScene.remove(glow.mesh);
        if (glow.mesh.geometry) glow.mesh.geometry.dispose();
        if (glow.mesh.material) glow.mesh.material.dispose();

        const idx = this._glowItems.indexOf(glow);
        if (idx > -1) this._glowItems.splice(idx, 1);
    }

    /**
     * 批量更新所有托管光晕的脉冲（在主循环中调用）
     * @param {THREE.Clock} clock
     */
    tickAll(clock) {
        for (const glow of this._glowItems) {
            this.updateGlow(glow, glow._baseIntensity, clock);
        }
    }
}
