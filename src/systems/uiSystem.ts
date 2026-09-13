import type { MoodTier, CustomizationQuestion, CustomizationOption } from '../types/content';
import type { GameState } from '../core/runtime';
import { esc, formatTime, groupCollectibles } from '../core/util';
import { SPEED_LABEL, type DialoguePrefs } from './dialoguePrefs';

const MUTE_KEY = 'jks2.mute';

export class UiSystem {
  readonly root: HTMLElement;
  sceneEl!: HTMLElement;
  contentEl!: HTMLElement;
  signalLayer!: HTMLElement;
  cgEl!: HTMLElement;
  castEl!: HTMLElement;
  /** 底部演出带：整条带子都是"继续 / 跳过打字 / 摸头"的点击区（见 Engine.handleStageClick） */
  stageBottomEl!: HTMLElement;
  dialogueBoxEl!: HTMLElement;
  dockEl!: HTMLElement;
  private dayChip!: HTMLElement;
  private moodChip!: HTMLElement;
  private lightChip!: HTMLElement;
  private bondChip!: HTMLElement;
  private muteBtn!: HTMLButtonElement;
  private autoBtn!: HTMLButtonElement;
  private speedBtn!: HTMLButtonElement;

  constructor(root: HTMLElement) {
    this.root = root;
    this.renderShell();
  }

  private renderShell(): void {
    this.root.innerHTML = `
      <div class="game">
        <header>
          <div class="brand">如果有你 <small>IF ONLY YOU WERE THERE</small></div>
          <div class="stats">
            <span class="chip day"></span><span class="chip mood"></span><span class="chip light"></span><span class="chip bond"></span>
            <button class="hud-btn auto-btn" aria-pressed="false" title="自动播放（打完字自动翻页）">▶ 自动</button>
            <button class="hud-btn speed-btn" title="逐字速度">速度 中</button>
            <button class="hud-btn mute-btn" aria-label="静音开关">🔊</button>
            <button class="hud-btn reset-btn">重新开始</button>
          </div>
        </header>
        <section class="scene">
          <div class="content"></div>
          <div class="signal-layer"></div>
          <div class="moment-cg" hidden></div>
          <div class="stage-bottom">
            <div class="cast-layer" hidden></div>
            <div class="bar">
              <div class="dialogue-box" hidden></div>
              <div class="dock"></div>
            </div>
          </div>
        </section>
        <footer><span>用行动说话。</span></footer>
      </div>`;
    this.sceneEl = this.root.querySelector('.scene')!;
    this.contentEl = this.root.querySelector('.content')!;
    this.signalLayer = this.root.querySelector('.signal-layer')!;
    this.cgEl = this.root.querySelector('.moment-cg')!;
    this.castEl = this.root.querySelector('.cast-layer')!;
    this.stageBottomEl = this.root.querySelector('.stage-bottom')!;
    this.dialogueBoxEl = this.root.querySelector('.dialogue-box')!;
    this.dockEl = this.root.querySelector('.dock')!;
    this.dayChip = this.root.querySelector('.day')!;
    this.moodChip = this.root.querySelector('.mood')!;
    this.lightChip = this.root.querySelector('.light')!;
    this.bondChip = this.root.querySelector('.bond')!;
    this.muteBtn = this.root.querySelector('.mute-btn')!;
    this.autoBtn = this.root.querySelector('.auto-btn')!;
    this.speedBtn = this.root.querySelector('.speed-btn')!;
    this.setMuteIcon(this.readMute());
  }

  /**
   * 底部演出带的点击（含立绘行、对白框）。
   *
   * **常驻、不再随每一句挂上和收掉**：从前点击是各阶段自己 `el.onclick = …`，
   * 键盘又是另一条路，于是"打字时点击能跳过、空格不能"这种不一致必然出现。
   * 现在整条带子只有一个入口，它调用 `engine.pressAdvance()` ——
   * 当前这一步由谁负责推进，交给注册进去的那个 handler 决定。
   * 所以 `resetLayers()` / `showEndingPanel()` 都**不要**清掉它。
   */
  onStageClick(handler: (e: MouseEvent) => void): void { this.stageBottomEl.onclick = handler; }

