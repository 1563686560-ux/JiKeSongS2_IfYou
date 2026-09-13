# art/ —— 正式美术资源投放目录

把正式图**按 AssetId 命名**丢进这个目录，构建时会自动内联进单文件 HTML。

```text
art/
├─ map.bedroom.background.jpg     1280 × 720   （卧室基底：调试入口底图 / 无时相时的卧室）
├─ map.bedroom.morning.jpg        1280 × 720   （卧室·清晨：D1 06:20 黎明）
├─ map.bedroom.night.jpg          1280 × 720   （卧室·夜灯：睡前）
├─ map.bedroom.lightsOut.jpg      1280 × 720   （卧室·熄灯：睡眠不足）
├─ map.classroom.background.jpg   1280 × 720   （教室基底：叠加层之下的那一张）
├─ map.playground.background.jpg  1280 × 720   （操场）
├─ map.campus.base.webp           1344 × 768   （校园俯瞰图，7:4；人物自动移动转场用）
├─ overlay.classroom.morning.png  1280 × 720   （教室·清晨光，要透明通道）
├─ overlay.classroom.night.png    1280 × 720   （教室·夜间光，要透明通道）
├─ overlay.rain.png               1280 × 720   （雨幕，要透明通道）
├─ ending.card.jpg                1280 × 720
├─ portrait.player.boy.png        320 × 420    （开局选「男生」时用，真抠图 → alpha: true）
├─ portrait.player.girl.png       320 × 420    （开局选「女生」时用）
├─ portrait.player.boy.rest.png   320 × 420    （男生·干预成功后放松态）
├─ portrait.player.girl.rest.png  320 × 420    （女生·干预成功后放松态）
├─ portrait.teacher.png           320 × 420    （老师普通站立，男女共用）
├─ portrait.teacher.strict.png    320 × 420    （老师严肃批评）
├─ art.customize.boy.jpg          400 × 533    （开局角色选择·男生基础形象）
├─ art.customize.girl.jpg         400 × 533
├─ signal.*.webp                  480×320 / 256×256  （情绪信号，见下）
├─ vfx.*.webp                     320×480 / 480×400  （干预特效）
├─ move.<who>.<dir>.<1|2>.webp    128×128 / 96×128   （行走帧，见下）
└─ art.d1.<boy|girl>.<pose>.webp  480 × 640    （D1 立绘·真抠图，见下）
```

> **不用交的两张**：`portrait.player.png`（未定性别的通用位）与 `portrait.npc.png`
> （无台词的 NPC 通用位）已经**不再上屏** —— 前者不分性别、后者至今没交图，
> 过去它俩就是屏幕右下角那块"NPC｜占位立绘"的来源。
> 开局问卷现在只问性别，所以主角图只有 `boy` / `girl` 两套（各带一张 `.rest`）；
> 老师只在 D2 10:20「拖堂说教」与 D3「再次被批评」两刻出场，用 `portrait.teacher[.strict]`。
> D2 起按天交来的剧情图不在上面这张图里，见下一节。

## D2 起的剧情图（`art.story.*` 与按天交来的空镜）

D2 之后美工是**按天交包**的（`如果有你_DAY<N>人物素材_可发送_v*`），包里的文件名是中文，
落成 AssetId 由 `scripts/import-story-art.py` 的映射表负责：

```bash
python scripts/import-story-art.py --dry-run        # 先看体积与缩放偏差，不写文件
python scripts/import-story-art.py                  # 真正写入 art/
python scripts/import-story-art.py --only d4        # 只导某一天
```

它做四件事：**去重**（"精选复用"的图常常与前几天的文件字节完全相同）、
**按运行时真正要显示的大小重采样**（3:4 → 480×640、4:3 → 640×480、环境空镜 → 1280×720）、
**转 WebP q80**（912×1216 的生成图从 1.2 MB 压到 ~30 KB）、
**实测 alpha**（真透明抠图会打上 `exact` 保住透明像素边缘；随后要在 `art.spec.json` 标 `alpha: true`）。

为什么非转不可：本作是**单文件构建**，图会被 base64 内联进 HTML（×1.33）。
D2–D6 五天的原始交付是 79 个文件 / 42.9 MB，直接进包会产出约 57 MB 的 `index.html`；
转成 WebP 后同样画面约 2 MB（D2+D3 这 13 张实测 4.0 MB → 0.50 MB）。

