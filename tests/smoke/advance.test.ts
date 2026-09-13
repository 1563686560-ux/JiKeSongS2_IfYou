// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { config } from '../../content';
import { moments } from '../../content/moments';
import type { GameConfig } from '../../src/types/content';

/**
 * 「怎么翻页」这一层的行为验收。
 *
 * 这一组全是**玩家感受得到、但代码不会报错**的东西：
 *   · 打字过程中按空格没反应 → 玩家会得出"空格键不能翻页"的结论（点击却能跳过打字）；
 *   · 干预窗口里按空格没反应 → 同一个结论，而且他把每一次倒计时都干等完了；
 *   · 「让这一刻过去」点下去不立刻继续 → 那个选项就白加了；
 *   · 点立绘不给摸头反馈 → 策划案 §3.4 的彩蛋交互没人发现得了。
 * 所以逐条按"操作 → 期望画面变化"来测，而不是测函数有没有被调用。
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

/** 真·键盘事件：走 window，和浏览器里按下去是同一条路径 */
const press = (key: ' ' | 'Enter', repeat = false): KeyboardEvent => {
  const e = new KeyboardEvent('keydown', { key, repeat, bubbles: true, cancelable: true });
  window.dispatchEvent(e);
  return e;
};

const click = (el: Element): void => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };

// 屏幕上唯一的文字容器就是底部对白框（云朵已删除）。文字在 .box-text 里，
// 框里还有一个 .box-speaker（"TA" / "对方"），所以读文字要直接取 .box-text。
const lineText = (root: HTMLElement): string =>
  root.querySelector('.dialogue-box:not([hidden]) .box-text')?.textContent ?? '';
const anyText = (root: HTMLElement): string => lineText(root);

/**
 * 只跑一个时刻的最小配置：日卡 / 地点过渡关掉，让"按一下会发生什么"成为这一刻唯一在动的东西。
 * 开局问卷照旧留着 —— 主角立绘是按性别取的，没有性别就没有立绘，摸头那两条用例也就无从谈起。
 */
function oneMomentConfig(momentId: string, opts: { timeoutSec?: number; light?: number } = {}): GameConfig {
  const cfg = structuredClone(config);
  cfg.start = momentId;
  cfg.flow = [
    { id: momentId, kind: 'moment', momentId, next: 'end' },
    { id: 'end', kind: 'ending', endingId: 'rain' },
  ];
  cfg.settings = { ...cfg.settings, transitionMs: 0, dayCardMs: 0, walkMs: 0, initialLight: opts.light ?? 3 };
  const m = cfg.moments?.[momentId];
  if (m?.event && opts.timeoutSec !== undefined) m.event = { ...m.event, timeoutSec: opts.timeoutSec };
  return cfg;
}

/**
 * 从标题页走到"这一刻已经在演"：
 * 答开局问卷 → 点地点调试入口（每天每个地点都要过这道门）→ 等到出现台词或干预按钮。
 */
