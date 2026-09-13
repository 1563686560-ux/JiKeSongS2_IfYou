import type { Engine } from '../core/engine';
import type { SceneConfig } from '../types/content';
import { esc } from '../core/util';

/**
 * 场景层：底图 + 地点名 + 叠加层（雨幕 / 教室时相光）。
 *
 * **场景里不再画人。** 从前这里还有一层 `.student-layer`，里面是 `components/student.ts`
 * 现画的通用 SVG 小人（不分工种、不分性别的卡通占位形象）。真立绘交付之后它就该退场了 ——
 * 玩家选了男生却看到一个通用小人，"选谁就是谁"这条要求是落空的；而两条路线各交了一张
 * 320×420 的正式立绘之后，通用的那个小人**只在缺图时兜底**，也就是"画面越少越丑的时候它越会出现"。
 * 现在整个删掉：场景只负责环境，人物一律由立绘行（Engine.showCast）或剧情插画负责，
 * 谁都不在场上时画面就是干净的一间教室，而不是一个丑占位物。
 */
export class SceneManager {
  constructor(private readonly engine: Engine) {}

  show(scene: SceneConfig): void {
    const { ui } = this.engine;
    ui.sceneEl.dataset.theme = scene.theme ?? 'day';
    // 换场景就更新"现在进的是哪个场景"。**放在这里而不是各个调用点**：
    // 结局与记忆回响那条路上（runEnding）也要换场景，漏标一次，真浏览器验收就会
    // 拿着上一幕的 sceneId 去对账（截图看着正常、断言全错）。
    ui.sceneEl.dataset.scene = scene.id;
    ui.sceneEl.style.filter = '';
    ui.sceneEl.classList.remove('zooming', 'clearing');
    const background = scene.background ? this.engine.assets.url(scene.background) : '';
    const overlays = (scene.overlays ?? []).map((id) => `<img class="scene-overlay" alt="" src="${esc(this.engine.assets.url(id))}">`).join('');
    ui.contentEl.innerHTML = `<div class="scene-background" ${background ? `style="background-image:url('${esc(background)}')"` : ''}></div><div class="location-title">${esc(scene.name)}</div>${overlays}`;
    ui.signalLayer.innerHTML = '';
    ui.dockEl.innerHTML = '';
    // 换场景 = 换一幕，先把上一幕的立绘行收掉；本幕的立绘由 Engine.showCast() 在
    // scene.show() 之后重新立起来（顺序不能反：show 会清空，立早了会被清掉）。
    ui.clearCast();
    ui.sceneEl.querySelector('.countdown')?.remove();
    ui.dialogueBoxEl.hidden = true;
    ui.dialogueBoxEl.innerHTML = '';
    this.engine.resetPet();
    if (scene.theme === 'rain') this.engine.audio.rain(); else this.engine.audio.stopRain();
    this.engine.cloud.setMood();
    ui.updateHud(this.engine.state, this.engine.moodTier);
  }
}
