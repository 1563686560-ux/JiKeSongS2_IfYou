import type { Engine } from '../core/engine';
import type { Choice, Interaction } from '../types/content';
import { esc } from '../core/util';

/**
 * 干预窗口的结果：
 *   `intervention` 玩家选了某个干预（花掉守护之光）
 *   `skip`         玩家主动点了「这次，就让它过去」（不花光、立刻继续）
 *   `timeout`      窗口自己走完，玩家没来得及 / 没管
 * 后两者在结算上完全一致（都记一次错过），分开只是为了日志、文案与调试能看出区别。
 */
export type InterventionPick =
  | { kind: 'intervention'; id: string }
  | { kind: 'skip' }
  | { kind: 'timeout' };

/**
 * 空格 / 回车在干预窗口里的"冷静期"。
 *
 * 窗口是在玩家按掉最后一句开场白之后**立刻**打开的，而那一按往往只是习惯性翻页 ——
 * 不应该被理解成"这一刻我不帮忙"。所以窗口刚开的前 0.7 秒里，键盘不算数，只有点击算数。
 * 0.7 秒对"想快点读过去"的玩家毫无影响，对"手还在空格上"的玩家是必要的保护。
 */
const SKIP_KEY_GRACE_MS = 700;

// 互动/选择 dock：点亮合法干预、校验守护之光、显示窗口倒计时、处理超时（miss 也是叙事）。
// 脚本给每个事件规定了窗口（D1 10s / D6 最后一夜 15s），倒计时条是玩家感知窗口的唯一反馈。
export class ChoiceSystem {
  constructor(private readonly engine: Engine) {}

  async runInteractions(interactions: Interaction[], timeoutSec: number): Promise<InterventionPick> {
    const dock = this.engine.ui.dockEl;
    dock.innerHTML = '';
    const openedAt = Date.now();
    return new Promise((resolve) => {
      let settled = false;
      let timer = 0;
      let bar: HTMLElement | null = null;
      const settle = (v: InterventionPick) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        bar?.remove();
        dock.innerHTML = '';   // 结算后立刻收掉按钮，避免残留可点但无反应的按钮
        this.engine.clearAdvanceHandler(skipByKey);
        resolve(v);
      };
      // 空格 / 回车在这里的含义也是"翻页"：这一刻不伸手，直接往下读 ——
      // 和点击那个按钮完全等价（见 engine.pressAdvance），所以只走同一个 settle。
      // 冷静期**只挡键盘，不挡点击**：点是明确的动作（鼠标移过去、按下），键盘不是 ——
      // 窗口是在玩家按掉最后一句开场白之后立刻打开的，那一按往往只是习惯性翻页。
      const skipByKey = () => {
        if (Date.now() - openedAt < SKIP_KEY_GRACE_MS) return;
        settle({ kind: 'skip' });
      };
      if (timeoutSec > 0) {
        bar = document.createElement('div');
        bar.className = 'countdown';
        bar.innerHTML = `<i style="animation-duration:${timeoutSec}s"></i>`;
        this.engine.ui.sceneEl.appendChild(bar);
        timer = window.setTimeout(() => settle({ kind: 'timeout' }), timeoutSec * 1000);
      }
      if (timeoutSec <= 0 && interactions.length === 0) { settle({ kind: 'timeout' }); return; }
      for (const it of interactions) {
        const affordable = this.engine.state.light >= it.cost;
        const btn = document.createElement('button');
        btn.className = 'choice';
        btn.disabled = !affordable;
        // 明确写出"守护之光"，不要只写"1 光"——会被误读成货币
        btn.innerHTML = `${esc(it.label)}<small>消耗守护之光 ✦${it.cost}</small>`;
        btn.onclick = () => { if (affordable) settle({ kind: 'intervention', id: it.id }); };
        dock.appendChild(btn);
      }
      // 那个"不伸手"的选项要有名字，而且要像个选择、不像个"跳过调试按钮"
      // （验收反馈原话是"加一个不帮助的选项，但不要叫这个名字"）。
      // 它永远可点（不消耗守护之光），作用就是**立刻继续** —— 不必等窗口走完，
      // 于是"这一周我就要一路读下去"的玩家不会在每一次 10 秒倒计时上干等。
      const passBtn = document.createElement('button');
      passBtn.className = 'choice pass';
      passBtn.innerHTML = `这次，就让它过去<small>不消耗守护之光 · 空格</small>`;
      passBtn.onclick = () => settle({ kind: 'skip' });
      dock.appendChild(passBtn);
      this.engine.setAdvanceHandler(skipByKey);
    });
  }

  async runChoices(choices: Choice[]): Promise<Choice> {
    const dock = this.engine.ui.dockEl;
    dock.innerHTML = '';
    // 分支选择**不是**翻页：这里显式撤掉翻页注册，让"空格/回车选不了"成为结构上的事实，
    // 而不是"恰好没有上一步残留的 handler"（残留时按空格会推进到下一句，玩家会以为选过了）。
    this.engine.setAdvanceHandler(null);
    return new Promise((resolve) => {
      for (const c of choices) {
        const btn = document.createElement('button');
        btn.className = 'choice';
        btn.textContent = c.label;
        btn.onclick = () => { dock.innerHTML = ''; resolve(c); };
        dock.appendChild(btn);
      }
    });
  }
}
