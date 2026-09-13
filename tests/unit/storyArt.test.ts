import { describe, expect, it } from 'vitest';
import { moments } from '../../content/moments';
import { deliveredAssetIds, assets } from '../../content/assets';
import { STORY_SHOTS, storyAssetIds, S, C, type StoryName } from '../../content/storyArt';
import spec from '../../content/art.spec.json';
import { POSE_FALLBACK } from '../../src/core/engine';
import type { ArtSlot, D1Pose, MomentConfig } from '../../src/types/content';

/**
 * 剧情图（D2 之后的 `art.story.*`）的接入完整性。
 *
 * 这一层最容易出的错**一个都不会报错**：
 *   · 剧情里写了 `S('reprt')`（打错字）→ 那一刻静默不插画；
 *   · 表里声明"已交付"但 art/ 里没有文件 → 玩家看到的是写着中文名的占位图；
 *   · 表和 art.spec.json 的尺寸对不上 → art:check 拦得住，但只有跑构建才知道；
 *   · 表里写了落在哪个时刻、剧情里其实没挂 → 素材躺在 art/ 里没人用。
 * 所以四条都测。
 */

/** 取一个时刻引用的剧情图名字（按名字引用的 + 按 AssetId 引用的都算） */
const storyNamesOf = (m: MomentConfig): StoryName[] => {
  const slots: ArtSlot[] = [
    ...(m.art?.cg ?? []), ...(m.art?.during ?? []), ...(m.art?.success ?? []), ...(m.art?.miss ?? []),
  ];
  const out: StoryName[] = [];
  for (const s of slots) {
    if ('story' in s) { out.push(s.story as StoryName); continue; }
    // 不分性别的图用 C() 引用，落地时就是一个 art.story.* 的 AssetId —— 反查回名字
    if ('id' in s) {
      const hit = (Object.keys(STORY_SHOTS) as StoryName[]).find((n) => storyAssetIds(n).includes(s.id));
      if (hit) out.push(hit);
    }
  }
  return out;
};

/**
 * 一个插画槽位在某条性别的路线上最终会解析成哪个 AssetId —— **严格按引擎的口径**：
 *   `{ story }` → `art.story.<who>.<name>`（永远按开局性别拼，和谁引用它无关）
 *   `{ id }`    → 原样
 *   `{ pose }`  → `art.d1.<who>.<pose>`，缺图时走同性别的回退链
 * 解析不出来（解析到没交付的 id）就返回 null —— 那意味着**这一刻画面上不会出现这张图**。
 *
 * 判据用 deliveredAssetIds（≈ 引擎 realArt() 的 isPlaceholder 判断），不是"资产清单里登记了没有"：
 * 清单里**每一张**图都登记着（没交的登记成空 src / 占位图），登记 ≠ 画得出来。
 */
function resolveSlot(who: 'boy' | 'girl', slot: ArtSlot): string | null {
  const real = (id: string) => (deliveredAssetIds.includes(id) ? id : null);
  if ('id' in slot) return real(slot.id);
  if ('story' in slot) return real(`art.story.${who}.${slot.story}`);
  for (const p of [slot.pose, ...(POSE_FALLBACK[slot.pose as D1Pose] ?? [])]) {
    const hit = real(`art.d1.${who}.${p}`);
    if (hit) return hit;
  }
  return null;
}

