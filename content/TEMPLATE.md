# content/ 内容交接模板（给 B / C）

> 这是 B（玩法策划）与 C（美术/文本/音频）交付内容的唯一入口。
> 引擎（`src/`）只认 `content/index.ts` 汇出的 `GameConfig`，接口定义在 `src/types/content.ts`。

## 各文件归属

| 文件 | 负责人 | 填什么 |
|------|--------|--------|
| `assets.ts` | C | 图片/音频资源注册（`AssetId → 路径`） |
| `map.ts` | B | 校园地图结构：热区坐标 + 点击去向 |
| `scenes.ts` | B/C | 场景：主题氛围 + 主角姿态 |
| `dilemmas.ts` | B | 困境：情绪信号 + 互动 + 超时结算 |
| `endings.ts` | B | 结局条件 + 台词 |
| `flow.ts` | B | 整体流程节点编排 |
| `customization.ts` | B | 开局定制问卷 |
| `index.ts` | A | 汇总（B/C 一般不动） |

## 规则

1. **所有文本、数值、资源 id 都写在这里**，不要写进 `src/`。
2. 引用的类型（`MapConfig`、`DilemmaConfig`…）来自 `../src/types/content`，编辑器会自动补全与报错。
3. 动画名（`Effect.anim.name`）是自由字符串：C 起名 → 登记到 `src/systems/animationSystem.ts` 的注册表。
4. 改内容后请递增 `index.ts` 里的 `meta.version`，触发存档迁移（收藏/定制会保留，进度重置）。

## 最小示例（一个困境）

```ts
{
  id: 'classroom-event',
  name: '被老师批评',
  sceneId: 'classroom',
  signal: { kind: 'darkCloud', intensity: 2 },
  intro: [{ text: '今天的话，好像有点太多了。', cloud: 'dark' }],
  interactions: [
    {
      id: 'coverEars',            // 唯一 id，用于统计次数
      label: '捂住耳朵',          // 调试用；正式 UI 用 C 提供的图标
      cost: 1,                    // 消耗守护之光
      outcome: {
        moodDelta: 12,
        bondDelta: 1,
        feedback: [{ id: 'c1', text: '世界安静了一秒，刚刚好。', cloud: 'gold', collectible: true }],
        effect: [{ kind: 'anim', target: 'cloud', name: 'cloudDissolve' }],
      },
    },
  ],
  timeoutSec: 10,                 // 0 = 不限时
  onTimeout: { moodDelta: -6, feedback: [{ text: '没来得及……', cloud: 'dark' }] },
  next: 'check-end',              // 困境结束后的去向节点
}
```
