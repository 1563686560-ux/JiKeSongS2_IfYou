export type AssetId = string;
export type Scalar = number | boolean | string;
export type CompareOp = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte';
export type RangeOp = Exclude<CompareOp, 'eq' | 'ne'>;

export interface AssetManifest {
  /**
   * `placeholder: true` = 这个 AssetId 用的还是内置占位图（美工还没交）。
   * 判定"有没有真交付"必须看这个标记，**不要去嗅 src 前缀** —— 交付格式里允许 `.svg`，
   * 真交付的 SVG 同样是 `data:image/svg...`，靠前缀判断会把真图误判成占位图，
   * 于是"放松态没交就退到正常立绘"这类回退链会静默失效。
   */
  images: Record<AssetId, {
    src: string;
    kind?: 'png' | 'webp' | 'jpeg' | 'svg';
    placeholder?: boolean;
    width?: number;
    height?: number;
    anchor?: 'center' | 'bottom-center';
    layer?: 'background' | 'portrait' | 'overlay' | 'ui';
    /**
     * 这张图是**真透明抠图**（透明通道被实际使用）。来自 art.spec.json 的 `alpha` 字段。
     * UI 据此换一套渲染：抠图不画卡片背景与描边，让人物直接站在场景上。
     * 必须显式标注 —— 交付里既有"RGBA 但其实全不透明"的 PNG（D1 那九张），
     * 也有真抠图，靠扩展名或 src 前缀都分不出来。
     */
    transparent?: boolean;
  }>;
  audio: Record<AssetId, { src?: string }>;
}

export interface MoodTier { min: number; name: string; cloud: 'dark' | 'white' | 'gold'; saturation: number }
export interface MapConfig { id: string; background?: AssetId; baseWidth: number; baseHeight: number; locations: MapLocation[] }
export interface MapLocation { id: string; label: string; hit: { x: number; y: number; w: number; h: number }; target?: string; marker?: AssetId; when?: Condition }
export interface CharacterState { pose: string; moodFace?: string; position?: { x: number; y: number } }
export interface SceneConfig { id: string; name: string; background?: AssetId; theme?: 'day' | 'dusk' | 'night' | 'rain'; character?: CharacterState; overlays?: AssetId[]; onEnter?: Effect[] }
/**
 * 一句台词。
 *
 * `tone` = 这句话的**语气色调**（灰 / 白 / 金），来自脚本给每句标的「云朵（灰/白/金）」。
 * **它现在只决定底部对白框左边那条竖线的颜色** —— 从前它决定一个云朵气泡长什么样，
 * 而云朵气泡整个被删掉了（2026-09 决定：**全部文字走底部对白框**，不再有第二套文字容器）。
 * 字段跟着改名，就是为了让"云朵"这个词在代码里彻底消失：留着 `cloud` 只决定一条竖线的颜色，
 * 下一个人会以为云朵还在。
 */
export interface DialogueLine { id?: string; text: string; speaker?: 'student' | string; tone?: 'dark' | 'white' | 'gold'; typingMs?: number; collectible?: boolean; group?: string; effect?: Effect[] }
/**
 * 情绪信号。
 *
 * **引擎只认 `asset`，不认 `kind`。** 从前这里只有 `kind`，于是 CloudSystem 里写了一张
 * `kind → emoji` 的表（🌧 ◌ ✗ 💤 📱 🌫）—— 那是全作最后一批占位图案。
 * 现在"哪个 kind 用哪张图"是**内容层的决定**（content/assets.ts 的 `SIGNAL_ART`），
 * 引擎只是把 `asset` 指向的图贴到信号层上。`asset` 缺省 = 这一刻不画信号图（干净画面），
 * 而不是退回某个字符 —— 缺图时画一个 emoji，正是这几张图被耽误了一整轮的原因。
 * `kind` 保留下来只作**语义标签**（存档可读性 / 调试），不再参与取图。
 */
