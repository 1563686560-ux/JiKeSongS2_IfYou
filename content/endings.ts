import type { EndingConfig } from '../src/types/content';
import { ASSET_IDS } from './assets';
import { growCondition, hiddenEndingCondition, sunnyCondition } from './conditions';

// 终章镜头：脚本 D7「镜头缓缓推近，小人抬头望向屏幕外」→ onEnter 里跑 zoomIn
const ZOOM_IN = [{ kind: 'anim' as const, target: 'scene', name: 'zoomIn' }];

/**
 * 结局场景。
 *
 * 这里必须**写全 background**，不能只写一个 id 就指望引擎自己去查：
 * `runEnding` 把 `ending.scene` 整个交给 `scene.show()`，而它是一份**自带的** SceneConfig，
 * 不是 `config.scenes` 里的那一份。早先只写了 id，于是结局画面一直没有底图
 * （只剩 theme 的兜底渐变），D7 交来的「结局页_七朵云背景」也就永远画不出来。
 * 这个坑是接 D7 素材时才发现的 —— tests/unit/sceneArt.test.ts 现在盯着它。
 */
const endingScene = (
  id: 'endingSunny' | 'endingRain',
  name: string,
  theme: 'day' | 'dusk' | 'rain',
  pose: string,
) => ({ id, name, theme, background: ASSET_IDS.endingCard, character: { pose }, onEnter: ZOOM_IN });

// B（玩法策划）：4 个结局，条件与文案取自《剧情脚本 V1.3》第三章。
// 判定优先级见 flow.ts 的 ending-pick 节点：隐藏 → 晴空 → 生长 → 雨过。
export const endings: EndingConfig[] = [
  {
    id: 'clumsy',
    name: '笨拙的守护',
    condition: hiddenEndingCondition,
    scene: endingScene('endingSunny', '笨拙的守护', 'dusk', 'lookUp'),
    lines: [
      { id: 'h1', text: '你总是用同一种方式，笨笨地护着我。', tone: 'gold', collectible: true },
      { id: 'h2', text: '……但，谢谢。', tone: 'gold', collectible: true },
    ],
  },
  {
    id: 'sunny',
    name: '晴空',
    condition: sunnyCondition,
    scene: endingScene('endingSunny', '晴空', 'dusk', 'lookUp'),
    lines: [
      { id: 'e1', text: '故事里的夏天，有人替你挡住了一些雨。', tone: 'gold', collectible: true },
      { id: 'e2', text: '现实里的夏天，要是有你，该多好啊。', tone: 'gold', collectible: true },
    ],
  },
  {
    id: 'grow',
    name: '生长',
    condition: growCondition,
    scene: endingScene('endingSunny', '生长', 'day', 'lookUp'),
    lines: [
      { id: 'e4', text: '辛苦的日子没有奇迹。', tone: 'white', collectible: true },
      { id: 'e5', text: '但你还是，好好长大了。', tone: 'white', collectible: true },
    ],
  },
  {
    id: 'rain',
    name: '雨过',
    condition: { kind: 'always' },
    scene: endingScene('endingRain', '雨过', 'rain', 'stand'),
    lines: [
      { text: '有些雨，没能挡住。', tone: 'dark' },
      { id: 'e3', text: '但雨，总会停的。', tone: 'white', collectible: true },
    ],
  },
];