describe('剧情图登记表与剧情引用一致', () => {
  it('剧情里引用的每个剧情图名字都在登记表里（写错名字不会静默变白屏）', () => {
    const used = new Set<string>();
    for (const m of Object.values(moments)) for (const name of storyNamesOf(m)) used.add(name);
    const unknown = [...used].filter((n) => !(n in STORY_SHOTS));
    expect(unknown, `剧情引用了登记表里没有的剧情图：${unknown.join('、')}`).toEqual([]);
    expect(used.size, '这一版至少接了几张剧情图').toBeGreaterThan(0);
  });

  it('登记表里声明的落点必须真的挂在剧情上（反过来：素材不能躺在 art/ 里没人用）', () => {
    const misplaced: string[] = [];
    for (const name of Object.keys(STORY_SHOTS) as StoryName[]) {
      for (const momentId of STORY_SHOTS[name].moments) {
        const m = moments[momentId];
        expect(m, `${name} 声明落在 ${momentId}，但这一刻不存在`).toBeTruthy();
        if (!storyNamesOf(m).includes(name)) misplaced.push(`${name} → ${momentId}`);
      }
    }
    expect(misplaced, `声明了落点却没挂上：${misplaced.join('、')}`).toEqual([]);
  });

  it('声明"已交付"的剧情图必须真的有文件；没交的要显式写 delivered:false', () => {
    const missing: string[] = [];
    for (const name of Object.keys(STORY_SHOTS) as StoryName[]) {
      const shot = STORY_SHOTS[name];
      if (shot.delivered === false) continue;
      for (const id of storyAssetIds(name)) {
        if (!deliveredAssetIds.includes(id)) missing.push(`${id}（${shot.label}）`);
      }
    }
    expect(missing, `登记表说交了、art/ 里却没有：${missing.join('、')}`).toEqual([]);
  });

  it('按性别分的剧情图，男女两份都在资产清单里（缺一份 → 某条路线那一刻没图）', () => {
    const absent: string[] = [];
    for (const name of Object.keys(STORY_SHOTS) as StoryName[]) {
      for (const id of storyAssetIds(name)) {
        if (!assets.images[id]) absent.push(id);
      }
    }
    expect(absent, `资产清单里没有登记：${absent.join('、')}`).toEqual([]);
  });

  it('登记表的尺寸与 art.spec.json 完全一致（art:check 卡的就是这个）', () => {
    const mismatched: string[] = [];
    for (const name of Object.keys(STORY_SHOTS) as StoryName[]) {
      const shot = STORY_SHOTS[name];
      for (const id of storyAssetIds(name)) {
        const s = (spec.assets as Record<string, { width: number; height: number }>)[id];
        if (!s) { mismatched.push(`${id} 不在 art.spec.json 里`); continue; }
        if (s.width !== shot.width || s.height !== shot.height) {
          mismatched.push(`${id}: 表 ${shot.width}×${shot.height} vs 规格 ${s.width}×${s.height}`);
        }
      }
    }
    expect(mismatched, mismatched.join('；')).toEqual([]);
  });

  it('真透明抠图必须在规格里标 alpha（否则会被当成照片画上卡片描边）', () => {
    const flags = (spec.assets as Record<string, { alpha?: boolean }>);
    // 这两个是当前已知的真抠图（交付源 PNG 有四角 alpha=0）
    expect(flags['art.story.girl.report']?.alpha, '女生·查看成绩单是透明抠图').toBe(true);
    expect(flags['art.story.teacher.handout']?.alpha, '老师·递出成绩单是透明抠图').toBe(true);
    // 带背景的整幅图不能标 alpha —— 标错了会把它画成"浮在场景上的抠图"
    for (const id of ['art.story.boy.report', 'art.story.boy.canteen', 'map.playground.windy']) {
      expect(flags[id]?.alpha ?? false, `${id} 是带背景的整幅图，不该标 alpha`).toBe(false);
    }
  });
});

describe('D2–D3 每个时刻都真的挂上了画面', () => {
  it('D2 七个、D3 六个时刻都有 art 编排或时相场景，没有漏网的空白时刻', () => {
    const ids = Object.keys(moments).filter((id) => /^D[23]_/.test(id));
    expect(ids.length, 'D2+D3 共 13 个时刻').toBe(13);
    const bare = ids.filter((id) => !moments[id].art && !moments[id].sceneId.match(/Morning|Night|LightsOut|Windy|Running/));
    expect(bare, `这些时刻既没有插画、也没接时相场景，会是一屏空画面：${bare.join('、')}`).toEqual([]);
  });

  it('D2–D3 的插画引用只可能是"按性别的剧情图"或"不分性别的图"，不会写死某一边的 AssetId', () => {
    const hardcoded: string[] = [];
    for (const id of Object.keys(moments).filter((i) => /^D[23]_/.test(i))) {
      const m = moments[id];
      for (const slot of [...(m.art?.cg ?? []), ...(m.art?.during ?? []), ...(m.art?.success ?? []), ...(m.art?.miss ?? [])]) {
        if (!('id' in slot)) continue;
        // 用 { id } 直接指定的只能是**不分性别**的图（老师/同学/场景）
        if (!/teacher|common|portrait\.teacher/.test(slot.id)) hardcoded.push(`${id}: ${slot.id}`);
      }
    }
    expect(hardcoded, `写死了具体性别的 AssetId（会破坏"男女互斥"）：${hardcoded.join('、')}`).toEqual([]);
  });
});

