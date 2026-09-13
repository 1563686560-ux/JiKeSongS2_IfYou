/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000 },
  test: {
    // jsdom 默认**不实现 requestAnimationFrame**（`typeof requestAnimationFrame === 'undefined'`），
    // 除非开 pretendToBeVisual。这一条是踩出来的：人物自动移动转场（WalkSystem）用 rAF 推进，
    // 而在这个开关打开之前，测试里那段动画**一帧都不会动** —— 表现是"转场出现在 DOM 里、
    // 然后永远停在那儿"，用例超时，看起来像测试写错了，其实是环境缺能力。
    // 真浏览器一直是对的，所以这个坑只会在测试里露头；反过来，不开它就没法在 jsdom 里
    // 验证任何逐帧动画（这一组用例是唯一能自动发现"走路不动"的地方）。
    environmentOptions: { jsdom: { pretendToBeVisual: true } },
  },
  server: {
    // 端口不用 Vite 默认的 5173：本机已有别的项目（html5课程设计\Myapp）用 --host 占着 5173，
    // 两边会互相抢地址，导致 http://localhost:5173 指向错的应用（实测打开了别的项目）。
    // 端口在 package.json 的 scripts 里用 --port/--strictPort 显式指定，这里不再重复。
    watch: {
      // 编辑器/Agent 保存文件时会先在同目录建 "<name>.<pid>.<uuid>.tmpdir/xxx.tmp" 再原子改名。
      // Windows 上这些临时目录带锁，Vite 的 watcher 一旦去 watch 就 EBUSY，会直接崩掉 dev server。
      // 说明：下面这条 ignored 是防御性的，实测在 Windows + chokidar 下并不能完全挡住（依旧会崩）；
      // 不要开 usePolling —— 轮询虽然让服务器不崩，但会占住文件句柄，反过来让文件保存失败(EIO)。
      // 结论：要边改边跑就用 `npm run build` + `npm run preview`（preview 不 watch，最稳）。
      ignored: [/\.tmpdir[\\/]/, /\.tmp$/],
    },
  },
});
