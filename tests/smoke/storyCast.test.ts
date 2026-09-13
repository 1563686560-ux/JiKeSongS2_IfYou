// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Engine } from '../../src/core/engine';
import { config } from '../../content';
import { moments } from '../../content/moments';
import { deliveredAssetIds } from '../../content/assets';
import type { GameConfig } from '../../src/types/content';

/**
 * 立绘行 + 底部演出带 + D2 起的剧情图（三条来自验收反馈的硬要求）。
 *
 *   1) 开局只问"那时候的TA，是——"。**选了男生就只出现男生的图，选了女生就只出现女生的图**
 *      —— 男女主角素材绝不能混进同一屏（美术交付说明 §一.2）。
 *   2) 所有对话/文字（含选项）都在界面**下部**；场上一个人物就居中，两个就分居左右，
 *      谁说话谁亮起来。
 *   3) D2 之后的剧情图（`art.story.*`）同样按性别解析，并且**真透明抠图**要按抠图渲染
 *      （不画卡片描边），不能把人物抠图当照片贴在一个方块里。
 *
 * 这些错都是"看起来都对、其实错了"：前者错在某个角落漏了一张跨性别的图，
 * 后者错在文字浮回了画面中部（那条气泡正好压住插画人物的脸）。所以都按 DOM 实测。
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

function fire(el: Element): void {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

/** 只用某一个时刻起一局（跑完直接进结局），答掉开局问卷并点掉地点调试入口 */
async function openMoment(
  momentId: string,
  gender: '男生' | '女生',
  opts: { timeoutSec?: number; art?: 'keep' | 'strip' } = {},
): Promise<{ root: HTMLElement; engine: Engine }> {
  localStorage.clear();
  document.body.innerHTML = '';
  const root = document.createElement('div');
  document.body.appendChild(root);
  const cfg: GameConfig = structuredClone(config);
  cfg.settings = { ...cfg.settings, transitionMs: 0, dayCardMs: 0, walkMs: 0 };
  // 事件窗口默认设 0 = 不自动超时（不然 10 秒后自己走 miss 分支，断言会看到另一幕）。
  // 要测 miss 的用例自己传 1 秒。
  const m = moments[momentId];
  // 剧情插画默认**摘掉**：立绘行与底部演出带的结构跟"这一刻有没有插画"无关，而插画在场时
  // 立绘行本来就要让位（见 .scene.has-cg）。不摘的话，哪天给某刻补上插画，这些用例就会
  // 莫名其妙地失败 —— 而它们要测的根本不是那件事。测剧情图本身的用例显式传 art:'keep'。
  cfg.moments = {
    [momentId]: {
      ...m,
      art: opts.art === 'keep' ? m.art : undefined,
      event: m.event ? { ...m.event, timeoutSec: opts.timeoutSec ?? 0 } : undefined,
    },
  };
  cfg.flow = [
    { id: momentId, kind: 'moment', momentId, next: 'end' },
    { id: 'end', kind: 'ending', endingId: 'rain' },
  ];
  cfg.start = momentId;
  const engine = new Engine(root, cfg);
  void engine.start();

  fire(await waitFor<HTMLButtonElement>(root, '.title-screen [data-act="start"]'));
  const options = [...(await waitFor(root, '.custom-options')).querySelectorAll<HTMLButtonElement>('.choice')];
  const picked = options.find((b) => b.textContent?.includes(gender));
  expect(picked, `开局问卷里没有「${gender}」这个选项`).toBeTruthy();
  fire(picked!);
  fire(await waitFor<HTMLButtonElement>(root, '.debug-target'));
  await waitFor(root, '.scene[data-moment]');
  return { root, engine };
}

/** 屏幕上真正用到的 AssetId（立绘行与插画卡都标了 data-asset；没交图的槽位不会被画出来） */
function onScreenIds(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('[data-asset]')].map((el) => el.dataset.asset!);
}

