import type { AssetManifest, Signal } from '../src/types/content';
import spec from './art.spec.json';
import { STORY_SHOTS, storyAssetIds, type StoryName } from './storyArt';

/**
 * 稳定美术资源合同：逻辑只引用 AssetId。
 *
 * 取图优先级：
 *   1) art/<AssetId>.<ext>  —— 美工交付的正式图（构建时被 Vite 内联成 data URL，
 *      所以单文件产物依旧零外部请求）。放哪些用哪些，没放的自动回退到占位图。
 *   2) 内置占位 SVG —— **只给环境层**（地点背景 / 叠加层 / 结局背景）：一张写着中文名的色块，
 *      一眼就知道缺哪张、文件名该叫什么。
 *
 * 人物类的图（立绘、剧情插画、D1 插画、开局形象）**没有占位图**：缺图时 src 是空串，
 * 画面上**什么都不出现**。理由有两条：
 *   · 占位物是"给开发看的诊断物"，而人物占位物会直接立在画面正中当主角 ——
 *     玩家看到的是一个色块写着一行字，比"这一刻没有人物图"糟得多；
 *   · 缺图期间的兜底本来就该是"由立绘行 / 场景顶上"，而不是糊一张东西上去。
 * 缺哪张图由构建期对账（npm run art:check / tests/unit/storyArt.test.ts）保证，不靠画面提示。
 *
 * 尺寸基准只写在 content/art.spec.json 里（唯一真相来源），
 * `node scripts/art.mjs check` 会按它校验美工交的图，尺寸不对直接让构建失败。
 * 不要改 AssetId、不要改这里的渲染用途。
 */

