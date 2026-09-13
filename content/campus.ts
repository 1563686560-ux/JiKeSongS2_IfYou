import type { CampusConfig, CampusLocation } from '../src/types/content';

/**
 * 校园世界数据：俯瞰地图上的四个点位 + 十条行走路线。
 *
 * 这一份是 `map_routes_ts_交接包_v1.0/map_routes.ts` 的**忠实移植** —— 坐标、路网、
 * 寻路算法全部照抄，只做了三件事：
 *   1. 把交接包里的**文件路径**换成 AssetId（`move.<who>.<dir>.<frame>`）；
 *   2. 把 10 条路线从"运行时按需生成"改成**构建期算好**的静态表
 *      （交接包的 `ROUTES` 其实就是 `routePairs.map(createRoadPath)` 的结果，
 *       这里在模块顶层跑同一段逻辑，结果一模一样，但少一层运行时分支）；
 *   3. 补上"游戏里的 locationId ↔ 地图点位"的翻译（每个点位上的 `serves` / `servesWho`）。
 *
 * ## 为什么坐标是 0..1 而不是像素
 *
 * 交接包给的就是归一化坐标（`LOCATIONS` 里的 0.19 / 0.265 这些），
 * 好处是地图无论按什么尺寸渲染，人物都站在同一个位置。
 * 所以这里**不做任何像素换算**：渲染时 `left: x*100%`、`top: y*100%` 直接用。
 * `width`/`height` 只在需要像素级半径/尺寸时用（目前只有底图的 native 尺寸），
 * 与交接包的 `MAP_SIZE`（1344×768，就是底图的原始像素）一致。
 *
 * ## 游戏里只有三个地点，地图上有四个点
 *
 * 游戏的 `MomentConfig.locationId` 是 `bedroom | classroom | playground`，
 * 而地图上是 `girlDorm | boyDorm | teachingBuilding | playground` ——
 * 宿舍分成男女两栋。这不是多出来的负担，正好是**开局性别**在画面上唯一一次可见的差别：
 * 选了女生的那周，她住在左边上面那栋楼。
 */

/**
 * 交接包 LOCATIONS 的四个点位。id 与交接包一致，不要改名（改了路线表就对不上了）。
 *
 * `serves` / `servesWho` 是本项目加的两个字段（交接包里没有）：把"游戏地点 → 地图点位"
 * 这件事**写成数据**，而不是在引擎里写一串 if。游戏的三个 locationId 在地图上是四个点，
 * 多出来的那个正是男女宿舍 —— 开局性别在画面上唯一一次可见的差别。
 */
const LOCATIONS: Record<string, CampusLocation> = {
  girlDorm: { id: 'girlDorm', label: '女生宿舍', x: 0.19, y: 0.265, serves: 'bedroom', servesWho: 'girl' },
  boyDorm: { id: 'boyDorm', label: '男生宿舍', x: 0.19, y: 0.565, serves: 'bedroom', servesWho: 'boy' },
  teachingBuilding: { id: 'teachingBuilding', label: '教学楼', x: 0.5, y: 0.285, serves: 'classroom' },
  playground: { id: 'playground', label: '操场', x: 0.8, y: 0.4, serves: 'playground' },
};

/** 十字路口的中心（交接包 HUB）——所有跨区路线都要经过它 */
const HUB = { x: 0.5, y: 0.52 };
/** 通往操场那条岔路的拐点（交接包 PLAYGROUND_CONNECTION） */
const PLAYGROUND_CONNECTION = { x: 0.8, y: 0.52 };

/**
 * 寻路：交接包 `createRoadPath` 的原样移植。
 *
 * 规则很简单，因为它画的是一所中学的**十字路网**，不是任意迷宫：
 * 宿舍 → 竖路 → HUB → 目标；操场 → 水平路 → HUB → 目标。
 * 保留这段算法的意义是"路线看起来像人真的会走的路"（沿路走直角、不穿草坪），
 * 所以**不要**改成两点连直线。
 */
const createRoadPath = (from: string, to: string): { x: number; y: number }[] => {
  const start = LOCATIONS[from];
  const end = LOCATIONS[to];
  if (!start || !end || from === to) return start ? [{ x: start.x, y: start.y }] : [];

  if (from === 'girlDorm' || from === 'boyDorm') {
    const startRoad = { x: start.x, y: HUB.y };
    if (to === 'teachingBuilding') return [start, startRoad, HUB, end].map((p) => ({ x: p.x, y: p.y }));
    if (to === 'playground') return [start, startRoad, PLAYGROUND_CONNECTION, end].map((p) => ({ x: p.x, y: p.y }));
  }
  if (to === 'girlDorm' || to === 'boyDorm') {
    const endRoad = { x: end.x, y: HUB.y };
    if (from === 'teachingBuilding') return [start, HUB, endRoad, end].map((p) => ({ x: p.x, y: p.y }));
    if (from === 'playground') return [start, PLAYGROUND_CONNECTION, HUB, endRoad, end].map((p) => ({ x: p.x, y: p.y }));
  }
  if (from === 'teachingBuilding' && to === 'playground') return [start, HUB, PLAYGROUND_CONNECTION, end].map((p) => ({ x: p.x, y: p.y }));
  if (from === 'playground' && to === 'teachingBuilding') return [start, PLAYGROUND_CONNECTION, HUB, end].map((p) => ({ x: p.x, y: p.y }));
  return [start, end].map((p) => ({ x: p.x, y: p.y }));
};

/** 交接包 `routePairs` 的十条路线，逐条保留（含名字，方便对账） */
const ROUTE_PAIRS: [string, string, string][] = [
  ['girlDormToTeachingBuilding', 'girlDorm', 'teachingBuilding'],
  ['girlDormToPlayground', 'girlDorm', 'playground'],
  ['boyDormToTeachingBuilding', 'boyDorm', 'teachingBuilding'],
  ['boyDormToPlayground', 'boyDorm', 'playground'],
  ['teachingBuildingToGirlDorm', 'teachingBuilding', 'girlDorm'],
  ['teachingBuildingToBoyDorm', 'teachingBuilding', 'boyDorm'],
  ['teachingBuildingToPlayground', 'teachingBuilding', 'playground'],
  ['playgroundToTeachingBuilding', 'playground', 'teachingBuilding'],
  ['playgroundToGirlDorm', 'playground', 'girlDorm'],
  ['playgroundToBoyDorm', 'playground', 'boyDorm'],
];

export const campus: CampusConfig = {
  background: 'map.campus.base',
  // 交接包 MAP_SIZE：就是底图的原始像素，也是所有位置百分比的换算基准
  width: 1344,
  height: 768,
  locations: Object.values(LOCATIONS),
  routes: ROUTE_PAIRS.map(([name, from, to]) => ({ from, to, points: createRoadPath(from, to), name })),
  // 交接包 MapCharacterMover 的两个默认值，原样保留：
  // speed 的单位是"归一化坐标 / 秒"，0.22 意味着横穿整张地图（1.0）要 ~4.5 秒。
  speed: 0.22,
  frameIntervalMs: 140,
  // 走完一条路线的大致时长上限：最长的宿舍→操场约 0.9 个坐标单位 ≈ 4.1 秒。
  // 这是"看人物走过去"的时长，玩家随时可以按加速或回车跳过，所以偏慢是安全的。
  maxMs: 6000,
};
