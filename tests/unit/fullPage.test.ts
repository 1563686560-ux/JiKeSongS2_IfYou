// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { config } from '../../content';
import { UiSystem } from '../../src/systems/uiSystem';
import type { GameConfig } from '../../src/types/content';

/**
 * 首页与尾页（**全屏页**）的结构与离场验收。
 *
 * 背景：这两页在 2026-09 从"舞台里的一页"改成"铺满视口的整页"（标题页交接包
 * title-screen-handoff）。改动的风险不在样式，而在**挂载点**：
 *   · 标题页原来画在 `.content` 里，而 `.content` 会被下一次渲染整个替换掉 —— 于是它
 *     "自己会消失"，从来不需要谁去清理；
 *   · 现在是挂在 `.game` 下的 fixed 层（和 `.ending` 同一类），`.game` 是**常驻**的，
 *     没有任何东西会替它清理。漏掉离场那一句，玩家点完「开始守护」之后就会顶着一整页
 *     天空玩到底 —— 而且 jsdom 不算布局，它也不会以任何别的方式报错。
 * 所以这里逐条按"挂在哪、带哪档心情、点完还在不在"来测。
 *
 * 样式侧（fixed / inset:0 / 层级 / 两档心情都有前景色）由 tests/unit/css.test.ts 守。
 */

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T extends Element>(root: HTMLElement, sel: string, timeout = 8000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const el = root.querySelector<T>(sel);
    if (el) return el;
    if (Date.now() - start > timeout) throw new Error(`等待超时: ${sel}｜当前内容: ${root.innerHTML.slice(0, 300)}`);
    await tick(15);
  }
}

const fire = (el: Element): void => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };

/** 内容层交给全屏页的两张天空底图（测试里直接用假路径，验的是"id → URL 有没有被写进去"） */
const SKY_BG = { dim: '/art/title.bg.dim.webp', gentle: '/art/title.bg.gentle.webp' };

function mount(): HTMLElement {
  const root = document.createElement('div');
  document.body.appendChild(root);
  return root;
}

/**
 * 只跑一个结局的最小配置：不进任何时刻，用来验尾页本身。
 * 开局问卷留着（性别决定立绘），记忆回响关掉 —— 这一组测的是结局页，不是终章。
 */
function endingOnlyConfig(endingId: string, sky?: 'dim' | 'gentle'): GameConfig {
  const cfg = structuredClone(config);
  cfg.start = 'end';
  cfg.flow = [{ id: 'end', kind: 'ending', endingId }];
  cfg.settings = { ...cfg.settings, transitionMs: 0, dayCardMs: 0, walkMs: 0, memoryEcho: [] };
  cfg.endings = cfg.endings.map((e) => (e.id === endingId ? { ...e, sky } : e));
  return cfg;
}

/** 从标题页点到结局页出现（答问卷 → 把结局前那几句按完） */
async function runToEnding(root: HTMLElement, engine: Engine): Promise<void> {
  void engine.start();
  fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
  for (let i = 0; i < 200; i++) {
    if (root.querySelector('.ending')) return;
    const option = root.querySelector<HTMLButtonElement>('.custom .choice');
    if (option) { fire(option); await tick(15); continue; }
    const box = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
    if (box) { fire(box); await tick(15); continue; }
    await tick(20);
  }
  throw new Error(`没有走到结局页：${root.innerHTML.slice(0, 300)}`);
}

