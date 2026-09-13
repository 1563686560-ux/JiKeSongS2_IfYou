// 真浏览器验收：情绪信号图（替代 emoji）+ 人物自动移动转场。
//
// 为什么非要在真浏览器里做这一段：
//   · jsdom **不计算布局**，所以"地图有没有铺满舞台""小人是不是正好站在路线上"
//     "信号图有没有大到看得见"这三类问题它一律测不出来；
//   · jsdom 默认连 requestAnimationFrame 都没有（vite.config.ts 里专门开了
//     pretendToBeVisual 才补上），逐帧动画的真实验证只能在浏览器里做；
//   · 大人·小人这件事本身是**观感**问题，只能量像素。
//
// 用法：npm run preview（另开一个终端）→ node tests/browser/walk-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.JKS2_URL ?? 'http://127.0.0.1:4180/';
const SHOTS = 'tests/browser/shots/walk';
mkdirSync(SHOTS, { recursive: true });

/** 交接包 MAP_SIZE / content/campus.ts 的底图基准 —— 断言里的期望值都从这儿来 */
const MAP_W = 1344;
const MAP_H = 768;
/** 交接包 LOCATIONS：男生宿舍（选男生时的出发点） */
const BOY_DORM = { x: 0.19, y: 0.565 };

const failures = [];
const notes = [];
function check(ok, label, detail = '') {
  if (ok) notes.push(`  ok   ${label}`);
  else failures.push(`  FAIL ${label}${detail ? `  — ${detail}` : ''}`);
}

async function shoot(opts) {
  try { await page.screenshot(opts); } catch (e) {
    notes.push(`  warn 截图超时已重试：${opts.path ?? ''}（${e.name}）`);
    await page.screenshot({ ...opts, timeout: 90000 });
  }
}

async function launch() {
  for (const attempt of [
    () => chromium.launch({ channel: 'chrome' }),
    () => chromium.launch({ channel: 'msedge' }),
    () => chromium.launch(),
  ]) {
    try { return await attempt(); } catch { /* 换下一个 */ }
  }
  throw new Error('没有可用的浏览器：Chrome / Edge / Playwright chromium 都启动失败');
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });

const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(BASE, { waitUntil: 'load' });
await page.waitForSelector('.title-screen', { timeout: 15000 });

// ── 一路推到 D1_0740（第一次换地点 → 走路）────────────────────────────
await page.click('.title-screen [data-act="start"]');

/** 推进一步：问卷 / 地点门 / 台词 / 转场，谁在场就处理谁。返回这一步做了什么 */
let gateCount = 0;
let gateByFocusedKey = null;
async function step() {
  if (await page.locator('.walk').count()) return 'walk';
  if (await page.locator('.custom .choice').count()) { await page.click('.custom .choice >> nth=0'); await page.waitForTimeout(120); return 'custom'; }
  if (await page.locator('.debug-target').count()) {
    gateCount += 1;
    if (gateCount === 1) {
      // 第一道门用**键盘**过：先把焦点放到「前往 X」上，再按真回车。
      // 这条路 jsdom 测不了 —— 未受信任的事件不会触发浏览器的默认行为，
      // 而"回车按下聚焦的按钮"恰恰是默认行为。UiSystem 在这里刻意**不抢**这个按键
      // （抢了就是一次按键两件事），所以必须有一次真按键来证明那条路真的走得通。
      await page.focus('.debug-target');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => !document.querySelector('.debug-target'), null, { timeout: 3000 }).catch(() => {});
      gateByFocusedKey = (await page.locator('.debug-target').count()) === 0;
    } else {
      await page.click('.debug-target');
    }
    await page.waitForTimeout(150);
    return 'gate';
  }
  const text = await page.locator('.dialogue-box:not([hidden])').count();
  if (text) { await page.keyboard.press('Space'); await page.waitForTimeout(150); return 'line'; }
  await page.waitForTimeout(80);
  return 'idle';
}

// 先走到"第一次换地点"的门（卧室），把它点掉，再推掉 06:20 那句台词，
// 下一个门（教学楼）点掉之后就是走路。
for (let i = 0; i < 80; i++) {
  if (await page.locator('.walk').count()) break;
  await step();
}
await page.waitForSelector('.walk', { timeout: 10000 });

