// 美术交付 CLI：
//   node scripts/art.mjs check        校验 art/ 里的图（名字/尺寸/体积）
//   node scripts/art.mjs list         打印每个 AssetId 要交的文件名与尺寸
//   node scripts/art.mjs drill        生成一套假图并校验（替换演练），默认用完自动删除
//
// 纯逻辑都在 scripts/art-lib.mjs 里，方便单测直接 import。
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ART_DIR, SPEC, makePng, readArtDir, validateArt } from './art-lib.mjs';

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', off: '\x1b[0m' };

function cmdCheck() {
  const files = readArtDir();
  const total = Object.keys(SPEC.assets).length;
  if (!files.length) {
    console.log(`${C.yellow}art/ 里还没有正式图${C.off} —— 构建与测试会使用 content/assets.ts 里的占位图（这是允许的，游戏照常可跑）。`);
    console.log(`${C.dim}要交图请看《美术交付清单.md》，或先跑 node scripts/art.mjs drill 做一次替换演练。${C.off}`);
    return 0;
  }
  const res = validateArt(files);
  console.log(`已交付 ${res.delivered.length}/${total} 张：${res.delivered.join('、') || '（无）'}`);
  if (res.missing.length) {
    // 缺哪张、缺了之后画面会怎样，是两件事：环境类会退成带中文名的占位色块，
    // 人物类什么都不会画（缺图时那一刻由立绘行或场景顶上）。报告要说清楚，不然
    // "仍在用占位图"会让人以为画面上立着一块写着字的方块。
    const isCharacter = (id) => /^(portrait\.|art\.d1\.|art\.story\.|art\.customize\.)/.test(id);
    const chars = res.missing.filter(isCharacter);
    const envs = res.missing.filter((id) => !isCharacter(id));
    if (envs.length) console.log(`${C.dim}仍未交付（会退成占位色块）：${envs.join('、')}${C.off}`);
    if (chars.length) console.log(`${C.dim}仍未交付（人物类：缺图时什么都不画，不立占位物）：${chars.join('、')}${C.off}`);
  }
  for (const w of res.warnings) console.log(`${C.yellow}警告：${w}${C.off}`);
  if (!res.ok) {
    console.error(`\n${C.red}美术资源校验失败：${C.off}`);
    for (const e of res.errors) console.error(`  ✗ ${e}`);
    return 1;
  }
  console.log(`${C.green}美术资源校验通过。${C.off}`);
  return 0;
}

function cmdList() {
  for (const [id, a] of Object.entries(SPEC.assets)) {
    console.log(`${id}`);
    console.log(`  文件名：${a.file}.png（或 .webp / .jpg / .svg）`);
    console.log(`  尺寸：${a.width}×${a.height}   ${C.dim}${a.desc}${C.off}`);
    if (a.note) console.log(`  ${C.dim}${a.note}${C.off}`);
  }
  return 0;
}

function cmdDrill(keep) {
  mkdirSync(ART_DIR, { recursive: true });
  const palette = [[92, 124, 160], [196, 168, 132], [140, 176, 160], [110, 130, 175], [216, 196, 190], [200, 212, 220], [214, 150, 130]];
  const made = [];
  let i = 0;
  for (const [, a] of Object.entries(SPEC.assets)) {
    const file = join(ART_DIR, `${a.file}.png`);
    writeFileSync(file, makePng(a.width, a.height, palette[i++ % palette.length]));
    made.push(file);
  }
  console.log(`已生成 ${made.length} 张尺寸合规的演练假图。\n`);
  const code = cmdCheck();
  if (code === 0) {
    console.log('\n接下来人工确认三步：');
    console.log('  1) npm run build        —— 假图应被内联进 dist/index.html，且 HTML 体积明显变大');
    console.log('  2) npx vitest run       —— 全绿');
    console.log('  3) npm run test:browser —— 真浏览器里应能看到条纹假图，且零 404');
  }
  if (!keep) {
    for (const f of made) rmSync(f, { force: true });
    console.log(`\n${C.dim}演练假图已删除（art/ 回到空 → 继续用占位图）。想留着请加 --keep。${C.off}`);
  }
  return code;
}

const cmd = process.argv[2] ?? 'check';
let code = 2;
if (cmd === 'check') code = cmdCheck();
else if (cmd === 'list') code = cmdList();
else if (cmd === 'drill') code = cmdDrill(process.argv.includes('--keep'));
else console.error(`未知命令：${cmd}（可用：check / list / drill）`);
process.exit(code);
