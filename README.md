# 如果有你（If Only You Were There）

治愈系守护模拟 / 轻叙事 Web 游戏。TypeScript + DOM/CSS/SVG + Web Audio，无游戏引擎，Vite 构建成单个 HTML 文件。

## 启动

需要 Node.js 18+。

```bash
npm install
```

```bash
npm run dev          # 开发模式，http://127.0.0.1:5180
```

试玩正式产物：

```bash
npm run build        # 产出单文件 dist/index.html
npm run preview      # 托管 dist/，http://127.0.0.1:4180
```

`npm ci && npm run build && npm run preview` 即可完整试玩，仓库自带全部素材，无需额外资源。

## 其它命令

```bash
npm run test         # 单元 + 冒烟测试（jsdom）
npm run test:browser # 真浏览器验收（需先 npm run preview）
npm run art:check    # 校验 art/ 里的美术资源（build / test 前会自动执行）
```

---

