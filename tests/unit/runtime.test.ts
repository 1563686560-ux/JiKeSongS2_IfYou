import { beforeEach, describe, expect, it } from 'vitest';
import { applyOutcome, clamp, createState, evalCondition, SaveSystem, tierFor } from '../../src/core/runtime';
import type { GameConfig } from '../../src/types/content';

const cfg: GameConfig = {
  meta: { title: 't', version: '1.0.0' },
  assets: { images: {}, audio: {} },
  maps: {}, scenes: {}, dilemmas: {}, endings: [], flow: [], start: 'start',
};

describe('数值与条件求值', () => {
  it('clamp 夹紧', () => {
    expect(clamp(120, 0, 100)).toBe(100);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('createState 默认值', () => {
    const s = createState(cfg);
    expect(s.mood).toBe(45);
    expect(s.light).toBe(2);
    expect(s.bond).toBe(0);
    expect(s.flags).toEqual({});
    expect(s.logs.totalInterventions).toBe(0);
  });

  it('applyOutcome 数值结算与下限', () => {
    const s = createState(cfg);
    applyOutcome(s, { moodDelta: 200 });
    expect(s.mood).toBe(100);
    applyOutcome(s, { lightDelta: -99 });
    expect(s.light).toBe(0);
    applyOutcome(s, { bondDelta: -5 });
    expect(s.bond).toBe(0);
  });

  it('applyOutcome setFlags', () => {
    const s = createState(cfg);
    applyOutcome(s, { setFlags: { a: true, b: 3 } });
    expect(s.flags.a).toBe(true);
    expect(s.flags.b).toBe(3);
  });

  it('tierFor 心情分档', () => {
    expect(tierFor(cfg, 10).cloud).toBe('dark');
    expect(tierFor(cfg, 50).cloud).toBe('white');
    expect(tierFor(cfg, 90).cloud).toBe('gold');
  });

  it('evalCondition 各种条件', () => {
    const s = createState(cfg);
    s.mood = 70; s.bond = 3; s.light = 2;
    s.flags.x = true;
    s.logs.interventions.coverEars = 5;
    expect(evalCondition({ kind: 'flag', key: 'x', op: 'eq', value: true }, s)).toBe(true);
    expect(evalCondition({ kind: 'mood', op: 'gte', value: 66 }, s)).toBe(true);
    expect(evalCondition({ kind: 'bond', op: 'gte', value: 2 }, s)).toBe(true);
    expect(evalCondition({ kind: 'light', op: 'lt', value: 3 }, s)).toBe(true);
    expect(evalCondition({ kind: 'count', interventionId: 'coverEars', op: 'gte', value: 5 }, s)).toBe(true);
    expect(evalCondition({ kind: 'and', all: [{ kind: 'mood', op: 'gte', value: 66 }, { kind: 'bond', op: 'gte', value: 2 }] }, s)).toBe(true);
    expect(evalCondition({ kind: 'or', any: [{ kind: 'flag', key: 'nope', op: 'eq', value: true }, { kind: 'mood', op: 'gte', value: 66 }] }, s)).toBe(true);
    expect(evalCondition({ kind: 'not', cond: { kind: 'flag', key: 'nope', op: 'eq', value: true } }, s)).toBe(true);
    expect(evalCondition(undefined, s)).toBe(true);
    expect(evalCondition({ kind: 'always' }, s)).toBe(true);
  });
});

describe('SaveSystem', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    } as Storage;
  });

  it('保存/加载往返', () => {
    const save = new SaveSystem();
    const s = createState(cfg);
    s.mood = 66; s.logs.collected = ['a']; s.custom = { gender: '女生' };
    save.save(s);
    const loaded = save.load(cfg)!;
    expect(loaded.mood).toBe(66);
    expect(loaded.logs.collected).toEqual(['a']);
    expect(loaded.custom).toEqual({ gender: '女生' });
  });

  it('版本升级保留收藏与定制、重置进度', () => {
    const save = new SaveSystem();
    const s = createState(cfg);
    s.mood = 90; s.bond = 10; s.logs.collected = ['a', 'b']; s.custom = { hair: '长发' };
    save.save(s);
    const cfg2: GameConfig = { ...cfg, meta: { ...cfg.meta, version: '2.0.0' } };
    const migrated = save.load(cfg2)!;
    expect(migrated.contentVersion).toBe('2.0.0');
    expect(migrated.mood).toBe(45); // 进度重置
    expect(migrated.bond).toBe(0);
    expect(migrated.logs.collected).toEqual(['a', 'b']); // 收藏保留
    expect(migrated.custom).toEqual({ hair: '长发' });
  });
});
