// 按天区间的剧情图逐帧验收（真浏览器 + 本机 Chrome）。
//
//   npm run preview 之后：
//     node tests/browser/day-shots.mjs --from 4 --to 7     # D4–D7（默认就是这个区间）
//     node tests/browser/day-shots.mjs --from 2 --to 3     # 等价于旧脚本 day23-shots.mjs
//     node tests/browser/day-shots.mjs --from 4 --to 4 --out tests/browser/shots/day4
//
// 产出：<out>/<序号>-<时刻>-<画面名>.png + 一个 index.html 画廊。
//
// 为什么要有这个脚本：图片"接没接对"在 jsdom 里量不出来 —— 图是不是真画出来了、
// 抠图有没有被框成方块、4:3 的图和 3:4 的图并排时会不会互相挤、两张底图切没切过来，
// 全是**眼睛**的事。截图 + 画廊是给人和美工看的验收物，不是给 CI 看的
// （CI 看的是 tests/unit/* 与 tests/smoke/*）。
//
// 一天一个区间，不按天各写一份脚本：D2–D3 那一版是复制来的，再来三份的话，
// "等打字落定""拍到才 continue"这些坑就得在四个文件里各修一遍。
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.JKS2_URL ?? 'http://127.0.0.1:4180/';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

/** 一屏的完整快照：哪一刻 / 正在演什么 / 用了哪些图 / 谁在场上 */
async function describePage(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('.moment-cg:not([hidden]) .cg-card')];
    const figs = [...document.querySelectorAll('.cast-layer:not([hidden]) .portrait')];
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() ?? '';
    return {
      moment: document.querySelector('.scene')?.dataset.moment ?? '',
      scene: document.querySelector('.scene')?.dataset.scene ?? '',
      theme: document.querySelector('.scene')?.dataset.theme ?? '',
      day: document.querySelector('.day-chip')?.textContent?.trim() ?? '',
      cg: cards.map((c) => ({
        asset: c.getAttribute('data-asset') ?? '',
        alpha: c.hasAttribute('data-alpha'),
        decoded: (() => { const i = c.querySelector('.cg-sharp'); return !!i && i.naturalWidth > 0; })(),
        size: (() => { const i = c.querySelector('.cg-sharp'); return i ? `${i.naturalWidth}×${i.naturalHeight}` : ''; })(),
        // 卡片在屏幕上的实际宽高比 —— 4:3 的图排成 3:4 会当场露馅
        box: (() => { const r = c.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; })(),
      })),
      alphaLayer: document.querySelector('.moment-cg')?.getAttribute('data-alpha') ?? '',
      ending: !!document.querySelector('.ending .ending-card'),
      cast: figs.map((f) => ({
        side: f.dataset.side, asset: f.dataset.asset ?? '',
        active: f.classList.contains('active'),
        box: (() => { const r = f.getBoundingClientRect(); return `${Math.round(r.width)}×${Math.round(r.height)}`; })(),
      })),
      // 台词：全作唯一的文字容器就是底部对白框（云朵已删除）
      line: text('.dialogue-box:not([hidden]) .box-text'),
      dock: [...document.querySelectorAll('.dock .choice')].map((b) => b.textContent?.trim() ?? ''),
      bg: (() => {
        const b = document.querySelector('.scene-background');
        const m = /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(b ?? document.body).backgroundImage || '');
        return m?.[1]?.slice(0, 40) ?? '';
      })(),
    };
  });
}

/**
 * 签名：这一刻 + 进了哪个场景 + 画面上有哪些图 + 正在演哪种 UI。
 *
 * 场景要进去：D7 走完最后一句会进「记忆回响 → 结局」，这两段的 moment 都还是 D7_1500，
 * 只有 scene 在变（memoryEcho → endingSunny）；不带 scene 的话这三屏会被当成同一屏而漏拍。
 */
function signature(d) {
  const ui = d.dock.length ? 'dock' : d.line ? 'line' : '';
  return `${d.moment}|${d.scene}|${d.cg.map((c) => c.asset).join('+')}|${d.cast.map((c) => c.asset).join('+')}|${ui}`;
}

