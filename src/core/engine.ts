import { config as defaultConfig } from '../../content';
import { applyDerivedFlags, applyOutcome, createState, evalCondition, SaveSystem, starsFor, tierFor, type GameState } from './runtime';
import { addMessage, readMessages } from './util';
import { playerArtId, playerKeyOf, storyArtId } from './gender';
import type { ArtSlot, D1Pose, DilemmaConfig, DialogueLine, EndingConfig, FlowNode, GameConfig, Interaction, MomentConfig, MoodTier, Outcome } from '../types/content';

/**
 * D1 插画姿态的回退链。交付里女生没有「被批评后低头」那张，所以 down 要退到 tense；
 * 男生没有独立的 strain 之外的差别。回退**只在同一性别内进行** —— 宁可少一张图，
 * 也绝不把男女主角的素材混进同一条剧情画面（美术交付说明 §一.2）。
 */
export const POSE_FALLBACK: Record<D1Pose, D1Pose[]> = {
  calm: ['sit', 'tense'],
  tired: ['calm', 'sit'],
  tense: ['strain', 'sit'],
  relax: ['sitRelax', 'calm', 'sit'],
  down: ['tense', 'sit'],
  sit: ['calm'],
  sitRelax: ['relax', 'sit'],
  strain: ['tense', 'sit'],
};
import { AudioSystem } from '../systems/audioSystem';
import { UiSystem } from '../systems/uiSystem';
import { SceneManager } from '../systems/sceneManager';
import { DialogueSystem } from '../systems/dialogueSystem';
import { SPEED_LABEL } from '../systems/dialoguePrefs';
import { ChoiceSystem, type InterventionPick } from '../systems/choiceSystem';
import { MapSystem } from '../systems/mapSystem';
import { WalkSystem } from '../systems/walkSystem';
import { CloudSystem } from '../systems/cloudSystem';
import { AnimationSystem } from '../systems/animationSystem';
import { EffectRunner } from '../systems/effectRunner';
import { AssetLoader } from '../systems/assetLoader';

export class Engine {
  readonly config: GameConfig;
  readonly root: HTMLElement;
  state: GameState;
  readonly save: SaveSystem;

  readonly ui: UiSystem;
  readonly audio: AudioSystem;
  readonly scene: SceneManager;
  readonly dialogue: DialogueSystem;
  readonly choice: ChoiceSystem;
  readonly map: MapSystem;
  readonly walk: WalkSystem;
  readonly cloud: CloudSystem;
  readonly animation: AnimationSystem;
  readonly effects: EffectRunner;
  readonly assets: AssetLoader;

  private petUsed = false;
  private currentId = '';
  private readonly collectibleIndex: Record<string, { text: string; group?: string }>;

  constructor(root: HTMLElement, cfg: GameConfig = defaultConfig, save: SaveSystem = new SaveSystem()) {
    this.root = root;
    this.config = cfg;
    this.save = save;
    this.state = createState(cfg);
    this.ui = new UiSystem(root);
    this.audio = new AudioSystem();
    this.animation = new AnimationSystem(this);
    this.scene = new SceneManager(this);
    this.dialogue = new DialogueSystem(this);
    this.choice = new ChoiceSystem(this);
    this.map = new MapSystem(this);
    this.walk = new WalkSystem(this);
    this.cloud = new CloudSystem(this);
    this.effects = new EffectRunner(this);
    this.assets = new AssetLoader();
    this.collectibleIndex = this.buildCollectibleIndex();
  }

  get moodTier(): MoodTier { return tierFor(this.config, this.state.mood); }

  async start(): Promise<void> {
    this.state = this.save.load(this.config) ?? createState(this.config);
    this.audio.setMuted(this.ui.readMute());
    this.ui.setMuteIcon(this.ui.readMute());
    this.ui.onMuteClick(() => {
      const next = !this.audioMuted();
      this.audio.setMuted(next);
      this.ui.setMutePref(next);
      this.ui.setMuteIcon(next);
    });
    this.ui.onResetClick(() => this.restart());
    // 点击（整条底部演出带）与键盘（空格 / 回车）都走 pressAdvance 这一个出口
    this.ui.onStageClick((e) => this.handleStageClick(e));
    window.addEventListener('keydown', this.onAdvanceKey);
    // 自动播放 / 速度（文档 §5.1）：状态挂在 DialogueSystem 上，偏好存 localStorage
    this.ui.updateDialogueButtons(this.dialogue.prefs);
    this.ui.onAutoClick(() => {
      const on = this.dialogue.toggleAuto();
      this.ui.updateDialogueButtons(this.dialogue.prefs);
      this.ui.toast(on ? '自动播放：开' : '自动播放：关', 'white');
    });
    this.ui.onSpeedClick(() => {
      this.dialogue.cycleSpeed();
      this.ui.updateDialogueButtons(this.dialogue.prefs);
      this.ui.toast(`逐字速度：${SPEED_LABEL[this.dialogue.prefs.speed]}`, 'white');
    });
    await this.assets.preload(this.config.assets);
    this.ui.updateHud(this.state, this.moodTier);
    await this.goTitle();
  }