describe('D4–D7 每个时刻都真的挂上了画面', () => {
  // 交付源是按天的，所以按天核对 id 数量：漏掉一整个时刻（比如某天的"睡眠不足"）不会报错，
  // 只会安静地少一屏画面。
  const EXPECT_COUNT: Record<string, number> = {
    D4: 6,  // 0610 清晨 / 0930 排名被念出 / 1400 下午 / 1700 黄昏 / 2000 来电 / 2350 睡眠不足
    D5: 7,  // 0740 / 1000 / 1300 / 1630 / 2100 + 2101（羁绊检查点两个分支）/ 2300
    D6: 6,  // 0730 / 0830 / 1200 / 1500 / 2030 / 2359
    D7: 3,  // 0750 / 1030 / 1500 终章
  };

  it('D4–D7 的时刻数量与脚本一致（一个不落）', () => {
    for (const [day, want] of Object.entries(EXPECT_COUNT)) {
      const ids = Object.keys(moments).filter((id) => id.startsWith(`${day}_`));
      expect(ids.length, `${day} 的时刻数量`).toBe(want);
    }
  });

  it('没有"既没插画、也没换场景"的空白时刻（D4–D7 每个时刻都得有画面）', () => {
    const BASE = new Set(['bedroom', 'classroom', 'playground']);
    const ids = Object.keys(moments).filter((id) => /^D[4567]_/.test(id));
    const bare = ids.filter((id) => !moments[id].art && BASE.has(moments[id].sceneId));
    expect(bare, `这些时刻既没挂插画、也还在用基底场景，会是一屏"普通的教室/卧室"：${bare.join('、')}`).toEqual([]);
  });

  it('D4–D7 的插画同样不许写死某一边性别的 AssetId', () => {
    const hardcoded: string[] = [];
    for (const id of Object.keys(moments).filter((i) => /^D[4567]_/.test(i))) {
      const m = moments[id];
      for (const slot of [...(m.art?.cg ?? []), ...(m.art?.during ?? []), ...(m.art?.success ?? []), ...(m.art?.miss ?? [])]) {
        if (!('id' in slot)) continue;
        if (!/teacher|common|portrait\.teacher/.test(slot.id)) hardcoded.push(`${id}: ${slot.id}`);
      }
    }
    expect(hardcoded, `写死了具体性别的 AssetId（会破坏"男女互斥"）：${hardcoded.join('、')}`).toEqual([]);
  });

  it('同一张剧情图被多个时刻共用时，登记表要把它们都写出来（否则测试会漏检其中一个落点）', () => {
    // bunkSleep 是 D2/D3/D4/D5 共用的那一张"上下铺皱眉睡觉"，bondCheck 是 D5 两个分支共用
    expect(STORY_SHOTS.bunkSleep.moments).toEqual(expect.arrayContaining(['D2_0620', 'D2_2330', 'D3_2340', 'D4_2350', 'D5_2300']));
    expect(STORY_SHOTS.bondCheck.moments).toEqual(['D5_2100', 'D5_2101']);
  });

  it('这一刻的天气/背景确实会被"干预成功"换掉（D6 考后冒雨 → 提前放晴）', () => {
    const m = moments.D6_1500;
    expect(m.art?.successScene, 'D6 15:00 没有声明成功后的场景').toBe('playgroundClearing');
    expect(m.art?.successScene).not.toBe(m.sceneId);
  });

  it('没交的图必须显式写 delivered:false，并且不许偷偷挂在剧情上（缺图时那一刻不插画）', () => {
    const undelivered = Object.keys(STORY_SHOTS).filter((n) => STORY_SHOTS[n as StoryName].delivered === false);
    expect(undelivered.length, 'D4 的抬头图 + D6 的排名投影层：这一版确实没交').toBeGreaterThan(0);
    for (const name of undelivered) {
      const shot = STORY_SHOTS[name as StoryName];
      // 声明没交的图不能有落点，否则就是"剧情挂了一张永远不会出现的图"
      expect(shot.moments, `${name} 声明未交付却写了落点`).toEqual([]);
      for (const id of storyAssetIds(name as StoryName)) {
        expect(deliveredAssetIds.includes(id), `${name} 说没交，art/ 里却有文件`).toBe(false);
      }
    }
  });
});

