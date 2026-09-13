# 如果有你（If Only You Were There）

治愈系守护模拟 / 轻叙事 Web 游戏。玩家扮演「现在的你」，守护一个正在被学业压垮的高中生。

- 技术栈：**TypeScript + DOM/CSS/SVG + Web Audio API**（无游戏引擎）
- 构建：Vite + vite-plugin-singlefile（单 HTML 交付）
- 分工：A 游戏框架（本仓库引擎）、B 玩法策划、C 美术/文本/音频

## 快速开始

```bash
npm install
npm run dev          # 本地开发（http://127.0.0.1:5180）
npm run build        # 产出单文件 dist/index.html（会先校验 art/ 里的美术资源）
npm run test         # 单元 + 冒烟测试（jsdom）
npm run preview      # 托管 dist/，稳定试玩 http://127.0.0.1:4180
npm run test:browser # 真浏览器验收（Playwright + 本机 Chrome，需先 npm run preview）

npm run art:list     # 打印每个 AssetId 要交的文件名与尺寸
npm run art:check    # 校验 art/ 里的正式图（名字 / 尺寸 / 体积）
npm run art:drill    # 生成一套假图做"替换演练"，用完自动删除
npm run shots:day1   # D1 逐帧画廊（截图 + index.html，给人看）
npm run shots:day23  # D2–D3 剧情图逐帧画廊（同上）
npm run shots:day47  # D4–D7 剧情图逐帧画廊（同一份脚本，换区间）
node tests/browser/day-shots.mjs --from 2 --to 7        # 也可以自己指定区间
node tests/browser/smoke.mjs            # 等价于 npm run test:browser
node tests/browser/walk-shots.mjs       # 专测「人物自动移动转场 + 情绪信号图」（同样需要 preview）
node tests/browser/fullpage-shots.mjs   # 专测「首页 / 尾页是全屏页」（铺满视口 / 盖住 HUD / 底图是不是正式图）
```

按天交来的剧情图（D2 起）用导入脚本转码后落进 `art/`（需要 Pillow，本机 anaconda 自带）：

```bash
python scripts/import-story-art.py --dry-run   # 先看体积与缩放偏差，不写文件
python scripts/import-story-art.py             # 写入 art/（去重 + 重采样 + WebP q80）
python scripts/import-story-art.py --only d7   # 只导某一天

python scripts/import-stage-art.py --dry-run   # 演出/移动/D1 立绘那一批（抠图、信号图、行走帧、校园地图）
python scripts/import-stage-art.py             # 写入 art/（去背 + 按姿态对位 + WebP）
python scripts/clean-portrait-alpha.py --dry-run  # 清主角立绘那层半透明灰雾（见《待确认问题》§6.9⑥）

python scripts/import-title-art.py --dry-run   # 标题页交接包的两张天空图（重采样到 1280×720 + 压体积）
python scripts/import-title-art.py             # 写入 art/（title.bg.dim / title.bg.gentle）
```

`npm run test:browser` 会把截图写到 `tests/browser/shots/`。**截图需要人看** ——
自动化断言只能覆盖尺寸、层级、点击命中、计算样式和数值这些可量化的部分，观感必须人工确认。

## 目录

```text
content/   B/C 的内容层（时刻表/流程/结局/定制/地图/资源/规则/剧情图登记表）
art/       美工交付正式图的投放目录（按 AssetId 命名；环境类没交会回退占位色块，人物类缺图则什么都不画）
scripts/   美术校验、导入与演练工具（含 D2 起的 WebP 导入脚本）
src/       A 的引擎层（不写具体剧情）
tests/     单元测试（runtime/content/配平/规则/一致性）+ 冒烟测试（engine/七日/存档/剧情图/翻页）+ 真浏览器验收
```

## 美工交付源包不在本仓库里

