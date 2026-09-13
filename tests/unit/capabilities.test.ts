import { describe, expect, it } from 'vitest';
import { applyDerivedFlags, avgDayMood, avgMood, createState, evalCondition } from '../../src/core/runtime';
import { formatTime, groupCollectibles, interpolate } from '../../src/core/util';
import type { GameConfig } from '../../src/types/content';

const cfg: GameConfig = {
  meta: { title: 't', version: '1.0.0' },
  assets: { images: {}, audio: {} },
  maps: {}, scenes: {}, dilemmas: {}, endings: [], flow: [], start: 's',
};

describe('脚本 V1.3 需要的新能力', () => {
  it('模板变量插值', () => {
    expect(interpolate('{gender}。{hair}。', { gender: '女生', hair: '马尾' })).toBe('女生。马尾。');
    expect(interpolate('{missing}', {})).toBe('{missing}');
  });

  it('分钟 → HH:MM', () => {
    expect(formatTime(350)).toBe('05:50');
    expect(formatTime(1410)).toBe('23:30');
    expect(formatTime(0)).toBe('00:00');
  });

  it('平均心情：有记录取均值，无记录退回当前心情', () => {
    const s = createState(cfg);
    expect(avgMood(s)).toBe(45);
    s.moodHistory.push({ label: '第1天', mood: 40 }, { label: '第2天', mood: 60 });
    expect(avgMood(s)).toBe(50);
  });

  it('avgMood / day 条件可判定', () => {
    const s = createState(cfg);
    s.moodHistory.push({ label: 'd1', mood: 70 }, { label: 'd2', mood: 66 });
    expect(evalCondition({ kind: 'avgMood', op: 'gte', value: 66 }, s)).toBe(true);
    expect(evalCondition({ kind: 'avgMood', op: 'gte', value: 80 }, s)).toBe(false);
    s.day = 4;
    expect(evalCondition({ kind: 'day', op: 'gte', value: 3 }, s)).toBe(true);
  });

  it('派生数值：睡眠时长跨夜计算', () => {
    const s = createState(cfg);
    const rule = [{ key: 'sleepMinutes', kind: 'timeDiff' as const, from: 'lightsOut', to: 'wake' }];
    s.flags.lightsOutValue = 1410;   // 23:30
    s.flags.wakeValue = 350;         // 05:50
    applyDerivedFlags(s, rule);
    expect(s.flags.sleepMinutes).toBe(380);   // 6h20m → 睡眠不足
    expect(evalCondition({ kind: 'flag', key: 'sleepMinutes', op: 'lt', value: 435 }, s)).toBe(true);

    s.flags.wakeValue = 390;         // 06:30
    s.flags.lightsOutValue = 1200;   // 20:00 熄灯
    applyDerivedFlags(s, rule);
    expect(s.flags.sleepMinutes).toBe(630);   // 10h30m → 睡够了
    expect(evalCondition({ kind: 'flag', key: 'sleepMinutes', op: 'lt', value: 435 }, s)).toBe(false);

    // 缺数据时不写 flag，不炸
    const empty = createState(cfg);
    applyDerivedFlags(empty, rule);
    expect(empty.flags.sleepMinutes).toBeUndefined();
  });

  it('平均心情两种口径都能判定（脚本未定义清"平均"指哪种）', () => {
    const s = createState(cfg);
    s.moodHistory.push({ label: 'd1', mood: 90 }, { label: '事件A', mood: 20 });
    s.dayMoods.push({ day: 1, mood: 45 }, { day: 2, mood: 40 });
    expect(avgMood(s)).toBe(55);        // (90+20)/2
    expect(avgDayMood(s)).toBe(42.5);   // (45+40)/2
    expect(evalCondition({ kind: 'avgMood', op: 'gte', value: 66 }, s)).toBe(false);
    expect(evalCondition({ kind: 'avgDayMood', op: 'gte', value: 42 }, s)).toBe(true);
  });

  it('二周目计数可判定', () => {
    const s = createState(cfg);
    expect(s.playthroughs).toBe(0);
    expect(evalCondition({ kind: 'playthroughs', op: 'gte', value: 2 }, s)).toBe(false);
    s.playthroughs = 2;
    expect(evalCondition({ kind: 'playthroughs', op: 'gte', value: 2 }, s)).toBe(true);
  });

  it('图鉴分组：悄悄话单独成栏，默认栏排在最前', () => {
    const sections = groupCollectibles(
      [{ text: 'A' }, { text: 'B', group: 'whisper' }, { text: 'C' }, { text: 'D', group: 'whisper' }],
      { '': '云朵', whisper: '悄悄话' },
    );
    expect(sections.length).toBe(2);
    expect(sections[0].title).toBe('云朵');
    expect(sections[0].items).toEqual(['A', 'C']);
    expect(sections[1].title).toBe('悄悄话');
    expect(sections[1].items).toEqual(['B', 'D']);
  });
});