/**
 * 「这一刻到底有没有人物图」—— 这条不变量以前没人守，于是出了这个 bug：
 * D2 08:00「成绩单来了」的干预窗口写的是 `S('crowd')`，而 crowd 是 who:'common' 的图。
 * S() 会把它拼成 `art.story.boy.crowd`（一个不存在的 AssetId），解析结果为空数组，
 * 于是那一刻的插画层被清空、画面上只剩一间空教室 + 那个丑占位小人。
 * 编译、单测、真浏览器验收全都没报错 —— 因为"少一张图"和"这一刻本来就没图"长得一模一样。
 *
 * 所以这里逐槽位、逐性别地对账：**每个挂上去的槽位都必须解析到一个已登记的资源**。
 * 缺了就会在这里红，而不是等到有人玩到第二章才发现。
 */
describe('每个插画槽位都真的解析得出图（静默不显示是这一层最贵的错）', () => {
  const KEYS = ['cg', 'during', 'success', 'miss'] as const;

  it('S()/C() 各守一边：用错入口当场抛错，不给它静默的机会', () => {
    // 不分性别的图用 S() 引用 → 会拼出 art.story.<boy|girl>.<name> 这种不存在的 id
    expect(() => S('crowd')).toThrow(/不分性别/);
    // 按性别的图用 C() 引用 → C 只接受 common/teacher
    expect(() => C('report')).toThrow(/按性别/);
    // 正确的用法照常
    expect(S('report')).toEqual({ story: 'report' });
    expect(C('crowd')).toEqual({ id: 'art.story.common.crowd' });
  });

  it('所有时刻的所有插画槽位，男女两条路线都解析得到**已交付**的图', () => {
    const broken: string[] = [];
    for (const [id, m] of Object.entries(moments)) {
      for (const key of KEYS) {
        for (const slot of m.art?.[key] ?? []) {
          for (const who of ['boy', 'girl'] as const) {
            const resolved = resolveSlot(who, slot);
            if (!resolved) broken.push(`${id}.${key} → ${JSON.stringify(slot)}（${who} 路线解析不出图）`);
          }
        }
      }
    }
    expect(broken, `这些槽位在运行时画不出任何东西（表现为"这一刻没有人物图"）：\n${broken.join('\n')}`).toEqual([]);
  });

  it('D2 成绩单那一刻：入场 / 干预窗口 / 收尾三个阶段都有画面（这次踩的就是这个坑）', () => {
    const m = moments.D2_0800;
    expect(m, 'D2_0800 不存在').toBeTruthy();
    expect(resolveSlot('boy', m.art!.cg![0]), '入场第一张').toBeTruthy();
    expect(resolveSlot('boy', m.art!.cg![1]), '入场第二张（老师递出成绩单）').toBeTruthy();
    expect(resolveSlot('boy', m.art!.during![0]), '干预窗口那张（同学聚拢围观）').toBeTruthy();
    expect(resolveSlot('girl', m.art!.during![0]), '干预窗口那张（女生路线）').toBeTruthy();
    expect(m.art!.during![0], '围观图不分性别，必须是 C() 引用的那个 id')
      .toEqual({ id: 'art.story.common.crowd' });
    // 把"那一刻的原始写法"直接钉在测试里：不分性别的图若被按性别引用，
    // 解析结果必然是空 —— 这就是当初那一个月里画面上没有人图的原因。
    expect(resolveSlot('boy', { story: 'crowd' as StoryName }), '按性别引用 common 图 → 应解析不出图').toBeNull();
  });

  it('人物类资源缺图时不画占位物（src 空串），环境类才保留带名字的占位色块', () => {
    // 未交付的人物图：立绘 / 剧情插画 / 开局形象
    for (const id of ['portrait.npc', 'portrait.player', 'art.story.boy.lookUp', 'art.story.common.rankProjection']) {
      if (deliveredAssetIds.includes(id)) continue;
      expect(assets.images[id]?.src, `${id} 缺图时还在画占位物`).toBe('');
      expect(assets.images[id]?.placeholder, `${id} 的 placeholder 标记`).toBe(true);
    }
    // 环境层的占位物保留（缺底图是"环境没交"，标出来方便对账；它不是人物替身）
    const envPlaceholder = Object.entries(assets.images).find(([id, a]) =>
      a.placeholder === true && !deliveredAssetIds.includes(id) && /^(map|overlay|ending)\./.test(id));
    if (envPlaceholder) expect(envPlaceholder[1].src, '环境占位图丢了').toMatch(/^data:image\/svg/);
  });
});
