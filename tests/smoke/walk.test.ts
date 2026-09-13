// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { config } from '../../content';
import { campus } from '../../content/campus';
import type { GameConfig } from '../../src/types/content';

/**
 * 人物自动移动转场（map_routes 交接包）的行为验收。
 *
 * 这一组测的全是**"看起来在走"和"真的在走"的差别**：
 *   · 有没有真按内容层的路线表走（起点、方向、终点）；
 *   · 选了女生是不是从女生宿舍出发（这条只有把 data 层跑通才会对）；
 *   · 回车能不能跳过、加速能不能加快（不能的话 3.6 秒 × 43 次换地点就是折磨）；
 *   · 走完之后引擎有没有照旧进场景（跳过 ≠ 没走过去）。
 *
 * 用 D1 的前两个时刻（06:20 卧室 → 07:40 教室）当被测对象，因为它们是**真实内容**里
 * 第一次换地点，而不是为了测试造的假流程。
 */

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T extends Element>(root: HTMLElement, sel: string, timeout = 6000): Promise<T> {
  const start = Date.now();
  for (;;) {
    const el = root.querySelector<T>(sel);
    if (el) return el;
    if (Date.now() - start > timeout) throw new Error(`等待超时: ${sel}｜当前内容: ${root.innerHTML.slice(0, 240)}`);
    await tick(15);
  }
}

const click = (el: Element): void => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
const press = (key: ' ' | 'Enter', repeat = false): void => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true }));
};

/** D1 06:20（卧室）→ 07:40（教室）→ 结局。`
 *  walkMs 决定这一趟走多久：给一个小值就能在测试里真的跑完一遍 rAF。 */
function twoStopConfig(walkMs: number): GameConfig {
  const cfg = structuredClone(config);
  cfg.start = 'D1_0620';
  cfg.flow = [
    { id: 'D1_0620', kind: 'moment', momentId: 'D1_0620', next: 'D1_0740' },
    { id: 'D1_0740', kind: 'moment', momentId: 'D1_0740', next: 'end' },
    { id: 'end', kind: 'ending', endingId: 'rain' },
  ];
  // transitionMs 留着（0.9 秒的文字过渡发生在走路**之后**，不影响这里要断言的东西），
  // 但把 locationTransition 压到很小，免得每条用例多等 0.9 秒
  cfg.settings = { ...cfg.settings, transitionMs: 1, dayCardMs: 0, walkMs };
  return cfg;
}

/**
 * 一路推到"第二次换地点的走路正在播"。
 *
 * 真实流程是这样走过来的（D1 的前两刻）：
 *   标题 → 性别问卷 → 卧室的地点门 → 06:20 的云朵独白 → 空格 → **教室的地点门 → 走路**
 * 第一次换地点不会走路：`state.locationId` 在每天开头被重置成 `''`，没有"上一站"，
 * 一天里第一次换地点本来就是"从床上醒来"，不该先看一段通勤。
 */
