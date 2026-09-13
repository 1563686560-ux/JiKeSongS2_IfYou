// Web Audio API 实时合成：零音频文件、无版权风险。
// 所有接口对环境安全：无 AudioContext 时静默 no-op（测试/无浏览器环境兼容）。
//
// 开发文档 §8.7 要求支持的声音（REQUIRED_SOUNDS 与之一一对应）：
//   脚步 / 地点环境 / 逐字提示 / 成功 / miss / 雨声 / 手机震动 / 拉链 / 糖果 / 时钟 / 拨云 / 终章和弦
//
// 设计约定：**未知 id 绝不静默降级**。
// 上一版 `play(id)` 对任何不认识的 id 都回落到 ding() —— 结果"手机震动""拉链""糖果"
// 全都会发同一个"叮"，不报错、只是听起来不对，很难被发现。现在改成：不认识就 warn + 不出声，
// 并且有单测断言注册表覆盖文档要求的那 12 个。
const PENTA = [523.25, 587.33, 659.25, 783.99, 880.0]; // C5 D5 E5 G5 A5 宫商角徵羽

/** 开发文档 §8.7 点名要求的声音。新增音效请同时加进这里，测试会核对。 */
export const REQUIRED_SOUNDS = [
  'step',      // 脚步（人物移动未实现，先把接口和音色备好）
  'ambient',   // 地点环境（换地点时的一声过渡）
  'ding',      // 逐字提示
  'success',   // 干预成功
  'miss',      // 干预错过（上一版漏了：miss 是完全没声音的）
  'rain',      // 雨声（循环）
  'phone',     // 手机震动
  'zip',       // 拉链
  'candy',     // 糖果
  'clock',     // 时钟
  'clearSky',  // 拨云
  'chord',     // 终章和弦
] as const;

export type SoundId = (typeof REQUIRED_SOUNDS)[number];

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private muted = false;
  private rainSrc: AudioBufferSourceNode | null = null;

  setMuted(muted: boolean): void { this.muted = muted; if (muted) this.stopRain(); }

  private ensure(): AudioContext | null {
    if (this.muted) return null;
    // 无浏览器环境（node 里跑单测）时直接静默返回 —— 类注释承诺了"环境安全"，
    // 这里必须真的挡住，否则会抛 ReferenceError: window is not defined。
    if (typeof window === 'undefined') return null;
    if (!this.ctx) {
      const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  // ── 合成原语 ──────────────────────────────────────────────────

  private tone(freq: number, dur = 0.08, gain = 0.06, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  /** 滑音：从一个频率滑到另一个（拨云、miss 用） */
  private sweep(from: number, to: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur);
  }

  /** 噪声爆发：过带通/低通，做脚步、拉链、糖果的质感 */
  private noise(dur: number, gain: number, filter: { type: BiquadFilterType; from: number; to?: number }, delay = 0): void {
    const ctx = this.ensure();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const bq = ctx.createBiquadFilter();
    bq.type = filter.type;
    bq.frequency.setValueAtTime(filter.from, t0);
    if (filter.to) bq.frequency.exponentialRampToValueAtTime(Math.max(1, filter.to), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bq);
    bq.connect(g);
    g.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + dur);
  }

  // ── 文档点名的 12 种声音 ───────────────────────────────────────

  /** 逐字提示：五声音阶里随机一个短音，避免机械重复 */
  ding(): void { this.tone(PENTA[Math.floor(Math.random() * PENTA.length)], 0.07, 0.045); }

  /** 干预成功：上行琶音 */
  success(): void {
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, 0.22, 0.045, 'sine', i * 0.07));
  }

  /** 干预错过：下行两音，轻、不刺耳（miss 也是叙事，不该像失败音效那样扎人） */
  miss(): void {
    this.sweep(311.13, 233.08, 0.42, 0.05, 'sine');
    this.sweep(233.08, 174.61, 0.5, 0.04, 'sine', 0.16);
  }

  /** 终章和弦：四音上行（比 success 更长更厚） */
  chord(): void {
    [261.63, 329.63, 392.0, 523.25].forEach((freq, i) => {
      setTimeout(() => this.tone(freq, 0.5, 0.05), i * 90);
    });
  }

  /** 地点环境：换地点时的一声轻过渡（先低后高的两音，像"到了"） */
  ambient(): void {
    this.tone(392.0, 0.16, 0.035, 'triangle');
    this.tone(587.33, 0.3, 0.03, 'triangle', 0.1);
  }

  /** 脚步：极短的闷响（人物移动未实现，先把音色备好） */
  step(): void { this.noise(0.07, 0.05, { type: 'lowpass', from: 900, to: 300 }); }

  /** 手机震动：低频脉冲，两下 */
  phone(): void {
    for (let i = 0; i < 2; i++) {
      const d = i * 0.34;
      this.tone(68, 0.16, 0.06, 'square', d);
      this.tone(74, 0.16, 0.05, 'square', d + 0.16);
    }
  }

  /** 拉链：带通扫上去的噪声 */
  zip(): void { this.noise(0.3, 0.05, { type: 'bandpass', from: 700, to: 4200 }); }

  /** 糖果：亮脆的一下 + 极短噪声 */
  candy(): void {
    this.tone(1174.66, 0.09, 0.05, 'triangle');
    this.tone(1567.98, 0.13, 0.035, 'triangle', 0.05);
    this.noise(0.05, 0.03, { type: 'highpass', from: 3000 });
  }

  /** 时钟：两下轻"嘀嗒" */
  clock(): void {
    this.tone(880, 0.05, 0.035, 'square');
    this.tone(659.25, 0.06, 0.03, 'square', 0.26);
  }

  /** 拨云：上行滑音 + 一层亮闪 */
  clearSky(): void {
    this.sweep(392, 1568, 0.7, 0.045, 'sine');
    this.noise(0.6, 0.025, { type: 'highpass', from: 1200, to: 4000 });
  }

  /** 雨声：循环的白噪声过低通（唯一需要手动停止的音） */
  rain(): void {
    const ctx = this.ensure();
    if (!ctx || this.rainSrc) return;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 850;
    const gain = ctx.createGain();
    gain.gain.value = 0.04;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start();
    this.rainSrc = src;
  }

  stopRain(): void {
    if (this.rainSrc) { try { this.rainSrc.stop(); } catch { /* already stopped */ } this.rainSrc = null; }
  }

  // ── 分发 ─────────────────────────────────────────────────────

  private table(): Record<string, () => void> {
    return {
      step: () => this.step(),
      ambient: () => this.ambient(),
      ding: () => this.ding(),
      success: () => this.success(),
      miss: () => this.miss(),
      rain: () => this.rain(),
      phone: () => this.phone(),
      zip: () => this.zip(),
      candy: () => this.candy(),
      clock: () => this.clock(),
      clearSky: () => this.clearSky(),
      chord: () => this.chord(),
    };
  }

  /** 已实现的声音 id（测试用来核对文档要求是否都覆盖到） */
  registered(): string[] { return Object.keys(this.table()).sort(); }

  /**
   * 按 id 播放。**未知 id 不会回落成别的音**，只 warn 并返回 false —— 
   * 静默发错音比不发声更难排查。
   */
  play(id: string): boolean {
    const fn = this.table()[id];
    if (!fn) {
      console.warn(`[audio] 未实现的音效 "${id}"（已忽略，不会用别的音顶替）`);
      return false;
    }
    fn();
    return true;
  }
}
