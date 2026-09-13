// D1 全流程逐帧验收图生成器（Playwright + 本机 Chrome/Edge）。
//
// 和 smoke.mjs 的分工：smoke.mjs 是"自动化断言"（量数值、判真假，最后只留一句通过/失败）；
// 这个脚本是"给人看的" —— 它把 D1 每一个时刻的画面按顺序拍下来，配一句"这一屏该看什么"，
// 生成一个画廊页，好让人用眼睛过一遍。数值对得上不等于画面成立：插画层把时相底图整个盖住
// 这件事，所有断言都是绿的，只有截图能看出来。
//
// 用法：npm run shots:day1        （需先 npm run preview，或设 JKS2_URL 指向别处）
//       npm run shots:day1 -- --phase=B   只跑某一段
// 产出：tests/browser/shots/day1/*.png + index.html（画廊）
import { chromium } from 'playwright';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

const BASE = process.env.JKS2_URL ?? 'http://127.0.0.1:4180/';
const OUT = 'tests/browser/shots/day1';
// 先把上一趟的图整个清掉。文件名里带序号，两次运行的序号对不上，不清就会新旧混在一起 ——
// 画廊只列本趟拍的（所以看着是对的），但目录本身会攒下一堆看不出年份的旧图，
// 人工验收时点开一个文件名就可能看到上一版画面（实测攒到过 50+ 张、横跨三趟）。
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// ── 三个阶段 ────────────────────────────────────────────────────────────────
// 拆成三段而不是一段跑完，是因为 D1 有两个**互斥**的分支画面，一个存档里只能看到一边：
//   被当众批评时干预成功 → 放松坐姿；不干预 / 来不及 → 低头。要看全就得跑两遍。
// 再用女生跑一遍，是因为女主角素材比男生少一张（没有 down），
// 那条回退链只在"女生 + miss"这个组合下才走得到。
const PHASES = [
  { id: 'A', name: '男生 · 全程成功干预（D1 九个时刻逐个走完）', gender: '男生', stopAt: 'D1_END', interfere: true },
  { id: 'B', name: '男生 · 被当众批评时故意不干预（看超时低头分支）', gender: '男生', stopAt: 'MISS', interfere: false },
  { id: 'C', name: '女生 · 女主角素材，以及她缺 down 图时回退到紧绷', gender: '女生', stopAt: 'MISS', interfere: false },
];

// D1 的九个时刻，按剧情顺序。用来验"全流程验收到底有没有洞"。
const D1_ALL = ['D1_0620', 'D1_0740', 'D1_0810', 'D1_1020', 'D1_1230', 'D1_1530', 'D1_2140', 'D1_2230', 'D1_2320'];

const gallery = [];
const shotKeys = new Set();
const skipLog = [];
let seq = 0;
let currentPhase = PHASES[0];

// 优先用本机已安装的 Chrome/Edge，避免依赖下载浏览器（与 smoke.mjs 同一策略）
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