// 第一道门是**按回车**过的（焦点在按钮上，走浏览器原生的"按下这颗按钮"）
check(gateByFocusedKey === true, '焦点在「前往 X」上时按回车也会进去（真按键，不是合成事件）', String(gateByFocusedKey));

// 走路刚起步，先立刻量一次几何（后面才量得准"起点对不对"）
await page.waitForTimeout(60);
await shoot({ path: `${SHOTS}/01-walk-start.png` });
const walkStart = await page.evaluate(() => {
  const map = document.querySelector('.walk-map');
  const actor = document.querySelector('.walk-actor');
  const scene = document.querySelector('.scene');
  const bar = document.querySelector('.walk-bar');
  const goal = document.querySelector('.walk-goal');
  const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 } : null; };
  const bg = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(map).backgroundImage || '')?.[1] ?? '';
  const src = actor?.currentSrc || actor?.src || '';
  return {
    map: r(map), actor: r(actor), scene: r(scene), bar: r(bar), goal: r(goal),
    mapKind: bg.startsWith('data:image/webp') ? 'webp' : bg.startsWith('data:image/png') ? 'png' : bg.startsWith('data:image/svg') ? 'svg占位' : bg ? 'other' : 'none',
    actorKind: src.startsWith('data:image/webp') ? 'webp' : src.startsWith('data:image/png') ? 'png' : src.startsWith('data:image/svg') ? 'svg占位' : src ? 'other' : 'none',
    actorNatural: { w: actor?.naturalWidth ?? 0, h: actor?.naturalHeight ?? 0 },
    actorLeft: actor?.style.left, actorTop: actor?.style.top,
    actorDir: actor?.dataset.dir, actorGender: actor?.dataset.walk,
    // WalkSystem 把"走到哪儿了"挂在 DOM 上（data-point / data-progress），
    // 验收靠它在**任意时刻**对账"归一化坐标 → 像素"的换算。
    // 不能在 t=0 量：转场条一出现其实已经走了几百毫秒（轮询到 .walk 就有延迟）。
    actorPoint: actor?.dataset.point ?? '', actorProgress: actor?.dataset.progress ?? '',
    // 整条路线（WalkSystem 挂在 .walk-map 上）：验收拿它和交接包的 LOCATIONS / 路网逐字对账
    routeFrom: document.querySelector('.walk-map')?.dataset.from ?? '',
    routeTo: document.querySelector('.walk-map')?.dataset.to ?? '',
    routePoints: document.querySelector('.walk-map')?.dataset.points ?? '',
    goalLabel: document.querySelector('.walk-goal span')?.textContent ?? '',
    barText: bar?.textContent ?? '',
    sceneOverflowX: scene ? Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth) : -1,
    // 转场期间不该还挂着上一幕的东西
    cg: document.querySelectorAll('.moment-cg:not([hidden]) .cg-card').length,
    cast: document.querySelectorAll('.cast-layer .portrait').length,
    signal: document.querySelectorAll('.signal').length,
  };
});

check(!!walkStart.map && !!walkStart.actor, '走路的画面真的出现了（地图 + 小人）');
check(walkStart.mapKind === 'webp', '地图用的是正式交付图（校园俯瞰图），不是占位 SVG', walkStart.mapKind);
check(walkStart.actorKind === 'webp', '小人是真的行走帧图，不是占位 SVG / 空串', walkStart.actorKind);
check(walkStart.actorNatural.w > 0 && walkStart.actorNatural.h > 0, '行走帧图片解码成功（没有裂图）', JSON.stringify(walkStart.actorNatural));
check(walkStart.actorGender === 'boy', '选男生 → 用男生的行走帧素材', String(walkStart.actorGender));
// 目的地标记上的名字来自目标场景的 name（D1 07:40 是「教室·清晨」这类），不写死具体字
check(walkStart.goalLabel.length > 0, '目的地标记有地点名', walkStart.goalLabel);
check(walkStart.barText.includes('前往') && walkStart.barText.includes('加速') && walkStart.barText.includes('跳过'),
  '转场条上有「前往 X / 加速 / 跳过」（加速与跳过的入口必须显眼）', walkStart.barText);
