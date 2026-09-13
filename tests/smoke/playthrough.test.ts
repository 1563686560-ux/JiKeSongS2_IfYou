// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { config } from '../../content';
import { moments } from '../../content/moments';
import { ASSET_IDS } from '../../content/assets';
import type { GameConfig } from '../../src/types/content';

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

function fire(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

type Coverage = Record<string, number>;

// 把整局点到底：七日所有时刻都必须能推进到结局，不允许卡在任何一步
async function drive(root: HTMLElement, cov: Coverage, maxSteps = 900): Promise<void> {  for (let i = 0; i < maxSteps; i++) {
    if (root.querySelector('.ending')) return;

    const box = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
    if (box) { cov.box = (cov.box ?? 0) + 1; fire(box); await tick(15); continue; }

    const start = root.querySelector<HTMLButtonElement>('.title-screen [data-act="start"]');
    if (start) { cov.start = (cov.start ?? 0) + 1; fire(start); await tick(15); continue; }

    const back = root.querySelector<HTMLButtonElement>('[data-back]');
    if (back) { cov.back = (cov.back ?? 0) + 1; fire(back); await tick(15); continue; }

    const slider = root.querySelector<HTMLInputElement>('input.slider');
    if (slider) {
      cov.slider = (cov.slider ?? 0) + 1;
      // 滑杆用「默认值」确认，不改动它。
      // 默认作息 = 闹钟 05:50 / 熄灯 23:30 → 睡眠 380 分钟（6.3 小时）< 7.25 小时，
      // 于是 6 个「睡眠不足」事件都会触发，整局点击链路才能覆盖全部 43 个时刻。
      // 「改作息会改变这一周发生什么」由下面单独的睡眠规则测试负责（见 sleepGate）。
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      const confirm = root.querySelector<HTMLButtonElement>('[data-confirm]');
      if (confirm) { cov.confirm = (cov.confirm ?? 0) + 1; fire(confirm); await tick(15); continue; }
    }

    const color = root.querySelector<HTMLButtonElement>('.color-choice');
    if (color) { cov.colors = (cov.colors ?? 0) + 1; fire(color); await tick(15); continue; }

    const customOption = root.querySelector<HTMLButtonElement>('.custom .choice:not([disabled])');
    if (customOption) { cov.custom = (cov.custom ?? 0) + 1; fire(customOption); await tick(15); continue; }

    // 地点调试入口：只显示当前允许的目标
    const gate = root.querySelector<HTMLButtonElement>('.debug-target');
    if (gate) { cov.gate = (cov.gate ?? 0) + 1; expect(root.querySelectorAll('.debug-target').length).toBe(1); expect(root.querySelector('.debug-badge')).toBeNull(); fire(gate); await tick(15); continue; }

    const dockChoice = root.querySelector<HTMLButtonElement>('.dock .choice:not(:disabled)');
    if (dockChoice) {
      cov.dock = (cov.dock ?? 0) + 1;
      fire(dockChoice);
      await tick(15);
      // 结算后按钮必须立刻收掉，否则会留下"可点但没反应"的死按钮
      expect(root.querySelectorAll('.dock .choice').length).toBe(0);
      continue;
    }

    await tick(20);
  }
  throw new Error(`流程没有在 ${maxSteps} 步内结束（可能某个按钮点不动）：${JSON.stringify(cov)}`);
}

// 测试用：把事件窗口压缩到 1 秒、地点过渡关掉，避免拖长整局
function fastConfig(): GameConfig {
  const cfg = structuredClone(config);
  cfg.settings = { ...cfg.settings, transitionMs: 0, dayCardMs: 0, walkMs: 0 };
  for (const m of Object.values(cfg.moments ?? {})) if (m.event) m.event.timeoutSec = 1;
  return cfg;
}

describe('七日全局点击链路', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('从标题页点到结局页，D1→D7 全部时刻都能推进、流程不卡住', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const cfg = fastConfig();
    const engine = new Engine(root, cfg);
    void engine.start();

    const cov: Coverage = {};

    // 1) 标题页 → 云朵图鉴 → 返回（图鉴空态也要能进能出）
    fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="gallery"]'));
    await waitFor(root, '.gallery [data-back]');
    expect(root.querySelector('.gallery .empty')).toBeTruthy();
    fire(await waitFor<HTMLButtonElement>(root, '.gallery [data-back]'));
    await waitFor(root, '.title-screen [data-act="start"]');
    cov.titleGallery = 1;

    // 2) 开局问卷现在只有一题（那时候的TA，是——），滑杆/配色那几问已经删掉。
    //    这里顺带守住"删问题不能删数据"：作息变成固定默认值之后，
    //    sleepMinutes 仍然必须算出来，否则下面 43 个时刻会少掉 6 个（见下一个用例）。
    await drive(root, cov);
    expect(cov.custom, '开局只剩"性别"一题').toBe(1);
    expect((cov.slider ?? 0) + (cov.colors ?? 0), '作息/配色类问题应当已经删掉').toBe(0);
    expect(engine.state.custom, 'state.custom 里只该有玩家真的回答过的那一项').toEqual({ gender: expect.any(String) });
    expect(engine.state.flags.sleepMinutes, '作息变成默认值之后仍要派生出睡眠时长').toBe(380);

    // 3) 七日走完：最后一天必须是第 7 天，而且结局已出现
    expect(root.querySelector('.ending')).toBeTruthy();
    expect(engine.state.day).toBe(7);
    expect(engine.state.onceKeys.length).toBe(43);          // 43 个时刻各触发一次

    // 4) 地点调试入口每天都会出现，且至少覆盖三张地图
    const gateOpens = cov.gate ?? 0;
    expect(gateOpens).toBeGreaterThanOrEqual(7);

    // 4b) 文字一律走底部对白框（云朵容器已删除，所以这里只有一个文字计数器）
    expect(cov.box ?? 0).toBeGreaterThan(0);

    // 5) 结局页固定元素：星级 / 七日云朵 / 图鉴计数
    await waitFor(root, '.ending-card');
    expect(root.querySelector('.ending-stats .stars')).toBeTruthy();
    expect(engine.state.dayMoods.length).toBe(7);           // 七日云朵齐全

    // 6) 结局页 → 云朵图鉴 → 返回 → 标题页
    fire(await waitFor<HTMLButtonElement>(root, '[data-gallery]'));
    await waitFor(root, '.gallery');
    fire(await waitFor<HTMLButtonElement>(root, '.gallery [data-back]'));
    const titleAgain = await waitFor(root, '.title-screen');
    expect(titleAgain.querySelector('[data-act="start"]')).toBeTruthy();

    // 7) 再来一周目：点开始守护 → 回到定制
    fire(titleAgain.querySelector<HTMLButtonElement>('[data-act="start"]')!);
    await waitFor(root, '.custom');
  }, 90000);

  // 脚本《睡眠规则》：睡眠时长 < 7.25 小时才触发「睡眠不足」。
  // 这条门控从前是玩家在开局"作息两问"里填出来的；那两问删掉之后作息变成固定默认值，
  // 但**门控本身还在**（content/rules.ts 的 sleepShort）。所以这里改成从默认值的入口改作息，
  // 验证的仍然是同一件事：睡够了，那 6 个「睡眠不足」时刻就该真的不出现。
  it('睡眠门控仍然生效：睡够 7.25 小时就没有「睡眠不足」事件', async () => {
    async function playWithSleep(flags: Record<string, number>): Promise<number> {
      localStorage.clear();
      document.body.innerHTML = '';
      const root = document.createElement('div');
      document.body.appendChild(root);
      const cfg = fastConfig();
      cfg.settings = { ...cfg.settings, customDefaults: { flags } };
      const engine = new Engine(root, cfg);
      void engine.start();
      fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
      await drive(root, {});
      return engine.state.onceKeys.length;
    }

    // 睡够：闹钟 07:00（420）、熄灯 21:00（1260）→ 睡眠 600 分钟 = 10 小时 ≥ 7.25 小时
    const sleptEnough = await playWithSleep({ wakeValue: 420, lightsOutValue: 1260 });
    // 睡不够：闹钟 05:50（350）、熄灯 23:30（1410）→ 睡眠 380 分钟 = 6.3 小时 < 7.25 小时
    const sleptLittle = await playWithSleep({ wakeValue: 350, lightsOutValue: 1410 });

    expect(sleptEnough, '睡够的时候不该触发 6 个「睡眠不足」事件').toBe(43 - 6);
    expect(sleptLittle, '睡不够的时候 6 个「睡眠不足」事件都该触发').toBe(43);
    expect(sleptLittle - sleptEnough, '作息应当造成 6 个时刻的差异').toBe(6);
  }, 120000);

  it('地点调试入口一次只给一个目标，不能跳天跳节点，且画面上的调试标签已删除', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, fastConfig());
    void engine.start();
    fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));

    // 先答掉开局问卷（只剩"那时候的TA，是——"一题）
    for (let i = 0; i < 40 && !root.querySelector('.debug-target'); i++) {
      const opt = root.querySelector<HTMLButtonElement>('.custom .choice');
      if (opt) fire(opt);
      await tick(15);
    }

    const gate = await waitFor<HTMLButtonElement>(root, '.debug-target');
    expect(root.querySelectorAll('.debug-target').length).toBe(1);   // 只显示当前允许的目标
    expect(gate.textContent).toContain('前往');
    // 卡片顶部那枚「开发调试入口 · 非正式玩法」标签已按需求删除，且不该被谁加回来
    expect(root.querySelector('.debug-badge')).toBeNull();
    // 不能出现跳天/跳节点的自由入口
    expect(root.querySelectorAll('.hotspot').length).toBe(1);
    expect(engine.state.day).toBe(1);   // 上面只点了开局问卷，没点过调试入口，所以还停在第 1 天
  }, 30000);

  it('守护之光不足时按钮置灰，超时走 miss 分支（不算点不动）', async () => {
    const cfg = structuredClone(config);
    cfg.settings = { ...cfg.settings, initialLight: 0 };
    cfg.customization = [];
    cfg.start = 'D1_0810';
    cfg.flow = [
      { id: 'D1_0810', kind: 'moment', momentId: 'D1_0810', next: 'end' },
      { id: 'end', kind: 'ending', endingId: 'rain' },
    ];
    cfg.moments = { D1_0810: { ...moments['D1_0810'], event: { ...moments['D1_0810'].event!, timeoutSec: 1 } } };
    cfg.settings = { ...cfg.settings, transitionMs: 0, dayCardMs: 0, walkMs: 0 };

    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, cfg);
    void engine.start();

    fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));

    // 先点掉地点调试入口与开场台词，才会出现干预按钮
    const introDeadline = Date.now() + 5000;
    while (!root.querySelector('.dock .choice') && Date.now() < introDeadline) {
      const gate = root.querySelector<HTMLElement>('.debug-target');
      if (gate) fire(gate);
      const line = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
      if (line) fire(line);
      await tick(20);
    }

    // 光为 0 → 所有**干预**按钮置灰
    await waitFor(root, '.dock .choice');
    expect(root.querySelectorAll('.dock .choice:not(:disabled):not(.pass)').length).toBe(0);
    // 「这次，就让它过去」不是干预、不消耗守护之光，所以它永远可点 ——
    // 光为 0 的时候玩家仍然能立刻往下读，不必在每一次倒计时上干等
    const pass = root.querySelector<HTMLButtonElement>('.dock .pass');
    expect(pass, '没有"让这一刻过去"这个选项').toBeTruthy();
    expect(pass!.disabled, '它不是干预，不该被守护之光卡住').toBe(false);

    // 等窗口过去 → 记一次 miss
    const deadline = Date.now() + 4000;
    while (engine.state.logs.missCount === 0 && Date.now() < deadline) await tick(30);
    expect(engine.state.logs.missCount).toBe(1);
  }, 20000);
});

