/**
 * app-init.js
 * 应用初始化：直接展示板块构造模型
 */

export function initApp() {
    startLoadingSteps();
    
    // 直接加载板块构造模型，跳过欢迎页
    setTimeout(() => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.add('hidden');
        loadTectonicModel();
    }, 1200);
}

function startLoadingSteps() {
    const steps = [
        'LOADING WEBGL SHADERS...',
        'BUILDING MODEL SYSTEM...',
        'INITIALIZING PARTICLE SYSTEM...',
        'CALIBRATING PARAMETERS...',
        'ACTIVATING RENDER PIPELINE...',
        'SYSTEM READY',
    ];
    let idx = 0;
    const stepsEl = document.getElementById('loadingSteps');
    const interval = setInterval(() => {
        idx = (idx + 1) % steps.length;
        if (stepsEl) stepsEl.textContent = steps[idx];
        if (idx === steps.length - 1) clearInterval(interval);
    }, 200);
}

async function loadTectonicModel() {
    const modelContainer = document.getElementById('model-container');
    if (!modelContainer) return;
    
    modelContainer.style.display = 'block';
    modelContainer.innerHTML = '';
    
    const { TectonicModel } = await import('./models/TectonicModel.js');
    new TectonicModel(modelContainer);
    
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
}
