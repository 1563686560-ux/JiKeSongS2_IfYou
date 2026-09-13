import { describe, expect, it } from 'vitest';
import { config } from '../../content';
import { deliveredAssetIds } from '../../content/assets';
import { HIDDEN_INTERVENTION_THRESHOLD } from '../../content/conditions';
import { createState, evalCondition, starsFor } from '../../src/core/runtime';

describe('内容契约与结局判定（对齐剧情脚本 V1.3 第三章）', () => {
  it('四个结局都已定义', () => {
    expect(config.endings.length).toBe(4);
    expect(config.endings.map((e) => e.id)).toEqual(expect.arrayContaining(['clumsy', 'sunny', 'grow', 'rain']));
  });

  it('隐藏结局「笨拙的守护」：单干预达到阈值才触发（阈值见 conditions.ts，脚本原为 5）', () => {
    const clumsy = config.endings.find((e) => e.id === 'clumsy')!;
    const s = createState(config);
    expect(evalCondition(clumsy.condition, s)).toBe(false);
    // 差一次不触发
    s.logs.interventions.coverEars = HIDDEN_INTERVENTION_THRESHOLD - 1;
    expect(evalCondition(clumsy.condition, s)).toBe(false);
    // 达到阈值就触发
    s.logs.interventions.coverEars = HIDDEN_INTERVENTION_THRESHOLD;
    expect(evalCondition(clumsy.condition, s)).toBe(true);
  });

  it('晴空结局：平均心情达到阈值且羁绊 ≥12（阈值按实测可达区间重标，脚本原为 66）', () => {
    const sunny = config.endings.find((e) => e.id === 'sunny')!;
    const s = createState(config);
    expect(evalCondition(sunny.condition, s)).toBe(false);
    const cond = sunny.condition as { all: { kind: string; value: number }[] };
    const moodNeed = cond.all.find((c) => c.kind === 'avgMood')!.value;
    s.moodHistory.push({ label: '第1天', mood: moodNeed + 5 }, { label: '第2天', mood: moodNeed + 5 });
    s.bond = 12;
    expect(evalCondition(sunny.condition, s)).toBe(true);
    s.bond = 11;   // 羁绊差一点 → 不成立
    expect(evalCondition(sunny.condition, s)).toBe(false);
  });

  it('生长结局：平均心情 ≥42', () => {
    const grow = config.endings.find((e) => e.id === 'grow')!;
    const s = createState(config);
    s.moodHistory.push({ label: '第1天', mood: 45 }, { label: '第2天', mood: 40 });
    expect(evalCondition(grow.condition, s)).toBe(true);
    s.moodHistory.length = 0;
    s.mood = 35;
    expect(evalCondition(grow.condition, s)).toBe(false);
  });

  it('雨过结局是兜底（always）', () => {
    const rain = config.endings.find((e) => e.id === 'rain')!;
    expect(evalCondition(rain.condition, createState(config))).toBe(true);
  });

  it('守护星级随羁绊分档', () => {
    expect(starsFor(config, 0)).toBe(1);
    expect(starsFor(config, 3)).toBe(2);
    expect(starsFor(config, 6)).toBe(3);
    expect(starsFor(config, 9)).toBe(4);
    expect(starsFor(config, 12)).toBe(5);
  });

  it('流程节点 id 都能解析且结局节点存在', () => {
    for (const node of config.flow) {
      if (node.kind === 'ending') {
        expect(config.endings.some((e) => e.id === node.endingId)).toBe(true);
      }
    }
  });
});

// ── D1 剧情插画（美术交付说明《三、DAY1 推荐使用流程》）────────────────────
describe('D1 剧情插画接线', () => {
  const d1 = Object.values(config.moments!).filter((m) => m.day === 1);
  const slots = (m: (typeof d1)[number]) => [
    ...(m.art?.cg ?? []), ...(m.art?.during ?? []),
    ...(m.art?.success ?? []), ...(m.art?.miss ?? []),
  ];

  it('D1 的每个时刻都挂上了插画（9 个时刻，不能只挂个别几个）', () => {
    expect(d1.length).toBe(9);
    for (const m of d1) {
      expect(slots(m).length, `${m.id} 没挂插画`).toBeGreaterThan(0);
    }
  });

  it('被当众批评那一刻按交付说明配齐了四段画面（入场/干预中/成功/失败）', () => {
    const m = config.moments!.D1_0810;
    expect(m.art?.cg?.length).toBe(1);
    // 干预窗口：主角紧绷动作 + 老师严肃批评，并排
    expect(m.art?.during?.length).toBe(2);
    expect(m.art?.success?.length).toBe(1);
    expect(m.art?.miss?.length).toBe(1);
  });

  it('按性别的图只走 pose 语义槽位，不会出现"某性别的 AssetId 被写死"', () => {
    for (const m of d1) {
      for (const s of slots(m)) {
        if ('id' in s) {
          // 直接写 id 的只允许是不分性别的图（老师）
          expect(s.id, `${m.id} 直接写死了按性别的 AssetId`).not.toMatch(/art\.d1\.(boy|girl)\./);
        }
      }
    }
  });

  it('交付的姿态覆盖了 D1 用到的所有槽位（含同性别回退后仍能命中）', () => {
    const delivered = new Set(deliveredAssetIds);
    const who = ['boy', 'girl'] as const;
    const fallback: Record<string, string[]> = {
      calm: ['sit', 'tense'], tired: ['calm', 'sit'], tense: ['strain', 'sit'],
      relax: ['sitRelax', 'calm', 'sit'], down: ['tense', 'sit'], sit: ['calm'],
      sitRelax: ['relax', 'sit'], strain: ['tense', 'sit'],
    };
    for (const g of who) {
      for (const pose of ['calm', 'tired', 'tense', 'relax', 'down', 'sit', 'sitRelax', 'strain']) {
        const chain = [pose, ...fallback[pose]].map((p) => `art.d1.${g}.${p}`);
        expect(chain.some((id) => delivered.has(id)), `${g} 的 ${pose} 连回退链都没图`).toBe(true);
      }
    }
  });

  it('男女主角的插画绝不互相回退（交付说明 §一.2 的硬要求）', () => {
    const delivered = new Set(deliveredAssetIds);
    const boyIds = [...delivered].filter((id) => id.startsWith('art.d1.boy.'));
    const girlIds = [...delivered].filter((id) => id.startsWith('art.d1.girl.'));
    expect(boyIds.length).toBeGreaterThan(0);
    expect(girlIds.length).toBeGreaterThan(0);
    // 两边的 id 集合不能有交集（交集意味着同一张图被两边共用，那就是混用）
    expect(boyIds.filter((id) => girlIds.includes(id))).toEqual([]);
  });
});
