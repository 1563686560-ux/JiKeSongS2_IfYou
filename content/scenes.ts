import type { SceneConfig } from '../src/types/content';
import { ASSET_IDS } from './assets';

/**
 * 场景 = 一张底图 + 若干叠加层 + 小人体态。
 *
 * 这里分两组：
 *   1. **基底场景**（classroom / bedroom / playground）—— 每个地点一张底图，其它天共用。
 *   2. **时相变体**（…Morning / …Night / …LightsOut / playgroundRunning）—— 同一天里
 *      06:20 的卧室和 23:20 的卧室不该是同一张画面，早读的教室和晚自习的教室也不该。
 *
 * 时相做成**场景变体**而不是"给时刻加一个时相字段"，是因为引擎已经有 `moment.sceneId`
 * 这条路（`locationId` 管地点与地图，`sceneId` 管画面），不用新增引擎概念；
 * 而且时相本来就是"这次进的是哪个房间的哪个时刻"，落在场景上比落在时刻上更贴切。
 *
 * 教室的清晨/夜晚**只有一层光**（overlay），不是两张底图 —— 底图只有一张，
 * 这样教室的陈设不会因为换了时段就对不上，美工要维护的底图也只有一张。
 *
 * 目前只有 D1 接了时相（美工 A《环境与移动》首批交付正好覆盖 D1 的九个时刻）；
 * 其它日期的时刻继续走基底场景，要接时相只需在 moments.ts 里给那一刻标上 sceneId。
 */
