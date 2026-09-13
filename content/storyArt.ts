import type { ArtSlot } from '../src/types/content';

/**
 * D2 之后的「剧情图」登记表 —— **加一张图要改的地方就是这里一处 + art.spec.json**。
 *
 * 为什么要有这张表（而不是像 D1 那样把名字散在各天里）：
 *
 * 1. **男女互斥是硬要求**（交付说明 §一.2）：`who: 'player'` 的图一定有 boy/girl 两份，
 *    剧情里只写语义名字，由引擎按开局性别解析成 `art.story.<boy|girl>.<name>` ——
 *    从类型上就不可能把男女主角混进同一条剧情画面（`StoryName` 是下面这张表的键）。
 * 2. **"交了没有"必须是可查的**：`AssetLoader.url()` 对没登记的 AssetId 返回空串，
 *    图会静默不显示。登记在这里之后，没交的图会退成一张写着中文名的占位图，
 *    一眼就知道缺哪张、文件名该叫什么；`delivered: false` 则明说"这一版就是没有"，
 *    缺图时那一刻不插画（由底部立绘行顶），而不是糊一张别的图上去。
 * 3. **测试的锚点**：tests/unit/storyArt.test.ts 会核对
 *    "声明已交付 ⇔ art/ 里真有这个文件"、"剧情里引用的名字都在表里"。
 *
 * 尺寸是**运行时真正要显示的大小**，不是交付源图的原始尺寸：
 *   `art.story.*` 走整屏 CG 卡，卡高最多约 572px（1280×860 窗口），所以 3:4 的图 480×640、
 *   4:3 的图 640×480 已经 1:1；再大只是把 base64 塞进单文件 HTML（内联后 ×1.33）。
 */

export interface StoryShot {
  /** 中文名：占位图标签、画廊标题都用它 */
  label: string;
  /** player = 男女各一张（按开局性别二选一）；common / teacher = 不分性别，两张路线共用 */
  who: 'player' | 'common' | 'teacher';
  /** 交付规格，必须与 content/art.spec.json 完全一致（art:check 会卡尺寸） */
  width: number;
  height: number;
  /** 剧情落点（文档用；测试只核对它是不是真的出现在 moments 里） */
  moments: string[];
  /** false = 这一版还没有这张图；缺图时那一刻不插画，由立绘行顶 */
  delivered?: boolean;
  /** 交付源图的性质备注（例如"这张是透明抠图"） */
  note?: string;
}

