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

/* 地层标签面板已移入 3D 场景，HTML 层无需样式 */
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
    <div id="tectonicCanvas">
    </div>
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

    // ── 在正剖面平面（Z=56）内用 Canvas 贴图创建 3D 标签 ──────────
    setupLabels() {
        const FZ = 56; // 正剖面 Z

        // ──── 地层标签（贴在正剖面内，随剖面旋转消失） ────
        // 标签文字框 X 内心 = -45（宽32，左边到 -61，右边到 -29）
        // 横线从标签右边 X=-29 延伸到终点 X=35（避开相管35的油井和 x=55 的管子）
        // 各层中心 Y:
        //   含气层  Y: -34 ~ -25 → center -29.5
        //   含油层  Y: -44 ~ -34 → center -39
        //   地层水  Y: -55 ~ -44 → center -49.5
        //   防水层  Y: -80 ~ -63 → center -71
        const labelDefs = [
            { text: '含气层 Gas',        borderColor: '#888888', y: -29.5 },
            { text: '含油层 Oil',        borderColor: '#887744', y: -39   },
            { text: '地层水 Water',      borderColor: '#2255bb', y: -49.5 },
            { text: '防水层 Waterproof', borderColor: '#775544', y: -71   },
        ];

        this._strataSprites = [];

        for (const def of labelDefs) {
            // 文字标签（金色字），框中心 X=-15
            const labelMesh = this._makeStrataSprite(def.text, '#ffd060', def.borderColor);
            labelMesh.position.set(-15, def.y, FZ + 0.8);
            labelMesh.scale.set(32, 7, 1);
            this.scene.add(labelMesh);
            this._strataSprites.push(labelMesh);

            // 横线：从标签右边 X=1 到终点 X=45，长度=44，中心=23
            const lineMesh = this._makeLineSprite(def.borderColor);
            lineMesh.position.set(23, def.y, FZ + 0.8);
            lineMesh.scale.set(44, 0.7, 1);
            this.scene.add(lineMesh);
            this._strataSprites.push(lineMesh);

            // 终点小圆点（X=45，避开油井管子 X=55）
            const dot = this._makeDotSprite(def.borderColor);
            dot.position.set(45, def.y, FZ + 0.8);
            dot.scale.set(2.5, 2.5, 1);
            this.scene.add(dot);
            this._strataSprites.push(dot);
        }

        // ──── 油井标签（CSS2DObject，始终面向屏幕） ────
        this._setupWellLabels();
    }

    _setupWellLabels() {
        // 样式（内联进去避免全局污染）
        const style = `
            .well-label {
                padding: 3px 10px;
                background: rgba(10,10,24,0.82);
                border: 1px solid #ffcc55;
                border-left: 3px solid #ffcc55;
                border-radius: 3px;
                font-family: 'Courier New', monospace;
                font-size: 11px;
                color: #ffe8a0;
                white-space: nowrap;
                pointer-events: none;
                backdrop-filter: blur(2px);
            }
        `;
        if (!document.getElementById('well-label-style')) {
            const styleEl = document.createElement('style');
            styleEl.id = 'well-label-style';
            styleEl.textContent = style;
            document.head.appendChild(styleEl);
        }

        // 陆地油井：X=55, Z=56，地表高度约 3~5，塔射2 → 标签放在塔顶上方
        const landEl = document.createElement('div');
        landEl.className = 'well-label';
        landEl.textContent = '🛢 陆地油井 Land Well';
        const landLabel = new CSS2DObject(landEl);
        landLabel.position.set(55, 20, 56);  // 塔架顶部上方
        this.scene.add(landLabel);

        // 海上平台：X=-65, Z=5，海面 5，平台高度约 8.85 → 标签放在平台上方
        const offshoreEl = document.createElement('div');
        offshoreEl.className = 'well-label';
        offshoreEl.textContent = '🛢 海上平台 Offshore Platform';
        const offshoreLabel = new CSS2DObject(offshoreEl);
        offshoreLabel.position.set(-65, 26, 5);  // 平台顶部上方
        this.scene.add(offshoreLabel);
    }

    /** 生成文字标签 Plane（Canvas 绘制，法线朝 Z+，随正剖面旋转） */
    _makeStrataSprite(text, textColor, borderColor) {
        const W = 256, H = 56;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');

        // 背景（加深不透明度让文字更清晰）
        ctx.fillStyle = 'rgba(2,6,16,0.94)';
        this._roundRect(ctx, 0, 0, W, H, 6);
        ctx.fill();

        // 左边框彩色条
        ctx.fillStyle = borderColor;
        this._roundRect(ctx, 0, 0, 5, H, [6, 0, 0, 6]);
        ctx.fill();

        // 外边框（加粗加亮）
        ctx.strokeStyle = borderColor;
        ctx.lineWidth = 2;
        this._roundRect(ctx, 1, 1, W - 2, H - 2, 6);
        ctx.stroke();

        // 文字（加大字号，金色）
        ctx.font = 'bold 24px "Arial", sans-serif';
        ctx.fillStyle = textColor;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 14, H / 2);

        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, side: THREE.FrontSide,
            depthWrite: false, depthTest: true,
        });
        const geo = new THREE.PlaneGeometry(1, 1);
        return new THREE.Mesh(geo, mat);
    }

    /** 生成横线 Plane */
    _makeLineSprite(color) {
        const W = 128, H = 4;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, W, 0);
        grad.addColorStop(0, color + '88');
        grad.addColorStop(0.5, color);
        grad.addColorStop(1, color);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, W, H);
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, side: THREE.FrontSide,
            depthWrite: false, depthTest: true,
        });
        const geo = new THREE.PlaneGeometry(1, 1);
        return new THREE.Mesh(geo, mat);
    }

    /** 生成终点圆点 Plane */
    _makeDotSprite(color) {
        const SZ = 32;
        const canvas = document.createElement('canvas');
        canvas.width = SZ; canvas.height = SZ;
        const ctx = canvas.getContext('2d');
        ctx.beginPath();
        ctx.arc(SZ/2, SZ/2, SZ/2 - 2, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        const tex = new THREE.CanvasTexture(canvas);
        const mat = new THREE.MeshBasicMaterial({
            map: tex, transparent: true, side: THREE.FrontSide,
            depthWrite: false, depthTest: true,
        });
        const geo = new THREE.PlaneGeometry(1, 1);
        return new THREE.Mesh(geo, mat);
    }

    /** canvas 圆角矩形辅助 */
    _roundRect(ctx, x, y, w, h, r) {
        if (typeof r === 'number') r = [r, r, r, r];
        ctx.beginPath();
        ctx.moveTo(x + r[0], y);
        ctx.lineTo(x + w - r[1], y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r[1]);
        ctx.lineTo(x + w, y + h - r[2]);
        ctx.quadraticCurveTo(x + w, y + h, x + w - r[2], y + h);
        ctx.lineTo(x + r[3], y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - r[3]);
        ctx.lineTo(x, y + r[0]);
        ctx.quadraticCurveTo(x, y, x + r[0], y);
        ctx.closePath();
    }

    _updateStrataLabels() { /* Sprite 跟随 3D 场景，无需每帧手动更新 */ }

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
        this._updateStrataLabels();

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
