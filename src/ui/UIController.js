/**
 * UI 控制器 v2.1
 * 管理：时间滑块、强度滑块、边界类型切换、视角控制、自动播放
 * 使用简单的事件发射器模式
 */

export class UIController {
    constructor(state) {
        this.state = state;
        this._listeners = {};
        this._autoRotateActive = false;
        this._isPlaying = false;

        this._bindElements();
        this._startSystemClock();
    }

    // ──────────────────────────────────────────────────────────
    // DOM 绑定
    // ──────────────────────────────────────────────────────────
    _bindElements() {
        // 时间滑块
        const timeSlider = document.getElementById('timeSlider');
        if (timeSlider) {
            timeSlider.addEventListener('input', (e) => {
                const v = parseInt(e.target.value);
                this.state.time = v;
                this.state.isPlaying = false;
                this._isPlaying = false;
                this._syncPlayBtn(false);
                this._syncSliderGradient(e.target);

                const display = document.getElementById('timeDisplay');
                if (display) display.textContent = v;
                this._emit('timeChanged', v);
            });
            // 按下时暂停自动播放
            timeSlider.addEventListener('mousedown', () => {
                if (this._isPlaying) {
                    this._isPlaying = false;
                    this.state.isPlaying = false;
                    this._syncPlayBtn(false);
                }
            });
        }

        // 强度滑块
        const intensitySlider = document.getElementById('intensitySlider');
        if (intensitySlider) {
            intensitySlider.addEventListener('input', (e) => {
                const v = parseFloat(e.target.value);
                this.state.intensity = v;
                this._syncSliderGradient(e.target);

                const display = document.getElementById('intensityDisplay');
                if (display) display.textContent = v.toFixed(1);
                this._emit('intensityChanged', v);

                // 强度图标颜色联动
                this._updateIntensityLevel(v);
            });
        }

        // 消亡边界按钮
        const convBtn = document.getElementById('convergentBtn');
        if (convBtn) {
            convBtn.addEventListener('click', () => {
                this._setActiveBtn('convergentBtn');
                this._emit('boundaryTypeChanged', 'convergent');
                this._updateBoundaryInfo('convergent');
                // 更新头部徽章
                const badge = document.getElementById('boundaryTypeBadge');
                if (badge) {
                    badge.textContent = '▶ 消亡边界 · CONVERGENT';
                    badge.className = 'header-badge active';
                }
                // 更新底部状态
                const bm = document.getElementById('boundaryMode');
                if (bm) bm.textContent = '消亡边界';
            });
        }

        // 生长边界按钮
        const divBtn = document.getElementById('divergentBtn');
        if (divBtn) {
            divBtn.addEventListener('click', () => {
                this._setActiveBtn('divergentBtn');
                this._emit('boundaryTypeChanged', 'divergent');
                this._updateBoundaryInfo('divergent');
                // 更新头部徽章
                const badge = document.getElementById('boundaryTypeBadge');
                if (badge) {
                    badge.textContent = '▶ 生长边界 · DIVERGENT';
                    badge.className = 'header-badge active divergent';
                }
                // 更新底部状态
                const bm = document.getElementById('boundaryMode');
                if (bm) bm.textContent = '生长边界';
            });
        }

        // 重置视角
        const resetBtn = document.getElementById('resetViewBtn');
        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                this._emit('resetView');
            });
        }

        // 自动旋转
        const rotateBtn = document.getElementById('toggleAutoRotate');
        if (rotateBtn) {
            rotateBtn.addEventListener('click', () => {
                this._autoRotateActive = !this._autoRotateActive;
                rotateBtn.classList.toggle('active', this._autoRotateActive);
                const statusEl = document.getElementById('rotateStatus');
                if (statusEl) statusEl.textContent = this._autoRotateActive ? 'ON' : 'OFF';
                this._emit('toggleAutoRotate', this._autoRotateActive);
            });
        }

        // 播放/暂停按钮
        const playBtn = document.getElementById('playBtn');
        if (playBtn) {
            playBtn.addEventListener('click', () => {
                // 若已到100，重置
                if (this.state.time >= 100) {
                    this.state.time = 0;
                    const ts = document.getElementById('timeSlider');
                    const td = document.getElementById('timeDisplay');
                    if (ts) { ts.value = 0; this._syncSliderGradient(ts); }
                    if (td) td.textContent = '0';
                    this._emit('timeChanged', 0);
                }
                this._isPlaying = !this._isPlaying;
                this.state.isPlaying = this._isPlaying;
                this._syncPlayBtn(this._isPlaying);
                this._emit('togglePlay', this._isPlaying);
            });
        }

        // 初始化显示
        this._syncSliderGradient(document.getElementById('timeSlider'));
        this._syncSliderGradient(document.getElementById('intensitySlider'));
        this._updateBoundaryInfo('convergent');
    }

    // ──────────────────────────────────────────────────────────
    // 辅助方法
    // ──────────────────────────────────────────────────────────
    _setActiveBtn(activeId) {
        ['convergentBtn', 'divergentBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.toggle('active', id === activeId);
        });
    }

    _syncSliderGradient(slider) {
        if (!slider) return;
        const min = parseFloat(slider.min);
        const max = parseFloat(slider.max);
        const val = parseFloat(slider.value);
        const pct = ((val - min) / (max - min) * 100).toFixed(1) + '%';
        slider.style.setProperty('--pct', pct);
    }

    _syncPlayBtn(playing) {
        const btn = document.getElementById('playBtn');
        if (!btn) return;
        const icon = btn.querySelector('.btn-icon');
        const text = btn.querySelector('.btn-text');
        if (playing) {
            btn.classList.add('active');
            if (icon) icon.textContent = '⏸';
            if (text) text.textContent = '暂停播放';
        } else {
            btn.classList.remove('active');
            if (icon) icon.textContent = '▶';
            if (text) text.textContent = '自动播放';
        }
    }

    // 对外暴露，供 main.js 在播放完毕时调用
    syncPlayButtonState(playing) {
        this._isPlaying = playing;
        this.state.isPlaying = playing;
        this._syncPlayBtn(playing);
    }

    _updateIntensityLevel(v) {
        const display = document.getElementById('intensityDisplay');
        if (!display) return;
        if (v <= 1.0) {
            display.style.color = 'var(--cyan)';
            display.style.textShadow = '0 0 8px var(--glow-c)';
        } else if (v <= 2.0) {
            display.style.color = 'var(--orange)';
            display.style.textShadow = '0 0 8px var(--glow-o)';
        } else {
            display.style.color = '#ff2244';
            display.style.textShadow = '0 0 12px rgba(255,34,68,0.6)';
        }
    }

    _updateBoundaryInfo(type) {
        const infoEl = document.getElementById('boundaryInfo');
        if (!infoEl) return;
        if (type === 'convergent') {
            infoEl.innerHTML = `
                <div class="info-item">⛰ 俯冲碰撞，形成山脉与海沟</div>
                <div class="info-item">🌋 俯冲带产生岩浆，形成火山弧</div>
                <div class="info-item">🏝 岛弧在大陆边缘生成</div>
                <div class="info-item">⚡ 地震频繁，能量释放强烈</div>
            `;
        } else {
            infoEl.innerHTML = `
                <div class="info-item">🌊 两板块相互远离，裂谷张开</div>
                <div class="info-item">🔥 洋中脊隆起，岩浆持续喷出</div>
                <div class="info-item">🪨 新洋壳从中脊向两侧扩展</div>
                <div class="info-item">💧 深海热液喷口系统活跃</div>
            `;
        }
    }

    // ──────────────────────────────────────────────────────────
    // 系统时钟
    // ──────────────────────────────────────────────────────────
    _startSystemClock() {
        const sysTime = document.getElementById('sysTime');
        if (sysTime) {
            const updateTime = () => {
                const now = new Date();
                sysTime.textContent = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
            };
            updateTime();
            setInterval(updateTime, 1000);
        }
    }

    // ──────────────────────────────────────────────────────────
    // 事件系统
    // ──────────────────────────────────────────────────────────
    on(event, cb) {
        if (!this._listeners[event]) this._listeners[event] = [];
        this._listeners[event].push(cb);
        return this;
    }

    _emit(event, data) {
        (this._listeners[event] || []).forEach(cb => cb(data));
    }
}
