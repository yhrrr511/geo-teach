/**
 * 场景管理器 v2.0
 * 负责 Three.js 场景的初始化和基本管理
 * 增强：指数雾、更深的背景色
 */

import * as THREE from 'three';

export class SceneManager {
    constructor() {
        this.scene = new THREE.Scene();
        this._initScene();
    }

    /**
     * 初始化场景基本属性
     */
    _initScene() {
        // 深空背景色
        this.scene.background = new THREE.Color(0x050d1a);

        // 指数雾（比线性雾更自然，增加深度感）
        this.scene.fog = new THREE.FogExp2(0x050d1a, 0.0010);
    }

    /**
     * 动态更新雾色（随边界类型切换氛围）
     * @param {string} boundaryType - 'convergent' | 'divergent'
     * @param {number} t - 0~1 过渡因子
     */
    updateFogColor(boundaryType, t = 1.0) {
        if (!this.scene.fog) return;
        const targetColor = boundaryType === 'convergent'
            ? new THREE.Color(0x08060a)   // 偏紫暗（俯冲带暗沉）
            : new THREE.Color(0x030d18);  // 偏蓝深（生长带冷感）
        this.scene.fog.color.lerp(targetColor, t * 0.04);
    }

    add(object) {
        this.scene.add(object);
        return this;
    }

    remove(object) {
        this.scene.remove(object);
        return this;
    }

    getScene() {
        return this.scene;
    }

    clear() {
        while (this.scene.children.length > 0) {
            this.scene.remove(this.scene.children[0]);
        }
        return this;
    }
}