async function runUpToStage(root: HTMLElement, gender = '男生'): Promise<void> {
  click(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
  for (let i = 0; i < 300; i++) {
    const option = root.querySelector<HTMLButtonElement>('.custom .choice');
    if (option) { click([...root.querySelectorAll<HTMLButtonElement>('.custom .choice')].find((b) => b.textContent?.includes(gender)) ?? option); await tick(15); continue; }
    const gate = root.querySelector<HTMLButtonElement>('.debug-target');
    if (gate) { click(gate); await tick(15); continue; }
    if (root.querySelector('.dialogue-box:not([hidden]), .dock .choice')) return;
    await tick(15);
  }
  throw new Error('没走到那一刻的画面');
}

/** 一路点到干预窗口出现（把开场白按完），返回窗口里的按钮 */
async function runToIntervention(root: HTMLElement): Promise<HTMLButtonElement[]> {
  for (let i = 0; i < 300; i++) {
    const buttons = [...root.querySelectorAll<HTMLButtonElement>('.dock .choice')];
    if (buttons.length) return buttons;
    const gate = root.querySelector<HTMLButtonElement>('.debug-target');
    if (gate) { click(gate); await tick(15); continue; }
    const text = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
    if (text) { click(text); await tick(15); continue; }
    await tick(15);
  }
  throw new Error('干预窗口没有出现');
}

async function boot(cfg: GameConfig, gender = '男生'): Promise<{ root: HTMLElement; engine: Engine }> {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const engine = new Engine(root, cfg);
  void engine.start();
  await runUpToStage(root, gender);
  return { root, engine };
}

describe('空格 / 回车翻页', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('打字过程中按一次空格就把整句显示完（不是只有点击能跳过打字）', async () => {
    const { root } = await boot(oneMomentConfig('D1_0620'));
    // 这一刻的台词是「……再睡五分钟，就好了。」
    const full = moments.D1_0620.lines[0].text;
    const typing = lineText(root);
    expect(typing.length, `按空格前应该还没打完（实际「${typing}」）`).toBeLessThan(full.length);
    press(' ');
    expect(lineText(root), '按一次空格应当把整句显示完').toBe(full);
  }, 20000);

  it('打字结束后按一次空格 / 回车都能翻页', async () => {
    const { root } = await boot(oneMomentConfig('D1_0620'));
    const full = moments.D1_0620.lines[0].text;
    press(' ');                                     // 先把打字跳完
    expect(lineText(root)).toBe(full);
    // 一次按键 = 一页。两次按键之间必须隔开：真实浏览器里两个 keydown 是两个任务，
    // 中间会跑微任务（"等下一句"的注册就在微任务里）；同步连发两下是在测一个不存在的时序。
    await tick(30);
    press('Enter');                                 // 再按一次 → 翻页（配置里 next 是结局，这一句会消失）
    for (let i = 0; i < 100 && anyText(root) === full; i++) await tick(20);
    expect(anyText(root), '回车也该能翻页，不只空格').not.toBe(full);
  }, 20000);

  it('按住不放（e.repeat）不算连翻：不会一路冲过一整幕', async () => {
    const { root } = await boot(oneMomentConfig('D1_0620'));
    press(' ');
    const line = lineText(root);
    for (let i = 0; i < 5; i++) press(' ', true);
    await tick(60);
    expect(lineText(root), '长按产生的 repeat 事件应当被忽略，仍停在这一句').toBe(line);
  }, 20000);

  it('焦点在输入框里时，空格是打字而不是翻页（结局页留言瓶）', async () => {
    const { root } = await boot(oneMomentConfig('D1_0620'));
    press(' ');
    const before = lineText(root);
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    press(' ');
    await tick(60);
    expect(lineText(root), '在输入框里按空格不该翻页').toBe(before);
  }, 20000);
});

describe('地点入口「前往 X」的键盘之路', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  /**
   * 走到"地点入口正开着"，但**不点它** —— 这一组测的就是不点会怎样。
   * 复用 boot() 不行：它见到入口就点掉了。
   */
  async function bootToGate(gender = '男生'): Promise<{ root: HTMLElement; engine: Engine }> {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const engine = new Engine(root, oneMomentConfig('D1_0620'));
    void engine.start();
    click(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
    for (let i = 0; i < 300; i++) {
      if (root.querySelector('.debug-target')) return { root, engine };
      const option = root.querySelector<HTMLButtonElement>('.custom .choice');
      if (option) {
        click([...root.querySelectorAll<HTMLButtonElement>('.custom .choice')].find((b) => b.textContent?.includes(gender)) ?? option);
        await tick(15);
        continue;
      }
      await tick(15);
    }
    throw new Error('地点入口没有出现');
  }

  it('按回车 = 点「前往 卧室」：入口收走，并真的走进这一刻', async () => {
    const { root } = await bootToGate();
    const gate = await waitFor<HTMLButtonElement>(root, '.debug-target');
    // 键盘能按的东西必须写在按钮上（和干预窗口那个「不消耗守护之光 · 空格」同一套规矩）
    expect(gate.textContent, '按钮上没写回车/空格，没人会去试').toContain('回车');
    expect(gate.textContent).toContain('前往');

    const e = press('Enter');
    expect(e.defaultPrevented, '空格/回车必须被 preventDefault，否则空格会滚页面').toBe(true);
    await waitFor(root, '.dialogue-box:not([hidden])');
    expect(root.querySelectorAll('.debug-target').length, '入口应当已经收走').toBe(0);
  }, 20000);

  it('按住回车的连发（e.repeat）不算：不能一路把地点门连点掉', async () => {
    const { root } = await bootToGate();
    press('Enter');
    await tick(60);
    // 这一刻已经在演，入口没了；此时续发的 repeat 事件不该再对入口做任何事
    expect(root.querySelectorAll('.debug-target').length).toBe(0);
    for (let i = 0; i < 5; i++) press('Enter', true);
    await tick(60);
    expect(root.querySelector('.dialogue-box:not([hidden])'), '页面还在正常演出').toBeTruthy();
  }, 20000);

  /**
   * 焦点已经落在入口按钮上时不抢按键：浏览器默认行为就是"按下这颗按钮"，
   * 抢过来会一次按键触发两件事（点掉入口 + 按到那颗按钮）。
   * 判据是**事件没有被 preventDefault** —— 让给浏览器处理。
   * （jsdom 不会替我们模拟"回车按下聚焦的按钮"这个默认行为，所以这里只断言"不抢"，
   *   真浏览器里 Tab + 回车的完整链路由 tests/browser/smoke.mjs 的 Enter 那一条守着。）
   */
  it('焦点在入口按钮上时不抢按键（键盘用户 Tab + 回车走浏览器原生那条路）', async () => {
    const { root } = await bootToGate();
    const gate = await waitFor<HTMLButtonElement>(root, '.debug-target');
    gate.focus();
    expect(document.activeElement, 'jsdom 里也没能把焦点放到按钮上').toBe(gate);
    const e = press('Enter');
    expect(e.defaultPrevented, '焦点在按钮上时不该抢回车').toBe(false);
    expect(root.querySelector('.debug-target'), '不该顺手把入口点掉').toBeTruthy();
    click(gate);                                  // 原生那条路等价于这一次点击
    await waitFor(root, '.dialogue-box:not([hidden])');
  }, 20000);

  it('入口还开着就「重新开始」：残留的键盘监听必须跟着走掉（否则下一轮的问卷会被它清空）', async () => {
    const { root, engine } = await bootToGate();
    engine.restart();                             // HUD 上的「重新开始」就是这一条
    await waitFor(root, '.custom-prompt');
    press('Enter');
    await tick(60);
    expect(root.querySelector('.custom-prompt'), '按回车把问卷清空了：上一条入口的键盘监听没解绑').toBeTruthy();
  }, 20000);
});

