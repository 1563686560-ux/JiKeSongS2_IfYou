// 对白偏好（自动播放 / 文字速度）——开发文档 §5.1 要求"支持逐字、跳过当前句、自动播放、文字速度和已读快进"。
//
// 单独放一个模块的原因：这些偏好在 DialogueSystem 和 UISystem 都要用到，
// 而 Unit 测试要能直接断言"速度档位怎么换算成毫秒"，不需要起引擎。

export type SpeedName = 'slow' | 'normal' | 'fast';

export interface DialoguePrefs {
  /** 自动播放：打字结束后等一会自己翻到下一句 */
  auto: boolean;
  speed: SpeedName;
}

/** 逐字基准间隔（毫秒）。内容层可以用 line.typingMs 单独覆盖。 */
export const BASE_TYPING_MS = 38;

/** 速度档位 → 倍率（越大越慢） */
export const SPEED_FACTOR: Record<SpeedName, number> = { slow: 1.7, normal: 1, fast: 0.45 };

export const SPEED_LABEL: Record<SpeedName, string> = { slow: '慢', normal: '中', fast: '快' };

/** 自动播放时，一句读完之后停留多久（再乘速度倍率，慢速给更多时间读） */
export const AUTO_DELAY_MS = 1200;

export const DEFAULT_PREFS: DialoguePrefs = { auto: false, speed: 'normal' };

const KEY = 'jks2.dialoguePrefs';

export function loadPrefs(): DialoguePrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<DialoguePrefs>;
    return {
      auto: parsed.auto === true,
      speed: parsed.speed === 'slow' || parsed.speed === 'fast' ? parsed.speed : 'normal',
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(prefs: DialoguePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* 无 localStorage（隐私模式/测试）时忽略，不影响游戏 */
  }
}

/** 这一句实际每个字要等多少毫秒 */
export function typingMsFor(line: { typingMs?: number }, speed: SpeedName): number {
  const base = line.typingMs ?? BASE_TYPING_MS;
  return Math.max(0, Math.round(base * SPEED_FACTOR[speed]));
}

/** 自动播放的停留时长（慢速读得久一点） */
export function autoDelayFor(speed: SpeedName): number {
  return Math.round(AUTO_DELAY_MS * SPEED_FACTOR[speed]);
}

const ORDER: SpeedName[] = ['slow', 'normal', 'fast'];

export function cycleSpeed(speed: SpeedName): SpeedName {
  return ORDER[(ORDER.indexOf(speed) + 1) % ORDER.length];
}

/**
 * 已读快进的键：用「来源 + 行号」而不是行 id —— 
 * 内容里大量台词没有 id（只有收藏句才有），用行号才能覆盖全部台词。
 */
export function seenKey(track: string, index: number): string {
  return `${track}#${index}`;
}