check(walkStart.cg === 0 && walkStart.cast === 0 && walkStart.signal === 0,
  '转场期间上一幕的插画/立绘/信号都收走了（否则它们会站在校园地图上）',
  `cg=${walkStart.cg} cast=${walkStart.cast} signal=${walkStart.signal}`);

// ── 地图必须按 7:4 铺进舞台（letterbox），不能拉伸、不能溢出 ─────────────
const mapRatio = walkStart.map.w / walkStart.map.h;
check(Math.abs(mapRatio - MAP_W / MAP_H) < 0.02,
  `校园地图保持交接包的 7:4 比例（实测 ${mapRatio.toFixed(4)}，应为 ${(MAP_W / MAP_H).toFixed(4)}）`);
check(walkStart.map.w > walkStart.scene.w * 0.6 && walkStart.map.h > walkStart.scene.h * 0.6,
  '地图在舞台上足够大（没有缩成一小块）', `map=${Math.round(walkStart.map.w)}×${Math.round(walkStart.map.h)} scene=${Math.round(walkStart.scene.w)}×${Math.round(walkStart.scene.h)}`);
check(walkStart.map.x >= walkStart.scene.x - 1 && walkStart.map.y >= walkStart.scene.y - 1
  && walkStart.map.x + walkStart.map.w <= walkStart.scene.x + walkStart.scene.w + 1
  && walkStart.map.y + walkStart.map.h <= walkStart.scene.y + walkStart.scene.h + 1,
  '地图完整落在舞台里（不溢出、不被裁）',
  `map=${JSON.stringify(walkStart.map)} scene=${JSON.stringify(walkStart.scene)}`);
check(walkStart.sceneOverflowX <= 0, '转场没有把页面撑出横向滚动条', String(walkStart.sceneOverflowX));

// ── 小人必须正好站在路线上（不是"大概在左边"）──────────────────────────
// 用 WalkSystem 挂在 DOM 上的归一化坐标反算期望像素位置，和实际量到的中心比。
// 这样在**任何时刻**都成立，不依赖"能在 t=0 截到画面"（真机做不到）。
function assertOnRoute(label, point, actorBox, mapBox) {
  const [px, py] = String(point).split(',').map(Number);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return check(false, label, `读不到 data-point：${point}`);
  const ex = mapBox.x + px * mapBox.w;
  const ey = mapBox.y + py * mapBox.h;
  const dx = Math.abs(actorBox.cx - ex);
  const dy = Math.abs(actorBox.cy - ey);
  check(dx < 2 && dy < 2, label,
    `偏移 dx=${dx.toFixed(1)}px dy=${dy.toFixed(1)}px（该在 ${Math.round(ex)},${Math.round(ey)}，实际 ${Math.round(actorBox.cx)},${Math.round(actorBox.cy)}）`);
}

check(Number(walkStart.actorProgress) >= 0 && Number(walkStart.actorProgress) <= 1,
  '走路进度是 0..1 的归一化值', String(walkStart.actorProgress));
assertOnRoute('小人站在路线点上（归一化坐标 × 地图盒 = 实际像素中心，说明与背景上的路对齐）',
  walkStart.actorPoint, walkStart.actor, walkStart.map);
// 路线两端必须**逐字等于交接包**：起点 = 男生宿舍(0.19,0.565)，终点 = 教学楼(0.5,0.285)。
// 不去读"当前走到哪"（那时早就走出去一段了，第一版就是拿实测量去比起点、结果误判成偏移 95px），
// 而是读 WalkSystem 挂在 DOM 上的整条路线 —— 这才是与交接包对账的正确对象。
const [routeFrom, routeTo] = [walkStart.routeFrom, walkStart.routeTo];
const pts = String(walkStart.routePoints).split(';');
check(routeFrom === 'boyDorm' && routeTo === 'teachingBuilding',
  '这一趟走的是交接包的 boyDorm → teachingBuilding', `${routeFrom} → ${routeTo}`);