export interface Signal { kind: 'darkCloud' | 'grayCircle' | 'redCross' | 'sleepZzz' | 'phoneWave' | 'custom'; asset?: AssetId; intensity?: 1 | 2 | 3 }
export interface Interaction { id: string; label: string; icon?: AssetId; cost: number; availableWhen?: Condition; outcome: Outcome; randomOutcomes?: Outcome[] }
export interface Outcome { moodDelta?: number; bondDelta?: number; lightDelta?: number; setFlags?: Record<string, Scalar>; feedback?: DialogueLine[]; effect?: Effect[]; next?: string }
export interface DilemmaConfig { id: string; name: string; location?: string; sceneId: string; signal: Signal; intro: DialogueLine[]; interactions: Interaction[]; timeoutSec?: number; onTimeout?: Outcome; next: string }
/**
 * 表现分级（开发文档 §5.1）：L0 环境独白 / L1 普通对白 / L2 干预演出 / L3 终章。
 *
 * **它现在是纯登记信息，不再决定文字画在哪里。** 从前 L1 走底部对白框、其余走云朵气泡；
 * 云朵删掉之后所有文字都走底部对白框，所以这个字段不再参与渲染 —— 留着是因为
 * 它是脚本与开发文档之间的一份对照表，测试也用它核对"终章确实是 L3"。
 */
export type PresentationLevel = 'L0' | 'L1' | 'L2' | 'L3';

/**
 * D1 剧情插画的姿态槽位。用**语义姿态**而不是直接写 AssetId，
 * 是因为同一姿态男女各有一份图：写姿态、由引擎按开局定制的性别解析成
 * `art.d1.<boy|girl>.<pose>`，就能从类型上保证不会把男女主角混进同一条剧情画面
 * （美术交付说明 §一.2 的硬要求）。
 */
export type D1Pose = 'calm' | 'tired' | 'tense' | 'relax' | 'down' | 'sit' | 'sitRelax' | 'strain';

/**
 * 插画槽位，三种写法：
 *   `pose`  —— D1 的语义姿态，按性别解析成 `art.d1.<boy|girl>.<pose>`（带姿态回退链）
 *   `story` —— D2 之后的剧情图，按性别解析成 `art.story.<boy|girl>.<name>`
 *   `id`    —— 直接指定 AssetId（老师、同学这类不分性别的图走这条）
 *
 * 按性别解析的两条都**不能**直接写 AssetId：写 AssetId 就把"男女互斥"这条硬要求
 * 交给了调用方的自觉，而它恰恰是那种错了不报错、只在某一条路线里看得出来的错。
 */
export type ArtSlot = { pose: D1Pose } | { story: string } | { id: AssetId };

/**
 * 一个时刻的剧情插画编排。这些交付图是**带背景的整幅插画**（不是抠好的透明立绘），
 * 所以按全舞台 CG 演出：1 张居中放大，2 张并排（左=主角、右=对方）。
 */
export interface MomentArt {
  /** 时刻开始时的插画 */
  cg?: ArtSlot[];
  /** 事件干预窗口期间的插画（如「被批评的紧绷动作 + 老师严肃批评」） */
  during?: ArtSlot[];
  /** 干预成功后的收尾插画 */
  success?: ArtSlot[];
  /** 超时 / 未干预的收尾插画 */
  miss?: ArtSlot[];
  /**
   * 干预成功 / 未干预后要**换掉的整屏场景**（不是插画）。
   *
   * 为什么需要它：交付的天气是两张整屏底图（D6 15:00「考后冒雨」与「雨后提前放晴」），
   * 说明书写明"根据干预结果切换"。插画槽位换不了整屏的天气 —— 换插画只是画面上多一张卡，
   * 背景照样在下雨。所以给"整屏天气"留一个和插画并列的槽位。
   * 场景 id 写错时引擎会当场报错（`未知场景`），不会安静地画错。
   */
  successScene?: string;
  missScene?: string;
}

export interface MomentConfig {
  id: string;
  onceKey: string;
  day: number;
  time: string;
  locationId: 'bedroom' | 'classroom' | 'playground';
  presentation: PresentationLevel;
  title: string;
  sceneId: string;
  lines?: DialogueLine[];
  outcome?: Outcome;
  /**
   * 旁观 NPC 的姿态（目前只有老师）。设了它，L1 底部对白框的右侧槽位就会显示老师立绘
   * （`normal` → portrait.teacher，`strict` → portrait.teacher.strict）。
   * 不设则沿用原来的暗色 NPC 占位槽 —— 脚本没给 NPC 台词，所以默认不凭空冒出一个人。
   */
  npcPose?: 'normal' | 'strict';
  /** D1 剧情插画编排（见 MomentArt） */
  art?: MomentArt;
  event?: { signal: Signal; intro?: DialogueLine[]; interactions: Interaction[]; timeoutSec?: number; onTimeout?: Outcome };
  when?: Condition;
  next: string;
}
export interface Choice { label: string; icon?: AssetId; when?: Condition; outcome?: Outcome; next: string }

