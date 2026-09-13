import type { MapConfig } from '../src/types/content';
import spec from './art.spec.json';
import { ASSET_IDS } from './assets';

/**
 * 三张地点地图。当前阶段只用于"下一目标"调试入口的背景与地点名，
 * 以及为后期人物移动预留可行走基准尺寸与地点热区（hit）。
 *
 * 坐标基准**不在这里写死**：它直接取自 art.spec.json 里该地点背景图的交付尺寸。
 * 舞台基准只能有一处真相来源，否则"清单里写一个尺寸、代码按另一个尺寸裁"这种漂移
 * 迟早会发生 —— 开发文档 §14.1 专门记过这条，现在用代码而不是纪律来保证。
 * 美工 A 只替换 AssetId 对应图片，不改这里的任何东西。
 */
const sizeOf = (assetId: string): { w: number; h: number } => {
  const a = (spec.assets as Record<string, { width: number; height: number }>)[assetId];
  return { w: a.width, h: a.height };
};

const mapFor = (id: string, background: string, label: string): MapConfig => {
  const { w, h } = sizeOf(background);
  return {
    id,
    background,
    baseWidth: w,
    baseHeight: h,
    locations: [{ id, label, hit: { x: 0, y: 0, w, h } }],
  };
};

export const maps: Record<string, MapConfig> = {
  bedroom: mapFor('bedroom', ASSET_IDS.bedroomBackground, '卧室'),
  classroom: mapFor('classroom', ASSET_IDS.classroomBackground, '教室'),
  playground: mapFor('playground', ASSET_IDS.playgroundBackground, '操场'),
};
