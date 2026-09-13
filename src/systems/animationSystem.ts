import type { Engine } from '../core/engine';
import { sleep, waitForAnimEnd } from '../core/util';

type AnimFn = (el: HTMLElement, params?: Record<string, unknown>) => Promise<void>;

// 动画注册表：C 起名字（Effect.anim.name），A 在这里挂实现。
// 下面是按脚本《干预演出》做的一批占位实现——C 出正式美术后逐个替换即可，名字不用改。
export class AnimationSystem {
  private readonly registry: Record<string, AnimFn> = {};

  constructor(private readonly engine: Engine) { this.seed(); }

  // 在目标元素上临时挂一层纯 CSS 演出，播完自动摘掉
  private overlay(cls: string, inner: string, ms: number): AnimFn {
    return async (el) => {
      const node = document.createElement('div');
      node.className = `anim-layer ${cls}`;
      node.innerHTML = inner;
      el.appendChild(node);
      await sleep(ms);
      node.remove();
    };
  }

  private seed(): void {
    // 台词淡出（从前叫 cloudDissolve —— 云朵容器删掉后它作用在底部对白框上）
    this.register('lineDissolve', async (el) => {
      el.classList.add('dissolve');
      await waitForAnimEnd(el, 700);
      el.classList.remove('dissolve');
    });
    this.register('shake', async (el, params) => {
      el.classList.add('shake');
      await sleep((params?.ms as number) ?? 420);
      el.classList.remove('shake');
    });

    // 镜头缓缓推近（脚本 D7 终章）。刻意保留终态，让镜头停在推近后。
    this.register('zoomIn', async (el, params) => {
      el.classList.add('zooming');
      await sleep((params?.ms as number) ?? 1600);
    });
    // 提前放晴：雨幕退去 + 降饱和恢复
    this.register('clearSky', async (el) => {
      el.classList.add('clearing');
      await sleep(1100);
      el.classList.remove('clearing');
    });

    // 5 种干预的占位演出（脚本第二章）
    this.register('handCoverEars', this.overlay('anim-hand', '<i></i><i></i>', 900));
    this.register('zipMouth', this.overlay('anim-zip', '<i></i>', 800));
    this.register('candyDrop', this.overlay('anim-candy', '<i></i>', 1000));
    this.register('clockRewind', this.overlay('anim-clock', '<i></i>', 1100));
    this.register('warmGlow', this.overlay('anim-glow', '', 1200));
    // D4「爸妈来电」的手机震动（脚本 §5.2 要求：手机震动、抱抱或拍拍肩）
    this.register('phoneBuzz', this.overlay('anim-phone', '<i></i>', 700));
  }

  register(name: string, fn: AnimFn): void { this.registry[name] = fn; }

  async run(target: string, name: string, params?: Record<string, unknown>): Promise<void> {
    const el = this.resolve(target);
    if (!el) return;
    const fn = this.registry[name];
    if (!fn) { console.warn(`[anim] 未注册的动画 "${name}"`); return; }
    await fn(el, params);
  }

  private resolve(target: string): HTMLElement | null {
    const { ui } = this.engine;
    // 'box' = 底部对白框（从前叫 'cloud'，云朵容器删掉之后它就是这个）
    if (target === 'box') return ui.dialogueBoxEl;
    if (target === 'scene') return ui.sceneEl;
    if (target === 'signal') return ui.signalLayer;
    return ui.root.querySelector(target);
  }
}
