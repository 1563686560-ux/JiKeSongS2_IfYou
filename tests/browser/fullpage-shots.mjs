// 首页 / 尾页（全屏页）的真浏览器验收 + 出图。
//
// 为什么必须有一趟真浏览器：
//   jsdom 不算布局。tests/unit/fullPage.test.ts 能证明"这一层挂在 .game 上、点完被摘掉了"，
//   但证明不了任何一句关于**铺满视口**的话 —— 而这次改动的全部内容就是"这两页要铺满视口"：
//     · 它是不是真的从 (0,0) 铺到 (w,h)？
//     · 页眉 / HUD / 页脚是不是真的被盖住了（而不是"看着盖住了、其实还能点到"）？
//     · 那张天空到底是**正式交付图**还是 CSS 渐变兜底？（缺图时画面照样好看，只是没人发现缺图）
//     · 窄屏上会不会横向溢出？
//   这四条都只有真浏览器量得出来，所以这一趟不是"再跑一遍单测"。
//
// 用法：npm run preview 之后  node tests/browser/fullpage-shots.mjs
//       （或设 JKS2_URL 指向别处）
// 产出：tests/browser/shots/fullpage/*.png + 控制台里的逐条判定（失败则退出码 1）
import { chromium } from 'playwright';
import { mkdirSync, rmSync } from 'node:fs';

const BASE = process.env.JKS2_URL ?? 'http://127.0.0.1:4180/';
const OUT = 'tests/browser/shots/fullpage';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const notes = [];
let failed = 0;
function check(ok, label, detail = '') {
  if (ok) console.log(`  ✓ ${label}${detail ? `　${detail}` : ''}`);
  else { failed++; console.log(`  ✗ ${label}${detail ? `　${detail}` : ''}`); }
}