// 流程节点。B 的"七日脚本"就是这些节点的顺序编排。
export type FlowNode =
  | { id: string; kind: 'map'; mapId: string; next?: string }
  | { id: string; kind: 'scene'; sceneId: string; next?: string }
  | { id: string; kind: 'dilemma'; dilemmaId: string }
  | { id: string; kind: 'dialogue'; lines: DialogueLine[]; outcome?: Outcome; next?: string }
  | { id: string; kind: 'choice'; prompt?: DialogueLine; choices: Choice[] }
  | { id: string; kind: 'set'; set: Record<string, Scalar>; next?: string }
  | { id: string; kind: 'branch'; branches: { when?: Condition; next: string }[]; fallback?: string }
  | { id: string; kind: 'random'; branches: { weight: number; next: string }[] }
  | { id: string; kind: 'day'; day: number; light: number; title?: string; next: string }
  | { id: string; kind: 'moment'; momentId: string; next: string }
  | { id: string; kind: 'ending'; endingId: string };

export type Condition =
  | { kind: 'flag'; key: string; op: CompareOp; value: Scalar }
  | { kind: 'mood' | 'bond' | 'light' | 'avgMood' | 'avgDayMood' | 'day' | 'playthroughs'; op: RangeOp; value: number }
  | { kind: 'count'; interventionId: string; op: 'gte' | 'lt'; value: number }
  | { kind: 'and'; all: Condition[] }
  | { kind: 'or'; any: Condition[] }
  | { kind: 'not'; cond: Condition }
  | { kind: 'always' };

export type Effect =
  | { kind: 'anim'; target: string; name: string; params?: Record<string, unknown> }
  | { kind: 'sound'; id: AssetId; mode?: 'once' | 'loop' }
  | { kind: 'wait'; ms: number }
  | { kind: 'sat'; value: number }
  | { kind: 'shake'; strength?: number }
  | { kind: 'set'; set: Record<string, Scalar> };

export interface EndingConfig { id: string; name: string; condition: Condition; scene: SceneConfig; lines: DialogueLine[] }

// 开局定制：支持三选一按钮 / 时间滑杆 / 配色选择
export interface CustomizationOption { label: string; value: string; setFlags?: Record<string, Scalar>; image?: AssetId }
export interface CustomizationSlider { min: number; max: number; step: number; value: number; unit?: 'time' | 'number' }
export interface CustomizationColor { label: string; primary: string; secondary: string }
export interface CustomizationQuestion {
  id: string;
  prompt: string;
  type?: 'options' | 'slider' | 'colors';
  options?: CustomizationOption[];
  slider?: CustomizationSlider;
  colors?: CustomizationColor[];
}

// 派生数值规则：开局定制完成后由引擎自动算出的 flags，供 B 写判定。
// timeDiff：key = (toValue − fromValue + 1440) % 1440，单位分钟（如 睡眠时长 = 闹钟 − 熄灯）。
export type DerivedFlagRule = { key: string; kind: 'timeDiff'; from: string; to: string };

