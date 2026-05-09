import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

class SimplexNoise {
    constructor(seed = Math.random()) {
        this.p = new Uint8Array(256);
        this.perm = new Uint8Array(512);
        this.permMod12 = new Uint8Array(512);
        
        for (let i = 0; i < 256; i++) {
            this.p[i] = i;
        }
        
        let n, q;
        for (let i = 255; i > 0; i--) {
            seed = (seed * 16807) % 2147483647;
            n = seed % (i + 1);
            q = this.p[i];
            this.p[i] = this.p[n];
            this.p[n] = q;
        }
        
        for (let i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
        }
        
        this.grad3 = new Float32Array([
            1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
            1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
            0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
        ]);
        
        this.F2 = 0.5 * (Math.sqrt(3) - 1);
        this.G2 = (3 - Math.sqrt(3)) / 6;
    }
    
    noise2D(xin, yin) {
        let n0, n1, n2;
        const s = (xin + yin) * this.F2;
        const i = Math.floor(xin + s);
        const j = Math.floor(yin + s);
        const t = (i + j) * this.G2;
        const X0 = i - t;
        const Y0 = j - t;
        const x0 = xin - X0;
        const y0 = yin - Y0;
        
        let i1, j1;
        if (x0 > y0) {
            i1 = 1;
            j1 = 0;
        } else {
            i1 = 0;
            j1 = 1;
        }
        
        const x1 = x0 - i1 + this.G2;
        const y1 = y0 - j1 + this.G2;
        const x2 = x0 - 1 + 2 * this.G2;
        const y2 = y0 - 1 + 2 * this.G2;
        
        const ii = i & 255;
        const jj = j & 255;
        
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if (t0 < 0) {
            n0 = 0;
        } else {
            t0 *= t0;
            const gi0 = this.permMod12[ii + this.perm[jj]] * 3;
            n0 = t0 * t0 * (this.grad3[gi0] * x0 + this.grad3[gi0 + 1] * y0);
        }
        
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if (t1 < 0) {
            n1 = 0;
        } else {
            t1 *= t1;
            const gi1 = this.permMod12[ii + i1 + this.perm[jj + j1]] * 3;
            n1 = t1 * t1 * (this.grad3[gi1] * x1 + this.grad3[gi1 + 1] * y1);
        }
        
        let t2 = 0.5 - x2 * x2 - y2 * y2;
        if (t2 < 0) {
            n2 = 0;
        } else {
            t2 *= t2;
            const gi2 = this.permMod12[ii + 1 + this.perm[jj + 1]] * 3;
            n2 = t2 * t2 * (this.grad3[gi2] * x2 + this.grad3[gi2 + 1] * y2);
        }
        
        return 70 * (n0 + n1 + n2);
    }
}

