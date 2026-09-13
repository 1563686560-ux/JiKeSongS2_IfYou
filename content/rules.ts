import type { Condition } from '../src/types/content';

/**
 * 基础判定条件（不依赖任何内容数据）。
 *
 * 单独放一个文件是为了打断循环依赖：
 *   conditions.ts 需要 import moments（为了自动收集干预 id）
 *   moments.ts    也需要用到这里的基础条件（睡眠规则 / 羁绊检查点）
 * 如果这些基础条件写在 conditions.ts 里，两边就会互相 import，
 * ESM 下 conditions 顶层那个 Object.values(moments) 会在 moments 还没初始化时执行并崩掉。
 * 所以：**基础条件放这里，派生自内容的条件放 conditions.ts**。
 */

// 脚本《睡眠规则》（脚本第 48 行）：睡眠时长 = 闹钟 − 熄灯（跨夜分钟），
// **< 7.25 小时（= 435 分钟）才触发「睡眠不足」事件**。
// 这个 flag 由 settings.derivedFlags 在开局定制完成后算出。
export const sleepShort: Condition = { kind: 'flag', key: 'sleepMinutes', op: 'lt', value: 435 };

// 脚本第 236–239 行 D5 21:00 羁绊检查点：羁绊 ≥ 6 走金色版，否则走白色版
export const bondCheckpointMet: Condition = { kind: 'bond', op: 'gte', value: 6 };
export const bondCheckpointMissed: Condition = { kind: 'bond', op: 'lt', value: 6 };
