import type { Condition, DerivedFlagRule, GameConfig, MoodTier, Outcome, Scalar } from '../types/content';

export interface GameState {
  contentVersion: string;
  nodeId: string;
  day: number;
  storyTime: string;
  locationId: string;
  currentMomentId: string;
  onceKeys: string[];
  inputMode: 'idle' | 'location' | 'dialogue' | 'intervention' | 'ending';
  playthroughs: number;                        // 已完成周目数（二周目台词差分用）
  flags: Record<string, Scalar>;
  mood: number;
  light: number;
  bond: number;
  custom: Record<string, string>;
  moodHistory: { label: string; mood: number }[];
  dayMoods: { day: number; mood: number }[];   // 每日心情 → 结局页"七日云朵"
  logs: {
    interventions: Record<string, number>;
    totalInterventions: number;
    missCount: number;
    collected: string[];
    // 最近一次干预是否成功 → 决定主角立绘用"正常坐姿"还是"放松坐姿"
    // （美术交付说明：「D1 干预成功、情绪缓和后使用」放松态）
    lastInterventionSuccess?: boolean;
    // 已读台词（"来源#行号"）→ 支撑"已读快进"（文档 §5.1）：
    // 看过的句子直接整句显示，刷新重播或二周目时不再逐字重打。
    seenLines?: string[];
  };
}

// 守护星级默认分档（B 未定数值时的兜底）
export const DEFAULT_STAR_TIERS = [
  { minBond: 12, stars: 5 },
  { minBond: 9, stars: 4 },
  { minBond: 6, stars: 3 },
  { minBond: 3, stars: 2 },
  { minBond: 0, stars: 1 },
];

export function starsFor(config: GameConfig, bond: number): number {
  const tiers = config.settings?.starTiers ?? DEFAULT_STAR_TIERS;
  return [...tiers].sort((a, b) => b.minBond - a.minBond).find((t) => bond >= t.minBond)?.stars ?? 1;
}

export const DEFAULT_TIERS: MoodTier[] = [
  { min: 0, name: '崩溃边缘', cloud: 'dark', saturation: -18 },
  { min: 21, name: '疲惫', cloud: 'dark', saturation: -10 },
  { min: 40, name: '平静', cloud: 'white', saturation: 0 },
  { min: 61, name: '小确幸', cloud: 'white', saturation: 4 },
  { min: 80, name: '被守护感', cloud: 'gold', saturation: 8 },
];

export function createState(config: GameConfig): GameState {
  const defaults = config.settings?.customDefaults;
  const state: GameState = {
    contentVersion: config.meta.version,
    nodeId: config.start,
    day: 1,
    storyTime: '',
    // 初始地点为空：开局第一个时刻也必须先显示"下一目标"入口，而不是默默开始
    locationId: '',
    currentMomentId: '',
    onceKeys: [],
    inputMode: 'idle',
    playthroughs: 0,
    // 开局问题的固定默认值先落地，玩家答过的会在 runCustomization 里覆盖同名 key。
    // 放在 createState 而不是"只在定制流程里"，是因为测试与续玩也会直接造 state，
    // 少了它 sleepMinutes 就是空的、睡眠不足类时刻会被静默跳过（见 content/rules.ts）。
    flags: { ...(defaults?.flags ?? {}) },
    mood: config.settings?.initialMood ?? 45,
    light: config.settings?.initialLight ?? 2,
    bond: config.settings?.initialBond ?? 0,
    custom: { ...(defaults?.custom ?? {}) },
    moodHistory: [],
    dayMoods: [],
    logs: { interventions: {}, totalInterventions: 0, missCount: 0, collected: [], seenLines: [] },
  };
  // 派生值（睡眠时长等）在状态诞生的那一刻就算好：任何拿到 state 的地方都能立刻判定，
  // 不必记得"先调一次 applyDerivedFlags"。
  applyDerivedFlags(state, config.settings?.derivedFlags ?? []);
  return state;
}

