# CityScope Frontend Visual Probe — Performance Report v2

日期：2026-08-11
环境：Apple Silicon macOS，Codex in-app Chromium，1280×720
模式：`VISUAL ONLY / CONTRACT GATED`
说明：本报告只测程序化 CityKit 与界面外壳，不代表真实 WorldState/Trace 性能。

## Runtime Probe

| 指标 | 实测 | 目标 | 结论 |
|---|---:|---:|---|
| FPS | 59–60 常态；冷启动首个样本 53 | ≥30 | PASS |
| Draw calls | 90 | <200 | PASS |
| 同时可见三角形 | 约 14K | <500K | PASS |
| 浏览器 console | 0 warning / 0 error | 无阻断错误 | PASS |
| 2.5D fallback | 手动切换通过 | WebGL 失败仍可演示 | PASS |

## Production Build

`npm run build` 实测：

| 产物 | Minified | Gzip |
|---|---:|---:|
| App shell | 24.53KB | 9.18KB |
| CitySandbox lazy chunk | 13.34KB | 4.10KB |
| Three/R3F/Drei chunk | 1,097.60KB | 305.21KB |
| CSS | 17.84KB | 4.79KB |

3D 场景已由 `React.lazy` 动态加载，首屏可以先显示本地骨架；没有 GLB、纹理或外部字体资源，断网不影响视觉样片。Three chunk 的原始 minified 体积仍触发 Vite 900KB warning，但 gzip 约 305KB，低于 10–15MB 首屏资源预算。P1 后续可继续减少 Drei 入口面，但不是当前性能阻断项。

## Geometry Strategy

- 两城共用一个 WebGL renderer/Canvas。
- 背景建筑每城一个 InstancedMesh；不为背景楼绑定 hover、HTML 或 React state。
- 每城 7 个独立 visual-only Hero Assets；等待 stable domain node ID 后再绑定业务状态。
- 资源流使用少量 Tube + 粒子，不生成大量独立对象。
- 重庆台地、桥梁与高架支撑是程序化底座；成都绿地、横向道路与低密组团同属程序化底座。

## Visual-only State Sample

36 秒序列：

1. 0–8s 双城定向。
2. 8–19s 两个 Hero Asset 分段升起，塔吊运动。
3. 19–27s 塔吊冻结、灯光降级、停工环显示。
4. 27–36s 原资源网络淡出，新网络重新布线。

演出不创建 causeId、StateDelta、Outcome，也不声称 Autonomous/Replay。正式联调时，这些视觉相位只能由冻结契约中的 domain state 驱动。

## Verification

```bash
npm run check
npm run lint
```

结果：2 test files、6 tests 全部通过；TypeScript、Vite production build、ESLint 全部通过。
