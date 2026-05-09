// geo-teach 打包入口

// ── CSS 样式（esbuild 会输出到 dist/main.bundle.css）────────
import './src/styles/base.css';
import './src/styles/layout.css';
import './src/styles/components.css';
import './src/styles/loading.css';
import './src/styles/welcome.css';

// ── 应用初始化（模型选择 + 页面切换）────────────────────────
import { initApp } from './src/app-init.js';
initApp();
