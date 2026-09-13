import { readFileSync, readdirSync } from 'node:fs';
const scriptText = readFileSync('如果有你-剧情脚本V1.md', 'utf8');
const scriptLines = scriptText.split(/\r?\n/);
const collect = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? (e.name === 'node_modules' ? [] : collect(`${dir}/${e.name}`))
    : (e.name.endsWith('.ts') || e.name.endsWith('.md') ? [readFileSync(`${dir}/${e.name}`, 'utf8')] : []));
const game = [...collect('content'), ...collect('src')].join('\n');
const norm = (s) => s.replace(/\s+/g, '').replace(/[「」]/g, '');
const gameNorm = norm(game);

// 章节标题：脚本用「## 二、第 2 天」这类；时刻标题用「### 08:00 …」或加粗行。尽量给出最近的标题。
let section = '';
const hits = [];
scriptLines.forEach((line, i) => {
  if (/^#{2,4}\s/.test(line)) section = line.replace(/^#+\s*/, '').trim();
  for (const m of line.matchAll(/「([^」]{2,})」/g)) {
    const t = m[1];
    if (!gameNorm.includes(norm(t))) hits.push({ t, line: i + 1, section, star: line.includes('★') });
  }
});
const uniq = new Map();
for (const h of hits) if (!uniq.has(h.t)) uniq.set(h.t, h);
console.log(`脚本里找不到对应实现的「」句子：${uniq.size} 句（含 src/ 与 content/ 全文检索）\n`);
for (const h of uniq.values()) console.log(`  ${h.star ? '★' : ' '} L${String(h.line).padStart(4)} [${h.section}] ${h.t}`);