  private audioMuted(): boolean { return this.ui.readMute(); }

  private async goTitle(): Promise<void> {
    this.root.querySelector('.ending')?.remove();
    const action = await this.titleScreen();
    if (action === 'resume') await this.resume();
    else await this.startFresh();
  }

  private async titleScreen(): Promise<'start' | 'resume'> {
    let action = await this.ui.title(this.state.logs.collected.length, this.hasProgress());
    while (action === 'gallery') {
      await this.ui.gallery(this.collectedItems(), this.galleryGroups());
      action = await this.ui.title(this.state.logs.collected.length, this.hasProgress());
    }
    return action;
  }

  private async openGallery(): Promise<void> {
    this.root.querySelector('.ending')?.remove();
    await this.ui.gallery(this.collectedItems(), this.galleryGroups());
    await this.goTitle();
  }

  /**
   * 开始新的一周目。
   * **跨周目要保留的数据只在这一个地方维护**：图鉴收藏、通关次数、已读台词。
   * （之前 restart() 里自己保留了一份、startFresh() 又 createState 把它冲掉，
   *   等于"已读快进"永远不生效 —— 所以统一收在这里，别在调用方各自留一份。）
   */
  private async startFresh(): Promise<void> {
    const { collected, seenLines } = this.state.logs;
    const { playthroughs } = this.state;
    this.state = createState(this.config);
    this.state.logs.collected = collected;
    this.state.logs.seenLines = seenLines;
    this.state.playthroughs = playthroughs;
    this.save.save(this.state);
    this.ui.updateHud(this.state, this.moodTier);
    if (this.config.customization?.length) await this.runCustomization();
    else await this.run(this.config.start);
  }

  private async resume(): Promise<void> {
    this.ui.updateHud(this.state, this.moodTier);
    await this.run(this.state.nodeId);
  }

  private hasProgress(): boolean {
    if (!this.getNode(this.state.nodeId)) return false;
    return this.state.onceKeys.length > 0
      || Object.keys(this.state.logs.interventions).length > 0
      || Object.keys(this.state.custom).length > 0
      || this.state.day > 1;
  }

  private collectedItems(): { text: string; group?: string }[] {
    return this.state.logs.collected.map((id) => this.collectibleIndex[id]).filter((t): t is { text: string; group?: string } => !!t);
  }

  private galleryGroups(): Record<string, string> { return this.config.settings?.galleryGroups ?? {}; }

  private buildCollectibleIndex(): Record<string, { text: string; group?: string }> {
    const index: Record<string, { text: string; group?: string }> = {};
    type Line = { id?: string; text: string; collectible?: boolean; group?: string };
    const add = (line?: Line) => { if (line?.collectible && line.id) index[line.id] = { text: line.text, group: line.group }; };
    for (const d of Object.values(this.config.dilemmas)) {
      d.intro.forEach(add);
      d.interactions.forEach((i) => (i.outcome.feedback ?? []).forEach(add));
      (d.onTimeout?.feedback ?? []).forEach(add);
    }
    this.config.endings.forEach((e) => e.lines.forEach(add));
    (this.config.settings?.freeInterventions ?? []).forEach((fi) => (fi.outcome.feedback ?? []).forEach(add));
    return index;
  }

  private async runCustomization(): Promise<void> {
    for (const q of this.config.customization ?? []) {
      const option = await this.ui.askCustom(q, (id) => this.assets.url(id));
      this.state.custom[q.id] = option.value;
      Object.assign(this.state.flags, option.setFlags ?? {});
    }
    applyDerivedFlags(this.state, this.config.settings?.derivedFlags ?? []);
    this.save.save(this.state);
    this.ui.toast('都记下了。');
    await this.run(this.config.start);
  }

