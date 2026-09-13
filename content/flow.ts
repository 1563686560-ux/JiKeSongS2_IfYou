import type { FlowNode } from '../src/types/content';
import { moments } from './moments';
import { growCondition, hiddenEndingCondition, sunnyCondition } from './conditions';

// D1→D7 严格线性编排：day-N → 当天所有时刻（按时间升序）→ day-(N+1) → …… → 结局判定。
// 不存在跳天、跳节点或跨天回头的可能：每个时刻的 next 只能是紧邻的下一个时刻、
// 下一天的 day 节点，或最后的 ending-pick。
const DAY_TITLES = ['陌生', '察觉', '微光', '裂缝', '微转', '风暴', '告别'];
const ordered = Object.values(moments).sort((a, b) => a.day - b.day || a.time.localeCompare(b.time));

export const flow: FlowNode[] = [];
for (let day = 1; day <= 7; day++) {
  const today = ordered.filter((m) => m.day === day);
  if (!today.length) continue;
  // 每日守护之光（脚本）：D1–D5 = 2，D6 = 3，D7 关闭干预
  flow.push({ id: `day-${day}`, kind: 'day', day, light: day <= 5 ? 2 : day === 6 ? 3 : 0, title: DAY_TITLES[day - 1], next: today[0].id });
  today.forEach((m, i) => {
    const nextMoment = i + 1 < today.length ? today[i + 1].id : day < 7 ? `day-${day + 1}` : 'ending-pick';
    flow.push({ id: m.id, kind: 'moment', momentId: m.id, next: nextMoment });
  });
}

// 结局优先级（脚本第三章）：隐藏「笨拙的守护」> 晴空 > 生长 > 雨过。
// 这里的隐藏条件必须和 endings.ts 里 clumsy 的 condition 用同一个常量：
// 之前这里写死了 anyInterventionAtLeast(5)，而 endings 已改成阈值 6，
// 结果"实际游戏在 5 次就判隐藏结局"，和配平测试算出来的结论不一致。已统一为 hiddenEndingCondition。
flow.push(
  { id: 'ending-pick', kind: 'branch', branches: [{ when: hiddenEndingCondition, next: 'ending-clumsy-node' }, { when: sunnyCondition, next: 'ending-sunny-node' }, { when: growCondition, next: 'ending-grow-node' }], fallback: 'ending-rain-node' },
  { id: 'ending-clumsy-node', kind: 'ending', endingId: 'clumsy' },
  { id: 'ending-sunny-node', kind: 'ending', endingId: 'sunny' },
  { id: 'ending-grow-node', kind: 'ending', endingId: 'grow' },
  { id: 'ending-rain-node', kind: 'ending', endingId: 'rain' },
);