/** 把页面上"这一屏在演什么"整份取回来 —— 拍照归类、写验收提示、判推进方式都靠它 */
async function describe(page) {
  return page.evaluate(() => {
    const pick = (el) => {
      if (!el) return null;
      const img = el.querySelector('img');
      const src = img?.currentSrc || img?.src || '';
      return {
        asset: el.getAttribute('data-asset') || '',
        // 人物类资源缺图时**不再画占位物**（src 为空串），所以"没图"要认这个形态，
        // 而不是只认"占位 SVG"——否则缺图会被当成"一切正常"。
        placeholder: src.startsWith('data:image/svg'),
        missing: src === '',
        decoded: !!img && img.naturalWidth > 0,
      };
    };
    const cg = document.querySelector('.moment-cg:not([hidden])');
    const cards = cg ? [...cg.querySelectorAll('.cg-card')] : [];
    const sceneBg = document.querySelector('.scene-background');
    const bgImg = sceneBg ? getComputedStyle(sceneBg).backgroundImage || '' : '';
    const sharp = (c) => c.querySelector('.cg-sharp')?.currentSrc || c.querySelector('.cg-sharp')?.src || '';
    return {
      moment: document.querySelector('.scene')?.dataset.moment ?? '',
      scene: document.querySelector('.scene')?.dataset.scene ?? '',
      location: document.querySelector('.location-title')?.textContent?.trim() ?? '',
      // HUD 上只有"第 N 天"，**没有时刻**（时刻只在地点入口卡上出现一次），所以这里取天数。
      day: document.querySelector('.day-chip')?.textContent?.trim()
        ?? document.querySelector('.stats')?.textContent?.match(/第\s*\d+\s*天/)?.[0] ?? '',
      cg: cards.map((c) => ({
        asset: c.getAttribute('data-asset') || '',
        placeholder: sharp(c).startsWith('data:image/svg'),
        missing: sharp(c) === '',
        decoded: (() => { const i = c.querySelector('.cg-sharp'); return !!i && i.naturalWidth > 0; })(),
        size: (() => { const i = c.querySelector('.cg-sharp'); return i ? `${i.naturalWidth}×${i.naturalHeight}` : ''; })(),
      })),
      // 台词：全作唯一的文字容器就是底部对白框（云朵已删除）。读 .box-text，
      // 不读整个框 —— 框里还有 .box-speaker（"TA" / "对方"），会混进台词里。
      line: document.querySelector('.dialogue-box:not([hidden]) .box-text')?.textContent?.trim() ?? '',
      dock: [...document.querySelectorAll('.dock .choice')].map((b) => ({
        label: b.textContent?.trim() ?? '', disabled: b.hasAttribute('disabled'),
      })),
      sceneBgKind: bgImg.startsWith('data:image/jpeg') ? 'jpeg'
        : bgImg.startsWith('data:image/png') ? 'png'
          : bgImg.startsWith('data:image/svg') ? '占位SVG' : '无',
      overlays: document.querySelectorAll('.scene-overlay').length,
      // 占位人物图形已整个删除：DOM 里**不该**再出现 .student / .student-layer。
      // 保留这一项是为了在画廊里留下"确实没有"的证据，而不是删掉断言。
      studentNodes: document.querySelectorAll('.student, .student-layer, .student-svg').length,
      // 立绘行（底部演出带的上半段）。D1 的每一刻都有插画，插画在场时立绘行让位，
      // 所以这里左右两个槽位通常是空的 —— 但它们仍在采集范围内：将来某一刻改成只立立绘时会拍到。
      portraits: { left: pick(document.querySelector('.cast-layer .portrait-left')), right: pick(document.querySelector('.cast-layer .portrait-right')) },
    };
  });
}

/**
 * 一屏的签名：有插画就用**插画组合**，没插画就用"当前在演哪种 UI"。
 *
 * 这里必须用签名而不是时刻 id 当 key。用时刻 id 的话，D1_0810 只会被拍下第一张
 * （入场坐姿），而它真正的重头戏 —— 干预窗口那两张并排（主角紧绷 + 老师严肃）——
 * 永远拍不到。一个时刻可以是好几段画面，签名才认得出来。
 */
function signature(d) {
  if (d.cg.length) return `${d.moment}|cg:${d.cg.map((c) => c.asset).join('+')}`;
  if (d.dock.length) return `${d.moment}|dock`;
  if (d.line) return `${d.moment}|line`;
  return '';
}

const POSE_ZH = {
  calm: '平静', tired: '疲惫', tense: '紧绷', relax: '放松', down: '低头',
  sit: '坐姿', sitRelax: '放松坐姿', strain: '紧绷动作',
};

/** 这一屏叫什么（画廊标题用）。从 AssetId 末段反推姿态，不维护第二张时刻表。 */
function labelOf(d, forceLabel = '') {
  if (forceLabel) return forceLabel;
  if (d.cg.length === 2) return '插画并排·主角+老师';
  if (d.cg.length === 1) {
    const pose = d.cg[0].asset.split('.').pop() ?? '';
    return `插画·${POSE_ZH[pose] ?? pose}`;
  }
  if (d.dock.length) return '干预窗口';
  if (d.line) return '底部对白框';
  return '空画面';
}