  async run(nodeId: string): Promise<void> {
    this.currentId = nodeId;
    this.state.nodeId = nodeId;
    this.state.inputMode = 'idle';
    this.ui.updateHud(this.state, this.moodTier);
    const node = this.config.flow.find((n) => n.id === nodeId);
    if (!node) throw new Error(`未知节点：${nodeId}`);
    switch (node.kind) {
      case 'map': {
        this.save.save(this.state); // 检查点：可续玩
        const result = await this.map.show(this.config.maps[node.mapId], this.config.settings?.freeInterventions ?? []);
        if (result.kind === 'free') {
          this.applyFree(result.interaction);
          return this.run(node.id);
        }
        return this.run(result.target);
      }
      case 'scene': {
        const scene = this.config.scenes[node.sceneId];
        this.scene.show(scene);
        await this.effects.run(scene.onEnter);   // 契约里的 onEnter 现在真的会执行
        return node.next ? this.run(node.next) : undefined;
      }
      case 'dialogue':
        await this.dialogue.play(node.lines, `node:${node.id}`);
        // outcome 用于"不可干预时刻"：只播台词并结算，不给任何选项
        if (node.outcome) {
          this.applyOutcome(node.outcome);
          await this.effects.run(node.outcome.effect);
          this.ui.updateHud(this.state, this.moodTier);
        }
        return node.next ? this.run(node.next) : undefined;
      case 'moment': {
        const moment = this.config.moments?.[node.momentId];
        if (!moment) throw new Error(`未知时刻：${node.momentId}`);
        if (moment.when && !evalCondition(moment.when, this.state)) return this.run(node.next);
        if (this.state.onceKeys.includes(moment.onceKey)) return this.run(node.next);
        const locationChanged = this.state.locationId !== moment.locationId;
        const scene = this.config.scenes[moment.sceneId];
        if (locationChanged) {
          // 地点入口会把场景层整片换掉，这时"现在在播哪一刻"已经不是真的了。
          // 把标记一起清掉，DOM 上就不会留下"标记说有画面、实际画面已被清空"的矛盾状态 ——
          // 真浏览器验收正是靠这个属性对账的，留着一个假的会让它对着空气做判断。
          delete this.ui.sceneEl.dataset.moment;
          delete this.ui.sceneEl.dataset.scene;
          this.state.inputMode = 'location';
          // 从哪儿来：state.locationId 是**上一次待过的地点**。每天第一个时刻它被重置成 ''
          // （day 节点里干的），那时没有"上一站"，所以只会出现"直接进场景"而没有走路 ——
          // 一天的第一次换地点本来就是"从床上醒来"，不该先看一段通勤。
          const fromLocationId = this.state.locationId;
          const map = this.config.maps[moment.locationId];
          const backgroundSrc = map?.background ? this.assets.url(map.background) : '';
          await this.ui.locationDebugGate(scene.name, moment.time, moment.title, backgroundSrc);
          // 人物自动移动转场（map_routes 交接包）：走不过去就安静地退回到纯文字过渡。
          // 返回值刻意不参与分支 —— 有没有播走路，后面要做的事一模一样。
          await this.walk.play(fromLocationId, moment.locationId, scene.name);
          // 地点环境音（文档 §8.7）
          this.audio.ambient();
          await this.ui.locationTransition(scene.name, this.config.settings?.transitionMs ?? 900);
        }
        if (!this.state.onceKeys.includes(moment.onceKey)) this.state.onceKeys.push(moment.onceKey);
        this.state.currentMomentId = moment.id;
        this.state.locationId = moment.locationId;
        this.state.storyTime = moment.time;
        this.state.flags[moment.onceKey] = true;
        this.state.flags.currentLocation = moment.locationId;
        this.state.flags.storyTime = moment.time;
        this.state.inputMode = moment.event ? 'intervention' : 'dialogue';
        this.scene.show(this.config.scenes[moment.sceneId]);
        // 把"现在在播哪一刻 / 进了哪个场景"挂到 DOM 上。
        // 真浏览器验收要靠它精确断言"这一刻用的是哪张底图、哪层光" —— 否则只能靠
        // "第一个教室大概就是早读吧"这种猜测，而时相接错恰恰表现为"画面看着挺正常、其实错了"。
        // 纯数据属性，不参与样式与布局。
        this.ui.sceneEl.dataset.moment = moment.id;
        this.ui.sceneEl.dataset.scene = moment.sceneId;
        // D1 剧情插画：整幅插画替代场景里的小人（插画本身就画了人物，再叠一个 SVG 小人会变成两个主角）
        this.showArt(moment.art?.cg);
        // 立绘行（界面下部的人物图）：1 人居中 / 2 人左右，说话者高亮。
        // 插画在场时由 CSS 让位（`.scene.has-cg .cast-layer{display:none}`）——
        // 插画里本来就画着人，再立一份立绘就成了两个主角。
        this.showCast();
        if (moment.event) {
          const d: DilemmaConfig = { id: moment.id, name: moment.title, sceneId: moment.sceneId, signal: moment.event.signal, intro: moment.event.intro ?? [], interactions: moment.event.interactions, timeoutSec: moment.event.timeoutSec, onTimeout: moment.event.onTimeout, next: node.next };
          const nextId = await this.runDilemma(d);
          this.ui.clearCg();
          this.clearCast();
          return this.run(nextId);
        }
        // 所有时刻的台词都走底部对白框（云朵容器已删除，见 DialogueSystem 的头部注释）
        await this.dialogue.play(moment.lines ?? [], `moment:${moment.id}`);
        if (moment.outcome) { this.applyOutcome(moment.outcome); }
        this.state.moodHistory.push({ label: moment.id, mood: this.state.mood });
        this.save.save(this.state);
        this.ui.clearCg();
        this.clearCast();
        return this.run(node.next);
      }
      case 'dilemma':
        return this.run(await this.runDilemma(this.config.dilemmas[node.dilemmaId]));
      case 'choice': {
        if (node.prompt) await this.dialogue.play([node.prompt], `prompt:${node.id}`);
        const pick = await this.choice.runChoices(node.choices.filter((c) => evalCondition(c.when, this.state)));
        if (pick.outcome) { this.applyOutcome(pick.outcome); await this.effects.run(pick.outcome.effect); }
        return this.run(pick.next);
      }
      case 'set':
        Object.assign(this.state.flags, node.set);
        return node.next ? this.run(node.next) : undefined;
      case 'branch': {
        const next = node.branches.find((b) => evalCondition(b.when, this.state))?.next ?? node.fallback;
        return next ? this.run(next) : undefined;
      }
      case 'random': {
        const total = node.branches.reduce((sum, b) => sum + Math.max(0, b.weight), 0);
        let roll = Math.random() * total;
        let next = node.branches[0]?.next;
        for (const b of node.branches) {
          roll -= Math.max(0, b.weight);
          if (roll <= 0) { next = b.next; break; }
        }
        return next ? this.run(next) : undefined;
      }
      case 'day': {
        this.state.day = node.day;
        // 日初重置当天目标：让每天第一个时刻都先显示"下一目标"调试入口
        this.state.locationId = '';
        this.state.inputMode = 'location';
        // 每日守护之光由内容层声明（D1–D5 = 2，D6 = 3，D7 关闭干预）
        this.state.light = node.light;
        this.resetPet();
        // 幂等：续玩重放同一 day 节点时覆盖而非追加，避免 avgMood 被重复计入
        const label = node.title ? `第${node.day}天·${node.title}` : `第${node.day}天`;
        const prevLabel = this.state.moodHistory.find((h) => h.label === label);
        if (prevLabel) prevLabel.mood = this.state.mood; else this.state.moodHistory.push({ label, mood: this.state.mood });
        const prevDay = this.state.dayMoods.find((d) => d.day === node.day);
        if (prevDay) prevDay.mood = this.state.mood; else this.state.dayMoods.push({ day: node.day, mood: this.state.mood });
        this.save.save(this.state);
        this.ui.updateHud(this.state, this.moodTier);
        // 日转场播完再继续，避免日卡盖住"下一目标"入口
        await this.ui.dayCard(node.day, node.title, this.config.settings?.dayCardMs ?? 1400);
        return this.run(node.next);
      }
      case 'ending': {
        const ending = this.config.endings.find((e) => e.id === node.endingId);
        if (!ending) throw new Error(`未知结局：${node.endingId}`);
        return this.runEnding(ending);
      }
    }
  }

