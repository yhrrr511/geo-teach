/**
 * 粒子系统 v3.0
 * 管理：星空 / 岩浆 / 洋中脊 / 热液白烟 / 火山灰 / 岩石碎片 / 水蒸气 / 火花 / 地幔热流
 * 总容量 MAX_PARTICLES = 5000
 */

import * as THREE from 'three';

/** 单个粒子数据 */
class Particle {
    constructor(x, y, z, vx, vy, vz, life, type = 'magma') {
        this.pos = new THREE.Vector3(x, y, z);
        this.vel = new THREE.Vector3(vx, vy, vz);
        this.age  = 0;
        this.life = life;
        this.type = type;
        // 'magma' | 'ridge' | 'smoke' | 'ash' | 'debris' | 'steam' | 'ember' | 'mantle'
        this.size  = 1.0;
        this.phase = Math.random() * Math.PI * 2; // 用于独立随机相位
    }
    get alive() { return this.age < this.life; }
    get ratio() { return this.age / this.life; }
}

// ─────────────────────────────────────────────────────────────────────────────
//  岩浆/火花 顶点着色器 — 粒子生命早期更大更亮，末期缩小变暗
// ─────────────────────────────────────────────────────────────────────────────
const MAGMA_VERT = /* glsl */`
    attribute float alpha;
    attribute float size;
    attribute float ratio;
    varying vec3  vColor;
    varying float vAlpha;
    varying float vRatio;

    void main(){
        vColor = color;
        vAlpha = alpha;
        vRatio = ratio;

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        // 生命前期更大更亮，末期缩小
        float sz = size * (1.0 - ratio * 0.5) * 10.0 * (300.0 / -mvPos.z);
        gl_PointSize = max(1.0, sz);
        gl_Position  = projectionMatrix * mvPos;
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  岩浆/火花 片元着色器 — 外圈柔和光晕 + 中心高温白核 + 年龄颜色变化
// ─────────────────────────────────────────────────────────────────────────────
const MAGMA_FRAG = /* glsl */`
    varying vec3  vColor;
    varying float vAlpha;
    varying float vRatio;

    void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;

        // 外圈柔和光晕（additive blending 下效果）
        float glow  = exp(-d * 6.0) * 0.6;
        // 中心高温白核
        float core  = exp(-d * 18.0);
        float alpha = (glow + core * 0.9) * vAlpha;

        // 随年龄：亮白 → 橙红 → 暗红 → 消散
        vec3 hotWhite  = vec3(1.0, 0.95, 0.7);
        vec3 orange    = vColor;
        vec3 darkRed   = vec3(0.5, 0.05, 0.0);

        vec3 col;
        if(vRatio < 0.3){
            col = mix(hotWhite, orange, vRatio / 0.3);
        } else if(vRatio < 0.75){
            col = mix(orange, darkRed, (vRatio - 0.3) / 0.45);
        } else {
            col = darkRed;
        }

        // 中心叠加白热
        col += core * vec3(0.5, 0.35, 0.1);

        gl_FragColor = vec4(col, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  烟雾 / 水蒸气 顶点着色器 — 随生命膨胀
// ─────────────────────────────────────────────────────────────────────────────
const SMOKE_VERT = /* glsl */`
    attribute float alpha;
    attribute float size;
    varying float vAlpha;

    void main(){
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float sz = size * (220.0 / -mvPos.z);
        gl_PointSize = max(2.0, sz);
        gl_Position  = projectionMatrix * mvPos;
    }
`;

const SMOKE_FRAG = /* glsl */`
    varying float vAlpha;
    void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;
        float a = smoothstep(0.5, 0.05, d) * vAlpha * 0.6;
        gl_FragColor = vec4(0.84, 0.88, 0.93, a);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  灰烬 / 碎片 顶点 & 片元着色器
// ─────────────────────────────────────────────────────────────────────────────
const ASH_VERT = /* glsl */`
    attribute float alpha;
    attribute float size;
    varying float vAlpha;
    varying vec3  vColor;
    void main(){
        vAlpha = alpha;
        vColor = color;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float sz = size * (200.0 / -mvPos.z);
        gl_PointSize = max(1.0, sz);
        gl_Position  = projectionMatrix * mvPos;
    }
`;

const ASH_FRAG = /* glsl */`
    varying float vAlpha;
    varying vec3  vColor;
    void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;
        float a = smoothstep(0.5, 0.1, d) * vAlpha * 0.65;
        gl_FragColor = vec4(vColor, a);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  地幔热流 顶点 & 片元着色器 — 大型缓慢上升，热红渐消
// ─────────────────────────────────────────────────────────────────────────────
const MANTLE_VERT = /* glsl */`
    attribute float alpha;
    attribute float size;
    varying float vAlpha;
    void main(){
        vAlpha = alpha;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        float sz = size * (380.0 / -mvPos.z);
        gl_PointSize = max(2.0, sz);
        gl_Position  = projectionMatrix * mvPos;
    }
`;

const MANTLE_FRAG = /* glsl */`
    varying float vAlpha;
    void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;
        float glow = exp(-d * 4.5) * vAlpha;
        gl_FragColor = vec4(0.85, 0.28, 0.02, glow * 0.75);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
//  星空 顶点 & 片元着色器 — 带独立相位闪烁
// ─────────────────────────────────────────────────────────────────────────────
const STAR_VERT = /* glsl */`
    attribute float size;
    attribute float phase;
    uniform  float uTime;
    varying  vec3  vColor;
    varying  float vTwinkle;

    void main(){
        vColor   = color;
        // 每颗星独立相位的亮度波动
        vTwinkle = 0.6 + 0.4 * sin(uTime * 2.0 + phase);

        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * vTwinkle * (450.0 / -mvPos.z);
        gl_Position  = projectionMatrix * mvPos;
    }
`;

const STAR_FRAG = /* glsl */`
    varying vec3  vColor;
    varying float vTwinkle;
    void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        if(d > 0.5) discard;
        float alpha = smoothstep(0.5, 0.08, d) * vTwinkle;
        float core  = smoothstep(0.3, 0.0, d);
        gl_FragColor = vec4(vColor + core * 0.35, alpha);
    }
