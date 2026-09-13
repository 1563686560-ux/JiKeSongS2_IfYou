import type { GameConfig } from '../src/types/content';
import { ASSET_IDS, assets } from './assets';
import { campus } from './campus';
import { customization, DEFAULT_FLAGS } from './customization';
import { maps } from './map';
import { scenes } from './scenes';
import { dilemmas } from './dilemmas';
import { endings } from './endings';
import { flow } from './flow';
import { moments } from './moments';

export const config: GameConfig = {
  meta: { title: '如果有你', version: '1.0.0' },
  assets,
  maps,
  campus,
  scenes,
  dilemmas,
  moments,
  endings,
  flow,
  start: 'day-1',
  customization,
  settings: {
    initialMood: 45,   // 脚本情绪曲线锚点：D1 = 45
    initialLight: 2,   // 第 1 天守护之光 = 2（脚本每日规则）
    initialBond: 0,
    // 终章记忆回响（脚本第二章 D7）：支持 {变量}，取自开局定制答案。
    // 开局只剩"性别"一问，所以这里也只回响**玩家真的说过的那句** ——
    // 回响一堆玩家没回答过的设定，会把"这是你选的"这句台词变成假的。
    memoryEcho: [
      { text: '那时候的TA，是{gender}。', tone: 'white' },
      { text: '——这是你亲口说的。', tone: 'white' },
      { text: '所以你守护的，从来不是陌生人。', tone: 'white' },
      { id: 'echo-title', text: '如果有你。', tone: 'gold', collectible: true },
    ],
    // 被删掉的开局问题 → 固定默认值。删问题不能删数据：
    // sleepMinutes 由 wakeValue/lightsOutValue 派生，而那六个「睡眠不足」时刻都靠它门控。
    // 这里只填 flags；发型/校服那种观感设定由性别与配色默认值推出，不进 state.custom。
    customDefaults: { flags: DEFAULT_FLAGS },
    // 图鉴分组：'' = 云朵（默认），whisper = 悄悄话（脚本第五章子栏）
    galleryGroups: { '': '云朵', whisper: '悄悄话' },
    // 睡眠时长（跨夜分钟）= 闹钟 − 熄灯。脚本《睡眠规则》判定：flag sleepMinutes lt 435（=7.25h）
    derivedFlags: [{ key: 'sleepMinutes', kind: 'timeDiff', from: 'lightsOut', to: 'wake' }],
    // 地点过渡约 1 秒（测试里设为 0）
    transitionMs: 900,
    // 标题页 / 结局页的全屏天空底图（交接包 title-screen-handoff 的两张心情图，见 PageSky）。
    // 首页默认用 dim（开场那片压着雨云的天）；有存档时切 gentle（已经守护过一次了）。
    // 结局页按 EndingConfig.sky 选。两张图都缺时页面退回 CSS 的天空渐变，不会变成空白。
    pageSky: { dim: ASSET_IDS.titleBgDim, gentle: ASSET_IDS.titleBgGentle },
    // 日转场卡约 1.4 秒（测试里设为 0）
    dayCardMs: 1400,
    // 人物自动移动转场：**不设**，于是时长由路线实际长度 ÷ campus.speed 推出
    // （宿舍→教学楼约 3.6 秒，教学楼→操场更短）。玩家随时能按「加速 ×3」或回车跳过，
    // 所以偏慢是安全的；写死一个数字反而会让长短两条路走起来一样快。
    // 测试里设成 0 直接关掉（七日通关要换几十次地点）。
  },
};
