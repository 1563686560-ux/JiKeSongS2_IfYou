import { describe, expect, it } from 'vitest';
import spec from '../../content/art.spec.json';
import { campus as campusConfig } from '../../content/campus';
import { makePng, validateArt } from '../../scripts/art-lib.mjs';

// 美术交付护栏：美工交错名字/错尺寸/超大文件时必须在构建阶段就报错，
// 而不是等到画面被拉伸变形才被发现。这里测的是校验逻辑本身。
// （scripts/art.mjs 的 validateArt / makePng 是纯函数，可以直接单测。）

const SPEC = spec as unknown as Parameters<typeof validateArt>[1];
const ASSETS = (spec as { assets: Record<string, { width: number; height: number }> }).assets;

const entry = (name: string, width: number, height: number, bytes = 1024) => ({ name, width, height, bytes });

// 尺寸**从规格表读**，不写死。整套规格从 1000×650 改到 1280×720 时，
// 写死数字的断言会红一片，而红的原因和"校验逻辑坏了"完全无关 —— 这正是要避免的噪音。
const BG = ASSETS['map.classroom.background'];
const BG_SIZE = `${BG.width}×${BG.height}`;
/** 校园地图：唯一的例外，见下面那条断言 */
const CAMPUS_ID = 'map.campus.base';

describe('美术资源校验', () => {
  it('art/ 为空是合法的（全部回退占位图，游戏照常可跑）', () => {
    const res = validateArt([], SPEC);
    expect(res.ok).toBe(true);
    expect(res.delivered).toEqual([]);
    expect(res.missing.length).toBe(Object.keys(ASSETS).length);
  });

  it('尺寸与规格一致时通过', () => {
    const res = validateArt([entry('map.classroom.background.png', BG.width, BG.height)], SPEC);
    expect(res.ok, res.errors.join('\n')).toBe(true);
    expect(res.delivered).toEqual(['map.classroom.background']);
  });

  it('尺寸不对时失败，并指出实际值与要求值', () => {
    const res = validateArt([entry('map.classroom.background.png', 800, 600)], SPEC);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('800×600');
    expect(res.errors.join('\n')).toContain(BG_SIZE);
  });

  it('文件名不是有效 AssetId 时失败，并列出合法名字', () => {
    const res = validateArt([entry('教室背景.png', BG.width, BG.height)], SPEC);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('不是有效的 AssetId');
    expect(res.errors.join('\n')).toContain('map.classroom.background');
  });

  it('同一个 AssetId 交了两个文件时失败（避免改错版本）', () => {
    const res = validateArt([
      entry('overlay.rain.png', BG.width, BG.height),
      entry('overlay.rain.webp', BG.width, BG.height),
    ], SPEC);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('交了两个文件');
  });

  it('体积超标时失败（单文件构建会把图内联，体积会再 ×1.33）', () => {
    const res = validateArt([entry('overlay.rain.png', BG.width, BG.height, 5 * 1024 * 1024)], SPEC);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('体积超标');
  });

  it('不支持的格式时失败', () => {
    const res = validateArt([entry('overlay.rain.bmp', BG.width, BG.height)], SPEC);
    expect(res.ok).toBe(false);
    expect(res.errors.join('\n')).toContain('不支持的格式');
  });

  it('规格表里的每个 AssetId 都有尺寸基准，且正整数', () => {
    for (const [id, a] of Object.entries(ASSETS)) {
      expect(a.width, `${id} 缺宽度`).toBeGreaterThan(0);
      expect(a.height, `${id} 缺高度`).toBeGreaterThan(0);
      expect(Number.isInteger(a.width) && Number.isInteger(a.height), `${id} 尺寸必须是整数`).toBe(true);
    }
  });

  /**
   * 舞台基准只能有一套。铺满整个舞台的图（地点背景、叠加层、结局背景）尺寸不一致时，
   * 后果不是"报个错"而是"其中几张会被 cover 悄悄裁掉一块构图"—— 换图的人根本看不出来。
   * 立绘 / 剧情插画是另一套用途（不进 cover 舞台，走 object-fit:contain），不在此列。
   *
   * `map.campus.base` **也不在此列**，而且这是有意的：它不是"铺满舞台的环境底图"，
   * 而是一张**地图画**（人物走过的那张俯瞰图）。它有自己的比例 7:4（交接包 MAP_SIZE
   * 1344×768），路线坐标就长在这个比例上 —— 把它重采样到 16:9 会把校园横向拉长 1.6%，
   * 路网与点位就对不上了。渲染时它按 aspect-ratio 锁定比例、letterbox 放进舞台
   * （见 base.css 的 .walk-map），所以它既不需要、也不该服从舞台基准。
   * 下面第二条断言守的就是这条例外：它必须**保持**交接包的原始尺寸。
   */
  it('所有整屏舞台图（地点背景 + 叠加层 + 结局背景）共用同一套尺寸基准', () => {
    const stageIds = Object.keys(ASSETS).filter((id) =>
      (id.startsWith('map.') || id.startsWith('overlay.') || id === 'ending.card') && id !== CAMPUS_ID);
    expect(stageIds.length, '一个整屏舞台图都没有？').toBeGreaterThan(0);
    const sizes = new Set(stageIds.map((id) => `${ASSETS[id].width}×${ASSETS[id].height}`));
    expect([...sizes], `整屏舞台图尺寸不统一：${stageIds.map((id) => `${id}=${ASSETS[id].width}×${ASSETS[id].height}`).join('、')}`)
      .toEqual([BG_SIZE]);
  });

  it('校园地图保持交接包的原始尺寸与 7:4 比例（路线坐标就长在这个比例上，不能重采样）', () => {
    const campus = ASSETS[CAMPUS_ID];
    expect(campus, '校园地图没有登记进艺术资产表').toBeTruthy();
    expect(`${campus.width}×${campus.height}`).toBe('1344×768');
    // 交接包 MAP_SIZE 与 content/campus.ts 的 width/height 必须一致，
    // 否则"归一化坐标 × 底图尺寸"的换算会在两个地方各写一遍、然后漂移
    expect(campus.width).toBe(campusConfig.width);
    expect(campus.height).toBe(campusConfig.height);
    expect(Math.abs(campus.width / campus.height - 1344 / 768)).toBeLessThan(1e-9);
  });

  it('整屏舞台基准是 16:9（美工交来的环境图就是这个比例，否则就得裁画面或拉伸）', () => {
    const ratio = BG.width / BG.height;
    expect(Math.abs(ratio - 16 / 9), `舞台基准 ${BG_SIZE} 不是 16:9，收 16:9 的图时横纵缩放会不一致`).toBeLessThan(0.01);
  });

  it('生成器写出来的 PNG 能被自己解析出正确尺寸（演练工具的自我校验）', () => {
    const png = makePng(320, 420, [1, 2, 3]);
    // PNG 头：宽高在大端 16/20 字节
    expect(png.readUInt32BE(16)).toBe(320);
    expect(png.readUInt32BE(20)).toBe(420);
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });
});