  updateDialogueButtons(prefs: DialoguePrefs): void {
    this.autoBtn.textContent = prefs.auto ? '⏸ 自动' : '▶ 自动';
    this.autoBtn.setAttribute('aria-pressed', String(prefs.auto));
    this.autoBtn.classList.toggle('on', prefs.auto);
    this.speedBtn.textContent = `速度 ${SPEED_LABEL[prefs.speed]}`;
  }

  /**
   * HUD 按钮点完就把焦点还回去。
   * 否则焦点会停在这颗按钮上，之后按空格/回车就变成"再按一次这颗按钮"
   * （浏览器默认行为），玩家看到的就是"空格不能翻页了"。
   */
  private handBackFocus(btn: HTMLButtonElement, handler: () => void): void {
    btn.onclick = () => { handler(); btn.blur(); };
  }

  onAutoClick(handler: () => void): void { this.handBackFocus(this.autoBtn, handler); }
  onSpeedClick(handler: () => void): void { this.handBackFocus(this.speedBtn, handler); }

  /**
   * 收掉所有演出层（信号 / 选项 / 插画 / 立绘 / 对白带 / 倒计时），只留场景与内容区。
   *
   * 从前是 private（只给 askCustom / locationDebugGate / dayCard 用）。人 物 自 动 移 动 转 场
   * （WalkSystem）也要它，而且**必须**要：转场是把校园地图铺进内容区，
   * 上一幕的立绘、情绪信号、对白框如果还挂着，就会孤零零站在校园俯瞰图上。
   * 与其在 WalkSystem 里再抄一遍这几行（将来加一层就漏一层），不如把它开出来当公共操作。
   */
  resetLayers(): void {
    this.signalLayer.innerHTML = '';
    this.dockEl.innerHTML = '';
    this.clearCg();
    this.clearCast();
    this.dialogueBoxEl.hidden = true;
    this.dialogueBoxEl.innerHTML = '';
    this.sceneEl.querySelector('.countdown')?.remove();
  }

  /**
   * D1 剧情插画（全舞台 CG）。
   *
   * 交付的这批 D1 素材是**带背景的整幅插画**、不是抠好的透明立绘，所以不能用"叠加在场景上"的
   * 做法（会变成一块方形画框）。改成整舞台 CG：
   *   · 底层放同一张图的模糊放大版，把 3:4 的图撑满 1000×650 的舞台（不发虚边、不裁人物）
   *   · 上层放清晰原图，object-fit: contain —— 不裁切、不变形
   * 1 张时居中放大；2 张时并排（左=主角、右=对方），正好对应"被批评的紧绷动作 + 老师严肃批评"。
   *
   * 整层 pointer-events:none：它只是画面，绝不能吃掉对白框/干预按钮的点击。
   *
   * `alpha` = 这张交付图是**真透明抠图**（见 art.spec.json 的 alpha 字段）。
   * 这种图不该被当成"一张照片"：卡片背景与描边会把抠图框成一个方块，
   * 所以给它打上 data-alpha=1，由 CSS 换成"人物直接站在场景上"的渲染。
   */
  showCg(images: { src: string; id: string; alpha?: boolean }[]): void {
    if (images.length === 0) { this.clearCg(); return; }
    // 插画里本来就画着人（1 张居中 / 2 张并排），再立一份立绘就是两个主角 ——
    // 所以插画一上屏就把立绘行收掉。**收在这里而不是只靠 CSS 隐藏**：
    // 藏起来的 DOM 仍然是"在场上"的自相矛盾状态（真浏览器验收就是靠 data-asset 对账的），
    // 会被算成"这个人也在画面里"。
    this.clearCast();
    const shown = images.slice(0, 2);
    this.cgEl.hidden = false;
    this.cgEl.dataset.count = String(shown.length);
    // 整层都是透明抠图时，模糊底也要关掉：那张"模糊放大版"对抠图来说就是一团人物剪影，
    // 在场景上糊出一圈黑边（CSS 里按 data-alpha 处理）。
    this.cgEl.dataset.alpha = shown.every((i) => i.alpha === true) ? '1' : '0';
    // 模糊底只是"把插画色调渗进背景"的一层薄纱（CSS 里 opacity:.28），**不负责铺满画面** ——
    // 早先让它整层盖住舞台，结果时相底图全被压在下面看不见。真正负责聚焦的是它上面那层 .cg-dim 暗角。
    this.cgEl.innerHTML = `
      <div class="cg-backdrop" style="background-image:url('${shown[0].src}')"></div>
      <div class="cg-dim"></div>
      <div class="cg-row">${shown.map((img) => `
        <div class="cg-card" data-asset="${img.id}"${img.alpha ? ' data-alpha="1"' : ''}>
          <img class="cg-sharp" src="${img.src}" alt="${img.id}">
        </div>`).join('')}</div>`;
    this.sceneEl.classList.add('has-cg');
  }

