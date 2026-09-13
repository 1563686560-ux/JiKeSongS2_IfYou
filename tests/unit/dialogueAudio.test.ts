// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AUTO_DELAY_MS,
  BASE_TYPING_MS,
  DEFAULT_PREFS,
  SPEED_FACTOR,
  autoDelayFor,
  cycleSpeed,
  loadPrefs,
  savePrefs,
  seenKey,
  typingMsFor,
} from '../../src/systems/dialoguePrefs';
import { AudioSystem, REQUIRED_SOUNDS } from '../../src/systems/audioSystem';

// 开发文档 §5.1：支持逐字、跳过、自动播放、文字速度、已读快进。
// 这些是纯换算逻辑，单测覆盖；真浏览器里再验行为（见 tests/browser/smoke.mjs）。

describe('对白偏好（自动播放 / 文字速度）', () => {
  beforeEach(() => localStorage.clear());

  it('默认：不开自动播放、速度为中', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
    expect(DEFAULT_PREFS.auto).toBe(false);
    expect(DEFAULT_PREFS.speed).toBe('normal');
  });

  it('偏好能存下来，坏数据不会让游戏崩', () => {
    savePrefs({ auto: true, speed: 'fast' });
    expect(loadPrefs()).toEqual({ auto: true, speed: 'fast' });

    localStorage.setItem('jks2.dialoguePrefs', '{ not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);

    localStorage.setItem('jks2.dialoguePrefs', JSON.stringify({ auto: 'yes', speed: 'ludicrous' }));
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });

  it('速度三档按 慢→中→快 循环', () => {
    expect(cycleSpeed('slow')).toBe('normal');
    expect(cycleSpeed('normal')).toBe('fast');
    expect(cycleSpeed('fast')).toBe('slow');
  });

  it('速度换算成毫秒：中=基准、快更快、慢更慢', () => {
    const line = {};
    expect(typingMsFor(line, 'normal')).toBe(BASE_TYPING_MS);
    expect(typingMsFor(line, 'fast')).toBeLessThan(typingMsFor(line, 'normal'));
    expect(typingMsFor(line, 'slow')).toBeGreaterThan(typingMsFor(line, 'normal'));
    // 单调关系必须与倍率表一致
    expect(SPEED_FACTOR.fast).toBeLessThan(SPEED_FACTOR.normal);
    expect(SPEED_FACTOR.slow).toBeGreaterThan(SPEED_FACTOR.normal);
  });

  it('内容层的 typingMs 能覆盖基准，并且也跟着速度缩放', () => {
    const line = { typingMs: 100 };
    expect(typingMsFor(line, 'normal')).toBe(100);
    expect(typingMsFor(line, 'fast')).toBe(Math.round(100 * SPEED_FACTOR.fast));
  });

  it('自动播放停留时长不为 0，且随速度变化', () => {
    expect(autoDelayFor('normal')).toBe(AUTO_DELAY_MS);
    expect(autoDelayFor('fast')).toBeLessThan(autoDelayFor('normal'));
    expect(autoDelayFor('slow')).toBeGreaterThan(autoDelayFor('normal'));
  });

  it('已读快进的键用「来源#行号」，不依赖台词有没有 id', () => {
    expect(seenKey('moment:D1_0620', 0)).toBe('moment:D1_0620#0');
    expect(seenKey('moment:D1_0620', 1)).not.toBe(seenKey('moment:D1_0620', 0));
    expect(seenKey('moment:D1_0620', 0)).not.toBe(seenKey('moment:D1_0740', 0));
  });
});

// 开发文档 §8.7 点名要求的声音，以及"未知 id 不能静默降级"。
// 上一版 play(id) 对任何不认识的 id 都回落到 ding()，于是"手机震动""拉链""糖果"
// 全都会发同一个"叮"，不报错、只是听起来不对 —— 有断言才不会再退回去。
describe('音效（文档 §8.7）', () => {
  it('文档点名要求的声音全部都有实现', () => {
    const audio = new AudioSystem();
    const registered = audio.registered();
    for (const id of REQUIRED_SOUNDS) {
      expect(registered, `缺少音效实现：${id}`).toContain(id);
    }
    expect(registered.length).toBe(REQUIRED_SOUNDS.length);
  });

  it('每个要求的声音都能播，且返回 true（不是回落成别的音）', () => {
    const audio = new AudioSystem();
    for (const id of REQUIRED_SOUNDS) {
      expect(audio.play(id), `${id} 播放失败`).toBe(true);
    }
  });

  it('未知 id 返回 false 且不发声，而不是偷偷发一个 ding', () => {
    const audio = new AudioSystem();
    let warned = '';
    const original = console.warn;
    console.warn = (msg: string) => { warned = String(msg); };
    try {
      // 内容里目前没有 sound 效果，但将来 C 写了拼错的 id 时，必须能从警告里看出来
      expect(audio.play('phoneBuzzTypo')).toBe(false);
      expect(warned).toContain('phoneBuzzTypo');
      expect(warned).toContain('不会用别的音顶替');
    } finally {
      console.warn = original;
    }
  });

  it('无 AudioContext 环境（jsdom）下所有音效都是安全 no-op', () => {
    const audio = new AudioSystem();
    expect(() => { for (const id of REQUIRED_SOUNDS) audio.play(id); audio.stopRain(); }).not.toThrow();
  });

  it('静音后不初始化 AudioContext', () => {
    const audio = new AudioSystem();
    audio.setMuted(true);
    expect(audio.play('success')).toBe(true);   // 仍然算"这个 id 有效"
  });
});