/** 这一屏"该看什么"。给人看的验收提示，按画面内容写，不按时刻写。 */
function lookFor(d) {
  const assets = d.cg.map((c) => c.asset).join(' ');
  const bg = `底图应是${d.location || '当前地点'}的正式图`;
  const phase = d.scene.includes('Morning') && d.scene.includes('classroom') ? '（教室·清晨光）'
    : d.scene.includes('Night') ? '（教室·夜间光，应明显更暗）'
      : d.scene === 'bedroomMorning' ? '（卧室·清晨，冷调窗光）'
        : d.scene === 'bedroomLightsOut' ? '（卧室·熄灯，全游戏最暗的一张）' : '';

  if (assets.includes('strain') && assets.includes('teacher')) {
    return '**D1 最关键的一屏**：左=主角紧绷动作、右=老师严肃批评，两张并排；'
      + '下方两个干预按钮（捂耳朵 / 关嘴巴）要在画面外，不压人物。';
  }
  if (assets.includes('.down')) return '主角低头。男生有正式的低头图；女生没有，应回退到她的紧绷图，**绝不能是占位 SVG**。';
  if (assets.includes('sitRelax')) return '干预成功后的放松坐姿（完整课桌）。';
  if (assets.includes('.sit')) return '入场坐姿（完整课桌）。';
  if (assets.includes('tired')) return `疲惫态。${bg}${phase}，场景本身要透过插画周围看得见（不该被整片模糊盖死）。`;
  if (assets.includes('calm')) return `平静态。${bg}${phase}。`;
  if (d.dock.length) {
    return `L2 干预窗口：按钮写「${d.dock.map((b) => b.label).join(' / ')}」，`
      + '每个都要注明"消耗守护之光 ✦1"；倒计时条要在。';
  }
  return `底部对白框：立绘在场时当前说话者应放大变亮。${bg}${phase}。`;
}

const settle = (page, ms) => page.waitForTimeout(ms);

async function shoot(page, d, forceLabel = '') {
  seq += 1;
  const label = labelOf(d, forceLabel);
  const file = `${String(seq).padStart(2, '0')}-${d.moment || 'scene'}-${label}.png`;
  await page.screenshot({ path: `${OUT}/${file}` });
  gallery.push({
    file, phase: currentPhase.name, index: seq, label,
    moment: d.moment, scene: d.scene, day: d.day,
    look: lookFor(d),
    note: d.cg.length
      ? `插画：${d.cg.map((c) => `${c.asset}${c.missing ? '（缺图·不画占位物）' : c.placeholder ? '（占位！）' : ''}${c.size ? ` ${c.size}` : ''}`).join(' + ')}`
      : d.dock.length
        ? `干预按钮：${d.dock.map((b) => b.label + (b.disabled ? '(置灰)' : '')).join(' / ')}`
        : d.line ? `对白框：「${d.line}」` : '',
    bg: `${d.sceneBgKind}${d.overlays ? ` + ${d.overlays} 层光` : ''}`,
    studentNodes: d.studentNodes,
  });
  console.log(`  ${String(seq).padStart(2, '0')}  ${(d.moment || '-').padEnd(8)} ${(d.day || '-').padEnd(6)} ${label}`);
  return true;
}

/**
 * 等逐字打字结束：连续两次取样文本长度不再变化就算打完了。
 *
 * 这个等待不是"为了好看" —— 底部对白框里的台词是一个字一个字打出来的，
 * 而签名里带着文本，打字期间签名每一帧都在变。早先没有这一步，于是
 * "settle 之后重算签名、发现变了就重试"的保护会一直重试到放弃，
 * D1_0620 因此在两段里被整个漏拍（画廊里从地点入口直接跳到了 D1_0740）。
 */
async function waitTypingDone(page, timeoutMs = 2600) {
  const deadline = Date.now() + timeoutMs;
  let prev = '';
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => (
      document.querySelector('.dialogue-box:not([hidden]) .box-text')?.textContent
      ?? document.querySelector('.dialogue-box:not([hidden]) .dialogue-text')?.textContent
      ?? document.querySelector('.dialogue-box:not([hidden])')?.textContent
      ?? ''
    ).trim());
    if (t && t === prev) return t;
    prev = t;
    await page.waitForTimeout(130);
  }
  return prev;
}