export interface GameConfig {
  meta: { title: string; version: string };
  assets: AssetManifest;
  maps: Record<string, MapConfig>;
  scenes: Record<string, SceneConfig>;
  dilemmas: Record<string, DilemmaConfig>;
  moments?: Record<string, MomentConfig>;
  endings: EndingConfig[];
  flow: FlowNode[];
  start: string;
  customization?: CustomizationQuestion[];
  settings?: {
    initialMood?: number;
    initialLight?: number;
    initialBond?: number;
    moodTiers?: MoodTier[];
    freeInterventions?: Interaction[];
    // 终章"记忆回响"：可用 {id} 模板变量（取自 state.custom）
    memoryEcho?: DialogueLine[];
    // 派生数值：开局定制后自动算出的 flags（如 sleepMinutes），B 用 flag 条件判定即可
    derivedFlags?: DerivedFlagRule[];
    /**
     * 开局定制的**固定默认值**：注进 state.custom / state.flags，再开始问 customization 里的问题。
     *
     * 用途是"问题可以删，数据不能删"：某些 flag（如 wakeValue / lightsOutValue → sleepMinutes）
     * 是内容层门控（睡眠不足类时刻）的判定依据，删掉对应的滑杆题之后必须有人把它们填上，
     * 否则那些时刻会静默不触发 —— 这类回归不会报错，只会让这一周凭空少几个事件。
     * 玩家答过的问题会覆盖同名 key。
     */
    customDefaults?: { custom?: Record<string, string>; flags?: Record<string, Scalar> };
    // 结局页"守护星级"：按羁绊分档，B 定数值后覆盖
    starTiers?: { minBond: number; stars: number }[];
    // 图鉴分组标题：group id → 显示名（如 whisper → 悄悄话）；未分组的用 '' 键
    galleryGroups?: Record<string, string>;
    // 地点过渡时长（毫秒）。测试里设为 0，正式体验约 1 秒。
    transitionMs?: number;
    // 日转场卡时长（毫秒）。日转场会挡住输入，播完才出现"下一目标"入口，
    // 否则日卡和地点入口会叠在同一个位置（真浏览器截图里确认过）。测试里设为 0。
    dayCardMs?: number;
    /**
     * 人物自动移动转场的总时长（毫秒）。
     *
     * 三种取值，语义是刻意分开的（否则"关掉过场"和"调快过场"会互相污染）：
     *   · `undefined`（正式）—— 由路线实际长度 ÷ `CampusConfig.speed` 推出，
     *     所以宿舍→教学楼和教学楼→操场是**不同的时长**，走得远就等得久；
     *   · `> 0` —— 写死总时长（测试用：`walkMs: 120` 也能跑完一整条路线）；
     *   · `0` —— 完全不播转场，直接进场景（`fastConfig()` 用这个，
     *     否则七日通关测试要多等几十次走路动画）。
     */
    walkMs?: number;
    /** 覆盖 `CampusConfig.speed`（归一化坐标 / 秒）。只给调参和测试用 */
    walkSpeed?: number;
  };
  /**
   * 校园世界数据（人物自动移动转场用）。缺省时转场自动降级成原来的"地点名淡入淡出"，
   * 所以这个字段是可选的 —— 引擎不假设每个内容包都画了地图。
   */
  campus?: CampusConfig;
}

/** 归一化坐标上的一个点（0..1，乘 100 就是 CSS 的百分比） */
export interface Point { x: number; y: number }

export interface CampusLocation {
  id: string;
  label: string;
  x: number;
  y: number;
  /**
   * 这个点位服务于游戏里的哪个 `locationId`（`bedroom | classroom | playground`）。
   *
   * 为什么不让引擎自己翻译：游戏的三个地点在地图上是**四个**点 —— 宿舍按开局性别分成两栋。
   * "哪个宿舍是男生的"是内容/设定问题，不是引擎问题；写成数据之后，
   * `WalkSystem` 只做一次 `locations.find(...)`，不认识"宿舍"这个词，
   * 将来加第五个点位（食堂、图书馆）也不用改引擎。
   */
  serves?: string;
  /** 区分同名 `serves` 的多个点位（男女宿舍）。缺省 = 不分性别 */
  servesWho?: 'boy' | 'girl';
}

export interface CampusRoute {
  /** 交接包里的路线名（如 `girlDormToTeachingBuilding`），只用于对账与调试输出 */
  name?: string;
  from: string;
  to: string;
  points: Point[];
}

/**
 * 校园地图配置。
 *
 * 走路这件事有**两个真相来源**，别搞混：
 *   · 走哪条路、各个点位在哪 —— 内容层（`content/campus.ts`，来自 map_routes 交接包）；
 *   · 怎么把这条路线画成一格格动画 —— 引擎层（`src/systems/walkSystem.ts`）。
 * 引擎只依赖下面这个结构，不认识"宿舍"是什么，也不认识男女。
 */
export interface CampusConfig {
  background: AssetId;
  /** 底图的原始像素尺寸（交接包 MAP_SIZE）。坐标本身是 0..1，这里只为像素级换算存在 */
  width: number;
  height: number;
  locations: CampusLocation[];
  routes: CampusRoute[];
  /** 行走速度：归一化坐标 / 秒。交接包默认 0.22 */
  speed: number;
  /** 走路换帧间隔（毫秒）。交接包默认 140 */
  frameIntervalMs: number;
  /** 时长上限（毫秒）—— 再长的路线也别让玩家干等超过这个数 */
  maxMs?: number;
}
