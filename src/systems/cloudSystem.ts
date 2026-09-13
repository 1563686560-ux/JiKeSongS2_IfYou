import type { Engine } from '../core/engine';
import type { Signal } from '../types/content';
import { esc } from '../core/util';

/**
 * 情绪信号可视化（与对话云朵解耦的两个组件之一）。
 *
 * ## 这里从前画的是 emoji
 *
 * 上一版这一行是：
 * ```
 * const SIGNAL_ICONS = { darkCloud:'🌧', grayCircle:'◌', redCross:'✗', sleepZzz:'💤', phoneWave:'📱', custom:'🌫' };
 * ```
 * 六个字符，靠 `.signal{font-size:52px}` 撑大小。也就是说画面上"乌云"其实是一颗 emoji ——
 * 全作最后一批**占位图案**。美工早在 `如果有你-场景-Day1/如果有你/03_signals/` 交了一整套
 * 水彩信号图，却从来没有 AssetId 把它们接进来。现在它们被导入成
 * `signal.cloud.dark / .gray / .white / .gold`、`signal.zzz`、`signal.redCross`、
 * `signal.isolation`、`signal.phone`、`signal.arrow`、`signal.exitHighlight`，
 * 另有 `vfx.goldenZipper` / `vfx.protectiveHand` 两个干预特效。
 *
 * ## 取图归内容层管
 *
 * `kind → AssetId` 的对应关系写在 `content/assets.ts` 的 `SIGNAL_ART` 里、由
 * `content/moments.ts` 填进 `Signal.asset`。这个类**不做任何 kind 判断**：有 `asset`
 * 就贴图、没有就什么都不画。这样"乌云长什么样"不会硬编码在引擎里，
 * 换一张交付图只要改内容层，不用动引擎。
 *
 * **缺图时什么都不画**（不回退成 emoji，也不立占位色块）：一块写着「情绪信号」的大色块
 * 盖在舞台正中，比"这一刻没有信号"糟得多 —— 这条和 `content/assets.ts` 里人物类的处理一致。
 */
export class CloudSystem {
  constructor(private readonly engine: Engine) {}

  showSignal(signal: Signal): void {
    const src = signal.asset ? this.engine.assets.url(signal.asset) : '';
    if (!src) {
      // 没给 asset（内容层没接线）或这张图还没交 —— 收走信号层，画面保持干净
      this.engine.ui.signalLayer.innerHTML = '';
      return;
    }
    this.engine.ui.signalLayer.innerHTML =
      `<div class="signal" data-kind="${esc(signal.kind)}" data-intensity="${signal.intensity ?? 1}">`
      + `<img class="signal-icon" alt="" src="${esc(src)}">`
      + '</div>';
  }

  dissolveSignal(): void {
    const el = this.engine.ui.signalLayer.querySelector('.signal');
    if (!el) return;
    el.classList.add('dissolve');
    setTimeout(() => { this.engine.ui.signalLayer.innerHTML = ''; }, 700);
  }

  setMood(): void {
    this.engine.ui.sceneEl.dataset.mood = this.engine.moodTier.cloud;
  }
}