describe('开局只问性别，且男女素材绝不混用', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('问卷只剩"那时候的TA，是——"一题，答完 state.custom 里只有 gender', async () => {
    const { root, engine } = await openMoment('D2_0620', '男生');
    expect(engine.state.custom).toEqual({ gender: '男生' });
    // 删问题不能删数据：作息变成默认值之后，睡眠时长仍要派生出那 6 个「睡眠不足」时刻的门控
    expect(engine.state.flags.sleepMinutes).toBe(380);
    expect(root.querySelectorAll('.custom').length).toBe(0);
  });

  it('选男生 → 男生的立绘；选女生 → 女生的立绘（同一时刻，两张图不同）', async () => {
    const boy = await openMoment('D2_0620', '男生');
    const boyFig = boy.root.querySelector<HTMLElement>('.cast-layer .portrait')!;
    expect(boyFig.dataset.asset).toBe('portrait.player.boy');
    expect(boyFig.querySelector('img')!.getAttribute('src')).toBe(config.assets.images['portrait.player.boy'].src);

    const girl = await openMoment('D2_0620', '女生');
    const girlFig = girl.root.querySelector<HTMLElement>('.cast-layer .portrait')!;
    expect(girlFig.dataset.asset).toBe('portrait.player.girl');

    // 两边都不能出现对方的素材
    expect(onScreenIds(boy.root).filter((id) => id.includes('.girl'))).toEqual([]);
    expect(onScreenIds(girl.root).filter((id) => id.includes('.boy'))).toEqual([]);
  });

  it('整段 D1（含插画 + 干预 + miss 收尾）里，女生的屏幕上不会出现任何男生素材', async () => {
    const { root, engine } = await openMoment('D1_0810', '女生', { timeoutSec: 1, art: 'keep' });

    // 先点掉事件的开场独白，才会进干预窗口（窗口期间画面上是"紧绷 + 老师"两张插画）
    const intro = await waitFor<HTMLElement>(root, '.dialogue-box:not([hidden])');
    fire(intro); await tick(20);
    fire(root.querySelector<HTMLElement>('.dialogue-box:not([hidden])') ?? intro);
    await waitFor(root, '.dock .choice');

    // 干预窗口画面上是两张并排插画（左=主角紧绷、右=老师严肃）—— 这就是"两个人分居左右"
    const during = onScreenIds(root);
    expect(during, '干预窗口应当是"主角紧绷 + 老师严肃"两张').toEqual(['art.d1.girl.strain', 'portrait.teacher.strict']);

    // 插画在场 → 立绘行让位（插画里本来就画着人，再立一份就是两个主角）
    expect(root.querySelector('.cast-layer')!.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.scene')!.classList.contains('has-cg')).toBe(true);

    // 窗口过去 → miss 收尾：女生没有 down 图，必须在**同性别内**回退到她的紧绷
    const deadline = Date.now() + 4000;
    while (engine.state.logs.missCount === 0 && Date.now() < deadline) await tick(30);
    expect(engine.state.logs.missCount).toBe(1);
    expect(onScreenIds(root).filter((id) => id.startsWith('art.d1.'))).toEqual(['art.d1.girl.tense']);

    // 全程没有出现过男生素材
    expect(onScreenIds(root).filter((id) => id.includes('.boy'))).toEqual([]);
  });

  it('未交付的 portrait.npc 不再上屏（没有第二个人时不该立一块占位图）', async () => {
    const { root } = await openMoment('D2_0620', '男生');   // 这一刻脚本里没有老师
    expect(deliveredAssetIds.includes('portrait.npc'), 'portrait.npc 现在应当是未交付状态').toBe(false);
    expect(onScreenIds(root)).not.toContain('portrait.npc');
    expect(root.querySelectorAll('.cast-layer .portrait').length).toBe(1);
  });
});