export class WindTransportModel {
    constructor(container) {
        this.container = container;
        this.state = {
            windDirection: 0,
            windStrength: 5,
            isPlaying: false,
            windSpeedMultiplier: 1
        };
        this.animationId = null;
        this.prevTime = performance.now();
        this.simplex = new SimplexNoise();
        this.clock = new THREE.Clock();
        this.dunes = [];
        this.windParticles = [];
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
                this.createBarchanDune(-25, 0, -5);
                this.createParabolicDune(25, 0, 8);
                this.createWindParticles();
                this.createLabels();
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
            <div class="title-sub">WIND TRANSPORTATION — GEOGRAPHIC DUNE MODEL</div>
        </div>
    </div>
    <div class="header-center">
        <div class="header-badge active">▶ 新月形沙丘 · 抛物线沙丘</div>
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
        <div class="data-row"><span class="data-key">沙丘状态</span><span class="data-val yellow" id="duneStatus">静止</span></div>
    </div>
    <div class="panel-block">
        <div class="block-title">地理标注</div>
        <div style="font-size:10px;color:var(--text2);line-height:1.8;padding:8px 0">
            <div>🌙 <strong>新月形沙丘</strong>（左侧）</div>
            <div>〰️ <strong>抛物线沙丘</strong>（右侧）</div>
            <div>⬅️ 迎风坡：沙子被风扬起</div>
            <div>➡️ 背风坡：沙子沉积滑落</div>
            <div>📐 沙丘随风向缓慢迁移</div>
            <div>🔴 红色粒子：风蚀区域</div>
            <div>🔵 蓝色粒子：沉积区域</div>
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
        <div class="block-title">沙丘演化</div>
        <div class="btn-group">
            <button class="btn" id="playBtn"><span class="btn-icon">▶</span><span class="btn-text">开始演化</span></button>
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
    <div class="footer-item"><span class="footer-label">演化状态</span><span class="footer-value cyan" id="ftStatus">静止</span></div>
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

        this.labelRenderer = new CSS2DRenderer();
        this.labelRenderer.setSize(this.width, this.height);
        this.labelRenderer.domElement.style.position = 'absolute';
        this.labelRenderer.domElement.style.top = '0';
        this.labelRenderer.domElement.style.pointerEvents = 'none';
        canvasContainer.appendChild(this.labelRenderer.domElement);
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xe8e8e8);
        this.scene.fog = new THREE.Fog(0xe8e8e8, 80, 250);
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
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const sun = new THREE.DirectionalLight(0xffffff, 0.8);
        sun.position.set(50, 80, 30);
        sun.castShadow = true;
        sun.shadow.mapSize.set(1024, 1024);
        sun.shadow.camera.near = 5;
        sun.shadow.camera.far = 200;
        sun.shadow.camera.left = -80;
        sun.shadow.camera.right = 80;
        sun.shadow.camera.top = 80;
        sun.shadow.camera.bottom = -80;
        this.scene.add(sun);
    }

    createGround() {
        const geometry = new THREE.PlaneGeometry(120, 100, 60, 50);
        const positions = geometry.attributes.position.array;
        
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i];
            const y = positions[i + 1];
            positions[i + 2] = this.simplex.noise2D(x * 0.05, y * 0.05) * 0.3;
        }
        
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: 0xd4a574,
            roughness: 0.9,
            metalness: 0.0
        });

        this.ground = new THREE.Mesh(geometry, material);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -1.5;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);
    }

    createBarchanDune(x, y, z) {
        const group = new THREE.Group();
        
        const segments = 50;
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const indices = [];

        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            for (let j = 0; j <= segments; j++) {
                const radius = j / segments * 16;
                const px = Math.cos(angle) * radius;
                const pz = Math.sin(angle) * radius;
                
                let py = 0;
                const dist = Math.sqrt(px * px + pz * pz);
                
                if (dist < 16) {
                    const normalizedDist = dist / 16;
                    if (px < 0) {
                        py = Math.cos(normalizedDist * Math.PI * 0.5) * 9;
                    } else {
                        py = Math.pow(1 - normalizedDist, 1.5) * 9;
                    }
                    
                    if (px > 0 && pz > -2 && pz < 2) {
                        const slipDist = dist / 16;
                        py = Math.max(py - slipDist * 3, 0);
                    }
                    
                    py += this.simplex.noise2D(px * 0.3, pz * 0.3) * 0.3;
                }
                
                vertices.push(px, Math.max(py, 0), pz);
            }
        }

        for (let i = 0; i < segments; i++) {
            for (let j = 0; j < segments; j++) {
                const a = i * (segments + 1) + j;
                const b = a + 1;
                const c = a + segments + 1;
                const d = c + 1;
                
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: 0xc9a06b,
            roughness: 0.95,
            metalness: 0.0
        });

        const dune = new THREE.Mesh(geometry, material);
        dune.castShadow = true;
        dune.receiveShadow = true;
        dune.userData.originalPositions = vertices.slice();
        dune.userData.type = 'barchan';
        
        group.add(dune);
        group.position.set(x, y, z);
        this.scene.add(group);
        this.dunes.push(group);
    }

    createParabolicDune(x, y, z) {
        const group = new THREE.Group();
        
        const segments = 50;
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        const indices = [];

        for (let i = 0; i <= segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            for (let j = 0; j <= segments; j++) {
                const radius = j / segments * 16;
                const px = Math.cos(angle) * radius;
                const pz = Math.sin(angle) * radius;
                
                let py = 0;
                const dist = Math.sqrt(px * px + pz * pz);
                
                if (dist < 16) {
                    const normalizedDist = dist / 16;
                    
                    if (px < 0) {
                        if (Math.abs(pz) > 5) {
                            py = Math.cos(normalizedDist * Math.PI * 0.5) * 7;
                        }
                    } else {
                        py = Math.pow(1 - normalizedDist, 1.2) * 7;
                    }
                    
                    py += this.simplex.noise2D(px * 0.3, pz * 0.3) * 0.25;
                }
                
                vertices.push(px, Math.max(py, 0), pz);
            }
        }

        for (let i = 0; i < segments; i++) {
            for (let j = 0; j < segments; j++) {
                const a = i * (segments + 1) + j;
                const b = a + 1;
                const c = a + segments + 1;
                const d = c + 1;
                
                indices.push(a, c, b);
                indices.push(b, c, d);
            }
        }

        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            color: 0xd4a574,
            roughness: 0.95,
            metalness: 0.0
        });

        const dune = new THREE.Mesh(geometry, material);
        dune.castShadow = true;
        dune.receiveShadow = true;
        dune.userData.originalPositions = vertices.slice();
        dune.userData.type = 'parabolic';
        
        group.add(dune);
        group.position.set(x, y, z);
        this.scene.add(group);
        this.dunes.push(group);
    }

    createWindParticles() {
        const particleCount = 500;
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const colors = new Float32Array(particleCount * 3);
        const velocities = [];

        for (let i = 0; i < particleCount; i++) {
            const x = (Math.random() - 0.5) * 100;
            const y = Math.random() * 15;
            const z = (Math.random() - 0.5) * 80;
            
            positions[i * 3] = x;
            positions[i * 3 + 1] = y;
            positions[i * 3 + 2] = z;

            const isErosion = x < -10;
            colors[i * 3] = isErosion ? 1.0 : 0.27;
            colors[i * 3 + 1] = isErosion ? 0.27 : 0.27;
            colors[i * 3 + 2] = isErosion ? 0.27 : 1.0;

            velocities.push({
                x: (Math.random() * 0.5 + 0.5),
                y: (Math.random() - 0.5) * 0.2,
                z: (Math.random() - 0.5) * 0.3
            });
        }

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

        const material = new THREE.PointsMaterial({
            size: 0.35,
            vertexColors: true,
            transparent: true,
            opacity: 0.95
        });

        const particles = new THREE.Points(geometry, material);
        particles.userData.velocities = velocities;
        this.scene.add(particles);
        this.windParticles.push(particles);
    }

    createLabels() {
        this.createLabel('迎风坡', -35, 8, -5);
        this.createLabel('背风坡', -15, 7, -5);
        this.createLabel('滑落面', -18, 5, -2);
        this.createLabel('风向 →', -50, 8, -5);
        this.createLabel('沙粒沉积区', 0, 5, -5);
        
        this.createLabel('新月形沙丘', -25, 14, -15);
        this.createLabel('抛物线沙丘', 25, 12, 5);
    }

    createLabel(text, x, y, z) {
        const div = document.createElement('div');
        div.className = 'label';
        div.style.position = 'absolute';
        div.style.background = 'rgba(255, 255, 255, 0.9)';
        div.style.padding = '4px 8px';
        div.style.borderRadius = '4px';
        div.style.fontSize = '12px';
        div.style.color = '#333';
        div.style.pointerEvents = 'none';
        div.style.boxShadow = '0 2px 6px rgba(0, 0, 0, 0.15)';
        div.style.whiteSpace = 'nowrap';
        div.style.fontWeight = '500';
        div.textContent = text;
        
        const label = new CSS2DObject(div);
        label.position.set(x, y, z);
        this.scene.add(label);
    }

    updateWindParticles(dt) {
        this.windParticles.forEach(particles => {
            const positions = particles.geometry.attributes.position.array;
            const velocities = particles.userData.velocities;

            for (let i = 0; i < velocities.length; i++) {
                positions[i * 3] += velocities[i].x * this.state.windSpeedMultiplier * dt * 10;
                positions[i * 3 + 1] += velocities[i].y * this.state.windSpeedMultiplier * dt * 10;
                positions[i * 3 + 2] += velocities[i].z * this.state.windSpeedMultiplier * dt * 10;

                if (positions[i * 3] > 60) {
                    positions[i * 3] = -60;
                    positions[i * 3 + 1] = Math.random() * 15;
                    positions[i * 3 + 2] = (Math.random() - 0.5) * 80;
                }
            }

            particles.geometry.attributes.position.needsUpdate = true;
        });
    }

    evolveDunes(time) {
        this.dunes.forEach((group, groupIndex) => {
            const dune = group.children[0];
            const originalPositions = dune.userData.originalPositions;
            const positions = dune.geometry.attributes.position.array;
            
            for (let i = 0; i < positions.length; i += 3) {
                const ox = originalPositions[i];
                const oy = originalPositions[i + 1];
                const oz = originalPositions[i + 2];
                
                const evolution = Math.sin(time * 0.5 + groupIndex) * 0.3;
                const moveX = evolution * (ox > 0 ? 1 : 0.3);
                
                positions[i] = ox + moveX;
                positions[i + 1] = oy + evolution * 0.2;
                positions[i + 2] = oz;
            }
            
            dune.geometry.attributes.position.needsUpdate = true;
            dune.geometry.computeVertexNormals();
        });
    }

    bindEvents() {
        this.container.querySelector('#backToMenuBtn')?.addEventListener('click', () => {
            import('../app-init.js').then(m => m.showWelcome());
        });

        this.container.querySelector('#dirSlider')?.addEventListener('input', (e) => {
            this.state.windDirection = parseFloat(e.target.value);
            this.syncUI();
        });

        this.container.querySelector('#strSlider')?.addEventListener('input', (e) => {
            this.state.windStrength = parseFloat(e.target.value);
            this.state.windSpeedMultiplier = this.state.windStrength / 5;
            this.syncUI();
        });

        this.container.querySelector('#playBtn')?.addEventListener('click', () => {
            this.state.isPlaying = !this.state.isPlaying;
            const btn = this.container.querySelector('#playBtn');
            if (btn) {
                btn.querySelector('.btn-icon').textContent = this.state.isPlaying ? '⏸' : '▶';
                btn.querySelector('.btn-text').textContent = this.state.isPlaying ? '暂停演化' : '开始演化';
            }
            const duneStatus = this.container.querySelector('#duneStatus');
            if (duneStatus) duneStatus.textContent = this.state.isPlaying ? '演化中' : '静止';
            const ftStatus = this.container.querySelector('#ftStatus');
            if (ftStatus) ftStatus.textContent = this.state.isPlaying ? '演化中' : '静止';
        });

        this.container.querySelector('#resetBtn')?.addEventListener('click', () => this.resetDunes());
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

    resetDunes() {
        this.state.isPlaying = false;
        const btn = this.container.querySelector('#playBtn');
        if (btn) {
            btn.querySelector('.btn-icon').textContent = '▶';
            btn.querySelector('.btn-text').textContent = '开始演化';
        }
        const duneStatus = this.container.querySelector('#duneStatus');
        if (duneStatus) duneStatus.textContent = '静止';
        const ftStatus = this.container.querySelector('#ftStatus');
        if (ftStatus) ftStatus.textContent = '静止';
        
        this.dunes.forEach(group => {
            const dune = group.children[0];
            const positions = dune.geometry.attributes.position.array;
            const originalPositions = dune.userData.originalPositions;
            
            for (let i = 0; i < positions.length; i++) {
                positions[i] = originalPositions[i];
            }
            
            dune.geometry.attributes.position.needsUpdate = true;
            dune.geometry.computeVertexNormals();
        });
    }

    onResize() {
        const wrap = this.container.querySelector('.canvas-wrap');
        if (!wrap) return;
        this.width = wrap.offsetWidth || 800;
        this.height = wrap.offsetHeight || 600;
        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
        this.labelRenderer.setSize(this.width, this.height);
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());
        const now = performance.now();
        const dt = Math.min((now - this.prevTime) / 1000, 0.05);
        this.prevTime = now;

        const time = this.clock.getElapsedTime();

        this.updateWindParticles(dt);
        
        if (this.state.isPlaying) {
            this.evolveDunes(time);
        }
        
        this.controls.update();
        this.renderer.render(this.scene, this.camera);
        this.labelRenderer.render(this.scene, this.camera);

        if (Math.random() < 0.1) {
            const el = this.container.querySelector('#fps');
            if (el) el.textContent = Math.round(1 / dt) + ' fps';
        }
    }

    dispose() {
        if (this.animationId) cancelAnimationFrame(this.animationId);
        if (this.renderer) this.renderer.dispose();
        if (this.labelRenderer) this.labelRenderer.domElement.remove();
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
