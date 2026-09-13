import type { DilemmaConfig } from '../src/types/content';

/**
 * 事件（干预时刻）现在直接写在 content/moments.ts 的 moment.event 里，
 * 一个时刻 = 一条内容，避免"时刻表"和"事件表"两份数据互相漂移。
 * 引擎仍然保留独立的 dilemma 流程节点能力（示例与测试用），但正式七日内容不再走这里。
 */
export const dilemmas: Record<string, DilemmaConfig> = {};