check(pts[0] === '0.19000,0.56500' && pts[pts.length - 1] === '0.50000,0.28500',
  '路线起点/终点坐标与交接包 LOCATIONS 完全一致', `${pts[0]} … ${pts[pts.length - 1]}`);
check(pts.includes('0.19000,0.52000') && pts.includes('0.50000,0.52000'),
  '路线沿交接包的十字路网走直角（经过 HUB 0.5,0.52），不是两点连直线', pts.join(' → '));

// 小人大小按交接包原生比例：行走帧 128px ↔ 地图 768px = 16.67% 的图高
const actorPct = walkStart.actor.h / walkStart.map.h;
check(actorPct > 0.12 && actorPct < 0.25,
  `小人大小是交接包的原生比例（实测占地图高度 ${(actorPct * 100).toFixed(1)}%，期望 ≈16.7%）`);

// ── 真的在走：位置随时间变化、朝向跟着路线转、且始终落在路线上 ──────────
await page.waitForTimeout(700);
const mid = await page.evaluate(() => {
  const a = document.querySelector('.walk-actor');
  const b = a?.getBoundingClientRect();
  const m = document.querySelector('.walk-map')?.getBoundingClientRect();
  return {
    cx: b ? b.x + b.width / 2 : -1, cy: b ? b.y + b.height / 2 : -1,
    left: a?.style.left, dir: a?.dataset.dir, src: a?.currentSrc || a?.src || '',
    point: a?.dataset.point ?? '', progress: a?.dataset.progress ?? '',
    map: m ? { x: m.x, y: m.y, w: m.width, h: m.height } : null,
  };
});
await shoot({ path: `${SHOTS}/02-walk-mid.png` });
const moved = Math.hypot(mid.cx - walkStart.actor.cx, mid.cy - walkStart.actor.cy);
check(moved > 20, '小人真的在动（700ms 里位置明显变了）', `位移 ${moved.toFixed(1)}px`);
check(Number(mid.progress) > Number(walkStart.actorProgress),
  '进度在单调推进（不是原地抖）', `${walkStart.actorProgress} → ${mid.progress}`);
if (mid.map) assertOnRoute('走起来之后仍然严格落在路线上（拐弯处也不会偏）', mid.point, { cx: mid.cx, cy: mid.cy }, mid.map);
// 起点在男生宿舍：先向上走到横路（y 0.565 → 0.52），随后沿横路向右 → 朝向应当是 up 或 right
check(mid.dir === 'up' || mid.dir === 'right', '朝向符合路线（从男生宿舍出来先向上到横路）', String(mid.dir));

// 行走帧两帧循环：多采几次，src 至少出现过两帧不同的图
const frames = new Set([walkStart.actorKind, mid.src]);
for (let i = 0; i < 6; i++) {
  await page.waitForTimeout(90);
  frames.add(await page.evaluate(() => document.querySelector('.walk-actor')?.currentSrc || document.querySelector('.walk-actor')?.src || ''));
}
check(frames.size >= 2, '行走帧在两帧之间切换（不是一张静止图）', `采到 ${frames.size} 张不同的图`);

// ── 加速 ────────────────────────────────────────────────────────────────
await page.click('[data-walk-act="fast"]');
const fastState = await page.evaluate(() => {
  const b = document.querySelector('[data-walk-act="fast"]');
  return { text: b.textContent, pressed: b.getAttribute('aria-pressed'), on: b.classList.contains('on'), walkAlive: !!document.querySelector('.walk') };
});
check(fastState.text.includes('×3'), '点「加速」变成 ×3', fastState.text);
check(fastState.pressed === 'true' && fastState.on, '加速按钮有按下态（aria-pressed / .on）', JSON.stringify(fastState));
check(fastState.walkAlive, '点加速不会顺手把整段转场跳掉');
await page.waitForTimeout(120);
await shoot({ path: `${SHOTS}/03-walk-fast.png` });