  clearCg(): void {
    this.cgEl.hidden = true;
    this.cgEl.innerHTML = '';
    delete this.cgEl.dataset.count;
    delete this.cgEl.dataset.alpha;
    this.sceneEl.classList.remove('has-cg');
  }

  /**
   * 立绘行：界面下方的"人物图"。**一个人物居中，两个人物分居左右**，说话的那个亮起来。
   *
   * 布局由 `data-cast` 驱动（CSS 只改 justify-content），所以"一个人就居中"是**结构保证的**，
   * 不是靠调用方记得传对 class。左右槽位固定为 `portrait-left`（主角）/ `portrait-right`（对方）：
   * 这两个名字同时也是真浏览器验收脚本的锚点，别改。
   *
   * 整层 pointer-events:none —— 它只是画面；点击会穿透到它父亲 `.stage-bottom`
   * （那条带子才是"继续下一句"的点击区）。
   */
  showCast(figures: { id: string; src: string; name: string; side: 'left' | 'right' }[]): void {
    if (!figures.length) { this.clearCast(); return; }
    this.castEl.hidden = false;
    this.castEl.dataset.cast = String(figures.length);
    this.castEl.innerHTML = figures.map((f) => `
      <div class="portrait portrait-${f.side} active" data-asset="${esc(f.id)}" data-side="${f.side}">
        <img alt="${esc(f.name)}" src="${esc(f.src)}">
        <span class="portrait-name">${esc(f.name)}</span>
      </div>`).join('');
    // 立绘一上场，SVG 小人就让位：两者是同一个人的两种画法，同屏出现等于两个主角
    this.sceneEl.classList.add('has-cast');
  }

  /**
   * 谁在说话。§5.1 的两态数值写在 CSS 的 `.portrait.active` / `.portrait.inactive` 里，这里只切 class。
   *
   * `figures.length < 2` 时不做变暗：场上只有一个人，而台词必然是这个人说的
   * （独白 / 只有主角在场），把他压暗只会让人物在画面里凭空变灰。
   */
  setCastSpeaker(speaker: string): void {
    const figures = [...this.castEl.querySelectorAll<HTMLElement>('.portrait')];
    if (!figures.length) return;
    for (const fig of figures) {
      const isPlayer = fig.dataset.side === 'left';
      const active = figures.length < 2 || isPlayer === (speaker === 'student');
      fig.classList.toggle('active', active);
      fig.classList.toggle('inactive', !active);
    }
  }

