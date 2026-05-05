import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

import { UIController } from './ui/UIController.js';
import { createTectonicLandscape } from './geometry/TectonicLandscape.js';

/* ============================================================
   全局状态
============================================================ */
export const STATE = {
    time: 0,
    intensity: 1.0,
    boundaryType: 'convergent',
    autoRotate: false,
    clock: 0,
    isPlaying: false,
    playSpeed: 0.5,
};

/* ============================================================
   渲染器 & 场景
============================================================ */
const container = document.getElementById('canvasContainer');
const canvasEl = document.createElement('canvas');
container.appendChild(canvasEl);

function getContainerSize() {
    const rect = container.getBoundingClientRect();
    return { width: Math.max(rect.width, 1), height: Math.max(rect.height, 1) };
}

let { width, height } = getContainerSize();

const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(width, height);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92; // 整体曝光（适度降低，避免海面高光过曝）

const css2dRenderer = new CSS2DRenderer();
css2dRenderer.setSize(width, height);
css2dRenderer.domElement.style.position = 'absolute';
css2dRenderer.domElement.style.top = '0';
css2dRenderer.domElement.style.left = '0';
css2dRenderer.domElement.style.pointerEvents = 'none';
css2dRenderer.domElement.style.zIndex = '10';
container.appendChild(css2dRenderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a0a12);

/* ============================================================
   相机 & 控制器
============================================================ */
// 相机位置适配新坐标系（场景X: -130~+110，中心约 X=-10，能看到从深海到山脉全景）
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(-20, 80, 200);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(-10, 0, 0);

const camera = new THREE.PerspectiveCamera(28, width / height, 0.5, 2000);
camera.position.copy(DEFAULT_CAMERA_POSITION);
camera.lookAt(DEFAULT_CAMERA_TARGET);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.enablePan = false;
controls.minDistance = 105;
controls.maxDistance = 360;
controls.minPolarAngle = 0.35;
controls.maxPolarAngle = 1.4;
controls.target.copy(DEFAULT_CAMERA_TARGET);
controls.update();

/* ============================================================
   后处理
============================================================ */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// bloomThreshold 提高到 0.98，避免水面高光被 bloom 放大成星芒
const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.12, 0.35, 0.98);
composer.addPass(bloomPass);

/* ============================================================
   灯光
============================================================ */
scene.add(new THREE.AmbientLight(0x3a4560, 2.0));

const keyLight = new THREE.DirectionalLight(0xfff0d8, 1.5);
keyLight.position.set(180, 160, 130);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.near = 10;
keyLight.shadow.camera.far = 700;
keyLight.shadow.camera.left = -280;
keyLight.shadow.camera.right = 280;
keyLight.shadow.camera.top = 220;
keyLight.shadow.camera.bottom = -220;
scene.add(keyLight);

const fillOcean = new THREE.DirectionalLight(0x8ec8e8, 0.28);
fillOcean.position.set(-200, 80, 160); // 降低高度使角度更平，减少水面直射
scene.add(fillOcean);

const fillMtn = new THREE.DirectionalLight(0xe8dcd0, 0.8);
fillMtn.position.set(120, 140, -140);
scene.add(fillMtn);

const warmUp = new THREE.DirectionalLight(0xffc898, 0.15);
warmUp.position.set(0, -80, 0);
scene.add(warmUp);

const mtnTopLight = new THREE.DirectionalLight(0xfff8f0, 0.45);
mtnTopLight.position.set(80, 200, 60); // 山顶补光，降低强度减少水面直射高光
scene.add(mtnTopLight);

const magmaLight1 = new THREE.PointLight(0xff4500, 6.0, 250, 2.0);
magmaLight1.position.set(40, -40, 0);  // 俯冲带/亚欧板块下方
scene.add(magmaLight1);

const magmaLight2 = new THREE.PointLight(0xff6a00, 4.0, 180, 2.0);
magmaLight2.position.set(-55, -40, 0); // 印度洋板块/浅海下方
scene.add(magmaLight2);

const subductionLight = new THREE.PointLight(0xff3300, 3.0, 140, 2.0);
subductionLight.position.set(5, -28, 0);  // 俯冲带（X≈0~+10）下方
scene.add(subductionLight);