// 一次性把 art/ 下所有图片收进来（Vite 会按 assetsInlineLimit 内联为 data URL；
// Vitest 里拿到的是文件路径 —— 两者都要能用，所以下面只依赖扩展名，不依赖 url 的形态）
const delivered = import.meta.glob('../art/*.{png,webp,jpg,jpeg,svg}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const byId: Record<string, { url: string; ext: string }> = {};
for (const [path, url] of Object.entries(delivered)) {
  const file = path.split('/').pop() ?? '';
  const dot = file.lastIndexOf('.');
  byId[file.slice(0, dot)] = { url, ext: file.slice(dot + 1).toLowerCase() };
}

// 人物占位图的画布 = 整屏舞台基准（art.spec.json 的 _stage）。
// 注意：**人物类资源（character:true）根本不会用到它** —— 那类资源缺图时 src 是空串、
// 画面上什么都不出现（见文件头）。这个函数现在只服务环境层。
const placeholder = (label: string, bg: string, fg = '#403c44'): string =>
  `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="${bg}"/><text x="640" y="360" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="42" fill="${fg}">${label}</text></svg>`)}`;

const NO_ART = '';

export const ASSET_IDS = {
  bedroomBackground: 'map.bedroom.background',
  // 卧室的时相变体：同一天里 06:20 的卧室和 23:20 的卧室不是同一张画面。
  // 这三个只用于**场景**，不用于地图调试入口（入口一律用 map.bedroom.background 底图）。
  bedroomMorning: 'map.bedroom.morning',
  bedroomNight: 'map.bedroom.night',
  bedroomLightsOut: 'map.bedroom.lightsOut',
  classroomBackground: 'map.classroom.background',
  playgroundBackground: 'map.playground.background',
  /** 操场·风把云吹得很快（D3 15:40 的环境空镜，美工按天交来的新画面） */
  playgroundWindy: 'map.playground.windy',
  // ── D4–D7 按天交来的环境空镜（同样是整屏场景底图，基准 1280×720）──────
  classroomFoggy: 'map.classroom.foggy',           // D4 14:00 下午隔着雾
  classroomDusk: 'map.classroom.dusk',             // D4 17:00 黄昏粉笔灰
  classroomEarlyLight: 'map.classroom.earlyLight', // D5 07:40 天亮得早一点
  playgroundGentle: 'map.playground.gentle',       // D5 16:30 温柔的风
  classroomMakeup: 'map.classroom.makeup',         // D6 07:30 补课清晨
  playgroundRainRun: 'map.playground.rainRun',     // D6 15:00 考后冒雨
  playgroundClearing: 'map.playground.clearing',   // D6 15:00 干预成功·提前放晴
  playgroundBlueSky: 'map.playground.blueSky',     // D7 07:50 今天的天好蓝
  classroomPenSound: 'map.classroom.penSound',     // D7 10:30 笔尖沙沙
  classroomFinale: 'map.classroom.finale',         // D7 15:00 终章抬头背景
  memoryEcho: 'ending.memoryEcho',                 // 终章推近后的记忆回响黑屏
  playerPortrait: 'portrait.player',
  playerPortraitBoy: 'portrait.player.boy',
  playerPortraitGirl: 'portrait.player.girl',
  playerPortraitBoyRest: 'portrait.player.boy.rest',
  playerPortraitGirlRest: 'portrait.player.girl.rest',
  npcPortrait: 'portrait.npc',
  teacherPortrait: 'portrait.teacher',
  teacherPortraitStrict: 'portrait.teacher.strict',
  customizeBoy: 'art.customize.boy',
  customizeGirl: 'art.customize.girl',
  rainOverlay: 'overlay.rain',
  // 教室的时相叠加层：清晨/夜晚不是两张教室底图，而是同一张底图 + 一层光。
  // 这样美工要维护的底图只有一张，光线变化也不会让教室的陈设对不上。
  classroomMorningOverlay: 'overlay.classroom.morning',
  classroomNightOverlay: 'overlay.classroom.night',
  endingCard: 'ending.card',
  /** 校园俯瞰地图：人物自动移动转场（map_routes 交接包）的底图 */
  campusMap: 'map.campus.base',
  /** 金云：结局页七天心情历史 + 守护住的那一刻 */
  signalCloudGold: 'signal.cloud.gold',
  /** 指路箭头 / 出口高亮：转场里标出目的地点位 */
  signalArrow: 'signal.arrow',
  signalExitHighlight: 'signal.exitHighlight',
  /** 干预成功的两个特效素材（L2 短动画） */
  vfxGoldenZipper: 'vfx.goldenZipper',
  vfxProtectiveHand: 'vfx.protectiveHand',
  /**
   * 标题页 / 结局页的**全屏天空底图**（标题页交接包 title-screen-handoff）。
   *
   * 两个心情变体：`dim`（雨云压着的天，开场）/ `gentle`（晒得暖的天，收尾）。
   * 它们不是"舞台里的背景"，而是**铺满视口**的整页底图 —— 标题页与结局页都是全屏页
   * （`position:fixed;inset:0`，见 base.css），所以由页面的 CSS 变量 `--page-bg` 挂着，
   * 而不是走 `.scene-background` 那条舞台内的路。
   */
  titleBgDim: 'title.bg.dim',
  titleBgGentle: 'title.bg.gentle',
} as const;

/**
 * 情绪信号 → 交付图。
 *
 * 从前这里画的是 **6 个 emoji 字符**（🌧 ◌ ✗ 💤 📱 🌫，直接塞进 `.signal-icon` 的 textContent），
 * 是全作最后一批"占位图案"。美工其实早把整套水彩信号图交在 `03_signals/` 里，
 * 只是从来没接进来 —— 于是画面上一直是一颗 emoji 顶着一行 `font-size`。
 * 现在换成 `signal.*.webp`（scripts/import-stage-art.py 导入），由 CloudSystem 渲染成 `<img>`。
 *
 * 谁用这张表：`content/moments.ts` 在造时刻时把它写进 `Signal.asset`。
 * 引擎侧（CloudSystem）**不认识 kind 与图的对应关系** —— 它只认 `signal.asset` 这个 AssetId，
 * 于是"乌云长什么样"是内容层的决定，引擎只负责把图贴上去。
 */
export const SIGNAL_ART: Record<Signal['kind'], string> = {
  darkCloud: 'signal.cloud.dark',
  grayCircle: 'signal.cloud.gray',
  redCross: 'signal.redCross',
  sleepZzz: 'signal.zzz',
  phoneWave: 'signal.phone',
  custom: 'signal.cloud.white',
};

/**
 * 行走帧：`move.<who>.<dir>.<frame 1|2>`。
 * 形状与 map_routes 交接包的 `SPRITES` 一致（按性别 → 方向 → 两帧），
 * 所以接入时只是把交接包里的**文件路径**换成 **AssetId**，动画逻辑不用改。
 * 注意男女原生尺寸不同（男生 128×128、女生 96×128），CSS 按高度对齐、宽度自适应，不要拉成同宽。
 */
const MOVE_DIRS = ['up', 'down', 'left', 'right'] as const;
export type MoveGender = 'boy' | 'girl';
export type MoveDir = (typeof MOVE_DIRS)[number];

export const MOVE_ART: Record<MoveGender, Record<MoveDir, string[]>> = {
  boy: Object.fromEntries(MOVE_DIRS.map((d) => [d, [`move.boy.${d}.1`, `move.boy.${d}.2`]])) as Record<MoveDir, string[]>,
  girl: Object.fromEntries(MOVE_DIRS.map((d) => [d, [`move.girl.${d}.1`, `move.girl.${d}.2`]])) as Record<MoveDir, string[]>,
};

type Layer = 'background' | 'portrait' | 'overlay' | 'ui';

interface ArtEntry {
  id: string;
  placeholderLabel: string;
  placeholderBg: string;
  kind: 'svg' | 'png' | 'webp';
  layer: Layer;
  anchor?: 'center' | 'bottom-center';
  /** 人物类资源：缺图时不画占位物，src 为空串（见文件头） */
  character?: boolean;
}

const ENTRIES: ArtEntry[] = [
  // 地点背景。基底 + 时相变体都是"整屏背景"层，尺寸基准一律 1280×720（art.spec.json 的 _stage）。
  { id: ASSET_IDS.bedroomBackground, placeholderLabel: '卧室｜占位背景', placeholderBg: '#24324d', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.bedroomMorning, placeholderLabel: '卧室·清晨｜占位背景', placeholderBg: '#3a4f6b', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.bedroomNight, placeholderLabel: '卧室·夜灯｜占位背景', placeholderBg: '#2a2f42', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.bedroomLightsOut, placeholderLabel: '卧室·熄灯｜占位背景', placeholderBg: '#161b2b', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.classroomBackground, placeholderLabel: '教室｜占位背景', placeholderBg: '#d9c7ad', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.playgroundBackground, placeholderLabel: '操场｜占位背景', placeholderBg: '#9eb6b5', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.playerPortrait, placeholderLabel: '主角｜占位立绘', placeholderBg: '#eadccf', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  // 按性别的两份主角立绘（交付说明 §一.2：运行时只加载对应性别的那一份）
  { id: ASSET_IDS.playerPortraitBoy, placeholderLabel: '男生主角｜占位立绘', placeholderBg: '#dbe4ec', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.playerPortraitGirl, placeholderLabel: '女生主角｜占位立绘', placeholderBg: '#ecdfe6', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.playerPortraitBoyRest, placeholderLabel: '男生主角·放松｜占位立绘', placeholderBg: '#dbe9e2', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.playerPortraitGirlRest, placeholderLabel: '女生主角·放松｜占位立绘', placeholderBg: '#e9e6d8', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.teacherPortrait, placeholderLabel: '老师｜占位立绘', placeholderBg: '#d7d7e5', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.teacherPortraitStrict, placeholderLabel: '老师·严肃｜占位立绘', placeholderBg: '#d3d3df', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.customizeBoy, placeholderLabel: '男生基础形象', placeholderBg: '#dbe4ec', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.customizeGirl, placeholderLabel: '女生基础形象', placeholderBg: '#ecdfe6', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.npcPortrait, placeholderLabel: 'NPC｜占位立绘', placeholderBg: '#d7e0e5', kind: 'svg', layer: 'portrait', anchor: 'bottom-center', character: true },
  { id: ASSET_IDS.rainOverlay, placeholderLabel: '雨幕｜占位叠加', placeholderBg: '#70869455', kind: 'svg', layer: 'overlay' },
  { id: ASSET_IDS.classroomMorningOverlay, placeholderLabel: '教室·清晨光｜占位叠加', placeholderBg: '#a4bed533', kind: 'svg', layer: 'overlay' },
  { id: ASSET_IDS.classroomNightOverlay, placeholderLabel: '教室·夜间光｜占位叠加', placeholderBg: '#20344e66', kind: 'svg', layer: 'overlay' },
  { id: ASSET_IDS.endingCard, placeholderLabel: '结局场景｜占位背景', placeholderBg: '#e7a689', kind: 'svg', layer: 'background' },
];

/**
 * D1 剧情插画槽位（交付说明《三、DAY1 推荐使用流程》的逐条落点）。
 *
 * 这批交付图的真实性质需要说清楚：`transparent/` 里那 9 张**并不是抠好的透明素材**，
 * 而是带背景的整幅插画（实测角像素 alpha=255、87–99% 像素不透明）；`*_完整课桌` 那组
 * 同样是不透明的整幅构图。所以它们**不能**当"叠在场景上的透明立绘"用 —— 但正好可以当
 * **全舞台 CG 插画**用（见 uiSystem 的 .moment-cg 层）。既然本来就不需要透明通道，
 * 这批就按 JPEG 交付：同样画面下 JPEG 比 PNG 小一个数量级（602KB → 64KB）。
 *
 * 按性别的图不直接写 AssetId，而是用语义姿态（ArtPose）间接引用，
 * 运行时按开局定制的性别解析，绝不把男女主角混进同一条剧情画面（交付说明 §一.2）。
 */
const D1_POSES = ['calm', 'tired', 'tense', 'relax', 'down', 'sit', 'sitRelax', 'strain'] as const;

const D1_ENTRIES: ArtEntry[] = (['boy', 'girl'] as const).flatMap((who) =>
  D1_POSES.map((pose): ArtEntry => ({
    id: `art.d1.${who}.${pose}`,
    placeholderLabel: `D1 ${who === 'boy' ? '男生' : '女生'}·${pose}｜占位插画`,
    placeholderBg: who === 'boy' ? '#c9d6e2' : '#e2d2da',
    kind: 'svg',
    layer: 'overlay',
    character: true,
  })),
);

ENTRIES.push(...D1_ENTRIES);

/**
 * D2 之后的剧情图：`art.story.<who>.<name>`，清单来自 content/storyArt.ts（唯一登记处）。
 *
 * 为什么要在清单里逐条登记、而不是让引擎照着名字去 `art/` 里找：
 * `AssetLoader.url()` 对没登记的 AssetId 返回空串，图会**静默不显示**；
 * 登记之后，没交的图会退成一张写着中文名的占位图 —— 一眼看出缺哪张、文件名该叫什么。
 */
const STORY_ENTRIES: ArtEntry[] = (Object.keys(STORY_SHOTS) as StoryName[]).flatMap((name) => {
  const shot = STORY_SHOTS[name];
  return storyAssetIds(name).map((id): ArtEntry => ({
    id,
    placeholderLabel: `${shot.label}｜占位剧情图`,
    // 占位图按性别染色（id 里带着 boy/girl），方便一眼看出"这一刻该出现谁"
    placeholderBg: id.includes('.boy.') ? '#ccd8e4' : id.includes('.girl.') ? '#e4d4dc' : '#d9d2c4',
    kind: 'svg',
    layer: 'overlay',
    character: true,
  }));
});

ENTRIES.push(...STORY_ENTRIES);

// D2–D7 起按天交来的环境空镜（整屏背景层，基准 1280×720）
ENTRIES.push(
  { id: ASSET_IDS.playgroundWindy, placeholderLabel: '操场·风｜占位背景', placeholderBg: '#a8bfc4', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.classroomFoggy, placeholderLabel: '教室·下午隔着雾｜占位背景', placeholderBg: '#8b8f96', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.classroomDusk, placeholderLabel: '教室·黄昏粉笔灰｜占位背景', placeholderBg: '#b5714a', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.classroomEarlyLight, placeholderLabel: '教室·天亮得早一点｜占位背景', placeholderBg: '#c9a978', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.playgroundGentle, placeholderLabel: '操场·温柔的风｜占位背景', placeholderBg: '#9dbcc0', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.classroomMakeup, placeholderLabel: '教室·补课清晨｜占位背景', placeholderBg: '#a9b3bd', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.playgroundRainRun, placeholderLabel: '操场·考后冒雨｜占位背景', placeholderBg: '#5c6675', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.playgroundClearing, placeholderLabel: '操场·雨后放晴｜占位背景', placeholderBg: '#8fa7b8', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.playgroundBlueSky, placeholderLabel: '操场·天好蓝｜占位背景', placeholderBg: '#7fb4dd', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.classroomPenSound, placeholderLabel: '教室·笔尖沙沙｜占位背景', placeholderBg: '#cbb79a', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.classroomFinale, placeholderLabel: '终章·抬头背景｜占位背景', placeholderBg: '#7c9fc4', kind: 'svg', layer: 'background' },
  { id: ASSET_IDS.memoryEcho, placeholderLabel: '记忆回响｜占位背景', placeholderBg: '#0d1018', kind: 'svg', layer: 'background' },
  // 校园俯瞰地图：整屏背景（人物自动移动转场期间铺满）
  { id: ASSET_IDS.campusMap, placeholderLabel: '校园地图｜占位背景', placeholderBg: '#c3d3c0', kind: 'svg', layer: 'background' },
  // 标题页 / 结局页的全屏天空底图（交接包 title-screen-handoff，见 ASSET_IDS 的说明）。
  // 和其它环境图一样按 layer:'background' 登记：缺图时退成一张写着中文名的占位色块 ——
  // 这两页是玩家看到的第一眼与最后一眼，缺图必须一眼看得出来，不能静默变成一块空渐变。
  { id: ASSET_IDS.titleBgDim, placeholderLabel: '标题页背景·阴沉｜占位', placeholderBg: '#596b79', kind: 'webp', layer: 'background' },
  { id: ASSET_IDS.titleBgGentle, placeholderLabel: '标题页背景·温柔｜占位', placeholderBg: '#cfdcea', kind: 'webp', layer: 'background' },
);

/**
 * 情绪信号图 + 干预特效。
 *
 * 这批是全屏覆盖层之上的"贴纸"：`layer: 'overlay'`，且**必须真透明**（art.spec.json 里标了 alpha）。
 * 环境类缺图会退成占位色块，但信号图是 480×320 的小贴纸 —— 一块写着「情绪信号·乌云」的
 * 大色块盖在舞台正中，比不画还糟。所以整组走 `character: true` 的路径：缺图时**什么都不画**
 * （CloudSystem 会因为 src 为空而跳过这一层），画面回到"这一刻没有信号"的干净状态。
 */
const SIGNAL_ENTRIES: ArtEntry[] = [
  ...Object.values(SIGNAL_ART).map((id): ArtEntry => ({ id, placeholderLabel: '情绪信号', placeholderBg: '#00000000', kind: 'webp', layer: 'overlay', character: true })),
  { id: ASSET_IDS.signalCloudGold, placeholderLabel: '情绪信号·金云', placeholderBg: '#00000000', kind: 'webp', layer: 'overlay', character: true },
  { id: ASSET_IDS.signalArrow, placeholderLabel: '指路箭头', placeholderBg: '#00000000', kind: 'webp', layer: 'overlay', character: true },
  { id: ASSET_IDS.signalExitHighlight, placeholderLabel: '出口高亮', placeholderBg: '#00000000', kind: 'webp', layer: 'overlay', character: true },
  { id: ASSET_IDS.vfxGoldenZipper, placeholderLabel: '特效·金色拉链', placeholderBg: '#00000000', kind: 'webp', layer: 'overlay', character: true },
  { id: ASSET_IDS.vfxProtectiveHand, placeholderLabel: '特效·护住的手', placeholderBg: '#00000000', kind: 'webp', layer: 'overlay', character: true },
];
ENTRIES.push(...SIGNAL_ENTRIES);

// 行走帧（16 张）：转场期间贴在地图上的小人，同样是"缺图就什么都不画"
ENTRIES.push(
  ...(Object.keys(MOVE_ART) as MoveGender[]).flatMap((who) =>
    (Object.keys(MOVE_ART[who]) as MoveDir[]).flatMap((dir) =>
      MOVE_ART[who][dir].map((id): ArtEntry => ({
        id, placeholderLabel: '行走帧', placeholderBg: '#00000000', kind: 'webp', layer: 'overlay', character: true,
      })),
    ),
  ),
);

const baselineOf = (id: string): { width?: number; height?: number; transparent?: boolean } => {
  const a = (spec.assets as Record<string, { width: number; height: number; alpha?: boolean }>)[id];
  return a ? { width: a.width, height: a.height, transparent: a.alpha === true } : {};
};

/**
 * 从**交付文件的扩展名**反推真实格式。
 *
 * 不要从 src 的 data URL 前缀去猜：Vite 构建时会按 assetsInlineLimit 内联成 data URL，
 * 但在 Vitest（jsdom）里同样的 import 拿到的是 `/art/xxx.jpg` 这种路径，前缀法在那里
 * 会一律回退成 'png' —— 也就是"测试环境里格式永远是错的、构建环境里才对"这种最难查的错。
 * 扩展名在两种环境下都一样，所以它是唯一可靠的来源。
 */
const KIND_BY_EXT: Record<string, 'png' | 'webp' | 'jpeg' | 'svg'> = {
  png: 'png', webp: 'webp', jpg: 'jpeg', jpeg: 'jpeg', svg: 'svg',
};
const kindOf = (ext: string): 'png' | 'webp' | 'jpeg' | 'svg' => KIND_BY_EXT[ext] ?? 'png';

export const assets: AssetManifest = {
  images: Object.fromEntries(
    ENTRIES.map((e) => {
      const real = byId[e.id];
      const base = baselineOf(e.id);
      return [
        e.id,
        real
          ? { src: real.url, kind: kindOf(real.ext), ...base, layer: e.layer, anchor: e.anchor }
          // 人物类缺图 → src 空串（画面上什么都不出现）；环境类缺图 → 带中文名的占位色块
          : {
            src: e.character ? NO_ART : placeholder(e.placeholderLabel, e.placeholderBg),
            kind: e.kind,
            placeholder: true,
            ...base,
            layer: e.layer,
            anchor: e.anchor,
          },
      ];
    }),
  ),
  audio: {},
};
/** 哪些 AssetId 用的是正式图（真浏览器/单测可以据此断言） */
export const deliveredAssetIds: string[] = Object.keys(byId);
