import { describe, expect, it } from 'vitest';
import { config } from '../../content';
import { flow } from '../../content/flow';
import { endings } from '../../content/endings';
import { INTERVENTION_IDS, HIDDEN_INTERVENTION_THRESHOLD } from '../../content/conditions';

// 跨文件一致性：结局的"判定条件"和"优先级分支"必须说的是同一件事。
//
// 这个测试是因为踩过一次坑才写的：endings.ts 里 clumsy 的阈值改成了 6，
// 但 flow.ts 的 ending-pick 分支里还写死着 anyInterventionAtLeast(5)，
// 于是实际游戏在 5 次就判隐藏结局，而配平测试按 6 算 —— 两边结论不一致却都"绿"。
// 凡是"同一个规则写在两个地方"的地方，都该有这种对账测试。

const endingPick = flow.find((n) => n.id === 'ending-pick');
const clumsy = endings.find((e) => e.id === 'clumsy')!;

interface CountCondition { kind: 'count'; interventionId: string; op: string; value: number }
interface OrCondition { kind: 'or'; any: CountCondition[] }

describe('内容跨文件一致性（同一规则不能写在两个地方却各说各话）', () => {
  it('ending-pick 的隐藏结局分支与 endings.clumsy 的条件一致', () => {
    expect(endingPick, 'flow 里必须有 ending-pick 分支节点').toBeTruthy();
    expect(endingPick!.kind).toBe('branch');
    const branches = (endingPick as { branches: { when?: unknown; next: string }[] }).branches;

    const hiddenBranch = branches.find((b) => b.next === 'ending-clumsy-node');
    expect(hiddenBranch, 'ending-pick 必须有一个分支指向结局 clumsy').toBeTruthy();

    // 两边都应该是"单一干预 ≥ 阈值"的 or 条件，且阈值相同
    const inFlow = hiddenBranch!.when as OrCondition;
    const inEnding = clumsy.condition as OrCondition;
    expect(inFlow.kind).toBe('or');
    expect(inEnding.kind).toBe('or');
    const flowThresholds = new Set(inFlow.any.map((c) => c.value));
    const endingThresholds = new Set(inEnding.any.map((c) => c.value));
    expect([...flowThresholds]).toEqual([HIDDEN_INTERVENTION_THRESHOLD]);
    expect([...endingThresholds]).toEqual([HIDDEN_INTERVENTION_THRESHOLD]);

    // 覆盖的干预 id 也必须一致（否则某些干预能触发结局、却走不到那个结局节点）
    expect(inFlow.any.map((c) => c.interventionId).sort()).toEqual(inEnding.any.map((c) => c.interventionId).sort());
    expect(inFlow.any.map((c) => c.interventionId).sort()).toEqual([...INTERVENTION_IDS].sort());
  });

  it('ending-pick 的四个结局分支都指向真实存在的结局，且有兜底', () => {
    const branches = (endingPick as { branches: { when?: unknown; next: string }[]; fallback?: string }).branches;
    const ids = endings.map((e) => e.id);
    for (const b of branches) {
      const node = flow.find((n) => n.id === b.next);
      expect(node, `分支指向了不存在的节点 ${b.next}`).toBeTruthy();
      const endingId = (node as { endingId?: string }).endingId;
      expect(ids, `节点 ${b.next} 指向了不存在的结局 ${endingId}`).toContain(endingId);
    }
    const fallback = (endingPick as { fallback?: string }).fallback;
    expect(fallback, 'ending-pick 必须有兜底分支，否则可能无结局可走').toBeTruthy();
    expect(flow.find((n) => n.id === fallback)).toBeTruthy();
    // 四个结局都要能被走到：三个条件分支 + 一个兜底
    expect(branches.length + 1).toBe(endings.length);
  });

  it('晴空 / 生长 的条件与 endings 里的一致', () => {
    const branches = (endingPick as { branches: { when?: unknown; next: string }[] }).branches;
    const sunnyBranch = branches.find((b) => b.next === 'ending-sunny-node')!;
    const growBranch = branches.find((b) => b.next === 'ending-grow-node')!;
    expect(sunnyBranch.when).toEqual(endings.find((e) => e.id === 'sunny')!.condition);
    expect(growBranch.when).toEqual(endings.find((e) => e.id === 'grow')!.condition);
  });

  it('结局优先级顺序是 隐藏 → 晴空 → 生长 → 雨过', () => {
    const branches = (endingPick as { branches: { next: string }[] }).branches;
    expect(branches.map((b) => b.next)).toEqual(['ending-clumsy-node', 'ending-sunny-node', 'ending-grow-node']);
  });

  it('每个 ending 节点都被 ending-pick 覆盖到（没有写了却走不到的结局）', () => {
    const reachable = new Set<string>();
    const branches = (endingPick as { branches: { next: string }[]; fallback?: string }).branches;
    for (const b of [...branches.map((x) => x.next), (endingPick as { fallback: string }).fallback]) {
      const node = flow.find((n) => n.id === b) as { endingId?: string } | undefined;
      if (node?.endingId) reachable.add(node.endingId);
    }
    expect([...reachable].sort()).toEqual(config.endings.map((e) => e.id).sort());
  });
});
