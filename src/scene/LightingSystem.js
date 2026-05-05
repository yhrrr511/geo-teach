/**
 * 光照系统 v3.0
 * 完全动态响应系统：
 *   - 主日光随地质时代变化
 *   - 岩浆点光随 intensity & boundaryType 变化
 *   - 科技蓝光周期移动
 *   - 地震紧急闪光
 *   - 地幔热光从下方打
 */

import * as THREE from 'three';

export class LightingSystem {
    constructor(scene) {
        this.scene = scene;

        // 光源引用
        this.skyLight = null;         // 半球光
        this.sunLight = null;         // 主方向光（太阳）
        this.moonLight = null;        // 辅方向光（大气/月）
        this.fillLight = null;        // 侧向补光
        this.frontLight = null;       // 正面补光
        this.techLight = null;        // 科技蓝点光
        this.mantleLight = null;      // 地幔热光（下方）
        this.magmaLights = [];        // 岩浆点光组（3-5个）
        this.quakeLight = null;       // 地震紧急闪光

        // 内部状态
        this._quakeFlash = 0;         // 地震闪光强度（衰减中）
        this._lastBoundaryType = '';
        this._magmaPositionConvergent = [
            new THREE.Vector3(20,  -5,  10),
            new THREE.Vector3(40,  -8,  -5),
            new THREE.Vector3(60,  -6,   8),
            new THREE.Vector3(30,  -4, -15),
            new THREE.Vector3(50, -10,  15),
        ];
        this._magmaPositionDivergent = [
            new THREE.Vector3(-30, -5,  0),
            new THREE.Vector3(-20, -8, -10),
            new THREE.Vector3(-10, -6,  12),
            new THREE.Vector3( -5, -4,  -8),
        ];

        this._initLights();
    }

    // ─────────────────────────────────────────────────────
    // 初始化所有光源
    // ─────────────────────────────────────────────────────
    _initLights() {
        // 1. 半球光（天空蓝 / 地面棕黄，大幅提高强度让场景明亮）
        this.skyLight = new THREE.HemisphereLight(0x87CEEB, 0x8B6914, 1.5);
        this.scene.add(this.skyLight);

        // 2. 主方向光（太阳光，暖黄色，高强度，带阴影）
        this.sunLight = new THREE.DirectionalLight(0xfff5d8, 2.8);
        this.sunLight.position.set(200, 300, 200);
        this.sunLight.castShadow = true;
        this.sunLight.shadow.mapSize.set(4096, 4096);
        this.sunLight.shadow.camera.left   = -400;
        this.sunLight.shadow.camera.right  =  400;
        this.sunLight.shadow.camera.top    =  400;
        this.sunLight.shadow.camera.bottom = -400;
        this.sunLight.shadow.camera.far    = 1200;
        this.sunLight.shadow.bias = -0.0008;
        this.sunLight.shadow.normalBias = 0.02;
        this.scene.add(this.sunLight);

        // 3. 辅方向光（冷白色补光，不投影）
        this.moonLight = new THREE.DirectionalLight(0xd0e8ff, 1.2);
        this.moonLight.position.set(-100, 150, -100);
        this.moonLight.castShadow = false;
        this.scene.add(this.moonLight);

        // 4. 正面补光（冷白色，增强正面可见度）
        this.frontLight = new THREE.DirectionalLight(0xe8f4ff, 0.8);
        this.frontLight.position.set(0, 100, 300);
        this.scene.add(this.frontLight);

        // 5. 科技蓝点光（移动）
        this.techLight = new THREE.PointLight(0x00d4ff, 3.0, 700);
        this.techLight.position.set(-200, 50, 0);
        this.scene.add(this.techLight);

        // 6. 地幔热光（从正下方打光，橙红色，增强强度让截面层次丰富）
        this.mantleLight = new THREE.PointLight(0xff4400, 2.5, 500);
        this.mantleLight.position.set(0, -80, 0);
        this.scene.add(this.mantleLight);

        // 6b. 地幔底部光（从更深处打上，暗红色，增加截面层次）
        this.mantleDeepLight = new THREE.PointLight(0xcc2200, 1.8, 400);
        this.mantleDeepLight.position.set(0, -150, 0);
        this.scene.add(this.mantleDeepLight);

        // 6c. 海洋反射光（冷蓝色，位于海洋区域上方）
        this.oceanLight = new THREE.PointLight(0x0066ff, 0.8, 600);
        this.oceanLight.position.set(0, 20, 0);
        this.scene.add(this.oceanLight);

        // 7. 岩浆点光组（初始使用 convergent 位置）
        const magmaColors = [0xff4400, 0xff5500, 0xff3300, 0xff6600, 0xff2200];
        for (let i = 0; i < 5; i++) {
            const ml = new THREE.PointLight(magmaColors[i], 0, 350);
            ml.position.copy(this._magmaPositionConvergent[i]);
            this.scene.add(ml);
            this.magmaLights.push(ml);
        }

        // 8. 地震紧急闪光（白色，平时强度0）
        this.quakeLight = new THREE.PointLight(0xffffff, 0, 600);
        this.quakeLight.position.set(0, 60, 0);
        this.scene.add(this.quakeLight);
    }

    // ─────────────────────────────────────────────────────
    // 触发地震闪光（供外部调用）
    // ─────────────────────────────────────────────────────
    triggerQuakeFlash(magnitude = 1.0) {
        this._quakeFlash = 4.0 * Math.min(magnitude, 3.0);
    }

