/**
 * 相机控制器 v3.0
 * 功能：
 *   - 透视相机初始化
 *   - 地震晃动（幅度由 magnitude 控制，快速衰减）
 *   - 预设视角（俯视 / 侧视截面 / 默认斜视）
 *   - 自动巡游（播放时绕场景缓慢旋转 + 上下轻微摇摆）
 *   - 平滑相机移动（easeOutCubic）
 */

import * as THREE from 'three';

// 预设视角定义
export const CAMERA_PRESETS = {
    DEFAULT:   { pos: new THREE.Vector3(10, 80, 240), look: new THREE.Vector3(-10, -25, 0) },
    TOP:       { pos: new THREE.Vector3(-10, 280, 0), look: new THREE.Vector3(-20, -8, 0) },
    SIDE:      { pos: new THREE.Vector3(0, -10, 260), look: new THREE.Vector3(0, -25, 0) },
    FRONT:     { pos: new THREE.Vector3(-180, 60, 150), look: new THREE.Vector3(-10, -10, 0) },
};

export class CameraController {
    constructor(width, height) {
        // 透视相机参数
        // 进一步收紧 FOV，获得更接近科教宣传图的压缩透视效果
        this.camera = new THREE.PerspectiveCamera(40, width / height, 0.5, 3000);
        this.camera.position.copy(CAMERA_PRESETS.DEFAULT.pos);
        this.camera.lookAt(CAMERA_PRESETS.DEFAULT.look);

        this.width = width;
        this.height = height;

        // ── 地震晃动 ──
        this._shakeIntensity = 0;   // 当前晃动强度（衰减中）
        this._shakeMag       = 1.0; // 当前晃动幅度系数
        this._shakeOffset    = new THREE.Vector3();

        // ── 平滑移动 ──
        this._moveFrom     = null;
        this._moveTo       = null;
        this._lookFrom     = null;
        this._lookTo       = null;
        this._moveProgress = 1;
        this._moveDuration = 1.5;
        this._moveElapsed  = 0;

        // ── 自动巡游 ──
        this._cruiseEnabled  = false;
        this._cruiseAngle    = 0;       // 当前方位角（弧度）
        this._cruiseRadius   = 250;     // 巡游半径
        this._cruisePitchAmp = 10;      // 垂直摇摆幅度
        this._cruiseSpeed    = 0.12;    // 角速度（rad/s）
        this._cruiseBaseY    = 110;     // 基础高度

        // OrbitControls 引用（由外部设置）
        this.controls = null;
    }

    // ─────────────────────────────────────────────────────
    // 触发地震晃动
    // ─────────────────────────────────────────────────────
    triggerEarthquakeShake(magnitude = 1.0) {
        // magnitude 1 → 小幅  magnitude 3 → 较大幅
        this._shakeIntensity = Math.min(magnitude * 2.5, 7.0);
        this._shakeMag = magnitude;
    }

    // ─────────────────────────────────────────────────────
    // 平滑移动到预设视角
    // ─────────────────────────────────────────────────────
    moveTo(presetKey, duration = 1.5) {
        const preset = CAMERA_PRESETS[presetKey] || CAMERA_PRESETS.DEFAULT;
        this._moveFrom    = this.camera.position.clone();
        this._moveTo      = preset.pos.clone();
        this._lookFrom    = this.controls ? this.controls.target.clone() : new THREE.Vector3(0, -10, 0);
        this._lookTo      = preset.look.clone();
        this._moveProgress = 0;
        this._moveDuration = duration;
        this._moveElapsed  = 0;
        // 移动时关闭巡游
        this._cruiseEnabled = false;
    }

    moveToPosition(pos, lookAt, duration = 1.5) {
        this._moveFrom    = this.camera.position.clone();
        this._moveTo      = pos.clone();
        this._lookFrom    = this.controls ? this.controls.target.clone() : new THREE.Vector3(0, -10, 0);
        this._lookTo      = lookAt.clone();
        this._moveProgress = 0;
        this._moveDuration = duration;
        this._moveElapsed  = 0;
        this._cruiseEnabled = false;
    }

    // ─────────────────────────────────────────────────────
    // 开启/关闭自动巡游
    // ─────────────────────────────────────────────────────
    setCruise(enabled) {
        this._cruiseEnabled = enabled;
        if (enabled) {
            // 从当前角度开始
            const pos = this.camera.position;
            this._cruiseAngle = Math.atan2(pos.x, pos.z);
            this._cruiseRadius = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
            this._cruiseBaseY = pos.y;
        }
    }

    // ─────────────────────────────────────────────────────
    // 每帧更新
    // ─────────────────────────────────────────────────────
    update(delta) {
        const dt = Math.min(delta, 0.05);

        // ── 平滑移动 ──
        if (this._moveTo && this._moveProgress < 1) {
            this._moveElapsed += dt;
            const t = Math.min(1, this._moveElapsed / this._moveDuration);
            const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic

            this.camera.position.lerpVectors(this._moveFrom, this._moveTo, ease);
            if (this.controls && this._lookTo) {
                this.controls.target.lerpVectors(this._lookFrom, this._lookTo, ease * 0.12);
            }
            this._moveProgress = t;
            if (t >= 1) {
                this._moveTo = null;
                if (this.controls) this.controls.update();
            }
        }

        // ── 自动巡游 ──
        if (this._cruiseEnabled && !this._moveTo) {
            this._cruiseAngle += dt * this._cruiseSpeed;
            const r   = this._cruiseRadius;
            const px  = Math.sin(this._cruiseAngle) * r;
            const pz  = Math.cos(this._cruiseAngle) * r;
            const py  = this._cruiseBaseY + Math.sin(this._cruiseAngle * 0.4) * this._cruisePitchAmp;
            this.camera.position.set(px, py, pz);
            this.camera.lookAt(0, 0, 0);
            if (this.controls) {
                this.controls.target.lerp(new THREE.Vector3(0, 0, 0), 0.05);
            }
        }

        // ── 地震晃动 ──
        if (this._shakeIntensity > 0.01) {
            const amp = this._shakeIntensity * 0.3;
            this._shakeOffset.set(
                (Math.random() - 0.5) * amp,
                (Math.random() - 0.5) * amp * 0.5,
                (Math.random() - 0.5) * amp
            );
            this.camera.position.add(this._shakeOffset);
            this._shakeIntensity *= 0.85; // 快速衰减
        } else {
            this._shakeIntensity = 0;
        }
    }

    // ─────────────────────────────────────────────────────
    // 更新宽高比（窗口缩放）
    // ─────────────────────────────────────────────────────
    updateAspect(width, height) {
        this.width = width;
        this.height = height;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
    }

    getCamera() {
        return this.camera;
    }

    reset() {
        this.moveTo('DEFAULT', 1.5);
    }
}