美工按天交来的原件（`如果有你_DAY<N>人物素材_可发送_v*`、`如果有你-场景-Day1/`、
`map-campus-overview(1)/`、`title-screen-handoff/`）**不随本仓库发布**：构建只读 `art/`
（见 `scripts/art-lib.mjs` 的 `ART_DIR`），这批源包不是构建输入 —— 它们交来的图都由
`scripts/import-*.py` 转码后落进 `art/`（标题页那两张也是，见下文「首页与尾页是全屏页」）。
实测把整批剔掉之后：

- `npm run build` 产出仍是 **7,041.90 kB**（与带它们时一字不差）
- `npm test` **220/220** 全过
- `npm ci` 按 `package-lock.json` 全新安装后，以上两条同样成立

也就是说这个仓库**自带游戏所需的全部素材**，`npm ci && npm run build && npm run preview`
即可完整试玩。下文提到那些目录的地方（信号图来源、走路交接包），是从**本地工作区**视角写的。

## 三方协作

- **B** 改 `content/moments.ts`（44 个时刻定义）、`flow.ts`、`conditions.ts`、`rules.ts`、`endings.ts`、`customization.ts`、`map.ts`
- **美工 A** 把地点背景与叠加层放进 `art/`（`map.*` / `overlay.*`，含卧室清晨·夜灯·熄灯三张时相底图 + 教室晨光/夜光）
- **美工 B** 把男女主角立绘（含放松态）与结局场景图放进 `art/`（`portrait.player.boy*` / `portrait.player.girl*` / `ending.card`）
- **A** 维护 `src/` 引擎与 `src/types/content.ts` 内容契约

美术交付的完整说明见 `美术交付清单.md`；尺寸规格的唯一真相来源是 `content/art.spec.json`。
**不要改 AssetId、剧情节点 id、`onceKey`、触发顺序、状态字段和引擎接口。**
整屏舞台图基准 1280 × 720（16:9）；地图坐标基准**直接取自规格表**，不另写一份。
交图或改数值后重新执行 `npm run build` 与 `npm run test`。

## 界面：所有文字都在下部，人物图按"1 个居中 / 2 个分居左右"

界面只有一条**底部演出带**（`.stage-bottom`），从上到下依次是：

```text
立绘行 .cast-layer   一个人物居中；两个人物分居左右（说话者亮、另一方暗）
文字带 .bar          底部对白框 .dialogue-box（全作唯一的文字容器）
选项带 .dock         干预按钮 / 分支选项
```

- **只有一个文字容器**：底部对白框。从前有两条语言通道（L1 走对白框，L0/L2/L3 走
  "云朵"气泡），2026-09 按验收反馈**把云朵整个删掉了** —— 所有文字都进对白框，
  脚本给每句标的「云朵（灰/白/金）」颜色保留为**语气色**（只染框左边那条竖线）。
  这次改动由 `tests/unit/css.test.ts`（样式表里不许再有 `.cloud` 规则）、
  `tests/smoke/storyCast.test.ts`（DOM 里不许再有第二个文字容器）两处守门。
- **对白框是流内元素**，位置只由这条带子决定 —— 从前云朵钉在舞台中上部（`top:14%`），
  插画在场时会正好糊在人物脸上；现在文字全部坐在底部。
- **整条带子都是"继续 / 跳过打字"的点击区**（含立绘），不用瞄准文字。
  点到**立绘**身上还会额外摸一下头（策划案 §3.4 的彩蛋：心情 +2、飘一句，
  每一幕限一次）—— 人和"继续"是同一个点击区，所以一次点击两件事都做，
  绝不留下"点了没反应"的死点击。
- 开局问卷只剩一题（`那时候的TA，是——`），内容也贴底排，与正片同一条视觉基线。
  答完 `state.custom` 里只有 `gender` 一项；作息（`wakeValue`/`lightsOutValue`）是
  `content/customization.ts` 里的固定默认值 —— **删问题不等于能删数据**，
  `sleepMinutes` 仍要派生出那 6 个「睡眠不足」时刻的门控。
