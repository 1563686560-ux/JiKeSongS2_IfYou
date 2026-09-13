import type { Engine } from '../core/engine';
import type { DialogueLine } from '../types/content';
import { interpolate } from '../core/util';
import {
  autoDelayFor,
  cycleSpeed,
  loadPrefs,
  savePrefs,
  seenKey,
  typingMsFor,
  type DialoguePrefs,
} from './dialoguePrefs';

// 只有一条语言通道：**底部对白框**（`.dialogue-box`）。
//
// 从前这里有两条（'cloud' / 'box'，对齐开发文档的表现分级）：L1 走底部对白框，
// L0 环境独白 / L2 事件反馈 / L3 终章走"云朵"气泡。脚本的舞台提示也一律写「云朵（灰/白/金）」。
// 现在云朵**整个删掉了**：所有文字都进底部对白框，说话者与语气色调都挂在框上。
// 为什么删（而不是两套并存）：
//   · 两套容器意味着"同一句话换个分级就换个样子"，观感不统一，验收时要分两次说清楚；
//   · 云朵是浮在画面下部的一块气泡，它的**尾巴**、圆角、位置都要为"指谁在说"单独调一遍，
//     而对白框里已经有 `.box-speaker` 在做这件事，属于同一个问题两个答案；
//   · 云朵的三种颜色（灰/白/金）本来就是**语气**，不是形状 —— 留下颜色、去掉形状即可。
// 台词支持 {变量} 模板，取自 state.custom（终章记忆回响用）。
//
// 文档 §5.1 / §8.4 要求的四种推进能力，这里的分工是：
//   逐字     → typeInto 的定时器
//   跳过当前句 → 打字过程中点一下（整个底部演出带都是点击区）
//   自动播放  → prefs.auto，打完字等 autoDelayFor() 自动翻页
//   已读快进  → 这句话在 state.logs.seenLines 里出现过就直接全显（不用再等打字）
export class DialogueSystem {
  prefs: DialoguePrefs = loadPrefs();

  constructor(private readonly engine: Engine) {}

  setAuto(auto: boolean): void {
    this.prefs = { ...this.prefs, auto };
    savePrefs(this.prefs);
  }

  toggleAuto(): boolean {
    this.setAuto(!this.prefs.auto);
    return this.prefs.auto;
  }

  cycleSpeed(): DialoguePrefs['speed'] {
    this.prefs = { ...this.prefs, speed: cycleSpeed(this.prefs.speed) };
    savePrefs(this.prefs);
    return this.prefs.speed;
  }

  async play(lines: DialogueLine[], trackKey?: string): Promise<void> {
    for (let i = 0; i < lines.length; i++) {
      const key = trackKey ? seenKey(trackKey, i) : '';
      const alreadySeen = key !== '' && this.engine.state.logs.seenLines?.includes(key) === true;
      await this.showInBox(lines[i], alreadySeen);
      if (key !== '' && !alreadySeen) {
        const seen = this.engine.state.logs.seenLines ?? (this.engine.state.logs.seenLines = []);
        seen.push(key);
      }
      await this.waitTap();
    }
    this.hide();
  }

