/**
 * app-init.js
 * 应用初始化：加载动画、滑块、三视图切换、事件绑定
 */

import { isPdfLoaded, initKeyboard, initPdfButtons, setShowViewCallback } from './pdf/PdfViewer.js';

// 三视图切换
export function showView(view) {
    const welcomeScreen = document.getElementById('welcome-screen');
    const pdfViewer     = document.getElementById('pdf-viewer');
    const appEl         = document.querySelector('.app');

    welcomeScreen.classList.remove('visible');
    pdfViewer.classList.remove('visible');
    appEl.style.display = 'none';

    if (view === 'welcome') {
        welcomeScreen.classList.add('visible');
    } else if (view === 'pdf') {
        pdfViewer.classList.add('visible');
    } else if (view === 'model') {
        appEl.style.display = '';
        setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
    }
}

// 滑块渐变同步
function syncSliderGradient(slider) {
    if (typeof slider === 'string') slider = document.getElementById(slider);
    if (!slider) return;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const val = parseFloat(slider.value);
    const pct = ((val - min) / (max - min) * 100).toFixed(1) + '%';
    slider.style.setProperty('--pct', pct);
}

// 应力图表空闲动画
function startIdleStressAnim() {
    const bars = document.querySelectorAll('.chart-bar');
    let animId  = null;
    let stopped = false;

    function tick() {
        bars.forEach(bar => { bar.style.height = (8 + Math.random() * 20) + '%'; });
        animId = setTimeout(tick, 700);
    }
    tick();

    const timeSlider = document.getElementById('timeSlider');
    if (timeSlider) {
        timeSlider.addEventListener('input', () => {
            if (!stopped) { clearTimeout(animId); stopped = true; }
        }, { once: true });
    }
}

// 加载步骤文字动效
function startLoadingSteps() {
    const steps = [
        'LOADING WEBGL SHADERS...',
        'BUILDING PLATE GEOMETRY...',
        'INITIALIZING PARTICLE SYSTEM...',
        'CALIBRATING GEOLOGICAL PARAMETERS...',
        'ACTIVATING BLOOM PIPELINE...',
        'SYSTEM READY',
    ];
    let idx = 0;
    const stepsEl  = document.getElementById('loadingSteps');
    const interval = setInterval(() => {
        idx = (idx + 1) % steps.length;
        if (stepsEl) stepsEl.textContent = steps[idx];
        if (idx === steps.length - 1) clearInterval(interval);
    }, 380);
}

// 导航按钮事件
function bindNavButtons() {
    document.getElementById('enterModelBtn')?.addEventListener('click', () => showView('model'));
    document.getElementById('switchToModelBtn')?.addEventListener('click', () => showView('model'));
    document.getElementById('switchToPdfBtn')?.addEventListener('click', () => {
        showView(isPdfLoaded() ? 'pdf' : 'welcome');
    });
}

// loading overlay 隐藏后显示欢迎页
function watchLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;

    let triggered = false;
    const obs = new MutationObserver(() => {
        if (!triggered && overlay.classList.contains('hidden')) {
            triggered = true;
            obs.disconnect();
            const anyActive =
                document.getElementById('welcome-screen').classList.contains('visible') ||
                document.getElementById('pdf-viewer').classList.contains('visible') ||
                document.querySelector('.app').style.display !== 'none';
            if (!anyActive) showView('welcome');
        }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
}

// 入口：初始化所有
export function initApp() {
    const timeSlider      = document.getElementById('timeSlider');
    const intensitySlider = document.getElementById('intensitySlider');
    syncSliderGradient(timeSlider);
    syncSliderGradient(intensitySlider);

    if (timeSlider) {
        timeSlider.addEventListener('input', () => {
            syncSliderGradient(timeSlider);
            const display = document.getElementById('timeDisplaySub');
            if (display) display.textContent = 'T = ' + parseInt(timeSlider.value) + ' Ma';
        });
    }
    if (intensitySlider) {
        intensitySlider.addEventListener('input', () => syncSliderGradient(intensitySlider));
    }

    startIdleStressAnim();
    startLoadingSteps();
    watchLoadingOverlay();

    window.addEventListener('load', () => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            setTimeout(() => {
                overlay.classList.add('hidden');
                // 如果用户已经提前切换到了 model 或 pdf 视图，不要强制跳回欢迎页
                const appEl     = document.querySelector('.app');
                const pdfViewer = document.getElementById('pdf-viewer');
                const alreadyInView =
                    (appEl     && appEl.style.display !== 'none') ||
                    (pdfViewer && pdfViewer.classList.contains('visible'));
                if (!alreadyInView) {
                    showView('welcome');
                }
            }, 2800);
        }
    });

    bindNavButtons();

    setShowViewCallback(showView);
    initPdfButtons();
    initKeyboard();
}