- 还有两个地方叫「云朵」，**它们不是文字容器、没有跟着删**：结局页的**七日云朵**
  （脚本第 327 行点名要有的元素）和结局页/标题页的**「云朵图鉴」**入口（图鉴的名字）。
  要改这两个名字请先问编剧 —— 那是文案与产品命名，不是表现层。

## 首页与尾页是**全屏页**（标题页交接包）

首页（标题页）与尾页（结局页）**不住在舞台里**，而是铺满整个视口的 `position:fixed` 层
（`.title-screen` / `.ending`，层级 5 / 20，都高于底部演出带）。设计取自
`title-screen-handoff/`：一整页天空 + 居中的中英标题（`If you` / 如果有你）+ 文字按钮。

- **两档皮肤，跟着心情换**：`data-mood="dim"`（雨云压着的天，奶油色字）与
  `data-mood="gentle"`（晒得暖的天，**墨色字** —— 亮天空上写奶油字等于没写）。
  首页看**玩过没有**（没有存档 `dim`，有存档 `gentle`）；尾页看**结局**（`EndingConfig.sky`，
  守护住了是 `gentle`，「雨过」停在 `dim`）。
- **底图是正式交付图，不是 CSS 渐变**：`title.bg.dim` / `title.bg.gentle` 两张
  （交接包原图 1672×940 重采样到 1280×720，PNG 2.6 MB → WebP 111 KB / 60 KB；
  导入脚本 `scripts/import-title-art.py`）。两页加起来的产物增量约 239 KB。
- **全屏层必须自己收场**：它挂在常驻的 `.game` 上（不再挂在会被下一次渲染替换掉的
  `.content` 里），所以 `UiSystem.title()` 在点完按钮那一刻会自己 `remove()` ——
  漏了这句，玩家会顶着一整页天空玩到底。`tests/unit/fullPage.test.ts` 守着这条。
- 真机验收是 `tests/browser/fullpage-shots.mjs`：量"是不是真铺满视口""有没有盖住 HUD""
  背景到底是正式图还是兜底渐变""点完那一层有没有消失"，并出图到
  `tests/browser/shots/fullpage/`。**图鉴页没有跟着做全屏**（它仍在舞台里）。

## 男女主角素材绝不混用

- 选男生就只出现男生的图，选女生就只出现女生的图：性别 → 素材后缀的翻译**只有一处**
  （`src/core/gender.ts`），`portrait.*` / `art.d1.*` / `art.story.*` 都走它，缺失时在**同性别内**回退，
  绝不跨性别兜底。
- 性别未定（读档损坏等）时不猜、不显示插画，宁可不画也不冒混用的风险。
- `portrait.player` / `portrait.npc` 两张通用位已**不再使用**（一张不分性别、一张至今没交图，
  过去它俩是右下角那块"NPC｜占位立绘"的来源）。老师只在 D2/D3 各出场一次，
  用 `portrait.teacher[.strict]`。
- **场景里不画人**：从前 `src/components/student.ts` 现画一个通用 SVG 小人当兜底，
  它不分性别、跟正式立绘毫无关系，而且**越缺图越会出现**（真图在场时它才让位）。
  现在整组删除（连 `.student-layer` / 样式表里的残骸一起）——
  场上的人只可能是**正式立绘行**或**剧情插画**，两个都没有时画面就是一间干净的空教室。
- **人物类资源缺图时不画占位物**（`content/assets.ts` 里 `character: true` 的那些，`src` 是空串）：
  占位物是给开发看的诊断物，立在画面正中当主角比"这一刻没有人物图"糟得多。
  环境类（地点背景 / 叠加层 / 结局背景）保留带中文名的占位色块，缺底图一眼看得出来。
  缺哪张人物图由 `npm run art:check` 与 `tests/unit/storyArt.test.ts` 的槽位解析对账保证。

## 剧情图（D2 起）

D2 之后的画面走 `art.story.<boy|girl>.<name>`，登记表是 `content/storyArt.ts`：