// ── 回车跳过 ────────────────────────────────────────────────────────────
// 注意要**等场景真的换完**再断言：跳过之后引擎还要走完 transitionMs（900ms）的地点名淡入淡出，
// 才轮到 scene.show() 换场景。只等 300ms 的话会看到"转场没了、内容还是空的、场景还挂在
// campus-walk 上"—— 那是**过渡中间态**，不是故障（第一版就是这么误判的）。
await page.keyboard.press('Enter');
await page.waitForSelector('.walk', { state: 'detached', timeout: 5000 }).catch(() => {});
const skipScene = await page.waitForFunction(
  () => {
    const s = document.querySelector('.scene')?.dataset.scene ?? '';
    return s && s !== 'campus-walk' ? s : null;
  },
  null,
  { timeout: 8000 },
).then((h) => h.jsonValue()).catch(() => '');
await shoot({ path: `${SHOTS}/04-after-skip.png` });
const afterSkip = await page.evaluate(() => ({
  walk: document.querySelectorAll('.walk').length,
  scene: document.querySelector('.scene')?.dataset.scene ?? '',
  moment: document.querySelector('.scene')?.dataset.moment ?? '',
  contentLen: document.querySelector('.content')?.innerHTML.length ?? -1,
}));
check(afterSkip.walk === 0, '回车之后转场收掉了');
check(afterSkip.scene === 'classroomMorning',
  '跳过之后照旧进了该进的场景（跳过 ≠ 没走过去）', `${skipScene || afterSkip.scene}`);
check(afterSkip.contentLen > 0, '场景内容真的画出来了（不是停在空白页）', String(afterSkip.contentLen));

// ── 情绪信号：真图，不是 emoji ─────────────────────────────────────────
// 推到 D1_0810（08:10 被当众批评）—— 它是全周第一个带干预窗口的事件，信号层在这里出现。
// 注意要等到**干预按钮**出来再断言：信号在 runDilemma 一开始就挂上了，而选项要等入场台词播完
// （先看到信号就断言"按钮在场"会必然失败 —— 第一版就是栽在这儿）。
for (let i = 0; i < 300; i++) {
  if (await page.locator('.dock .choice').count()) break;
  if (await page.locator('.walk').count()) { await page.keyboard.press('Enter'); await page.waitForTimeout(120); continue; }
  await step();
}
await page.waitForSelector('.dock .choice', { timeout: 20000 });
await page.waitForSelector('.signal', { timeout: 5000 });
await page.waitForTimeout(120);
await shoot({ path: `${SHOTS}/05-signal.png` });

const sig = await page.evaluate(() => {
  const layer = document.querySelector('.signal-layer');
  const el = document.querySelector('.signal');
  const img = el?.querySelector('img.signal-icon');
  const box = el?.getBoundingClientRect();
  const scene = document.querySelector('.scene')?.getBoundingClientRect();
  const cg = document.querySelector('.moment-cg:not([hidden]) .cg-card')?.getBoundingClientRect();
  const band = document.querySelector('.stage-bottom')?.getBoundingClientRect();
  // 插画里**图**的矩形（不是卡片盒）：卡片盒比画出来的图大，"压住脸"要按图来量
  const cgImages = [...document.querySelectorAll('.moment-cg:not([hidden]) .cg-card img')].map((im) => {
    const b = im.getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) };
  });
  const src = img?.currentSrc || img?.src || '';
  const kind = src.startsWith('data:image/webp') ? 'webp' : src.startsWith('data:image/svg') ? 'svg占位' : src ? 'other' : 'none';
  const R = (b) => (b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) } : null);
  return {
    hasEl: !!el, hasImg: !!img, kind,
    text: (layer?.textContent ?? '').trim(),
    intensity: el?.dataset.intensity ?? '', signalKind: el?.dataset.kind ?? '',
    w: box ? Math.round(box.width) : 0, h: box ? Math.round(box.height) : 0,
    natW: img?.naturalWidth ?? 0, natH: img?.naturalHeight ?? 0,
    sceneW: scene ? Math.round(scene.width) : 0, sceneH: scene ? Math.round(scene.height) : 0,
    // 位置断言用：信号自己 vs 插画 vs 底部演出带 vs 舞台四边
    top: box ? Math.round(box.top) : -1, bottom: box ? Math.round(box.bottom) : -1,
    left: box ? Math.round(box.left) : -1, right: box ? Math.round(box.right) : -1,
    cgTop: cg ? Math.round(cg.top) : -1,
    cgBottom: cg ? Math.round(cg.bottom) : -1,
    bandTop: band ? Math.round(band.top) : Number.MAX_SAFE_INTEGER,
    sceneLeft: scene ? Math.round(scene.left) : -1, sceneRight: scene ? Math.round(scene.right) : -1,
    cgCards: R(cg), band: R(band), cgImages,
    dockText: (document.querySelector('.dock')?.textContent ?? '').trim().slice(0, 60),
    emoji: /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(layer?.textContent ?? ''),
  };
});

