/**
 * TectonicModel.js
 * 地下石油地层结构展示模型
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
    seaLevel: 5,
    basementBottom: -80, basementTop: -65,
    waterproofBottom: -65, waterproofTop: -50,
    reservoirBottom: -50, reservoirTop: -28,
    capRockBottom: -28, capRockTop: -15,
    surfaceRockTop: 0,
    waterOilBound: -43, oilGasBound: -36,
    ridgeX: -75,
    eurAsiaPeakMax: 15,
};

export class TectonicModel {
    constructor(container) {
        this.container = container;
        this.state = {
            autoRotate: false,
            clock: 0,
            keys: {},       // 当前按下的按键
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

/* ── 地层标签样式 ── */
.geo-teach-label {
    pointer-events: none;
    /* 标签向左展开，锚点在标签最右端（即箭头尖端处） */
    transform: translateX(-100%) translateY(-50%);
    white-space: nowrap;
    position: relative;
    display: inline-block;
}
.geo-teach-label__box {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 10px 5px 10px;
    background: rgba(4, 10, 22, 0.88);
    border: 1px solid var(--label-border, #aaa);
    border-left: 3px solid var(--label-border, #aaa);
    border-radius: 3px;
    font-family: 'Courier New', 'Consolas', monospace;
    font-size: 11.5px;
    letter-spacing: 0.06em;
    color: #e8eef8;
    box-shadow: 0 0 12px var(--label-glow, rgba(200,200,200,0.2)),
                inset 0 0 6px rgba(255,255,255,0.02);
    backdrop-filter: blur(3px);
    -webkit-backdrop-filter: blur(3px);
}
/* 箭头：标签右侧指向右方（指向场景内） */
.geo-teach-label__arrow {
    display: inline-block;
    width: 32px;
    height: 2px;
    background: linear-gradient(90deg, var(--label-border, #aaa), transparent);
    position: relative;
    vertical-align: middle;
    flex-shrink: 0;
    margin-left: 2px;
}
.geo-teach-label__arrow::after {
    content: '';
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    border-left: 7px solid var(--label-border, #aaa);
    border-top: 5px solid transparent;
    border-bottom: 5px solid transparent;
}
/* 终点光点 */
.geo-teach-label__dot {
    position: absolute;
    right: -5px;
    top: 50%;
    transform: translateY(-50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--label-border, #aaa);
    box-shadow: 0 0 6px var(--label-glow, rgba(200,200,200,0.4));
    animation: geoDotPulse 2.2s ease-in-out infinite;
}
@keyframes geoDotPulse {
    0%, 100% { opacity: 1; transform: translateY(-50%) scale(1); }
    50%       { opacity: 0.5; transform: translateY(-50%) scale(1.6); }
}
</style>
<header class="header">
    <div class="scan-line"></div>
    <div class="header-left">
        <div class="header-logo">🛢</div>
        <div class="title-block">
            <div class="title-main">地下石油地层结构</div>
            <div class="title-sub">SUBSURFACE OIL RESERVOIR MODEL v2.0</div>
        </div>
    </div>
    <div class="header-center">
        <div class="header-badge active">▶ 储集层剖面 · RESERVOIR CROSS-SECTION</div>
    </div>
    <div class="header-right">
        <div class="status-group">
            <div class="status-dot"></div>
            <div class="status-label">ONLINE</div>
        </div>
    </div>
</header>


<main class="canvas-wrap">
    <div id="tectonicCanvas"></div>
    <div class="corner-deco tl"></div>
    <div class="corner-deco tr"></div>
    <div class="corner-deco bl"></div>
    <div class="corner-deco br"></div>
    <div class="axis-hint">🖱 左键拖拽旋转 · 右键/中键平移 · 滚轮缩放</div>
</main>

<aside class="side-panel right-panel">
    <div class="panel-block">
        <div class="block-title">视角控制</div>
        <div class="btn-group">
            <button class="btn" id="resetViewBtn"><span class="btn-icon">🎯</span><span class="btn-text">重置视角</span></button>
            <button class="btn" id="toggleAutoRotate"><span class="btn-icon">🔄</span><span class="btn-text">自动旋转</span></button>
        </div>
    </div>
    <div class="panel-block">
        <div class="block-title">剖面视角</div>
        <div class="btn-group">
            <button class="btn" id="frontViewBtn"><span class="btn-icon">📐</span><span class="btn-text">正剖面</span></button>
            <button class="btn" id="topViewBtn"><span class="btn-icon">🔭</span><span class="btn-text">俯瞰视角</span></button>
        </div>
    </div>
</aside>

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
        this.renderer.toneMapping = THREE.LinearToneMapping;
        this.renderer.toneMappingExposure = 1.0;

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
        this.controls.enablePan = true;
        this.controls.panSpeed = 0.8;
        this.controls.screenSpacePanning = true;  // 平移方向跟随屏幕平面，更直觉
        this.controls.minDistance = 60;
        this.controls.maxDistance = 500;
        this.controls.target.copy(this.defaultCameraTarget);
        this.controls.update();
    }

    setupLights() {
        // 环境光：保证背面/侧面/底面不漆黑，但不要过曝
        this.scene.add(new THREE.AmbientLight(0xffffff, 1.6));

        // 主光源（右上前方，照亮正面和顶面）
        const keyLight = new THREE.DirectionalLight(0xfff8ee, 1.2);
        keyLight.position.set(120, 200, 180);
        keyLight.castShadow = true;
        this.scene.add(keyLight);

        // 补光1：左后方，补亮背面和左侧（柔和）
        const fillLight1 = new THREE.DirectionalLight(0xd0e8ff, 0.7);
        fillLight1.position.set(-200, 80, -180);
        this.scene.add(fillLight1);

        // 补光2：右后方，补亮右侧和后侧（柔和）
        const fillLight2 = new THREE.DirectionalLight(0xe8f0ff, 0.6);
        fillLight2.position.set(200, 60, -150);
        this.scene.add(fillLight2);

        // 底部补光：从下方向上，补亮底面（柔和）
        const bottomLight = new THREE.DirectionalLight(0xfff0d0, 0.8);
        bottomLight.position.set(0, -200, 0);
        this.scene.add(bottomLight);

        // 地下油层暖橙辅助点光（保留地质氛围感）
        this.subsurfaceLight1 = new THREE.PointLight(0xff9a47, 1.8, 500, 1.5);
        this.subsurfaceLight1.position.set(10, -40, 0);
        this.scene.add(this.subsurfaceLight1);

        this.subsurfaceLight2 = new THREE.PointLight(0xffb870, 1.2, 400, 1.5);
        this.subsurfaceLight2.position.set(-50, -35, 0);
        this.scene.add(this.subsurfaceLight2);
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
            magmaLight1: this.subsurfaceLight1,
            magmaLight2: this.subsurfaceLight2,
        });

        // 初始化静态场景
        this.tectonicModel.update(0.5, 1.0, 'static');
    }

    setupLabels() {
        const themes = {
            ocean:    { border: '#7fdcff', glow: 'rgba(88, 210, 255, 0.35)' },
            land:     { border: '#f1f6ff', glow: 'rgba(255, 255, 255, 0.2)' },
            gas:      { border: '#a0a0a0', glow: 'rgba(160, 160, 160, 0.45)' },
            oil:      { border: '#555555', glow: 'rgba(80, 80, 80, 0.50)' },
            water:    { border: '#2255cc', glow: 'rgba(30, 80, 200, 0.45)' },
            rock:     { border: '#a08878', glow: 'rgba(160, 130, 100, 0.30)' },
        };

        const addLabel = (text, themeName, position) => {
            const root = document.createElement('div');
            root.className = 'geo-teach-label';
            root.style.setProperty('--label-border', themes[themeName].border);
            root.style.setProperty('--label-glow', themes[themeName].glow);
            root.innerHTML = `<div class="geo-teach-label__box">${text}<span class="geo-teach-label__arrow"></span></div><div class="geo-teach-label__dot"></div>`;
            const obj = new CSS2DObject(root);
            obj.position.copy(position);
            this.scene.add(obj);
            return obj;
        };

        // 获取地层锚点
        const anchors = this.tectonicModel.getAnchors ? this.tectonicModel.getAnchors() : {};

        // ── 标签锚点策略 ──
        // 标签锚点 X 选在左拱顶中心附近（x ≈ -20），此处拱起最明显、层厚最大
        // 标签本身向左偏移放置，CSS2DObject 默认以 position 为锚点渲染
        // 各层 Y 取该 x 处的实际层中心（考虑拱起 arch ≈ 16 at x=-20）
        //   arch(-20) = gaussian(-20, -20, 30)*16 + small = ~16
        //   reservoirTopAt(-20) ≈ clamp(-28+16, -49, -17) = -17（受capRockTop-2限制→-17）
        //   waterproofTopAt(-20) ≈ clamp(-50+16*0.65, -64.5, -35) = -39.6
        //   reservoirBottom(-20) = waterproofTopAt(-20) ≈ -40
        //   waterOilBoundAt(-20): bottom=-40, top=-17, thickness=23, bound= -40+23*0.35 = -31.95
        //   oilGasBoundAt(-20):   bottom=-40, top=-17, thickness=23, bound= -40+23*0.70 = -23.9
        //
        //   气层中心: (-17 + -23.9)/2 ≈ -20.5
        //   油层中心: (-23.9 + -31.95)/2 ≈ -28.0
        //   水层中心: (-31.95 + -40)/2 ≈ -36.0
        //   不透水层中心（x=-20）: waterproofTop≈-40, waterproofBottom: clamp(-65+16*0.65)=-54.6 → 中心≈-47
        //
        // 标签从锚点向左展开（translateX(0%) translateY(-50%)）
        // 把锚点打在层的右侧边缘附近，让文字自然向左延伸
        const LX = 20;     // 锚点 X：层右侧偏右，标签向左展开
        const LZ = S.frontZ;
        this.labels = {
            // 储集层三分标签（从上到下：气→油→水→不透水）
            gasZone:    addLabel('天然气层 · Gas', 'gas',
                            new THREE.Vector3(LX, -20.5, LZ)),
            oilZone:    addLabel('石油层 · Oil', 'oil',
                            new THREE.Vector3(LX, -28.0, LZ)),
            waterZone:  addLabel('地层水 · Formation Water', 'water',
                            new THREE.Vector3(LX, -36.0, LZ)),
            waterproof: addLabel('不透水层 · Waterproof', 'rock',
                            new THREE.Vector3(LX, -47.0, LZ)),
        };
    }

    bindEvents() {
        this.container.querySelector('#resetViewBtn')?.addEventListener('click', () => {
            this.camera.position.copy(this.defaultCameraPosition);
            this.controls.target.copy(this.defaultCameraTarget);
            this.controls.update();
        });

        this.container.querySelector('#toggleAutoRotate')?.addEventListener('click', () => {
            this.state.autoRotate = !this.state.autoRotate;
            this.controls.autoRotate = this.state.autoRotate;
            const btn = this.container.querySelector('#toggleAutoRotate');
            if (btn) btn.classList.toggle('active', this.state.autoRotate);
        });

        this.container.querySelector('#frontViewBtn')?.addEventListener('click', () => {
            // 正剖面视角：从正前方看
            this.camera.position.set(-10, -10, 220);
            this.controls.target.set(-10, -20, 0);
            this.controls.update();
        });

        this.container.querySelector('#topViewBtn')?.addEventListener('click', () => {
            // 俯瞰视角：从上方俯视
            this.camera.position.set(-10, 260, 0);
            this.controls.target.set(-10, 0, 0);
            this.controls.update();
        });

        window.addEventListener('resize', () => this.onResize());

        // 方向键 / WASD 平移控制
        this._onKeyDown = (e) => { this.state.keys[e.code] = true; };
        this._onKeyUp   = (e) => { this.state.keys[e.code] = false; };
        window.addEventListener('keydown', this._onKeyDown);
        window.addEventListener('keyup',   this._onKeyUp);
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

        // 水面纹理动画（让水面看起来有波动）
        if (this.waterNormalTex) {
            this.waterNormalTex.offset.x += dt * 0.02;
            this.waterNormalTex.offset.y += dt * 0.015;
        }

        // 地下照明微弱呼吸感
        if (this.subsurfaceLight1) {
            this.subsurfaceLight1.intensity = 3.0 + Math.sin(this.state.clock * 0.7) * 0.4;
        }

        this.tectonicModel.update(0.5, 1.0, 'static');

        // 方向键平移：根据相机距离自适应步长
        this._applyKeyboardPan(dt);

        this.controls.update();
        this.composer.render();
        this.css2dRenderer.render(this.scene, this.camera);

    }

    _applyKeyboardPan(dt) {
        const keys = this.state.keys;
        const hasKey = (...codes) => codes.some(c => keys[c]);
        if (!hasKey('ArrowLeft','ArrowRight','ArrowUp','ArrowDown','KeyA','KeyD','KeyW','KeyS')) return;

        // 步长随缩放距离线性变化，距离越近移动越慢
        const dist = this.camera.position.distanceTo(this.controls.target);
        const speed = dist * 0.6 * dt;

        // 获取相机的屏幕右方向（XZ 投影，不含Y轴倾斜）
        const right = new THREE.Vector3();
        right.crossVectors(this.camera.getWorldDirection(new THREE.Vector3()), this.camera.up).normalize();

        // 屏幕向上方向（沿相机 up 在 XY 平面内的分量）
        const up = this.camera.up.clone().normalize();

        const delta = new THREE.Vector3();
        if (hasKey('ArrowLeft',  'KeyA')) delta.addScaledVector(right, -speed);
        if (hasKey('ArrowRight', 'KeyD')) delta.addScaledVector(right,  speed);
        if (hasKey('ArrowUp',    'KeyW')) delta.addScaledVector(up,     speed);
        if (hasKey('ArrowDown',  'KeyS')) delta.addScaledVector(up,    -speed);

        this.camera.position.add(delta);
        this.controls.target.add(delta);
    }

    dispose() {
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        if (this._onKeyDown) window.removeEventListener('keydown', this._onKeyDown);
        if (this._onKeyUp)   window.removeEventListener('keyup',   this._onKeyUp);
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
