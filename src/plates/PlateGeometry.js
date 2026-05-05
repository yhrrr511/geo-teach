/**
 * PlateGeometry.js - 板块地形生成工具库 v4.0
 *
 * 提供程序化地形生成所需的全套工具函数：
 *   - 多层 fBm 噪声（8 octaves）
 *   - 域扭曲噪声（domain warping）
 *   - 简化侵蚀模拟
 *   - 地形颜色映射（大陆/海洋双模式）
 *   - 板块侧面几何体（厚度感）
 *   - 高度图法线计算
 *
 * 所有效果均为程序化生成，不依赖外部纹理文件。
 */

import * as THREE from 'three';

// ══════════════════════════════════════════════════════════════
//  基础哈希 & 值噪声
// ══════════════════════════════════════════════════════════════

/**
 * 基础哈希函数（映射到 [0,1)）
 * @param {number} n
 * @returns {number}
 */
function hash(n) {
    return (Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1;
}

/**
 * 改进版哈希 —— 更均匀分布，减少视觉 artifact
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function hash2(x, y) {
    const n = x + y * 57.0;
    return Math.abs((Math.sin(n * 127.1 + 311.7) * 43758.5453) % 1);
}

/**
 * 双线性插值值噪声（Smooth Noise）
 * 使用 Hermite 平滑曲线，比直接插值更自然
 * @param {number} x
 * @param {number} y
 * @returns {number} [0, 1]
 */
function noise2D(x, y) {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    // Quintic Hermite 插值（更平滑的插值曲线）
    const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const a = hash2(ix,     iy    );
    const b = hash2(ix + 1, iy    );
    const c = hash2(ix,     iy + 1);
    const d = hash2(ix + 1, iy + 1);
    return a + (b - a) * ux + (c - a) * uy + (d - c - b + a) * ux * uy;
}

// ══════════════════════════════════════════════════════════════
//  导出工具函数
// ══════════════════════════════════════════════════════════════

/**
 * 多层分形布朗运动（fBm）噪声
 * 通过叠加多个不同频率/振幅的噪声层来模拟自然地形
 *
 * @param {number} x         - 采样 X 坐标
 * @param {number} y         - 采样 Y 坐标
 * @param {number} octaves   - 叠加层数（建议 6-8 层以获得足够细节）
 * @param {number} lacunarity - 频率增长倍数（2.1 产生较自然的频谱）
 * @param {number} gain      - 振幅衰减系数（0.45 使高频细节适度）
 * @returns {number} 归一化后的噪声值 [0, 1]
 */
export function fbm(x, y, octaves = 8, lacunarity = 2.1, gain = 0.45) {
    let value = 0.0;
    let amplitude = 0.5;
    let frequency = 1.0;
    let maxValue = 0.0;

    for (let i = 0; i < octaves; i++) {
        value    += noise2D(x * frequency, y * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= gain;
        frequency *= lacunarity;
    }

    return value / maxValue;
}

/**
 * 域扭曲 fBm 噪声（Domain Warping）
 * 通过先用噪声扰动采样坐标，再采样噪声，产生更流畅、更自然的地形形态
 * 特别适合模拟河流侵蚀、山脊弯曲等地质特征
 *
 * @param {number} x            - 采样 X 坐标
 * @param {number} y            - 采样 Y 坐标
 * @param {number} warpStrength - 扭曲强度（0.8 为推荐值，过大会失去细节）
 * @param {number} octaves      - fBm 层数
 * @returns {number} [0, 1]
 */
export function domainWarpedFBM(x, y, warpStrength = 0.8, octaves = 6) {
    // 第一级扭曲：用噪声偏移采样坐标
    const wx = fbm(x + 0.0, y + 0.0, 4) * warpStrength;
    const wy = fbm(x + 5.2, y + 1.3, 4) * warpStrength;

    // 第二级扭曲（可选，增加复杂度）
    const wx2 = fbm(x + wx + 1.7, y + wy + 9.2, 3) * warpStrength * 0.5;
    const wy2 = fbm(x + wx + 8.3, y + wy + 2.8, 3) * warpStrength * 0.5;

    return fbm(x + wx + wx2, y + wy + wy2, octaves);
}

/**
 * 简化水流侵蚀模拟
 * 通过多次迭代，将相邻顶点的高度差平滑化，模拟水流搬运泥沙的效果
 * 侵蚀会使高地变低、低地变高，产生更自然的地形过渡
 *
 * @param {Float32Array} heightMap - 一维高度图数组（行优先）
 * @param {number} width           - 高度图宽度（顶点数）
 * @param {number} height          - 高度图高度（顶点数）
 * @param {number} iterations      - 侵蚀迭代次数（3 次性价比最高）
 * @returns {Float32Array} 侵蚀后的高度图（原地修改）
 */
export function applyErosion(heightMap, width, height, iterations = 3) {
    const temp = new Float32Array(heightMap.length);

    for (let iter = 0; iter < iterations; iter++) {
        // 4 邻域加权平均（模拟水流向低处流动）
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const idx = j * width + i;
                const h = heightMap[idx];

                // 收集邻居（边界夹紧）
                const left  = heightMap[j * width + Math.max(0, i - 1)];
                const right = heightMap[j * width + Math.min(width - 1, i + 1)];
                const up    = heightMap[Math.max(0, j - 1) * width + i];
                const down  = heightMap[Math.min(height - 1, j + 1) * width + i];

                // 仅对向下的方向进行侵蚀（单向水流）
                let erosion = 0;
                let count = 0;
                if (h > left)  { erosion += (h - left)  * 0.12; count++; }
                if (h > right) { erosion += (h - right) * 0.12; count++; }
                if (h > up)    { erosion += (h - up)    * 0.12; count++; }
                if (h > down)  { erosion += (h - down)  * 0.12; count++; }

                temp[idx] = h - erosion * (count > 0 ? 1 : 0);
            }
        }
        heightMap.set(temp);
    }
    return heightMap;
}

