import { describe, expect, it } from 'vitest';
import { config } from '../../content';
import { momentOrder } from '../../content/moments';
import { endings } from '../../content/endings';
import { flow } from '../../content/flow';
import { evalCondition } from '../../src/core/runtime';
import { applyDerivedFlags, createState, type GameState } from '../../src/core/runtime';
import { HIDDEN_INTERVENTION_THRESHOLD } from '../../content/conditions';
import type { Condition } from '../../src/types/content';

// 结局可达性（数值配平）：四个结局都必须真的能被玩出来，否则就是"写了但摸不到"。
// 这里不跑引擎，只按 content 的数值与引擎的记账方式（moodHistory / dayMoods / light）
// 做一遍忠实模拟，速度快到可以进单测；真正的点击链路由 smoke 测试覆盖。

const START_MOOD = config.settings?.initialMood ?? 50;
const CLAMP = { min: 0, max: 100 };

function clamp(v: number): number {
  return Math.min(CLAMP.max, Math.max(CLAMP.min, v));
}

// 策略返回候选下标；返回 -1 = 主动不出手（放任窗口超时走 miss）
type Strategy = (candidates: { id: string; moodDelta: number; cost: number }[]) => number;

/** 忠实模拟一局：返回结局状态。策略决定每个事件选哪个干预。 */
function simulate(strategy: Strategy, onlyDays?: number[]): GameState {
  const state = createState(config);
  state.day = 0;   // 让第 1 天也走一次"日初锚点"，与引擎的 day 节点一致
  // 模拟"用默认答案做完开局定制"：睡眠时长由 闹钟−熄灯 派生，决定 6 个「睡眠不足」事件是否触发。
  // 默认滑杆 = 闹钟 05:50 / 熄灯 23:30 → 380 分钟（6.3 小时）< 7.25 小时，所以这些事件都会触发。
  // 必须显式走一遍，否则 flags.sleepMinutes 是空的、sleepShort 判 false，
  // 整局会凭空少掉 6 个事件窗口，配平数字就全错了。
  for (const q of config.customization ?? []) {
    if (q.type === 'slider' && q.slider) state.flags[`${q.id}Value`] = q.slider.value;
  }
  applyDerivedFlags(state, config.settings?.derivedFlags ?? []);
  const dayLight: Record<number, number> = {};
  for (const node of flow) {
    if (node.kind === 'day') dayLight[node.day] = node.light;
  }

  for (const id of momentOrder) {
    const m = config.moments![id];
    if (m.when && !evalCondition(m.when, state)) continue;

    // 进入新的一天：日初锚点（引擎在 day 节点里记 moodHistory 与 dayMoods）
    if (state.day !== m.day) {
      state.day = m.day;
      state.light = dayLight[m.day] ?? 0;
      const label = `第${m.day}天`;
      state.moodHistory.push({ label, mood: state.mood });
      state.dayMoods.push({ day: m.day, mood: state.mood });
    }

    state.onceKeys.push(m.onceKey);
    const allowed = !onlyDays || onlyDays.includes(m.day);

    if (m.event) {
      const affordable = allowed ? m.event.interactions.filter((i) => i.cost <= state.light) : [];
      if (!affordable.length) {
        // 光不足（或该策略选择不出手）→ 超时 miss
        state.mood = clamp(state.mood + (m.event.onTimeout?.moodDelta ?? 0));
        state.logs.missCount++;
      } else {
        // 注意：心情变化在 it.outcome.moodDelta 上，不在 it 上
        const idx = strategy(affordable.map((i) => ({ id: i.id, moodDelta: i.outcome.moodDelta ?? 0, cost: i.cost })));
        if (idx < 0) {
          // 主动放手：窗口超时，走 miss
          state.mood = clamp(state.mood + (m.event.onTimeout?.moodDelta ?? 0));
          state.logs.missCount++;
        } else {
          const pick = affordable[Math.max(0, Math.min(affordable.length - 1, idx))];
          state.light = Math.max(0, state.light - pick.cost);
          state.mood = clamp(state.mood + (pick.outcome.moodDelta ?? 0));
          state.bond += pick.outcome.bondDelta ?? 0;
          state.logs.totalInterventions++;
          state.logs.interventions[pick.id] = (state.logs.interventions[pick.id] ?? 0) + 1;
        }
      }
      state.moodHistory.push({ label: m.title, mood: state.mood });
    } else {
      const delta = m.outcome?.moodDelta ?? 0;
      state.mood = clamp(state.mood + delta);
      state.bond += m.outcome?.bondDelta ?? 0;
      state.moodHistory.push({ label: m.id, mood: state.mood });
    }
  }
  return state;
}