/* ============================================================
   剖面尺寸常量 — 与 TectonicLandscape.js 保持完全一致
   坐标系说明（按设计稿重新规划，2026年版）：
     X轴: -130(深海左缘) → -75(洋中脊) → -30(印度陆地西岸) → 0(俯冲带) → +10(亚欧板块) → +110(内陆)
     Y轴: -65(软流层底) → -15(岩石圈底) → 0(X轴) → +5(海平面) → +25(山顶)
     Z轴: -56(后) → 0 → +56(前)
   宽度规划：
     深海区 ≈ 50   (X: -130 ~ -80)
     洋中脊 ≈ 10   (X: -80 ~ -70, ridgeX=-75居中)
     浅海区 ≈ 40   (X: -70 ~ -30)
     印度陆地 20(前)~50(后) S型，海岸线曲折
     S型海湾 ≈ 5  俯冲带上方
     亚欧板块 100(前)~70(后) (X: +10 ~ +110)
============================================================ */
const S = {
    xMin: -130,          // 场景左边界（深海左翼）
    xMax: 110,           // 场景右边界（亚欧板块内陆）
    depth: 112,          // Z方向总深度
    halfDepth: 56,
    frontZ: 56,
    backZ: -56,

    seaLevel: 5,         // 海平面（X轴上方5单位）
    lithBottom: -15,     // 岩石圈底（X轴下方15单位，高度差=15）
    mantleTop: -15,      // 软流层顶（与岩石圈底一致）
    mantleBottom: -65,   // 软流层底（高度差=50）

    ridgeX: -75,         // 洋中脊中心（深海区右侧，10宽居中）
    coastMeanX: 0,       // 印度板块东岸/俯冲带平均X位置
    indiaWestMeanX: -30, // 印度板块陆地西岸均值
    indiaEastMeanX: 0,   // 印度板块陆地东岸均值
    eurasiaStartX: 10,   // 亚欧板块起始（俯冲带右侧）

    mountainStartX: 14,  // 山脉起始（紧靠俯冲带）
    mountainEndX: 80,    // 山脉结束
    snowBase: 18,        // 积雪线（Y>18开始有雪）

    indiaPeakMax: 15,    // 印度板块陆地最高点
    eurAsiaPeakMax: 25,  // 亚欧板块山脉最高点
};

/* ============================================================
   纹理加载
============================================================ */
const textureLoader = new THREE.TextureLoader();
function loadTex(path, rx, ry) {
    const t = textureLoader.load(path);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    return t;
}
const waterNormalTex = loadTex('./assets/textures/ambientcg/Ice002_1K-JPG_NormalGL.jpg', 4, 4);

/* ============================================================
   数学工具
============================================================ */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function mix(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) {
    if (e0 === e1) return x < e0 ? 0 : 1;
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
}
function gaussian(x, c, w) { const d = (x - c) / w; return Math.exp(-(d * d)); }

/* ============================================================
   注意：地形高度函数、颜色函数和几何构建工具已移至 TectonicLandscape.js
   main.js 中只保留基础数学工具函数，供 UI 动画计算等局部使用
============================================================ */