/**
 * 签名变了就拍一张。返回是否真的按下了快门。
 *
 * 三步走：先等打字结束（否则签名永远不稳定）→ 取签名 → 再等一小会儿让插画上屏，
 * 用**最终**的签名判断拍不拍、并记进已拍集合。记的必须是最终签名：
 * 刚进一个时刻时插画和台词是分两拍上屏的，拿第一拍的签名去记账，下一轮又会重拍一遍。
 *
 * 每次放弃都往 skipLog 里记一句原因。拍摄是"这一屏只有一次机会"，漏一张在画廊上就是一个
 * 看不出所以然的洞 —— 而这个洞是**竞态**造成的，同一份代码跑三趟漏的时刻都不一样
 * （实测漏过 D1_0620、D1_0740、D1_2140）。不记原因就只能靠猜。
 */
async function captureIfChanged(page, d) {
  if (!d.moment.startsWith('D1_')) return false;
  await waitTypingDone(page);
  let now = await describe(page);
  if (now.moment !== d.moment) { skipLog.push(`${d.moment}：打字期间已翻到 ${now.moment || '(空)'}`); return false; }
  if (!signature(now)) { skipLog.push(`${d.moment}：这一屏没有任何 UI（对白框/按钮都没出现）`); return false; }

  // 插画的淡入是 0.45s，等它落定；这一等之后画面可能又变了，所以要重新取签名
  await settle(page, 460);
  now = await describe(page);
  if (now.moment !== d.moment) { skipLog.push(`${d.moment}：等待期间已翻到 ${now.moment || '(空)'}`); return false; }
  const sig = signature(now);
  if (!sig) { skipLog.push(`${d.moment}：等待后 UI 消失了`); return false; }
  if (shotKeys.has(sig)) return false;
  shotKeys.add(sig);
  return shoot(page, now);
}

/** 等这一刻的 UI 真的出现（底部对白框 / 干预按钮），最多 waitMs */
async function waitForUi(page, waitMs = 5000) {
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => !!(
      document.querySelector('.dock .choice')
      || document.querySelector('.dialogue-box:not([hidden])')
      || document.querySelector('.dialogue-box:not([hidden])')
    ));
    if (ready) return true;
    await page.waitForTimeout(80);
  }
  return false;
}

// ── 启动到 D1 开始 ──────────────────────────────────────────────────────────
async function answerOnce(page, gender) {
  const promptBefore = await page.locator('.custom-prompt').innerText().catch(() => null);
  if (await page.locator('.custom .choice').count()) {
    // 开局只剩性别一题，按阶段指定的来选（选项文案就是"男生"/"女生"）
    const wanted = page.locator('.custom .choice').filter({ hasText: gender });
    if (await wanted.count() === 1) await wanted.click();
    else await page.click('.custom .choice');
  }
  await page.waitForFunction(
    (prev) => {
      const p = document.querySelector('.custom-prompt');
      return !p || p.textContent !== prev;
    },
    promptBefore,
    { timeout: 5000 },
  ).catch(() => {});
}