`;

// ─────────────────────────────────────────────────────────────────────────────
export class ParticleSystem {
    constructor(scene) {
        this.scene = scene;

        /** 星空（静态 Points） */
        this.starfield  = null;
        /** 星云平面数组 */
        this._nebulae   = [];

        /**
         * 动态粒子池
         * 岩浆类(magma/ridge/ember) ≤ 3000
         * 烟雾类(smoke/steam/mantle) ≤ 1500
         * 灰烬类(ash/debris) ≤ 500
         */
        this.pool          = [];
        this.MAX_PARTICLES = 5000;
        this.MAGMA_CAP     = 3000;
        this.SMOKE_CAP     = 1500;
        this.ASH_CAP       = 500;

        // GPU Points 对象
        this._magmaPoints  = null; // magma / ridge / ember
        this._smokePoints  = null; // smoke / steam
        this._ashPoints    = null; // ash / debris
        this._mantlePoints = null; // mantle

        this._initMagmaPoints();
        this._initSmokePoints();
        this._initAshPoints();
        this._initMantlePoints();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 星空
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 创建星空 + 星云背景
     * @param {number} count 星星数量，默认 4000
     */
    createStarfield(count = 4000) {
        const geo    = new THREE.BufferGeometry();
        const pos    = new Float32Array(count * 3);
        const col    = new Float32Array(count * 3);
        const sizes  = new Float32Array(count);
        const phases = new Float32Array(count); // 独立闪烁相位

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi   = Math.acos(Math.random() * 2 - 1);
            const r     = 850 + Math.random() * 250;
            pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
            pos[i * 3 + 1] = r * Math.cos(phi);
            pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

            const cv = Math.random();
            if (cv < 0.5) {
                col[i*3]=1;    col[i*3+1]=1;    col[i*3+2]=1;     // 白
            } else if (cv < 0.7) {
                col[i*3]=0.65; col[i*3+1]=0.8;  col[i*3+2]=1;     // 淡蓝
            } else if (cv < 0.85) {
                col[i*3]=0.9;  col[i*3+1]=0.7;  col[i*3+2]=1;     // 淡紫
            } else if (cv < 0.94) {
                col[i*3]=1;    col[i*3+1]=0.92; col[i*3+2]=0.6;   // 淡黄（老星）
            } else {
                col[i*3]=1;    col[i*3+1]=0.5;  col[i*3+2]=0.5;   // 红矮星
            }

            sizes[i]  = 0.6 + Math.random() * 3.2;
            phases[i] = Math.random() * Math.PI * 2;
        }

        geo.setAttribute('position', new THREE.BufferAttribute(pos,    3));
        geo.setAttribute('color',    new THREE.BufferAttribute(col,    3));
        geo.setAttribute('size',     new THREE.BufferAttribute(sizes,  1));
        geo.setAttribute('phase',    new THREE.BufferAttribute(phases, 1));

        const mat = new THREE.ShaderMaterial({
            vertexShader:   STAR_VERT,
            fragmentShader: STAR_FRAG,
            transparent:    true,
            vertexColors:   true,
            depthWrite:     false,
            uniforms: {
                uTime: { value: 0 },
            },
        });

        this.starfield      = new THREE.Points(geo, mat);
        this.starfield.name = 'Starfield';
        this.scene.add(this.starfield);

        // 星云背景
        this._addNebulaBackground();
    }

    _addNebulaBackground() {
        // 深色背景球
        const bgGeo = new THREE.SphereGeometry(900, 32, 16);
        const bgMat = new THREE.MeshBasicMaterial({ color: 0x020810, side: THREE.BackSide });
        this.scene.add(new THREE.Mesh(bgGeo, bgMat));

        // 4 个大型半透明圆形渐变星云面片，位于远景不同方位
        const nebulaConfigs = [
            { color: 0x0a1535, opacity: 0.14, pos: [0,    0,   -800], rot: [Math.PI/4,  0, 0],             w: 1200, h: 400 },
            { color: 0x1a0a28, opacity: 0.10, pos: [600,  200, -700], rot: [0,           Math.PI/6, 0.3],   w:  800, h: 350 },
            { color: 0x041820, opacity: 0.08, pos: [-500, 100, -750], rot: [Math.PI/5,  -Math.PI/7, 0],     w:  700, h: 300 },
            { color: 0x120818, opacity: 0.09, pos: [200, -300, -780], rot: [-Math.PI/5,  0.4, 0],            w:  900, h: 280 },
        ];

        for (const cfg of nebulaConfigs) {
            const geo  = new THREE.PlaneGeometry(cfg.w, cfg.h, 1, 1);
            const mat  = new THREE.MeshBasicMaterial({
                color:       cfg.color,
                transparent: true,
                opacity:     cfg.opacity,
                side:        THREE.DoubleSide,
                depthWrite:  false,
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(...cfg.pos);
            mesh.rotation.set(...cfg.rot);
            this._nebulae.push(mesh);
            this.scene.add(mesh);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 动态粒子 GPU Points 初始化
    // ─────────────────────────────────────────────────────────────────────────
    _initMagmaPoints() {
        const n   = this.MAGMA_CAP;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        geo.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(n),     1));
        geo.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
        geo.setAttribute('ratio',    new THREE.BufferAttribute(new Float32Array(n),     1));
        geo.setDrawRange(0, 0);

        const mat = new THREE.ShaderMaterial({
            vertexShader:   MAGMA_VERT,
            fragmentShader: MAGMA_FRAG,
            transparent:    true,
            vertexColors:   true,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
        });

        this._magmaPoints      = new THREE.Points(geo, mat);
        this._magmaPoints.name = 'MagmaParticles';
        this.scene.add(this._magmaPoints);
    }

    _initSmokePoints() {
        const n   = this.SMOKE_CAP;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        geo.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(n),     1));
        geo.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(n).fill(12), 1));
        geo.setDrawRange(0, 0);

        const mat = new THREE.ShaderMaterial({
            vertexShader:   SMOKE_VERT,
            fragmentShader: SMOKE_FRAG,
            transparent:    true,
            blending:       THREE.NormalBlending,
            depthWrite:     false,
        });

        this._smokePoints      = new THREE.Points(geo, mat);
        this._smokePoints.name = 'SmokeParticles';
        this.scene.add(this._smokePoints);
    }

    _initAshPoints() {
        const n   = this.ASH_CAP;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        geo.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(n),     1));
        geo.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(n).fill(4), 1));
        geo.setDrawRange(0, 0);

        const mat = new THREE.ShaderMaterial({
            vertexShader:   ASH_VERT,
            fragmentShader: ASH_FRAG,
            transparent:    true,
            vertexColors:   true,
            blending:       THREE.NormalBlending,
            depthWrite:     false,
        });

        this._ashPoints      = new THREE.Points(geo, mat);
        this._ashPoints.name = 'AshParticles';
        this.scene.add(this._ashPoints);
    }

    _initMantlePoints() {
        const n   = 800; // 地幔热流粒子上限
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
        geo.setAttribute('alpha',    new THREE.BufferAttribute(new Float32Array(n),     1));
        geo.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(n).fill(18), 1));
        geo.setDrawRange(0, 0);

        const mat = new THREE.ShaderMaterial({
            vertexShader:   MANTLE_VERT,
            fragmentShader: MANTLE_FRAG,
            transparent:    true,
            blending:       THREE.AdditiveBlending,
            depthWrite:     false,
        });

        this._mantlePoints      = new THREE.Points(geo, mat);
        this._mantlePoints.name = 'MantleParticles';
        this.scene.add(this._mantlePoints);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 粒子生成 API
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 生成岩浆粒子（火山喷口 / 俯冲带）
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number[]} vel [vx, vy, vz]
     * @param {number} life 粒子寿命（秒）
     * @param {boolean} isRidge 是否为洋中脊类型
     */
    spawnMagma(x, y, z, vel, life = 2.0, isRidge = false) {
        const magmaCount = this.pool.filter(p => p.type === 'magma' || p.type === 'ridge' || p.type === 'ember').length;
        if (magmaCount >= this.MAGMA_CAP) return;
        const p  = new Particle(x, y, z, vel[0], vel[1], vel[2], life, isRidge ? 'ridge' : 'magma');
        p.size   = 0.8 + Math.random() * 0.7;
        this.pool.push(p);
    }

    /**
     * 生成热液白烟粒子
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number[]} vel [vx, vy, vz]
     */
    spawnHydroSmoke(x, y, z, vel) {
        const smokeCount = this.pool.filter(p => p.type === 'smoke' || p.type === 'steam').length;
        if (smokeCount >= this.SMOKE_CAP) return;
        const p = new Particle(x, y, z, vel[0], vel[1], vel[2], 3.5 + Math.random(), 'smoke');
        p.size  = 10 + Math.random() * 8;
        this.pool.push(p);
    }

    /**
     * 生成火山灰粒子
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number[]} vel [vx, vy, vz]
     * @param {number} life 粒子寿命（秒）
     */
    spawnAsh(x, y, z, vel, life = 1.5) {
        const ashCount = this.pool.filter(p => p.type === 'ash' || p.type === 'debris').length;
        if (ashCount >= this.ASH_CAP) return;
        const p = new Particle(x, y, z, vel[0], vel[1], vel[2], life, 'ash');
        p.size  = 3 + Math.random() * 3;
        this.pool.push(p);
    }

    /**
     * 批量生成地幔热流粒子（扩张边界用）
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} count 批量数量
     */
    spawnMantleFlow(x, y, z, count = 20) {
        const smokeCount = this.pool.filter(p => p.type === 'smoke' || p.type === 'steam' || p.type === 'mantle').length;
        const available  = Math.min(count, this.SMOKE_CAP - smokeCount);
        for (let i = 0; i < available; i++) {
            const spread = 8;
            const vx = (Math.random() - 0.5) * 1.2;
            const vy = 0.3 + Math.random() * 0.5;
            const vz = (Math.random() - 0.5) * 1.2;
            const p  = new Particle(
                x + (Math.random() - 0.5) * spread,
                y,
                z + (Math.random() - 0.5) * spread,
                vx, vy, vz,
                4.0 + Math.random() * 2.0,
                'mantle'
            );
            p.size = 14 + Math.random() * 10;
            this.pool.push(p);
        }
    }

    /**
     * 生成地震碎片（消亡边界强烈地震时）
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} intensity 地震强度 0~1
     */
    spawnDebris(x, y, z, intensity) {
        const ashCount = this.pool.filter(p => p.type === 'ash' || p.type === 'debris').length;
        const cnt      = Math.floor(intensity * 12);
        for (let i = 0; i < cnt && ashCount + i < this.ASH_CAP; i++) {
            const spd = intensity * 4 + Math.random() * 3;
            const ang = Math.random() * Math.PI * 2;
            const p   = new Particle(
                x + (Math.random() - 0.5) * 3,
                y + Math.random() * 2,
                z + (Math.random() - 0.5) * 3,
                Math.cos(ang) * spd * 0.8,
                spd * (0.5 + Math.random() * 0.5),
                Math.sin(ang) * spd * 0.8,
                0.8 + Math.random() * 0.8,
                'debris'
            );
            p.size = 3 + Math.random() * 4;
            this.pool.push(p);
        }
    }

    /**
     * 生成水蒸气（板块入海时）
     * @param {number} x
     * @param {number} y
     * @param {number} z
     */
    spawnSteam(x, y, z) {
        const smokeCount = this.pool.filter(p => p.type === 'smoke' || p.type === 'steam' || p.type === 'mantle').length;
        const cnt = 8;
        for (let i = 0; i < cnt && smokeCount + i < this.SMOKE_CAP; i++) {
            const p = new Particle(
                x + (Math.random() - 0.5) * 5,
                y,
                z + (Math.random() - 0.5) * 5,
                (Math.random() - 0.5) * 1.5,
                1.5 + Math.random() * 1.5,
                (Math.random() - 0.5) * 1.5,
                2.0 + Math.random() * 1.5,
                'steam'
            );
            // 水蒸气：大型粒子，随生命快速膨胀
            p.size = 14 + Math.random() * 10;
            this.pool.push(p);
        }
    }

    /**
     * 生成火花粒子（火山弧活跃时）
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} count 数量
     */
    spawnEmber(x, y, z, count = 5) {
        const magmaCount = this.pool.filter(p => p.type === 'magma' || p.type === 'ridge' || p.type === 'ember').length;
        const cnt = Math.min(count, this.MAGMA_CAP - magmaCount);
        for (let i = 0; i < cnt; i++) {
            const ang = Math.random() * Math.PI * 2;
            const spd = 1.5 + Math.random() * 3;
            const p   = new Particle(
                x + (Math.random() - 0.5) * 2,
                y,
                z + (Math.random() - 0.5) * 2,
                Math.cos(ang) * spd * 0.6,
                spd,
                Math.sin(ang) * spd * 0.6,
                0.8 + Math.random() * 0.6,
                'ember'
            );
            p.size = 0.3 + Math.random() * 0.4;
            this.pool.push(p);
        }
    }

    /**
     * 清空所有粒子
     */
    clearAll() {
        this.pool = [];
        this._magmaPoints.geometry.setDrawRange(0, 0);
        this._smokePoints.geometry.setDrawRange(0, 0);
        this._ashPoints.geometry.setDrawRange(0, 0);
        this._mantlePoints.geometry.setDrawRange(0, 0);
    }

    /**
     * 兼容旧 API：清空岩浆粒子（保留烟雾灰烬）
     */
    clearMagma() {
        this.pool = this.pool.filter(p => p.type === 'smoke' || p.type === 'ash');
        this._magmaPoints.geometry.setDrawRange(0, 0);
    }

    /**
     * 生成地震波粒子（地震事件触发时，向四周扩散的岩石碎片 + 火花）
     * @param {THREE.Vector3} origin 地震波起源坐标
     * @param {number} magnitude 地震量级 (0.5~3.0)
     */
    spawnSeismicWave(origin, magnitude = 1.0) {
        const x = origin ? origin.x : 0;
        const y = origin ? origin.y : 0;
        const z = origin ? origin.z : 0;

        // 环状扩散碎片
        const existAsh = this.pool.filter(p => p.type === 'ash' || p.type === 'debris').length;
        const debrisCount = Math.min(Math.floor(magnitude * 10), this.ASH_CAP - existAsh);
        for (let i = 0; i < debrisCount; i++) {
            const angle = (i / Math.max(debrisCount, 1)) * Math.PI * 2 + Math.random() * 0.4;
            const radSpeed = 1.5 + magnitude * 2.5 + Math.random() * 2.0;
            const p = new Particle(
                x + (Math.random() - 0.5) * 3,
                y + Math.random() * 2,
                z + (Math.random() - 0.5) * 3,
                Math.cos(angle) * radSpeed,
                radSpeed * (0.2 + Math.random() * 0.5),
                Math.sin(angle) * radSpeed,
                0.6 + Math.random() * magnitude * 0.5,
                'debris'
            );
            p.size = 2.5 + Math.random() * 3.5;
            this.pool.push(p);
        }

        // 地震火花
        const existMagma = this.pool.filter(p => p.type === 'magma' || p.type === 'ridge' || p.type === 'ember').length;
        const emberCount = Math.min(Math.floor(magnitude * 5), this.MAGMA_CAP - existMagma);
        for (let i = 0; i < emberCount; i++) {
            const angle = Math.random() * Math.PI * 2;
            const spd = magnitude * 2 + Math.random() * 3;
            const p = new Particle(
                x + (Math.random() - 0.5) * 5,
                y + Math.random(),
                z + (Math.random() - 0.5) * 5,
                Math.cos(angle) * spd * 0.7,
                spd * (0.6 + Math.random() * 0.5),
                Math.sin(angle) * spd * 0.7,
                0.5 + Math.random() * 0.6,
                'ember'
            );
            p.size = 0.3 + Math.random() * 0.5;
            this.pool.push(p);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 更新循环
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * 每帧更新粒子
     * @param {number|THREE.Clock} clock 累计时间秒数（数值）或 THREE.Clock 对象
     * @param {number} intensity 强度参数（影响湍流）
     * @param {number} delta 帧间隔秒数（防止高帧率飞太快）
     */
    update(clock, intensity, delta) {
        // 防御：delta 未传入时使用固定值
        const dt  = (delta && delta > 0 && delta < 0.1) ? delta : 0.016;
        // 兼容 THREE.Clock 对象和数值类型 clock
        const t   = (clock && typeof clock.getElapsedTime === 'function') ? clock.getElapsedTime() : (clock || 0);
        const dt60 = dt * 60; // 归一化速度系数（原代码使用 dt*60 步进）

        // 星空缓慢旋转 + 闪烁 uniform 更新
        if (this.starfield) {
            this.starfield.rotation.y += 0.00004 * dt60;
            this.starfield.rotation.x += 0.000008 * dt60;
            this.starfield.material.uniforms.uTime.value = t;
        }

        // 风场周期力（基于时间的横向周期力）
        const windX = Math.sin(t * 0.4) * 0.03;
        const windZ = Math.cos(t * 0.3) * 0.025;

        // 更新粒子物理
        for (let i = this.pool.length - 1; i >= 0; i--) {
            const p = this.pool[i];
            p.age += dt;

            if (!p.alive) {
                this.pool.splice(i, 1);
                continue;
            }

            switch (p.type) {
                case 'magma':
                case 'ridge':
                    // 受重力弧线下落，轻微湍流
                    p.vel.y -= 9.8 * dt * 0.09;
                    p.vel.multiplyScalar(0.982);
                    p.pos.addScaledVector(p.vel, dt60);
                    p.pos.x += (Math.random() - 0.5) * 0.028 * dt60;
                    p.pos.z += (Math.random() - 0.5) * 0.028 * dt60;
                    break;

                case 'ember':
                    // 细小火花：重力大，随机飘散，发光
                    p.vel.y -= 9.8 * dt * 0.12;
                    p.vel.multiplyScalar(0.975);
                    p.pos.addScaledVector(p.vel, dt60);
                    p.pos.x += (Math.random() - 0.5) * 0.05 * dt60;
                    p.pos.z += (Math.random() - 0.5) * 0.05 * dt60;
                    break;

                case 'smoke':
                    // 热液白烟：轻微上浮，受风场影响横向扩散
                    p.vel.y -= 9.8 * dt * 0.012;
                    p.vel.multiplyScalar(0.976);
                    p.pos.addScaledVector(p.vel, dt60);
                    p.pos.x += windX * dt60 + (Math.random() - 0.5) * 0.045 * dt60;
                    p.pos.z += windZ * dt60 + (Math.random() - 0.5) * 0.045 * dt60;
                    // 随生命膨胀
                    p.size += 0.08 * dt60;
                    break;

                case 'steam':
                    // 水蒸气：快速上升，迅速膨胀消散
                    p.vel.y -= 9.8 * dt * 0.005;
                    p.vel.multiplyScalar(0.97);
                    p.pos.addScaledVector(p.vel, dt60);
                    p.pos.x += (Math.random() - 0.5) * 0.06 * dt60;
                    p.pos.z += (Math.random() - 0.5) * 0.06 * dt60;
                    p.size  += 0.18 * dt60; // 膨胀更快
                    break;

                case 'ash':
                    // 火山灰：缓慢漂散
                    p.vel.y -= 9.8 * dt * 0.055;
                    p.vel.multiplyScalar(0.990);
                    p.pos.addScaledVector(p.vel, dt60);
                    p.pos.x += windX * 0.5 * dt60 + (Math.random() - 0.5) * 0.02 * dt60;
                    p.pos.z += windZ * 0.5 * dt60 + (Math.random() - 0.5) * 0.02 * dt60;
                    break;

                case 'debris':
                    // 岩石碎片：快速下落，随机旋转（抖动模拟）
                    p.vel.y -= 9.8 * dt * 0.15;
                    p.vel.multiplyScalar(0.985);
                    p.pos.addScaledVector(p.vel, dt60);
                    p.pos.x += (Math.random() - 0.5) * 0.08 * dt60;
                    p.pos.z += (Math.random() - 0.5) * 0.08 * dt60;
                    break;

                case 'mantle':
                    // 地幔热流：缓慢上升，逐渐消散，热对流
                    p.vel.y -= 9.8 * dt * (-0.04); // 上升
                    p.vel.multiplyScalar(0.994);
                    p.pos.addScaledVector(p.vel, dt60);
                    // 对流周期性横向摆动
                    p.pos.x += Math.sin(t * 1.2 + p.phase) * 0.015 * dt60;
                    p.pos.z += Math.cos(t * 0.9 + p.phase) * 0.015 * dt60;
                    break;
            }
        }

        // 更新 GPU 缓冲区
        this._flushToGPU();
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GPU 缓冲区刷新
    // ─────────────────────────────────────────────────────────────────────────
    _flushToGPU() {
        const magmaList  = this.pool.filter(p => p.type === 'magma' || p.type === 'ridge' || p.type === 'ember');
        const smokeList  = this.pool.filter(p => p.type === 'smoke' || p.type === 'steam');
        const ashList    = this.pool.filter(p => p.type === 'ash'   || p.type === 'debris');
        const mantleList = this.pool.filter(p => p.type === 'mantle');

        // ── 岩浆/洋中脊/火花 ──
        this._updatePointsBuffer(this._magmaPoints, magmaList, (p, r, i, posArr, colArr, alpArr, sizeArr, ratioArr) => {
            const i3 = i * 3;
            posArr[i3]   = p.pos.x;
            posArr[i3+1] = p.pos.y;
            posArr[i3+2] = p.pos.z;

            if (p.type === 'ridge') {
                // 洋中脊岩浆：更亮的橙白热光
                const t = 1 - r;
                colArr[i3]   = 1.0;
                colArr[i3+1] = 0.2 + 0.6 * t;
                colArr[i3+2] = 0.05 * t;
            } else if (p.type === 'ember') {
                // 火花：亮橙小点
                colArr[i3]   = 1.0;
                colArr[i3+1] = 0.5 + (1 - r) * 0.3;
                colArr[i3+2] = 0.02;
            } else {
                // 俯冲岩浆：橙红→暗红
                colArr[i3]   = 1.0;
                colArr[i3+1] = Math.max(0, 0.55 - r * 0.55);
                colArr[i3+2] = Math.max(0, 0.05 - r * 0.05);
            }

            alpArr[i]   = Math.pow(1 - r, 0.65) * 0.96;
            sizeArr[i]  = p.size * (0.5 + (1 - r) * 0.5);
            ratioArr[i] = r;
        }, true);

        // ── 烟雾/水蒸气 ──
        this._updatePointsBuffer(this._smokePoints, smokeList, (p, r, i, posArr, _c, alpArr, sizeArr) => {
            const i3 = i * 3;
            posArr[i3]   = p.pos.x;
            posArr[i3+1] = p.pos.y;
            posArr[i3+2] = p.pos.z;
            // 淡入淡出
            const life  = r < 0.15 ? r / 0.15 : (1 - r);
            alpArr[i]   = life * (p.type === 'steam' ? 0.5 : 0.72);
            sizeArr[i]  = p.size;
        }, false);

        // ── 灰烬/碎片 ──
        this._updatePointsBuffer(this._ashPoints, ashList, (p, r, i, posArr, colArr, alpArr, sizeArr) => {
            const i3 = i * 3;
            posArr[i3]   = p.pos.x;
            posArr[i3+1] = p.pos.y;
            posArr[i3+2] = p.pos.z;
            if (p.type === 'debris') {
                // 岩石碎片：灰褐色
                colArr[i3]=0.48; colArr[i3+1]=0.38; colArr[i3+2]=0.28;
            } else {
                // 火山灰：棕灰
                colArr[i3]=0.55; colArr[i3+1]=0.42; colArr[i3+2]=0.30;
            }
            alpArr[i]  = (1 - r) * 0.55;
            sizeArr[i] = p.size;
        }, false);

        // ── 地幔热流 ──
        this._updateMantleBuffer(mantleList);
    }

    /**
     * 更新通用 Points 缓冲区
     * @param {THREE.Points} points
     * @param {Particle[]} list
     * @param {Function} setter (p, ratio, index, posArr, colArr, alpArr, sizeArr, ratioArr)
     * @param {boolean} hasRatio 是否有 ratio 属性
     */
    _updatePointsBuffer(points, list, setter, hasRatio) {
        const geo     = points.geometry;
        const posArr  = geo.getAttribute('position').array;
        const colAttr = geo.getAttribute('color');
        const alpArr  = geo.getAttribute('alpha').array;
        const sizeAttr= geo.getAttribute('size');
        const ratioAttr = hasRatio ? geo.getAttribute('ratio') : null;

        const colArr   = colAttr   ? colAttr.array   : null;
        const sizeArr  = sizeAttr  ? sizeAttr.array  : null;
        const ratioArr = ratioAttr ? ratioAttr.array : null;

        const count = Math.min(list.length, posArr.length / 3);
        for (let i = 0; i < count; i++) {
            const p = list[i];
            setter(p, p.ratio, i, posArr, colArr, alpArr, sizeArr, ratioArr);
        }

        geo.getAttribute('position').needsUpdate = true;
        if (colAttr)   colAttr.needsUpdate   = true;
        geo.getAttribute('alpha').needsUpdate = true;
        if (sizeAttr)  sizeAttr.needsUpdate  = true;
        if (ratioAttr) ratioAttr.needsUpdate = true;
        geo.setDrawRange(0, count);
    }

    _updateMantleBuffer(list) {
        const geo     = this._mantlePoints.geometry;
        const posArr  = geo.getAttribute('position').array;
        const alpArr  = geo.getAttribute('alpha').array;
        const sizeArr = geo.getAttribute('size').array;
        const count   = Math.min(list.length, posArr.length / 3);

        for (let i = 0; i < count; i++) {
            const p  = list[i];
            const r  = p.ratio;
            const i3 = i * 3;
            posArr[i3]   = p.pos.x;
            posArr[i3+1] = p.pos.y;
            posArr[i3+2] = p.pos.z;
            alpArr[i]    = Math.pow(1 - r, 1.2) * 0.7;
            sizeArr[i]   = p.size;
        }

        geo.getAttribute('position').needsUpdate = true;
        geo.getAttribute('alpha').needsUpdate    = true;
        geo.getAttribute('size').needsUpdate     = true;
        geo.setDrawRange(0, count);
    }
}
