#!/bin/bash
# geo-teach 一键打包脚本
# 运行方式: bash scripts/build.sh

set -e
cd "$(dirname "$0")/.."

echo "📦 Step 1: esbuild 打包 JS + CSS..."
npx esbuild build-entry.js \
  --bundle \
  --format=iife \
  --global-name=GeoTeachApp \
  --outfile=dist/main.bundle.js \
  --asset-names=dist/[name]-[hash] \
  --alias:three=./vendor/three/build/three.module.js \
  --alias:three/examples/jsm/controls/OrbitControls.js=./vendor/three/examples/jsm/controls/OrbitControls.js \
  --alias:three/examples/jsm/renderers/CSS2DRenderer.js=./vendor/three/examples/jsm/renderers/CSS2DRenderer.js \
  --alias:three/examples/jsm/postprocessing/EffectComposer.js=./vendor/three/examples/jsm/postprocessing/EffectComposer.js \
  --alias:three/examples/jsm/postprocessing/RenderPass.js=./vendor/three/examples/jsm/postprocessing/RenderPass.js \
  --alias:three/examples/jsm/postprocessing/UnrealBloomPass.js=./vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js \
  --alias:three/examples/jsm/objects/Water.js=./vendor/three/examples/jsm/objects/Water.js \
  --alias:three/examples/jsm/shaders/CopyShader.js=./vendor/three/examples/jsm/shaders/CopyShader.js \
  --alias:three/examples/jsm/shaders/LuminosityHighPassShader.js=./vendor/three/examples/jsm/shaders/LuminosityHighPassShader.js

echo ""
echo "🖼️  Step 2: 内联纹理（Base64）..."
node scripts/inline-textures.mjs

echo ""
echo "✅ 构建完成！"
echo "   📄 dist/main.bundle.js  — JavaScript 主包"
echo "   🎨 dist/main.bundle.css — 样式表"
echo "👆 现在可以直接双击 index.html 打开（无需服务器）"