export function applyOutcome(state: GameState, outcome: Outcome): void {
  state.mood = clamp(state.mood + (outcome.moodDelta ?? 0), 0, 100);
  state.light = Math.max(0, state.light + (outcome.lightDelta ?? 0));
  state.bond = Math.max(0, state.bond + (outcome.bondDelta ?? 0));
  Object.assign(state.flags, outcome.setFlags ?? {});
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function tierFor(config: GameConfig, mood: number): MoodTier {
  const tiers = config.settings?.moodTiers ?? DEFAULT_TIERS;
  return [...tiers].sort((a, b) => b.min - a.min).find((t) => mood >= t.min) ?? tiers[0];
}

// 平均心情（结局判定用）：所有记录点的平均（含每个事件结算后的心情）
export function avgMood(state: GameState): number {
  if (!state.moodHistory.length) return state.mood;
  return state.moodHistory.reduce((sum, h) => sum + h.mood, 0) / state.moodHistory.length;
}

// 每日锚点平均（"七日云朵"的平均）。脚本没写清"平均心情"是哪种，两个都给了，B 挑一个。
export function avgDayMood(state: GameState): number {
  if (!state.dayMoods.length) return avgMood(state);
  return state.dayMoods.reduce((sum, d) => sum + d.mood, 0) / state.dayMoods.length;
}

// 派生数值：开局定制后自动算出的 flags（如 睡眠时长 = 闹钟 − 熄灯，跨夜取模 1440 分钟）
export function applyDerivedFlags(state: GameState, rules: readonly DerivedFlagRule[]): void {
  for (const rule of rules) {
    const from = Number(state.flags[`${rule.from}Value`]);
    const to = Number(state.flags[`${rule.to}Value`]);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    state.flags[rule.key] = (((to - from) % 1440) + 1440) % 1440;
  }
}

export function evalCondition(condition: Condition | undefined, state: GameState): boolean {
  if (!condition || condition.kind === 'always') return true;
  if (condition.kind === 'and') return condition.all.every((c) => evalCondition(c, state));
  if (condition.kind === 'or') return condition.any.some((c) => evalCondition(c, state));
  if (condition.kind === 'not') return !evalCondition(condition.cond, state);
  if (condition.kind === 'playthroughs') return compare(state.playthroughs, condition.op, condition.value);
  if (condition.kind === 'avgDayMood') return compare(avgDayMood(state), condition.op, condition.value);
  if (condition.kind === 'avgMood') return compare(avgMood(state), condition.op, condition.value);
  if (condition.kind === 'day') return compare(state.day, condition.op, condition.value);
  if (condition.kind === 'mood' || condition.kind === 'bond' || condition.kind === 'light') {
    return compare(state[condition.kind], condition.op, condition.value);
  }
  if (condition.kind === 'count') {
    return compare(state.logs.interventions[condition.interventionId] ?? 0, condition.op, condition.value);
  }
  if (condition.kind === 'flag') return compare(state.flags[condition.key], condition.op, condition.value);
  return false;
}

function compare(actual: Scalar | undefined, op: string, expected: Scalar): boolean {
  if (op === 'eq') return actual === expected;
  if (op === 'ne') return actual !== expected;
  if (typeof actual !== 'number' || typeof expected !== 'number') return false;
  if (op === 'gt') return actual > expected;
  if (op === 'gte') return actual >= expected;
  if (op === 'lt') return actual < expected;
  return actual <= expected;
}

// 旧存档缺字段时补默认值（内容版本相同时也容错）
function normalize(parsed: Partial<GameState>, config: GameConfig): GameState {
  const fresh = createState(config);
  return {
    ...fresh,
    ...parsed,
    storyTime: parsed.storyTime ?? fresh.storyTime,
    locationId: parsed.locationId ?? fresh.locationId,
    currentMomentId: parsed.currentMomentId ?? fresh.currentMomentId,
    onceKeys: parsed.onceKeys ?? fresh.onceKeys,
    inputMode: parsed.inputMode ?? fresh.inputMode,
    flags: parsed.flags ?? fresh.flags,
    custom: parsed.custom ?? fresh.custom,
    moodHistory: parsed.moodHistory ?? fresh.moodHistory,
    dayMoods: parsed.dayMoods ?? fresh.dayMoods,
    // seenLines 也要兜底：老存档里没有这个字段（已读快进是后加的），缺了就补空数组
    logs: { ...fresh.logs, ...(parsed.logs ?? {}), seenLines: parsed.logs?.seenLines ?? fresh.logs.seenLines },
  } as GameState;
}

export class SaveSystem {
  constructor(private readonly key = 'jks2.save') {}

  load(config: GameConfig): GameState | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<GameState>;
      if (parsed.contentVersion === config.meta.version) return normalize(parsed, config);
      // 内容版本变化：保留跨周目留存物（定制 + 收藏 + 周目数），进度重置
      const fresh = createState(config);
      fresh.custom = parsed.custom ?? {};
      fresh.logs.collected = parsed.logs?.collected ?? [];
      fresh.playthroughs = parsed.playthroughs ?? 0;
      return fresh;
    } catch {
      return null;
    }
  }

  save(state: GameState): void {
    localStorage.setItem(this.key, JSON.stringify(state));
  }

  reset(): void {
    localStorage.removeItem(this.key);
  }
}