  /**
   * 底部对白框只放"说话者 + 台词"两样东西。
   *
   * 人物图**不在这个框里**，而在它上面那一行（`.cast-layer`）—— 那样"一个人物居中、
   * 两个人物分居左右"由立绘行一处决定，台词多长都不会把人挤歪。谁说话谁亮起来这条规则
   * 也只是切 class（`setCastSpeaker`），数值写在 CSS 的 §5.1 注释里。
   *
   * `data-tone` = 这句的语气色调（灰/白/金），只用来染框左边那条竖线。
   * 缺省取当前心情档，和从前云朵缺省取心情色是同一个意思。
   */
  private async showInBox(line: DialogueLine, alreadySeen: boolean): Promise<void> {
    const box = this.engine.ui.dialogueBoxEl;
    const speaker = line.speaker ?? 'student';
    const isNpc = speaker !== 'student';
    box.hidden = false;
    box.dataset.speaker = speaker;
    box.dataset.tone = line.tone ?? this.engine.moodTier.cloud;
    // 立绘不在这个框里，而在它上面的 `.cast-layer`（一个人物居中 / 两个人物分居左右）。
    // 说话的亮起来、另一方压暗 —— 只切 class，数值由 CSS 的 §5.1 规则决定。
    this.engine.setCastSpeaker(speaker);
    box.innerHTML = `
      <span class="box-speaker">${isNpc ? '对方' : 'TA'}</span>
      <span class="box-text"></span>`;
    const text = box.querySelector<HTMLElement>('.box-text')!;
    // 整条底部演出带都是"跳过打字 / 下一句"的点击区（见 Engine.handleStageClick）
    await this.typeInto(text, line, alreadySeen);
  }

  /**
   * 逐字打出一句。
   *
   * 「跳过打字」现在注册在**引擎的翻页出口**上（`engine.setAdvanceHandler`），
   * 而不是只在某个元素上挂 onclick —— 点击（整条底部演出带）与键盘（空格 / 回车）
   * 因此走同一条路：从前只有点击能跳过打字，打字过程中按空格毫无反应，
   * 玩家读到的就是"空格键不翻页"。
   */
  private async typeInto(el: HTMLElement, line: DialogueLine, alreadySeen = false): Promise<void> {
    el.textContent = '';
    const text = interpolate(line.text, this.engine.state.custom);
    // 已读快进：看过的句子直接整句显示
    const ms = alreadySeen ? 0 : typingMsFor(line, this.prefs.speed);
    await new Promise<void>((resolve) => {
      let finished = false;
      let i = 0;
      let timer = 0;
      const finish = () => {
        if (finished) return;
        finished = true;
        window.clearTimeout(timer);
        el.textContent = text;
        this.engine.clearAdvanceHandler(finish);
        resolve();
      };
      const step = () => {
        if (finished) return;
        if (i >= text.length) { finished = true; this.engine.clearAdvanceHandler(finish); resolve(); return; }
        el.textContent += text[i++];
        this.engine.audio.ding();
        timer = window.setTimeout(step, ms);
      };
      // 打字中：翻页 = 把这一句整句显示完
      this.engine.setAdvanceHandler(finish);
      if (ms <= 0) finish();
      else timer = window.setTimeout(step, 0);
    });
    if (line.collectible && line.id && !this.engine.state.logs.collected.includes(line.id)) {
      this.engine.state.logs.collected.push(line.id);
    }
  }

  // 点击 / 空格 / 回车 / 触摸都能推进（开发文档 §7 明确要求键盘可推进）。
  // 开启自动播放时，还会在停留一段时间后自己翻页。
  // 与打字阶段共用同一个出口（engine.pressAdvance），所以"这一步怎么翻页"只有一处定义。
  private async waitTap(): Promise<void> {
    await new Promise<void>((resolve) => {
      let done = false;
      let autoTimer = 0;
      const finish = () => {
        if (done) return;
        done = true;
        window.clearTimeout(autoTimer);
        this.engine.clearAdvanceHandler(finish);
        resolve();
      };
      // 等下一句：翻页 = 翻到下一句 / 下一刻
      this.engine.setAdvanceHandler(finish);
      if (this.prefs.auto) autoTimer = window.setTimeout(finish, autoDelayFor(this.prefs.speed));
    });
  }

  hide(): void {
    const { ui } = this.engine;
    ui.dialogueBoxEl.hidden = true;
    ui.dialogueBoxEl.innerHTML = '';
    // 台词演完就撤掉"翻页"的注册：此刻按空格不该有任何事发生
    // （点击区是常驻在整条底部演出带上的，由 Engine 统一处理，这里不用管）
    this.engine.setAdvanceHandler(null);
  }
}
