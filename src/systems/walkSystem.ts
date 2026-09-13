import type { Engine } from '../core/engine';
import type { CampusConfig, CampusRoute, Point } from '../types/content';
import { MOVE_ART, type MoveDir, type MoveGender } from '../../content/assets';
import { playerKeyOf } from '../core/gender';
import { esc } from '../core/util';

/**
 * 人物自动移动转场。
 *
 * ## 它替换掉的是什么
 *
 * 从前换地点是 `UiSystem.locationTransition()`：一块铺满屏幕的深蓝底 + 一行居中的地点名，
 * 淡入淡出 0.9 秒。信息是给了（"现在去教室"），但**人物自己走过去这件事没有发生** ——
 * 玩家看到的是一个加载画面，不是一个校园。
 *
 * ## 它不是什么
 *
 * 这**不是玩法**：没有摇杆、没有碰撞、没有寻路自由移动，玩家也不能控制方向。
 * 交接包 `map_routes.ts` 里那套 `MapCharacterMover`（速度、换帧、四方向）被完整保留下来
 * 做成一趟**过场**：路线由内容层定死（`content/campus.ts`），玩家能做的只有
 * **加速**和**跳过**。开发计划里"能不能自己走"这件事明确押后，所以这里一行都不多做。
 *
 * ## 节奏上有两条出路（这是关键）
 *
 * 宿舍→教学楼按交接包的速度（0.22 坐标/秒）要 3.6 秒。四十三次换地点都等 3.6 秒是不能接受的，
 * 所以：
 *   · **加速**按钮：×1 → ×3 → ×1 循环切换，按一下就把剩下的路快进；
 *   · **回车 / 空格**：直接到终点（和翻页同一个键，不引入新的肌肉记忆）。
 * 两者都只改变"这趟走多久"，不改变路线与终点 —— 跳过不等于没走过去，
 * 到达后该进的场景、该更新的 `state.locationId` 全都照旧。
 *
 * ## 为什么不是永久 rAF 循环
 *
 * 走路期间用 `requestAnimationFrame`，走完立刻 `cancel`（`stop()`），
 * 页面回到纯事件驱动。和"打字机"用的是同一套思路：动画是**一段有始有终的过程**，
 * 不是常驻的 60fps 循环。人一旦离开页面（`isConnected === false`）也会自我了断。
 */
export class WalkSystem {
  constructor(private readonly engine: Engine) {}

  /** 交接包速度（0.22 坐标/秒）→ 走完这条路线要多少毫秒 */
  private durationOf(route: CampusRoute, campus: CampusConfig, speed: number): number {
    let length = 0;
    for (let i = 0; i < route.points.length - 1; i++) {
      const a = route.points[i];
      const b = route.points[i + 1];
      length += Math.hypot(b.x - a.x, b.y - a.y);
    }
    const ms = (length / Math.max(speed, 0.0001)) * 1000;
    return Math.min(ms, campus.maxMs ?? 6000);
  }

  /**
   * 从 `fromLocationId` 走到 `toLocationId`。
   *
   * 返回 `true` 表示真的播了一段走路；`false` 表示这条路走不了（没配地图 / 地点没变 /
   * 点位对不上），调用方应当退回到原来的"地点名淡入淡出"。
   * **不抛错**：转场是表现层，内容里多一个地点不该让整局游戏崩掉。
   */
  async play(fromLocationId: string, toLocationId: string, targetLabel: string): Promise<boolean> {
    const { ui, state, config } = this.engine;
    const campus = config.campus;
    const walkMs = config.settings?.walkMs;
    if (walkMs === 0 || !campus) return false;

    const who = playerKeyOf(state.custom);
    // 「游戏地点 → 地图点位」的翻译完全由内容层的数据给出（CampusLocation.serves / servesWho），
    // 所以这里只是两次检索，没有任何 if：引擎不认识"宿舍"，也不知道宿舍分男女。
    const nodeOf = (locationId: string): string => {
      if (!locationId) return '';
      return campus.locations.find((l) => l.serves === locationId && (!l.servesWho || l.servesWho === who))?.id ?? '';
    };
    const from = nodeOf(fromLocationId);
    const to = nodeOf(toLocationId);
    if (!from || !to || from === to) return false;
    const route = campus.routes.find((r) => r.from === from && r.to === to);
    if (!route || route.points.length < 2) return false;

    const speed = config.settings?.walkSpeed ?? campus.speed;
    const totalMs = walkMs ?? this.durationOf(route, campus, speed);
    if (totalMs <= 0) return false;

    ui.resetLayers();
    return this.run(route, campus, totalMs, targetLabel, who ?? 'boy');
  }

