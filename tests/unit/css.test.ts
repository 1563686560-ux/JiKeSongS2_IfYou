import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// 静态审计样式表：凡是"铺满内容层的装饰层"都必须 pointer-events:none。
// 这套断言就是为"有的点击不了"这类回归准备的 —— 已经踩过两次（.student-layer / .toast）。
// 注：.student-layer 已经不存在了（那层现画的 SVG 占位小人整个删掉了），
// 但这条铁律对其他装饰层依旧成立，所以列表照旧维护。

const raw = readFileSync(fileURLToPath(new URL('../../src/styles/base.css', import.meta.url)), 'utf8');

interface Rule { selectors: string[]; body: string }

function flatten(css: string): Rule[] {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.replace(/@keyframes[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  s = s.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
  const rules: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    rules.push({ selectors: m[1].split(',').map((x) => x.trim()).filter(Boolean), body: m[2] });
  }
  return rules;
}

const rules = flatten(raw);
const bodyOf = (sel: string) => rules.filter((r) => r.selectors.includes(sel)).map((r) => r.body).join(';');

describe('点击安全（全局样式审计）', () => {
  it('[hidden] 必须真的隐藏（对白框是靠它开关文字层的）', () => {
    expect(bodyOf('[hidden]')).toMatch(/display:\s*none/);
  });

  const DECORATIVE = [
    '.toast', '.day-card', '.anim-layer', '.signal-layer', '.dock',
    '.countdown', '.location-title', '.map-title',
    '.location-transition', '.scene-background', '.scene-overlay', '.debug-map',
    // D1 剧情插画铺满整个舞台，是"只是画面"的典型装饰层
    '.moment-cg', '.cg-backdrop',
    // 开局选项按钮里的插图：点击目标必须始终是外层按钮
    '.choice-art',
  ];

  it.each(DECORATIVE)('装饰层 %s 必须 pointer-events:none，否则会吃掉点击', (sel) => {
    expect(bodyOf(sel), `${sel} 缺少 pointer-events:none`).toMatch(/pointer-events:\s*none/);
  });

  const REENABLED = ['.choice', '.debug-target'];

  it.each(REENABLED)('可点元素 %s 在 disabled 容器内必须 pointer-events:auto 才能恢复可点', (sel) => {
    expect(bodyOf(sel), `${sel} 缺少 pointer-events:auto`).toMatch(/pointer-events:\s*auto/);
  });

  it('任何铺满内容层且有层级的浮层都必须 pointer-events:none（交互容器除外）', () => {
    // `.walk` 是人物自动移动转场：它铺满内容区**而且必须收点击** ——
    // 整块转场就是"跳过"的点击区（和游戏别处"点哪儿都能继续"一致），
    // 里面还住着「加速 ×N」与「回车跳过」两个按钮。所以它属于交互容器那一类。
    const INTERACTIVE_CONTAINERS = new Set(['.content', '.ending', '.custom', '.title-screen', '.gallery', '.walk']);
    const offenders = rules
      .filter((r) =>
        /inset:\s*0\b/.test(r.body)
        && /position:\s*(absolute|fixed)/.test(r.body)
        && /z-index/.test(r.body)
        && !/pointer-events:\s*none/.test(r.body)
        && !r.selectors.some((s) => INTERACTIVE_CONTAINERS.has(s)))
      .map((r) => r.selectors.join(', '));
    expect(offenders, `这些浮层会挡住点击：${offenders.join(' / ')}`).toEqual([]);
  });

  it('对白框必须可点（跳过 / 下一句），不能被设成 pointer-events:none', () => {
    expect(bodyOf('.dialogue-box')).not.toMatch(/pointer-events:\s*none/);
  });

  it('语气色只染对白框左边那条竖线，不是第二个文字容器', () => {
    // 脚本给每句标的「云朵（灰/白/金）」颜色保留下来了，但它只应该出现在 :before 那条竖线上。
    // 这条断言防的是"把云朵以另一种形式加回来"：框本体不许再按语气变色。
    for (const tone of ['dark', 'white', 'gold']) {
      const body = bodyOf(`.dialogue-box[data-tone="${tone}"]:before`);
      expect(body, `语气色 ${tone} 应当只改竖线颜色`).toMatch(/background:\s*#/);
      expect(body, `语气色 ${tone} 不该改框本体`).not.toMatch(/animation|position/);
    }
    expect(bodyOf('.dialogue-box[data-tone="dark"]'), '框本体不该被语气色染背景').not.toMatch(/background:\s*#555864/);
  });

  it('底部对白带必须可点，且立绘槽位不能吃掉点击', () => {
    expect(bodyOf('.dialogue-box')).not.toMatch(/pointer-events:\s*none/);
    // 立绘行住在演出带里，整层不吃点击（点击穿透到 .stage-bottom 那条"继续"的点击区）
    expect(bodyOf('.cast-layer')).toMatch(/pointer-events:\s*none/);
  });

  it('云朵容器已经删掉：样式表里不该再有它的规则', () => {
    // 2026-09 决定：全部文字走底部对白框。留着 `.cloud` 的样式比删掉更危险 ——
    // 它会被下一份内容或下一版 UI 当成"还有一个可用容器"。
    expect(rules.some((r) => r.selectors.some((s) => /(^|[ ,>])\.cloud\b/.test(s))), '样式表里还有 .cloud 规则').toBe(false);
  });

  it('地点入口的调试标签已经删掉：样式表里不该再有 .debug-badge 的规则', () => {
    // 2026-09 决定：卡片顶部那枚「开发调试入口 · 非正式玩法」胶囊标签从画面上删去。
    // 和 .cloud 同理 —— 留着规则会被下一版 UI 当成"还有一个该渲染的标签"。
    // 入口"是调试用的"这件事改由开发文档 §5.2 记录，并由此处的 DOM/真机断言守住行为。
    expect(rules.some((r) => r.selectors.some((s) => /(^|[ ,>])\.debug-badge\b/.test(s))), '样式表里还有 .debug-badge 规则').toBe(false);
  });

  it('所有文字都在界面下部：对白框不再是自己定位到某处的浮层', () => {
    // 从前云朵是 `position:absolute;top:14%`（舞台中上部），对白框是 `left:50%;bottom:20px`
    // 自己算位置 —— 两处各算各的，于是文字会飘到插画人物脸上去。
    // 现在它是 .stage-bottom 里的流内元素：文字在哪只由"底部演出带"一处决定。
    for (const sel of ['.dialogue-box', '.dock']) {
      expect(bodyOf(sel), `${sel} 不该自己绝对定位（文字位置应由 .stage-bottom 统一决定）`).not.toMatch(/position:\s*(absolute|fixed)/);
      expect(bodyOf(sel), `${sel} 不该自己写 top/bottom`).not.toMatch(/(^|;)\s*(top|bottom):/);
    }
    expect(bodyOf('.stage-bottom')).toMatch(/bottom:\s*0/);
  });

  it('立绘行：一个人物居中，两个人物分居左右（由 data-cast 驱动，不靠调用方传对 class）', () => {
    expect(bodyOf('.cast-layer')).toMatch(/justify-content:\s*center/);
    expect(bodyOf('.cast-layer[data-cast="2"]')).toMatch(/justify-content:\s*space-between/);
  });

  it('插画在场时不立立绘（画面里不该同时存在两套"这两个人"）', () => {
    expect(bodyOf('.scene.has-cg .cast-layer')).toMatch(/display:\s*none/);
  });

  /**
   * 占位小人删干净了没有。
   *
   * `components/student.ts` 那个通用 SVG 小人（连同 .student-layer / .student / .student-svg /
   * [data-pose=…] 一整组规则）是"人物图"的假替身：它不分性别、跟正式立绘毫无关系，
   * 而且**越缺图越会出现**（真图在场时它才让位）。删掉之后要守住两件事：
   * 样式表里不再留残骸（残骸会让后来的人以为它还在，也会让"删干净了没有"无法回答）。
   * DOM 里不会再出现占位人物，由 tests/unit/storyArt.test.ts 的槽位解析与真浏览器验收守。
   */
  it('样式表里不许再出现 .student（占位小人已整个删除）', () => {
    // 断言前先剥掉注释：注释里**必须**留着"这一组规则为什么被删"的记录，
    // 而规则本身不该再出现（用 flatten 已经剥过注释的那份源码来查）。
    const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(noComments, '样式表里还留着 .student / .student-layer / .student-svg 的规则')
      .not.toMatch(/\.student[\s.,:{[]/);
  });

  it('舞台撑满可用高度（不能只写 min-height：高窗口下文字会停在半屏处）', () => {
    const scene = bodyOf('.scene');
    expect(scene, '舞台要吃掉 100vh 减去页眉页脚，底部演出带才贴着界面下边缘').toMatch(/flex:\s*1/);
    expect(scene, '舞台仍要有最小高度兜底（矮窗口下不塌）').toMatch(/min-height:\s*620px/);
  });

  it('插画卡不超过交付图的原始高度（480×640，放大只会糊）', () => {
    expect(bodyOf('.cg-card')).toMatch(/max-height:\s*640px/);
  });

  // 下面这几条断言的是**开发文档 §5.1 / §9 给出的具体数值**，不是"谁比谁大"这种相对关系。
  // 之前只断言相对关系，于是 active 亮度 110%、inactive 完全不缩放（有效亮度 36%）也能全绿 ——
  // 测试绿不等于符合规格。
  function scaleOf(sel: string): number {
    const m = /scale\(([\d.]+)\)/.exec(bodyOf(sel));
    expect(m, `${sel} 没有 scale()`).toBeTruthy();
    return Number(m![1]);
  }
  function brightnessOf(sel: string): number {
    const m = /brightness\(([\d.]+)\)/.exec(bodyOf(sel));
    expect(m, `${sel} 没有 brightness()`).toBeTruthy();
    return Number(m![1]);
  }

  it('§5.1 当前说话者：缩放 1.08–1.15 且亮度 100%（不额外提亮）', () => {
    const scale = scaleOf('.portrait.active');
    expect(scale, `active 缩放 ${scale}，文档要求 1.08–1.15`).toBeGreaterThanOrEqual(1.08);
    expect(scale, `active 缩放 ${scale}，文档要求 1.08–1.15`).toBeLessThanOrEqual(1.15);
    expect(brightnessOf('.portrait.active'), '文档要求当前说话者亮度 100%').toBe(1);
  });

  it('§5.1 非当前说话者：缩放 0.82–0.92 且亮度约 55%', () => {
    const scale = scaleOf('.portrait.inactive');
    expect(scale, `inactive 缩放 ${scale}，文档要求 0.82–0.92`).toBeGreaterThanOrEqual(0.82);
    expect(scale, `inactive 缩放 ${scale}，文档要求 0.82–0.92`).toBeLessThanOrEqual(0.92);
    const b = brightnessOf('.portrait.inactive');
    expect(b, `inactive 亮度 ${b}，文档要求约 55%（0.5–0.6）`).toBeGreaterThanOrEqual(0.5);
    expect(b, `inactive 亮度 ${b}，文档要求约 55%（0.5–0.6）`).toBeLessThanOrEqual(0.6);
    // 不要再靠 opacity 表达"变暗"：那会让有效亮度低于 55%，而且和"淡出"是两件事
    expect(bodyOf('.portrait.inactive'), 'inactive 不该再用 opacity 叠一层变暗').not.toMatch(/opacity/);
  });

  it('§5.1 说话者切换动画 150–250ms', () => {
    const m = /transition:transform\s+([\d.]+)s/.exec(bodyOf('.portrait'));
    expect(m, '.portrait 没有 transform 过渡').toBeTruthy();
    const ms = Number(m![1]) * 1000;
    expect(ms, `切换动画 ${ms}ms，文档要求 150–250ms`).toBeGreaterThanOrEqual(150);
    expect(ms, `切换动画 ${ms}ms，文档要求 150–250ms`).toBeLessThanOrEqual(250);
  });

  it('§9 移动端安全区：底部演出带要算上 env(safe-area-inset-bottom)', () => {
    // 立绘行 / 台词 / 选项现在都住在 .stage-bottom 里（底部演出带的唯一入口），
    // 所以安全区只需要在**它**身上算一次 —— 从前是分别写在 .dock 与 .dialogue-box 上，
    // 两条 absolute 横栏各自留一次底部边距，叠在一起就是双份留白。
    expect(bodyOf('.stage-bottom'), '.stage-bottom 没有考虑 iPhone 手势条安全区').toMatch(/env\(safe-area-inset-bottom\)/);
    expect(bodyOf('.game'), '.game 没有考虑安全区内边距').toMatch(/env\(safe-area-inset-top\)/);
  });

  it('§9 尊重 prefers-reduced-motion，但倒计时条必须保留动画', () => {
    const m = /@media\(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/.exec(raw);
    expect(m, '样式表里没有 prefers-reduced-motion 分支').toBeTruthy();
    const block = m![1];
    expect(block, '减动效分支应该把动画时长压到接近 0').toMatch(/animation-duration:\.001ms/);
    // 倒计时条的时长是 JS 写的内联样式，这里的 !important 会盖过它，
    // 所以必须从选择器层面排除，而不是"先全关再写回来"。
    expect(block, '倒计时条必须从减动效规则里排除（它的时长是内联样式，会被 !important 盖掉）').toMatch(/:not\(\.countdown i\)/);
    expect(block, '推近镜头属于晕动触发源，减动效时应直接取消').toMatch(/\.scene\.zooming/);
  });

  it('§9 HUD 按钮要有足够的触摸面积', () => {
    expect(bodyOf('.hud-btn'), 'HUD 按钮缺少最小高度').toMatch(/min-height:\s*(3[2-9]|[4-9]\d)px/);
  });
});