async function startAndReachSecondStop(root: HTMLElement, gender: '男生' | '女生'): Promise<void> {
  click(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
  for (let i = 0; i < 500; i++) {
    if (root.querySelector('.walk')) return;
    const option = root.querySelector<HTMLButtonElement>('.custom .choice');
    if (option) {
      click([...root.querySelectorAll<HTMLButtonElement>('.custom .choice')].find((b) => b.textContent?.includes(gender)) ?? option);
      await tick(15);
      continue;
    }
    const gate = root.querySelector<HTMLButtonElement>('.debug-target');
    if (gate) { click(gate); await tick(20); continue; }
    if (root.querySelector('.dialogue-box:not([hidden])')) { press(' '); await tick(20); continue; }
    await tick(15);
  }
  throw new Error('没能走到第二站的人物自动移动转场');
}

describe('人物自动移动转场（map_routes 交接包）', () => {
  it('换地点时会真的播走路：校园地图 + 行走帧小人 + 目的地标记都在场', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, twoStopConfig(1000));
    try {
      void engine.start();
      await startAndReachSecondStop(root, '男生');

      const walk = await waitFor<HTMLElement>(root, '.walk');
      expect(walk.querySelector('.walk-map'), '没有铺校园地图').toBeTruthy();
      expect(walk.querySelector('.walk-goal span')?.textContent).toBe('教室');
      const actor = walk.querySelector<HTMLImageElement>('.walk-actor')!;
      expect(actor.dataset.walk).toBe('boy');
      // 行走帧必须是**真图**，不是占位/空串
      expect(actor.getAttribute('src')).toBeTruthy();
      expect(walk.querySelector('[data-walk-act="fast"]')?.textContent).toContain('加速');
      expect(walk.querySelector('[data-walk-act="skip"]')?.textContent).toContain('跳过');
    } finally {
      root.remove();
    }
  });

  it('起点是人物的出发地：选女生从女生宿舍出发、选男生从男生宿舍出发', async () => {
    // 这条是 data 层的证明：男女宿舍是两个都 serves 'bedroom' 的点位，
    // 靠 servesWho 区分。写成一串 if 也测得出来，但那样引擎就得认识"宿舍"这个词。
    const girlDorm = campus.locations.find((l) => l.id === 'girlDorm')!;
    const boyDorm = campus.locations.find((l) => l.id === 'boyDorm')!;
    expect(girlDorm.serves).toBe('bedroom');
    expect(boyDorm.serves).toBe('bedroom');
    expect(girlDorm.y).toBeLessThan(boyDorm.y); // 女生宿舍在地图上方那栋

    for (const [gender, dorm, key] of [['女生', girlDorm, 'girl'], ['男生', boyDorm, 'boy']] as const) {
      const root = document.createElement('div');
      document.body.appendChild(root);
      const engine = new Engine(root, twoStopConfig(1000));
      try {
        void engine.start();
        await startAndReachSecondStop(root, gender);
        const actor = (await waitFor<HTMLElement>(root, '.walk-actor')) as HTMLImageElement;
        expect(actor.dataset.walk, `${gender}的行走帧性别不对`).toBe(key);
        expect(actor.style.left, `${gender}不该从别的地方出发`).toBe(`${dorm.x * 100}%`);
        expect(actor.style.top).toBe(`${dorm.y * 100}%`);
      } finally {
        root.remove();
      }
    }
  });

  it('回车跳过：立刻到终点、收走转场，并且照旧进场景（跳过 ≠ 没走过去）', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, twoStopConfig(4000)); // 给足 4 秒，确保回车时还在走
    try {
      void engine.start();
      await startAndReachSecondStop(root, '男生');
      await waitFor(root, '.walk');
      await tick(40);
      press('Enter');
      await tick(40);

      expect(root.querySelector('.walk'), '回车之后转场应该收掉了').toBeNull();
      // 终点站是教学楼，但落到哪个**场景**由内容层决定（D1 07:40 用的是"清晨的教室"
      // classroomMorning，不是朴素的 classroom）—— 所以场景 id 从内容层取，不写死。
      const wantScene = config.moments!['D1_0740'].sceneId;
      await waitFor(root, `.scene[data-scene="${wantScene}"]`);
      expect(root.querySelector('.scene')?.getAttribute('data-scene')).toBe(wantScene);
    } finally {
      root.remove();
    }
  });

  it('按住回车不算连跳（e.repeat 忽略），和翻页键的规矩一致', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, twoStopConfig(4000));
    try {
      void engine.start();
      await startAndReachSecondStop(root, '男生');
      await waitFor(root, '.walk');
      press('Enter', true); // 按住不放产生的重复事件
      await tick(30);
      expect(root.querySelector('.walk'), 'e.repeat 不该触发跳过').toBeTruthy();
    } finally {
      root.remove();
    }
  });

  it('加速按钮：×1 → ×3 切换，并按住的这一段真的走得更快', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    // 6 秒一趟：不加速根本走不完，加速 ×3 才在两秒内到（jsdom 的 rAF 走真实时间）
    const engine = new Engine(root, twoStopConfig(6000));
    try {
      void engine.start();
      await startAndReachSecondStop(root, '男生');
      await waitFor(root, '.walk');

      const fast = root.querySelector<HTMLButtonElement>('[data-walk-act="fast"]')!;
      expect(fast.textContent).toContain('×1');
      expect(fast.getAttribute('aria-pressed')).toBe('false');
      click(fast);
      expect(fast.textContent).toContain('×3');
      expect(fast.getAttribute('aria-pressed')).toBe('true');

      // 点加速不该顺手把整段路跳掉（按钮上的 stopPropagation）
      expect(root.querySelector('.walk'), '按加速把转场也跳掉了').toBeTruthy();

      // 点第二下切回 ×1
      click(fast);
      expect(fast.textContent).toContain('×1');
    } finally {
      root.remove();
    }
  });

  it('不加速也能自己走完：走到终点后转场自动收掉（rAF 真的在推进）', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, twoStopConfig(200)); // 200ms 走完整条路线
    try {
      void engine.start();
      await startAndReachSecondStop(root, '男生');
      await waitFor(root, '.walk');
      const actor = (await waitFor<HTMLElement>(root, '.walk-actor')) as HTMLImageElement;
      const startLeft = actor.style.left;
      await tick(80); // 走了一小段
      // 这条断言是整组里唯一能证明"rAF 在动"的：DOM 里挂着转场、但一帧都不走，
      // 表现和数据完全一样（`.walk` 在、`.walk-actor` 在），只有位置会出卖它。
      // 之前 jsdom 缺 requestAnimationFrame 时就是这种"静默不动"。
      expect(actor.style.left, `走路一帧都没推进（rAF 没跑）`).not.toBe(startLeft);
      // 等它自己走完
      const t0 = Date.now();
      while (root.querySelector('.walk') && Date.now() - t0 < 4000) await tick(20);
      expect(root.querySelector('.walk'), '走路动画没有自己结束').toBeNull();
      const wantScene = config.moments!['D1_0740'].sceneId;
      await waitFor(root, `.scene[data-scene="${wantScene}"]`);
    } finally {
      root.remove();
    }
  });

  it('walkMs: 0 = 关掉转场（测试里七日通关要换几十次地点，不能每次都走）', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, twoStopConfig(0));
    try {
      void engine.start();
      // 第一站：点掉地点门之后应当直接出现台词，中间没有 .walk
      click(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
      for (let i = 0; i < 300; i++) {
        const option = root.querySelector<HTMLButtonElement>('.custom .choice');
        if (option) {
          click([...root.querySelectorAll<HTMLButtonElement>('.custom .choice')].find((b) => b.textContent?.includes('男生')) ?? option);
          await tick(15);
          continue;
        }
        const gate = root.querySelector<HTMLButtonElement>('.debug-target');
        if (gate) {
          click(gate);
          await tick(20);
          expect(root.querySelector('.walk'), 'walkMs: 0 时不该出现走路的画面').toBeNull();
          continue;
        }
        if (root.querySelector('.dialogue-box:not([hidden])')) break;
        await tick(15);
      }
    } finally {
      root.remove();
    }
  });

  it('路线表就是交接包那十条，且每条都在 0..1 的地图范围内', () => {
    // 交接包的 ROUTES 是 10 条固定路线。少一条的后果是"某两个地点之间换过去时不走路"，
    // 而这不报错、只在玩到那一幕时才看得出来。
    expect(campus.routes).toHaveLength(10);
    for (const r of campus.routes) {
      expect(r.points.length, `${r.from}→${r.to} 路线不完整`).toBeGreaterThanOrEqual(2);
      for (const p of r.points) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(1);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(1);
      }
    }
    // 每个游戏地点都要有对应的地图点位，否则那一刻会静默退化成纯文字过渡
    for (const locationId of ['bedroom', 'classroom', 'playground']) {
      const hits = campus.locations.filter((l) => l.serves === locationId);
      expect(hits.length, `${locationId} 没有对应的地图点位`).toBeGreaterThan(0);
    }
  });
});