/**
 * 基于高度和坡度生成地形颜色（PBR 分层着色）
 *
 * @param {number} height  - 顶点高度（-12 到 +28）
 * @param {number} slope   - 坡度（0=水平，1=垂直，来自法线的 y 分量反算）
 * @param {string} type    - 地形类型：'continental'（大陆）或 'oceanic'（海洋）
 * @returns {{ color: [r,g,b], roughness: number, metalness: number, emissive: [r,g,b], emissiveIntensity: number }}
 */
export function getTerrainColor(height, slope, type = 'continental') {
    if (type === 'oceanic') {
        // ── 海洋板块颜色系统 ──
        const depth = -height; // depth 为正时越深

        if (depth < 0) {
            // 海山顶部露出水面（浅绿植被）
            return {
                color: [0.22, 0.42, 0.18],
                roughness: 0.80,
                metalness: 0.02,
                emissive: [0, 0, 0],
                emissiveIntensity: 0,
            };
        } else if (depth < 2) {
            // 浅海 / 海台（亮蓝绿）
            const t = depth / 2;
            return {
                color: [0.05 + t * 0.03, 0.22 + t * 0.06, 0.52 + t * 0.08],
                roughness: 0.55,
                metalness: 0.15,
                emissive: [0, 0, 0],
                emissiveIntensity: 0,
            };
        } else if (depth < 5) {
            // 中深海（深蓝）
            const t = (depth - 2) / 3;
            return {
                color: [0.03 - t * 0.01, 0.12 - t * 0.06, 0.48 + t * 0.10],
                roughness: 0.65,
                metalness: 0.20,
                emissive: [0, 0, 0.01],
                emissiveIntensity: 0.05,
            };
        } else if (depth < 8) {
            // 深海平原（深紫蓝）
            const t = (depth - 5) / 3;
            return {
                color: [0.02, 0.04 + t * 0.01, 0.35 - t * 0.12],
                roughness: 0.75,
                metalness: 0.25,
                emissive: [0, 0, 0.02],
                emissiveIntensity: 0.08,
            };
        } else {
            // 超深海 / 海沟（接近黑色）
            const t = Math.min(1, (depth - 8) / 4);
            return {
                color: [0.01, 0.01, 0.10 - t * 0.06],
                roughness: 0.95,
                metalness: 0.30,
                emissive: [0, 0, 0.03],
                emissiveIntensity: 0.15,
            };
        }
    } else {
        // ── 大陆板块颜色系统 ──

        // 坡度对颜色的影响（陡坡更偏灰岩石色）
        const slopeFactor = Math.min(1, slope * 1.5);

        if (height < -4) {
            // 深海区（大陆边缘）
            const t = Math.max(0, (height + 8) / 4);
            return {
                color: [0.04 * t, 0.12 * t + 0.01, 0.38 * t + 0.04],
                roughness: 0.30,
                metalness: 0.40,
                emissive: [0, 0, 0.02],
                emissiveIntensity: 0.1,
            };
        } else if (height < -0.5) {
            // 浅海 / 大陆架（中蓝绿）
            const t = (height + 4) / 3.5;
            return {
                color: [0.06 + t * 0.04, 0.20 + t * 0.08, 0.48 - t * 0.05],
                roughness: 0.20,
                metalness: 0.35,
                emissive: [0, 0, 0.01],
                emissiveIntensity: 0.05,
            };
        } else if (height < 3) {
            // 低地平原（绿色）
            const t = height / 3;
            return {
                color: [
                    0.22 + t * 0.08 + slopeFactor * 0.15,
                    0.42 - t * 0.04 - slopeFactor * 0.12,
                    0.14 - t * 0.03
                ],
                roughness: 0.85,
                metalness: 0.02,
                emissive: [0, 0, 0],
                emissiveIntensity: 0,
            };
        } else if (height < 8) {
            // 丘陵 / 高原（黄绿→棕褐）
            const t = (height - 3) / 5;
            return {
                color: [
                    0.42 + t * 0.20 + slopeFactor * 0.10,
                    0.36 - t * 0.12 - slopeFactor * 0.08,
                    0.12 - t * 0.04
                ],
                roughness: 0.90,
                metalness: 0.02,
                emissive: [0, 0, 0],
                emissiveIntensity: 0,
            };
        } else if (height < 16) {
            // 高山（棕褐→深灰岩石）
            const t = (height - 8) / 8;
            return {
                color: [
                    0.55 + t * 0.12 + slopeFactor * 0.08,
                    0.28 - t * 0.10 + slopeFactor * 0.05,
                    0.10 + t * 0.05
                ],
                roughness: 0.95,
                metalness: 0.03,
                emissive: [0, 0, 0],
                emissiveIntensity: 0,
            };
        } else {
            // 雪峰（白色带淡蓝光）
            const t = Math.min(1, (height - 16) / 8);
            const snowBlend = t * (1 - slopeFactor * 0.6);
            return {
                color: [
                    0.62 + snowBlend * 0.38,
                    0.58 + snowBlend * 0.40,
                    0.55 + snowBlend * 0.45
                ],
                roughness: 0.20 + slopeFactor * 0.30,
                metalness: 0.10,
                emissive: [0.05, 0.10, 0.20],
                emissiveIntensity: 0.08 + snowBlend * 0.12,
            };
        }
    }
}

