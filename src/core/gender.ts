import type { AssetId } from '../types/content';

/**
 * 开局性别 → 素材后缀。**全局唯一**一处把 `custom.gender` 翻译成 `boy` / `girl` 的地方。
 *
 * 为什么值得单独一个模块：主角素材是**两套**（`portrait.player.<who>[.rest]`、
 * `art.d1.<who>.<pose>`），美术交付说明 §一.2 的硬要求是"运行时只加载对应性别的那一份，
 * 绝不让男生和女生同时出现在同一张剧情画面里"。这条判断以前在 Engine 和 DialogueSystem
 * 里各写了一遍 —— 两处一旦漂移，症状是"选了男生、某块地方却是女生"，而这既不会报错、
 * 也很难在单测里被发现。所以：只留一个出口。
 */
export type PlayerKey = 'boy' | 'girl';

/** 未定性别时返回 null —— 宁可不显图，也不猜（猜错就是男女混用） */
export function playerKeyOf(custom: Record<string, string> | undefined): PlayerKey | null {
  const gender = custom?.gender;
  if (gender === '女生') return 'girl';
  if (gender === '男生') return 'boy';
  return null;
}

/** 把 `portrait.player` 这类前缀解析成按性别的 AssetId；性别未定返回 null */
export function playerArtId(prefix: string, custom: Record<string, string> | undefined): AssetId | null {
  const who = playerKeyOf(custom);
  return who ? `${prefix}.${who}` : null;
}

/**
 * 剧情图（D2 之后）按性别解析：`{ story: 'report' }` → `art.story.<boy|girl>.report`。
 *
 * 和 D1 的姿态解析同源，只是没有姿态回退链 —— D2 之后的图是**这一天的具体画面**
 * （成绩单、食堂、排名公布……），彼此不可替代，缺图时的正确处理是"这一刻不插画"，
 * 由底部立绘行顶上，而不是随便借一张同类的图（那会变成"台词说成绩单、画面在食堂"）。
 */
export function storyArtId(name: string, custom: Record<string, string> | undefined): AssetId | null {
  const who = playerKeyOf(custom);
  return who ? `art.story.${who}.${name}` : null;
}