describe('美术资源替换合同', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('三张地图和立绘都有稳定 AssetId，替换 src 不改逻辑', () => {
    for (const id of [ASSET_IDS.bedroomBackground, ASSET_IDS.classroomBackground, ASSET_IDS.playgroundBackground, ASSET_IDS.playerPortrait, ASSET_IDS.npcPortrait, ASSET_IDS.endingCard]) {
      expect(config.assets.images[id], `缺少资源 ${id}`).toBeTruthy();
      expect(config.assets.images[id].layer).toBeTruthy();
    }
  });

  it('场景只引用 AssetId，背景资源缺失时不抛错', async () => {
    const cfg = structuredClone(config);
    cfg.assets = { images: {}, audio: {} };
    cfg.customization = [];
    cfg.start = 'D1_0620';
    cfg.flow = [
      { id: 'D1_0620', kind: 'moment', momentId: 'D1_0620', next: 'end' },
      { id: 'end', kind: 'ending', endingId: 'rain' },
    ];
    cfg.settings = { ...cfg.settings, transitionMs: 0, dayCardMs: 0, walkMs: 0 };
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, cfg);
    void engine.start();
    fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
    const gate = await waitFor<HTMLButtonElement>(root, '.debug-target');
    fire(gate);
    await waitFor(root, '.dialogue-box:not([hidden])');
    expect(engine.state.locationId).toBe('bedroom');
  }, 20000);
});