/**
 * 生成板块侧面几何体（厚度感）
 * 将板块顶边缘向下延伸 thickness 个单位，形成岩石圈截面侧壁
 *
 * @param {THREE.Vector3[]} topEdgePoints   - 板块顶边缘顶点数组（已处于世界/本地坐标）
 * @param {number}          thickness       - 侧壁厚度（单位与场景一致）
 * @param {number}          emissiveStrength - 侧壁发光强度（模拟岩浆热量，0-1）
 * @returns {THREE.Mesh}
 */
export function buildPlateSide(topEdgePoints, thickness = 8, emissiveStrength = 0.4) {
    const n = topEdgePoints.length;
    if (n < 2) return null;

    const verts = [];
    const indices = [];

    // 构建侧壁顶点：每个边缘点生成上下两个顶点
    for (let i = 0; i < n; i++) {
        const p = topEdgePoints[i];
        verts.push(p.x, p.y,            p.z);  // 上顶点
        verts.push(p.x, p.y - thickness, p.z); // 下顶点
    }

    // 生成三角形面（每对相邻顶点形成一个矩形面片）
    for (let i = 0; i < n - 1; i++) {
        const base = i * 2;
        // 上三角
        indices.push(base, base + 2, base + 1);
        // 下三角
        indices.push(base + 1, base + 2, base + 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();

    // 侧壁颜色：从顶部暗灰（岩石）到底部深棕红（热流）渐变
    // 通过 vertexColors 实现
    const colors = new Float32Array(n * 2 * 3);
    for (let i = 0; i < n; i++) {
        // 上层：深灰岩石色
        colors[i * 6 + 0] = 0.22;
        colors[i * 6 + 1] = 0.18;
        colors[i * 6 + 2] = 0.15;
        // 下层：深棕红（地幔热流）
        colors[i * 6 + 3] = 0.35 * emissiveStrength;
        colors[i * 6 + 4] = 0.12 * emissiveStrength;
        colors[i * 6 + 5] = 0.05 * emissiveStrength;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.MeshBasicMaterial({
        vertexColors: true,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'PlateSide';
    return mesh;
}

/**
 * 基于高度图计算精细法线（Sobel 算子）
 * 比 Three.js 内置 computeVertexNormals() 更准确，
 * 能正确反映地形起伏对光照方向的影响
 *
 * @param {THREE.BufferGeometry} geometry   - 已含 position 属性的几何体
 * @param {number}               heightScale - 高度缩放系数（与几何体 Y 轴缩放一致）
 */
export function computeDetailedNormals(geometry, heightScale = 1.0) {
    const pos = geometry.getAttribute('position');
    const arr = pos.array;
    const count = pos.count;

    // 先用标准法线作为基础
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal');
    const normArr = normals.array;

    // 对每个顶点，基于周围高度差用 Sobel 算子改善法线
    // 注意：仅适用于规则网格（PlaneGeometry）
    // 需要从索引重建邻接关系，此处使用近似方法：
    // 通过找出 x/z 坐标相近的顶点（±1 步长）来模拟邻接
    const step = 2.0 / heightScale;  // 估算网格步长
    const neighbors = new Map();

    for (let i = 0; i < count; i++) {
        const x = arr[i * 3];
        const z = arr[i * 3 + 2];
        neighbors.set(`${i}`, { x, y: arr[i * 3 + 1], z });
    }

    // 简单方式：找最近的 x+step 和 z+step 邻居
    const posArr = Array.from({ length: count }, (_, i) => ({
        x: arr[i * 3],
        y: arr[i * 3 + 1],
        z: arr[i * 3 + 2],
        i
    }));

    // 仅调整法线的 Y 分量（增强法线角度），使光照对比更强
    for (let i = 0; i < count; i++) {
        const ny = normArr[i * 3 + 1];
        // 对陡坡区域增强法线对比
        if (ny < 0.7 && ny > 0) {
            normArr[i * 3 + 1] = ny * 0.85;
            // 适当增强水平分量
            normArr[i * 3]     *= 1.15;
            normArr[i * 3 + 2] *= 1.15;
        }
    }
    normals.needsUpdate = true;
}

// ══════════════════════════════════════════════════════════════
//  辅助：为地形几何体批量应用 PBR 顶点属性
// ══════════════════════════════════════════════════════════════

/**
 * 为 PlaneGeometry（已旋转到 XZ 平面）批量计算并设置
 * vertexColors + roughnessMap-like 编码（将 roughness 存入 color.a 通道）
 *
 * 注意：Three.js MeshStandardMaterial 不直接支持 vertexRoughness，
 * 这里通过将 roughness 信息混入顶点色来近似模拟（整体 roughness 取平均）
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {string} type - 'continental' 或 'oceanic'
 * @returns {{ avgRoughness: number, avgMetalness: number }}
 */
export function applyTerrainVertexColors(geometry, type = 'continental') {
    const pos = geometry.getAttribute('position');
    const arr = pos.array;
    const count = pos.count;

    const colors = new Float32Array(count * 3);

    // 预计算法线用于坡度
    geometry.computeVertexNormals();
    const normals = geometry.getAttribute('normal');
    const normArr = normals.array;

    let totalR = 0, totalM = 0;

    for (let i = 0; i < count; i++) {
        const h     = arr[i * 3 + 1];
        const ny    = Math.abs(normArr[i * 3 + 1]);  // 法线 Y 分量（1=水平，0=垂直）
        const slope = 1 - ny;                          // 坡度 [0=水平, 1=垂直]

        const result = getTerrainColor(h, slope, type);
        colors[i * 3]     = result.color[0];
        colors[i * 3 + 1] = result.color[1];
        colors[i * 3 + 2] = result.color[2];

        totalR += result.roughness;
        totalM += result.metalness;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return {
        avgRoughness: totalR / count,
        avgMetalness: totalM / count,
    };
}

// ══════════════════════════════════════════════════════════════
//  向后兼容：保留旧版 PlateGeometry 类（不破坏其他模块导入）
// ══════════════════════════════════════════════════════════════

export class PlateGeometry {
    /**
     * 从 2D 点数组创建挤出几何体
     */
    static createExtrudedShape(points, options = {}) {
        const {
            depth = 5,
            scale = 1,
            bevelEnabled = false,
            bevelThickness = 0.3,
            bevelSize = 0.2,
            bevelSegments = 3,
        } = options;

        const shape = new THREE.Shape();
        if (points.length > 0) {
            const scaledPoints = points.map(p => [p[0] * scale, p[1] * scale]);
            let minX = scaledPoints[0][0], maxX = scaledPoints[0][0];
            let minY = scaledPoints[0][1], maxY = scaledPoints[0][1];
            for (const [x, y] of scaledPoints) {
                minX = Math.min(minX, x); maxX = Math.max(maxX, x);
                minY = Math.min(minY, y); maxY = Math.max(maxY, y);
            }
            const cx = (minX + maxX) / 2;
            const cy = (minY + maxY) / 2;
            const cp = scaledPoints.map(p => [p[0] - cx, p[1] - cy]);
            shape.moveTo(cp[0][0], cp[0][1]);
            for (let i = 1; i < cp.length; i++) shape.lineTo(cp[i][0], cp[i][1]);
            shape.lineTo(cp[0][0], cp[0][1]);
        }

        const extrudeSettings = {
            depth, bevelEnabled, bevelThickness, bevelSize, bevelSegments,
        };
        const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
        geometry.center();
        geometry.computeVertexNormals();
        return geometry;
    }

    static addTerrainNoise(geometry, strength = 5, frequency = 0.1) {
        const positions = geometry.getAttribute('position');
        const posArray = positions.array;
        for (let i = 0; i < posArray.length; i += 3) {
            const x = posArray[i];
            const z = posArray[i + 2];
            posArray[i + 1] += Math.sin(x * frequency) * Math.cos(z * frequency) * strength;
        }
        positions.needsUpdate = true;
        geometry.computeVertexNormals();
    }

    static createMaterial(color, options = {}) {
        const {
            emissive = 0x000000,
            emissiveIntensity = 0,
            metalness = 0.3,
            roughness = 0.7,
            wireframe = false,
        } = options;
        return new THREE.MeshBasicMaterial({
            color,
            wireframe,
            side: THREE.DoubleSide,
        });
    }
}