check(sig.hasEl && sig.hasImg, '信号层里是一个 <img>，不再是文字/emoji', JSON.stringify({ hasEl: sig.hasEl, hasImg: sig.hasImg }));
check(sig.kind === 'webp', '信号用的是正式交付的水彩信号图（signal.*.webp）', sig.kind);
check(!sig.emoji && sig.text === '', '信号层里没有任何字符（🌧◌✗💤📱🌫 已经删干净）', JSON.stringify(sig.text));
check(sig.natW > 0 && sig.natH > 0, '信号图解码成功', `${sig.natW}×${sig.natH}`);
check(sig.signalKind === 'darkCloud', '这一刻的信号语义是乌云（教室里被当众批评）', sig.signalKind);
// 两档尺寸：没有插画时 192px（--signal-fit:1），插画在场时 153px（--signal-fit:.8，要挤进
// 插画底边与选项之间那条 ~100px 的横带）。两者都远大于"看不见"，所以下限按 140 守。
check(sig.w >= 140 && sig.h >= 90, '信号图大小合适：不至于小到看不见（真机上 132px 那版就偏小）', `${sig.w}×${sig.h}`);
check(sig.w <= sig.sceneW * 0.35 && sig.h <= sig.sceneH * 0.45, '信号图不至于大到压住画面', `${sig.w}×${sig.h} vs 舞台 ${sig.sceneW}×${sig.sceneH}`);
// 位置三条规矩（这才是真正要守的东西，比钉一个坐标有意义）：
//   · **绝不压住人脸** —— 插画里人物的头在上半部分，所以信号不许与任一张插画的上 60% 相交；
//     两个人并排铺满宽度时舞台里没有完全空的地方，信号必然要压在什么上面，
//     但"可以压地板、绝不能糊脸"是一条说得清、也测得出来的底线；
//   · 不能压住底部演出带（台词 / 选项）；
//   · 完整落在舞台内。
function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
const faces = sig.cgImages.map((c) => ({ ...c, bottom: c.top + (c.bottom - c.top) * 0.6 }));
const hitFace = faces.find((c) => overlaps(sig, c));
check(!hitFace, '信号没有压住任何人物的上半身（脸）',
  hitFace ? `信号 ${JSON.stringify({ top: sig.top, bottom: sig.bottom, left: sig.left, right: sig.right })} 与插画上部 ${JSON.stringify(hitFace)} 相交` : '');
check(sig.bottom <= sig.bandTop - 2, '信号在文字带上方（没有压住台词与选项）',
  `信号 bottom=${sig.bottom} 文字带 top=${sig.bandTop}`);
check(sig.left >= sig.sceneLeft - 1 && sig.right <= sig.sceneRight + 1,
  '信号完整落在舞台内（没有被裁）', `left=${sig.left} right=${sig.right} 舞台 ${sig.sceneLeft}..${sig.sceneRight}`);
check(sig.dockText.includes('捂耳朵'), '干预按钮照旧在场（信号图没有抢走它）', sig.dockText);

// ── 兜底：整跑零控制台错误 ─────────────────────────────────────────────
check(consoleErrors.length === 0, '真浏览器里零控制台错误', consoleErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n─── 真浏览器验收：信号图 + 人物自动移动转场 ───');
for (const n of notes) console.log(n);
if (failures.length) {
  console.log('\n失败项：');
  for (const f of failures) console.log(f);
  console.log(`\n${failures.length} 项未通过。截图见 ${SHOTS}/`);
  process.exit(1);
}
console.log(`\n全部通过（${notes.length} 项）。截图见 ${SHOTS}/`);
