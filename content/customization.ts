import type { CustomizationQuestion, Scalar } from '../src/types/content';

// B（玩法策划）：开局只问一件事 ——「那时候的TA，是男生还是女生」。
//
// 为什么原来的五问（发型 / 校服配色 / 闹钟 / 熄灯 / 补课日 / 假期）删掉了：
//   1) 它们**不改变主线**，只是把本来就定好的默认值交回给玩家；问六七个问题
//      会把「这是关于你的那一年」的开场稀释成一张角色创建表。
//   2) 唯一真正参与判定的那个（作息 → 睡眠时长）已经由下面的默认值兜住了，
//      见 DEFAULT_FLAGS 与 content/rules.ts 的 sleepShort。
//   3) 性别是**唯一**会换掉整套图片的答案（男生/女生两套立绘与 D1 插画），
//      所以它必须留在玩家手里。
//
// 删掉的问题不是"没了"，而是变成固定默认值：见 DEFAULT_ANSWERS / DEFAULT_FLAGS。
export const customization: CustomizationQuestion[] = [
  {
    id: 'gender', prompt: '那时候的TA，是——', type: 'options',
    options: [
      { label: '男生', value: '男生', image: 'art.customize.boy' },
      { label: '女生', value: '女生', image: 'art.customize.girl' },
    ],
  },
];

/**
 * 被删掉的滑杆/配色题原来会写进 flags 的值。
 *
 * `wakeValue` / `lightsOutValue` 是**必要的**，不是装饰：睡眠时长
 * `sleepMinutes = lightsOut → wake` 由 `settings.derivedFlags` 从这两个 flag 派生，
 * 而 content/moments.ts 里六个「睡眠不足」时刻都挂着 `sleepShort` 门控
 * （脚本《睡眠规则》：睡眠 < 7.25 小时才触发）。
 * 少了它们，这六个事件会静默消失、整周配平全部偏移 —— 所以删问题**不等于**能删数据。
 *
 * 默认作息 23:30 熄灯 → 05:50 起床 = 380 分钟（6 小时 20 分）< 435，
 * 也就是脚本设计的那条"睡不够"的路。
 *
 * 发型那题的答案**不入 state.custom**：它由性别推出（男生短发 / 女生长发），
 * 让 `state.custom` 里只有 `gender` 一个 key，正是"开局只问一件事"在数据上的样子
 * （终章回响也只回响这一句）。顺带一提：当初画发型的那套占位小人已经整个删掉了，
 * 所以现在"发型"这件事在画面上完全由正式立绘承担 —— 这也是把那一问删掉的前提。
 */
export const DEFAULT_FLAGS: Record<string, Scalar> = {
  wakeValue: 350,          // 05:50
  lightsOutValue: 1410,    // 23:30
  uniformPrimary: '#668cb2',
  uniformSecondary: '#f2f2f0',
};