/* ============================================================
   标签系统
============================================================ */
function createLabelManager(sceneRef) {
    if (!document.getElementById('geoTeachLabelStyle')) {
        const style = document.createElement('style');
        style.id = 'geoTeachLabelStyle';
        style.textContent = `
            .geo-teach-label {
                transform: translate(-50%, -100%);
                pointer-events: none;
                font-family: Arial, 'Microsoft YaHei', sans-serif;
                color: #eaf7ff;
                text-align: center;
                filter: drop-shadow(0 0 10px rgba(0, 0, 0, 0.45));
            }
            .geo-teach-label__box {
                padding: 6px 12px;
                border-radius: 3px;
                border: 1px solid var(--label-border, rgba(255,255,255,0.6));
                background: linear-gradient(180deg, rgba(12, 22, 38, 0.94), rgba(4, 10, 18, 0.92));
                box-shadow: 0 0 18px var(--label-glow, rgba(255,255,255,0.15));
                white-space: nowrap;
                font-size: 14px;
                letter-spacing: 0.04em;
                font-weight: 600;
            }
            .geo-teach-label__line {
                width: 1px;
                height: 28px;
                margin: 0 auto;
                background: linear-gradient(180deg, var(--label-border, rgba(255,255,255,0.6)), rgba(255,255,255,0));
            }
            .geo-teach-label__dot {
                width: 7px;
                height: 7px;
                margin: -2px auto 0;
                border-radius: 50%;
                background: var(--label-border, rgba(255,255,255,0.6));
                box-shadow: 0 0 10px var(--label-glow, rgba(255,255,255,0.2));
            }
        `;
        document.head.appendChild(style);
    }

    const themes = {
        ocean: { border: '#7fdcff', glow: 'rgba(88, 210, 255, 0.35)' },
        land: { border: '#f1f6ff', glow: 'rgba(255, 255, 255, 0.2)' },
        plate: { border: '#d8f0ff', glow: 'rgba(133, 219, 255, 0.22)' },
        heat: { border: '#ff9a47', glow: 'rgba(255, 130, 70, 0.35)' },
        zone: { border: '#ffd167', glow: 'rgba(255, 184, 54, 0.3)' },
    };

    const labels = {};

    function addLabel(id, text, themeName, position) {
        const root = document.createElement('div');
        root.className = 'geo-teach-label';
        root.style.setProperty('--label-border', themes[themeName].border);
        root.style.setProperty('--label-glow', themes[themeName].glow);
        root.innerHTML = `
            <div class="geo-teach-label__box">${text}</div>
            <div class="geo-teach-label__line"></div>
            <div class="geo-teach-label__dot"></div>
        `;
        const obj = new CSS2DObject(root);
        obj.position.copy(position);
        sceneRef.add(obj);
        labels[id] = obj;
    }

    // 洋中脊（生长边界，X=-75）
    addLabel('ridge', '洋中脊 · 生长边界', 'ocean', new THREE.Vector3(S.ridgeX + 6, S.seaLevel + 18, -8));
    // 浅海区（X=-50）
    addLabel('shallowSea', '浅海 · 特提斯海', 'ocean', new THREE.Vector3(-50, S.seaLevel + 14, 5));
    // 印度洋板块（印度陆地，X=-15）
    addLabel('india', '印度洋板块', 'plate', new THREE.Vector3(-15, S.seaLevel + 12, -18));
    // 亚欧板块（大陆，X=+80）
    addLabel('eurasia', '亚欧板块', 'land', new THREE.Vector3(80, S.eurAsiaPeakMax + 12, 18));
    // 岩石圈（左侧，X=-65）
    addLabel('lithosphere', '岩石圈', 'land', new THREE.Vector3(-65, -6, S.frontZ));
    // 软流圈（中部，X=+5）
    addLabel('asthenosphere', '软流圈', 'heat', new THREE.Vector3(5, (S.mantleTop + S.mantleBottom) * 0.5, S.frontZ));
    // 俯冲带（消亡边界，X=+5）—— 仅消亡边界模式下显示
    addLabel('subduction', '俯冲带 · 消亡边界', 'zone', new THREE.Vector3(12, -10, S.frontZ));
    // 喜马拉雅山脉（亚欧板块偏左，X=+45）—— 仅消亡边界模式下显示
    addLabel('himalaya', '喜马拉雅山脉', 'zone', new THREE.Vector3(45, S.eurAsiaPeakMax + 8, -5));

    // 生长边界专用标签（初始隐藏）
    addLabel('riftValley', '裂谷 · 扩张中心', 'heat', new THREE.Vector3(S.ridgeX, S.seaLevel + 22, 10));
    addLabel('newCrust', '新生洋壳 · 持续生成', 'ocean', new THREE.Vector3(S.ridgeX + 20, S.seaLevel + 10, -15));
    addLabel('hydroVent', '深海热液喷口', 'heat', new THREE.Vector3(S.ridgeX + 2, S.seaLevel + 18, 30));

    // 初始隐藏生长边界标签
    ['riftValley', 'newCrust', 'hydroVent'].forEach(k => {
        if (labels[k]) labels[k].visible = false;
    });

    return {
        update(anchors) {
            Object.entries(anchors).forEach(([k, v]) => {
                if (labels[k]) labels[k].position.copy(v);
            });
        },
        updateMode(boundaryType) {
            const isConvergent = boundaryType === 'convergent';
            // 消亡边界专属标签
            ['subduction', 'himalaya'].forEach(k => {
                if (labels[k]) labels[k].visible = isConvergent;
            });
            // 生长边界专属标签
            ['riftValley', 'newCrust', 'hydroVent'].forEach(k => {
                if (labels[k]) labels[k].visible = !isConvergent;
            });
        },
    };
}

/* ============================================================
   实例化
============================================================ */
const tectonicModel = createTectonicLandscape(scene, {
    waterNormalTex,
    bloomPass,
    magmaLight1,
    magmaLight2,
    subductionLight,
});
const labelManager = createLabelManager(scene);
const uiController = new UIController(STATE);