**剧情图有两种形态，别混**：

| 形态 | 渲染 | 交付要求 |
|---|---|---|
| 带背景的整幅插画（JPG） | 全舞台"剧情卡"：卡片描边 + 模糊底 | 正常出图即可，不需要抠 |
| 真透明抠图（PNG/WebP） | 人物直接站在场景上，不画卡片 | 透明通道要**真的被用到**，并在交付时说明 |

> 判定依据是"交付时说明 + 导入时实测 alpha"，**不是扩展名** —— D1 那批 `transparent/` 的
> PNG 其实全是全不透明的整幅图。

**尺寸基准只有一处真相来源：`content/art.spec.json`。** 连地图的坐标基准（`content/map.ts`
的 `baseWidth` / `baseHeight`）都是从那里读的，所以不会出现"清单写一个尺寸、代码按另一个尺寸裁"。

## 整屏舞台图 = 1280 × 720（16:9）

地点背景、天气/光线叠加层、结局背景**都是铺满整个舞台的图**，共用一套 16:9 基准。

这不是随便定的：舞台用 `background-size: cover` 渲染，图的比例和舞台差得越多，
被裁掉的部分就越多；而这批环境交付图原生是 1672×941 ≈ 16:9，换算到 1280×720
的横纵比偏差只有 **0.053%**（亚像素级）—— 也就是**既不用裁画面、也不用拉伸**。
换成别的比例就必然要牺牲其中一个。

> 立绘（320×420）和 D1 立绘（480×640）是另一套用途：它们走 `object-fit: contain`，
> 不进 cover 舞台，**整张图都会显示，不会被裁**，所以不跟着 16:9。
> 立绘是**带 alpha 的抠图**（实测 `portrait.player.boy.png` 有 21% 全透明像素、
> `portrait.teacher` 有 64%），所以 `art.spec.json` 里这 6 个 id 都标了 `alpha: true` ——
> 在界面上它们直接站在背景上（不画卡片），靠一道投影托出来，请保留透明底。
>
> **校园俯瞰图是唯一的例外**，而且是刻意为之：它的比例是 7:4，而舞台可用区约 1.45。
> 它按 `contain` 等比缩放居中（见 `src/styles/base.css` 的 `.walk-map`），
> 所以既不需要、也不该服从 16:9 的舞台基准 —— `tests/unit/art.test.ts` 里有一条断言专门守着这条例外。

### 底图用 JPEG，叠加层用 PNG

- **不需要透明通道的一律按 JPEG 交**：同一画面下 JPEG 比 PNG 小一个数量级
  （这批交付的源 PNG 是 1.7–2.5 MB/张，远超过单文件 1.2 MB 的上限；转 JPEG 后 100–170 KB）。
- **叠加层必须是带透明通道的 PNG/WebP**：交给 JPEG 会把整屏压掉。

### 叠加层的浓度由**图自己的 alpha** 决定

CSS 不再对叠加层做二次压暗（以前是 `opacity:.42`）。交付的 `overlay.classroom.night`
平均 alpha 只有 66/255（最浓处 106），雨幕最浓处 106 —— 再乘 0.42 就等于把浓度砍掉一半多，
夜晚看不出是夜晚。所以：**想要多浓就画多浓**，`alpha` 是多少就按多少混合。

## 时相场景（`map.bedroom.*` / `overlay.classroom.*`）

同一天里 06:20 的卧室和 23:20 的卧室不该是同一张画面，早读的教室和晚自习的教室也不该。
引擎的做法是**场景变体**（见 `content/scenes.ts`）：时刻只声明"我在哪个地点的哪个时相里"，
具体用哪张底图、叠哪层光由场景决定。

- 卧室：**三张独立底图**（清晨 / 夜灯 / 熄灯）—— 光线差别大到换底图更划算。
- 教室：**一张底图 + 一层光**（`overlay.classroom.morning` / `.night`）—— 底图只有一张，
  教室的陈设才不会因为换了时段就对不上，你要维护的底图也只有一张。
- 操场：`playgroundRunning`（不给雨幕）与基底 `playground`（带雨幕）分开，
  因为脚本里只有 D6「考后冒雨」是在操场上明确下雨的。

