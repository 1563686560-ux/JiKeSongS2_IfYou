import type { Condition } from '../src/types/content';
import { moments } from './moments';

// B（玩法策划）：把常用判定条件集中管理，endings 与 flow 共用，避免重复。
// 基础条件（睡眠规则 / 羁绊检查点）在 ./rules.ts —— 放这里会和 moments.ts 形成循环依赖。
export { sleepShort, bondCheckpointMet, bondCheckpointMissed } from './rules';

// 干预 id 直接从七日时刻表里收集，避免"内容加了新干预、条件表忘了同步"这类漂移。
export const INTERVENTION_IDS: string[] = Array.from(
  new Set(Object.values(moments).flatMap((m) => (m.event?.interactions ?? []).map((i) => i.id))),
);

// ↓ 结局条件。脚本第三章原值是「晴空：平均心情 ≥66 且羁绊 ≥12」「生长：平均心情 ≥42」。
// 生长/雨过的 42 分界实测有效，保持不动；晴空的 66 分界**不可达**，必须重标：
// 脚本给的心情曲线是 D1…D7 = 45/40/55/35/50/28/70（峰值 70、D6 还要掉到 28），
// 而"平均心情"是一周 50 个记录点的平均，一条从 45 出发、中间掉到 28、末尾回到 ~91 的曲线，
// 即使每一步都选最优也只有 64.9 —— 也就是说脚本自己的阈值高于它自己的曲线能给出的上限。
// 因此晴空改为 ≥62：只有"七天全程尽力"（12 次干预、羁绊满 12）才够得着，
// 摸鱼或只救前几天都落在生长/雨过。改这个数字前先跑 tests/unit/balance.test.ts 看实测区间。
export const sunnyCondition: Condition = {
  kind: 'and',
  all: [{ kind: 'avgMood', op: 'gte', value: 62 }, { kind: 'bond', op: 'gte', value: 12 }],
};

export const growCondition: Condition = { kind: 'avgMood', op: 'gte', value: 42 };

// 任意单一干预累计 ≥ value 次
export function anyInterventionAtLeast(value: number): Condition {
  return {
    kind: 'or',
    any: INTERVENTION_IDS.map((interventionId): Condition => ({ kind: 'count', interventionId, op: 'gte', value })),
  };
}

// 隐藏结局「笨拙的守护」的阈值。
// 脚本原作写的是 ≥5，但实测（tests/unit/interventionCeiling.test.ts）：一周里单一干预的理论上限是
// extraSleep=6、coverEars=5，其余 ≤4。阈值定 5 会跟"最优解"撞车——coverEars 在它出现的 5 个事件里
// 都是情绪收益最高的选项，"认真玩"的玩家自然会点满 5 次，于是隐藏结局变成默认结局、盖住了晴空。
// 定 6 之后，只有"每一天都选择偷加两小时"的玩家才拿得到，正好对上这句台词：
// 「你总是用同一种方式，笨笨地护着我。」
// 注意：不能再往上调——7 已经超过内容上限 6，会变成永远拿不到的死结局，
// 上限由 tests/unit/interventionCeiling.test.ts 守着。
export const HIDDEN_INTERVENTION_THRESHOLD = 6;

export const hiddenEndingCondition: Condition = anyInterventionAtLeast(HIDDEN_INTERVENTION_THRESHOLD);

// "这个时刻还没做过"——按 onceKey 门控
export function notDone(onceKey: string): Condition {
  return { kind: 'not', cond: { kind: 'flag', key: onceKey, op: 'eq', value: true } };
}