/** 这一屏叫什么（画廊标题）。从 AssetId 反推，不维护第二张表。 */
const ZH = {
  // 场景
  bedroomMorning: '卧室·清晨', bedroomNight: '卧室·夜灯', bedroomLightsOut: '卧室·熄灯',
  classroomMorning: '教室·清晨光', classroomNight: '教室·夜间光', classroomFoggy: '教室·下午隔着雾',
  classroomDusk: '教室·黄昏粉笔灰', classroomEarlyLight: '教室·天亮得早一点', classroomMakeup: '教室·补课清晨',
  classroomPenSound: '教室·笔尖沙沙', classroomFinale: '终章·抬头背景', classroom: '教室·基底',
  playgroundRunning: '操场·跑操', playgroundWindy: '操场·风', playgroundGentle: '操场·温柔的风',
  playgroundRainRun: '操场·考后冒雨', playgroundClearing: '操场·雨后放晴', playgroundBlueSky: '操场·天好蓝',
  playground: '操场·基底', memoryEcho: '记忆回响·黑屏', endingSunny: '结局页·七朵云', endingRain: '结局页·七朵云',
  // 剧情图
  report: '查看成绩单', bunkSleep: '上下铺皱眉睡觉', canteen: '食堂', crowd: '同学聚拢围观',
  handout: '老师递出成绩单', morningRead: '晨读喝豆浆', lunchAlone: '一个人的午饭',
  examDream: '梦里都在考试', rankCalled: '排名被当众念出', phoneBow: '家长来电低头', phoneCall: '手机·来电',
  notesPassed: '同桌把笔记推过来', notesProp: '课堂笔记', soda: '冰汽水', bondCheck: '羁绊检查点',
  invigilate: '监考压力捂耳朵', examPaper: '试卷与铅笔', coldLunch: '饭有点凉',
  rankPost: '排名公布', lastNight: '最后一夜睡眠不足', finalLookUp: '终章抬头',
  // D1 姿态
  calm: '平静', tired: '疲惫', tense: '紧绷', relax: '放松/放空（同一张图）', down: '低头',
  sit: '坐姿', sitRelax: '放松坐姿', strain: '紧绷动作',
};

function labelOf(d) {
  if (d.ending) return '结局页（七朵云背景 + 结算卡）';
  // 同一时刻会有好几屏（入场 → 干预窗口 → 收尾），签名靠 UI 区分，标题也带上它，
  // 否则画廊里会出现两张标题一模一样、只有底下小字不同的卡片。
  const ui = d.dock.length ? '干预窗口' : d.line ? '底部对白框' : '';
  const sceneName = ZH[d.scene];
  if (d.cg.length) {
    const art = d.cg.map((c) => {
      const tail = c.asset.split('.').pop();
      return `${ZH[tail] ?? tail}${c.alpha ? '（抠图）' : ''}`;
    }).join(' + ');
    // 没有插画卡时，标题用场景名；有卡时把场景名挪到小字里，免得标题太长
    return ui ? `${art}·${ui}` : art;
  }
  if (d.dock.length) return `干预窗口（还没选）·${sceneName ?? d.scene}`;
  if (d.cast.length) {
    // 结局那一段的立绘行也走这里，而它底下是"七朵云"结局背景（不是地点场景），
    // 所以把场景名带上，否则画廊里会出现一张只有"立绘行：主角"、看不出是哪一幕的卡片。
    const where = /^ending/.test(d.scene) ? '·结局背景' : '';
    return `立绘行：${d.cast.map((c) => (c.side === 'left' ? '主角' : '对方')).join(' + ')}${where}${ui ? `·${ui}` : ''}`;
  }
  if (d.line) return `${sceneName ?? '对白'}${ui ? `·${ui}` : ''}`;
  return `空画面·${sceneName ?? d.scene}`;
}

async function waitTypingDone(page, timeoutMs = 2600) {
  const deadline = Date.now() + timeoutMs;
  let prev = '';
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => (
      document.querySelector('.dialogue-box:not([hidden]) .box-text')?.textContent ?? ''
    ).trim());
    if (t && t === prev) return t;
    prev = t;
    await page.waitForTimeout(130);
  }
  return prev;
}

