/**
 * app-init.js
 * 应用初始化：加载动画、模型选择、页面切换
 */

let currentModel = null;
let modelInstances = {};

export function initApp() {
    startLoadingSteps();
    bindModelCards();
    watchLoadingOverlay();
    
    setTimeout(() => {
        const overlay = document.getElementById('loading-overlay');
        const welcomeScreen = document.getElementById('welcome-screen');
        
        if (overlay) overlay.classList.add('hidden');
        if (welcomeScreen) welcomeScreen.classList.add('visible');
    }, 2000);
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
    }, 380);
}

function bindModelCards() {
    document.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', async () => {
            const modelType = card.dataset.model;
            await loadModel(modelType);
        });
    });
}

async function loadModel(modelType) {
    const welcomeScreen = document.getElementById('welcome-screen');
    const modelContainer = document.getElementById('model-container');
    
    welcomeScreen.classList.remove('visible');
    modelContainer.style.display = 'block';
    
    if (currentModel && currentModel.dispose) {
        currentModel.dispose();
    }
    
    modelContainer.innerHTML = '';
    
    if (modelType === 'tectonic') {
        const { TectonicModel } = await import('./models/TectonicModel.js');
        currentModel = new TectonicModel(modelContainer);
    } else if (modelType === 'wind') {
        const { WindTransportModel } = await import('./models/WindTransportModel.js');
        currentModel = new WindTransportModel(modelContainer);
    }
    
    setTimeout(() => window.dispatchEvent(new Event('resize')), 60);
}

function watchLoadingOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (!overlay) return;

    let triggered = false;
    const obs = new MutationObserver(() => {
        if (!triggered && overlay.classList.contains('hidden')) {
            triggered = true;
            obs.disconnect();
        }
    });
    obs.observe(overlay, { attributes: true, attributeFilter: ['class'] });
}

export function showWelcome() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const modelContainer = document.getElementById('model-container');
    
    if (currentModel && currentModel.dispose) {
        currentModel.dispose();
        currentModel = null;
    }
    
    modelContainer.style.display = 'none';
    modelContainer.innerHTML = '';
    welcomeScreen.classList.add('visible');
}