/* ============================================================
   地质日志
============================================================ */
const GEO_LOG = {
    container: null,
    marks: new Set(),
    init() { this.container = document.getElementById('geoEventLog'); },
    addEntry(text, type = '') {
        if (!this.container) return;
        const e = document.createElement('div');
        e.className = 'log-entry';
        e.innerHTML = `<span class="log-time">[MODEL]</span><span class="log-text ${type}">${text}</span>`;
        this.container.insertBefore(e, this.container.firstChild);
        while (this.container.children.length > 12) this.container.removeChild(this.container.lastChild);
    },
    checkMilestones(progress) {
        const ms = [
            { value: 0, text: '静态剖面载入完成', type: 'ok' },
            { value: 25, text: '海沟与洋中脊关系已进入清晰识别阶段', type: '' },
            { value: 50, text: '俯冲板片与大陆前缘挤压关系增强', type: 'warn' },
            { value: 75, text: '高原与造山带抬升接近设计目标', type: 'ok' },
            { value: 100, text: '构造截面达到最终展示状态', type: 'ok' },
        ];
        ms.forEach(item => {
            if (progress >= item.value && !this.marks.has(item.value)) {
                this.addEntry(item.text, item.type);
                this.marks.add(item.value);
            }
        });
    },
    reset() { this.marks.clear(); if (this.container) this.container.innerHTML = ''; },
};

/* ============================================================
   UI 同步
============================================================ */
function setEl(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
}

function syncSliderGradient(slider) {
    if (!slider) return;
    const min = Number(slider.min), max = Number(slider.max), v = Number(slider.value);
    slider.style.setProperty('--pct', `${(((v - min) / (max - min)) * 100).toFixed(1)}%`);
}

function syncTimeUI() {
    const v = Math.round(STATE.time);
    const ts = document.getElementById('timeSlider');
    const td = document.getElementById('timeDisplay');
    const tds = document.getElementById('timeDisplaySub');
    if (ts) { ts.value = String(v); syncSliderGradient(ts); }
    if (td) td.textContent = String(v);
    if (tds) tds.textContent = `T = ${v} Ma`;
}

function resetCameraView() {
    camera.position.copy(DEFAULT_CAMERA_POSITION);
    controls.target.copy(DEFAULT_CAMERA_TARGET);
    controls.update();
}

function updateDataPanel(progress, intensity, boundaryType) {
    const converge = boundaryType === 'convergent';
    setEl('collisionVelocity', `${(4.2 + progress * 3.1 * intensity).toFixed(1)} cm/yr`);
    setEl('collisionDepth', `${Math.round(60 + progress * 520 * intensity)} km`);
    setEl('upliftHeight', `${Math.round(600 + progress * 5600 * intensity).toLocaleString()} m`);
    setEl('trenchDepth', `${Math.round(4200 + progress * 3600 * intensity).toLocaleString()} m`);
    setEl('temperature', `${Math.round(960 + progress * 580 + intensity * 130)} °C`);
    setEl('pressure', `${(0.6 + progress * 18.5 * intensity).toFixed(1)} GPa`);
    setEl('stress', `${Math.round(18 + progress * 135 * intensity)} MPa`);
    setEl('boundaryMode', converge ? '碰撞剖面' : '张裂对照');

    const stages = converge
        ? [
            { zh: '初始洋盆', en: 'Initial Ocean Basin' },
            { zh: '汇聚启动', en: 'Convergence Onset' },
            { zh: '早期俯冲', en: 'Early Subduction' },
            { zh: '前陆挤压', en: 'Foreland Compression' },
            { zh: '高原抬升', en: 'Plateau Uplift' },
            { zh: '造山增强', en: 'Mountain Building' },
            { zh: '稳定格局', en: 'Stable Orogenic Section' },
        ]
        : [
            { zh: '洋底裂解', en: 'Ocean Floor Rifting' },
            { zh: '中脊形成', en: 'Ridge Formation' },
            { zh: '洋壳扩张', en: 'Oceanic Spreading' },
            { zh: '稳定扩张', en: 'Stable Divergence' },
        ];

    const si = Math.min(Math.floor(progress * stages.length), stages.length - 1);
    const stage = stages[si];
    setEl('geologicalPeriod', stage.zh);
    setEl('timeEra', stage.en);
    setEl('geoFooterPeriod', stage.zh);
    setEl('timeEraDisplay', stage.zh);
    setEl('footerTime', `T = ${Math.round(progress * 100)} Ma`);

    const motion = !converge ? '分离扩张'
        : progress < 0.1 ? '静态构型'
        : progress < 0.45 ? '俯冲增强'
        : progress < 0.8 ? '挤压抬升' : '稳定造山';
    setEl('motionStatus', motion);

    const pb = document.querySelector('.time-progress-fill');
    if (pb) pb.style.width = `${progress * 100}%`;

    document.querySelectorAll('#stressChart .chart-bar').forEach((bar, i) => {
        const local = 0.4 + Math.sin(i * 0.8 + progress * 5.4) * 0.2;
        const h = clamp(progress * 55 + intensity * 12 + local * 25, 8, 92);
        const hue = converge ? 195 - h : 210 - h * 0.4;
        bar.style.height = `${h}%`;
        bar.style.background = `linear-gradient(180deg, hsl(${hue}, 95%, ${46 + h * 0.14}%), var(--bg2))`;
    });
}