describe('干预窗口', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('多了一个「让这一刻过去」：点了立刻继续，不等窗口走完', async () => {
    // 窗口设成 30 秒：只要测试能在一秒内走到下一句，就证明它没有干等倒计时
    const { root } = await boot(oneMomentConfig('D1_0810', { timeoutSec: 30 }));
    const buttons = await runToIntervention(root);
    const pass = buttons.find((b) => b.classList.contains('pass'))!;
    expect(pass, '窗口里没有"让这一刻过去"这个选项').toBeTruthy();
    // 它必须有个像选择的名字，而且不能叫"不帮助"这种说明书口吻
    expect(pass.textContent).toContain('这次，就让它过去');
    expect(pass.textContent).not.toContain('不帮助');
    // 干预按钮会写明消耗守护之光；这个不会 —— 它是"不伸手"，所以不花光
    expect(pass.textContent).toContain('不消耗守护之光');
    expect(buttons.length, '干预按钮 + 这一个').toBeGreaterThan(1);

    const started = Date.now();
    click(pass);
    await waitFor(root, '.dialogue-box:not([hidden])');
    const elapsed = Date.now() - started;
    expect(elapsed, `点了"让这一刻过去"却等了 ${elapsed}ms`).toBeLessThan(1000);
    expect(root.querySelectorAll('.dock .choice').length).toBe(0);
    // 收尾台词是逐字打出来的，等它打完再比对（刚出现时只有一两个字）
    const expected = moments.D1_0810.event!.onTimeout!.feedback![0].text;
    for (let i = 0; i < 100 && lineText(root) !== expected; i++) await tick(20);
    expect(lineText(root), '走进了 onTimeout 的收尾台词').toBe(expected);
  }, 20000);

  it('点"让这一刻过去"= 没伸手：记一次错过、不花守护之光、不算干预成功', async () => {
    const { root, engine } = await boot(oneMomentConfig('D1_0810', { timeoutSec: 30 }));
    const lightBefore = engine.state.light;
    const pass = (await runToIntervention(root)).find((b) => b.classList.contains('pass'))!;
    click(pass);
    await waitFor(root, '.dialogue-box:not([hidden])');
    expect(engine.state.logs.missCount).toBe(1);
    expect(engine.state.logs.lastInterventionSuccess).toBe(false);
    expect(engine.state.light, '不伸手不该花掉守护之光').toBe(lightBefore);
    expect(engine.state.logs.totalInterventions).toBe(0);
  }, 20000);

  it('窗口刚打开的 0.7 秒里键盘不算数（刚按完最后一句的手还在空格上）', async () => {
    const { root, engine } = await boot(oneMomentConfig('D1_0810', { timeoutSec: 30 }));
    await runToIntervention(root);
    press(' ');                                      // 冷静期内的按键
    await tick(60);
    expect(root.querySelectorAll('.dock .choice').length, '冷静期内按空格不该把这一刻划过去').toBeGreaterThan(0);
    expect(engine.state.logs.missCount).toBe(0);
    await tick(720);                                 // 过了冷静期，空格才等于「让这一刻过去」
    press(' ');
    await waitFor(root, '.dialogue-box:not([hidden])');
    expect(engine.state.logs.missCount).toBe(1);
  }, 20000);

  it('鼠标点「捂耳朵」照旧是一次正常干预（新按钮没有抢走它）', async () => {
    const { root, engine } = await boot(oneMomentConfig('D1_0810', { timeoutSec: 30 }));
    const lightBefore = engine.state.light;
    const btn = (await runToIntervention(root)).find((b) => !b.classList.contains('pass'))!;
    click(btn);
    await waitFor(root, '.dialogue-box:not([hidden])');
    expect(engine.state.logs.totalInterventions).toBe(1);
    expect(engine.state.light).toBe(lightBefore - 1);
    expect(engine.state.logs.missCount).toBe(0);
  }, 20000);
});

