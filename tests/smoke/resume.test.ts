// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { config } from '../../content';
import { momentOrder } from '../../content/moments';
import type { GameConfig } from '../../src/types/content';

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T extends Element>(root: HTMLElement, sel: string, timeout = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const el = root.querySelector<T>(sel);
    if (el) return el;
    if (Date.now() - start > timeout) throw new Error(`等待超时: ${sel}`);
    await tick(15);
  }
}

function fire(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

function fastConfig(): GameConfig {
  const cfg = structuredClone(config);
  cfg.settings = { ...cfg.settings, transitionMs: 0, dayCardMs: 0, walkMs: 0 };
  for (const m of Object.values(cfg.moments ?? {})) if (m.event) m.event.timeoutSec = 1;
  return cfg;
}

// 推进到指定时刻为止（含该时刻）
async function advanceUntil(root: HTMLElement, engine: Engine, stopMomentId: string): Promise<void> {
  for (let i = 0; i < 900; i++) {
    if (engine.state.onceKeys.includes(stopMomentId) && engine.state.currentMomentId === stopMomentId) return;
    if (root.querySelector('.ending')) return;

    const box = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
    if (box) { fire(box); await tick(10); continue; }
    const cloud = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
    if (cloud) { fire(cloud); await tick(10); continue; }
    const gate = root.querySelector<HTMLButtonElement>('.debug-target');
    if (gate) { fire(gate); await tick(10); continue; }
    const dock = root.querySelector<HTMLButtonElement>('.dock .choice:not(:disabled)');
    if (dock) { fire(dock); await tick(10); continue; }
    const custom = root.querySelector<HTMLButtonElement>('.custom .choice:not([disabled])');
    if (custom) { fire(custom); await tick(10); continue; }
    const slider = root.querySelector<HTMLInputElement>('input.slider');
    if (slider) { fire(root.querySelector<HTMLButtonElement>('[data-confirm]')!); await tick(10); continue; }
    const color = root.querySelector<HTMLButtonElement>('.color-choice');
    if (color) { fire(color); await tick(10); continue; }
    await tick(20);
  }
  throw new Error(`没能推进到 ${stopMomentId}`);
}

describe('存档与刷新恢复（开发文档硬验收）', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('走到第 2 天后刷新，能从存档恢复天/时刻，且不复播已完成时刻', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, fastConfig());
    void engine.start();
    fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));

    // 一直走到第 2 天第一个时刻
    await advanceUntil(root, engine, 'D2_0620');
    expect(engine.state.day).toBe(2);
    // 存档只在时刻结算后写入：正在进行的 D2_0620 还没落盘，刷新后应当重播它
    const persisted = JSON.parse(localStorage.getItem('jks2.save')!) as { nodeId: string; onceKeys: string[]; day: number };
    expect(persisted.day).toBe(2);
    expect(persisted.onceKeys).toEqual(momentOrder.slice(0, 9));   // D1 的 9 个时刻
    expect(persisted.nodeId).toBe('day-2');   // 日节点已是新的检查点

    // 模拟刷新：同样的 localStorage，新建引擎
    document.body.innerHTML = '';
    const root2 = document.createElement('div');
    document.body.appendChild(root2);
    const engine2 = new Engine(root2, fastConfig());
    void engine2.start();

    // 有进度 → 标题页给「继续守护」
    const resume = await waitFor<HTMLButtonElement>(root2, '.title-screen [data-act="resume"]');
    fire(resume);

    // 恢复后：天、已落盘的 onceKey 与刷新前一致
    await tick(60);
    expect(engine2.state.day).toBe(2);
    expect(engine2.state.onceKeys).toEqual(persisted.onceKeys);
    // D1 的 onceKey 全部保留 → 刷新后不会复播已完成的时刻
    for (const id of momentOrder.slice(0, 9)) expect(engine2.state.onceKeys).toContain(id);
    expect(engine2.state.currentMomentId).toBe('D1_2320');   // 恢复到最后一个已完成时刻
    // 恢复后直接停在"第 2 天第一个目标地点"的选择入口上
    expect(root2.querySelector('.debug-target')).toBeTruthy();

    // 继续玩：还能推进到第 2 天后面的时刻
    await advanceUntil(root2, engine2, 'D2_0800');
    expect(engine2.state.day).toBe(2);
  }, 60000);

  it('D1–D7 每天开始时都会重新给出目标地点入口（不允许跳天）', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, fastConfig());
    void engine.start();
    fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));

    const seenDays: number[] = [];
    for (let i = 0; i < 1200; i++) {
      if (root.querySelector('.ending')) break;
      const gate = root.querySelector<HTMLButtonElement>('.debug-target');
      if (gate) {
        if (seenDays[seenDays.length - 1] !== engine.state.day) seenDays.push(engine.state.day);
        fire(gate);
        await tick(10);
        continue;
      }
      const box = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
      if (box) { fire(box); await tick(10); continue; }
      const cloud = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
      if (cloud) { fire(cloud); await tick(10); continue; }
      const dock = root.querySelector<HTMLButtonElement>('.dock .choice:not(:disabled)');
      if (dock) { fire(dock); await tick(10); continue; }
      const slider = root.querySelector<HTMLInputElement>('input.slider');
      if (slider) { fire(root.querySelector<HTMLButtonElement>('[data-confirm]')!); await tick(10); continue; }
      const custom = root.querySelector<HTMLButtonElement>('.custom .choice:not([disabled])');
      if (custom) { fire(custom); await tick(10); continue; }
      const color = root.querySelector<HTMLButtonElement>('.color-choice');
      if (color) { fire(color); await tick(10); continue; }
      await tick(20);
    }

    // 七天按顺序出现，没有跳天、没有回头
    expect(seenDays).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(engine.state.day).toBe(7);
    expect(root.querySelector('.ending')).toBeTruthy();
  }, 90000);
});
