import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const PARTICLES_PER_DUNE = 20000;
const DUNE_COUNT = 2;
const TOTAL_PARTICLES = PARTICLES_PER_DUNE * DUNE_COUNT;
const GROUND_WIDTH = 120;
const GROUND_DEPTH = 100;
const GROUND_HEIGHT = 3;
const DUNE_RADIUS = 16;
const DUNE_HEIGHT = 9;
const GRAVITY = 15;

export class WindTransportModel {
    constructor(container) {
        this.container = container;
        this.state = {
            windDirection: 0,
            windStrength: 5,
            isPlaying: false,
        };
        this.animationId = null;
        this.prevTime = performance.now();
        this.dunes = [
            { cx: -25, cz: -5, radius: DUNE_RADIUS, height: DUNE_HEIGHT },
            { cx: 25, cz: 8, radius: DUNE_RADIUS, height: DUNE_HEIGHT },
        ];
        this.init();
    }

    init() {
        this.createUI();
        setTimeout(() => {
            try {
                this.setupRenderer();
                this.setupScene();
                this.setupCamera();
                this.setupLights();
                this.createGround();
                this.createParticles();
                this.createWindLines();
                this.bindEvents();
                this.animate();
            } catch (e) {
                console.error('WindTransportModel init error:', e);
                alert('模型初始化出错: ' + e.message);
            }
        }, 100);
        setTimeout(() => {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) overlay.classList.add('hidden');
        }, 500);
    }

    createUI() {
        this.container.innerHTML = `
<div class="app">
<style>#windCanvas{width:100%;height:100%}</style>
<header class="header">
    <div class="scan-line"></div>
    <div class="header-left">
        <div class="header-logo">🏜</div>
        <div class="title-block">
            <div class="title-main">风力搬运作用</div>
            <div class="title-sub">WIND TRANSPORTATION — PARTICLE DUNE MODEL</div>
        </div>
    </div>
    <div class="header-center">
        <div class="header-badge active">▶ 新月形沙丘 · 粒子模拟</div>
    </div>
    <div class="header-right">
        <button id="backToMenuBtn">🏠 返回菜单</button>
        <div class="status-group"><div class="status-dot"></div><div class="status-label">ONLINE</div></div>
    </div>
</header>

<aside class="side-panel left-panel">
    <div class="panel-block orange-accent">
        <div class="block-title orange">实时数据</div>
        <div class="data-row"><span class="data-key">风速</span><span class="data-val" id="windSpeedVal">5.0 m/s</span></div>
        <div class="data-row"><span class="data-key">风向</span><span class="data-val cyan" id="windDirVal">东风 (0°)</span></div>
        <div class="data-row"><span class="data-key">空中粒子</span><span class="data-val yellow" id="airborneCount">0</span></div>
        <div class="data-row"><span class="data-key">总粒子数</span><span class="data-val" id="totalParticles">40000</span></div>
    </div>
    <div class="panel-block">
        <div class="block-title">沙丘特征</div>
        <div style="font-size:10px;color:var(--text2);line-height:1.8;padding:8px 0">
            <div>🌙 <strong>新月形沙丘</strong></div>
            <div>⬅️ 迎风面：沙子被风扬起</div>
            <div>💨 背风面：沙子沉积滑落</div>
            <div>📐 沙丘随风向缓慢迁移</div>
            <div>🔢 每沙丘 20,000 沙砾粒子</div>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">风向图示</div>
        <div style="text-align:center;padding:10px 0">
            <div id="windArrow" style="font-size:48px;color:var(--cyan);text-shadow:0 0 20px var(--glow-c);transition:transform 0.3s">➤</div>
        </div>
    </div>
</aside>

<main class="canvas-wrap">
    <div id="windCanvas"></div>
    <div class="corner-deco tl"></div><div class="corner-deco tr"></div>
    <div class="corner-deco bl"></div><div class="corner-deco br"></div>
    <div class="axis-hint">🖱 拖拽旋转 · 滚轮缩放 · 右键平移</div>
</main>

<aside class="side-panel right-panel">
    <div class="panel-block">
        <div class="block-title">风向控制</div>
        <div class="slider-wrap">
            <div class="slider-header"><span class="slider-label">风向角度</span><span class="slider-value-display cyan" id="dirDisplay">0°</span></div>
            <input type="range" id="dirSlider" min="0" max="360" value="0" step="1" style="--pct:0%">
            <div class="slider-ticks"><span>东</span><span>南</span><span>西</span><span>北</span><span>东</span></div>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">风力强度</div>
        <div class="slider-wrap">
            <div class="slider-header"><span class="slider-label">风速</span><span class="slider-value-display" id="strDisplay">5.0 m/s</span></div>
            <input type="range" id="strSlider" min="1" max="15" value="5" step="0.5" style="--pct:28%">
        </div>
        <div class="legend">
            <div class="legend-item"><div class="legend-dot" style="background:var(--cyan)"></div>软风 1-3</div>
            <div class="legend-item"><div class="legend-dot" style="background:var(--orange)"></div>微风 3-6</div>
            <div class="legend-item"><div class="legend-dot" style="background:#ff2244"></div>强风 >6</div>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">模拟控制</div>
        <div class="btn-group">
            <button class="btn" id="playBtn"><span class="btn-icon">▶</span><span class="btn-text">开始模拟</span></button>
        </div>
        <div class="btn-group" style="margin-top:8px">
            <button class="btn" id="resetBtn"><span class="btn-icon">🔄</span><span class="btn-text">重置沙丘</span></button>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">视角控制</div>
        <div class="btn-group">
            <button class="btn" id="resetViewBtn"><span class="btn-icon">🎯</span><span class="btn-text">重置视角</span></button>
            <button class="btn" id="topViewBtn"><span class="btn-icon">🔭</span><span class="btn-text">俯视视角</span></button>
        </div>
    </div>
</aside>

<footer class="footer">
    <div class="footer-item"><span class="footer-label">风速</span><span class="footer-value" id="ftWindSpeed">5.0 m/s</span></div>
    <div class="footer-item"><span class="footer-label">风向</span><span class="footer-value orange" id="ftWindDir">东风</span></div>
    <div class="footer-item"><span class="footer-label">空中粒子</span><span class="footer-value cyan" id="ftAirborne">0</span></div>
    <div class="footer-item"><span class="footer-label">帧率</span><span class="footer-value green" id="fps">—</span></div>
</footer>
</div>`;
    }

    setupRenderer() {
        const canvasWrap = this.container.querySelector('.canvas-wrap');
        const canvasContainer = this.container.querySelector('#windCanvas');
        this.width = canvasWrap.offsetWidth || 800;
        this.height = canvasWrap.offsetHeight || 600;
        if (this.width < 10) { this.width = window.innerWidth * 0.6; this.height = window.innerHeight * 0.7; }

        this.canvas = document.createElement('canvas');
        this.canvas.style.width = '100%';
        this.canvas.style.height = '100%';
        canvasContainer.appendChild(this.canvas);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1510);
        this.scene.fog = new THREE.Fog(0x1a1510, 80, 250);
    }

    setupCamera() {
        this.defaultCamPos = new THREE.Vector3(55, 45, 65);
        this.defaultCamTarget = new THREE.Vector3(0, 4, 0);
        this.camera = new THREE.PerspectiveCamera(50, this.width / this.height, 0.1, 500);
        this.camera.position.copy(this.defaultCamPos);
        this.camera.lookAt(this.defaultCamTarget);
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.target.copy(this.defaultCamTarget);
        this.controls.minDistance = 25;
        this.controls.maxDistance = 180;
        this.controls.update();
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0xffeedd, 0.5));
        const sun = new THREE.DirectionalLight(0xfff0d0, 1.2);
        sun.position.set(50, 80, 30);
        sun.castShadow = true;
        sun.shadow.mapSize.set(2048, 2048);
        sun.shadow.camera.near = 5;
        sun.shadow.camera.far = 200;
        sun.shadow.camera.left = -80;
        sun.shadow.camera.right = 80;
        sun.shadow.camera.top = 80;
        sun.shadow.camera.bottom = -80;
        this.scene.add(sun);
        this.scene.add(new THREE.DirectionalLight(0xffe8c0, 0.3).position.set(-30, 20, -20));
    }

    createGround() {
        const geom = new THREE.BoxGeometry(GROUND_WIDTH, GROUND_HEIGHT, GROUND_DEPTH);
        const mat = new THREE.MeshStandardMaterial({ color: 0xc49a45, roughness: 0.9, metalness: 0 });
        this.ground = new THREE.Mesh(geom, mat);
        this.ground.position.y = -GROUND_HEIGHT / 2;
        this.ground.receiveShadow = true;
        this.ground.castShadow = true;
        this.scene.add(this.ground);

        const edgeGeom = new THREE.EdgesGeometry(geom);
        const edgeMat = new THREE.LineBasicMaterial({ color: 0x8a6a30, transparent: true, opacity: 0.3 });
        const edge = new THREE.LineSegments(edgeGeom, edgeMat);
        edge.position.copy(this.ground.position);
        this.scene.add(edge);
    }

    createParticles() {
        this.particlePositions = new Float32Array(TOTAL_PARTICLES * 3);
        this.particleVelocities = new Float32Array(TOTAL_PARTICLES * 3);
        this.particleOnGround = new Uint8Array(TOTAL_PARTICLES);
        this.particleDuneIdx = new Uint8Array(TOTAL_PARTICLES);

        for (let d = 0; d < DUNE_COUNT; d++) {
            const dune = this.dunes[d];
            const offset = d * PARTICLES_PER_DUNE;
            let placed = 0;
            const maxAttempts = PARTICLES_PER_DUNE * 3;
            let attempts = 0;

            while (placed < PARTICLES_PER_DUNE && attempts < maxAttempts) {
                attempts++;
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * dune.radius * 1.1;
                const dx = Math.cos(angle) * r;
                const dz = Math.sin(angle) * r;

                const h = this.barchanHeight(dx, dz, dune.radius, dune.height);
                if (h <= 0 && r > dune.radius * 0.3) continue;

                const idx = offset + placed;
                this.particlePositions[idx * 3] = dune.cx + dx;
                this.particlePositions[idx * 3 + 1] = h + (Math.random() - 0.5) * 0.3;
                this.particlePositions[idx * 3 + 2] = dune.cz + dz;
                this.particleVelocities[idx * 3] = 0;
                this.particleVelocities[idx * 3 + 1] = 0;
                this.particleVelocities[idx * 3 + 2] = 0;
                this.particleOnGround[idx] = 1;
                this.particleDuneIdx[idx] = d;
                placed++;
            }

            while (placed < PARTICLES_PER_DUNE) {
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * dune.radius * 0.8;
                const dx = Math.cos(angle) * r;
                const dz = Math.sin(angle) * r;
                const h = Math.max(0.05, this.barchanHeight(dx, dz, dune.radius, dune.height));
                const idx = offset + placed;
                this.particlePositions[idx * 3] = dune.cx + dx;
                this.particlePositions[idx * 3 + 1] = h + (Math.random() - 0.5) * 0.3;
                this.particlePositions[idx * 3 + 2] = dune.cz + dz;
                this.particleOnGround[idx] = 1;
                this.particleDuneIdx[idx] = d;
                placed++;
            }
        }

        const colors = new Float32Array(TOTAL_PARTICLES * 3);
        for (let i = 0; i < TOTAL_PARTICLES; i++) {
            const v = 0.7 + Math.random() * 0.3;
            colors[i * 3] = 0.83 * v;
            colors[i * 3 + 1] = 0.66 * v;
            colors[i * 3 + 2] = 0.40 * v;
        }

        const geom = new THREE.BufferGeometry();
        geom.setAttribute('position', new THREE.BufferAttribute(this.particlePositions, 3));
        geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const mat = new THREE.PointsMaterial({
            size: 0.35,
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            depthWrite: true,
        });

        this.particles = new THREE.Points(geom, mat);
        this.scene.add(this.particles);
    }

    barchanHeight(dx, dz, radius, height) {
        const r = Math.sqrt(dx * dx + dz * dz);
        if (r > radius * 1.15) return 0;

        const angle = Math.atan2(dz, dx);
        const nr = r / radius;

        let h;
        if (Math.cos(angle) > 0) {
            const slipR = Math.min(nr, 0.55);
            h = height * Math.exp(-slipR * slipR * 5);
        } else {
            const windR = Math.min(nr, 0.95);
            h = height * Math.sin(windR * Math.PI * 0.55);
        }

        const crescent = Math.pow(Math.cos(angle * 2.2), 2);
        h *= crescent;
        h *= (1 - nr * 0.25);

        return Math.max(0, h);
    }

    createWindLines() {
        this.windLineGroup = new THREE.Group();
        this.windLineMat = new THREE.LineBasicMaterial({ color: 0x88ccff, transparent: true, opacity: 0.5 });
        this.rebuildWindLines();
        this.scene.add(this.windLineGroup);
    }

    rebuildWindLines() {
        while (this.windLineGroup.children.length) {
            const c = this.windLineGroup.children[0];
            if (c.geometry) c.geometry.dispose();
            this.windLineGroup.remove(c);
        }
        const count = Math.floor(this.state.windStrength * 3);
        const rad = (this.state.windDirection * Math.PI) / 180;
        const len = 4 + this.state.windStrength * 0.4;
        for (let i = 0; i < count; i++) {
            const pts = [];
            const sx = (Math.random() - 0.5) * 100;
            const sy = Math.random() * 12 + 4;
            const sz = (Math.random() - 0.5) * 80;
            const curve = Math.random() * 2 - 1;
            for (let j = 0; j < 8; j++) {
                const t = j / 7;
                pts.push(new THREE.Vector3(
                    sx + Math.cos(rad) * len * t * 3,
                    sy + curve * Math.sin(t * Math.PI) * 2,
                    sz + Math.sin(rad) * len * t * 3
                ));
            }
            const g = new THREE.BufferGeometry().setFromPoints(pts);
            this.windLineGroup.add(new THREE.Line(g, this.windLineMat));
        }
    }

    bindEvents() {
        this.container.querySelector('#backToMenuBtn')?.addEventListener('click', () => {
            import('../app-init.js').then(m => m.showWelcome());
        });

        this.container.querySelector('#dirSlider')?.addEventListener('input', (e) => {
            this.state.windDirection = parseFloat(e.target.value);
            this.rebuildWindLines();
            this.syncUI();
        });

        this.container.querySelector('#strSlider')?.addEventListener('input', (e) => {
            this.state.windStrength = parseFloat(e.target.value);
            this.rebuildWindLines();
            this.syncUI();
        });

        this.container.querySelector('#playBtn')?.addEventListener('click', () => {
            this.state.isPlaying = !this.state.isPlaying;
            const btn = this.container.querySelector('#playBtn');
            if (btn) {
                btn.querySelector('.btn-icon').textContent = this.state.isPlaying ? '⏸' : '▶';
                btn.querySelector('.btn-text').textContent = this.state.isPlaying ? '暂停模拟' : '开始模拟';
            }
        });

        this.container.querySelector('#resetBtn')?.addEventListener('click', () => this.resetParticles());
        this.container.querySelector('#resetViewBtn')?.addEventListener('click', () => {
            this.camera.position.copy(this.defaultCamPos);
            this.controls.target.copy(this.defaultCamTarget);
            this.controls.update();
        });
        this.container.querySelector('#topViewBtn')?.addEventListener('click', () => {
            this.camera.position.set(0, 100, 0);
            this.controls.target.set(0, 0, 0);
            this.controls.update();
        });
        window.addEventListener('resize', () => this.onResize());
    }

    syncUI() {
        const dirSlider = this.container.querySelector('#dirSlider');
        const strSlider = this.container.querySelector('#strSlider');
        if (dirSlider) {
            dirSlider.value = this.state.windDirection;
            dirSlider.style.setProperty('--pct', (this.state.windDirection / 360 * 100) + '%');
        }
        if (strSlider) {
            strSlider.value = this.state.windStrength;
            strSlider.style.setProperty('--pct', ((this.state.windStrength - 1) / 14 * 100) + '%');
        }
        const dirs = ['东风', '东南风', '南风', '西南风', '西风', '西北风', '北风', '东北风'];
        const di = Math.round(this.state.windDirection / 45) % 8;
        const el = (id, v) => { const e = this.container.querySelector(id); if (e) e.textContent = v; };
        el('#dirDisplay', Math.round(this.state.windDirection) + '°');
        el('#strDisplay', this.state.windStrength.toFixed(1) + ' m/s');
        el('#windSpeedVal', this.state.windStrength.toFixed(1) + ' m/s');
        el('#windDirVal', dirs[di] + ' (' + Math.round(this.state.windDirection) + '°)');
        el('#ftWindSpeed', this.state.windStrength.toFixed(1) + ' m/s');
        el('#ftWindDir', dirs[di]);
        const arrow = this.container.querySelector('#windArrow');
        if (arrow) arrow.style.transform = 'rotate(' + this.state.windDirection + 'deg)';
    }

    resetParticles() {
        for (let d = 0; d < DUNE_COUNT; d++) {
            const dune = this.dunes[d];
            const offset = d * PARTICLES_PER_DUNE;
            for (let i = 0; i < PARTICLES_PER_DUNE; i++) {
                const idx = offset + i;
                const angle = Math.random() * Math.PI * 2;
                const r = Math.random() * dune.radius * 0.9;
                const dx = Math.cos(angle) * r;
                const dz = Math.sin(angle) * r;
                const h = Math.max(0.05, this.barchanHeight(dx, dz, dune.radius, dune.height));
                this.particlePositions[idx * 3] = dune.cx + dx;
                this.particlePositions[idx * 3 + 1] = h + (Math.random() - 0.5) * 0.3;
                this.particlePositions[idx * 3 + 2] = dune.cz + dz;
                this.particleVelocities[idx * 3] = 0;
                this.particleVelocities[idx * 3 + 1] = 0;
                this.particleVelocities[idx * 3 + 2] = 0;
                this.particleOnGround[idx] = 1;
            }
        }
        this.particles.geometry.attributes.position.needsUpdate = true;
    }

    updateWindLines(dt) {
        const rad = (this.state.windDirection * Math.PI) / 180;
        const speed = this.state.windStrength * 8;
        this.windLineGroup.children.forEach(line => {
            const pos = line.geometry.attributes.position.array;
            for (let i = 0; i < pos.length; i += 3) {
                pos[i] += Math.cos(rad) * speed * dt;
                pos[i + 2] += Math.sin(rad) * speed * dt;
            }
            if (pos[0] > 60 || pos[0] < -60 || pos[2] > 60 || pos[2] < -60) {
                const rx = -Math.cos(rad) * 50 + (Math.random() - 0.5) * 80;
                const rz = -Math.sin(rad) * 50 + (Math.random() - 0.5) * 80;
                for (let j = 0; j < pos.length; j += 3) {
                    pos[j] = rx + pos[j] - pos[0];
                    pos[j + 2] = rz + pos[j + 2] - pos[2];
                }
            }
            line.geometry.attributes.position.needsUpdate = true;
        });
    }

    updateParticles(dt) {
        if (!this.state.isPlaying) return;

        const windRad = (this.state.windDirection * Math.PI) / 180;
        const windX = Math.cos(windRad);
        const windZ = Math.sin(windRad);
        const windForce = this.state.windStrength * 2.5;
        const groundTop = 0;
        const halfW = GROUND_WIDTH / 2;
        const halfD = GROUND_DEPTH / 2;
        let airborne = 0;

        for (let i = 0; i < TOTAL_PARTICLES; i++) {
            const i3 = i * 3;
            const px = this.particlePositions[i3];
            const py = this.particlePositions[i3 + 1];
            const pz = this.particlePositions[i3 + 2];

            if (this.particleOnGround[i]) {
                const dune = this.dunes[this.particleDuneIdx[i]];
                const dx = px - dune.cx;
                const dz = pz - dune.cz;
                const dot = dx * windX + dz * windZ;

                if (dot < 0 && Math.random() < 0.003 * this.state.windStrength) {
                    this.particleOnGround[i] = 0;
                    this.particleVelocities[i3] = windX * windForce * (0.3 + Math.random() * 0.5);
                    this.particleVelocities[i3 + 1] = 2 + Math.random() * 4;
                    this.particleVelocities[i3 + 2] = windZ * windForce * (0.3 + Math.random() * 0.5);
                    airborne++;
                }
            } else {
                this.particleVelocities[i3] += windX * windForce * dt * 4;
                this.particleVelocities[i3 + 1] -= GRAVITY * dt;
                this.particleVelocities[i3 + 2] += windZ * windForce * dt * 4;

                this.particleVelocities[i3] *= 0.96;
                this.particleVelocities[i3 + 2] *= 0.96;

                this.particlePositions[i3] += this.particleVelocities[i3] * dt;
                this.particlePositions[i3 + 1] += this.particleVelocities[i3 + 1] * dt;
                this.particlePositions[i3 + 2] += this.particleVelocities[i3 + 2] * dt;

                if (this.particlePositions[i3 + 1] <= groundTop) {
                    this.particlePositions[i3 + 1] = groundTop + 0.05;
                    this.particleVelocities[i3] = 0;
                    this.particleVelocities[i3 + 1] = 0;
                    this.particleVelocities[i3 + 2] = 0;
                    this.particleOnGround[i] = 1;
                }

                if (Math.abs(this.particlePositions[i3]) > halfW + 10 ||
                    Math.abs(this.particlePositions[i3 + 2]) > halfD + 10 ||
                    this.particlePositions[i3 + 1] < -20) {
                    const dune = this.dunes[this.particleDuneIdx[i]];
                    const a = Math.random() * Math.PI * 2;
                    const r = Math.random() * dune.radius * 0.5;
                    this.particlePositions[i3] = dune.cx + Math.cos(a) * r;
                    this.particlePositions[i3 + 1] = groundTop + 3;
                    this.particlePositions[i3 + 2] = dune.cz + Math.sin(a) * r;
                    this.particleOnGround[i] = 0;
                }

                airborne++;
            }
        }

        this.particles.geometry.attributes.position.needsUpdate = true;

        const el = this.container.querySelector('#airborneCount');
        if (el) el.textContent = airborne;
        const ft = this.container.querySelector('#ftAirborne');
        if (ft) ft.textContent = airborne;
    }

    onResize() {
        const wrap = this.container.querySelector('.canvas-wrap');
        if (!wrap) return;
        this.width = wrap.offsetWidth || 800;
        this.height = wrap.offsetHeight || 600;
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        const now = performance.now();
        const dt = Math.min((now - this.prevTime) / 1000, 0.05);
        this.prevTime = now;

        this.updateWindLines(dt);
        this.updateParticles(dt);
        this.controls.update();
        this.renderer.render(this.scene, this.camera);

        if (Math.random() < 0.1) {
            const el = this.container.querySelector('#fps');
            if (el) el.textContent = Math.round(1 / dt) + ' fps';
        }
    }

    dispose() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        if (this.renderer) this.renderer.dispose();
        if (this.scene) {
            this.scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
                    else obj.material.dispose();
                }
            });
        }
    }
}