    // ─────────────────────────────────────────────────────
    // 每帧更新
    // ─────────────────────────────────────────────────────
    update(clock, STATE) {
        const { time, intensity, boundaryType } = STATE;
        const normalizedTime = time / 100;
        const delta = Math.min(1 / 30, 0.05); // 保守估计

        // ── 1. 主日光：随地质时代变化 ──
        // 太古代（time=0）→ 暖橙黄；现代（time=1）→ 明亮白光
        const sunColorArchean = new THREE.Color(0xffcc66);  // 太古代：暖橙
        const sunColorModern  = new THREE.Color(0xfff5e8);  // 现代：明亮白
        const sunColorTarget  = new THREE.Color().lerpColors(sunColorArchean, sunColorModern, normalizedTime);
        this.sunLight.color.lerp(sunColorTarget, 0.05);
        this.sunLight.intensity = 2.5 + normalizedTime * 0.5; // 明亮主光，2.5~3.0

        // 阴影动态调整
        const shadowBias = -0.0008 - normalizedTime * 0.0004;
        this.sunLight.shadow.bias = shadowBias;

        // ── 2. 科技蓝光：周期移动 ──
        this.techLight.position.x = -200 + Math.sin(clock * 0.25) * 40;
        this.techLight.position.z = Math.cos(clock * 0.18) * 20;
        this.techLight.intensity  = 2.0 + Math.sin(clock * 0.7) * 0.6;

        // ── 3. 天穹光颜色周期变化 ──
        const skyT = (Math.sin(clock * 0.05) + 1) * 0.5;
        this.skyLight.groundColor.setHex(THREE.MathUtils.lerp(0x2a1a08, 0x3a2a10, skyT));

        // 边界类型变化时重新布局岩浆光
        if (boundaryType !== this._lastBoundaryType) {
            this._lastBoundaryType = boundaryType;
            this._repositionMagmaLights(boundaryType);
        }

        // ── 4. 岩浆点光 ──
        const magmaBaseIntensity = (0.5 + normalizedTime * 0.5) * intensity * 3.5;
        const magmaCount = boundaryType === 'convergent' ? 5 : 4;

        for (let i = 0; i < this.magmaLights.length; i++) {
            const ml = this.magmaLights[i];
            if (i < magmaCount) {
                // 每个灯有独立的脉动相位
                const phase = clock * (0.8 + i * 0.15) + i * 1.2;
                const pulse = 0.75 + Math.sin(phase) * 0.25;
                ml.intensity = magmaBaseIntensity * pulse;

                // 轻微位置摆动
                const basePos = boundaryType === 'convergent'
                    ? this._magmaPositionConvergent[i]
                    : this._magmaPositionDivergent[i] || this._magmaPositionConvergent[i];
                ml.position.y = basePos.y + Math.sin(clock * 0.4 + i) * 2 * normalizedTime;
            } else {
                ml.intensity = 0;
            }
        }

        // ── 5. 地幔热光（从下方）──
        const mantlePhase = clock * 0.3;
        this.mantleLight.intensity = 2.0 + normalizedTime * 1.0 + Math.sin(mantlePhase) * 0.5;
        this.mantleLight.color.setHSL(
            0.04 - normalizedTime * 0.02,   // hue: 橙→红
            1.0,
            0.3 + normalizedTime * 0.15
        );

        // ── 6. 边界类型影响颜色氛围 ──
        if (boundaryType === 'convergent') {
            // 偏橙暖色调
            this.moonLight.color.set(0xd8c0ff);
            this.moonLight.intensity = 1.0;
        } else {
            // 偏蓝冷色调
            this.moonLight.color.set(0xc0d8ff);
            this.moonLight.intensity = 1.2;
        }

        // ── 6b. 地幔底部光动态更新 ──
        if (this.mantleDeepLight) {
            this.mantleDeepLight.intensity = 1.5 + normalizedTime * 1.0 + Math.sin(mantlePhase * 0.7) * 0.4;
        }

        // ── 6c. 海洋光轻微脉动 ──
        if (this.oceanLight) {
            this.oceanLight.intensity = 0.6 + Math.sin(clock * 0.3) * 0.2;
        }

        // ── 7. 地震闪光衰减 ──
        if (this._quakeFlash > 0) {
            this.quakeLight.intensity = this._quakeFlash;
            // 随机位置轻微偏移（视觉晃动感）
            this.quakeLight.position.x = (Math.random() - 0.5) * 20;
            this.quakeLight.position.z = (Math.random() - 0.5) * 20;
            this._quakeFlash *= 0.88; // 快速衰减
            if (this._quakeFlash < 0.05) this._quakeFlash = 0;
        } else {
            this.quakeLight.intensity = 0;
        }
    }

    // ─────────────────────────────────────────────────────
    // 重新布局岩浆光（边界类型切换时）
    // ─────────────────────────────────────────────────────
    _repositionMagmaLights(boundaryType) {
        const positions = boundaryType === 'convergent'
            ? this._magmaPositionConvergent
            : this._magmaPositionDivergent;

        for (let i = 0; i < this.magmaLights.length; i++) {
            if (i < positions.length) {
                this.magmaLights[i].position.copy(positions[i]);
                // convergent 偏橙红，divergent 偏亮橙
                this.magmaLights[i].color.setHex(
                    boundaryType === 'convergent' ? 0xff3300 : 0xff5500
                );
            }
        }
    }

    // ─────────────────────────────────────────────────────
    // 兼容旧接口
    // ─────────────────────────────────────────────────────
    updateLightPositions(time, intensity) {
        // 保留向后兼容，实际逻辑在 update() 中
        this.techLight.intensity = 2.0 + Math.sin(time * 0.7) * 0.6;
    }

    getLights() {
        return [
            this.skyLight,
            this.sunLight,
            this.moonLight,
            this.frontLight,
            this.techLight,
            this.mantleLight,
            this.mantleDeepLight,
            this.oceanLight,
            ...this.magmaLights,
            this.quakeLight,
        ];
    }
}