目前 **D1 的九个时刻全部接上了时相**，其它日期仍走基底场景（同样的底图，只是不带时相光）。

## D1 剧情插画（`art.d1.*`）—— 现在是**真透明抠图**

`<pose>` 取 `calm` / `tired` / `tense` / `relax` / `down` / `sit` / `sitRelax` / `strain`（共 16 个槽位）。
剧情里**只写姿态**，引擎按开局性别解析成具体文件，所以从类型上就不可能把男女主角的素材
混进同一条剧情画面。某个姿态没交时会**在同一性别内**回退（例如女生没有 `down` → 用她的 `tense`），
绝不会跨性别借用。

**这一组已经从"整幅插画"改成"抠图立绘"**（第四轮导入，脚本 `scripts/import-stage-art.py`）：
人物去背之后直接站在铺满的背景上，不再是一块灰卡片压着教室。所以：

- 文件是 **WebP（带 alpha）**，不是 JPEG；`art.spec.json` 里这 12 个 id 都标了 `alpha: true`。
  漏标的话 UI 会按"照片卡"渲染（画卡片底 + 描边），人还是站在卡片里。
- 同一性别的所有姿态**共用同一个裁剪框**，否则切换姿态时人物会上下乱跳。
- 交付源里有四个坑，都在 `import-stage-art.py` 里做了补偿，重出图时请对着看：
  1. `transparent/男生_平静状态.png` 里画的其实是**女生**，反之亦然（两个文件性别写反）；
  2. `男生_正常坐姿_完整课桌.png` 是 512×512、**纯白底、没有 alpha**，而同组另外三张
     是 912×1216 带 alpha 的抠图 —— 按同一裁剪框处理会得到"白矩形 + 缩在角上的小人"；
  3. `*_被老师批评_紧绷动作.jpg` 是**把带透明通道的成品导出成了 JPEG**，透明变成了画上去的
     **棋盘格**（男生那格是白 + 深灰，女生是白 + 浅灰）；
  4. `transparent/男生_被批评后低头.png`（`down` 姿态）里画的也是**女生**，
     所以这一张**整张作废**、`art.d1.boy.down` 故意没有文件，由回退链退到 `tense`。
     **不要**为了"补上这个槽位"随便放一张图 —— 那会让男生路线出现女生。

## 情绪信号（`signal.*` / `vfx.*`）

这一组替换掉了画面上最后一批**占位图案**：从前情绪信号画的是 6 个 emoji
（🌧 ◌ ✗ 💤 📱 🌫，靠 `.signal{font-size:52px}` 撑大小）。现在是真的水彩信号图：

```text
signal.cloud.dark / .gray / .white / .gold   480 × 320   （四朵云，带 alpha）
signal.zzz                                   480 × 320   （困倦碎片）
signal.redCross / .isolation / .phone
signal.arrow / .exitHighlight                256 × 256   （圆形图标类，带 alpha）
vfx.goldenZipper                             320 × 480   （金色拉链，竖构图）
vfx.protectiveHand                           480 × 400   （护住的手）
```

- **必须带 alpha**：它们是贴在场景上的"贴纸"，不透明的图就是一块盖住舞台的色块。
- 尺寸走 `--signal-base`（按 kind 分云/图标两档）× `--signal-scale`（按 intensity 三档）
  × `--signal-fit`（插画在场时缩一档）× 相乘，所以**别把几个规则写成同一个变量**（会变成覆盖）。
- 内容层用 `Signal.asset` 指定用哪张图（`content/assets.ts` 的 `SIGNAL_ART`），
  引擎不认识 `kind` 与图的对应关系 —— 换图只改内容层。

## 人物自动移动转场（`map.campus.base` + `move.*`）

来自 `map_routes_ts_交接包_v1.0`，见 `content/campus.ts`（世界数据）与
`src/systems/walkSystem.ts`（动画）。

```text
map.campus.base           1344 × 768   （校园俯瞰图，**不透明**）
move.<boy|girl>.<up|down|left|right>.<1|2>
   男生 128 × 128 / 女生 96 × 128      （四方向各两帧行走，带 alpha）
```

