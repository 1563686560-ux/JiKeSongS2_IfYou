// D2–D3 剧情图逐帧验收（真浏览器）。用法：npm run preview 之后
//   node tests/browser/day23-shots.mjs
// 产出：tests/browser/shots/day23/<序号>-<时刻>-<画面名>.png + 一个 index.html 画廊。
//
// 实现在 tests/browser/day-shots.mjs（同一份代码也跑 D1 / D4–D7 等区间）。
// 这个文件只是固定"D2 到 D3"这个区间的那一行参数 —— 老命令与文档里的路径继续可用。
import { runDayShots } from './day-shots.mjs';

await runDayShots({
  from: 2,
  to: 3,
  dir: 'tests/browser/shots/day23',
  title: 'D2–D3 剧情图验收',
});