  clearCast(): void {
    this.castEl.hidden = true;
    this.castEl.innerHTML = '';
    delete this.castEl.dataset.cast;
    this.sceneEl.classList.remove('has-cast');
  }

  updateHud(state: GameState, tier: MoodTier): void {
    this.dayChip.textContent = `第 ${state.day} 天`;
    this.moodChip.textContent = `☁ ${state.mood} · ${tier.name}`;
    this.lightChip.textContent = '✦'.repeat(Math.max(0, state.light));
    this.bondChip.textContent = `♥ ${state.bond}`;
    this.sceneEl.dataset.mood = tier.cloud;
  }

  readMute(): boolean { return localStorage.getItem(MUTE_KEY) === '1'; }
  setMutePref(muted: boolean): void { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); }
  setMuteIcon(muted: boolean): void { this.muteBtn.textContent = muted ? '🔇' : '🔊'; }
  onMuteClick(handler: () => void): void { this.handBackFocus(this.muteBtn, handler); }
  onResetClick(handler: () => void): void {
    this.handBackFocus(this.root.querySelector<HTMLButtonElement>('.reset-btn')!, handler);
  }

  toast(text: string, tone: 'gold' | 'white' | 'dark' = 'gold'): void {
    const el = document.createElement('div');
    el.className = `toast ${tone}`;
    el.textContent = text;
    this.root.querySelector('.game')!.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }

  locationDebugGate(location: string, time: string, title: string, backgroundSrc = ''): Promise<void> {
    this.resetLayers();
    this.sceneEl.dataset.theme = 'map';
    this.contentEl.innerHTML = `
      <div class="debug-map" ${backgroundSrc ? `style="background-image:url('${esc(backgroundSrc)}')"` : ''}></div>
      <div class="debug-route">
        <p>下一目标</p><h2>${esc(location)}</h2><small>${esc(time)} · ${esc(title)}</small>
        <button class="hotspot debug-target" type="button">前往 ${esc(location)}<small>回车 / 空格</small></button>
      </div>`;
    return new Promise((resolve) => {
      const btn = this.contentEl.querySelector<HTMLButtonElement>('.debug-target')!;
      let offKey = (): void => {};
      const proceed = (): void => {
        // 一次入口只算一次：键盘与点击可能在同一个按键里都到（浏览器默认行为会替我们点一次）
        if (btn.disabled) return;
        // 点完立刻收掉入口：否则地点过渡的 1 秒里会留下一颗"还能点但已经没用"的按钮，
        // 真浏览器里它会挡住后续点击（jsdom 不计算布局，测不出来）。
        btn.disabled = true;
        offKey();                       // 键盘监听必须跟着入口一起走，否则会留给下一次入口
        this.contentEl.innerHTML = '';
        resolve();
      };
      btn.onclick = proceed;
      offKey = this.keyActivate(btn, proceed);
    });
  }

  /**
   * 键盘等价于"按下这颗按钮"（回车 / 空格）。
   *
   * 给**全场只有这一个动作**的一次性入口用（地点调试入口的「前往 X」）。
   * 它和"选项"不同：没有第二件事可以被误解、不消耗守护之光、也不跳过任何内容，
   * 所以这里**不需要**干预窗口那种 0.7 秒冷静期 —— 玩家一路按着回车读台词，
   * 顺手把地点门和走路转场一起按掉，正是他想要的。
   *
   * 与 Engine.onAdvanceKey 的分工：那一处管"翻页"，入口出现时 `advanceHandler` 是 null，
   * 所以两处不会抢同一个按键（都 preventDefault 才是问题）。真正会抢的是**浏览器默认行为**：
   *
   *   · 焦点已经在一颗按钮上时一律不抢 —— 浏览器的默认行为就是"按下它"，
   *     抢过来会变成一次按键触发两件事（点掉入口 + 按到那颗按钮）；
   *     Tab 到「前往 X」上的键盘用户也因此走的正是原生的那条路。
   *   · 输入框里按空格是打字（结局页留言瓶），不是点按钮。
   *   · `e.repeat` 不算 —— 手压在回车上的连发不该把地点门一连串地点掉。
   *
   * 这条键盘通道的生命线是**那颗按钮还在不在 DOM 上**（`btn.isConnected`）。
   * 监听挂在 window 上，而 `restart()` 复用同一个 Engine 与同一个 `contentEl`：
   * 入口还开着就重开时，那颗按钮被问卷顶掉，旧闭包却还活着 —— 玩家在问卷上按一次回车，
   * 它就会把 contentEl 清空、题目凭空消失。所以每一条出口都必须解绑，
   * 而且要有一条**不依赖玩家操作**的自注销：按钮一离开 DOM，这条通道下次按键时就自己走掉。
   */
  private keyActivate(btn: HTMLButtonElement, action: () => void): () => void {
    const off = (): void => window.removeEventListener('keydown', onKey);
    const onKey = (e: KeyboardEvent): void => {
      // 入口已经不在这棵树上了（重新开始 / 整棵 DOM 被换掉）→ 自我注销，不留悬空监听
      if (!btn.isConnected || !this.root.isConnected) { off(); return; }
      if (e.key !== ' ' && e.key !== 'Spacebar' && e.key !== 'Enter') return;
      if (e.repeat) return;
      const t = e.target;
      if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return;
      if (document.activeElement instanceof HTMLButtonElement) return;
      e.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return off;
  }

  // 地点过渡：约 1 秒的地点名淡入淡出，让"换地点"有明确反馈
  async locationTransition(location: string, ms: number): Promise<void> {
    this.contentEl.innerHTML = '';
    if (ms <= 0) return;
    const el = document.createElement('div');
    el.className = 'location-transition';
    el.textContent = location;
    this.root.querySelector('.game')!.appendChild(el);
    await new Promise((r) => setTimeout(r, ms));
    el.remove();
  }

  // 日转场卡：挡住输入，播完再出现"下一目标"入口。
  // 不能改成非阻塞——那会和地点入口叠在同一个位置（真浏览器截图里确认过）。
  async dayCard(day: number, title?: string, ms = 1400): Promise<void> {
    if (ms <= 0) return;
    const el = document.createElement('div');
    el.className = 'day-card';
    el.innerHTML = `<b>第 ${day} 天</b>${title ? `<span>${esc(title)}</span>` : ''}`;
    this.root.querySelector('.game')!.appendChild(el);
    await new Promise((r) => setTimeout(r, ms));
    el.remove();
  }

  title(count: number, canResume: boolean): Promise<'start' | 'resume' | 'gallery'> {
    this.sceneEl.dataset.theme = 'title';
    this.sceneEl.style.filter = '';
    this.contentEl.innerHTML = '';
    this.resetLayers();
    this.contentEl.innerHTML = `<div class="title-screen">
      <h1>如果有你</h1>
      <p class="subtitle">If Only You Were There</p>
      <p class="collect">☁ 已收下 ${count} 句心动</p>
      <div class="title-actions">
        ${canResume ? '<button class="btn" data-act="resume">继续守护</button>' : ''}
        <button class="btn" data-act="start">开始守护</button>
        <button class="btn ghost" data-act="gallery">云朵图鉴</button>
      </div>
    </div>`;
    return new Promise((resolve) => {
      this.contentEl.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((btn) => {
        btn.onclick = () => resolve(btn.dataset.act as 'start' | 'resume' | 'gallery');
      });
    });
  }

  gallery(items: { text: string; group?: string }[], groupNames: Record<string, string>): Promise<void> {
    this.sceneEl.dataset.theme = 'title';
    this.sceneEl.style.filter = '';
    this.contentEl.innerHTML = '';
    this.resetLayers();
    const sections = groupCollectibles(items, groupNames).map((g) => `<div class="gallery-group">
        <div class="gallery-group-title">${g.icon} ${esc(g.title)} · ${g.items.length}</div>
        <div class="gallery-list">${g.items.map((t) => `<div class="gallery-item">${g.icon} ${esc(t)}</div>`).join('')}</div>
      </div>`).join('');
    this.contentEl.innerHTML = `<div class="gallery">
      <h2>云朵图鉴</h2>
      ${items.length ? sections : '<p class="empty">还没有收藏的心动，去守护吧。</p>'}
      <button class="btn" data-back>返回</button>
    </div>`;
    return new Promise((resolve) => {
      this.contentEl.querySelector<HTMLButtonElement>('[data-back]')!.onclick = () => resolve();
    });
  }

  askCustom(q: CustomizationQuestion, resolve?: (id: string) => string): Promise<CustomizationOption> {
    const type = q.type ?? 'options';
    if (type === 'slider') return this.askSlider(q);
    if (type === 'colors') return this.askColors(q);
    return this.askOptions(q, resolve);
  }

  /**
   * 选项题。选项可以带 `image`（AssetId）—— 开局"那时候的TA，是——"就用它显示男/女基础形象
   * （美术交付说明 player_boy / player_girl：「用于角色选择」）。
   * 图只作为按钮内部装饰：外层 <button> 依旧是唯一的点击目标，图不参与命中测试。
   */
  private askOptions(q: CustomizationQuestion, resolve?: (id: string) => string): Promise<CustomizationOption> {
    const options = q.options ?? [];
    const art = (o: CustomizationOption): string => {
      const src = o.image && resolve ? resolve(o.image) : '';
      return src ? `<img class="choice-art" src="${src}" alt="" aria-hidden="true">` : '';
    };
    this.contentEl.innerHTML = `<div class="custom">
      <div class="custom-prompt">${esc(q.prompt)}</div>
      <div class="custom-options">${options.map((o, i) => `<button class="choice${o.image ? ' has-art' : ''}" data-i="${i}">${art(o)}${esc(o.label)}</button>`).join('')}</div>
    </div>`;
    return new Promise((resolve_) => {
      this.contentEl.querySelectorAll<HTMLButtonElement>('.choice').forEach((btn) => {
        btn.onclick = () => resolve_(options[Number(btn.dataset.i!)]);
      });
    });
  }

  private askSlider(q: CustomizationQuestion): Promise<CustomizationOption> {
    const s = q.slider ?? { min: 0, max: 100, step: 1, value: 50 };
    const fmt = (v: number) => (s.unit === 'time' ? formatTime(v) : String(v));
    this.contentEl.innerHTML = `<div class="custom">
      <div class="custom-prompt">${esc(q.prompt)}</div>
      <div class="slider-value">${fmt(s.value)}</div>
      <input class="slider" type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.value}" />
      <button class="btn" data-confirm>就这个</button>
    </div>`;
    const input = this.contentEl.querySelector<HTMLInputElement>('.slider')!;
    const label = this.contentEl.querySelector<HTMLElement>('.slider-value')!;
    input.oninput = () => { label.textContent = fmt(Number(input.value)); };
    return new Promise((resolve) => {
      this.contentEl.querySelector<HTMLButtonElement>('[data-confirm]')!.onclick = () => {
        const v = Number(input.value);
        resolve({ label: fmt(v), value: fmt(v), setFlags: { [`${q.id}Value`]: v } });
      };
    });
  }

  private askColors(q: CustomizationQuestion): Promise<CustomizationOption> {
    const colors = q.colors ?? [];
    this.contentEl.innerHTML = `<div class="custom">
      <div class="custom-prompt">${esc(q.prompt)}</div>
      <div class="custom-options">${colors.map((c, i) => `<button class="choice color-choice" data-i="${i}"><span class="swatch" style="background:${esc(c.primary)}"></span><span class="swatch" style="background:${esc(c.secondary)}"></span>${esc(c.label)}</button>`).join('')}</div>
    </div>`;
    return new Promise((resolve) => {
      this.contentEl.querySelectorAll<HTMLButtonElement>('.color-choice').forEach((btn) => {
        btn.onclick = () => {
          const c = colors[Number(btn.dataset.i!)];
          resolve({ label: c.label, value: c.label, setFlags: { [`${q.id}Primary`]: c.primary, [`${q.id}Secondary`]: c.secondary } });
        };
      });
    });
  }

  showEndingPanel(opts: {
    title: string; mood: number; bond: number; total: number; miss: number; collected: number;
    stars: number; historyLabel: string;
    moodHistory: { label: string; cloud: 'dark' | 'white' | 'gold' }[];
    prevMessage?: string; onBottle: (text: string) => void; onRestart: () => void; onGallery: () => void; onTitle: () => void;
  }): void {
    const game = this.root.querySelector('.game')!;
    // 结算浮层出现时收掉场景里的演出层：否则立绘会从卡片下面露出来、
    // 对白框/倒计时也会在卡片后面透出来（真浏览器截图里看到的）。
    this.signalLayer.innerHTML = '';
    this.dockEl.innerHTML = '';
    this.clearCast();
    this.dialogueBoxEl.hidden = true;
    this.dialogueBoxEl.innerHTML = '';
    this.sceneEl.querySelector('.countdown')?.remove();
    let overlay = game.querySelector<HTMLElement>('.ending');
    if (!overlay) { overlay = document.createElement('div'); overlay.className = 'ending'; game.appendChild(overlay); }
    const cap = (label: string) => /^第(\d+)天/.exec(label)?.[1] ?? label;
    const history = opts.moodHistory.map((h) =>
      `<span class="history-cell"><span class="history-cloud ${h.cloud}" title="${esc(h.label)}"></span><span class="history-day">${esc(cap(h.label))}</span></span>`).join('');
    overlay.innerHTML = `<div class="ending-card">
      <h1>${esc(opts.title)}</h1>
      <div class="ending-stats">
        <span class="stars" title="守护星级">${'★'.repeat(opts.stars)}${'☆'.repeat(Math.max(0, 5 - opts.stars))}</span>
        <span>心情 ${opts.mood}</span><span>羁绊 ${opts.bond}</span><span>守护 ${opts.total} 次</span><span>错过 ${opts.miss} 次</span><span>☁ 图鉴 ${opts.collected} 句</span>
      </div>
      ${opts.moodHistory.length ? `<div class="history-row"><div class="history-label">${esc(opts.historyLabel)}</div><div class="history-clouds">${history}</div></div>` : ''}
      ${opts.prevMessage ? `<div class="bottle-received">来自未来的你：<q>${esc(opts.prevMessage)}</q></div>` : ''}
      <div class="bottle">
        <input maxlength="40" placeholder="给那年的自己，留一句话吧。（40字内）" />
        <button class="bottle-send">投进海里</button>
      </div>
      <div class="ending-actions">
        <button class="restart-btn">再守护一次</button>
        <button class="ghost-btn" data-gallery>云朵图鉴</button>
        <button class="ghost-btn" data-title>回到标题</button>
      </div>
    </div>`;
    overlay.querySelector<HTMLButtonElement>('.bottle-send')!.onclick = () => {
      const input = overlay!.querySelector<HTMLInputElement>('input')!;
      const text = input.value.trim();
      if (text) { opts.onBottle(text); input.value = ''; opts.onRestart(); }
    };
    overlay.querySelector<HTMLButtonElement>('.restart-btn')!.onclick = () => opts.onRestart();
    overlay.querySelector<HTMLButtonElement>('[data-gallery]')!.onclick = () => opts.onGallery();
    overlay.querySelector<HTMLButtonElement>('[data-title]')!.onclick = () => opts.onTitle();
  }
}
