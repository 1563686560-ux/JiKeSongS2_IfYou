// 真浏览器验收（Playwright + 本机 Chrome/Edge）：jsdom 不计算布局
// 所以"当前说话者放大变亮、另一方变暗""点击不被浮层挡住""移动端不溢出"这类
// 硬验收项必须在真浏览器里量。用法：npm run test:browser（需先 npm run preview）。
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';

const BASE = process.env.JKS2_URL ?? 'http://127.0.0.1:4180/';
const SHOTS = 'tests/browser/shots';
mkdirSync(SHOTS, { recursive: true });

// 美术交付状态由 Node 侧直接从 art/ 目录读，再和页面里实际用的图对账 ——
// 这样"美工交了图但游戏还在吃占位图"这类问题会被当场发现。
const ART_EXT = /\.(png|webp|jpe?g|svg)$/i;
const deliveredFiles = existsSync('art') ? readdirSync('art').filter((n) => ART_EXT.test(n) && n.toLowerCase() !== 'readme.md') : [];
const deliveredReal = deliveredFiles.filter((n) => !n.toLowerCase().endsWith('.svg'));

// 页面里现在到底在用哪些图：把所有 <img> 和带 background-image 的元素的 data URL 收上来
async function collectArt(page) {
  return page.evaluate(() => {
    const urls = [];
    for (const el of document.querySelectorAll('.scene-background,.scene-overlay,.debug-map,.debug-route')) {
      const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(el).backgroundImage || '');
      if (m && m[1] && m[1] !== 'none') urls.push(m[1]);
    }
    const imgs = [...document.querySelectorAll('img')];
    for (const img of imgs) urls.push(img.currentSrc || img.src);
    return {
      total: urls.length,
      real: urls.filter((u) => u.startsWith('data:image/png') || u.startsWith('data:image/webp') || u.startsWith('data:image/jpeg')).length,
      placeholder: urls.filter((u) => u.startsWith('data:image/svg')).length,
      external: urls.filter((u) => u.startsWith('http')).length,
      broken: imgs.filter((i) => !(i.naturalWidth > 0 && i.naturalHeight > 0)).length,
    };
  });
}

const failures = [];
const notes = [];
function check(ok, label, detail = '') {
  if (ok) notes.push(`  ok   ${label}`);
  else failures.push(`  FAIL ${label}${detail ? `  — ${detail}` : ''}`);
}

// 优先用本机已安装的 Chrome/Edge，避免依赖下载浏览器
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

/**
 * 截图（等动效落定 + 一次重试）。
 *
 * **先等动效落定**：剧情插画进来时有 0.45s 的淡入（`@keyframes cgIn`）。
 * 在淡入中途截图，画面上的主角是一团半透明的鬼影 —— 看截图的人（包括我）
 * 会以为"抠图没抠干净 / 人物半透明"，而去查一个根本不存在的 bug。
 * 实测过一次：同一个时刻，出现后立刻截是 0.988 不透明度，等 1.6 秒后截是 1.0、画面完全正常。
 * 截图是**给人看的证据**，所以它必须是终点状态，不能是某一帧动画。
 *
 * Playwright 的 `page.screenshot` 在 Windows 上**偶发**卡在"等待字体 / 等一帧"上直到 30 秒超时。
 * （实测过一次：整跑挂在 D1 第一张剧情插画上，重跑同一条命令全绿）。它和被测代码毫无关系，
 * 但一次偶发超时会让整份验收报告直接崩掉、前面的结论全丢 —— 所以这里兜一次，
 * 并在日志里留一行 warn，免得"偶发"变成"没人知道"。
 */
/**
 * 截图（等动效落定 + 一次重试）。
 *
 * **先等动效落定**：剧情插画进来时有 0.45s 的淡入（`@keyframes cgIn`）。
 * 在淡入中途截图，画面上的主角是一团半透明的鬼影 —— 看截图的人（包括我）
 * 会以为"抠图没抠干净 / 人物半透明"，而去查一个根本不存在的 bug。
 * 实测过一次：同一个时刻，出现后立刻截是 0.988 不透明度（看着像鬼影），
 * 等动效走完再截是 1.0、画面完全正常。
 * 截图是**给人看的证据**，所以它必须是终点状态，不能是某一帧动画。
 *
 * Playwright 的 `page.screenshot` 在 Windows 上**偶发**卡在"等待字体 / 等一帧"上直到 30 秒超时。
 * （实测过一次：整跑挂在 D1 第一张剧情插画上，重跑同一条命令全绿）。它和被测代码毫无关系，
 * 但一次偶发超时会让整份验收报告直接崩掉、前面的结论全丢 —— 所以这里兜一次，
 * 并在日志里留一行 warn，免得"偶发"变成"没人知道"。
 */
async function shoot(opts) {
  // 只等**正在播的动效**落定，不等一个固定时长：固定 delay 会顺手把"地点过渡"那张
  // （它有 0.9s 的进场动画，拍的是过程中的一帧）等过头，拍到的就不是那一屏了。
  await settleAnimations();
  const target = { ...opts };
  delete target.settleMs;
  try {
    await page.screenshot(target);
  } catch (e) {
    notes.push(`  warn 截图超时已重试：${target.path ?? '（无路径）'}（${e.name}）`);
    await page.screenshot({ ...target, timeout: 90000 });
  }
}

/**
 * 等页面上正在播的 CSS 动画/过渡走完（没有就立刻返回）。截图前调用，避免拍到动画中途。
 *
 * 三条护栏，少一条都会把整跑挂死或拖垮：
 *   · **无限动画必须排除**（`.walk-goal i` 的 pulse 是 infinite，它的 finished 永不 resolve）；
 *   · **长动画必须排除**（干预窗口的倒计时条是 10s —— 等它等于把窗口等没）；
 *   · **兜一个硬上限**，万一将来有别的动画卡住，截图也只是"没等到"而不是"整份验收不结束"。
 */
async function settleAnimations() {
  await page.evaluate(() => {
    const short = document.getAnimations().filter((a) => {
      const t = a.effect?.getComputedTiming?.();
      const iter = t?.iterations ?? 1;
      const dur = t?.duration ?? 0;
      return Number.isFinite(iter) && typeof dur === 'number' && dur > 0 && dur <= 1200;
    });
    return Promise.race([
      Promise.all(short.map((a) => a.finished.catch(() => {}))),
      new Promise((r) => setTimeout(r, 1500)),
    ]);
  }).catch(() => {});
}