describe('D2–D3 剧情图（按性别解析 + 透明抠图渲染）', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('D2_0800「成绩单来了」：两张并排（主角在看成绩单 + 老师递出成绩单），主角那张按性别取图', async () => {
    const girl = await openMoment('D2_0800', '女生', { art: 'keep' });
    await waitFor(girl.root, '.moment-cg:not([hidden])');
    expect(onScreenIds(girl.root), '左=女生在看成绩单，右=老师递出成绩单')
      .toEqual(['art.story.girl.report', 'art.story.teacher.handout']);
    expect(girl.root.querySelector('.moment-cg')!.getAttribute('data-count')).toBe('2');

    const boy = await openMoment('D2_0800', '男生', { art: 'keep' });
    await waitFor(boy.root, '.moment-cg:not([hidden])');
    expect(onScreenIds(boy.root)).toEqual(['art.story.boy.report', 'art.story.teacher.handout']);
    // 两条路线都不许出现对方的图
    expect(onScreenIds(boy.root).filter((id) => id.includes('.girl'))).toEqual([]);
    expect(onScreenIds(girl.root).filter((id) => id.includes('.boy'))).toEqual([]);
  });

  it('D2_0800 的**干预窗口**也有画面：换成"同学聚拢围观"，且不许掉成空画面', async () => {
    // 这条是那个 bug 的现场复现：围观那张是 who:'common' 的图，早先被写成 S('crowd')，
    // 解析成 art.story.boy.crowd（不存在）→ 插画层被清空 → 干预全程只剩一间空教室，
    // 而画面上**没有任何东西会报错**。所以这里逐阶段断言"这一屏有人"。
    const { root } = await openMoment('D2_0800', '男生', { timeoutSec: 0, art: 'keep' });
    await waitFor(root, '.moment-cg:not([hidden])');
    expect(onScreenIds(root), '入场：成绩单 + 老师').toEqual(['art.story.boy.report', 'art.story.teacher.handout']);

    // 点掉开场台词 → 进干预窗口
    for (let i = 0; i < 30 && !root.querySelector('.dock .choice'); i++) {
      const line = root.querySelector<HTMLElement>('.dialogue-box:not([hidden])');
      if (line) fire(line);
      await tick(20);
    }
    await waitFor(root, '.dock .choice');
    expect(onScreenIds(root), '干预窗口：同学聚拢围观（不分性别那张）').toEqual(['art.story.common.crowd']);
    expect(root.querySelectorAll('.moment-cg:not([hidden]) .cg-card').length).toBe(1);
    // 场上必须有人：插画卡或立绘行，二者至少有一个 —— 这是"这一刻没有人图"的直接否证
    const figures = root.querySelectorAll('.moment-cg:not([hidden]) .cg-card, .cast-layer:not([hidden]) .portrait').length;
    expect(figures, '干预窗口里一个人物图都没有').toBeGreaterThan(0);
  });

  it('透明抠图走"贴在场景上"的渲染（data-alpha=1），带背景的整幅图仍是照片卡', async () => {
    // 女生的成绩单交付源是**真透明抠图**（57% 全透明像素），老师那张也是（72%）
    const girl = await openMoment('D2_0800', '女生', { art: 'keep' });
    await waitFor(girl.root, '.moment-cg:not([hidden])');
    expect(girl.root.querySelector('.moment-cg')!.getAttribute('data-alpha'), '两张都是抠图 → 整层不画模糊底').toBe('1');
    expect(girl.root.querySelector('.cg-card[data-asset="art.story.girl.report"]')!.getAttribute('data-alpha')).toBe('1');

    // 男生的成绩单是带背景的整幅图 → 不是"整层抠图"，卡片照常画
    const boy = await openMoment('D2_0800', '男生', { art: 'keep' });
    await waitFor(boy.root, '.moment-cg:not([hidden])');
    expect(boy.root.querySelector('.moment-cg')!.getAttribute('data-alpha')).toBe('0');
    expect(boy.root.querySelector('.cg-card[data-asset="art.story.boy.report"]')!.hasAttribute('data-alpha')).toBe(false);
  });

  it('D2_1240 食堂 / D3_0750 晨读：各自按性别取图，且 4:3 的图规格就是 640×480', async () => {
    for (const [momentId, shot] of [['D2_1240', 'canteen'], ['D3_0750', 'morningRead']] as const) {
      for (const [gender, who] of [['男生', 'boy'], ['女生', 'girl']] as const) {
        const { root } = await openMoment(momentId, gender, { art: 'keep' });
        await waitFor(root, '.moment-cg:not([hidden])');
        expect(onScreenIds(root), `${momentId} / ${gender}`).toEqual([`art.story.${who}.${shot}`]);
        expect(config.assets.images[`art.story.${who}.${shot}`].width, '交付规格').toBe(640);
        expect(config.assets.images[`art.story.${who}.${shot}`].height).toBe(480);
      }
    }
  }, 40000);   // 四局（两个时刻 × 两个性别），每局都要从标题页走到那一刻

  it('D3_1540「风」走操场空镜底图（不插 CG 卡），立绘行照常在场', async () => {
    const { root } = await openMoment('D3_1540', '男生', { art: 'keep' });
    expect(root.querySelector('.scene')!.getAttribute('data-scene')).toBe('playgroundWindy');
    expect(root.querySelector('.moment-cg')!.hasAttribute('hidden'), '空镜不该被塞进一张卡里').toBe(true);
    // 立绘行在（CG 不在场，所以人物图由立绘行承担）
    expect(root.querySelector('.cast-layer')!.hasAttribute('hidden')).toBe(false);
    // 底图用的就是那张风起云涌的操场
    const bg = root.querySelector<HTMLElement>('.scene-background')!.getAttribute('style') ?? '';
    expect(bg, '场景底图应当是 map.playground.windy').toContain('map.playground.windy');
  });
});

