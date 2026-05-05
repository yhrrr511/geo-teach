/**
 * 地理标签系统 v3.0
 * 使用 CSS2DRenderer 在3D空间中渲染地理名称标签
 * 新增功能：
 *   - 标签带背景框（半透明玻璃态）
 *   - 不同类型不同颜色（山峰白/海沟蓝/火山橙/裂谷红）
 *   - 随地质进度逐渐显示（time >= visibleAfter）
 *   - 显示时淡入，隐藏时淡出
 *   - 标签轻微上下浮动动效
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

// 标签类型配色方案
const TYPE_THEME = {
    danger:  { border: '#ff4400', text: '#ff6633', glow: 'rgba(255,68,0,0.45)',  bg: 'rgba(20,4,0,0.88)'   },
    ocean:   { border: '#0088ff', text: '#44aaff', glow: 'rgba(0,136,255,0.40)', bg: 'rgba(0,8,24,0.88)'   },
    land:    { border: '#ffaa00', text: '#ffcc44', glow: 'rgba(255,170,0,0.40)', bg: 'rgba(20,14,0,0.88)'  },
    ridge:   { border: '#ff4400', text: '#ff9944', glow: 'rgba(255,80,0,0.50)',  bg: 'rgba(20,4,0,0.88)'   },
    arc:     { border: '#00ff88', text: '#44ffaa', glow: 'rgba(0,255,136,0.40)', bg: 'rgba(0,20,10,0.88)'  },
    special: { border: '#ff00cc', text: '#ff55ee', glow: 'rgba(255,0,200,0.50)', bg: 'rgba(20,0,16,0.88)'  },
    summit:  { border: '#ffffff', text: '#ffffff', glow: 'rgba(255,255,255,0.3)', bg: 'rgba(8,12,20,0.88)' },
    trench:  { border: '#0044ff', text: '#4488ff', glow: 'rgba(0,68,255,0.45)',  bg: 'rgba(0,4,20,0.88)'   },
    volcano: { border: '#ff6600', text: '#ffaa44', glow: 'rgba(255,100,0,0.50)', bg: 'rgba(20,6,0,0.88)'   },
    rift:    { border: '#ff2200', text: '#ff6644', glow: 'rgba(255,34,0,0.50)',  bg: 'rgba(20,2,0,0.88)'   },
};

export class GeoLabels {
    constructor(scene, css2dRenderer, eurasiaPlate, pacificPlate) {
        this.scene = scene;
        this.renderer = css2dRenderer;
        this.eurasia = eurasiaPlate;
        this.pacific = pacificPlate;

        this._labelObjects = [];
        this._currentType  = 'convergent';
        this._clock        = 0;

        this._initStyles();
        this.updateForBoundaryType('convergent');
    }

    // ─────────────────────────────────────────────────────
    // 全局样式注入
    // ─────────────────────────────────────────────────────
    _initStyles() {
        if (document.getElementById('geoLabelStylesV3')) return;
        const style = document.createElement('style');
        style.id = 'geoLabelStylesV3';
        style.textContent = `
            /* ── 外层包裹 ── */
            .geo-lbl-wrap {
                pointer-events: auto;
                cursor: pointer;
                transform: translateX(-50%) translateY(-50%);
                will-change: opacity, transform;
            }
            /* ── 标签盒子（玻璃态） ── */
            .geo-lbl-box {
                position: relative;
                padding: 5px 11px 5px 10px;
                border-radius: 4px;
                border-left-width: 3px;
                border-left-style: solid;
                border-top: 1px solid;
                border-right: 1px solid;
                border-bottom: 1px solid;
                font-family: 'Courier New', 'Consolas', monospace;
                font-size: 11px;
                white-space: nowrap;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                box-shadow: 0 2px 12px var(--lbl-glow, rgba(0,200,255,0.3)),
                            inset 0 0 8px rgba(255,255,255,0.03);
                transition: box-shadow 0.3s ease;
            }
            .geo-lbl-box:hover {
                box-shadow: 0 2px 20px var(--lbl-glow, rgba(0,200,255,0.5)),
                            inset 0 0 10px rgba(255,255,255,0.06);
                transform: scale(1.05);
            }
            /* ── 连接线 ── */
            .geo-lbl-line {
                position: absolute;
                bottom: -10px;
                left: 50%;
                transform: translateX(-50%);
                width: 1px;
                height: 10px;
                opacity: 0.55;
            }
            /* ── 终点光点 ── */
            .geo-lbl-dot {
                position: absolute;
                bottom: -16px;
                left: 50%;
                transform: translateX(-50%);
                width: 5px;
                height: 5px;
                border-radius: 50%;
                animation: lblDotPulse 2s ease-in-out infinite;
            }
            @keyframes lblDotPulse {
                0%, 100% { opacity: 1; transform: translateX(-50%) scale(1); }
                50%       { opacity: 0.5; transform: translateX(-50%) scale(1.5); }
            }
            /* ── 副标题 ── */
            .geo-lbl-sub {
                display: block;
                font-size: 9px;
                opacity: 0.68;
                margin-top: 2px;
                letter-spacing: 0.04em;
                text-transform: none;
            }
            /* ── 浮动动画（已出现的标签） ── */
            @keyframes lblFloat {
                0%, 100% { transform: translateX(-50%) translateY(-50%); }
                50%       { transform: translateX(-50%) translateY(-56%); }
            }
            .geo-lbl-wrap.floating {
                animation: lblFloat 3s ease-in-out infinite;
            }
        `;
        document.head.appendChild(style);
    }

    // ─────────────────────────────────────────────────────
    // 标签数据定义
    // ─────────────────────────────────────────────────────
    _getConvergentLabels() {
        return [
            {
                id: 'eurasia_label',
                name: '亚欧板块',
                sub: 'Eurasian Plate',
                type: 'land',
                pos3d: new THREE.Vector3(70, 25, -15),
                visibleAfter: 0.0,
            },
            {
                id: 'pacific_label',
                name: '大洋板块', // Can be Indo-Australian or Pacific depending on exact context, let's use generic or specific
                sub: 'Oceanic Plate',
                type: 'ocean',
                pos3d: new THREE.Vector3(-30, 8, 10),
                visibleAfter: 0.0,
                followPacific: true,
                pacificOffset: new THREE.Vector3(-30, 8, 10),
            },
            {
                id: 'subduction',
                name: '俯冲带',
                sub: 'Subduction Zone',
                type: 'danger',
                pos3d: new THREE.Vector3(20, -5, 25), // In front of the trench
                visibleAfter: 0.1,
                followPacific: true,
                pacificOffset: new THREE.Vector3(65, -5, 25), // Follows the trench
            },
            {
                id: 'shallow_sea',
                name: '浅海',
                sub: 'Shallow Sea',
                type: 'ocean',
                pos3d: new THREE.Vector3(25, 4, 15),
                visibleAfter: 0.0,
            },
            {
                id: 'lithosphere_eurasia',
                name: '岩石圈',
                sub: 'Lithosphere',
                type: 'land',
                pos3d: new THREE.Vector3(80, -10, 48), // On the front cross section
                visibleAfter: 0.0,
            },
            {
                id: 'asthenosphere',
                name: '软流圈',
                sub: 'Asthenosphere (Magma)',
                type: 'volcano',
                pos3d: new THREE.Vector3(-10, -25, 48), // Front magma area
                visibleAfter: 0.0,
            },
            {
                id: 'mid_ridge',
                name: '洋中脊',
                sub: 'Mid-Ocean Ridge',
                type: 'ridge',
                pos3d: new THREE.Vector3(-75, -1, -5),
                visibleAfter: 0.0,
                followPacific: true,
                pacificOffset: new THREE.Vector3(-75, -1, -5),
            }
        ];
    }

    _getDivergentLabels() {
        return [
            {
                id: 'eurasia_div',
                name: '亚欧板块（右移）',
                sub: 'Eurasian Plate',
                type: 'land',
                pos3d: new THREE.Vector3(60, 3, -25),
                visibleAfter: 0.0,
            },
            {
                id: 'pacific_div',
                name: '太平洋板块（左移）',
                sub: 'Pacific Plate',
                type: 'ocean',
                pos3d: new THREE.Vector3(0, 3, 25),
                visibleAfter: 0.0,
                followPacific: true,
                pacificOffset: new THREE.Vector3(-10, 3, 25),
            },
            {
                id: 'ridge',
                name: '洋中脊',
                sub: 'Mid-Ocean Ridge · 海底山脉',
                type: 'ridge',
                pos3d: new THREE.Vector3(-10, 12, -20),
                visibleAfter: 0.08,
                followMid: true,
            },
            {
                id: 'rift',
                name: '裂谷',
                sub: 'Rift Valley · 板块分离带',
                type: 'rift',
                pos3d: new THREE.Vector3(-10, 5, 15),
                visibleAfter: 0.05,
                followMid: true,
            },
            {
                id: 'newcrust',
                name: '新生洋壳',
                sub: 'New Oceanic Crust',
                type: 'arc',
                pos3d: new THREE.Vector3(5, 3, -30),
                visibleAfter: 0.12,
            },
            {
                id: 'hydro',
                name: '热液喷口',
                sub: 'Hydrothermal Vent · 深海',
                type: 'ocean',
                pos3d: new THREE.Vector3(-10, 3, 0),
                visibleAfter: 0.2,
                followMid: true,
                midOffset: new THREE.Vector3(0, 3, 0),
            },
            {
                id: 'magma_up',
                name: '岩浆上涌',
                sub: 'Magma Upwelling · 地幔对流',
                type: 'volcano',
                pos3d: new THREE.Vector3(-10, 15, 30),
                visibleAfter: 0.1,
                followMid: true,
                midOffset: new THREE.Vector3(0, 15, 30),
            },
        ];
    }

    // ─────────────────────────────────────────────────────
    // 切换标签集
    // ─────────────────────────────────────────────────────
    updateForBoundaryType(type) {
        this._currentType = type;
        // 先淡出旧标签，再移除
        for (const obj of this._labelObjects) {
            obj.wrap.style.opacity = '0';
            obj.wrap.style.transform = 'translateX(-50%) translateY(-40%)';
            const css2d = obj.css2d;
            setTimeout(() => { this.scene.remove(css2d); }, 600);
        }
        this._labelObjects = [];

        const defs = type === 'convergent' ? this._getConvergentLabels() : this._getDivergentLabels();
        for (const def of defs) {
            this._createLabel(def);
        }
    }

    _createLabel(def) {
        const theme = TYPE_THEME[def.type] || TYPE_THEME['land'];

        const wrap = document.createElement('div');
        wrap.className = 'geo-lbl-wrap';
        wrap.style.cssText = `
            opacity: 0;
            transition: opacity 0.8s cubic-bezier(0.25,0.46,0.45,0.94),
                        transform 0.8s cubic-bezier(0.25,0.46,0.45,0.94);
            transform: translateX(-50%) translateY(-40%);
        `;

        const box = document.createElement('div');
        box.className = 'geo-lbl-box';
        box.style.cssText = `
            background: ${theme.bg};
            border-color: ${theme.border};
            color: ${theme.text};
            --lbl-glow: ${theme.glow};
            box-shadow: 0 2px 12px ${theme.glow},
                        inset 0 0 8px rgba(255,255,255,0.03);
        `;

        const nameSpan = document.createElement('span');
        nameSpan.textContent = def.name;
        box.appendChild(nameSpan);

        if (def.sub) {
            const subSpan = document.createElement('span');
            subSpan.className = 'geo-lbl-sub';
            subSpan.textContent = def.sub;
            subSpan.style.color = theme.text;
            box.appendChild(subSpan);
        }

        // 连接线
        const line = document.createElement('div');
        line.className = 'geo-lbl-line';
        line.style.background = theme.border;
        box.appendChild(line);

        // 终点光点
        const dot = document.createElement('div');
        dot.className = 'geo-lbl-dot';
        dot.style.cssText = `background: ${theme.border}; box-shadow: 0 0 5px ${theme.glow};`;
        box.appendChild(dot);

        wrap.appendChild(box);

        const cssObj = new CSS2DObject(wrap);
        cssObj.position.copy(def.pos3d);
        this.scene.add(cssObj);

        this._labelObjects.push({
            css2d: cssObj,
            def,
            wrap,
            box,
            visible: def.visibleAfter <= 0,
            _floatTimer: Math.random() * Math.PI * 2, // 随机相位偏移
        });

        // 初始状态
        if (def.visibleAfter <= 0) {
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    wrap.style.opacity = '1';
                    wrap.style.transform = 'translateX(-50%) translateY(-50%)';
                    wrap.classList.add('floating');
                });
            });
        }
    }

    // ─────────────────────────────────────────────────────
    // 每帧更新
    // ─────────────────────────────────────────────────────
    updatePositions(time, intensity, boundaryType) {
        const midX = this._getMidX();

        for (const label of this._labelObjects) {
            const { def, css2d, wrap } = label;

            // ── 可见性控制（淡入淡出）──
            const shouldShow = time >= def.visibleAfter;
            if (shouldShow !== label.visible) {
                label.visible = shouldShow;
                if (shouldShow) {
                    wrap.style.opacity = '1';
                    wrap.style.transform = 'translateX(-50%) translateY(-50%)';
                    wrap.classList.add('floating');
                } else {
                    wrap.style.opacity = '0';
                    wrap.style.transform = 'translateX(-50%) translateY(-40%)';
                    wrap.classList.remove('floating');
                }
            }

            if (!label.visible) continue;

            // ── 位置跟随 ──
            if (def.followPacific && def.pacificOffset) {
                const pacPos = this.pacific.group.position;
                css2d.position.copy(pacPos).add(def.pacificOffset);
            } else if (def.followMid) {
                const offset = def.midOffset || new THREE.Vector3();
                css2d.position.set(midX + offset.x, def.pos3d.y + offset.y, def.pos3d.z + offset.z);
            } else if (def.id === 'eurasia_label' || def.id === 'eurasia_div') {
                css2d.position.set(
                    this.eurasia.group.position.x + (def.pos3d.x - 50),
                    def.pos3d.y,
                    def.pos3d.z
                );
            }

            // 青藏高原/喜马拉雅随山脉隆起上移
            if ((def.id === 'tibetan' || def.id === 'himalaya') && this.eurasia.mountainMesh) {
                const mountainY = this.eurasia.mountainMesh.scale.y * 15;
                css2d.position.y = (def.id === 'tibetan' ? 6 : 8) + mountainY;
            }
        }
    }

    _getMidX() {
        return (this.eurasia.group.position.x + this.pacific.group.position.x) / 2 - 30;
    }
}