  private async runDilemma(d: DilemmaConfig): Promise<string> {
    this.scene.show(this.config.scenes[d.sceneId]);
    // 事件窗口里人物都还站在场上（老师在场时就是"两个人分居左右"那一刻），
    // 所以 scene.show 之后要重新立一次立绘行 —— show 会把上一幕的立绘收掉。
    this.showCast();
    this.cloud.showSignal(d.signal);
    // 手机来电：脚本 §5.2 要求有手机震动表现（音 + 震动画都挂在 phoneWave 信号上）
    if (d.signal.kind === 'phoneWave') {
      this.audio.play('phone');
      await this.animation.run('signal', 'phoneBuzz');
    }
    await this.dialogue.play(d.intro, `intro:${d.id}`);
    // 干预窗口期间的插画：交付说明要求"被批评时用主角紧绷动作 + 老师严肃批评"并排。
    // 挂完图**必须再收一次立绘行**：插画在 → 立绘让位；插画不在（这一刻没编排 during、
    // 或者编排了但图没解析出来）→ 立绘顶上。少了这一步，画面会从"场景底图 + 立绘"
    // 直接掉成"一张场景底图"，看上去就是"这一刻没有人物图"。
    const art = this.currentMoment()?.art;
    if (art?.during) this.showArt(art.during);
    this.showCast();
    const available = d.interactions.filter((it) => evalCondition(it.availableWhen, this.state));
    const pick: InterventionPick = await this.choice.runInteractions(available, d.timeoutSec ?? 10);
    let outcome: Outcome;
    if (pick.kind === 'intervention') {
      const it = d.interactions.find((x) => x.id === pick.id)!;
      this.state.light = Math.max(0, this.state.light - it.cost);
      this.state.logs.totalInterventions++;
      this.state.logs.interventions[pick.id] = (this.state.logs.interventions[pick.id] ?? 0) + 1;
      this.state.logs.lastInterventionSuccess = true;
      outcome = it.outcome;
      this.audio.success();
      // 收尾场景：D6 15:00「考后冒雨」干预成功后换成「提前放晴」（交付说明 §四.3）
      if (art?.successScene) this.showScene(art.successScene);
      // 收尾插画：干预成功 → 放松（没有 success 图就保持窗口期那张，不凭空收走画面）
      if (art?.success) this.showArt(art.success);
      this.showCast();
    } else {
      // 'timeout' = 窗口自己走完；'skip' = 玩家主动点了「这次，就让它过去」。
      // 两者在叙事上是同一件事：没有伸手。区别只在于"等出来的"还是"点出来的"，
      // 所以结算完全一致（都记一次错过、都算未成功、都走 onTimeout 的收尾）。
      this.state.logs.missCount++;
      this.state.logs.lastInterventionSuccess = false;
      outcome = d.onTimeout ?? {};
      // miss 以前是完全没声音的（文档 §8.7 要求成功/miss 都有反馈）
      this.audio.miss();
      // 收尾：先换整屏场景（如果有），再换插画 —— 顺序反过来的话新插画会在旧天气上闪一下
      if (art?.missScene) this.showScene(art.missScene);
      // 收尾插画：没干预 → 低头（女生没有低头图，回退到她的紧绷）
      if (art?.miss) this.showArt(art.miss);
      this.showCast();
    }
    this.applyOutcome(outcome);
    await this.effects.run(outcome.effect);
    if (pick.kind === 'intervention') this.cloud.dissolveSignal();
    await this.dialogue.play(outcome.feedback ?? [], `feedback:${d.id}:${pick.kind === 'intervention' ? pick.id : pick.kind}`);
    this.state.flags[`${d.id}:done`] = true;
    this.state.moodHistory.push({ label: d.name, mood: this.state.mood });
    this.save.save(this.state);
    this.ui.updateHud(this.state, this.moodTier);
    return outcome.next ?? d.next;
  }