- **校园地图不跟着 16:9 的舞台基准走**：它的比例是 **7:4**（1344×768），所有路线坐标
  （归一化 0..1）都长在这个比例上，重采样到 16:9 会把校园横向拉长 1.6%、点位就和马路对不上了。
  渲染时它按 `contain` 等比放进舞台（像素尺寸由 `WalkSystem` 算好写进元素），
  **不要改成 `background-size:cover`** —— 舞台比地图高得多，cover 会横向裁掉 17% 的构图。
- 行走帧按**高度**对齐、宽度各自自适应。男生 128 宽、女生 96 宽，**不要拉成同宽**，那会把人压扁。
- 小人的高度是按交接包原生比例算的（128/768 = 16.7% 的地图高度），跟地图一起缩放。

可用扩展名：`.png` / `.webp` / `.jpg` / `.jpeg` / `.svg`。
单个文件不要超过 **1.2 MB** —— 单文件构建会把图内联进 HTML，体积会再 ×1.33。

## 图没交齐也能跑

**不需要一次交齐。** 没有对应文件的 AssetId 会自动回退到 `content/assets.ts` 里的占位图
（并被打上 `placeholder: true`，回退链据此判断"这张到底交了没有"），
游戏始终可运行、可测试、可试玩。可以一张一张替换。

## 交图后必须做的三步

```bash
node scripts/art.mjs check   # 校验文件名和尺寸（npm run build 会自动先跑这一步）
npm run build                # 产出 dist/index.html
npm run test                 # 单测 + 冒烟
npm run preview              # 另开一个窗口
npm run test:browser         # 真浏览器验收，截图在 tests/browser/shots/
```

尺寸或文件名不对时，`check` 会直接**让构建失败**并说明哪个文件错在哪 —— 这是故意的，
防止错尺寸的图被静默拉伸。要改尺寸基准，改 `content/art.spec.json`（唯一真相来源）。

## 想先演练一遍？

```bash
node scripts/art.mjs drill
```

它会生成一套尺寸合规的条纹假图、跑一遍校验，然后提示你执行 build / test / test:browser。
演练完假图会自动删除，回到占位图状态。加 `--keep` 可以留着。

## 把交付的图搬进 art/（一次性导入脚本）

美工交来的图往往**不叫 AssetId**（例如 `bg_bedroom_morning.png`），而且尺寸是原生出图尺寸。
`scripts/import-scene-art.ps1` 负责这一步：按映射表读取、重采样到规格尺寸、写成 AssetId 文件名。
它会把每张图的横纵缩放偏差打出来（这批是 0.053%），偏差大了就说明"要么裁、要么拉伸"，
该回头和美术确认比例，而不是硬压过去。

```powershell
.\scripts\import-scene-art.ps1 -BgDir <01_backgrounds> -OverlayDir <02_overlays> -GeneratedDir <05_working\ai_generations>
```

> 这个脚本刻意写成**纯 ASCII**（连注释也是）：Windows PowerShell 5.1 按系统 ANSI 代码页读 `.ps1`，
> 含中文的 UTF-8 无 BOM 脚本会被解码坏掉，报出来的错和真实原因完全无关。中文说明放在这份文档里。

新交来叠加层时，可以先用 `scripts/imgprobe.ps1` 量一下它的 alpha 到底有多浓：

```powershell
.\scripts\imgprobe.ps1 -ImgPath art\overlay.rain.png
```

它会给出平均/最小/最大 alpha 和直方图。判断标准很简单：平均 alpha 太低（个位数）
在正式底图上就看不见了，该回去加浓；接近 255 就不再是叠加层，而是把场景整个盖住了。

**不要改的东西**：AssetId（文件名）、剧情节点 id、`onceKey`、触发顺序、状态字段、引擎接口。
你只需要替换图片本身。

## 关于 `art-originals/`（不是构建输入）

根目录的 `art-originals/` 里放着**四张主角立绘的原始版本**（`portrait.player.*.png`），
是 `scripts/clean-portrait-alpha.py` 就地清理那层半透明灰雾之前留的备份
（背景见《待确认问题-给编剧策划》§6.9⑥）。

- 它**不是**构建输入：Vite 只会 glob `art/`，`npm run art:check` 也只扫 `art/`，所以放在这里不影响任何构建与校验。
- 美工按"alpha 只有 0 或 255、边缘留一点抗锯齿"重出主角立绘之后，
  直接用新图覆盖 `art/portrait.player.*.png`、把 `art-originals/` 删掉即可。
