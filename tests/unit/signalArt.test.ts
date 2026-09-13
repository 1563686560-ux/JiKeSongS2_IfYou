import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import spec from '../../content/art.spec.json';
import { SIGNAL_ART, deliveredAssetIds } from '../../content/assets';
import { config } from '../../content';
import type { Signal } from '../../src/types/content';

/**
 * 情绪信号 = 图，不是字符。
 *
 * ## 这一条守的是什么
 *
 * `CloudSystem` 从前画的是六个 emoji（🌧 ◌ ✗ 💤 📱 🌫）。那是全作最后一批**占位图案**：
 * 美工早在 `如果有你-场景-Day1/如果有你/03_signals/` 交了一整套水彩信号图
 * （乌云 / 灰云 / 白云 / 金云 / 困倦碎片 / 红叉 / 孤立圆 / 手机 / 箭头 / 出口高亮，
 * 外加两张干预特效），却从来没有 AssetId 把它们接进来 —— 于是那些文件在仓库里躺了一整轮，
 * 而画面上是一颗 emoji 顶着一行 font-size。
 *
 * 这类"交付了但没接线"的缺口**不会报错**：画面看着"有东西"，只是那个东西是占位物。
 * 所以这里从两头夹：
 *   · 数据侧——内容层产出的每一个 Signal 都必须带 `asset`，且那张图必须在 art/ 里；
 *   · 源码侧——引擎里不许再出现任何 emoji，也不许再有一张 kind→字符 的表。
 */

const SPEC_ASSETS = (spec as { assets: Record<string, { alpha?: boolean; width: number; height: number }> }).assets;

const readSrc = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** 收集内容层产出的所有信号（时刻事件 + 困境 + 任何地方的声音） */
function allSignals(): { where: string; signal: Signal }[] {
  const out: { where: string; signal: Signal }[] = [];
  for (const [id, m] of Object.entries(config.moments ?? {})) {
    if (m.event?.signal) out.push({ where: `moment:${id}`, signal: m.event.signal });
  }
  for (const [id, d] of Object.entries(config.dilemmas ?? {})) {
    if (d.signal) out.push({ where: `dilemma:${id}`, signal: d.signal });
  }
  return out;
}

describe('情绪信号：占位 emoji 已经全部换成体检过的真图', () => {
  it('内容层每个时刻的信号都带 asset（没接线的信号会静默不画，等于这一刻没有信号）', () => {
    const signals = allSignals();
    // 全周带事件（L2 干预窗口）的时刻共 17 个，另有手机来电那一个是包装出来的。
    // 数量只用来保证"内容层真的接上了"，不是配平断言 —— 配平在 sevenDay/balance 那两组里。
    expect(signals.length, '信号太少了，内容层大概没接上').toBeGreaterThanOrEqual(15);
    const missing = signals.filter((s) => !s.signal.asset).map((s) => `${s.where}(kind=${s.signal.kind})`);
    expect(missing, `这些信号没有 asset，画面上什么都不会出现：${missing.join('、')}`).toEqual([]);
    // kind 只是语义标签，取图看 asset
    const kinds = new Set(signals.map((s) => s.signal.kind));
    expect(kinds.has('sleepZzz'), '卧室的睡眠事件信号不见了').toBe(true);
    expect(kinds.has('phoneWave'), '手机来电信号不见了（phoneEvent 没生效）').toBe(true);
  });

  it('每个 asset 都是已交付的美术资源（不是"登记了但没交"的空槽位）', () => {
    const delivered = new Set(deliveredAssetIds);
    for (const { where, signal } of allSignals()) {
      expect(delivered.has(signal.asset!), `${where} 的 ${signal.asset} 在 art/ 里不存在`).toBe(true);
      expect(SPEC_ASSETS[signal.asset!], `${where} 的 ${signal.asset} 没登记进 art.spec.json`).toBeTruthy();
    }
  });

  it('信号图必须标 alpha:true —— 它们是贴纸，不透明的话就是一块盖住舞台的色块', () => {
    for (const id of new Set(Object.values(SIGNAL_ART))) {
      expect(SPEC_ASSETS[id]?.alpha, `${id} 少了 alpha:true`).toBe(true);
    }
  });

  it('SIGNAL_ART 覆盖了 Signal 的每一种 kind（漏一个那种信号就不画了）', () => {
    const kinds: Signal['kind'][] = ['darkCloud', 'grayCircle', 'redCross', 'sleepZzz', 'phoneWave', 'custom'];
    for (const k of kinds) expect(SIGNAL_ART[k], `SIGNAL_ART 缺 ${k}`).toBeTruthy();
    // 六个 kind 指向六张**不同**的图：指向同一张的后果是"乌云和白云长得一样"
    expect(new Set(Object.values(SIGNAL_ART)).size).toBe(kinds.length);
  });

  it('引擎源码里不许再出现 emoji 占位字符（🌧 ◌ ✗ 💤 📱 🌫 那一批）', () => {
    const sources = {
      cloudSystem: readSrc('../../src/systems/cloudSystem.ts'),
      moments: readSrc('../../content/moments.ts'),
    };
    // emoji 与"几何图形"两块码位：🌧(U+1F327) 💤(U+1F4A4) 📱(U+1F4F1) 在 Emoji 区，
    // ◌(U+25CC) ✗(U+2717) 🌫(U+1F32B) 混在符号区 —— 一次正则全盖住。
    const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{25A0}-\u{25FF}\u{2B00}-\u{2BFF}]/u;
    for (const [name, src] of Object.entries(sources)) {
      const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'));
      const hit = code.filter((l) => EMOJI.test(l));
      expect(hit, `${name} 里还有 emoji 占位字符：\n${hit.join('\n')}`).toEqual([]);
    }
  });

  it('CloudSystem 不做 kind 判断：取图是内容层的事（引擎不认识"乌云长什么样"）', () => {
    const src = readSrc('../../src/systems/cloudSystem.ts');
    const code = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/*'));
    // 代码里不该出现 kind 的字面量比对（'darkCloud' 之类）—— 一旦出现，
    // 就说明"哪个 kind 用哪张图"又被搬回引擎了，换图要改引擎
    const kinds = ['darkCloud', 'grayCircle', 'redCross', 'sleepZzz', 'phoneWave'];
    const offenders = code.filter((l) => kinds.some((k) => l.includes(k)));
    expect(offenders, `CloudSystem 里又出现了 kind→图的映射：\n${offenders.join('\n')}`).toEqual([]);
    // 它只认 signal.asset
    expect(code.some((l) => l.includes('signal.asset'))).toBe(true);
  });
});