async function launchBrowser() {
  for (const attempt of [
    () => chromium.launch({ channel: 'chrome' }),
    () => chromium.launch({ channel: 'msedge' }),
    () => chromium.launch(),
  ]) {
    try { return await attempt(); } catch { /* 换下一个 */ }
  }
  throw new Error('没有可用的浏览器：Chrome / Edge / Playwright chromium 都启动失败');
}

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} (${r.failure()?.errorText ?? ''})`));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

/**
 * 全屏页的几何 + 遮挡 + 底图三项一起量。
 *
 * `elementFromPoint` 是关键的一条：`inset:0 + fixed` 只说明"盒子铺满了"，
 * 说不明"它在上层"。页眉那几颗 HUD 按钮仍然是可点的 DOM（全屏页只是盖住了它们），
 * 一旦层级或层叠上下文写错，玩家就会在全屏首页上点到背后那颗「重新开始」。
 */
async function probeFullPage(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const probes = [[2, 2], [innerWidth - 2, 2], [2, innerHeight - 2], [innerWidth - 2, innerHeight - 2], [innerWidth / 2, innerHeight / 2]];
    const hits = probes.map(([x, y]) => {
      const hit = document.elementFromPoint(x, y);
      return { x: Math.round(x), y: Math.round(y), inside: !!hit && (hit === el || el.contains(hit)), tag: hit?.className || hit?.tagName };
    });
    const hud = document.querySelector('.reset-btn');
    const hudBox = hud?.getBoundingClientRect();
    const hudHit = hudBox ? document.elementFromPoint(hudBox.x + hudBox.width / 2, hudBox.y + hudBox.height / 2) : null;
    return {
      cls: el.className,
      mood: el.dataset.mood,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      viewport: { w: innerWidth, h: innerHeight },
      position: cs.position,
      bg: cs.backgroundImage.slice(0, 40),
      bgFromAsset: cs.backgroundImage.startsWith('url("data:image/webp'),
      overflow: document.documentElement.scrollWidth - innerWidth,
      probes: hits,
      hudCovered: hud ? !(hudHit === hud || hud.contains(hudHit)) : null,
      overflowY: Math.round(el.scrollHeight - el.clientHeight),
    };
  }, sel);
}

function checkFullPage(p, label, { expectMood } = {}) {
  if (!p) { check(false, `${label} 不在场上`); return; }
  check(p.position === 'fixed', `${label} 是 fixed 全屏层`, p.position);
  check(
    p.box.x === 0 && p.box.y === 0 && p.box.w === p.viewport.w && p.box.h === p.viewport.h,
    `${label} 铺满整个视口`,
    `${p.box.w}×${p.box.h} @ ${p.box.x},${p.box.y}｜视口 ${p.viewport.w}×${p.viewport.h}`,
  );
  check(p.probes.every((h) => h.inside), `${label} 四角与中心都在这一层上（不是"看着盖住、其实能点到背后"）`, JSON.stringify(p.probes.filter((h) => !h.inside)));
  check(p.hudCovered === true, `${label} 盖住了页眉的 HUD 按钮（首页/尾页上不该点到「重新开始」）`);
  check(p.bgFromAsset, `${label} 的背景是正式交付图（内联 WebP），不是 CSS 渐变兜底`, p.bg);
  check(p.overflow <= 1, `${label} 不横向溢出`, `溢出 ${p.overflow}px`);
  if (expectMood) check(p.mood === expectMood, `${label} 的皮肤是 ${expectMood}`, `实际 ${p.mood}`);
}

async function shoot(name) {
  const path = `${OUT}/${name}.png`;
  try {
    await page.screenshot({ path });
  } catch (e) {
    // 截图偶发超时（整页 JPEG/PNG 编码 + 本机同时跑着别的东西），重试一次并记一笔。
    // 不重试的话，一趟和被测行为无关的截图失败会把整份验收判成失败。
    notes.push(`  warn 截图超时已重试：${name}（${e.name}）`);
    await page.screenshot({ path, timeout: 90000 });
  }
  notes.push(`  · ${path}`);
}

/**
 * 局部放大图（2×）：整页截图里那几朵 22px 的云被缩到十几像素，看不清"到底读不读得出来"。
 * 七日云朵是结局页唯一按数值编码的信息（三档云色），所以它值得一张原尺寸的放大图。
 */
async function shootEl(sel, name) {
  const el = page.locator(sel).first();
  if (!(await el.count())) return;
  const path = `${OUT}/${name}.png`;
  await el.screenshot({ path, scale: 'css' }).catch(() => {
    notes.push(`  warn 局部图没拍成：${name}`);
  });
  notes.push(`  · ${path}（局部）`);
}

/** 让存档里只留下"马上要进结局"的状态：dayMoods 补齐七天，结局页的七日云朵才有内容 */
async function bendSaveToEnding(nodeId) {
  return page.evaluate((node) => {
    const raw = localStorage.getItem('jks2.save');
    if (!raw) return false;
    const s = JSON.parse(raw);
    s.nodeId = node;
    s.day = 7;
    s.mood = 72;
    s.bond = 15;
    s.light = 1;
    s.playthroughs = 1;
    // 三档云色都要出现在验收图上（DEFAULT_TIERS：≥40 白 / ≥80 金）——
    // 只给中间值的话，"金云落在亮天上还看不看得见"就永远没验过。
    s.dayMoods = [
      { day: 1, mood: 38 }, { day: 2, mood: 44 }, { day: 3, mood: 51 },
      { day: 4, mood: 58 }, { day: 5, mood: 66 }, { day: 6, mood: 82 }, { day: 7, mood: 88 },
    ];
    s.logs = { ...s.logs, totalInterventions: 7, missCount: 2, collected: s.logs?.collected ?? [] };
    localStorage.setItem('jks2.save', JSON.stringify(s));
    return true;
  }, nodeId);
}

/** 从全屏页走到结局页：标题页(继续守护) → 把结局前那几句按完 */
async function runToEnding() {
  await page.waitForSelector('.title-screen', { timeout: 20000 });
  await page.click('.title-screen [data-act="resume"]');
  for (let i = 0; i < 200; i++) {
    if (await page.locator('.ending').count()) return;
    const box = page.locator('.dialogue-box:not([hidden])');
    if (await box.count()) {
      // 点一下可能正好撞上 DOM 替换（最后一句播完 → 切结局场景），重试而不是让整趟挂掉
      await box.first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(80);
      continue;
    }
    await page.waitForTimeout(100);
  }
  throw new Error('没有走到结局页');
}

console.log('\n=== 首页 / 尾页 全屏页真浏览器验收 ===');

// ── 1) 首页 · 没有存档（dim：开场那片压着雨云的天）──
await page.goto(BASE, { waitUntil: 'load' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.title-screen', { timeout: 20000 });
await page.waitForTimeout(400);
check(await page.locator('.title-screen h1').innerText() === '如果有你', '标题文案（中文未乱码）');
check(await page.locator('.title-screen .page-en').innerText() === 'If you', '英文标题在（交接包的那句 If you）');
check(await page.locator('.title-screen [data-act="start"]').count() === 1, '有「开始守护」');
check(await page.locator('.title-screen [data-act="resume"]').count() === 0, '没有存档时不出现「继续守护」');
const titleDim = await probeFullPage(page, '.title-screen');
checkFullPage(titleDim, '首页（无存档）', { expectMood: 'dim' });
await shoot('01-title-dim-desktop');

/**
 * 悬停必须**看得出来**。
 * 文字按钮没有底板，"能不能点"全靠那条下划线与悬停反馈；而悬停那道光是按心情给的
 * （深底暖光 / 亮底墨影）—— 亮天空上打白光等于没打，也就是"这颗按钮悬停没反应"。
 * 这种事只有量计算样式才发现得了（截图上一点点光晕，人眼未必较真）。
 *
 * 用 `mouse.move` 到元素中心，而不是 `locator.hover()`：后者要求元素"stable"
 * （两帧之内包围盒不变），而这里的悬停**故意**会让它上移 2px —— 实测偶发超时，
 * 于是整趟验收以一个和被测行为无关的动作失败收场。移鼠标只做"指针在不在它上面"这一件事。
 */
async function checkHover(sel, label) {
  const on = page.locator(sel).first();
  const style = () => on.evaluate((el) => { const cs = getComputedStyle(el); return { t: cs.transform, s: cs.textShadow }; });
  const box = await on.boundingBox();
  if (!box) { check(false, `${label} 量不到位置`); return; }
  await page.mouse.move(0, 0);
  await page.waitForTimeout(120);
  const before = await style();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(350);
  const after = await style();
  check(after.t !== before.t, `${label} 悬停会抬起（transform 变了）`, `${before.t} → ${after.t}`);
  check(after.s !== before.s, `${label} 悬停那道光在这一档心情下看得见（text-shadow 变了）`, `${before.s} → ${after.s}`);
  await page.mouse.move(0, 0);
}
await checkHover('.title-screen [data-act="start"]', '首页(dim)「开始守护」');
await shootEl('.title-screen__actions', '01b-title-actions-dim-hover');

// ── 2) 首页 · 窄屏（不能横向溢出，也不能把两块挤到一起）──
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const titleMobile = await probeFullPage(page, '.title-screen');
checkFullPage(titleMobile, '首页（390×844）');
const titleFit = await page.evaluate(() => {
  const head = document.querySelector('.title-screen__heading').getBoundingClientRect();
  const acts = document.querySelector('.title-screen__actions').getBoundingClientRect();
  const start = document.querySelector('.title-screen [data-act="start"]').getBoundingClientRect();
  return {
    gap: Math.round(acts.top - head.bottom),
    headTop: Math.round(head.top),
    startBottom: Math.round(start.bottom),
    viewportH: innerHeight,
  };
});
check(titleFit.gap > 20, '窄屏上标题与按钮没有挤在一起', JSON.stringify(titleFit));
check(titleFit.startBottom <= titleFit.viewportH, '窄屏上按钮没有跑到屏幕外', JSON.stringify(titleFit));
await shoot('02-title-dim-mobile');

// ── 3) 点「开始守护」：全屏层必须消失，并且 HUD 重新变得可点 ──
await page.setViewportSize({ width: 1440, height: 810 });
await page.click('.title-screen [data-act="start"]');
await page.waitForSelector('.title-screen', { state: 'detached', timeout: 5000 });
const afterStart = await page.evaluate(() => {
  const hud = document.querySelector('.reset-btn');
  const b = hud.getBoundingClientRect();
  const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
  return { title: document.querySelectorAll('.title-screen').length, hudReachable: hit === hud || hud.contains(hit) };
});
check(afterStart.title === 0, '点完之后全屏首页被摘掉（否则会顶着一整页天空玩到底）');
check(afterStart.hudReachable, '点完之后 HUD 恢复可点（全屏层没有留下来挡着）');
// 答掉开局问卷，让存档落地（下面要靠它把状态掰到"马上进结局"）。
// 注意这一问有**两颗**按钮（男生 / 女生），而 `page.click(选择器)` 不是严格模式：
// 它会把第一颗解析成 element handle，一旦答完问卷被 DOM 替换掉，它就一直重试那个
// 已经不存在的节点，直到 30 秒超时 —— 整趟验收以一个和被测行为无关的动作失败收场。
// 所以统一用 locator（每次重试都重新查）加短超时 + 吞掉异常，让循环自己决定下一步。
for (let i = 0; i < 40; i++) {
  const choice = page.locator('.custom .choice').first();
  if (await choice.count()) { await choice.click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(150); continue; }
  if (await page.locator('.debug-target').count()) break;
  await page.waitForTimeout(100);
}

// ── 4) 尾页 · 晴空（gentle：晒得暖的天）；顺带看**有存档时的首页**也是 gentle ──
check(await bendSaveToEnding('ending-sunny-node'), '把存档掰到"马上进晴空"，并补齐七日心情');
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.title-screen', { timeout: 20000 });
await page.waitForTimeout(400);
const titleGentle = await probeFullPage(page, '.title-screen');
checkFullPage(titleGentle, '首页（有存档）', { expectMood: 'gentle' });
check(await page.locator('.title-screen [data-act="resume"]').count() === 1, '有存档时出现「继续守护」');
await shoot('03-title-gentle-desktop');

await runToEnding();
await page.waitForTimeout(400);
const endGentle = await probeFullPage(page, '.ending');
checkFullPage(endGentle, '尾页（晴空）', { expectMood: 'gentle' });
check(await page.locator('.ending-card h1').innerText() === '晴空', '结局名是「晴空」', await page.locator('.ending-card h1').innerText());
check(await page.locator('.history-cloud').count() === 7, '七日云朵齐全', `${await page.locator('.history-cloud').count()} 朵`);
check(await page.locator('.ending-stats .stars').count() === 1, '守护星级在');
check(await page.locator('.bottle input').count() === 1, '留言瓶在');
const endActions = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.ending [data-restart], .ending [data-gallery], .ending [data-title]')];
  return {
    n: btns.length,
    clickable: btns.every((b) => {
      const r = b.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === b || b.contains(hit);
    }),
    bottom: Math.max(...btns.map((b) => Math.round(b.getBoundingClientRect().bottom))),
    viewportH: innerHeight,
  };
});
check(endActions.n === 3 && endActions.clickable, '结局页三个出口都在、且真的点得到（没有别的层压在上面）', JSON.stringify(endActions));
check(endActions.bottom <= endActions.viewportH, '三个出口都在视口内', JSON.stringify(endActions));
await shoot('04-ending-sunny-desktop');
await shootEl('.history-row', '04b-ending-clouds-sunny');
await shootEl('.ending-actions', '04c-ending-actions-sunny');
await checkHover('.ending [data-restart]', '尾页(gentle)「再守护一次」');

// ── 5) 尾页 · 雨过（dim：雨刚过的那片天）—— 两档皮肤都要在真机上过一遍 ──
check(await bendSaveToEnding('ending-rain-node'), '把存档掰到"马上进雨过"');
await page.reload({ waitUntil: 'load' });
await runToEnding();
await page.waitForTimeout(400);
const endDim = await probeFullPage(page, '.ending');
checkFullPage(endDim, '尾页（雨过）', { expectMood: 'dim' });
check(await page.locator('.ending-card h1').innerText() === '雨过', '结局名是「雨过」', await page.locator('.ending-card h1').innerText());
await shoot('05-ending-rain-desktop');

// ── 6) 尾页 · 窄屏 ──
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
const endMobile = await probeFullPage(page, '.ending');
checkFullPage(endMobile, '尾页（390×844）');
const cardScroll = await page.evaluate(() => {
  const card = document.querySelector('.ending-card');
  return { scrollH: card.scrollHeight, clientH: card.clientHeight, canScroll: card.scrollHeight <= card.clientHeight || getComputedStyle(card).overflowY === 'auto' };
});
check(cardScroll.canScroll, '窄屏上结算内容放不下时可以在卡片内滚动（不裁内容、不撑破视口）', JSON.stringify(cardScroll));
await shoot('06-ending-rain-mobile');

// ── 7) 单文件构建：这一趟不该有任何外部请求 / 控制台报错 ──
check(failedRequests.length === 0, '没有 404 / 加载失败（两张天空图已内联进 HTML）', failedRequests.slice(0, 5).join(' | '));
check(consoleErrors.length === 0, '控制台没有错误', consoleErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n出图：');
for (const n of notes) console.log(n);
console.log(`\n=== ${failed === 0 ? '全部通过' : `${failed} 条失败`} ===`);
process.exit(failed === 0 ? 0 : 1);