  private applyFree(interaction: Interaction): void {
    this.state.light = Math.max(0, this.state.light - interaction.cost);
    this.state.logs.totalInterventions++;
    this.state.logs.interventions[interaction.id] = (this.state.logs.interventions[interaction.id] ?? 0) + 1;
    this.applyOutcome(interaction.outcome);
    this.state.moodHistory.push({ label: interaction.label, mood: this.state.mood });
    this.audio.success();
    this.ui.toast(interaction.outcome.feedback?.[0]?.text ?? '……真甜。', 'gold');
    this.save.save(this.state);
    this.ui.updateHud(this.state, this.moodTier);
  }

  // 终章记忆回响：优先用内容层的 {变量} 模板，缺省按定制顺序回放
  private memoryEchoLines(): DialogueLine[] {
    const configured = this.config.settings?.memoryEcho;
    if (configured?.length) return configured;
    const qs = this.config.customization ?? [];
    if (!qs.length) return [];
    const lines: DialogueLine[] = qs.map((q) => ({ text: this.state.custom[q.id] ?? '……', tone: 'white' as const }));
    lines.push({ text: '——这些，都是你告诉我的。', tone: 'white' });
    return lines;
  }

  private async runEnding(ending: EndingConfig): Promise<void> {
    // 终章推近之后先落到"记忆回响"：交付的 D7 黑屏背景专为这一段画的
    // （说明 §二："终章镜头推近后的黑屏记忆回响阶段。文字由程序显示"）。
    // 回响是**定制答案的回放**，和结局本身不是同一段，所以先黑屏放回响、再回结局场景放结局台词。
    const echo = this.memoryEchoLines();
    const echoScene = this.config.scenes.memoryEcho;
    if (echo.length && echoScene) {
      this.scene.show(echoScene);
      this.clearCast();
      await this.dialogue.play(echo, `echo:${ending.id}`);
    }
    this.scene.show(ending.scene);
    await this.effects.run(ending.scene.onEnter);
    // 终章只有主角一个人站在那儿（老师不进结局画面），所以立绘行按"一个人物"居中。
    // 传 wantNpc=false 而不是靠"最后一个时刻恰好没有 npcPose"——那是巧合，不是规则。
    this.showCast(false);
    this.audio.chord();
    await this.dialogue.play(ending.lines, `ending:${ending.id}`);
    this.save.save(this.state);
    const prev = readMessages().slice(-1)[0];
    // 结局页"七日云朵"优先用按天记录；没有 day 节点时退回事件轨迹
    const useDays = this.state.dayMoods.length > 0;
    const history = (useDays
      ? this.state.dayMoods.map((d) => ({ label: `第${d.day}天`, mood: d.mood }))
      : this.state.moodHistory.map((h) => ({ label: h.label, mood: h.mood }))
    ).map((h) => ({ label: h.label, cloud: tierFor(this.config, h.mood).cloud }));
    this.ui.showEndingPanel({
      title: ending.name,
      mood: this.state.mood,
      bond: this.state.bond,
      total: this.state.logs.totalInterventions,
      miss: this.state.logs.missCount,
      collected: this.state.logs.collected.length,
      stars: starsFor(this.config, this.state.bond),
      historyLabel: useDays ? '七日云朵' : '这一路的心情',
      moodHistory: history,
      prevMessage: prev,
      onBottle: (text) => addMessage(text),
      onRestart: () => this.restart(),
      onGallery: () => { void this.openGallery(); },
      onTitle: () => { void this.goTitle(); },
    });
  }