describe('立绘行与底部演出带', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

  it('场上一个人物 → 居中（data-cast=1）；没有第二个人时不会硬塞一个槽位', async () => {
    const { root } = await openMoment('D2_0620', '男生');
    const cast = root.querySelector<HTMLElement>('.cast-layer')!;
    expect(cast.dataset.cast).toBe('1');
    const figures = [...cast.querySelectorAll<HTMLElement>('.portrait')];
    expect(figures).toHaveLength(1);
    expect(figures[0].dataset.side).toBe('left');            // 主角永远在左槽
    expect(figures[0].classList.contains('active')).toBe(true);
    expect(figures[0].classList.contains('inactive')).toBe(false);
  });

  it('两个人物 → 分居左右，说话的亮、另一方暗；换说话者只切 class', async () => {
    // D2 10:20「拖堂说教」是老师的场面（npcPose: strict）—— 于是这一刻画面上是两个人。
    // 注意：脚本没有给 NPC 台词，所以老师不会"说话"；但立绘行与高亮机制必须成立，
    // 否则将来补一句老师台词时又得回头改引擎。
    const { root, engine } = await openMoment('D2_1020', '男生');
    await waitFor(root, '.dialogue-box:not([hidden])');

    const cast = root.querySelector<HTMLElement>('.cast-layer')!;
    expect(cast.dataset.cast).toBe('2', '两个人时应当分居左右（CSS 由 data-cast 驱动）');
    const left = cast.querySelector<HTMLElement>('.portrait-left')!;
    const right = cast.querySelector<HTMLElement>('.portrait-right')!;
    expect(left.dataset.asset).toBe('portrait.player.boy');
    expect(right.dataset.asset).toBe('portrait.teacher.strict');

    // 开场独白是主角的 → 主角亮、老师暗
    expect(left.classList.contains('active')).toBe(true);
    expect(right.classList.contains('inactive')).toBe(true);

    // 换说话者：老师亮、主角暗
    engine.setCastSpeaker('teacher');
    expect(left.classList.contains('inactive')).toBe(true);
    expect(right.classList.contains('active')).toBe(true);
    engine.setCastSpeaker('student');
    expect(left.classList.contains('active')).toBe(true);
  });

  it('所有文字（对白框 / 选项）都在底部演出带里，立绘在文字带之上，且画面上没有第二个文字容器', async () => {
    const { root } = await openMoment('D5_1000', '男生');
    const band = root.querySelector<HTMLElement>('.stage-bottom')!;
    const box = await waitFor<HTMLElement>(root, '.dialogue-box:not([hidden])');
    expect(band.contains(box)).toBe(true);
    expect(band.contains(root.querySelector('.dialogue-box')!)).toBe(true);
    expect(band.contains(root.querySelector('.dock')!)).toBe(true);
    // 云朵容器**已经不存在了**（2026-09 决定：全部文字走底部对白框）。
    // 这条断言是这次改动的守门人：谁再把第二个文字容器加回来，这里会立刻红。
    expect(root.querySelector('.cloud'), '云朵容器应当已经删除').toBeNull();
    // 立绘在文字带**上面**（同一个底部堆叠里更靠前的一项），不再挤在文字框内部
    expect(box.querySelector('.portrait')).toBeNull();
    const cast = root.querySelector('.cast-layer')!;
    expect(band.contains(cast)).toBe(true);
    expect(cast.compareDocumentPosition(box) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // 对白框里只有"说话者 + 台词"，没有立绘
    expect(box.querySelector('.box-speaker')?.textContent).toBe('TA');
    // 台词是逐字打出来的，这里等它打完（而不是断言"一出现就是整句"）
    const want = moments['D5_1000'].lines![0].text;
    const deadline = Date.now() + 4000;
    while (box.querySelector('.box-text')!.textContent !== want && Date.now() < deadline) await tick(30);
    expect(box.querySelector('.box-text')!.textContent).toBe(want);
  });

  it('整条演出带都是"继续下一句"的点击区（点到立绘也能推进）', async () => {
    const { root, engine } = await openMoment('D2_0620', '男生');   // 独白（从前走云朵，现在同样走对白框）
    const box = await waitFor<HTMLElement>(root, '.dialogue-box:not([hidden])');
    const line = moments['D2_0620'].lines![0].text;
    const cast = root.querySelector<HTMLElement>('.cast-layer')!;
    expect(cast.hasAttribute('hidden')).toBe(false);

    // 台词还在逐字打的时候点一下 = 跳过打字（整句立刻显示）
    await tick(40);
    fire(cast);
    expect(box.querySelector('.box-text')?.textContent, '点立绘应当和点对白框一样能把这一句打完').toBe(line);

    // 再点一下 = 下一句 / 结束这一幕（两次点击之间要留一拍：
    // 第一次点击只是让打字结束，等待点击的处理器是在那之后才挂上的）
    await tick(30);
    fire(cast);
    await tick(30);
    // 这里**不能**断言"文字框已收掉"：这一幕走完就进结局，而终章推近之后的「记忆回响」段
    // （D7 交付的黑屏背景）同样要显示文字，对白框会被回响的第一句重新点亮。
    // 所以断言的是"这一刻的台词已经不在屏幕上了 + 这一刻记为看过 + 立绘行收起"。
    const after = root.querySelector('.dialogue-box:not([hidden]) .box-text')?.textContent ?? '';
    expect(after, '这一刻的台词还留在屏幕上，说明没翻页').not.toBe(line);
    expect(cast.hasAttribute('hidden')).toBe(true);
    expect(engine.state.onceKeys).toContain('D2_0620');
  });
});
