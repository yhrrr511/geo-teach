// geo-teach 打包入口

// ── CSS 样式（esbuild 会输出到 dist/main.bundle.css）────────
import './src/styles/base.css';
import './src/styles/layout.css';
import './src/styles/components.css';
import './src/styles/loading.css';
import './src/styles/welcome.css';
import './src/styles/pdf-viewer.css';

// ── 应用初始化（视图切换 + 加载动画 + PDF 功能）────────────
import { initApp } from './src/app-init.js';
initApp();

// ── Three.js 3D 模型主逻辑 ───────────────────────────────────
import './src/main.js';