async function runPhase(browser, phase, ctx) {
  const shotKeys = new Set();
  console.log(`\n=== ${phase.name} ===`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(ctx.base, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.removeItem('jks2.save'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.title-screen', { timeout: 20000 });
  await page.click('.title-screen [data-act="start"]');
  // 等字体与图解码完再答问卷：开局那两张立绘是 1300 KB 级的 data URL，
  // 解码与字体回退会让按钮在几帧里挪位置 —— Playwright 的"元素不稳定"保护会一直重试到超时
  // （实测就是这么挂的）。这里用页面内 click()，顺带把这个抖动绕开。
  await page.evaluate(() => document.fonts?.ready).catch(() => {});
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.debug-target').count()) break;
    const answered = await page.evaluate((g) => {
      const btns = [...document.querySelectorAll('.custom .choice')];
      if (!btns.length) return false;
      const hit = btns.find((b) => b.textContent?.includes(g)) ?? btns[0];
      hit.click();
      return true;
    }, phase.gender);
    await page.waitForTimeout(answered ? 120 : 60);
  }
  await page.waitForSelector('.debug-target', { timeout: 20000 });

  for (let i = 0; i < 4000; i++) {
    const d = await describePage(page);
    // 结局页也算一屏：D7 交付的「结局页_七朵云背景」只有走到这一步才看得见
    if (d.ending) {
      if (!shotKeys.has(signature(d))) { shotKeys.add(signature(d)); await shoot(page, d, phase, ctx); }
      break;
    }
    if (d.moment.startsWith(`D${ctx.to + 1}_`)) break;

    const day = Number(/^D(\d+)_/.exec(d.moment)?.[1] ?? 0);
    const inRange = day >= ctx.from && day <= ctx.to;
    // 非干预窗口：等打字落定 → 签名变了就拍。**拍到才 continue**，
    // 没拍到要落到下面的"推进"去 —— 否则这一幕会原地打转（第一版就是这么死在 D2_0620 上的：
    // 拍完第一张之后每一轮都在这里 continue，剧情一步没往前走）。
    if (inRange && !d.dock.length) {
      await waitTypingDone(page);
      const after = await describePage(page);
      if (after.moment === d.moment && signature(after) && !shotKeys.has(signature(after))) {
        await sleep(460);                       // 插画淡入 0.45s，等它落定再拍
        const settled = await describePage(page);
        if (settled.moment === d.moment && signature(settled)) {
          shotKeys.add(signature(settled));
          await shoot(page, settled, phase, ctx);
          continue;
        }
      }
    }
    // 干预窗口也拍一张（这时画面通常是"两张并排"）
    if (inRange && d.dock.length && !shotKeys.has(signature(d))) {
      shotKeys.add(signature(d));
      await shoot(page, d, phase, ctx);
    }

    // ── 推进 ──
    // 人物自动移动转场：截图这一批关心的是"每个时刻画成什么样"，不是走路本身
    // （走路单独由 tests/browser/walk-shots.mjs 验收）。跳过它，和玩家能做的一样。
    //
    // **点「跳过」按钮，不要按回车。** 第一版按的是回车，结果 day23 的 D3_1540「风」
    // 整张截图消失了 —— 那一幕只有一句 L0 台词、前面紧挨着一次换地点：
    // 如果转场在我们发键之前刚好自然走完，这个回车就落到了**下一幕的台词**上、
    // 把唯一那句台词翻过去了，而截图的判据是"这一刻还在不在"，于是整幕都没拍到。
    // 换成点按钮之后就没有这个问题：按钮和转场同生共死，转场没了就是点空、什么都不发生。
    // 跳完还要等**新场景真的挂上**再继续，否则下一轮会在"过渡中间态"上做判断
    // （那时 data-moment 已经被删掉，describePage 认不出这是哪一幕）。
    if (await page.locator('.walk').count()) {
      await page.locator('[data-walk-act="skip"]').click({ timeout: 2000 }).catch(() => {});
      await page.waitForFunction(() => {
        const s = document.querySelector('.scene');
        return !document.querySelector('.walk') && s && s.dataset.scene && s.dataset.scene !== 'campus-walk';
      }, null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('.dock .choice:not([disabled])').count()) {
      await page.click('.dock .choice:not([disabled])');   // 每次都干预 → 拍成功分支
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('.dialogue-box:not([hidden])').count()) { await page.click('.dialogue-box:not([hidden])'); await page.waitForTimeout(60); continue; }
    if (await page.locator('.dialogue-box:not([hidden])').count()) { await page.click('.dialogue-box:not([hidden])'); await page.waitForTimeout(60); continue; }
    if (await page.locator('.debug-target').count()) {
      await page.click('.debug-target');
      await page.waitForFunction(() => !document.querySelector('.debug-target'), null, { timeout: 3000 });
      await page.waitForTimeout(60);
      continue;
    }
    await page.waitForTimeout(50);
  }

  if (errors.length) ctx.warnings.push(`${phase.name}：控制台报错 ${errors.length} 条（${errors[0]}）`);
  await context.close();
}

async function shoot(page, d, phase, ctx) {
  ctx.shotIndex += 1;
  const n = String(ctx.shotIndex).padStart(2, '0');
  const file = `${n}-${d.moment || 'gate'}-${labelOf(d).replace(/[\\/:*?"<>|（）\s]/g, '')}.png`;
  await page.screenshot({ path: `${ctx.dir}/${file}` });
  ctx.gallery.push({ file, phase: phase.name, ...d, label: labelOf(d) });
  console.log(`  ${n}  ${(d.moment || '—').padEnd(9)} ${d.day.padEnd(6)} ${labelOf(d)}`);
  // 图没解码出来（裂图）当场报 —— 这是"接了图但对不上"最典型的症状
  for (const c of d.cg) if (!c.decoded) ctx.warnings.push(`${d.moment}：${c.asset} 没有解码成功（裂图？）`);
  for (const f of d.cast) if (!f.asset) ctx.warnings.push(`${d.moment}：立绘槽位没有 data-asset`);
}

function writeGallery(ctx) {
  const { gallery, warnings, dir, title } = ctx;
  const byPhase = [...new Set(gallery.map((g) => g.phase))].map((p) => ({ p, shots: gallery.filter((g) => g.phase === p) }));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>${title} · 如果有你</title>
<style>
 body{margin:0;padding:32px 40px;background:#12100f;color:#e8e2da;font:14px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
 h1{font-size:22px;margin:0 0 6px}.sub{color:#8c837a;margin-bottom:20px}
 h2{font-size:15px;font-weight:600;margin:34px 0 14px;padding-bottom:8px;border-bottom:1px solid #2c2825;color:#f0d9b5}
 .card{display:grid;grid-template-columns:600px 1fr;gap:22px;align-items:start;margin:0 0 22px;padding:16px;background:#1a1716;border:1px solid #262220;border-radius:12px}
 .card img{width:100%;border-radius:8px;display:block;border:1px solid #2e2926}
 .n{display:inline-block;min-width:26px;color:#f0d9b5;font-weight:600}
 .meta{color:#8c837a;font-size:12px;margin:2px 0 10px}
 .look{color:#d8d2c8}.note{color:#7f9c7f;font-size:12.5px;margin-top:8px}
 .warn{padding:10px 14px;background:#3a1f1f;border:1px solid #6b3535;border-radius:8px;margin-bottom:14px}
 code{background:#262220;padding:1px 5px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>${title}</h1>
<div class="sub">共 ${gallery.length} 张。每张下面写着"这一刻应该看到什么" —— 图接错了、抠图被框成方块、4:3 排成 3:4、天气没切过来，都会在这一栏和画面上对不上。</div>
${warnings.length ? `<div class="warn"><b>需要注意 ${warnings.length} 条</b><br>${warnings.map((w) => `· ${w}`).join('<br>')}</div>` : '<div class="sub">没有发现裂图 / 缺图 / 控制台报错。</div>'}
${byPhase.map(({ p, shots }) => `<h2>${p}（${shots.length} 张）</h2>${shots.map((g) => `
<div class="card">
  <img src="${encodeURIComponent(g.file)}" alt="${g.file}">
  <div>
    <div><span class="n">${g.file.split('-')[0]}</span> <b>${g.moment || '地点入口'} · ${g.day}</b></div>
    <div class="meta">场景 <code>${g.scene || '—'}</code>${g.theme ? ` · theme ${g.theme}` : ''}${g.alphaLayer ? ` · 抠图层 data-alpha=${g.alphaLayer}` : ''}</div>
    <div class="look">这一屏：<b>${g.label}</b></div>
    ${g.cg.length ? `<div class="meta">插画卡：${g.cg.map((c) => `<code>${c.asset}</code> ${c.size} 实际 ${c.box}`).join('　')}</div>` : ''}
    ${g.cast.length ? `<div class="meta">立绘行：${g.cast.map((c) => `<code>${c.asset}</code> ${c.box}${c.active ? '（亮）' : '（暗）'}`).join('　')}</div>` : ''}
    <div class="note">${g.line || (g.dock.length ? `按钮：${g.dock.join(' / ')}` : '—')}</div>
  </div>
</div>`).join('')}`).join('')}
</body></html>`;
  writeFileSync(`${dir}/index.html`, html);
}

export async function runDayShots({ from = 4, to = 7, dir = `tests/browser/shots/day${from}${to}`, title = `D${from}–D${to} 剧情图验收`, base = BASE } = {}) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ctx = { from, to, dir, title, base, gallery: [], warnings: [], shotIndex: 0 };
  const browser = await launch();
  for (const phase of [
    { name: '男生 · 全程干预成功', gender: '男生' },
    { name: '女生 · 全程干预成功', gender: '女生' },
  ]) await runPhase(browser, phase, ctx);
  await browser.close();
  writeGallery(ctx);
  console.log(`\n画廊：${dir}/index.html（${ctx.gallery.length} 张，${readdirSync(dir).length - 1} 个文件）`);
  if (ctx.warnings.length) { console.log('\n需要注意：'); for (const w of ctx.warnings) console.log(`  ! ${w}`); }
  return ctx;
}

// 被当作脚本直接跑时（而不是被 day23-shots.mjs import）才执行
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const arg = (name, fallback) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : fallback;
  };
  const from = Number(arg('from', 4));
  const to = Number(arg('to', 7));
  await runDayShots({
    from,
    to,
    dir: arg('out', `tests/browser/shots/day${from}${to}`),
    title: arg('title', `D${from}–D${to} 剧情图验收`),
  });
}