export const scenes: Record<string, SceneConfig> = {
  // ── 基底场景 ──────────────────────────────────────────────────
  classroom: { id: 'classroom', name: '教室', theme: 'day', background: ASSET_IDS.classroomBackground, character: { pose: 'sit' } },
  bedroom: { id: 'bedroom', name: '卧室', theme: 'night', background: ASSET_IDS.bedroomBackground, character: { pose: 'sleep' } },
  // 操场基底带雨幕：脚本里唯一"在操场上明确下雨"的是 D6 15:00「考后冒雨」。
  // D1 15:30 跑操、D3 15:40 风、D5 16:30 操场都不下雨，各有自己的场景（见下）。
  playground: { id: 'playground', name: '操场', theme: 'rain', background: ASSET_IDS.playgroundBackground, overlays: [ASSET_IDS.rainOverlay], character: { pose: 'stand' } },
  endingSunny: { id: 'endingSunny', name: '放晴', theme: 'dusk', background: ASSET_IDS.endingCard, character: { pose: 'stand' } },
  endingRain: { id: 'endingRain', name: '雨过', theme: 'rain', background: ASSET_IDS.endingCard, character: { pose: 'stand' } },

  // ── D1 时相变体 ───────────────────────────────────────────────
  // 卧室：清晨（06:20 黎明）/ 夜灯（睡前）/ 熄灯（睡眠不足）。
  // theme 只决定底图缺失时的兜底渐变与环境音，有正式底图时它看不见 —— 所以按语义给。
  bedroomMorning: { id: 'bedroomMorning', name: '卧室', theme: 'day', background: ASSET_IDS.bedroomMorning, character: { pose: 'sleep' } },
  bedroomNight: { id: 'bedroomNight', name: '卧室', theme: 'night', background: ASSET_IDS.bedroomNight, character: { pose: 'sleep' } },
  bedroomLightsOut: { id: 'bedroomLightsOut', name: '卧室', theme: 'night', background: ASSET_IDS.bedroomLightsOut, character: { pose: 'sleep' } },
  // 教室：同一张底图 + 一层光。早读/上课/午休走清晨光，晚自习走夜间光。
  classroomMorning: { id: 'classroomMorning', name: '教室', theme: 'day', background: ASSET_IDS.classroomBackground, overlays: [ASSET_IDS.classroomMorningOverlay], character: { pose: 'sit' } },
  classroomNight: { id: 'classroomNight', name: '教室', theme: 'night', background: ASSET_IDS.classroomBackground, overlays: [ASSET_IDS.classroomNightOverlay], character: { pose: 'sit' } },
  // 操场·跑操：不带雨幕，theme 也不是 rain（theme=rain 会拉起雨声，跑操时下雨是错的）
  playgroundRunning: { id: 'playgroundRunning', name: '操场', theme: 'day', background: ASSET_IDS.playgroundBackground, character: { pose: 'stand' } },

  // ── D2–D3 起接上的时相 / 环境画面 ─────────────────────────────
  // 这几张是美工按"每天的新画面"交来的**环境空镜**（不是人物图），所以接成场景底图：
  // 空镜要的是铺满整个舞台，塞进一张 CG 卡里会变成"照片里的照片"。
  playgroundWindy: { id: 'playgroundWindy', name: '操场', theme: 'day', background: ASSET_IDS.playgroundWindy, character: { pose: 'stand' } },

  // ── D4–D7 的环境空镜 ──────────────────────────────────────────
  // 同样是按天交来的整屏空镜，一天里"换一个时段"就换一张底图（这几张本身的构图就不同，
  // 不是同一张底图加一层光，所以不能再走教室的 overlay 方案）。
  classroomFoggy: { id: 'classroomFoggy', name: '教室', theme: 'day', background: ASSET_IDS.classroomFoggy, character: { pose: 'stare' } },
  classroomDusk: { id: 'classroomDusk', name: '教室', theme: 'dusk', background: ASSET_IDS.classroomDusk, character: { pose: 'lookUp' } },
  classroomEarlyLight: { id: 'classroomEarlyLight', name: '教室', theme: 'day', background: ASSET_IDS.classroomEarlyLight, character: { pose: 'sit' } },
  playgroundGentle: { id: 'playgroundGentle', name: '操场', theme: 'day', background: ASSET_IDS.playgroundGentle, character: { pose: 'stand' } },
  classroomMakeup: { id: 'classroomMakeup', name: '教室', theme: 'day', background: ASSET_IDS.classroomMakeup, character: { pose: 'sit' } },
  // 考后冒雨：雨是**画在底图里**的，所以这里不再叠 overlay.rain（叠上去就是两层雨）。
  // theme 仍是 rain —— 它拉起的是雨声环境音，而这一刻确实在下雨。
  playgroundRainRun: { id: 'playgroundRainRun', name: '操场', theme: 'rain', background: ASSET_IDS.playgroundRainRun, character: { pose: 'stand' } },
  // 干预成功后的第二种天气：由 MomentArt.successScene 切换（不是换插画，是换整屏背景）。
  playgroundClearing: { id: 'playgroundClearing', name: '操场', theme: 'day', background: ASSET_IDS.playgroundClearing, character: { pose: 'stand' } },
  playgroundBlueSky: { id: 'playgroundBlueSky', name: '操场', theme: 'day', background: ASSET_IDS.playgroundBlueSky, character: { pose: 'stand' } },
  classroomPenSound: { id: 'classroomPenSound', name: '教室', theme: 'day', background: ASSET_IDS.classroomPenSound, character: { pose: 'sit' } },
  // 终章：抬头看窗外，figure 与按性别的 art.story.<who>.finalLookUp 组合
  classroomFinale: { id: 'classroomFinale', name: '教室', theme: 'dusk', background: ASSET_IDS.classroomFinale, character: { pose: 'lookUp' } },

  // 记忆回响：终章推近之后、结局台词之前的那段黑屏（engine.runEnding 里切换）。
  // 它不是"某个地点的某个时相"，所以刻意不叫 classroom*/bedroom* ——
  // 地点一致性检查（tests/unit/sceneArt.test.ts）也就不会把它算进"地点场景"。
  memoryEcho: { id: 'memoryEcho', name: '记忆回响', theme: 'night', background: ASSET_IDS.memoryEcho },
};