  applyOutcome(outcome: Outcome): void { applyOutcome(this.state, outcome); }

  resetPet(): void { this.petUsed = false; }

  petStudent(): void {
    if (this.petUsed) return;
    this.petUsed = true;
    this.applyOutcome({ moodDelta: 2 });
    this.ui.updateHud(this.state, this.moodTier);
    this.ui.toast('……有点安心。', 'gold');
  }

  restart(): void {
    this.root.querySelector('.ending')?.remove();
    this.state.playthroughs += 1;   // 走完一个结局 = 完成一周目
    void this.startFresh();
  }

  setMood(value: number): void { this.state.mood = Math.max(0, Math.min(100, value)); this.ui.updateHud(this.state, this.moodTier); }
  setLight(value: number): void { this.state.light = Math.max(0, value); this.ui.updateHud(this.state, this.moodTier); }
  addBond(value: number): void { this.state.bond = Math.max(0, this.state.bond + value); this.ui.updateHud(this.state, this.moodTier); }

  current(): string { return this.currentId; }

  /** 当前正在播的时刻（立绘选图用：性别、放松态、旁观 NPC 姿态都挂在时刻上） */
  currentMoment(): MomentConfig | undefined {
    return this.state.currentMomentId ? this.config.moments?.[this.state.currentMomentId] : undefined;
  }

  /**
   * 只认**真交付**的图。
   * `assets.url()` 对"已登记但还没交图"的 AssetId 会返回占位 SVG（非空字符串），
   * 所以拿它当存在性判断会让回退链失效（例如女生没有低头图时，会停在"低头占位图"
   * 而不是退到她的紧绷图）。占位与否问 `assets.isPlaceholder()`，不要去嗅 src 前缀。
   */
  private realArt(id: string): string | undefined {
    const src = this.assets.url(id);
    return src && !this.assets.isPlaceholder(id) ? src : undefined;
  }

  /** 把语义姿态解析成 AssetId（按开局性别，必要时走同性别回退链） */
  private poseArtId(pose: D1Pose): string | undefined {
    const who = playerKeyOf(this.state.custom);
    // 性别未定就不猜：宁可不显示插画，也不冒"男女素材混用"的风险
    if (!who) return undefined;
    for (const p of [pose, ...POSE_FALLBACK[pose]]) {
      const id = `art.d1.${who}.${p}`;
      if (this.realArt(id)) return id;
    }
    return undefined;
  }

