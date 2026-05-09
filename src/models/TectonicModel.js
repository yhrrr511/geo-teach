/**
 * TectonicModel.js
 * 板块构造运动模型
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { createTectonicLandscape } from '../geometry/TectonicLandscape.js';

const S = {
    xMin: -130, xMax: 110, depth: 112, halfDepth: 56, frontZ: 56, backZ: -56,
    seaLevel: 5, lithBottom: -15, mantleTop: -15, mantleBottom: -65,
    ridgeX: -75, coastMeanX: 0, indiaWestMeanX: -30, indiaEastMeanX: 0,
    eurasiaStartX: 10, mountainStartX: 14, mountainEndX: 80, snowBase: 18,
    indiaPeakMax: 15, eurAsiaPeakMax: 25,
};

export class TectonicModel {
    constructor(container) {
        this.container = container;
        this.state = {
            time: 0,
            intensity: 1.0,
            boundaryType: 'convergent',
            autoRotate: false,
            clock: 0,
            isPlaying: false,
            playSpeed: 0.5,
        };
        this.animationId = null;
        this.prevTime = performance.now();
        
        this.init();
    }

    init() {
        this.createUI();
        
        // 等待 DOM 渲染完成后再设置渲染器
        setTimeout(() => {
            this.setupRenderer();
            this.setupScene();
            this.setupCamera();
            this.setupLights();
            this.setupPostProcessing();
            this.createModel();
            this.setupLabels();
            this.bindEvents();
            this.animate();
        }, 50);
        
        setTimeout(() => {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) overlay.classList.add('hidden');
        }, 800);
    }

    createUI() {
        this.container.innerHTML = `
<div class="app">
<style>
#tectonicCanvas { width: 100%; height: 100%; }
</style>
<header class="header">
    <div class="scan-line"></div>
    <div class="header-left">
        <div class="header-logo">🌋</div>
        <div class="title-block">
            <div class="title-main">板块构造运动</div>
            <div class="title-sub">PLATE TECTONICS MODEL v4.0</div>
        </div>
    </div>
    <div class="header-center">
        <div class="header-badge active" id="boundaryTypeBadge">▶ 消亡边界 · CONVERGENT</div>
    </div>
    <div class="header-right">
        <button id="backToMenuBtn">🏠 返回菜单</button>
        <div class="status-group">
            <div class="status-dot"></div>
            <div class="status-label">ONLINE</div>
        </div>
    </div>
</header>

<aside class="side-panel left-panel">
    <div class="panel-block orange-accent">
        <div class="block-title orange">板块动力参数</div>
        <div class="data-row"><span class="data-key">板块收敛速度</span><span class="data-val" id="collisionVelocity">0.0 cm/yr</span></div>
        <div class="data-row"><span class="data-key">俯冲深度</span><span class="data-val" id="collisionDepth">0 km</span></div>
        <div class="data-row"><span class="data-key">地表隆起高度</span><span class="data-val" id="upliftHeight">0 m</span></div>
        <div class="data-row"><span class="data-key">海沟深度</span><span class="data-val cyan" id="trenchDepth">0 m</span></div>
    </div>
    <div class="panel-block">
        <div class="block-title">地球物理环境</div>
        <div class="data-row"><span class="data-key">地温梯度</span><span class="data-val yellow" id="temperature">1200 °C</span></div>
        <div class="data-row"><span class="data-key">地幔压力</span><span class="data-val" id="pressure">0.1 GPa</span></div>
        <div class="data-row"><span class="data-key">构造应力</span><span class="data-val" id="stress">5 MPa</span></div>
    </div>
    <div class="panel-block">
        <div class="block-title">地质年代</div>
        <div style="text-align:center;padding:5px 0">
            <div style="font-size:20px;color:var(--cyan);text-shadow:0 0 14px var(--glow-c);font-weight:bold" id="geologicalPeriod">太古代</div>
            <div style="font-size:9.5px;color:var(--text3);margin-top:4px" id="timeEra">Archean Eon</div>
        </div>
    </div>
</aside>

<main class="canvas-wrap">
    <div id="tectonicCanvas"></div>
    <div class="corner-deco tl"></div>
    <div class="corner-deco tr"></div>
    <div class="corner-deco bl"></div>
    <div class="corner-deco br"></div>
    <div class="axis-hint">🖱 拖拽旋转 · 滚轮缩放 · 聚焦剖面主体</div>
</main>

<aside class="side-panel right-panel">
    <div class="panel-block">
        <div class="block-title">地质时间轴</div>
        <div class="slider-wrap">
            <div class="slider-header">
                <span class="slider-label">时间进程</span>
                <span class="slider-value-display cyan" id="timeDisplay">0</span>
            </div>
            <input type="range" id="timeSlider" min="0" max="100" value="0" step="1" style="--pct:0%">
            <div class="slider-ticks"><span>0 Ma</span><span>25</span><span>50</span><span>75</span><span>100 Ma</span></div>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">时间控制</div>
        <div class="btn-group">
            <button class="btn" id="playBtn"><span class="btn-icon">▶</span><span class="btn-text">自动播放</span></button>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">板块动力强度</div>
        <div class="slider-wrap">
            <div class="slider-header">
                <span class="slider-label">强度系数</span>
                <span class="slider-value-display" id="intensityDisplay">1.0</span>
            </div>
            <input type="range" id="intensitySlider" min="0.1" max="3.0" value="1.0" step="0.1" style="--pct:31%">
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">板块边界类型</div>
        <div class="btn-group">
            <button class="btn active" id="convergentBtn"><span class="btn-icon">⛰</span><span class="btn-text">消亡边界</span></button>
            <button class="btn" id="divergentBtn"><span class="btn-icon">🌊</span><span class="btn-text">生长边界</span></button>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">视角控制</div>
        <div class="btn-group">
            <button class="btn" id="resetViewBtn"><span class="btn-icon">🎯</span><span class="btn-text">重置视角</span></button>
            <button class="btn" id="toggleAutoRotate"><span class="btn-icon">🔄</span><span class="btn-text">自动旋转</span></button>
        </div>
    </div>
</aside>

<footer class="footer">
    <div class="footer-item"><span class="footer-label">地质时期</span><span class="footer-value" id="geoFooterPeriod">太古代</span></div>
    <div class="footer-item"><span class="footer-label">板块运动</span><span class="footer-value" id="motionStatus">静止</span></div>
    <div class="footer-item"><span class="footer-label">边界模式</span><span class="footer-value orange" id="boundaryMode">消亡边界</span></div>
    <div class="footer-item"><span class="footer-label">帧率</span><span class="footer-value green" id="fps">—</span></div>
</footer>
</div>
`;
    }

    setupRenderer() {
        const canvasContainer = this.container.querySelector('#tectonicCanvas');
        const canvasWrap = this.container.querySelector('.canvas-wrap');
        const rect = canvasWrap.getBoundingClientRect();
        this.width = Math.max(rect.width, 1);
        this.height = Math.max(rect.height, 1);

        this.canvas = document.createElement('canvas');
        canvasContainer.appendChild(this.canvas);

        this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
        this.renderer.setSize(this.width, this.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.92;

        this.css2dRenderer = new CSS2DRenderer();
        this.css2dRenderer.setSize(this.width, this.height);
        this.css2dRenderer.domElement.style.position = 'absolute';
        this.css2dRenderer.domElement.style.top = '0';
        this.css2dRenderer.domElement.style.left = '0';
        this.css2dRenderer.domElement.style.pointerEvents = 'none';
        this.css2dRenderer.domElement.style.zIndex = '10';
        canvasContainer.appendChild(this.css2dRenderer.domElement);
    }

    setupScene() {
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a12);
    }

    setupCamera() {
        this.defaultCameraPosition = new THREE.Vector3(-20, 80, 200);
        this.defaultCameraTarget = new THREE.Vector3(-10, 0, 0);

        this.camera = new THREE.PerspectiveCamera(28, this.width / this.height, 0.5, 2000);
        this.camera.position.copy(this.defaultCameraPosition);
        this.camera.lookAt(this.defaultCameraTarget);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.enablePan = false;
        this.controls.minDistance = 105;
        this.controls.maxDistance = 360;
        this.controls.target.copy(this.defaultCameraTarget);
        this.controls.update();
    }

    setupLights() {
        this.scene.add(new THREE.AmbientLight(0x3a4560, 2.0));

        const keyLight = new THREE.DirectionalLight(0xfff0d8, 1.5);
        keyLight.position.set(180, 160, 130);
        keyLight.castShadow = true;
        this.scene.add(keyLight);

        this.magmaLight1 = new THREE.PointLight(0xff4500, 6.0, 250, 2.0);
        this.magmaLight1.position.set(40, -40, 0);
        this.scene.add(this.magmaLight1);

        this.magmaLight2 = new THREE.PointLight(0xff6a00, 4.0, 180, 2.0);
        this.magmaLight2.position.set(-55, -40, 0);
        this.scene.add(this.magmaLight2);
    }

    setupPostProcessing() {
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(new THREE.Vector2(this.width, this.height), 0.12, 0.35, 0.98);
        this.composer.addPass(this.bloomPass);
    }

    createModel() {
        const textureLoader = new THREE.TextureLoader();
        this.waterNormalTex = textureLoader.load('./assets/textures/ambientcg/Ice002_1K-JPG_NormalGL.jpg');
        this.waterNormalTex.wrapS = this.waterNormalTex.wrapT = THREE.RepeatWrapping;
        this.waterNormalTex.repeat.set(4, 4);

        this.tectonicModel = createTectonicLandscape(this.scene, {
            waterNormalTex: this.waterNormalTex,
            bloomPass: this.bloomPass,
            magmaLight1: this.magmaLight1,
            magmaLight2: this.magmaLight2,
        });
    }

    setupLabels() {
        const themes = {
            ocean: { border: '#7fdcff', glow: 'rgba(88, 210, 255, 0.35)' },
            land: { border: '#f1f6ff', glow: 'rgba(255, 255, 255, 0.2)' },
            heat: { border: '#ff9a47', glow: 'rgba(255, 130, 70, 0.35)' },
            zone: { border: '#ffd167', glow: 'rgba(255, 184, 54, 0.3)' },
        };

        const addLabel = (text, themeName, position) => {
            const root = document.createElement('div');
            root.className = 'geo-teach-label';
            root.style.setProperty('--label-border', themes[themeName].border);
            root.style.setProperty('--label-glow', themes[themeName].glow);
            root.innerHTML = `<div class="geo-teach-label__box">${text}</div><div class="geo-teach-label__line"></div><div class="geo-teach-label__dot"></div>`;
            const obj = new CSS2DObject(root);
            obj.position.copy(position);
            this.scene.add(obj);
            return obj;
        };

        this.labels = {
            ridge: addLabel('洋中脊 · 生长边界', 'ocean', new THREE.Vector3(S.ridgeX + 6, S.seaLevel + 18, -8)),
            india: addLabel('印度洋板块', 'ocean', new THREE.Vector3(-15, S.seaLevel + 12, -18)),
            eurasia: addLabel('亚欧板块', 'land', new THREE.Vector3(80, S.eurAsiaPeakMax + 12, 18)),
            asthenosphere: addLabel('软流圈', 'heat', new THREE.Vector3(5, (S.mantleTop + S.mantleBottom) * 0.5, S.frontZ)),
            subduction: addLabel('俯冲带 · 消亡边界', 'zone', new THREE.Vector3(12, -10, S.frontZ)),
            himalaya: addLabel('喜马拉雅山脉', 'zone', new THREE.Vector3(45, S.eurAsiaPeakMax + 8, -5)),
        };
    }

    bindEvents() {
        this.container.querySelector('#backToMenuBtn')?.addEventListener('click', () => {
            import('../app-init.js').then(m => m.showWelcome());
        });

        this.container.querySelector('#timeSlider')?.addEventListener('input', (e) => {
            this.state.time = parseFloat(e.target.value);
            this.syncUI();
            this.updateScene();
        });

        this.container.querySelector('#intensitySlider')?.addEventListener('input', (e) => {
            this.state.intensity = parseFloat(e.target.value);
            this.syncUI();
            this.updateScene();
        });

        this.container.querySelector('#playBtn')?.addEventListener('click', () => {
            this.state.isPlaying = !this.state.isPlaying;
            const btn = this.container.querySelector('#playBtn');
            if (btn) {
                btn.querySelector('.btn-icon').textContent = this.state.isPlaying ? '⏸' : '▶';
                btn.querySelector('.btn-text').textContent = this.state.isPlaying ? '暂停播放' : '自动播放';
            }
        });

        this.container.querySelector('#convergentBtn')?.addEventListener('click', () => {
            this.state.boundaryType = 'convergent';
            this.container.querySelector('#convergentBtn')?.classList.add('active');
            this.container.querySelector('#divergentBtn')?.classList.remove('active');
            this.container.querySelector('#boundaryTypeBadge').textContent = '▶ 消亡边界 · CONVERGENT';
            this.updateLabels();
            this.updateScene();
        });

        this.container.querySelector('#divergentBtn')?.addEventListener('click', () => {
            this.state.boundaryType = 'divergent';
            this.container.querySelector('#divergentBtn')?.classList.add('active');
            this.container.querySelector('#convergentBtn')?.classList.remove('active');
            this.container.querySelector('#boundaryTypeBadge').textContent = '▶ 生长边界 · DIVERGENT';
            this.updateLabels();
            this.updateScene();
        });

        this.container.querySelector('#resetViewBtn')?.addEventListener('click', () => {
            this.camera.position.copy(this.defaultCameraPosition);
            this.controls.target.copy(this.defaultCameraTarget);
            this.controls.update();
        });

        this.container.querySelector('#toggleAutoRotate')?.addEventListener('click', () => {
            this.state.autoRotate = !this.state.autoRotate;
            this.controls.autoRotate = this.state.autoRotate;
        });

        window.addEventListener('resize', () => this.onResize());
    }

    updateLabels() {
        const isConvergent = this.state.boundaryType === 'convergent';
        if (this.labels.subduction) this.labels.subduction.visible = isConvergent;
        if (this.labels.himalaya) this.labels.himalaya.visible = isConvergent;
    }

    syncUI() {
        const timeSlider = this.container.querySelector('#timeSlider');
        const timeDisplay = this.container.querySelector('#timeDisplay');
        const intensityDisplay = this.container.querySelector('#intensityDisplay');

        if (timeSlider) {
            timeSlider.value = this.state.time;
            const pct = (this.state.time / 100) * 100;
            timeSlider.style.setProperty('--pct', `${pct}%`);
        }
        if (timeDisplay) timeDisplay.textContent = Math.round(this.state.time);
        if (intensityDisplay) intensityDisplay.textContent = this.state.intensity.toFixed(1);
    }

    updateScene() {
        const p = this.state.time / 100;
        this.tectonicModel.update(p, this.state.intensity, this.state.boundaryType);
        this.updateDataPanel(p);
    }

    updateDataPanel(progress) {
        const setEl = (id, val) => {
            const el = this.container.querySelector(`#${id}`);
            if (el) el.textContent = val;
        };

        setEl('collisionVelocity', `${(4.2 + progress * 3.1 * this.state.intensity).toFixed(1)} cm/yr`);
        setEl('collisionDepth', `${Math.round(60 + progress * 520 * this.state.intensity)} km`);
        setEl('upliftHeight', `${Math.round(600 + progress * 5600 * this.state.intensity).toLocaleString()} m`);
        setEl('trenchDepth', `${Math.round(4200 + progress * 3600 * this.state.intensity).toLocaleString()} m`);
        setEl('temperature', `${Math.round(960 + progress * 580 + this.state.intensity * 130)} °C`);
        setEl('pressure', `${(0.6 + progress * 18.5 * this.state.intensity).toFixed(1)} GPa`);
        setEl('stress', `${Math.round(18 + progress * 135 * this.state.intensity)} MPa`);

        const stages = [
            { zh: '太古代', en: 'Archean' },
            { zh: '元古代', en: 'Proterozoic' },
            { zh: '古生代', en: 'Paleozoic' },
            { zh: '中生代', en: 'Mesozoic' },
            { zh: '新生代', en: 'Cenozoic' },
        ];
        const si = Math.min(Math.floor(progress * stages.length), stages.length - 1);
        setEl('geologicalPeriod', stages[si].zh);
        setEl('timeEra', stages[si].en);
        setEl('geoFooterPeriod', stages[si].zh);
        setEl('boundaryMode', this.state.boundaryType === 'convergent' ? '消亡边界' : '生长边界');
    }

    onResize() {
        const canvasContainer = this.container.querySelector('#tectonicCanvas');
        if (!canvasContainer) return;
        const rect = canvasContainer.getBoundingClientRect();
        this.width = Math.max(rect.width, 1);
        this.height = Math.max(rect.height, 1);

        this.camera.aspect = this.width / this.height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.width, this.height);
        this.css2dRenderer.setSize(this.width, this.height);
        this.composer.setSize(this.width, this.height);
    }

    animate() {
        this.animationId = requestAnimationFrame(() => this.animate());

        const now = performance.now();
        const dt = Math.min((now - this.prevTime) / 1000, 0.05);
        this.prevTime = now;
        this.state.clock += dt;

        if (this.waterNormalTex) {
            this.waterNormalTex.offset.x += dt * 0.02;
            this.waterNormalTex.offset.y += dt * 0.015;
        }

        if (this.state.isPlaying) {
            this.state.time = Math.min(100, this.state.time + dt * this.state.playSpeed * 18);
            this.syncUI();
            this.updateScene();
            if (this.state.time >= 100) {
                this.state.isPlaying = false;
                const btn = this.container.querySelector('#playBtn');
                if (btn) {
                    btn.querySelector('.btn-icon').textContent = '▶';
                    btn.querySelector('.btn-text').textContent = '自动播放';
                }
            }
        }

        this.controls.update();
        this.composer.render();
        this.css2dRenderer.render(this.scene, this.camera);
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        if (this.renderer) {
            this.renderer.dispose();
        }
        if (this.composer) {
            this.composer.dispose();
        }
        if (this.scene) {
            this.scene.traverse((obj) => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) {
                        obj.material.forEach(m => m.dispose());
                    } else {
                        obj.material.dispose();
                    }
                }
            });
        }
    }
}
