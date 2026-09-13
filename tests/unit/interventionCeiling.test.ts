import { describe, expect, it } from 'vitest';
import { config } from '../../content';
import { momentOrder } from '../../content/moments';
import { flow } from '../../content/flow';
import { HIDDEN_INTERVENTION_THRESHOLD } from '../../content/conditions';
import { endings } from '../../content/endings';

// 隐藏结局「笨拙的守护」的阈值必须落在内容能提供的上限之内。
// 每个干预消耗 1 点守护之光，光每天重置且不累积，所以
// "某干预一周最多能被选几次" = Σ_days min(当天光上限, 该干预当天出现次数)。
// 阈值超过这个上限 = 写了一个永远拿不到的结局；阈值太低又会跟最优解撞车。
// 这个测试就是那道护栏：以后改内容或改阈值，越界会直接红。

function dayLightMap(): Map<number, number> {
  const m = new Map<number, number>();
  for (const n of flow) if (n.kind === 'day') m.set(n.day, n.light);
  return m;
}

function ceilingPerIntervention(): Map<string, number> {
  const dayLight = dayLightMap();
  const ceiling = new Map<string, number>();
  for (const [day, light] of dayLight) {
    const counts = new Map<string, number>();
    for (const m of momentOrder.map((id) => config.moments![id]).filter((x) => x.day === day)) {
      for (const it of m.event?.interactions ?? []) counts.set(it.id, (counts.get(it.id) ?? 0) + 1);
    }
    for (const [id, c] of counts) ceiling.set(id, (ceiling.get(id) ?? 0) + Math.min(light, c));
  }
  return ceiling;
}

describe('隐藏结局阈值的可达上限', () => {
  it('打印各干预一周的理论上限', () => {
    const rows = [...ceilingPerIntervention().entries()].sort((a, b) => b[1] - a[1]);
    const totalLight = [...dayLightMap().values()].reduce((a, b) => a + b, 0);
    // eslint-disable-next-line no-console
    console.log('\n=== 各干预一周理论最大次数 ===\n'
      + rows.map(([id, c]) => `${id}: ${c}`).join('\n')
      + `\n全周守护之光合计 = ${totalLight} 点（= 最多能干预几次）`);
    expect(rows.length).toBeGreaterThan(0);
  });

  it(`阈值 ${HIDDEN_INTERVENTION_THRESHOLD} 不超过任何可达成上限，隐藏结局不是死结局`, () => {
    const ceiling = ceilingPerIntervention();
    const maxCeiling = Math.max(...ceiling.values());
    expect(
      HIDDEN_INTERVENTION_THRESHOLD,
      `阈值 ${HIDDEN_INTERVENTION_THRESHOLD} > 内容上限 ${maxCeiling}，隐藏结局永远拿不到。`
      + `各干预上限：${JSON.stringify([...ceiling].sort((a, b) => b[1] - a[1]))}`,
    ).toBeLessThanOrEqual(maxCeiling);
  });

  it('阈值不能低到被"最优解"顺手拿到（否则隐藏结局会盖住晴空）', () => {
    const ceiling = ceilingPerIntervention();
    // 情绪收益最高的那个干预（coverEars 在它出现的每个事件里都是最高分）
    const bestId = 'coverEars';
    const bestCeiling = ceiling.get(bestId) ?? 0;
    expect(
      HIDDEN_INTERVENTION_THRESHOLD,
      `阈值 ${HIDDEN_INTERVENTION_THRESHOLD} ≤ 最优干预 ${bestId} 的上限 ${bestCeiling}，`
      + '认真玩的玩家会顺手触发隐藏结局，晴空就永远拿不到了',
    ).toBeGreaterThan(bestCeiling);
  });

  it('隐藏结局的条件确实用的是这个阈值', () => {
    const hidden = endings.find((e) => e.id === 'clumsy')!;
    const cond = hidden.condition as { kind: string; any: { kind: string; value: number }[] };
    expect(cond.kind).toBe('or');
    expect(cond.any.length).toBeGreaterThan(0);
    for (const c of cond.any) {
      expect(c.kind).toBe('count');
      expect(c.value).toBe(HIDDEN_INTERVENTION_THRESHOLD);
    }
  });
});
