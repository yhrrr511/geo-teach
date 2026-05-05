/**
 * 控制面板（可视化单独组件，已集成到 UIController）
 * 此文件作为 UIController 的补充文档
 */

/**
 * 控制面板组件说明
 * 
 * 主要控制项：
 * 1. 时间滑块（地质时间）：0-100
 *    - 控制地质时代和板块运动的进度
 *    - 连接到 #timeSlider
 * 
 * 2. 强度滑块（物理强度）：0.1-3.0
 *    - 控制碰撞/扩张的剧烈程度
 *    - 连接到 #intensitySlider
 * 
 * 3. 边界类型切换按钮：
 *    - 消亡边界（俯冲）：#convergentBtn
 *    - 生长边界（扩张）：#divergentBtn
 * 
 * 4. 视角控制：
 *    - 重置视角：#resetViewBtn
 *    - 自动旋转：#toggleAutoRotate
 * 
 * 数据显示面板（左侧）：
 * - 碰撞速度、碰撞深度、隆起高度、海沟深度
 * - 温度、压力、应力
 * - 系统状态（FPS、渲染时间）
 * 
 * 状态栏（底部）：
 * - 地质时期显示
 * - 板块运动状态
 */

export class ControlPanel {
    // 此类已被集成到 UIController
    // 保留此文件用于文档和未来扩展
}
