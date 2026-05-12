/**
 * inline-textures.mjs
 * 把纹理文件 Base64 编码后，内联替换 bundle 里的纹理路径为 data URL
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

// 板块构造模型使用的纹理
const TEXTURES = {
    './assets/textures/ambientcg/Ice002_1K-JPG_NormalGL.jpg': 'image/jpeg',
    './assets/textures/ambientcg/Ice002_1K-JPG_Color.jpg':    'image/jpeg',
    './assets/textures/ambientcg/Ice002_1K-JPG_Roughness.jpg':'image/jpeg',
    './assets/textures/terrain/grasslight-big.jpg':           'image/jpeg',
    './assets/textures/brick_diffuse.jpg':                    'image/jpeg',
    './assets/textures/brick_bump.jpg':                       'image/jpeg',
    './assets/textures/brick_roughness.jpg':                  'image/jpeg',
    './assets/textures/water/Water_1_M_Normal.jpg':           'image/jpeg',
    './assets/textures/water/Water_1_M_Flow.jpg':             'image/jpeg',
    './assets/textures/lava/cloud.png':                       'image/png',
};

// 读 bundle
const bundlePath = join(root, 'dist/main.bundle.js');
let bundle = readFileSync(bundlePath, 'utf-8');

let replaced = 0;
for (const [relPath, mime] of Object.entries(TEXTURES)) {
    const absPath = join(root, relPath);
    let data;
    try {
        data = readFileSync(absPath);
    } catch (e) {
        console.warn(`⚠️  跳过 ${relPath}：找不到文件`);
        continue;
    }
    const b64 = data.toString('base64');
    const dataUrl = `data:${mime};base64,${b64}`;

    // 替换所有出现的字符串（单引号或双引号包裹）
    const escaped = relPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`["']${escaped}["']`, 'g');
    const before = bundle;
    bundle = bundle.replace(re, `"${dataUrl}"`);
    if (bundle !== before) {
        console.log(`✅ 内联: ${relPath} (${Math.round(data.length / 1024)}KB → ${Math.round(dataUrl.length / 1024)}KB base64)`);
        replaced++;
    } else {
        console.log(`ℹ️  未引用（跳过）: ${relPath}`);
    }
}

const outPath = join(root, 'dist/main.bundle.js');
writeFileSync(outPath, bundle, 'utf-8');
console.log(`\n✨ 完成！共内联 ${replaced} 个纹理`);
console.log(`📦 输出: dist/main.bundle.js (${Math.round(bundle.length / 1024)}KB)`);
