import type { Engine } from '../core/engine';
import type { Effect } from '../types/content';
import { sleep } from '../core/util';

/**
 * 动画名 → 音效 id。
 *
 * 开发文档 §8.7 要求"拉链、糖果、时钟、拨云"这些有声音，但内容层（content/moments.ts）
 * 只写了动画名、没写 sound 效果。与其去改 43 个时刻的内容，不如在这里按动画名补音：
 * 内容只说"发生了什么动画"，声音由引擎按表配。这样以后 C 换动画名时，
 * noiseFor() 会 warn，不会悄悄变哑。
 */
const ANIM_SOUND: Record<string, string> = {
  zipMouth: 'zip',
  candyDrop: 'candy',
  clockRewind: 'clock',
  clearSky: 'clearSky',
  phoneBuzz: 'phone',
  // 刻意不出声的动画（不该硬塞音效）：捂耳朵是"世界安静"、暖光是纯视觉、台词淡出由 success 负责
  handCoverEars: '',
  warmGlow: '',
  lineDissolve: '',
  shake: '',
  zoomIn: '',
};

/** 动画对应的音效 id；返回 '' 表示这个动画刻意没声音 */
export function soundForAnim(name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(ANIM_SOUND, name) ? ANIM_SOUND[name] : undefined;
}

// 效果/演出执行：串行 await，保证演出节奏不乱。
export class EffectRunner {
  constructor(private readonly engine: Engine) {}

  async run(effects?: Effect[]): Promise<void> {
    if (!effects) return;
    for (const e of effects) {
      switch (e.kind) {
        case 'anim': {
          // 先看看这个动画有没有配套音效（没有就安静地放动画）
          const snd = soundForAnim(e.name);
          if (snd) this.engine.audio.play(snd);
          else if (snd === undefined) console.warn(`[anim] 动画 "${e.name}" 没有配到音效也没有登记为静音`);
          await this.engine.animation.run(e.target, e.name, e.params);
          break;
        }
        case 'sound': this.engine.audio.play(e.id); break;
        case 'wait': await sleep(e.ms); break;
        case 'sat': this.engine.ui.sceneEl.style.filter = `saturate(${1 + e.value / 100})`; break;
        case 'shake':
          this.engine.ui.sceneEl.classList.add('shake');
          await sleep(420);
          this.engine.ui.sceneEl.classList.remove('shake');
          break;
        case 'set': Object.assign(this.engine.state.flags, e.set); break;
      }
    }
  }
}