describe('全屏页：首页', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('挂在 .game 上（不再画在舞台内容区里），心情与底图按参数走', async () => {
    const root = mount();
    const ui = new UiSystem(root);
    void ui.title(3, false, SKY_BG);
    const el = await waitFor<HTMLElement>(root, '.title-screen');

    expect(el.parentElement?.className, '标题页必须挂在常驻的 .game 上').toBe('game');
    expect(root.querySelector('.content .title-screen'), '标题页不该再画在舞台内容区里').toBeNull();
    expect(el.dataset.mood, '没有存档 → 开场那片压着雨云的天').toBe('dim');
    expect(el.style.getPropertyValue('--page-bg')).toBe(`url('${SKY_BG.dim}')`);
    expect(el.querySelector('h1')?.textContent, '标题文案').toBe('如果有你');
    expect(el.querySelectorAll('.btn-text').length, '没有存档时只有「开始守护 / 云朵图鉴」').toBe(2);
  });

  it('有存档时换成晒得暖的那张天，并多一个「继续守护」', async () => {
    const root = mount();
    const ui = new UiSystem(root);
    void ui.title(9, true, SKY_BG);
    const el = await waitFor<HTMLElement>(root, '.title-screen');

    expect(el.dataset.mood).toBe('gentle');
    expect(el.style.getPropertyValue('--page-bg')).toBe(`url('${SKY_BG.gentle}')`);
    expect(el.querySelectorAll('.btn-text').length).toBe(3);
    expect(el.querySelector('[data-act="resume"]')).toBeTruthy();
  });

  it('内容层没登记底图时**不写** --page-bg（写空串会让 var() 的兜底失效，整页变成没背景）', async () => {
    const root = mount();
    const ui = new UiSystem(root);
    void ui.title(0, false, {});
    const el = await waitFor<HTMLElement>(root, '.title-screen');

    expect(el.getAttribute('style') ?? '', '没图时不该留下 --page-bg').not.toContain('--page-bg');
  });

  it('点「开始守护」之后这一层必须被摘掉（挂在 .game 上没有别人会替它清理）', async () => {
    const root = mount();
    const engine = new Engine(root, endingOnlyConfig('rain'));
    void engine.start();
    fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));

    expect(root.querySelector('.title-screen'), '全屏层留在了场上，会盖住整局游戏').toBeNull();
    // 而且真的往下走了：开局问卷出现（本作只剩"那时候的TA，是——"一题）
    await waitFor(root, '.custom .choice');
  });

  it('结局页 → 回到标题：标题页会重新挂上（并且是干净的一份，不是残留的那份）', async () => {
    const root = mount();
    const engine = new Engine(root, endingOnlyConfig('rain'));
    await runToEnding(root, engine);

    fire(await waitFor<HTMLButtonElement>(root, '[data-title]'));
    const el = await waitFor<HTMLElement>(root, '.title-screen');
    expect(root.querySelectorAll('.title-screen').length, '标题页只能有一份').toBe(1);
    expect(root.querySelector('.ending'), '回到标题时结局浮层必须被摘掉（goTitle 里那句 remove）').toBeNull();
    expect(el.querySelector('[data-act="resume"]'), '已经走过一周目了 → 该给「继续守护」').toBeTruthy();
  });
});

describe('全屏页：尾页', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('结局页挂在 .game 上，带上结局自己声明的那片天', async () => {
    const root = mount();
    await runToEnding(root, new Engine(root, endingOnlyConfig('sunny')));
    const el = await waitFor<HTMLElement>(root, '.ending');

    expect(el.parentElement?.className).toBe('game');
    expect(el.dataset.mood, '晴空写在内容层的 sky 上').toBe('gentle');
    expect(el.style.getPropertyValue('--page-bg')).toContain('title.bg.gentle');
    expect(el.querySelector('.ending-card h1')?.textContent, '结局名').toBe('晴空');
    // 真浏览器验收（tests/browser/smoke.mjs）点名的三个锚点，在这里也顺手守住
    expect(el.querySelector('.ending-stats .stars')).toBeTruthy();
    expect(el.querySelector('.bottle input')).toBeTruthy();
    expect(el.querySelector('[data-restart]') && el.querySelector('[data-gallery]') && el.querySelector('[data-title]')).toBeTruthy();
  });

  it('内容层没写 sky 时按场景时相兜底：下雨的结局停在雨刚过的天（dim）', async () => {
    const root = mount();
    await runToEnding(root, new Engine(root, endingOnlyConfig('rain', undefined)));
    const el = await waitFor<HTMLElement>(root, '.ending');

    expect(el.dataset.mood).toBe('dim');
    expect(el.style.getPropertyValue('--page-bg')).toContain('title.bg.dim');
  });

  it('内容层写了 sky 就以内容层为准（雨过也可以收在放晴的天上）', async () => {
    const root = mount();
    await runToEnding(root, new Engine(root, endingOnlyConfig('rain', 'gentle')));
    const el = await waitFor<HTMLElement>(root, '.ending');

    expect(el.dataset.mood).toBe('gentle');
  });
});