async function openGame(page, gender) {
  // 每次都用干净存档：从标题页开始，七问定制 → 地点入口
  await page.goto(BASE, { waitUntil: 'load' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('.title-screen', { timeout: 15000 });
  await page.click('.title-screen [data-act="start"]');
  for (let i = 0; i < 40; i++) {
    if (await page.locator('.debug-target').count()) break;
    if (await page.locator('.custom').count()) { await answerOnce(page, gender); continue; }
    await page.waitForTimeout(60);
  }
  await page.waitForSelector('.debug-target', { timeout: 20000 });
}

async function runPhase(browser, phase) {
  currentPhase = phase;
  // 每个阶段是独立存档、时刻会重复，所以已拍记录必须清空 ——
  // 否则阶段 B 的 D1_0810 会因为"阶段 A 拍过"而被整个跳过。
  shotKeys.clear();
  skipLog.length = 0;
  console.log(`\n=== 阶段 ${phase.id}：${phase.name} ===`);

  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await openGame(page, phase.gender);
  // 地点调试入口：这是"每天开始时只给一个目标"的界面。它上面没有 .scene[data-moment]，
  // 所以标签要显式给 —— 不然会被 labelOf 归类成"底部对白框"，画廊里就名不副实了。
  await shoot(page, await describe(page), '地点调试入口');

  let lastMoment = '';

  for (let i = 0; i < 1500; i++) {
    if (await page.locator('.ending').count()) break;
    const d = await describe(page);

    // D1 走完（进入 D2 的那一刻）就收工
    if (phase.stopAt === 'D1_END' && d.moment.startsWith('D2_')) break;

    // miss 分支：插画切到低头（男生 down）/ 回退到紧绷（女生缺 down）就算拍到了
    if (phase.stopAt === 'MISS') {
      const gotMiss = [...shotKeys].some((k) => k.startsWith('D1_0810|cg:') && /\.(down|tense)$/.test(k));
      if (gotMiss) break;
    }

    if (d.moment !== lastMoment) {
      lastMoment = d.moment;
      if (d.moment.startsWith('D1_')) await waitForUi(page);
    }
    if (await captureIfChanged(page, d)) continue;

    // ── 推进 ──
    if (await page.locator('.dock .choice:not([disabled])').count()) {
      if (!phase.interfere) {
        // 故意不点：等它自己走到超时。超时后引擎会把插画切到 miss 槽位，
        // 那一刻签名变化，上面的 captureIfChanged 会替我们拍下来。
        await page.waitForTimeout(300);
        continue;
      }
      await page.click('.dock .choice:not([disabled])');
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('.dialogue-box:not([hidden])').count()) {
      await page.click('.dialogue-box:not([hidden])');
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('.dialogue-box:not([hidden])').count()) {
      await page.click('.dialogue-box:not([hidden])');
      await page.waitForTimeout(60);
      continue;
    }
    // 人物自动移动转场：截图这一批关心的是"每个时刻画成什么样"，不是走路本身
    // （走路单独由 tests/browser/walk-shots.mjs 验收）。
    // **点「跳过」按钮而不是按回车** —— 理由见 day-shots.mjs 里同一段的长注释：
    // 按回车有概率漏进下一幕、把那一幕唯一的一句台词翻过去，整幕就拍不到了。
    if (await page.locator('.walk').count()) {
      await page.locator('[data-walk-act="skip"]').click({ timeout: 2000 }).catch(() => {});
      await page.waitForFunction(() => {
        const s = document.querySelector('.scene');
        return !document.querySelector('.walk') && s && s.dataset.scene && s.dataset.scene !== 'campus-walk';
      }, null, { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(60);
      continue;
    }
    if (await page.locator('.debug-target').count()) {
      await page.click('.debug-target');
      await page.waitForFunction(() => !document.querySelector('.debug-target'), null, { timeout: 3000 });
      await page.waitForTimeout(60);
      continue;
    }
    await page.waitForTimeout(50);
  }

  if (phase.stopAt === 'MISS' && ![...shotKeys].some((k) => /\.(down|tense)$/.test(k))) {
    console.log('  ! 没走到 D1_0810 的 miss 分支（这一刻可能被 when 条件跳过了）');
  }
  // 九个时刻是不是都被拍到了 —— 漏一个就说明"全流程验收"有洞，必须当场说出来，
  // 不能让人对着 8 张图以为那就是 D1 的全部。
  if (phase.stopAt === 'D1_END') {
    const shotMoments = new Set([...shotKeys].map((k) => k.split('|')[0]));
    const missing = D1_ALL.filter((m) => !shotMoments.has(m));
    if (missing.length) {
      console.log(`  ! D1 有 ${missing.length} 个时刻没拍到：${missing.join('、')}`);
      // 把这些时刻相关的放弃原因打出来 —— 不然只知道"漏了"，不知道为什么漏
      const why = skipLog.filter((s) => missing.some((m) => s.startsWith(m)));
      for (const s of [...new Set(why)]) console.log(`      原因：${s}`);
    } else {
      console.log('  ✓ D1 九个时刻全部拍到');
    }
  }
  if (errors.length) console.log(`  ! 控制台报错 ${errors.length} 条：${errors.slice(0, 3).join(' | ')}`);
  // 跳过原因一律打出来（B/C 两段不验"九个时刻齐不齐"，所以不走上面那段报告）。
  // 这些是竞态留下的痕迹：同一份代码跑三趟，漏的时刻都不一样。
  for (const s of [...new Set(skipLog)]) console.log(`  · 跳过：${s}`);
  await context.close();
}

// ── 画廊页 ──────────────────────────────────────────────────────────────────
function writeGallery() {
  const byPhase = PHASES.map((p) => ({ ...p, shots: gallery.filter((g) => g.phase === p.name) }));
  const placeholders = gallery.filter((g) => g.note.includes('占位！'));
  // 占位小人（DOM 里现画的通用 SVG 人物）已经整个删除，这里留一条"确实没有"的对账
  const studentNodes = gallery.filter((g) => (g.studentNodes ?? 0) > 0);
  const shotMoments = new Set(gallery.map((g) => g.moment).filter(Boolean));
  const notShot = D1_ALL.filter((m) => !shotMoments.has(m));
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<title>D1 逐帧验收 · 如果有你</title>
<style>
  body{margin:0;padding:32px 40px;background:#12100f;color:#e8e2da;
       font:14px/1.7 "Segoe UI","Microsoft YaHei",sans-serif}
  h1{font-size:22px;margin:0 0 6px}
  .sub{color:#8c837a;margin-bottom:24px}
  h2{font-size:15px;font-weight:600;margin:34px 0 14px;padding-bottom:8px;
     border-bottom:1px solid #2c2825;color:#f0d9b5}
  .card{display:grid;grid-template-columns:600px 1fr;gap:22px;align-items:start;
        margin:0 0 24px;padding:16px;background:#1a1716;border:1px solid #262220;border-radius:12px}
  .card img{width:100%;border-radius:8px;display:block;border:1px solid #2e2926}
  .n{display:inline-block;min-width:26px;color:#f0d9b5;font-weight:600}
  .meta{color:#8c837a;font-size:12px;margin:2px 0 10px}
  .look{color:#d8d2c8}
  .note{color:#7f9c7f;font-size:12.5px;margin-top:8px}
  .warn{padding:10px 14px;background:#3a1f1f;border:1px solid #6b3535;border-radius:8px;margin-bottom:14px}
  .ok{padding:10px 14px;background:#1c2a1e;border:1px solid #35573a;border-radius:8px;margin-bottom:14px;color:#a8cfa8}
  code{background:#262220;padding:1px 5px;border-radius:4px;font-size:12px}
</style></head><body>
<h1>D1 逐帧验收</h1>
<div class="sub">共 ${gallery.length} 张 · 按剧情顺序 · 每张下面写了这一屏该看什么</div>
${notShot.length
    ? `<div class="warn">D1 有 ${notShot.length} 个时刻没被拍到：<code>${notShot.join(' ')}</code></div>`
    : `<div class="ok">D1 九个时刻全部拍到（${D1_ALL.join(' ')}）</div>`}
${placeholders.length
    ? `<div class="warn">有 ${placeholders.length} 张用到了占位图，说明对应素材缺失：${placeholders.map((p) => p.file).join('、')}</div>`
    : '<div class="ok">全部画面用的都是正式交付素材，没有占位图。</div>'}
${studentNodes.length
    ? `<div class="warn">有 ${studentNodes.length} 张画面上还残留占位小人（.student / .student-layer）：${studentNodes.map((s) => s.file).join('、')}</div>`
    : '<div class="ok">占位小人已彻底删除：没有一屏出现 .student / .student-layer，人物只由正式立绘或剧情插画承担。</div>'}
${byPhase.map((p) => `<h2>阶段 ${p.id} — ${p.name}（${p.shots.length} 张）</h2>
${p.shots.map((s) => `<div class="card">
  <img src="${encodeURI(s.file)}" alt="${s.moment}">
  <div>
    <div><span class="n">${String(s.index).padStart(2, '0')}</span> <b>${s.moment}</b> · ${s.label}</div>
    <div class="meta">时相场景 <code>${s.scene || '(无)'}</code> · ${s.day || '第 1 天'} · 底图 ${s.bg} · 占位小人节点 ${s.studentNodes ?? 0} 个</div>
    <div class="look">${s.look}</div>
    ${s.note ? `<div class="note">${s.note}</div>` : ''}
  </div>
</div>`).join('')}`).join('')}
</body></html>`;
  writeFileSync(`${OUT}/index.html`, html);
  console.log(`\n画廊：${OUT}/index.html（${gallery.length} 张）`);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
const only = process.argv.find((a) => a.startsWith('--phase='))?.split('=')[1];
const browser = await launchBrowser();
try {
  for (const phase of PHASES) {
    if (only && phase.id !== only) continue;
    await runPhase(browser, phase);
  }
} finally {
  await browser.close();
}
writeGallery();