const best: Strategy = (c) => c.reduce((bi, x, i) => (x.moodDelta > c[bi].moodDelta ? i : bi), 0);
const worst: Strategy = (c) => c.reduce((bi, x, i) => (x.moodDelta < c[bi].moodDelta ? i : bi), 0);
// 隐藏结局路线：只护睡眠——白天全部放手，把每天的光留给夜里的「偷加两小时」。
// 这才是"你总是用同一种方式，笨笨地护着我"真正的玩法代价：为了每晚都护一次，白天得放弃很多。
const nightOnly: Strategy = (c) => {
  const i = c.findIndex((x) => x.id === 'extraSleep');
  return i >= 0 ? i : -1;
};

function avgMoodOf(s: GameState): number {
  return s.moodHistory.reduce((sum, h) => sum + h.mood, 0) / s.moodHistory.length;
}

function decide(s: GameState): string {
  const sunny = endings.find((e) => e.id === 'sunny');
  const grow = endings.find((e) => e.id === 'grow');
  // 隐藏结局优先（阈值见 content/conditions.ts 的 HIDDEN_INTERVENTION_THRESHOLD）
  const maxSingle = Math.max(0, ...Object.values(s.logs.interventions));
  if (maxSingle >= HIDDEN_INTERVENTION_THRESHOLD) return 'hidden';
  if (sunny && evalCondition(sunny.condition as Condition, s)) return 'sunny';
  if (grow && evalCondition(grow.condition as Condition, s)) return 'grow';
  return 'rain';
}

const rows: string[] = [];

function label(s: GameState): string {
  const maxSingle = Math.max(0, ...Object.values(s.logs.interventions));
  return `结局=${decide(s)} 平均心情=${avgMoodOf(s).toFixed(1)} 羁绊=${s.bond} 漏掉=${s.logs.missCount} 干预=${s.logs.totalInterventions} 单干预最高=${maxSingle} 最终心情=${s.mood}`;
}

// 避免触发隐藏结局的轮换策略：每次尽量挑一个"还没用过那么多次"的干预
function rotate(limit: number): Strategy {
  return (c) => {
    for (let i = 0; i < c.length; i++) {
      const used = rotate.counts.get(c[i].id) ?? 0;
      if (used < limit) { rotate.counts.set(c[i].id, used + 1); return i; }
    }
    return 0;
  };
}
rotate.counts = new Map<string, number>();