const consoleErrors = [];
const failedRequests = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('requestfailed', (r) => failedRequests.push(`${r.url()} (${r.failure()?.errorText ?? ''})`));
page.on('response', (r) => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

await page.goto(BASE, { waitUntil: 'load' });
// 时相场景探针必须在**剧情开始之前**装好：它靠 MutationObserver 记录
// .scene[data-moment] 的每一次变化，装晚了第一刻（D1_0620）就再也抓不到了。
await page.waitForSelector('.scene', { timeout: 15000 });
await installSceneProbe();
await page.waitForSelector('.title-screen', { timeout: 15000 });
await shoot({ path: `${SHOTS}/01-title.png` });
check(await page.locator('.title-screen h1').isVisible(), '标题页渲染');
check(await page.locator('.title-screen h1').innerText() === '如果有你', '标题文案正确（中文未乱码）');

// 进入游戏 → 答掉开局问卷（现在只剩"那时候的TA，是——"一题）。
// 每答一题都要等"题目真的换掉了"再答下一题：否则最后一题答完后，旧按钮还会在 DOM 里
// 停留到日转场结束，脚本会重复点它，正好撞上 DOM 替换（Playwright 会一直重试到超时）。
async function answerOnce() {
  const promptBefore = await page.locator('.custom-prompt').innerText().catch(() => null);
  if (await page.locator('.custom .choice').count()) await page.click('.custom .choice');
  await page.waitForFunction(
    (prev) => {
      const p = document.querySelector('.custom-prompt');
      return !p || p.textContent !== prev;
    },
    promptBefore,
    { timeout: 5000 },
  ).catch(() => {});
}

await page.click('.title-screen [data-act="start"]');
for (let i = 0; i < 40; i++) {
  if (await page.locator('.debug-target').count()) break;
  if (await page.locator('.custom').count()) { await answerOnce(); continue; }
  await page.waitForTimeout(60);
}
await page.waitForSelector('.debug-target', { timeout: 20000 });
await shoot({ path: `${SHOTS}/02-debug-gate.png` });

// 硬验收：地点入口只给一个目标（卡片上那枚「开发调试入口 · 非正式玩法」标签已按需求删除）。
check(await page.locator('.debug-target').count() === 1, '地点调试入口一次只给一个目标');
check(await page.locator('.debug-badge').count() === 0, '入口卡片上不再有调试标签');
const routeText = (await page.locator('.debug-route').innerText()).replace(/\s+/g, ' ').trim();
check(routeText.includes('下一目标'), '入口卡片仍写明这是"下一目标"', routeText);
check(await page.locator('.hotspot').count() === 1, '没有可自由跳转的多余热区');

// 硬验收：铺满全屏的层不能挡住目标按钮的点击。
const hit = await page.evaluate(() => {
  const btn = document.querySelector('.debug-target');
  const r = btn.getBoundingClientRect();
  const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return { topClass: top?.className ?? '', isTarget: top === btn || btn.contains(top) };
});
check(hit.isTarget, '目标按钮真的能点（未被浮层遮挡）', `命中元素 ${hit.topClass}`);

// 日转场卡不能和"下一目标"入口叠在一起。
check(await page.locator('.day-card').count() === 0, '日转场卡已收走，没有盖在地点入口上');

/**
 * 量一次"底部演出带"的几何（真浏览器计算布局，jsdom 量不了）：
 *   · 立绘行在上、文字带在下，两者同属 .stage-bottom 这一个底部堆叠；
 *   · 一个人物就居中、两个人物就分居左右；
 *   · 立绘行在场时，画面上不该再有任何占位人物图形（通用 SVG 小人已整个删除）。
 * 这些是"所有对话或文字都显示在整个界面的下部 / 一个居中两个分居左右"的硬验收项。
 */
async function bandMetrics() {
  return page.evaluate(() => {
    const band = document.querySelector('.stage-bottom');
    if (!band) return null;
    const cast = document.querySelector('.cast-layer:not([hidden])');
    const bar = document.querySelector('.bar');
    const text = document.querySelector('.dialogue-box:not([hidden])');
    const r = (el) => {
      const b = el?.getBoundingClientRect();
      return b ? { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) } : null;
    };
    const figs = cast ? [...cast.querySelectorAll('.portrait')].map((f) => {
      const b = f.getBoundingClientRect();
      const img = f.querySelector('img');
      const src = img?.currentSrc || img?.src || '';
      const cs = getComputedStyle(f);
      const m = /matrix\(([-\d.]+)/.exec(cs.transform);
      const br = /brightness\(([\d.]+)\)/.exec(cs.filter);
      // 透明通道分布（《待确认问题》§6.9⑥）：交付的立绘曾经有一层半透明灰雾，
      // 在暗场景里是人物背后的一团灰云。这里顺手量下来，供下面那条断言使用。
      // 必须在**捕获立绘的这一刻**量 —— 等流程走到结局页，立绘行早就收了（踩过一次，量到 null）。
      let alphaStats = null;
      if (img && img.naturalWidth > 0) {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let clear = 0, mid = 0, solid = 0;
        for (let i = 3; i < d.length; i += 4) {
          if (d[i] <= 10) clear++; else if (d[i] >= 245) solid++; else mid++;
        }
        const n = d.length / 4;
        alphaStats = { clear: clear / n, mid: mid / n, solid: solid / n };
      }
      return {
        side: f.dataset.side, asset: f.dataset.asset,
        cx: Math.round(b.left + b.width / 2), w: Math.round(b.width), h: Math.round(b.height),
        kind: src.startsWith('data:image/svg') ? 'placeholder'
          : src.startsWith('data:image/png') ? 'png'
            : src.startsWith('data:image/jpeg') ? 'jpeg'
              : src.startsWith('data:image/webp') ? 'webp' : 'other',
        decoded: !!img && img.naturalWidth > 0,
        natW: img?.naturalWidth ?? 0, natH: img?.naturalHeight ?? 0,
        scale: m ? Number(m[1]) : 1,
        brightness: br ? Number(br[1]) : 1,
        active: f.classList.contains('active'),
        inactive: f.classList.contains('inactive'),
        alphaStats,
      };
    }) : [];
    // 布局盒（未被 §5.1 的 scale 变换放大的那个）也要量：视觉盒会因为"说话者放大 1.12 倍"
    // 而超出布局盒，直接用 getBoundingClientRect 比会误报"立绘压住台词"。
    // 立绘行的 offsetParent 就是 .stage-bottom（它是绝对定位的），所以 offsetTop 可直接比。
    return {
      viewportH: window.innerHeight,
      bandBox: r(band), castBox: r(cast), barBox: r(bar), textBox: r(text), sceneBox: r(document.querySelector('.scene')),
      layoutCastBottom: cast ? cast.offsetTop + cast.offsetHeight : null,
      layoutBarTop: bar ? bar.offsetTop : null,
      dataCast: cast?.dataset.cast ?? null,
      figs,
      // 占位人物图形应当彻底消失（DOM 里连容器都不该有）
      studentNodes: document.querySelectorAll('.student, .student-layer, .student-svg').length,
    };
  });
}

// 底部演出带在当前这一屏就该贴在舞台下边缘 —— 立绘/文字/选项都住在它里面
const bandAtStart = await bandMetrics();
if (bandAtStart) {
  check(
    Math.abs(bandAtStart.bandBox.bottom - bandAtStart.sceneBox.bottom) <= 1,
    '底部演出带贴着舞台下边缘（立绘、文字、选项都住在这一条里）',
    `band bottom=${bandAtStart.bandBox.bottom} / scene bottom=${bandAtStart.sceneBox.bottom}`,
  );
  // 舞台要撑满窗口：不然高窗口下内容会停在半屏处、底下留一大片空背景，
  // "所有文字都在界面下部"就只做到一半。
  check(
    bandAtStart.sceneBox.bottom >= bandAtStart.viewportH - 80,
    '舞台撑满窗口高度（内容没有停在半屏处、底下留空）',
    `scene bottom=${bandAtStart.sceneBox.bottom} / 视口高 ${bandAtStart.viewportH}`,
  );
  if (bandAtStart.textBox) {
    check(
      bandAtStart.textBox.top > bandAtStart.viewportH / 2,
      '文字出现在界面下半部（而不是舞台中部）',
      `文字带 top=${bandAtStart.textBox.top} / 视口高 ${bandAtStart.viewportH}`,
    );
  }
}

// ── 开发文档 §5.1 的对白能力：自动播放 / 文字速度 的按钮与偏好持久化 ──
// 这两个按钮必须真的在 HUD 上、可点、有 aria-pressed，并且写进 localStorage。
const speedBefore = await page.locator('.speed-btn').innerText();
await page.click('.speed-btn');
const speedAfter = await page.locator('.speed-btn').innerText();
const prefsAfterClick = await page.evaluate(() => localStorage.getItem('jks2.dialoguePrefs'));
check(speedBefore !== speedAfter, '速度按钮能切换档位', `${speedBefore} → ${speedAfter}`);
check(
  typeof prefsAfterClick === 'string' && prefsAfterClick.includes('speed'),
  '速度偏好被写进 localStorage（刷新后仍生效）',
  String(prefsAfterClick),
);
const autoBefore = await page.locator('.auto-btn').getAttribute('aria-pressed');
await page.click('.auto-btn');
const autoAfter = await page.locator('.auto-btn').getAttribute('aria-pressed');
check(autoBefore === 'false' && autoAfter === 'true', '自动播放按钮能开，且 aria-pressed 正确反映状态', `${autoBefore} → ${autoAfter}`);
await shoot({ path: `${SHOTS}/10-hud-toggles.png`, clip: { x: 0, y: 0, width: 1280, height: 90 } });
// 关掉自动播放：后面的点击链路测试要靠手动点击推进，不能被自动翻页干扰
await page.click('.auto-btn');

// 占位图 / 正式图都必须"真的画出来"（data URL 没解析成功的话就是空白或裂图）
const gateArt = await page.evaluate(() => {
  const map = document.querySelector('.debug-map');
  const bg = map ? getComputedStyle(map).backgroundImage : 'none';
  const m = /url\(["']?(.*?)["']?\)/.exec(bg || '');
  return { url: m?.[1] ?? '', len: (m?.[1] ?? '').length };
});
check(
  gateArt.url.startsWith('data:image/') && gateArt.len > 200,
  '地点调试入口的背景图已生效（占位图或正式图都算）',
  `background-image 长度 ${gateArt.len}，前缀 ${gateArt.url.slice(0, 22)}`,
);

// 美术交付对账：art/ 里交了几张正式图，页面上就该看到正式图而不是占位图
const art = await collectArt(page);
notes.push(`  info 美术状态：art/ 已交付 ${deliveredFiles.length} 张（其中非 SVG ${deliveredReal.length} 张）；此地页面在用 正式图 ${art.real} / 占位图 ${art.placeholder}`);
check(art.broken === 0, '页面上所有图片都解码成功（没有裂图）', `broken=${art.broken}`);
check(art.external === 0, '页面没有引用任何外部图片地址（单文件构建要求全内联）', `external=${art.external}`);
// 注意：**不能**在这里就断言"用了正式图"。这个位置是地点调试入口，画面里只有一张底图，
// 而"某个地点的底图到底交了没有"取决于 art/ 里有没有那个文件。正式图的断言要放到
// 图层真正上屏的地方（立绘见下面的 L1 段、地点背景见下面的时相场景段），
// 否则会变成"因为 art/ 里刚好有文件就要求这一屏也是正式图"的假失败。
if (deliveredReal.length === 0) {
  check(art.placeholder > 0, 'art/ 为空，页面正在使用占位图（符合预期的回退）', JSON.stringify(art));
}

// 第一段：地点入口的键盘之路 → 地点过渡 + 环境独白（全部走底部对白框）
// 这一步从前**只能鼠标点**：一路按回车读下去的玩家会卡在「下一目标 · 前往 卧室」上。
// 按钮上必须先写明回车 —— 键盘能按的东西不写出来，就没人会去试。
const gateLabel = (await page.locator('.debug-target').innerText()).replace(/\s+/g, ' ');
check(gateLabel.includes('回车'), '「前往 X」上写明了回车 / 空格（键盘能按的入口必须写出来）', gateLabel);
// 真按键（受信任事件）：此时焦点在 body 上，走的正是玩家最常走的那条路
await page.keyboard.press('Enter');
const gateByKey = await page.waitForFunction(() => !document.querySelector('.debug-target'), null, { timeout: 3000 })
  .then(() => true).catch(() => false);
check(gateByKey, '按回车 = 点了「前往 X」（地点入口不再只能用鼠标）', gateLabel);
await shoot({ path: `${SHOTS}/03-transition.png` });
await page.waitForSelector('.dialogue-box:not([hidden])', { timeout: 10000 });

// 键盘推进之一：**打字过程中**按一次空格，应当把这一句整句显示完。
// 这件事必须在**页面内**掐时机：回到 Node 侧再按就已经晚了（往返几十毫秒，
// 一句 12 个字在"中"档下也就打完了），量到的就成了"打完字按空格翻页"这件另一码事。
// 判据不能用"变长了"（翻到下一句也会更长），而是**这一句的残缺变成了它自己的完整版**：
// 完整句必须以刚看到的残句开头 —— 翻页换的是另一句话，不可能满足这一条。
// 探针会自己推页（这一句已经打完时按一下翻页）并点掉地点入口，直到抓到一次"正在打字"。
const typingProbe = await page.evaluate(async () => {
  const lineOf = () => document.querySelector('.dialogue-box:not([hidden]) .box-text');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const key = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
  const deadline = Date.now() + 25000;
  let prev = '';
  let idleSince = Date.now();
  while (Date.now() < deadline) {
    const gate = document.querySelector('.debug-target');
    if (gate) { gate.click(); idleSince = Date.now(); prev = ''; await sleep(60); continue; }
    const text = lineOf()?.textContent ?? '';
    // 正在长出来（打字动画确实在跑），且刚开始（2–6 个字）
    if (text.length > prev.length && text.length >= 2 && text.length <= 6) {
      key();
      await sleep(70);
      return { partial: text, after: lineOf()?.textContent ?? '' };
    }
    if (text !== prev) idleSince = Date.now();
    prev = text;
    // 一直没在打字（这一句已经打完了，页面在等一次翻页）→ 推一页，让下一句开始打字
    if (Date.now() - idleSince > 600) { key(); idleSince = Date.now(); }
    await sleep(10);
  }
  return null;
});
check(
  !!typingProbe && typingProbe.after.startsWith(typingProbe.partial) && typingProbe.after.length > typingProbe.partial.length,
  '打字过程中按一次空格就把这一句显示完（不是只有鼠标点得动）',
  typingProbe ? `「${typingProbe.partial}」→「${typingProbe.after}」` : '没抓到正在打字的时刻',
);

await shoot({ path: `${SHOTS}/04-line.png` });
check(true, '环境独白（底部对白框）渲染');

// D1 06:20「黎明」的卧室截图：这是全游戏第一刻，也是"卧室·清晨"这张时相底图唯一出现的地方。
// 必须在这里拍 —— 下面的空格键测试会推进剧情，一旦离开这一刻就再也回不来了
// （踩过：把截图放在点击循环里，结果循环开始时已经走到了下一个地点的入口，拍到的是一片空白）
if (await page.evaluate(() => document.querySelector('.scene')?.dataset.moment === 'D1_0620')) {
  await shoot({ path: `${SHOTS}/12-scene-bedroom-dawn.png` });
}

// 键盘推进之二：等下一句时按回车也要能翻页（上一条量的是"打字过程中"，这条量"打完字之后"）
const lineBeforeSpace = await page.evaluate(() => document.querySelector('.dialogue-box:not([hidden]) .box-text')?.textContent ?? '');
let keyboardWorked = false;
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  const stillBox = await page.locator('.dialogue-box:not([hidden])').count();
  const nowText = stillBox ? await page.locator('.dialogue-box .box-text').innerText().catch(() => '') : '';
  if (stillBox === 0 || nowText !== lineBeforeSpace) { keyboardWorked = true; break; }
}
check(keyboardWorked, '回车键能推进对白（不是只有空格可以）', `原文：「${lineBeforeSpace}」`);

// 推进到第一个 L1 时刻（D2_1600「体育课改自习」）——它有底部对白框
// 一路点：底部对白框 / 干预按钮 / 地点入口
let sawBox = false;
let sawDock = false;
let boxMetrics = null;
// 干预窗口：每个窗口都必须有画面（这是 D2「成绩单来了」空画面的回归检查）+ 「让这一刻过去」只量一次
const emptyStageMoments = [];
let skipTimed = null;
let passChecked = false;
// 立绘行：第一次看到"一个人物"和第一次看到"两个人物"时各量一次
let singleCast = null;
let pairCast = null;
// D1 剧情插画（全舞台 CG）：单个时刻的观察结果 + 整局见过的一次"两张并排"
let cgMetrics = null;
let sawCgPair = false;
// 时相场景（D1 环境接线）：用 MutationObserver 盯住 .scene[data-moment] 的每一次变化，
// 变化发生的**那一刻**画面已经渲染好了（引擎先 scene.show() 再写属性），所以这是最可靠的取样点。
// 不用"在点击循环里每隔 40ms 瞄一眼"：那样会在"地点入口已清空场景层、属性还没更新"的窗口里
// 取到假的快照（踩过：D1_0620 因此被记成"没有底图"），而且键盘推进可能整段跳过某一刻。
const D1_SCENE_EXPECT = {
  D1_0620: 'bedroomMorning',
  D1_0740: 'classroomMorning',
  D1_0810: 'classroomMorning',
  D1_1020: 'classroomMorning',
  D1_1230: 'classroomMorning',
  D1_1530: 'playgroundRunning',
  D1_2140: 'classroomNight',
  D1_2230: 'classroomNight',
  D1_2320: 'bedroomLightsOut',
};
// 写成函数声明（而不是 const 箭头函数）是为了让它**提升**：探针要在剧情开始前就装好，
// 也就是调用点在这段代码之前。
async function installSceneProbe() {
  await page.evaluate(() => {
  const w = /** @type {any} */ (window);
  w.__sceneLog = [];
  const scene = document.querySelector('.scene');
  const kindOf = (u) => (u.startsWith('data:image/jpeg') ? 'jpeg'
    : u.startsWith('data:image/png') ? 'png'
      : u.startsWith('data:image/svg') ? 'svg' : u ? 'other' : 'none');
  // 指纹 = 内容前 60 字符 + 长度。用来判"两个时刻用的是不是同一张图"，
  // 不需要在测试里解图，也不怕 data URL 很长。
  const fp = (u) => `${u.slice(0, 60)}#${u.length}`;
  const snap = () => {
    const bg = document.querySelector('.scene-background');
    const overlays = [...document.querySelectorAll('.scene-overlay')];
    const bgImage = bg ? getComputedStyle(bg).backgroundImage || '' : '';
    const bgUrl = (/url\(["']?(.*?)["']?\)/.exec(bgImage) || [])[1] ?? '';
    return {
      moment: scene?.dataset.moment ?? '',
      scene: scene?.dataset.scene ?? '',
      bgKind: kindOf(bgUrl),
      bgFp: fp(bgUrl),
      bgOpacity: bg ? Number(getComputedStyle(bg).opacity) : -1,
      overlayKinds: overlays.map((o) => kindOf(o.currentSrc || o.src || '')),
      overlayFps: overlays.map((o) => fp(o.currentSrc || o.src || '')),
      overlayOpacity: overlays.length ? Number(getComputedStyle(overlays[0]).opacity) : -1,
    };
  };
  const obs = new MutationObserver(() => { if (scene?.dataset.moment) w.__sceneLog.push(snap()); });
  obs.observe(scene, { attributes: true, attributeFilter: ['data-moment'] });
  });
}
const sceneSeen = new Map();
let shotNight = false;
// 真浏览器里跑的是真数值：43 个地点过渡各约 0.9 秒，光不够的事件要等满 10 秒窗口，
// 所以整局需要几分钟。这里给足预算，但每一步都有实际断言。
for (let i = 0; i < 4000; i++) {
  if (await page.locator('.ending').count()) break;

  // 晚自习的教室截图：时相取样已经交给 MutationObserver，这里只需要在正确的时刻按下快门。
  // 读一次属性比每次都 evaluate 一整圈计算样式便宜得多。
  if (!shotNight && await page.evaluate(() => document.querySelector('.scene')?.dataset.moment === 'D1_2140')) {
    shotNight = true;
    await shoot({ path: `${SHOTS}/11-scene-classroom-night.png` });
  }

  // D1 剧情插画：第一次见到它时量一遍，并确认"插画在场时不立立绘"（否则会变成两个主角）
  if (await page.locator('.moment-cg:not([hidden])').count()) {
    const cg = await page.evaluate(() => {
      const layer = document.querySelector('.moment-cg');
      const cs = getComputedStyle(layer);
      const cards = [...layer.querySelectorAll('.cg-card')];
      const sharp = [...layer.querySelectorAll('.cg-sharp')];
      const box = document.querySelector('.dialogue-box:not([hidden])') ?? document.querySelector('.dock');
      const r = layer.getBoundingClientRect();
      const b = box?.getBoundingClientRect();
      return {
        count: cards.length,
        dataCount: layer.dataset.count,
        pointerEvents: cs.pointerEvents,
        assets: cards.map((c) => c.getAttribute('data-asset')),
        // 真交付的图是 jpeg/png；data:image/svg 说明退回了占位图
        kinds: sharp.map((i) => (i.currentSrc || i.src || '').slice(0, 24)),
        decoded: sharp.filter((i) => i.naturalWidth > 0 && i.naturalHeight > 0).length,
        sizes: sharp.map((i) => `${i.naturalWidth}×${i.naturalHeight}`),
        // 占位人物图形已经整个删掉：画面上的人只可能是正式交付图
        studentCount: document.querySelectorAll('.student, .student-layer, .student-svg').length,
        placeholderFigures: [...document.querySelectorAll('.cast-layer img, .moment-cg img')]
          .filter((i) => (i.currentSrc || i.src || '').includes('%E5%8D%A0%E4%BD%8D') || (i.currentSrc || i.src || '').includes('占位')).length,
        // 插画底部不能压到文字带/干预按钮上
        clearsBars: !b || r.bottom - 148 <= b.top + 1,
        // 插画在场时，**立绘行也必须让位** —— 插画里本来就画着人（1 张居中 / 2 张并排），
        // 再立一份立绘就是两个主角。
        castHidden: document.querySelector('.cast-layer')?.hasAttribute('hidden') ?? true,
      };
    });
    if (!cgMetrics) cgMetrics = cg;
    if (cg.count === 2) sawCgPair = true;
    await shoot({ path: `${SHOTS}/08-moment-cg.png` });
  }

  // 立绘行：这一刻场上有几个人物、各自落在哪、谁亮着
  if (await page.locator('.cast-layer:not([hidden])').count()) {
    const m = await bandMetrics();
    // 只在"文字也在场"时取样：那一刻才是真正的演出构图（立绘 + 台词）
    if (m?.textBox && !singleCast) {
      singleCast = m;
      await shoot({ path: `${SHOTS}/13-cast-single.png` });
    }
    if (m?.dataCast === '2' && !pairCast) {
      pairCast = m;
      await shoot({ path: `${SHOTS}/14-cast-pair.png` });
    }
  }

  if (await page.locator('.dock .choice:not([disabled])').count()) {
    // 每一个干预窗口里都必须有「这次，就让它过去」：不消耗守护之光、点了立刻继续。
    // 它也是光不够时唯一的出口（没有它，玩家只能在每一次 10 秒倒计时上干等）。
    const passCount = await page.locator('.dock .pass').count();
    check(passCount === 1, '干预窗口里有「这次，就让它过去」这个选项', `count=${passCount}`);
    if (passCount && !passChecked) {
      passChecked = true;
      const pass = await page.locator('.dock .pass').innerText();
      check(pass.includes('让它过去') && !pass.includes('不帮助'), '它的名字是个像选择的名字，不叫"不帮助"', pass.replace(/\s+/g, ' '));
      check(pass.includes('不消耗守护之光'), '它写明自己不消耗守护之光', pass.replace(/\s+/g, ' '));
    }
    // **这一屏必须有人**（立绘行或剧情插画）：这条是 D2「成绩单来了」那个 bug 的回归检查 ——
    // 当时那一刻的围观图被按性别引用成了不存在的 AssetId，画面静默地掉成"一间空教室"。
    // 所有测试都没红过（因为"少一张图"和"这一刻本来就没图"长得一模一样）。
    const stage = await page.evaluate(() => ({
      moment: document.querySelector('.scene')?.dataset.moment ?? '',
      cg: document.querySelectorAll('.moment-cg:not([hidden]) .cg-card').length,
      cast: document.querySelectorAll('.cast-layer:not([hidden]) .portrait').length,
      placeholders: document.querySelectorAll('.student, .student-layer, .student-svg').length,
    }));
    check(
      stage.cg + stage.cast > 0,
      `${stage.moment || '这一刻'} 的干预窗口里有立绘或插画（不是一屏空教室）`,
      JSON.stringify(stage),
    );
    check(stage.placeholders === 0, '干预窗口里没有占位人物图形', JSON.stringify(stage));
    emptyStageMoments.push(`${stage.moment}:cg${stage.cg}/cast${stage.cast}`);

    if (!sawDock) {
      // 干预按钮的消耗说明必须写明"守护之光"——只写一个数字会被误读成货币
      const costText = await page.locator('.dock .choice small').first().innerText();
      check(costText.includes('守护之光'), `干预按钮写明了消耗的是守护之光（实际："${costText}"）`);
      check(!/\d\s*元/.test(costText), '干预按钮里没有"元"这类货币说法', costText);

      // 干预按钮在文字带里，不能压到立绘行上（同一个底部堆叠，各占一段）
      const overlap = await bandMetrics();
      if (overlap?.layoutCastBottom != null && overlap.layoutBarTop != null) {
        check(
          overlap.layoutCastBottom <= overlap.layoutBarTop + 1,
          '干预按钮没有压到立绘行上',
          JSON.stringify({ castLayoutBottom: overlap.layoutCastBottom, barLayoutTop: overlap.layoutBarTop }),
        );
      }

      await shoot({ path: `${SHOTS}/05-intervention.png` });
      sawDock = true;
    }
    // 第一次窗口里点「让这一刻过去」：量一下是不是真的"立刻继续"，而不是等倒计时走完。
    // 之后一律点第一个干预按钮（这一轮跑的是"全程干预成功"那条路，结局分支要靠它）。
    if (!skipTimed) {
      const before = Date.now();
      await page.click('.dock .pass');
      await page.waitForTimeout(40);
      const elapsed = Date.now() - before;
      skipTimed = { elapsed, miss: await page.evaluate(() => document.querySelectorAll('.dock .choice').length) };
      check(elapsed < 1000, '点「让这一刻过去」立刻继续（不等倒计时走完）', `${elapsed}ms`);
      check(skipTimed.miss === 0, '点完按钮立刻收掉，不留可点但没用了的按钮', `残留 ${skipTimed.miss} 个`);
      continue;
    }
    // 光够就点第一个干预按钮（这一轮跑的是"全程干预"那条路）；光不够时只剩「让这一刻过去」可点。
    if (await page.locator('.dock .choice:not([disabled]):not(.pass)').count()) {
      await page.click('.dock .choice:not([disabled]):not(.pass)');
    } else {
      await page.click('.dock .pass');
    }
    await page.waitForTimeout(30);
    continue;
  }
  if (await page.locator('.dialogue-box:not([hidden])').count()) {
    if (!sawBox) {
      sawBox = true;
      // 等淡入动画结束、且这一句打完字，再截图和量尺寸——否则截到的是半透明的中间态。
      await page.waitForTimeout(900);
      // L1 的硬验收：文字带里只有"说话者 + 台词"（立绘不在框里），
      // 立绘行在它上面、两者不重叠；这一刻场上只有一个人物，所以他居中。
      const band = await bandMetrics();

      boxMetrics = await page.evaluate(() => {
        const box = document.querySelector('.dialogue-box:not([hidden])');
        const imgs = [...document.querySelectorAll('.cast-layer img')];
        const cgImgs = [...document.querySelectorAll('.moment-cg:not([hidden]) .cg-sharp')];
        return {
          boxVisible: !!box && getComputedStyle(box).display !== 'none',
          boxTop: Math.round(box.getBoundingClientRect().top),
          viewportH: window.innerHeight,
          speaker: box.querySelector('.box-speaker')?.textContent ?? '',
          // 立绘不该再挤在文字框内部
          portraitsInsideBox: box.querySelectorAll('.portrait').length,
          castImgs: imgs.length,
          castImgsDecoded: imgs.filter((i) => i.naturalWidth > 0 && i.naturalHeight > 0).length,
          cgImgs: cgImgs.length,
          cgImgsDecoded: cgImgs.filter((i) => i.naturalWidth > 0 && i.naturalHeight > 0).length,
          pngImgs: [...document.querySelectorAll('img')]
            .filter((i) => (i.currentSrc || i.src || '').startsWith('data:image/png')).length,
        };
      });
      boxMetrics.band = band;
      await shoot({ path: `${SHOTS}/06-dialogue-box.png` });
    }
    await page.click('.dialogue-box:not([hidden])');
    await page.waitForTimeout(30);
    continue;
  }
  if (await page.locator('.dialogue-box:not([hidden])').count()) { await page.click('.dialogue-box:not([hidden])'); await page.waitForTimeout(30); continue; }
  // 人物自动移动转场（换地点时）：这一跑是"七日能不能点到底"的链路验收，
  // 不是走路的验收（那个在 tests/browser/walk-shots.mjs）。
  // **点「跳过」按钮而不是按回车** —— 理由见 day-shots.mjs 里同一段的长注释：
  // 按回车有概率漏进下一幕、白翻一句台词。
  if (await page.locator('.walk').count()) {
    await page.locator('[data-walk-act="skip"]').click({ timeout: 2000 }).catch(() => {});
    await page.waitForFunction(() => {
      const s = document.querySelector('.scene');
      return !document.querySelector('.walk') && s && s.dataset.scene && s.dataset.scene !== 'campus-walk';
    }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(30);
    continue;
  }
  if (await page.locator('.debug-target').count()) {
    await page.click('.debug-target');
    // 入口点完必须立刻消失：DOM 里，过渡期间不能留下一颗还能点但已失效的按钮。
    await page.waitForFunction(() => !document.querySelector('.debug-target'), null, { timeout: 3000 });
    await page.waitForTimeout(30);
    continue;
  }
  if (await page.locator('.custom .choice').count()) { await page.click('.custom .choice'); await page.waitForTimeout(30); continue; }
  await page.waitForTimeout(40);
}

check(sawBox, 'L1 普通对白在真浏览器里出现底部对白框');
check(sawDock, '干预窗口在真浏览器里出现按钮');

// ── 时相场景验收（美工 A《环境与移动》首批交付的 D1 九个时刻）────────────────
// jsdom 不计算布局、也不算层叠，所以"底图到底画的是哪一张、上面叠没叠光、叠了几层"
// 只有在真浏览器里量才算数。取的是探针在每次 data-moment 变化那一刻记下的快照。
{
  const log = await page.evaluate(() => /** @type {any} */ (window).__sceneLog ?? []);
  for (const s of log) if (!sceneSeen.has(s.moment)) sceneSeen.set(s.moment, s);
  notes.push(`  info 时相场景：探针记录到 ${log.length} 次时刻渲染，覆盖 ${sceneSeen.size} 个不同时刻`);

  const missing = Object.keys(D1_SCENE_EXPECT).filter((id) => !sceneSeen.has(id));
  check(missing.length === 0, 'D1 九个时刻在真浏览器里全部被观察到', `缺 ${missing.join('、') || '（无）'}`);
  for (const [momentId, sceneId] of Object.entries(D1_SCENE_EXPECT)) {
    const s = sceneSeen.get(momentId);
    if (!s) continue;
    check(s.scene === sceneId, `${momentId} 进的是时相场景 ${sceneId}`, `实际 ${s.scene || '(无)'}`);
    check(s.bgKind === 'jpeg', `${momentId} 的底图是正式交付图（不是占位 SVG）`, `实际 ${s.bgKind}`);
  }

  const dawn = sceneSeen.get('D1_0620');
  const lightsOut = sceneSeen.get('D1_2320');
  const morning = sceneSeen.get('D1_0740');
  const night = sceneSeen.get('D1_2140');
  const running = sceneSeen.get('D1_1530');

  if (dawn && lightsOut) {
    check(dawn.bgFp !== lightsOut.bgFp, '清晨的卧室和熄灯的卧室用的是两张不同的底图');
    check(lightsOut.overlayKinds.length === 0, '卧室的时相差别由底图表达，不额外叠光层', JSON.stringify(lightsOut.overlayKinds));
  }
  if (morning && night) {
    // 教室刻意只有一张底图，时段差别靠一层光表达 —— 底图若不同，说明有人加了第二张教室图，
    // 那样教室的陈设会随时段对不上。
    check(morning.bgFp === night.bgFp, '早读与晚自习的教室共用同一张底图（时段差别只靠一层光）');
    check(
      (morning.overlayFps[0] ?? 'none') !== (night.overlayFps[0] ?? 'none'),
      '清晨光与夜间光是两层不同的叠加层',
      `morning=${morning.overlayKinds} night=${night.overlayKinds}`,
    );
    check(night.overlayKinds.length === 1, '晚自习的教室恰好叠一层光', JSON.stringify(night.overlayKinds));
    check(night.overlayKinds[0] === 'png', '教室的光是带透明通道的 PNG（否则整屏会被压掉）', JSON.stringify(night.overlayKinds));
    // 叠加层的浓度由图自己的 alpha 决定：CSS 不能再二次压暗（以前是 .42）
    check(night.overlayOpacity === 1, '叠加层没有被 CSS 二次压暗（opacity 必须是 1）', `opacity=${night.overlayOpacity}`);
  }
  if (running) {
    check(running.overlayKinds.length === 0, '跑操那一刻操场没有雨幕（脚本里 D1 跑操不下雨）', JSON.stringify(running.overlayKinds));
  }
  if (dawn) {
    check(dawn.bgOpacity === 1, '底图没有被 CSS 二次压暗（opacity 必须是 1）', `opacity=${dawn.bgOpacity}`);
  }
}

// ── 干预窗口的"有人在场"对账 ────────────────────────────────────────────────
// 每个窗口取样一次（见上面循环里的 stage 检查）。重点钉住 D2 08:00「成绩单来了」：
// 那一刻的围观图曾经被按性别引用成一个不存在的 AssetId，于是**整个干预窗口没有人物图**，
// 而当时所有测试都是绿的。现在它必须至少有一张插画卡或一个立绘。
{
  const d2 = emptyStageMoments.find((s) => s.startsWith('D2_0800'));
  check(d2 !== undefined, '走到了 D2 08:00「成绩单来了」的干预窗口', `取样到 ${emptyStageMoments.length} 个窗口`);
  check(d2 !== undefined && !d2.endsWith('cg0/cast0'), 'D2 08:00 的干预窗口里有人物画面（不是一屏空教室）', d2 ?? '—');
  notes.push(`  info 干预窗口取样：共 ${emptyStageMoments.length} 个窗口，${JSON.stringify(emptyStageMoments)}`);
}

// D1 剧情插画（美术交付说明《三、DAY1 推荐使用流程》）
if (deliveredReal.length > 0 && cgMetrics) {
  notes.push(`  info D1 插画：${JSON.stringify(cgMetrics)}`);
  check(cgMetrics.pointerEvents === 'none', '插画层 pointer-events:none（不会吃掉对白框/干预按钮的点击）', cgMetrics.pointerEvents);
  check(cgMetrics.decoded === cgMetrics.count && cgMetrics.count > 0, '插画真的画出来了（没有裂图）', `解码 ${cgMetrics.decoded}/${cgMetrics.count}`);
  // 「正式插画」的判据是**栅格图**（jpeg / png / webp），而不是"非 svg 即占位"里的某两种。
  // 从前这里只放行 jpeg/png，是因为 D1 那批交付被压平成 JPEG 导入的；现在 D1 立绘是
  // 真正去过背的 **WebP 抠图**（scripts/import-stage-art.py），于是这条断言开始误报
  // —— 它红的原因是"图变好了"，正是要避免的那种假警报。
  check(
    cgMetrics.kinds.every((k) => /^data:image\/(jpeg|png|webp)/.test(k)),
    'D1 用的是正式插画（栅格图），不是占位 SVG',
    JSON.stringify(cgMetrics.kinds),
  );
  check(cgMetrics.assets.every((a) => String(a).startsWith('art.d1.')), '插画槽位标注的是 D1 的 AssetId', JSON.stringify(cgMetrics.assets));
  check(cgMetrics.studentCount === 0, '占位人物图形已经彻底不在 DOM 里（.student / .student-layer / .student-svg 一个都没有）', `studentCount=${cgMetrics.studentCount}`);
  check(cgMetrics.placeholderFigures === 0, '插画与立绘用的都是正式交付图，画面上没有占位人物', `placeholderFigures=${cgMetrics.placeholderFigures}`);
  check(cgMetrics.castHidden, '插画在场时立绘行也让位（插画里本来就画着人，再立一份就是两个主角）', `castHidden=${cgMetrics.castHidden}`);
  check(sawCgPair, '被当众批评那一刻出现过"两张并排"（主角紧绷动作 + 老师严肃批评）');
} else {
  notes.push('  info 现场没抓到 D1 插画（art/ 为空或首屏不在 D1），跳过插画对账');
}

// ── 立绘行（底部演出带的上半段）────────────────────────────────────────────
// 硬验收：一个人物居中、两个人物分居左右；文字在下部且不被立绘压住。
// 立绘用的是**开局那个性别**的正式图，不是占位图、也不是通用 SVG 小人。
if (singleCast) {
  notes.push(`  info 立绘行（一个人物）：${JSON.stringify({ dataCast: singleCast.dataCast, figs: singleCast.figs, band: singleCast.bandBox, bar: singleCast.barBox })}`);
  const [f] = singleCast.figs;
  check(singleCast.dataCast === '1' && singleCast.figs.length === 1, '场上一个人物时，立绘行只画一个人物', `data-cast=${singleCast.dataCast}`);
  check(f?.side === 'left', '唯一的人物占主角槽位（left）', `side=${f?.side}`);
  check(f?.active === true && f?.inactive === false, '一个人物时不把他压暗（台词必然是他在说）', JSON.stringify({ active: f?.active, inactive: f?.inactive }));
  // 居中：人物中心与演出带中心对齐（±6px）
  const bandCx = (singleCast.bandBox.left + singleCast.bandBox.right) / 2;
  check(Math.abs((f?.cx ?? 0) - bandCx) <= 6, '一个人物时水平居中', `人物中心 ${f?.cx} vs 带中心 ${Math.round(bandCx)}`);
  check(f?.decoded === true && f.w > 0 && f.h > 0, '立绘真的画出来了（不是裂图 / 0 尺寸）', `${f?.natW}×${f?.natH}，显示 ${f?.w}×${f?.h}`);
  check(f?.inactive === false, '独白时立绘保持亮态', JSON.stringify(f));
  // 立绘在文字带之上，两者不重叠。
  // 用**布局盒**比：说话者按 §5.1 放大到 1.12 倍，视觉盒会比布局盒高出约 13px，
  // 拿视觉盒比会把这条刻意为之的放大报成"压住台词"（实测报过一次 7px 的假失败）。
  check(
    singleCast.layoutCastBottom <= singleCast.layoutBarTop + 1,
    '立绘行在文字带之上，没有压住台词',
    JSON.stringify({ castLayoutBottom: singleCast.layoutCastBottom, barLayoutTop: singleCast.layoutBarTop }),
  );
  check(
    singleCast.textBox.top > singleCast.viewportH / 2,
    '台词落在界面下半部',
    `文字带 top=${singleCast.textBox.top} / 视口高 ${singleCast.viewportH}`,
  );
  check(singleCast.studentNodes === 0, '画面上没有占位人物图形（占位小人已整个删除）', `studentNodes=${singleCast.studentNodes}`);
}
if (pairCast) {
  notes.push(`  info 立绘行（两个人物）：${JSON.stringify({ dataCast: pairCast.dataCast, figs: pairCast.figs })}`);
  const [L, R] = pairCast.figs;
  const bandCx = (pairCast.bandBox.left + pairCast.bandBox.right) / 2;
  check(pairCast.dataCast === '2' && pairCast.figs.length === 2, '场上两个人物时，立绘行画两个人', `data-cast=${pairCast.dataCast}`);
  check(
    (L?.cx ?? 0) < bandCx && (R?.cx ?? 0) > bandCx,
    '两个人物分居左右（一个在带中心左侧、一个在右侧）',
    `左 ${L?.cx} / 右 ${R?.cx} / 带中心 ${Math.round(bandCx)}`,
  );
  check(L?.side === 'left' && R?.side === 'right', '左槽是主角、右槽是对方', `${L?.side} / ${R?.side}`);
  // 按开发文档 §5.1 的具体数值验收，而不是"谁比谁大"。
  // 当前说话者 scale 1.08–1.15 且亮度 100%；另一方 scale 0.82–0.92 且亮度约 55%。
  const A = pairCast.figs.find((f) => f.active);
  const I = pairCast.figs.find((f) => f.inactive);
  const inRange = (v, lo, hi) => v >= lo - 1e-6 && v <= hi + 1e-6;
  check(!!A && !!I, '两个人时一个亮、一个暗（说话者高亮）', JSON.stringify(pairCast.figs.map((f) => ({ side: f.side, active: f.active, inactive: f.inactive }))));
  if (A && I) {
    check(A.side === 'left', '当前说话者是主角（发话方高亮）', `active side=${A.side}`);
    check(A.scale > I.scale, '当前说话者比另一方放大', `active scale=${A.scale} vs inactive scale=${I.scale}`);
    check(inRange(A.scale, 1.08, 1.15), '§5.1 当前说话者缩放落在 1.08–1.15', `active scale=${A.scale}`);
    check(inRange(I.scale, 0.82, 0.92), '§5.1 非当前说话者缩放落在 0.82–0.92', `inactive scale=${I.scale}`);
    // "变亮/变暗"要看 filter 的 brightness，不能拿 opacity 当亮度
    check(A.brightness > I.brightness, '当前说话者比另一方更亮（按 filter brightness，不是 opacity）', `active brightness=${A.brightness} vs inactive brightness=${I.brightness}`);
    check(inRange(A.brightness, 0.99, 1.01), '§5.1 当前说话者亮度 100%', `active brightness=${A.brightness}`);
    check(inRange(I.brightness, 0.5, 0.6), '§5.1 非当前说话者亮度约 55%', `inactive brightness=${I.brightness}`);
  }
  check(pairCast.figs.every((f) => f.decoded), '两个人的图都真的画出来了', JSON.stringify(pairCast.figs.map((f) => `${f.asset}:${f.natW}×${f.natH}`)));
  check(pairCast.studentNodes === 0, '画面上没有占位人物图形', `studentNodes=${pairCast.studentNodes}`);
} else {
  notes.push('  info 全程没有出现"两个人物"的场面（脚本里老师只在 D2/D3 各出场一次），跳过两态验收');
}

if (boxMetrics) {
  check(boxMetrics.boxVisible && boxMetrics.speaker === 'TA', 'L1 对白带显示说话者标签', JSON.stringify({ boxVisible: boxMetrics.boxVisible, speaker: boxMetrics.speaker }));
  check(boxMetrics.portraitsInsideBox === 0, '立绘不再挤在文字框内部（人物图走底部演出带的立绘行）', `框内立绘 ${boxMetrics.portraitsInsideBox} 个`);
  // 人物图这一刻可能在立绘行里、也可能在剧情插画卡里（有插画的时刻立绘行让位）——
  // 两者都算，但**必须有一个真的画出来了**：全都没有就是"这一屏没有人物图"，
  // 那要么是内容漏了图，要么是图没解码。
  const figuresShown = boxMetrics.castImgs > 0 || boxMetrics.cgImgs > 0;
  const figuresDecoded = boxMetrics.castImgsDecoded + boxMetrics.cgImgsDecoded;
  check(
    figuresShown && figuresDecoded >= figuresShown,
    '这一刻的人物图真的画出来了（立绘行或剧情插画卡）',
    `立绘行 ${boxMetrics.castImgsDecoded}/${boxMetrics.castImgs}，插画卡 ${boxMetrics.cgImgsDecoded}/${boxMetrics.cgImgs}`,
  );
  check(boxMetrics.boxTop > boxMetrics.viewportH / 2, 'L1 台词带落在界面下半部', `top=${boxMetrics.boxTop} / 视口高 ${boxMetrics.viewportH}`);
  check(boxMetrics.pngImgs <= 2, '同屏没有同时出现两份以上的主角立绘', `本屏 data:image/png 图 ${boxMetrics.pngImgs} 张`);
}

// 正式立绘对账：按开局性别取图，且是 320×420 的正式图而不是占位图
{
  const subject = pairCast?.figs.find((f) => f.side === 'left') ?? singleCast?.figs[0] ?? null;
  const pickedGender = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('jks2.save'))?.custom?.gender ?? null; } catch { return null; }
  });
  const expectWho = pickedGender === '女生' ? 'girl' : pickedGender === '男生' ? 'boy' : null;
  notes.push(`  info 立绘实际用图：${JSON.stringify(subject)}（开局选的是「${pickedGender}」）`);
  check(pickedGender === '男生' || pickedGender === '女生', '开局问卷选出的性别已写进存档', String(pickedGender));
  if (expectWho && subject) {
    check(
      String(subject.asset).includes(`.${expectWho}`),
      `主角立绘按开局性别取图（选了「${pickedGender}」→ 只能用 ${expectWho} 的图）`,
      `data-asset=${subject.asset}`,
    );
    check(
      subject.kind === 'png' || subject.kind === 'webp',
      '主角立绘用的是正式交付图，不是占位图',
      `kind=${subject.kind}（${subject.natW}×${subject.natH}）`,
    );
    check(
      subject.natW === 320 && subject.natH === 420,
      '正式立绘按规格 320×420 上屏（没有被拉伸成别的尺寸）',
      `${subject.natW}×${subject.natH}`,
    );
    // 两位主角绝不能同屏（美术交付说明 §一.2）：场上所有立绘都必须是这个性别的。
    const others = (pairCast?.figs ?? []).concat(singleCast?.figs ?? []).filter((f) => f.side === 'left');
    const wrong = others.filter((f) => !String(f.asset).includes(`.${expectWho}`));
    check(wrong.length === 0, '同屏没有出现另一个性别的主角图', JSON.stringify(wrong.map((f) => f.asset)));

    /**
     * 透明通道是不是**干净的抠图**（《待确认问题》§6.9⑥）。
     *
     * 交付的 `portrait.player.*.png` 曾经是这样：alpha 全透明 21% / **半透明 26%** / 实体 49%。
     * 也就是人物抠出来了，但背景没抠干净、留了一层半透明灰雾 —— 在清晨教室那种浅场景里
     * 看不出来，到了 D4 黄昏、D6 夜里的暗场景就是人物背后的一团灰云（真机截图里一眼可见）。
     * 现在由 `scripts/clean-portrait-alpha.py` 二值化处理过，半透明应当只剩轮廓那一圈。
     *
     * 断的是**比例**不是绝对值：重出图之后只要半透明不回到一成以上就算过。
     * 数据来自 bandMetrics 捕获立绘那一刻量的 alpha 直方图（那时代码里才有那个 <img>）。
     */
    const alpha = subject?.alphaStats ?? null;
    if (alpha) {
      notes.push(`  info 立绘 alpha 分布：透明 ${(alpha.clear * 100).toFixed(1)}% / 半透明 ${(alpha.mid * 100).toFixed(1)}% / 实体 ${(alpha.solid * 100).toFixed(1)}%`);
      check(alpha.clear > 0.30, '立绘背景真的被抠掉了（全透明像素占三成以上）', `${(alpha.clear * 100).toFixed(1)}%`);
      check(alpha.mid < 0.10, '立绘的透明通道是干净的（没有那层半透明灰雾）', `半透明 ${(alpha.mid * 100).toFixed(1)}%`);
    } else {
      notes.push('  info 没抓到立绘的 alpha 直方图（这一刻立绘行不在场），跳过抠图干净度验收');
    }
  } else {
    notes.push('  info 该性别的主角正式图还没交，跳过正式立绘对账（不判失败）');
  }
}

// 结局页
await page.waitForSelector('.ending', { timeout: 300000 });
await shoot({ path: `${SHOTS}/07-ending.png`, fullPage: false });
check(await page.locator('.ending-stats .stars').count() === 1, '结局页显示守护星级');
check(await page.locator('.history-cloud').count() === 7, '结局页显示七朵云', `实际 ${await page.locator('.history-cloud').count()} 朵`);
check(await page.locator('.bottle input').count() === 1, '结局页有留言瓶入口');
const endingTitle = await page.locator('.ending-card h1').innerText();
notes.push(`  info 结局：${endingTitle}`);

// 结局浮层出现时，场景里的演出层必须已经收干净（否则人物会从卡片下面露出来）
const leftover = await page.evaluate(() => ({
  student: document.querySelectorAll('.student, .student-layer').length,
  cast: document.querySelectorAll('.cast-layer:not([hidden]) .portrait').length,
  line: document.querySelectorAll('.dialogue-box:not([hidden])').length,
  box: document.querySelectorAll('.dialogue-box:not([hidden])').length,
  dock: document.querySelectorAll('.dock .choice').length,
  signal: document.querySelectorAll('.signal').length,
  countdown: document.querySelectorAll('.countdown').length,
  cg: document.querySelectorAll('.moment-cg:not([hidden])').length,
}));
check(
  Object.values(leftover).every((n) => n === 0),
  '结局浮层后面没有残留的演出层',
  JSON.stringify(leftover),
);

// 左上角放大看：地点标题不能被推近镜头推出场景边界（会被 overflow:hidden 切成一截乱码）
const corner = await page.evaluate(() => {
  const t = document.querySelector('.location-title');
  if (!t) return null;
  const cs = getComputedStyle(t);
  const r = t.getBoundingClientRect();
  const scene = document.querySelector('.scene')?.getBoundingClientRect();
  return {
    text: t.textContent, color: cs.color, opacity: cs.opacity,
    x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
    sceneLeft: scene ? Math.round(scene.left) : null,
    insideScene: scene ? r.left >= scene.left - 1 : true,
  };
});
check(corner?.insideScene !== false, '结局的地点标题留在场景内，没有被镜头推出去切掉', JSON.stringify(corner));
notes.push(`  info 结局左上角标题：${JSON.stringify(corner)}`);
await shoot({ path: `${SHOTS}/09-ending-corner.png`, clip: { x: 60, y: 30, width: 460, height: 150 } });

// ── 开发文档 §5.1 的对白能力：已读快进 / 文字速度 / 自动播放 ──
// 这三项都要真跑行为，不能只看按钮文案。
/**
 * **页面内**用 MutationObserver 记录"台词每次变长的时间戳"。
 * 为什么不在 Node 侧轮询文字：Playwright 每次取值是一个往返，实测延迟能到 100–300ms，
 * 比整句打字时间还长。前一版就是轮询着量的，量出来"慢 302ms / 快 12ms"——
 * 那量的是探测延迟，不是打字速度（快档那 12ms 其实是第一次取值时句子已经打完了）。
 * 断言当时碰巧通过，但数值是假的。改成页面内记录后，时间戳不受往返延迟影响。
 */
async function installTypeTrace() {
  await page.evaluate(() => {
    const box = document.querySelector('.dialogue-box');
    window.__typeTrace = [];
    const t0 = performance.now();
    // 量的是 `.box-text` 的长度，不是整个框的 textContent：
    // 框里还有 `.box-speaker`（"TA"）和模板里的缩进换行，那些字符不参与逐字动画，
    // 算进去会让"这一句打完了"判定在一个固定的偏移上失真。
    // 每次回调重新取 `.box-text` 而不是闭包抓住它 —— 换一句时 box.innerHTML 整体重写，
    // 节点会换新的，抓住旧节点的话第二句起就再也记不到东西了。
    const push = () => {
      const t = box?.querySelector('.box-text');
      window.__typeTrace.push([Math.round(performance.now() - t0), t ? t.textContent.length : 0]);
    };
    new MutationObserver(push).observe(box, { childList: true, characterData: true, subtree: true });
    push();
  });
}

/** 从 trace 里取"第一句"的打字情况：从第一个非空字到最后一个字的耗时 */
async function firstLineTyping() {
  return page.evaluate(() => {
    const tr = window.__typeTrace ?? [];
    let start = -1, end = -1, chars = 0;
    for (const [t, n] of tr) {
      if (n === 0) { if (start >= 0) break; continue; }   // 被清空 = 进入下一句
      if (start < 0) { start = t; chars = n; end = t; continue; }
      if (n > chars) { chars = n; end = t; }
      else if (n < chars) break;
    }
    return { ms: end - start, chars, samples: tr.length };
  });
}

/** 重新载入并从标题页走到第一句台词（可选清掉存档，得到全新一周目） */
async function reachFirstLine({ clearSave }) {
  await page.evaluate((clear) => {
    if (clear) localStorage.removeItem('jks2.save');
  }, clearSave);
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.title-screen', { timeout: 20000 });
  // 必须在点"开始守护"之前装上：第一句就是我们要量的那句
  await installTypeTrace();
  await page.click('.title-screen [data-act="start"]');
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.debug-target').count()) break;
    if (await page.locator('.custom').count()) { await answerOnce(); continue; }
    await page.waitForTimeout(60);
  }
  await page.click('.debug-target');
  await page.waitForSelector('.dialogue-box:not([hidden])', { timeout: 20000 });
}

/** 等第一句彻底打完（用页面内的 trace 判断，不用往返轮询） */
async function waitFirstLineDone(expectedChars) {
  for (let i = 0; i < 200; i++) {
    const t = await firstLineTyping();
    if (t.chars >= expectedChars) return t;
    await page.waitForTimeout(50);
  }
  return firstLineTyping();
}

async function setPrefs(prefs) {
  await page.evaluate((p) => localStorage.setItem('jks2.dialoguePrefs', JSON.stringify(p)), prefs);
}

// 1) 文字速度：同一句台词，慢档打完必须明显久于快档
await setPrefs({ auto: false, speed: 'slow' });
await reachFirstLine({ clearSave: true });
const slow = await waitFirstLineDone(12);
await setPrefs({ auto: false, speed: 'fast' });
await reachFirstLine({ clearSave: true });
const fast = await waitFirstLineDone(12);
notes.push(`  info 逐字速度实测（页面内计时，不受往返延迟影响）：慢 ${slow.ms}ms vs 快 ${fast.ms}ms，同样 ${slow.chars} 字`);
check(
  slow.chars === 12 && fast.chars === 12,
  '两档都打完了整句「……再睡五分钟，就好了。」（12 字，对照有效）',
  `慢 ${slow.chars} 字 / 快 ${fast.chars} 字`,
);
// 慢快倍率是 1.7 → 0.45，理论差 3.8 倍；留足余量，只要求"明显更久"
check(
  slow.ms > fast.ms * 1.8,
  '文字速度真的影响逐字快慢（慢档耗时约为快档 2 倍以上）',
  `慢 ${slow.ms}ms vs 快 ${fast.ms}ms`,
);

// 2) 已读快进：存档里标成"已读"的句子，重开一周目后应当整句直接出现。
//    注意顺序——必须先跑到有存档，再去改存档里的 seenLines，不能先删存档再改（那样改的是空气）。
await setPrefs({ auto: false, speed: 'slow' });       // 故意用最慢档：如果还能秒出，说明确实是"已读快进"而不是"速度调快"
await reachFirstLine({ clearSave: true });          // 跑出存档
const patched = await page.evaluate(() => {
  const raw = localStorage.getItem('jks2.save');
  if (!raw) return false;
  const save = JSON.parse(raw);
  save.logs = save.logs ?? {};
  save.logs.seenLines = [...new Set([...(save.logs.seenLines ?? []), 'moment:D1_0620#0'])];
  localStorage.setItem('jks2.save', JSON.stringify(save));
  return true;
});
if (patched) {
  await reachFirstLine({ clearSave: false });       // 重新载入 → 开始守护 → startFresh 会保留 seenLines
  const reread = await waitFirstLineDone(12);
  notes.push(`  info 已读重播：${reread.ms}ms / ${reread.chars} 字（同为慢档的首次阅读是 ${slow.ms}ms）`);
  check(
    reread.chars === slow.chars,
    '已读快进的对照是同一句台词',
    `${reread.chars} 字 vs ${slow.chars} 字`,
  );
  check(
    reread.ms < 30,
    '已读快进：读过的句子整句直接出现（慢档下也是 0 帧打完，不再逐字）',
    `慢档首读 ${slow.ms}ms vs 已读重播 ${reread.ms}ms`,
  );
} else {
  notes.push('  info 已读快进：拿不到存档，跳过对照（不判失败）');
}

// 3) 自动播放：开着不动鼠标，台词应当自己翻到下一句。
await setPrefs({ auto: true, speed: 'fast' });
await reachFirstLine({ clearSave: true });
await waitFirstLineDone(12);                  // 先等这一句打完
const beforeAuto = await page.locator('.dialogue-box').innerText().catch(() => '');
await page.waitForTimeout(3500);              // 全程不点
const afterAuto = (await page.locator('.dialogue-box:not([hidden])').count())
  ? await page.locator('.dialogue-box').innerText().catch(() => '')
  : '';
check(
  afterAuto !== beforeAuto,
  '自动播放：不点鼠标也会自己往下走',
  `「${beforeAuto}」→「${afterAuto}」`,
);
await setPrefs({ auto: false, speed: 'normal' });

// 4) prefers-reduced-motion：装饰动效压到接近 0，但倒计时条必须还能看。
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.title-screen', { timeout: 20000 });
const reduced = await page.evaluate(() => {
  // 造一个倒计时条（它就是 JS 写内联 animation-duration 的那种元素）
  const scene = document.querySelector('.scene');
  const bar = document.createElement('div');
  bar.className = 'countdown';
  bar.innerHTML = '<i style="animation-duration:10s"></i>';
  scene.appendChild(bar);
  const box = document.querySelector('.dialogue-box');
  const boxDur = getComputedStyle(box).animationDuration;
  const barDur = getComputedStyle(bar.querySelector('i')).animationDuration;
  bar.remove();
  const secs = (v) => (v.endsWith('ms') ? parseFloat(v) / 1000 : parseFloat(v));
  return { boxDur, barDur, boxSecs: secs(boxDur), barSecs: secs(barDur) };
});
check(reduced.boxSecs < 0.05, '减动效：对白框进出动画被压到接近 0', JSON.stringify(reduced));
check(
  reduced.barSecs > 5,
  '减动效：倒计时条仍然保留真实时长（它是"还剩几秒"的唯一信息）',
  `countdown i animation-duration = ${reduced.barDur}`,
);
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ── 移动端布局：不能横向溢出 ──
for (const vp of [{ width: 390, height: 844 }, { width: 768, height: 1024 }]) {
  await page.setViewportSize(vp);
  await page.waitForTimeout(200);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(overflow <= 1, `${vp.width}px 宽不横向溢出`, `溢出 ${overflow}px`);
}
await shoot({ path: `${SHOTS}/08-mobile-ending.png` });

// ── 窄屏上真的跑一幕 ──
// 上面那个循环量的是结局页，量不到演出带 —— 而演出带恰恰是这一轮改动最大的地方。
await page.setViewportSize({ width: 390, height: 844 });
await setPrefs({ auto: false, speed: 'normal' });
await reachFirstLine({ clearSave: true });
const mobileBand = await bandMetrics();
if (mobileBand?.textBox) {
  check(
    mobileBand.textBox.top > mobileBand.viewportH / 2,
    '窄屏上文字同样落在界面下半部',
    `文字带 top=${mobileBand.textBox.top} / 视口高 ${mobileBand.viewportH}`,
  );
  check(
    Math.abs(mobileBand.bandBox.bottom - mobileBand.sceneBox.bottom) <= 1,
    '窄屏上底部演出带仍贴着舞台下边缘',
    `band bottom=${mobileBand.bandBox.bottom} / scene bottom=${mobileBand.sceneBox.bottom}`,
  );
}
const mobileCg = await page.evaluate(() => {
  const card = document.querySelector('.moment-cg:not([hidden]) .cg-card');
  const text = document.querySelector('.dialogue-box:not([hidden])');
  if (!card || !text) return null;
  const c = card.getBoundingClientRect();
  const t = text.getBoundingClientRect();
  return { cardBottom: Math.round(c.bottom), textTop: Math.round(t.top), cardW: Math.round(c.width), viewportW: window.innerWidth };
});
if (mobileCg) {
  check(mobileCg.cardBottom <= mobileCg.textTop + 1, '窄屏上插画没有被台词压住', JSON.stringify(mobileCg));
  check(mobileCg.cardW <= mobileCg.viewportW - 8, '窄屏上插画没有横向溢出（左右留了边距）', JSON.stringify(mobileCg));
}
await shoot({ path: `${SHOTS}/15-mobile-dialogue.png` });

/**
 * 「地点名不被浮在场景之上的页眉吃掉」——舞台铺满视口之后新增的硬验收。
 *
 * 舞台改成 fixed;inset:0 之后，页眉从"住在列里的第一行"变成"压在画面上的固定条"
 * （z-index 2，而地点名在 .scene 里只有 1），于是顶部那片区域**物理上重叠**了：
 * 地点名一旦落进页眉的白色柔光里，就会被盖成一团灰糊 —— 不是"不好看"，是读不出来。
 *
 * 落点由 --chrome-top 给，而它是**按页眉实测高度**定死的（桌面 69px / 窄屏换行后 162px）。
 * 这是个会悄悄失效的魔数：页眉哪天多一枚 chip 或者换个字号就会变高，
 * 地点名就又钻回去，而画面上只表现为"左上角有点糊"，没人会想到是布局。
 * 所以这里在两种视口下真量一次间隙，把魔数钉住。
 */
for (const vp of [{ width: 1280, height: 860 }, { width: 390, height: 844 }]) {
  await page.setViewportSize(vp);
  await page.waitForTimeout(150);
  const gap = await page.evaluate(() => {
    const h = document.querySelector('header')?.getBoundingClientRect();
    const t = document.querySelector('.location-title')?.getBoundingClientRect();
    if (!h || !t) return null;
    return { headerBottom: Math.round(h.bottom), titleTop: Math.round(t.top), titleVisible: !!document.querySelector('.location-title') };
  });
  check(
    gap === null || gap.titleTop >= gap.headerBottom,
    `${vp.width}px 宽：地点名没有被浮层页眉盖住`,
    gap ? `页眉底=${gap.headerBottom} 地点名顶=${gap.titleTop}` : '没有地点名可量（跳过）',
  );

  /**
   * 「所有背景画面全屏」的正题验收。
   *
   * 背景图是 .scene 的子节点、写着 inset:0，所以"它有没有铺满"完全取决于**舞台有没有铺满**。
   * 从前舞台是 .game 里一张 1100px 的圆角卡片（实测 1056×741，左侧 112px 都是页面底色），
   * 而铺底对白纸是 fixed 整宽的 —— 两者宽度对不上，纸比背景宽出一截。
   * 这里逐个量：舞台、背景图、叠加层（有的话）、剧情插画层、校园俯瞰图，
   * 全部必须和视口四边对齐。少一个都说明"全屏"只做到了一半。
   */
  const full = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { t: Math.round(b.top), l: Math.round(b.left), r: Math.round(b.right), b: Math.round(b.bottom) };
    };
    const same = (x) => x && x.t === 0 && x.l === 0 && x.r === vw && x.b === vh;
    return {
      vw, vh,
      scene: box('.scene'),
      bg: box('.scene-background'),
      overlay: box('.scene-overlay'),
      cg: box('.moment-cg'),
      ok: ['.scene', '.scene-background', '.moment-cg'].every((s) => same(box(s))),
      paperW: box('.dialogue-box') ? box('.dialogue-box').r - box('.dialogue-box').l : null,
    };
  });
  check(full.ok, `${vp.width}px 宽：背景画面（舞台 / 底图 / 插画层）铺满整个视口`, JSON.stringify(full));
  check(
    full.paperW === full.vw,
    `${vp.width}px 宽：铺底对白纸与背景同宽（不再是一半在卡片外）`,
    `纸宽=${full.paperW} 视口宽=${full.vw}`,
  );
}

check(failedRequests.length === 0, '页面没有 404 / 加载失败（单文件构建不该请求任何外部资源）', failedRequests.slice(0, 5).join(' | '));
check(consoleErrors.length === 0, '真浏览器控制台没有错误', consoleErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('\n=== 真浏览器验收（Playwright）==');

console.log(notes.join('\n'));
if (failures.length) {
  console.log('\n失败项：');
  console.log(failures.join('\n'));
  process.exit(1);
}
console.log('\n全部通过。截图见 tests/browser/shots/');