describe('摸摸头（策划案 §3.4 的彩蛋交互）', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  // D5_0740 这一刻没有剧情插画（交付的是一张空镜底图），所以场上是立绘行 —— 摸头摸的就是它
  const NO_CG_MOMENT = 'D5_0740';

  it('点立绘 = 摸头：心情 +2 并飘一句，且这一次点击照样翻页', async () => {
    const { root, engine } = await boot(oneMomentConfig(NO_CG_MOMENT));
    const portrait = await waitFor<HTMLElement>(root, '.cast-layer:not([hidden]) .portrait');
    press(' ');                                       // 跳过打字，停在"等下一句"
    await tick(30);                                   // 让"等下一句"的注册跑完（见上一条用例的说明）
    const line = lineText(root);
    const moodBefore = engine.state.mood;

    click(portrait);
    expect(engine.state.mood, '点立绘应当摸到一下头（+2）').toBe(moodBefore + 2);
    // 看**最后一条**飘字：开局问卷的"都记下了。"还没消失，第一条不一定是我们这条
    const toasts = [...root.querySelectorAll('.toast')].map((t) => t.textContent ?? '');
    expect(toasts.at(-1), `飘字应该是摸头的反馈，实际 ${JSON.stringify(toasts)}`).toContain('安心');
    // "人和继续是同一个点击区"，所以这一下也把页面翻过去了 —— 不留死点击
    for (let i = 0; i < 60 && anyText(root) === line; i++) await tick(20);
    expect(anyText(root), '点立绘也该翻页，不能点了没反应').not.toBe(line);
  }, 20000);

  it('同一幕里只摸得到一次头（不是连点刷心情）', async () => {
    const { root, engine } = await boot(oneMomentConfig(NO_CG_MOMENT));
    const portrait = await waitFor<HTMLElement>(root, '.cast-layer:not([hidden]) .portrait');
    const petToasts = () => [...root.querySelectorAll('.toast')].filter((t) => (t.textContent ?? '').includes('安心')).length;
    click(portrait);
    const afterFirst = engine.state.mood;
    await tick(20);
    expect(petToasts(), '第一下应该摸到').toBe(1);
    expect(afterFirst).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) { click(portrait); await tick(15); }
    expect(petToasts(), '同一幕里连点不该反复摸到（这一下只该算一次）').toBe(1);
    // 后面的点击只是在翻页，心情最多再涨这一刻自己的结算值（不是每次 +2）
    expect(engine.state.mood, '连点不该按次数累加 +2').toBeLessThan(afterFirst + 2);
  }, 20000);
});

describe('占位人物图形已经删干净', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('画面上不再有 .student / .student-layer / SVG 小人，人物只可能是立绘或插画', async () => {
    const { root } = await boot(oneMomentConfig('D1_0810', { timeoutSec: 30 }));
    const dom = root.innerHTML;
    expect(dom, 'DOM 里还有占位小人的容器').not.toContain('student-layer');
    expect(dom).not.toContain('student-svg');
    expect(root.querySelectorAll('.student').length).toBe(0);
    // 场上有人的证据只能是正式立绘（data-asset 是 AssetId）
    const figures = [...root.querySelectorAll('.portrait, .cg-card')];
    expect(figures.length, '这一刻画面上既没有立绘也没有插画').toBeGreaterThan(0);
    for (const f of figures) {
      expect(f.getAttribute('data-asset'), '人物图必须标注 AssetId（便于验收对账）').toBeTruthy();
      const img = f.querySelector('img')!;
      expect(img.getAttribute('src') ?? '', `${f.getAttribute('data-asset')} 用的是空占位`).not.toBe('');
      expect(img.getAttribute('src') ?? '', '人物图不该退回占位 SVG').not.toContain('占位');
    }
  }, 20000);
});