function updateSceneFromState() {
    const p = STATE.time / 100;
    tectonicModel.update(p, STATE.intensity, STATE.boundaryType);
    labelManager.update(tectonicModel.getAnchors());
    updateDataPanel(p, STATE.intensity, STATE.boundaryType);
    GEO_LOG.checkMilestones(Math.round(p * 100));
}

/* ============================================================
   事件绑定
============================================================ */
uiController.on('timeChanged', v => { STATE.time = v; syncTimeUI(); updateSceneFromState(); });
uiController.on('intensityChanged', v => {
    STATE.intensity = v;
    syncSliderGradient(document.getElementById('intensitySlider'));
    updateSceneFromState();
});
uiController.on('boundaryTypeChanged', type => {
    STATE.boundaryType = type;
    labelManager.updateMode(type);
    GEO_LOG.reset();
    GEO_LOG.addEntry(type === 'convergent' ? '切换到目标碰撞剖面展示' : '切换到张裂对照展示', 'ok');
    updateSceneFromState();
});
uiController.on('resetView', () => {
    resetCameraView();
    GEO_LOG.addEntry('镜头已重置为默认视角', '');
});
uiController.on('toggleAutoRotate', active => { STATE.autoRotate = active; controls.autoRotate = active; });
uiController.on('togglePlay', playing => {
    STATE.isPlaying = playing;
    GEO_LOG.addEntry(playing ? '时间演化播放开始' : '时间演化播放暂停', playing ? 'ok' : '');
});

/* ============================================================
   动画循环
============================================================ */
let prevTime = performance.now();
let fpsAcc = 0, fpsFrames = 0;

function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    const dt = Math.min((now - prevTime) / 1000, 0.05);
    prevTime = now;
    STATE.clock += dt;

    if (waterNormalTex) {
        waterNormalTex.offset.x += dt * 0.02;
        waterNormalTex.offset.y += dt * 0.015;
    }

    if (STATE.isPlaying) {
        STATE.time = Math.min(100, STATE.time + dt * STATE.playSpeed * 18);
        syncTimeUI();
        updateSceneFromState();
        if (STATE.time >= 100) {
            STATE.isPlaying = false;
            uiController.syncPlayButtonState(false);
            GEO_LOG.addEntry('时间演化已到终点', 'ok');
        }
    }

    controls.update();
    composer.render();
    css2dRenderer.render(scene, camera);

    fpsAcc += dt;
    fpsFrames += 1;
    if (fpsAcc >= 0.5) {
        const fps = Math.round(fpsFrames / fpsAcc);
        setEl('fps', `${fps} fps`);
        setEl('renderTime', `${Math.round((fpsAcc / fpsFrames) * 1000)} ms`);
        setEl('particleCount', '0');
        fpsAcc = 0;
        fpsFrames = 0;
    }
}

/* ============================================================
   窗口缩放
============================================================ */
window.addEventListener('resize', () => {
    const s = getContainerSize();
    width = s.width; height = s.height;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height);
    css2dRenderer.setSize(width, height);
    composer.setSize(width, height);
    bloomPass.setSize(width, height);
});

/* ============================================================
   初始化
============================================================ */
function init() {
    GEO_LOG.init();
    GEO_LOG.addEntry('板块构造剖面模型已装载', 'ok');
    GEO_LOG.addEntry('印度板块陆地、S型海湾与喜马拉雅山脉已按设计稿重建', '');

    syncTimeUI();
    syncSliderGradient(document.getElementById('timeSlider'));
    syncSliderGradient(document.getElementById('intensitySlider'));
    updateSceneFromState();

    const overlay = document.getElementById('loading-overlay');
    if (overlay) setTimeout(() => overlay.classList.add('hidden'), 1100);
}

init();
animate();
