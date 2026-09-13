// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import type { GameConfig } from '../../src/types/content';

function waitFor(root: HTMLElement, selector: string, ms = 3000): Promise<HTMLElement> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const el = root.querySelector(selector);
      if (el) return resolve(el as HTMLElement);
      if (Date.now() - start > ms) return reject(new Error(`timeout waiting for ${selector}`));
      setTimeout(tick, 10);
    };
    tick();
  });
}

const minimal: GameConfig = {
  meta: { title: 't', version: '1.0.0' },
  assets: { images: {}, audio: {} },
  maps: { campus: { id: 'campus', baseWidth: 100, baseHeight: 100, locations: [{ id: 'room', label: '教室', hit: { x: 0, y: 0, w: 100, h: 100 }, target: 'd' }] } },
  scenes: { classroom: { id: 'classroom', name: '教室', theme: 'day' } },
  dilemmas: { ev: { id: 'ev', name: '困境', sceneId: 'classroom', signal: { kind: 'darkCloud' }, intro: [], interactions: [{ id: 'coverEars', label: '捂耳朵', cost: 1, outcome: { moodDelta: 12, bondDelta: 1 } }], next: 'end' } },
  endings: [{ id: 'e', name: '晴空', condition: { kind: 'always' }, scene: { id: 'classroom', name: '教室', theme: 'day' }, lines: [] }],
  flow: [{ id: 'map', kind: 'map', mapId: 'campus' }, { id: 'd', kind: 'dilemma', dilemmaId: 'ev' }, { id: 'end', kind: 'ending', endingId: 'e' }],
  start: 'map',
};

describe('Engine 冒烟测试', () => {
  beforeEach(() => { localStorage.clear(); });

  it('地图点击 → 困境 → 干预 → 结局 全流程', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, minimal);
    void engine.start();

    const startBtn = await waitFor(root, '[data-act="start"]');
    startBtn.dispatchEvent(new Event('click'));

    const hotspot = await waitFor(root, '.hotspot');
    expect(engine.state.mood).toBe(45);
    hotspot.dispatchEvent(new Event('click'));

    const choice = await waitFor(root, '.choice');
    expect(engine.state.light).toBe(2);
    choice.dispatchEvent(new Event('click'));

    const ending = await waitFor(root, '.ending');
    expect(ending).toBeTruthy();
    expect(engine.state.mood).toBe(57); // 45 + 12
    expect(engine.state.bond).toBe(1);
    expect(engine.state.light).toBe(1);
    expect(engine.state.logs.totalInterventions).toBe(1);
  });

  it('续玩：有进度时标题显示「继续守护」并从地图检查点恢复', async () => {
    localStorage.setItem('jks2.save', JSON.stringify({
      contentVersion: '1.0.0',
      nodeId: 'map',
      flags: { 'ev:done': true },
      mood: 60, light: 1, bond: 2,
      custom: {},
      moodHistory: [{ label: '困境', mood: 60 }],
      logs: { interventions: { coverEars: 1 }, totalInterventions: 1, missCount: 0, collected: [] },
    }));
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, minimal);
    void engine.start();

    const resumeBtn = await waitFor(root, '[data-act="resume"]');
    expect(resumeBtn).toBeTruthy();
    resumeBtn.dispatchEvent(new Event('click'));

    const hotspot = await waitFor(root, '.hotspot');
    expect(hotspot).toBeTruthy();
    expect(engine.state.light).toBe(1);
    expect(engine.state.mood).toBe(60);
  });

  it('日节点 + 随机节点 + 结局：可跑通', async () => {
    const capCfg: GameConfig = {
      meta: { title: 'cap', version: '1.0.0' },
      assets: { images: {}, audio: {} },
      maps: {},
      scenes: { s: { id: 's', name: '场景', theme: 'day' } },
      dilemmas: {},
      endings: [{ id: 'e', name: '结局', condition: { kind: 'always' }, scene: { id: 's', name: '场景', theme: 'day' }, lines: [] }],
      flow: [
        { id: 'day1', kind: 'day', day: 3, light: 3, title: '测试日', next: 'noInt' },
        { id: 'noInt', kind: 'dialogue', lines: [], outcome: { moodDelta: -7 }, next: 'r' },
        { id: 'r', kind: 'random', branches: [{ weight: 1, next: 'a' }, { weight: 1, next: 'b' }] },
        { id: 'a', kind: 'dialogue', lines: [], next: 'end' },
        { id: 'b', kind: 'dialogue', lines: [], next: 'end' },
        { id: 'end', kind: 'ending', endingId: 'e' },
      ],
      start: 'day1',
    };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, capCfg);
    void engine.start();

    const startBtn = await waitFor(root, '[data-act="start"]');
    startBtn.dispatchEvent(new Event('click'));

    const ending = await waitFor(root, '.ending');
    expect(ending).toBeTruthy();
    expect(engine.state.day).toBe(3);
    expect(engine.state.light).toBe(3);          // 每日守护之光由内容层 day 节点声明
    expect(engine.state.mood).toBe(38);          // 45 − 7：dialogue.outcome 生效
    expect(engine.state.moodHistory.length).toBeGreaterThan(0);
  });
});