  private run(
    route: CampusRoute,
    campus: CampusConfig,
    totalMs: number,
    targetLabel: string,
    gender: MoveGender,
  ): Promise<boolean> {
    const { ui } = this.engine;
    const goal = route.points[route.points.length - 1];

    ui.sceneEl.dataset.theme = 'map';
    ui.sceneEl.dataset.scene = 'campus-walk';
    // 底图按原生比例 letterbox 放进舞台（CSS 的 aspect-ratio），
    // 所以 `left/top` 的百分比与图上画的马路严格对齐 —— 用 background-size:cover
    // 会因为裁切让"人物位置"和"背景上的路"错开几个像素，越靠边越明显。
    ui.sceneEl.style.setProperty('--campus-w', String(campus.width));
    ui.sceneEl.style.setProperty('--campus-h', String(campus.height));
    const bg = this.engine.assets.url(campus.background);

    ui.contentEl.innerHTML = `
      <div class="walk">
        <div class="walk-stage">
          <div class="walk-map"
            data-from="${esc(route.from)}" data-to="${esc(route.to)}"
            data-points="${esc(route.points.map((p) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`).join(';'))}"
            ${bg ? `style="background-image:url('${esc(bg)}')"` : ''}>
            <div class="walk-goal" style="left:${goal.x * 100}%;top:${goal.y * 100}%"><i></i><span>${esc(targetLabel)}</span></div>
            <img class="walk-actor" alt="" data-walk="${gender}" src="${esc(this.frameSrc(gender, 'down', 1))}" style="left:${route.points[0].x * 100}%;top:${route.points[0].y * 100}%">
          </div>
        </div>
        <div class="walk-bar">
          <b>前往 ${esc(targetLabel)}</b>
          <div class="walk-actions">
            <button class="walk-btn" data-walk-act="fast" type="button" aria-pressed="false">加速 ×1</button>
            <button class="walk-btn" data-walk-act="skip" type="button">回车跳过</button>
          </div>
        </div>
      </div>`;

    const stage = ui.contentEl.querySelector<HTMLElement>('.walk-stage')!;
    const mapEl = ui.contentEl.querySelector<HTMLElement>('.walk-map')!;
    const actor = ui.contentEl.querySelector<HTMLImageElement>('.walk-actor')!;
    const fastBtn = ui.contentEl.querySelector<HTMLButtonElement>('[data-walk-act="fast"]')!;
    const skipBtn = ui.contentEl.querySelector<HTMLButtonElement>('[data-walk-act="skip"]')!;

    /**
     * 把地图**等比**放进可用区（contain），并把算出来的像素尺寸写到元素上。
     *
     * 为什么在 JS 里算：地图是 7:4，舞台可用区实测约 1.45，两者差 17%。
     * CSS 的 `width:100%;height:100%` 会让 aspect-ratio 失效（两轴都成确定值）→ 地图被纵向拉伸；
     * 只给 `width:100%` 又会在窄高屏上溢出高度。算一次 contain 是两种屏幕都对的做法，
     * 而且算出来的盒子就是"画出来的那张图"，百分比定位因此与地图上的马路严格对齐。
     */
    const fit = (): void => {
      const box = stage.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return;
      const scale = Math.min(box.width / campus.width, box.height / campus.height);
      mapEl.style.width = `${Math.round(campus.width * scale)}px`;
      mapEl.style.height = `${Math.round(campus.height * scale)}px`;
    };
    fit();
    window.addEventListener('resize', fit);

    return new Promise<boolean>((resolve) => {
      // ── 状态：整条路线按"已走过多少长度"推进，而不是按段号 ──
      // 按长度推进的好处是拐弯处不会出现"走到段尾还差一帧才转向"的抽搐，
      // 方向每帧都由**当前所在段**重算（交接包 getDirection 的规则：主轴决定朝向）。
      const cumulative: number[] = [0];
      for (let i = 0; i < route.points.length - 1; i++) {
        cumulative.push(cumulative[i] + Math.hypot(route.points[i + 1].x - route.points[i].x, route.points[i + 1].y - route.points[i].y));
      }
      const totalLength = cumulative[cumulative.length - 1] || 1;

      let travelled = 0;
      let lastTs = 0;
      let frame: 1 | 2 = 1;
      let frameElapsed = 0;
      let speedMul = 1;
      let raf: number | null = null;
      let settled = false;

      const pointAt = (distance: number): { point: Point; dir: MoveDir; index: number } => {
        const d = Math.max(0, Math.min(distance, totalLength));
        let index = 0;
        while (index < cumulative.length - 2 && cumulative[index + 1] < d) index++;
        const a = route.points[index];
        const b = route.points[Math.min(index + 1, route.points.length - 1)];
        const segLen = cumulative[index + 1] - cumulative[index];
        const t = segLen > 0 ? (d - cumulative[index]) / segLen : 0;
        const point = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        // 交接包 getDirection：主轴决定朝向，相等时优先上下
        const dir: MoveDir = Math.abs(dx) > Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
        return { point, dir, index };
      };

      const paint = (distance: number): void => {
        const { point, dir } = pointAt(distance);
        actor.style.left = `${point.x * 100}%`;
        actor.style.top = `${point.y * 100}%`;
        actor.dataset.dir = dir;
        // 把"现在走到哪儿了"挂到 DOM 上（归一化坐标 + 0..1 进度）。
        // 纯数据属性，不参与样式；用途是让验收能**在任意时刻**对账
        // "归一化坐标 → 像素"这套换算是不是与地图上的马路对齐 ——
        // 只看 t=0 是不够的，而真机验收根本抓不到 t=0（转场条一出现就已经走了几百毫秒）。
        actor.dataset.point = `${point.x.toFixed(5)},${point.y.toFixed(5)}`;
        actor.dataset.progress = (totalLength > 0 ? Math.min(distance / totalLength, 1) : 1).toFixed(5);
        actor.src = this.frameSrc(gender, dir, frame);
      };

      const cleanup = (): void => {
        if (raf !== null) cancelAnimationFrame(raf);
        raf = null;
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('resize', fit);
        actor.remove();
        ui.contentEl.innerHTML = '';
      };

      const finish = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };

      // 走完最后一帧 -> 停在终点、亮出到达姿态，再交还控制权
      const tick = (ts: number): void => {
        if (settled) return;
        if (!this.engine.root.isConnected) { settled = true; cleanup(); resolve(false); return; }
        const last = lastTs || ts;
        const dt = Math.min(ts - last, 80); // 切后台回来别一次性冲过整条路
        lastTs = ts;

        travelled += (totalLength * dt * speedMul) / totalMs;

        frameElapsed += dt * speedMul;
        if (frameElapsed >= campus.frameIntervalMs) {
          frameElapsed = 0;
          frame = frame === 1 ? 2 : 1;
        }
        paint(travelled);

        if (travelled >= totalLength) { paint(totalLength); finish(); return; }
        raf = requestAnimationFrame(tick);
      };

      const fast = (): void => {
        speedMul = speedMul === 1 ? 3 : 1;
        fastBtn.textContent = `加速 ×${speedMul}`;
        fastBtn.setAttribute('aria-pressed', String(speedMul !== 1));
        fastBtn.classList.toggle('on', speedMul !== 1);
      };

      // 跳过 = 直接站到终点。仍然走 `finish()` 同一条路，
      // 所以"跳过"和"走完"对引擎而言是同一件事（不会漏掉任何一个后续步骤）。
      const skip = (): void => { paint(totalLength); finish(); };

      const onKey = (e: KeyboardEvent): void => {
        if (e.key !== ' ' && e.key !== 'Spacebar' && e.key !== 'Enter') return;
        if (e.repeat) return;
        // 焦点在"加速"按钮上时，空格是按下那个按钮（浏览器默认行为），不抢
        const active = document.activeElement;
        if (active === fastBtn || active === skipBtn) return;
        e.preventDefault();
        skip();
      };

      // 点完把焦点还回去（`btn.blur()`），和 UiSystem.handBackFocus 是同一条规矩。
      // 不还的话有个真机上一定会踩的坑：鼠标点过「加速」之后按回车，浏览器会把回车
      // 派给这个**还带着焦点**的按钮（= 再切一次加速），而不是跳过 —— 玩家会觉得"回车不管用"。
      // 真机验收就是在这里抓到的：跳过之后场景没换，页面停在 campus-walk 上。
      // 主动 Tab 到按钮上的键盘用户不受影响：那时焦点是用户自己放的，回车该按按钮。
      fastBtn.onclick = (e) => { e.stopPropagation(); fast(); fastBtn.blur(); };
      skipBtn.onclick = (e) => { e.stopPropagation(); skip(); };
      // 整块转场也是"跳过"的点击区：和游戏别处"点哪儿都能继续"一致。
      // 加速按钮要 stopPropagation，否则按加速会顺手把整段路跳掉。
      (ui.contentEl.querySelector<HTMLElement>('.walk')!).onclick = skip;
      window.addEventListener('keydown', onKey);
      paint(0);
      raf = requestAnimationFrame(tick);
    });
  }

  private frameSrc(gender: MoveGender, dir: MoveDir, frame: 1 | 2): string {
    const id = MOVE_ART[gender][dir][frame - 1];
    return this.engine.assets.url(id);
  }
}