- 剧情里只写语义名字（`S('report')` / 不分性别的用 `C('crowd')`），由引擎按开局性别解析 ——
  名字写错是**编译期**错误，不是运行时白屏。
  **两个入口各守一边**：`S()` 只接受按性别的图、`C()` 只接受不分性别的图，用错**加载期就抛错**。
  这条不是洁癖：`S('crowd')` 曾经被用在一个月里没人发现 —— 它拼出的是
  `art.story.boy.crowd`（不存在的 id），于是 D2 08:00「成绩单来了」的整个干预窗口
  静默地没有人物图，而所有测试都是绿的（"少一张图"和"这一刻本来就没图"长得一样）。
  现在除了加载期抛错，还有一条逐槽位、逐性别的解析对账
  （`tests/unit/storyArt.test.ts`：每个挂上去的槽位都必须解析到**已交付**的图）。
- 这张表同时是"交了没有"的清单：`delivered: false` 明说这一版没有，
  缺图时那一刻**不插画**（由底部立绘行顶上），而不是糊一张别的图上去
  （那会变成"台词说成绩单、画面在食堂"）。
- 剧情图有两种形态，渲染方式不同：**带背景的整幅插画**按全舞台"剧情卡"演出
  （卡片描边 + 模糊底）；**真透明抠图**直接站在场景上（不画卡片、不铺模糊底）。
  靠 `art.spec.json` 的 `alpha` 字段区分 —— 不靠扩展名，因为交付里既有"RGBA 但其实全不透明"的
  PNG（D1 那九张），也有真抠图。
- 每个时刻的编排字段：`cg`（入场）/ `during`（干预窗口）/ `success` / `miss`，
  未设的阶段沿用当前画面（不设 = 不换图，而不是变空白）。
  **挂完图之后引擎会再收一次立绘行**（`showArt` + `showCast` 成对）：插画在 → 立绘让位；
  插画不在（没编排、或编排了但图没解析出来）→ 立绘顶上。少了这一步，
  画面会从"场景底图 + 立绘"直接掉成"一张空场景"，看上去就是"这一刻没有人物图"。
- 还有两个**换整屏场景**的槽位 `successScene` / `missScene`：D6 15:00「考后冒雨」的交付是
  两张整屏天气图（冒雨 / 雨后放晴），说明书写明"根据干预结果切换"。插画槽位换不了天气，
  所以单列 —— 场景 id 写错会当场抛错，不会安静地"画面没换"。

D4–D7 的 22 个时刻也已全部接上（`npm run art:check` 现在报 109/114 张已交付）。
**其中全部图加起来让 `dist/index.html` 到 6.8 MB** —— 单文件产物把所有图内联成
base64（×1.33），这是当前最该盯的一个数字；再往下接图要先决定"继续内联 / 降质量 / 拆文件"。

## 情绪信号：是图，不是 emoji

画面上那个表示"这一刻发生了什么"的小标记（乌云 / 困倦 / 手机震动 / 红叉……）
从前画的是**六个 emoji 字符**（🌧 ◌ ✗ 💤 📱 🌫，靠一行 `font-size: 52px` 撑大小）——
是全作最后一批**占位图案**。美工其实早就把整套水彩信号图交在
`如果有你-场景-Day1/如果有你/03_signals/` 里，只是从来没有 AssetId 把它们接进来。

现在它们是真的图（`signal.*` / `vfx.*`，共 12 张），取图这一层归**内容层**管：

- `content/assets.ts` 的 `SIGNAL_ART` 写"哪个 kind 用哪张图"，`content/moments.ts`
  在造时刻时填进 `Signal.asset`；**引擎只认 `asset`，不认识 `kind`**
  （`src/systems/cloudSystem.ts` 里连 `'darkCloud'` 这个字符串都不出现，有源码级断言守着）。
- `Signal.asset` 缺省 = **这一刻不画信号图**，而不是退回一个字符 —— 缺图时画 emoji，
  正是这几张图被耽误了一整轮的原因。
