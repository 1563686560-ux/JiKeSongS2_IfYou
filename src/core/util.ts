export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function esc(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]!));
}

// 模板变量插值：{gender} → 定制答案。用于终章记忆回响。
export function interpolate(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) => vars[key] ?? match);
}

// 分钟数 → HH:MM
export function formatTime(minutes: number): string {
  const m = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

export interface GallerySection { key: string; title: string; icon: string; items: string[] }

// 图鉴分组：'' 为默认组（云朵），其余按 groupNames 命名（脚本第五章「悄悄话」子栏 = group "whisper"）
export function groupCollectibles(items: { text: string; group?: string }[], groupNames: Record<string, string>): GallerySection[] {
  const order: string[] = [];
  const buckets = new Map<string, string[]>();
  for (const item of items) {
    const key = item.group ?? '';
    if (!buckets.has(key)) { buckets.set(key, []); order.push(key); }
    buckets.get(key)!.push(item.text);
  }
  order.sort((a, b) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  return order.map((key) => ({
    key,
    title: groupNames[key] ?? (key === '' ? '云朵' : key),
    icon: key === '' ? '☁' : '💬',
    items: buckets.get(key)!,
  }));
}

export function waitForAnimEnd(el: HTMLElement, fallbackMs: number): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; el.removeEventListener('animationend', finish); resolve(); } };
    el.addEventListener('animationend', finish);
    setTimeout(finish, fallbackMs);
  });
}

const MSG_KEY = 'jks2.messages';
export function readMessages(): string[] {
  try { return JSON.parse(localStorage.getItem(MSG_KEY) ?? '[]') as string[]; } catch { return []; }
}
export function addMessage(text: string): string[] {
  const list = readMessages();
  list.push(text);
  localStorage.setItem(MSG_KEY, JSON.stringify(list));
  return list;
}
