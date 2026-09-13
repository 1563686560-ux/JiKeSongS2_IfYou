import type { Engine } from '../core/engine';
import type { Interaction, MapConfig } from '../types/content';
import { evalCondition } from '../core/runtime';
import { esc } from '../core/util';

export type MapResult = { kind: 'goto'; target: string } | { kind: 'free'; interaction: Interaction };

// 地图热区点击 + 自由干预（糖等不依赖事件的兜底）。
export class MapSystem {
  constructor(private readonly engine: Engine) {}

  async show(map: MapConfig, freeInterventions: Interaction[]): Promise<MapResult> {
    const { ui, state } = this.engine;
    ui.sceneEl.dataset.theme = 'map';
    ui.sceneEl.style.filter = '';
    ui.signalLayer.innerHTML = '';
    ui.dialogueBoxEl.hidden = true;
    ui.dialogueBoxEl.innerHTML = '';
    this.engine.audio.stopRain();
    const locations = map.locations.filter((l) => evalCondition(l.when, state) && l.target);
    ui.contentEl.innerHTML = `<div class="map-title">校园地图</div><div class="map-card">${locations.map((l) => `<button class="hotspot" data-target="${esc(l.target!)}" style="left:${(l.hit.x / map.baseWidth) * 100}%;top:${(l.hit.y / map.baseHeight) * 100}%;width:${(l.hit.w / map.baseWidth) * 100}%;height:${(l.hit.h / map.baseHeight) * 100}%"><b>${esc(l.label)}</b><small>点击前往</small></button>`).join('')}</div>`;
    ui.updateHud(state, this.engine.moodTier);
    return new Promise((resolve) => {
      for (const fi of freeInterventions) {
        const affordable = state.light >= fi.cost;
        const btn = document.createElement('button');
        btn.className = 'choice free';
        btn.disabled = !affordable;
        btn.innerHTML = `${esc(fi.label)}<small>消耗守护之光 ✦${fi.cost}</small>`;
        btn.onclick = () => { if (affordable) resolve({ kind: 'free', interaction: fi }); };
        ui.dockEl.appendChild(btn);
      }
      ui.contentEl.querySelectorAll<HTMLButtonElement>('.hotspot').forEach((hotspot) => {
        hotspot.onclick = () => resolve({ kind: 'goto', target: hotspot.dataset.target! });
      });
    });
  }
}