- 尺寸 = `--signal-base`（云 / 圆形图标两档）× `--signal-scale`（intensity 三档）
  × `--signal-fit`（插画在场时缩一档），三个变量**相乘**。别把两个规则写成同一个变量。

## 人物自动移动转场（换地点时走过去）

换地点不再是一块"地点名淡入淡出"的加载画面：校园俯瞰图铺在舞台上，
小人沿路线走过去，走到教学楼/宿舍/操场，再进那一幕。
数据来自 `map_routes_ts_交接包_v1.0`，分成两层：

- **走哪条路**是内容层的世界数据（`content/campus.ts`）：四个点位、十条路线、
  交接包的十字路网寻路（沿路走直角，不穿草坪）。游戏的三个 `locationId` 在地图上是四个点 ——
  宿舍按开局性别分成男女两栋，靠 `CampusLocation.serves` / `servesWho` **写成数据**
  （引擎不认识"宿舍"，也不需要认识）。
- **怎么画成动画**是引擎层（`src/systems/walkSystem.ts`）：按走过的**路程**推进
  （不是按段号，否则拐弯处会抽搐），方向每帧由当前所在段重算，两帧走路图按
  `frameIntervalMs` 切换，走完就 `cancelAnimationFrame` 收工（不是常驻 60fps 循环）。

节奏上有两条出路，因为宿舍→教学楼按交接包的速度要 3.6 秒，四十三次换地点干等是不能接受的：

- **加速 ×1 → ×3**：按一下把剩下的路快进（再按一下切回来）；
- **回车 / 空格**：直接到终点（和翻页同一个键，不引入新的肌肉记忆）。
  整块转场也是"跳过"的点击区（和别处"点哪儿都能继续"一致）。

跳过 ≠ 没走过去：到达后该进的场景、该更新的 `state.locationId` 全都照旧。

三个**真机才量得出来**的坑（jsdom 不计算布局，全部由 `tests/browser/walk-shots.mjs` 抓到）：

1. `width:100%; height:100%` 会让 `aspect-ratio` **失效**（两轴都成了确定值）——
   地图被纵向拉伸 9%。所以像素尺寸在 JS 里算 `contain` 后再写进元素。
2. 地图是 **7:4**（1344×768），而舞台可用区约 1.45。用 `cover` 会横向裁掉 17% 的构图
   （宿舍和操场都在边上），所以走 `contain` + 上下留边 —— `tests/unit/art.test.ts`
   里有一条断言专门守着"校园地图不服从 16:9 舞台基准"这条例外。
3. 鼠标点过「加速」之后按回车，浏览器会把回车派给那个**还带着焦点**的按钮
   （= 再切一次加速），而不是跳过 —— 玩家会觉得"回车不管用"。点完 `blur()` 就好，
   和 `UiSystem.handBackFocus` 是同一条规矩。

## 唯一资源是「守护之光」，没有金钱系统

本作**没有**金钱、货币、购买、付费或内购设定，也不应加入。玩家唯一的资源是**守护之光**：
每天醒来给 2 点（D6 给 3 点，D7 不给、也不能干预），每次干预消耗 1 点，不可购买、不可累积。

## 对白操作（开发文档 §5.1）

HUD 右侧有两个按钮，偏好存在 `localStorage` 的 `jks2.dialoguePrefs`，刷新后仍然生效：

| 操作 | 键 / 按钮 |
|---|---|
| 推进一句 | 点击底部演出带的任意位置（台词 / 立绘 / 选项带）、空格、回车 |
| 跳过当前句的逐字动画 | **打字过程中按一下空格 / 回车**，或点一下底部演出带 |
| 干预窗口里"不伸手" | 选项带里的「这次，就让它过去」（不消耗守护之光，点了立刻继续）/ 空格 / 回车 |
| 地点门「前往 X」 | 点按钮 / **回车 / 空格**（按钮上写明了这两个键） |
| 自动播放 | HUD「▶ 自动」——打完字停留一会自己翻页 |
| 逐字速度 | HUD「速度 慢/中/快」——三档循环 |
| 已读快进 | 自动生效：上一周目读过的句子直接整句显示，不再逐字重打 |