  /**
   * 主角立绘用哪一张（**只可能是开局选定性别的那些图**）：
   *   最近一次干预成功 → 用"放松态"（交付说明：「D1 干预成功、情绪缓和后使用」）
   *   否则 → 该性别的正常立绘
   * 没交图时返回 null，由调用方决定"不显示"而不是"显示占位图"。
   */
  playerPortraitId(): string | null {
    const base = playerArtId('portrait.player', this.state.custom);
    if (!base) return null;
    if (this.state.logs.lastInterventionSuccess === true && this.realArt(`${base}.rest`)) return `${base}.rest`;
    return this.realArt(base) ? base : null;
  }

  /**
   * 旁观 NPC（目前只有老师）用哪一张；没有老师在场就返回 null。
   *
   * 这里**刻意不再回退到 `portrait.npc`**：那张图至今没交付，回退过去的结果是
   * 屏幕右下角永远立着一块写着"NPC｜占位立绘"的占位图 —— 玩家看到的是开发占位物，
   * 而不是"这会儿没有别人在场"。没有第二个人，就该只有一个人（居中）。
   */
  npcPortraitId(): string | null {
    const pose = this.currentMoment()?.npcPose;
    if (!pose) return null;
    if (pose === 'strict' && this.realArt('portrait.teacher.strict')) return 'portrait.teacher.strict';
    return this.realArt('portrait.teacher') ? 'portrait.teacher' : null;
  }

  /**
   * 立绘行：当前场面上的"人物图"。一个人物居中，两个人物分居左右，说话的那个亮起来。
   *
   * 走的是**正式交付的立绘**（按开局性别取图）。从前这一幕还有一个"兜底"：
   * `components/student.ts` 现画一个不分性别的通用 SVG 小人。那个兜底本身就是问题 ——
   * 玩家选了男生却看到一个说不清性别的卡通形象，而且它**越缺图越会出现**。
   * 现在它已被整个删除：没有立绘时立绘行就是空着的（那种情况下的画面由场景或插画负责，
   * 见 runDilemma 里 showArt 与 showCast 的成对调用）。
   */
  showCast(wantNpc = true): void {
    // 插画在场时不立立绘：插画本身就是"这两个人"的画面（1 张居中 / 2 张并排），
    // 再立一份立绘就成了两个主角。这里显式让位，不只依赖 CSS 的隐藏规则 ——
    // 见 UiSystem.showCg 的注释（隐藏的 DOM 会被验收脚本当成"人在场上"）。
    if (!this.ui.cgEl.hidden) { this.ui.clearCast(); return; }
    const figures: { id: string; src: string; name: string; side: 'left' | 'right' }[] = [];
    const player = this.playerPortraitId();
    const playerSrc = player ? this.realArt(player) : undefined;
    if (player && playerSrc) figures.push({ id: player, src: playerSrc, name: 'TA', side: 'left' });
    const npc = wantNpc ? this.npcPortraitId() : null;
    const npcSrc = npc ? this.realArt(npc) : undefined;
    if (npc && npcSrc) figures.push({ id: npc, src: npcSrc, name: '老师', side: 'right' });
    // 连主角立绘都没有（性别未定 / 还没交图）→ 收回立绘行，什么占位物都不画
    if (!figures.length) { this.ui.clearCast(); return; }
    this.ui.showCast(figures);
    this.setCastSpeaker('student');
  }

  /** 谁在说话：主角亮、对方暗（数值见 src/styles/base.css 的 §5.1 注释） */
  setCastSpeaker(speaker: string): void { this.ui.setCastSpeaker(speaker); }

  clearCast(): void { this.ui.clearCast(); }

  // ── 「翻页」的唯一出口 ────────────────────────────────────────────────
  // 点击（整条底部演出带）与键盘（空格 / 回车）都收敛到这里，谁负责推进当前这一步由
  // 各个阶段自己注册：
  //   打字中   → 跳过打字，整句显示完（DialogueSystem.typeInto）
  //   等下一句 → 翻到下一句 / 下一刻（DialogueSystem.waitTap）
  //   干预窗口 → 「让这一刻过去」，立刻继续（ChoiceSystem.runInteractions）
  // 从前只有点击接在这条路上、键盘自己另外挂一份，于是"打字过程中按空格没反应"
  // （点击能跳过打字、键盘不能）和"干预窗口里按空格没反应"这两件事同时存在。
  private advanceHandler: (() => void) | null = null;

  /** 当前阶段注册"这一步怎么翻页"。传 null 表示这一步不需要翻页（选项题 / 结局页） */
  setAdvanceHandler(fn: (() => void) | null): void { this.advanceHandler = fn; }

  /** 收掉自己注册的那个 handler（带身份校验：不要清掉别人刚注册的） */
  clearAdvanceHandler(fn: () => void): void { if (this.advanceHandler === fn) this.advanceHandler = null; }

