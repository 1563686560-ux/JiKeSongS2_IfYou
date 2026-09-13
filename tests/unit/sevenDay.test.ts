import { describe, expect, it } from 'vitest';
import { config } from '../../content';
import { moments } from '../../content/moments';

const ordered = Object.values(moments).sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));

describe('D1→D7 严格按天推进（严格对齐开发文档）', () => {
  it('七日时刻齐全，且每天都存在对应 day 节点', () => {
    for (let day = 1; day <= 7; day++) {
      expect(ordered.some((m) => m.day === day), `第 ${day} 天缺少时刻`).toBe(true);
      const node = config.flow.find((n) => n.id === `day-${day}`);
      expect(node?.kind, `第 ${day} 天缺少 day 节点`).toBe('day');
    }
  });

  it('同一天内时刻严格按时间升序，且跨天不回头', () => {
    for (let i = 1; i < ordered.length; i++) {
      const prev = ordered[i - 1];
      const cur = ordered[i];
      expect(cur.day).toBeGreaterThanOrEqual(prev.day);
      if (cur.day === prev.day) expect(cur.time >= prev.time).toBe(true);
    }
  });

  it('流程顺序 = day-N → 当天时刻 → 下一天，不允许跳天或自由跳转', () => {
    const journey = config.flow
      .filter((n) => n.kind === 'day' || n.kind === 'moment')
      .map((n) => (n.kind === 'day' ? `day-${n.day}` : n.momentId));
    const expected = [1, 2, 3, 4, 5, 6, 7].flatMap((day) => [
      `day-${day}`,
      ...ordered.filter((m) => m.day === day).map((m) => m.id),
    ]);
    expect(journey).toEqual(expected);
  });

  it('每个时刻的 next 指向紧邻的下一个时刻、下一天的 day 节点或结局判定', () => {
    const index = new Map(ordered.map((m, i) => [m.id, i]));
    for (const node of config.flow.filter((n) => n.kind === 'moment')) {
      if (node.kind !== 'moment') continue;
      const i = index.get(node.momentId)!;
      const nextMoment = ordered[i + 1];
      const sameDay = Boolean(nextMoment && nextMoment.day === moments[node.momentId].day);
      const expectedNext = nextMoment ? (sameDay ? nextMoment.id : `day-${nextMoment.day}`) : 'ending-pick';
      expect(node.next, `${node.momentId} 的下一目标错误`).toBe(expectedNext);
      expect(config.flow.some((n) => n.id === expectedNext)).toBe(true);
    }
  });

  it('每天第一个时刻的下一目标与前一个地点不同（必须先选择目标地点）', () => {
    for (let day = 2; day <= 7; day++) {
      const prevLast = [...ordered].reverse().find((m) => m.day === day - 1)!;
      const first = ordered.find((m) => m.day === day)!;
      expect(first.id).not.toBe(prevLast.id);
    }
  });

  it('每日守护之光符合文档：D1–D5 = 2，D6 = 3，D7 = 0', () => {
    for (const node of config.flow) {
      if (node.kind !== 'day') continue;
      const expected = node.day <= 5 ? 2 : node.day === 6 ? 3 : 0;
      expect(node.light, `第 ${node.day} 天守护之光不符`).toBe(expected);
    }
  });

  it('时刻 id 与 onceKey 都唯一，且每个时刻都带 sceneId', () => {
    const ids = ordered.map((m) => m.id);
    const onceKeys = ordered.map((m) => m.onceKey);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(onceKeys).size).toBe(onceKeys.length);
    for (const m of ordered) expect(typeof m.sceneId).toBe('string');
  });

  it('D7 关闭干预：第 7 天没有任何事件节点', () => {
    for (const m of ordered.filter((x) => x.day === 7)) expect(m.event, `${m.id} 不应有干预`).toBeUndefined();
  });

  it('事件窗口：普通事件 10 秒，D6 最后一夜 15 秒', () => {
    for (const m of ordered) {
      if (!m.event) continue;
      const expected = m.id === 'D6_2359' ? 15 : 10;
      expect(m.event.timeoutSec ?? 10, `${m.id} 窗口不符`).toBe(expected);
    }
    expect(moments['D6_2359'].event?.timeoutSec).toBe(15);
  });

  it('D2「体育课改自习」是不可干预时刻：只播台词并结算，没有干预按钮', () => {
    const m = moments['D2_1600'];
    expect(m.event).toBeUndefined();
    // 脚本原值 −10；实际生效值是它经过 MOOD_SCALE（见 content/moments.ts）缩放后的结果
    expect(m.outcome?.moodDelta).toBe(-5);
    expect(m.lines?.[0].text).toBe('好不容易的放松时间，又没了。');
  });

  it('心情数值统一按 MOOD_SCALE 缩放，且最重的扣分仍是负数', () => {
    const deltas = ordered.flatMap((m) => [
      m.outcome?.moodDelta ?? 0,
      m.event?.onTimeout?.moodDelta ?? 0,
      ...(m.event?.interactions ?? []).map((i) => i.outcome.moodDelta ?? 0),
    ]).filter((d) => d !== 0);
    // 缩放后单次变化落在 −6…+6 之间（脚本原值最大 +12 / 最小 −12）
    expect(Math.max(...deltas)).toBeLessThanOrEqual(6);
    expect(Math.min(...deltas)).toBeGreaterThanOrEqual(-6);
    // 最高分与最低分的相对关系保持脚本设计：最高是正的，最重是负的
    expect(Math.max(...deltas)).toBeGreaterThan(0);
    expect(Math.min(...deltas)).toBeLessThan(0);
  });

  it('D7 终章用的是定稿点题句，并接记忆回响与结局判定', () => {
    const finale = moments['D7_1500'];
    expect(finale.presentation).toBe('L3');
    expect(finale.lines?.map((l) => l.text)).toContain('感谢你，撑过来了。');
    expect(finale.lines?.some((l) => l.text === '谢谢你守护我。')).toBe(false);   // V1.2 已改稿
    expect(finale.next).toBe('ending-pick');
  });

  it('隐藏结局「笨拙的守护」可达：存在能累计到 5 次的干预', () => {
    const counts = new Map<string, number>();
    for (const m of ordered) for (const it of m.event?.interactions ?? []) counts.set(it.id, (counts.get(it.id) ?? 0) + 1);
    const reachable = [...counts.values()].some((c) => c >= 5);
    expect(reachable, `没有任何干预能累计到 5 次：${JSON.stringify([...counts])}`).toBe(true);
  });

  it('台词全部标注语气色（脚本的云朵灰/白/金），可收藏句都带 id（否则图鉴收不到）', () => {
    for (const m of ordered) {
      for (const l of [...(m.lines ?? []), ...(m.event?.intro ?? [])]) {
        expect(l.tone, `${m.id} 的台词缺少语气色`).toBeTruthy();
        if (l.collectible) expect(l.id, `${m.id} 的收藏句缺少 id`).toBeTruthy();
      }
      for (const it of m.event?.interactions ?? []) {
        for (const l of it.outcome.feedback ?? []) {
          if (l.collectible) expect(l.id, `${m.id}/${it.id} 的收藏句缺少 id`).toBeTruthy();
        }
      }
      for (const l of m.event?.onTimeout?.feedback ?? []) {
        if (l.collectible) expect(l.id, `${m.id} 的 miss 收藏句缺少 id`).toBeTruthy();
      }
    }
  });
});