describe('结局可达性（数值配平）', () => {
  it('打印各策略实测数值，便于策划核对配平', () => {
    const cases: [string, () => GameState][] = [
      ['全选最暖', () => simulate(best)],
      ['全选最冷', () => simulate(worst)],
      ['永远选第一个（笨拙）', () => simulate(() => 0)],
      ['轮换·限制每人 2 次', () => { rotate.counts = new Map(); return simulate(rotate(2)); }],
      ['轮换·限制每人 1 次', () => { rotate.counts = new Map(); return simulate(rotate(1)); }],
      ['只护睡眠（隐藏结局路线）', () => simulate(nightOnly)],
      ['只救 D1–D2', () => simulate(best, [1, 2])],
      ['只救 D1–D4', () => simulate(best, [1, 2, 3, 4])],
      ['只救 D1–D6', () => simulate(best, [1, 2, 3, 4, 5, 6])],
    ];
    for (const [name, run] of cases) rows.push(`${name}：${label(run())}`);
    const perDay = [1, 2, 3, 4, 5, 6, 7].map((d) => {
      const ms = momentOrder.map((id) => config.moments![id]).filter((m) => m.day === d);
      return `D${d}: 时刻${ms.length} 其中有事件${ms.filter((m) => m.event).length}`;
    });
    const dayLightRow = flow.filter((n) => n.kind === 'day').map((n) => `D${n.day}=${n.light}`).join(' ');
    // eslint-disable-next-line no-console
    console.log('\n=== 结局可达性实测 ===\n' + rows.join('\n')
      + '\n--- 内容规模 ---\n' + perDay.join('\n')
      + `\n每日守护之光：${dayLightRow}`);
    expect(rows.length).toBe(cases.length);
  });

  it('四个结局都真的能被玩出来（不能写了却摸不到）', () => {
    const reached = new Set<string>();
    for (const run of [
      () => simulate(best),
      () => simulate(worst),
      () => simulate(() => 0),
      () => { rotate.counts = new Map(); return simulate(rotate(2)); },
      () => { rotate.counts = new Map(); return simulate(rotate(1)); },
      () => simulate(nightOnly),
      () => simulate(best, [1, 2]),
      () => simulate(best, [1, 2, 3, 4]),
      () => simulate(best, [1, 2, 3, 4, 5, 6]),
    ]) reached.add(decide(run()));

    const missing = ['sunny', 'grow', 'rain', 'hidden'].filter((e) => !reached.has(e));
    expect(missing, `这些结局目前玩不出来：${missing.join(', ')}\n${rows.join('\n')}`).toEqual([]);
  });

  it('「隐藏·笨拙的守护」可达，且不会被最优解顺手拿到', () => {
    const s = simulate(nightOnly);
    const maxSingle = Math.max(0, ...Object.values(s.logs.interventions));
    expect(maxSingle, `只护睡眠路线没到阈值：${label(s)}`).toBeGreaterThanOrEqual(HIDDEN_INTERVENTION_THRESHOLD);
    expect(decide(s), label(s)).toBe('hidden');

    // 在意情绪最优解的玩家不该顺手触发隐藏结局，否则它会盖住晴空
    const bestRun = simulate(best);
    const bestMax = Math.max(0, ...Object.values(bestRun.logs.interventions));
    expect(bestMax).toBeLessThan(HIDDEN_INTERVENTION_THRESHOLD);
    expect(decide(bestRun), `最优解不该是隐藏结局：${label(bestRun)}`).toBe('sunny');
  });

  it('选择必须真的影响结果（最暖 ≠ 最冷）', () => {
    const warm = simulate(best);
    const cold = simulate(worst);
    expect(
      warm.moodHistory.map((h) => h.mood).join(','),
      '全选最暖与全选最冷的情绪轨迹完全一样 —— 选择没有意义，量表被 clamp 抹平了',
    ).not.toBe(cold.moodHistory.map((h) => h.mood).join(','));
  });

  it('最暖玩法的周终心情贴近脚本《目标心情》表的量级（峰值应远低于 100）', () => {
    const s = simulate(best);
    const peak = Math.max(...s.moodHistory.map((h) => h.mood));
    expect(peak, `最暖玩法峰值 ${peak}，量表基本被打满`).toBeLessThan(95);
    expect(s.mood, `周终心情 ${s.mood}，脚本目标 D7=70`).toBeGreaterThan(45);
  });

  it('心情不会长时间顶在天花板（否则配平失去意义）', () => {
    const s = simulate(best);
    const atCeiling = s.moodHistory.filter((h) => h.mood >= 100).length;
    expect(atCeiling / s.moodHistory.length, `最暖玩法有 ${atCeiling}/${s.moodHistory.length} 个记录点顶在 100`).toBeLessThan(0.5);
  });

  it('每天都有心情锚点，七日云朵正好七朵', () => {
    const s = simulate(best);
    expect(s.day).toBe(7);
    expect(s.dayMoods.length).toBe(7);
    expect(s.dayMoods.map((d) => d.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