  /** 翻一页。返回 false 表示当前这一步没有"翻页"这回事（例如正在做选择） */
  pressAdvance(): boolean {
    const fn = this.advanceHandler;
    if (!fn) return false;
    fn();
    return true;
  }

  /**
   * 底部演出带的点击。整条带子（含立绘行、对白框）都是点击区。
   *
   * 点到**立绘**身上 = 摸摸头（策划案 §3.4「点击小人本体」）。人像和"继续"共用同一个点击区，
   * 所以一次点击两件事都做：先摸头、再翻页 —— 绝不留下"点了没反应"的死点击
   * （立绘曾经是 pointer-events:none 的纯画面，现在它也是"小人本体"）。
   */
  private handleStageClick(e: MouseEvent): void {
    const target = e.target;
    if (target instanceof Element && target.closest('.portrait')) this.petStudent();
    this.pressAdvance();
  }

  /**
   * 空格 / 回车翻页（开发文档 §7 要求键盘可推进）。
   *
   * 只抢"确实能翻页"的那几种情况，其余一律让浏览器照旧处理：
   *   · 输入框里按空格是打字（结局页的留言瓶），不是翻页；
   *   · 焦点在干预按钮上时，空格/回车 = 按下这个按钮（浏览器默认行为）——
   *     抢过来的话，键盘用户就没法用 Tab + 回车做选择了；
   *   · 按住不放不算连翻（`e.repeat`）—— 否则"按住空格读快一点"会一路冲过干预窗口。
   */
  private readonly onAdvanceKey = (e: KeyboardEvent): void => {
    // 测试与"重新开始"会换掉整棵 DOM；根节点一旦离线就自我注销，不留悬空监听
    if (!this.root.isConnected) { window.removeEventListener('keydown', this.onAdvanceKey); return; }
    if (e.key !== ' ' && e.key !== 'Spacebar' && e.key !== 'Enter') return;
    const target = e.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
    const active = document.activeElement;
    if (active instanceof Element && active.closest('.dock .choice')) return;
    if (e.repeat) return;
    if (!this.pressAdvance()) return;
    e.preventDefault();
  };

  /**
   * 解析一组插画槽位 → 可直接上屏的图。缺失的槽位会被跳过（画面上少一张，而不是裂图）。
   *
   * 三种槽位：
   *   `pose`  → `art.d1.<who>.<pose>`（同性别回退链）
   *   `story` → `art.story.<who>.<name>`（**没有回退链**：D2 之后的图是这一天的具体画面，
   *             缺图时正确的表现是"这一刻不插画"、由底部立绘行顶上；随便借一张同类图会变成
   *             "台词说成绩单、画面在食堂"）
   *   `id`    → 原样使用（老师 / 同学这类不分性别的图）
   * 全部槽位都解析不出来时返回空数组，`showCg([])` 会收走 CG 层、露出场景与立绘行。
   */
  private resolveArt(slots?: ArtSlot[]): { src: string; id: string; alpha: boolean }[] {
    if (!slots?.length) return [];
    const out: { src: string; id: string; alpha: boolean }[] = [];
    for (const slot of slots) {
      const id = 'id' in slot ? slot.id
        : 'story' in slot ? storyArtId(slot.story, this.state.custom)
          : this.poseArtId(slot.pose);
      if (!id) continue;
      const src = this.realArt(id);
      // alpha 从资产清单读（art.spec.json 的 alpha 字段），不靠扩展名或 src 前缀猜
      if (src) out.push({ src, id, alpha: this.assets.isTransparent(id) });
    }
    return out;
  }

  /** 切换当前时刻的剧情插画；传空即收走（没有插画编排的时刻画面上就只剩场景与立绘行） */
  private showArt(slots?: ArtSlot[]): void {
    this.ui.showCg(this.resolveArt(slots));
  }

  /**
   * 按 sceneId 换整屏场景（目前只有"干预收尾换天气"用它：D6 15:00 雨天 → 提前放晴）。
   *
   * 场景 id 写错时**当场抛错**：这类错误在运行时的表现是"画面没换"，而画面没换
   * 恰恰不像是 bug（玩家只会以为这一刻本来就这样），所以不能让 it 安静地过去。
   * dataset.scene 由 SceneManager.show 统一更新，这里不用再管。
   */
  private showScene(sceneId: string): void {
    const scene = this.config.scenes[sceneId];
    if (!scene) throw new Error(`未知场景：${sceneId}`);
    this.scene.show(scene);
  }

  getNode(id: string): FlowNode | undefined { return this.config.flow.find((n) => n.id === id); }
}