export const STORY_SHOTS = {
  // ── DAY2 ─────────────────────────────────────────────────────────────
  report: {
    label: '查看成绩单',
    who: 'player',
    width: 480,
    height: 640,
    moments: ['D2_0800'],
    note: '男生的源图是带背景整幅图，女生的源图是透明抠图（见 art.spec.json 的 alpha）',
  },
  bunkSleep: {
    label: '上下铺皱眉睡觉',
    who: 'player',
    width: 480,
    height: 640,
    moments: ['D2_0620', 'D2_2330', 'D3_2340', 'D4_2350', 'D5_2300'],
    note: 'D3 的交付包里就是同一份文件，D4/D5 的说明书写"直接复用 DAY2 图片" —— '
      + '按同一张 AssetId 复用，不重复导入。注意 D6_2359「最后一夜」没有复用它：'
      + '那天交付了专门的一张 lastNight（收尾之夜值得一张属于它自己的画面）',
  },
  canteen: {
    label: '食堂吃饭',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D2_1240'],
    note: '说明书写的是"12:40 食堂"，而那一刻地点/文案是教室 —— 见《待确认问题》6.8',
  },
  crowd: {
    label: '同学聚拢围观',
    who: 'common',
    width: 640,
    height: 480,
    moments: ['D2_0800'],
    note: '画面里没有男女主角，所以两张路线共用',
  },
  handout: {
    label: '老师·递出成绩单',
    who: 'teacher',
    width: 480,
    height: 640,
    moments: ['D2_0800'],
    note: '透明抠图。老师素材男女路线共用（交付说明 §一.4）',
  },
  // ── DAY3 ─────────────────────────────────────────────────────────────
  morningRead: {
    label: '晨读喝豆浆',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D3_0750'],
  },
  lunchAlone: {
    label: '一个人的午饭',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D3_1230'],
  },
  // ── DAY4 ─────────────────────────────────────────────────────────────
  examDream: {
    label: '梦里都在考试',
    who: 'player',
    width: 480,
    height: 640,
    moments: ['D4_0610'],
  },
  rankCalled: {
    label: '排名被当众念出',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D4_0930'],
  },
  phoneBow: {
    label: '家长来电低头',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D4_2000'],
  },
  phoneCall: {
    label: '手机·家长来电',
    who: 'common',
    width: 512,
    height: 512,
    moments: ['D4_2000'],
    note: '道具特写（1:1）。交付说明：来电文字/号码/按钮由程序 UI 重画，图上那套不直接用',
  },
  // ── DAY5 ─────────────────────────────────────────────────────────────
  notesPassed: {
    label: '同桌把笔记推过来',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D5_1000'],
  },
  notesProp: {
    label: '课堂笔记',
    who: 'common',
    width: 512,
    height: 512,
    moments: ['D5_1000'],
    note: '道具特写。笔记内容只是视觉参考，真实文字由程序显示',
  },
  soda: {
    label: '冰汽水',
    who: 'common',
    width: 512,
    height: 512,
    moments: ['D5_1300'],
    note: '道具特写。交付说明：无品牌参考，正式版不要直接使用图上的文字/品牌',
  },
  bondCheck: {
    label: '羁绊检查点',
    who: 'player',
    width: 640,
    height: 480,
    // 达标（D5_2100）与没达标（D5_2101）共用同一张：两版差别在台词与云色，不在画面
    moments: ['D5_2100', 'D5_2101'],
    note: '剧情脚本第 236–239 行的两个分支共用一张图',
  },
  // ── DAY6 ─────────────────────────────────────────────────────────────
  invigilate: {
    label: '监考压力捂耳朵',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D6_0830'],
    note: '交付说明：捂耳朵动作只保留主角自己的两只手',
  },
  examPaper: {
    label: '试卷与铅笔',
    who: 'common',
    width: 512,
    height: 512,
    moments: ['D6_0830'],
    note: '道具特写。试卷文字由程序 UI 叠加',
  },
  coldLunch: {
    label: '饭有点凉',
    who: 'common',
    width: 640,
    height: 480,
    moments: ['D6_1200'],
    note: '交付源是 4:3 而别的教室空镜是 16:9，做底图会被裁掉画面高度，所以按插画卡接',
  },
  rankPost: {
    label: '排名公布',
    who: 'player',
    width: 640,
    height: 480,
    moments: ['D6_2030'],
  },
  lastNight: {
    label: '最后一夜睡眠不足',
    who: 'player',
    width: 480,
    height: 640,
    moments: ['D6_2359'],
  },
  // ── DAY7 ─────────────────────────────────────────────────────────────
  finalLookUp: {
    label: '终章抬头',
    who: 'player',
    width: 480,
    height: 640,
    moments: ['D7_1500'],
    note: '交付说明 §二：男女不得同框，按开局性别二选一',
  },
  // ── 已预留、但这一版没交的图（delivered:false = "缺图时那一刻不插画"，不是忘了接）──
  lookUp: {
    label: '抬头·黄昏粉笔灰',
    who: 'player',
    width: 480,
    height: 640,
    moments: [],
    delivered: false,
    note: 'D4 17:00：交付说明 §四点名了「男生_抬头_复用.png / 女生_抬头_复用.png」，'
      + '但 DAY4 包里没有这两个文件（已在《待确认问题》6.8 记录）。补交后要改两处：'
      + "把这里的 delivered 去掉，并给 D4_1700 挂上 cg: [S('lookUp')]。尺寸先按 480×640 预留。",
  },
  rankProjection: {
    label: '排名公布·投影层',
    who: 'common',
    width: 1280,
    height: 720,
    moments: [],
    delivered: false,
    note: 'D6 20:30：交付的 day6/common/排名公布_投影道具.jpg 里**男生在左、女生在右同时出现在同一帧**，'
      + '违反交付说明 §一「任何剧情画面不得同时出现男生和女生」，所以没有接入。'
      + '需要的是一张"空教室 + 投影着名次的幕布"（或男女各切一版），交来后按 ArtSlot 接进 D6_2030。',
  },
} as const satisfies Record<string, StoryShot>;

export type StoryName = keyof typeof STORY_SHOTS;

/**
 * 剧情里引用**按性别**的剧情图的写法：`S('report')` —— 名字写错是**编译期**错误。
 *
 * 名字对、但图不分性别（比如 `S('crowd')`）是**加载期**错误：解析出来会是
 * `art.story.boy.crowd` / `art.story.girl.crowd` 这两个根本不存在的 AssetId，
 * 于是那一刻静默地不插画，画面上一个容器都不报错 —— 这正是"成绩单来了之后没有人图"
 * 那个 bug 的成因（`crowd` 是 who:'common' 的图，被误用 S() 引用了一个月）。
 * 所以这里和 C() 对称地各守一边：用错入口当场抛错，不给它静默的机会。
 */
export const S = (name: StoryName): ArtSlot => {
  const shot: StoryShot = STORY_SHOTS[name];
  if (shot.who !== 'player') throw new Error(`${name} 是不分性别的剧情图（who: ${shot.who}），请用 C() 引用`);
  return { story: name };
};

/**
 * 不分性别的剧情图（`who` 是 common / teacher）：直接给出 AssetId。
 *
 * 为什么分两个入口：`S()` 走的是"按开局性别解析"，对老师/同学这种**男女路线共用**的图
 * 没有意义（解析成 art.story.boy.handout 就找不到了）。分开之后，谁按性别、谁不按性别
 * 从调用点上一眼可见，写错（对 teacher 用 S）会在**这里**当场抛错，而不是留到运行时。
 */
export const C = (name: StoryName): ArtSlot => {
  const shot: StoryShot = STORY_SHOTS[name];
  if (shot.who === 'player') throw new Error(`${name} 是按性别的剧情图，请用 S() 引用`);
  return { id: storyAssetIds(name)[0] };
};

/** 这张图按性别分两份吗？（'player' 才有 boy/girl 两份） */
export const isPerGender = (shot: StoryShot): boolean => shot.who === 'player';

/** 主角剧情的 AssetId（按性别）；其它 who 用 who 本身当中间段 */
export const storyAssetIds = (name: StoryName): string[] => {
  const shot: StoryShot = STORY_SHOTS[name];
  return shot.who === 'player'
    ? [`art.story.boy.${name}`, `art.story.girl.${name}`]
    : [`art.story.${shot.who}.${name}`];
};
