import type { Engine } from '../core/engine';
import type { GameState } from '../core/runtime';

export interface DebugApi {
  getState: () => GameState;
  goto: (nodeId: string) => void;
  setMood: (value: number) => void;
  setLight: (value: number) => void;
  addBond: (value: number) => void;
  reset: () => void;
  dumpConfig: () => unknown;
}

// 仅开发环境挂载到 window.gameDebug，供 AI Agent / 控制台直达节点与数值。
export function installDebug(engine: Engine): void {
  if (!import.meta.env.DEV) return;
  const api: DebugApi = {
    getState: () => engine.state,
    goto: (nodeId: string) => { void engine.run(nodeId); },
    setMood: (value: number) => engine.setMood(value),
    setLight: (value: number) => engine.setLight(value),
    addBond: (value: number) => engine.addBond(value),
    reset: () => engine.restart(),
    dumpConfig: () => engine.config,
  };
  (window as unknown as { gameDebug?: unknown }).gameDebug = api;
}