键盘的几条边界（翻页在 `Engine.onAdvanceKey` 一处、地点门在 `UiSystem.keyActivate` 一处，
由 `tests/smoke/advance.test.ts` 与两个真机脚本守着）：

- 点击与键盘走**同一个出口**（`Engine.pressAdvance()`）。从前键盘自己在 `waitTap` 里挂一份、
  点击挂在元素上，于是"打字时点击能跳过、空格不能"这种不一致必然出现。
- 焦点在输入框里时，空格就是打字（结局页的留言瓶），不翻页。
- 焦点在干预按钮上时，空格 / 回车 = 按下这颗按钮（浏览器默认行为）—— 抢过来的话，
  键盘用户就没法用 Tab + 回车做选择了。地点门沿用同一条规矩（真机上由
  `tests/browser/walk-shots.mjs` 用**真按键**守：jsdom 里未受信任的事件不触发默认行为，
  这条路径只有真浏览器测得了）。
- 按住不放（`e.repeat`）不算连翻，免得"按住空格读快点"一路冲过干预窗口。
- 干预窗口刚打开的 **0.7 秒**里键盘不算数（刚按完最后一句的手还在空格上），
  但**点击永远立刻生效**：点是明确的动作，键盘不是。
- 地点门**不要**冷静期：它不花守护之光、不跳过任何内容，一路按着回车读下去的玩家
  顺手把门和走路转场一起按掉，正是他想要的。

「已读台词」记在存档的 `state.logs.seenLines` 里（键是 `来源#行号`，不依赖台词有没有 id），
并且和「图鉴收藏」「通关次数」一样**跨周目保留**（统一在 `Engine.startFresh()` 里维护）。

## 音效

`src/systems/audioSystem.ts` 用 Web Audio 实时合成，**没有音频文件**，所以零版权风险、单文件交付不膨胀。
开发文档 §8.7 点名要求 12 种音效，与代码里的 `REQUIRED_SOUNDS` 一一对应，单测会核对覆盖：

```text
脚步 / 地点环境 / 逐字提示(ding) / 干预成功(success) / 干预错过(miss)
雨声(循环) / 手机震动(phone) / 拉链(zip) / 糖果(candy) / 时钟(clock) / 拨云(clearSky) / 终章和弦(chord)
```

两条约定，改动时请遵守：

1. **未知 id 绝不静默降级**。`play(id)` 遇到没实现的 id 只 warn 并返回 `false`，
   不会用别的音顶替 —— 否则 C 把 id 写错时听起来只是"有点怪"，不报错、极难发现。
2. 内容层只写动画名时，音效由 `src/systems/effectRunner.ts` 的 `ANIM_SOUND` 按动画名配
   （`zipMouth→zip`、`candyDrop→candy`、`clockRewind→clock`、`clearSky→clearSky`、`phoneBuzz→phone`）。
   `handCoverEars` / `warmGlow` / `cloudDissolve` / `shake` / `zoomIn` 是**刻意不出声**的，
   也登记在表里（值为空串）；给动画改名时要同步这张表，否则会被 warn 抓到。

## 待编剧/策划确认的问题

`待确认问题-给编剧策划.md` —— 脚本里前后矛盾或没写清的地方，以及开发暂时选用的处理方式，
按条列出、可直接发出去逐条勾选。

详见 `content/TEMPLATE.md` 与 `游戏开发文档.md`。

## 调试接口（仅开发环境）

浏览器控制台可用 `window.gameDebug`：

```js
gameDebug.getState()        // 看当前状态
gameDebug.goto('node-id')   // 跳节点
gameDebug.setMood(70)       // 改心情
gameDebug.setLight(3)       // 改守护之光
gameDebug.addBond(2)        // 加羁绊
gameDebug.reset()           // 重开
gameDebug.dumpConfig()      // 看内容配置
```
