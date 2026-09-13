#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""清掉主角立绘四周那层"没抠干净的半透明灰雾"（一次性脚本）。

## 为什么需要它

`art/portrait.player.boy.png` / `.girl.png` 及其 `.rest` 两张，实测 alpha 分布是：

    全透明(≤10) 约 21% ／ 半透明(25–200) 约 26% ／ 实体(≥245) 约 49%

也就是说人物是抠出来了，但**背景没抠干净**，留下了一层半透明的灰白噪声。
在浅色场景（清晨教室）里它和背景差不多白，看不出来；到了 D4 黄昏、D6 夜里的暗场景，
它就是人物背后的一团灰云 —— 真机截图里一眼可见。

对照之下老师那两张是干净的（`portrait.teacher.strict` 半透明只占 1.7%），
所以这是**主角专属的交付缺陷**，不是渲染问题。

## 做了什么（对应《待确认问题》§6.9⑥ 的第 2 个方案）

    alpha' = 255 if alpha ≥ KEEP else 0        # 二值化
    alpha' = 对上面这一层做 0.8px 高斯羽化      # 免得轮廓出现硬锯齿

**必须是二值化，不能做线性映射。** 第一版写的是
`alpha' = (alpha − 200) / 55 × 255`（把 200→255 线性拉满），结果人物**整个变成了半透明**：
原图不只是背景脏，而是**整张图被整体压过一层透明度** —— 实测 200–244 那一档占了 24%，
也就是人物的身体本身就落在那一档里。线性映射会把身体按 230→139 压下去，
在深色场景里人就变成了一个幽灵（真机截图里看得很清楚）。
二值化则把"人物"一次性拉成 255 不透明、把"背景"一次性清零，两边都对。

**这是一次程序改美术交付图** —— 边缘会比原图略硬一点（羽化后基本看不出来），
是这一步的已知代价；美工按"alpha 只有 0 或 255、边缘留一点抗锯齿"重出之后，
这个脚本连同它的产物一起作废即可。

## 用法

    python scripts/clean-portrait-alpha.py --dry-run   # 只报告，不写文件
    python scripts/clean-portrait-alpha.py             # 就地清理（原件备份到 art-originals/）
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys

import numpy as np

try:
    from PIL import Image, ImageFilter
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "art")
BACKUP_DIR = os.path.join(ROOT, "art-originals")

#: 只处理这四张：老师那两张本来就是干净的（半透明仅 1.7%），不要动
TARGETS = [
    "portrait.player.boy.png",
    "portrait.player.boy.rest.png",
    "portrait.player.girl.png",
    "portrait.player.girl.rest.png",
]

#: ≥ 这个 alpha 才当"人物"留下。200 是《待确认问题》§6.9⑥ 里量的分界：
#: 灰雾集中在 25–200，实体像素在 245 以上，中间那一条基本是空的。
KEEP = 200
FEATHER = 0.8


def stats(alpha: np.ndarray) -> str:
    return "透明 %.1f%% / 半透明 %.1f%% / 实体 %.1f%%" % (
        100 * (alpha <= 10).mean(),
        100 * ((alpha > 25) & (alpha < 200)).mean(),
        100 * (alpha >= 245).mean(),
    )


def clean(path: str, dry_run: bool) -> tuple[str, str, float, float]:
    with Image.open(path) as opened:
        img = opened.convert("RGBA")
    before = np.array(img)[..., 3].copy()

    a = np.array(img).copy()
    # 二值化（不是线性映射 —— 见文件头"必须是二值化"那段）
    a[..., 3] = np.where(a[..., 3] >= KEEP, 255, 0).astype(np.uint8)
    if FEATHER:
        a[..., 3] = np.array(Image.fromarray(a[..., 3]).filter(ImageFilter.GaussianBlur(FEATHER)))
    out = Image.fromarray(a)

    if not dry_run:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        backup = os.path.join(BACKUP_DIR, os.path.basename(path))
        if not os.path.exists(backup):  # 只在第一次跑的时候留原件，重复跑不会把清理后的版本当原件
            shutil.copy2(path, backup)
        out.save(path, "PNG", optimize=True)

    # 自检看的是"半透明还剩多少"，**不是"实体变多了多少"** ——
    # 0.8px 羽化会把最外一圈实体像素推进 200–244 那一档，所以"实体"的占比反而会微降
    # （实测 −1.9%），那不是失败。真正的判据是：半透明被清掉、透明区变大。
    ma = np.array(out)[..., 3]
    cleared = 100 * ((ma <= 10).mean() - (before <= 10).mean())
    mid = 100 * ((ma > 25) & (ma < 200)).mean()
    return stats(before), stats(ma), cleared, mid


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("%-30s %-42s %-42s %8s %8s" % ("文件", "清理前", "清理后", "透明增量", "残留半透明"))
    missing = 0
    bad = 0
    for name in TARGETS:
        path = os.path.join(ART_DIR, name)
        if not os.path.exists(path):
            print("%-30s （没有这个文件，跳过）" % name)
            missing += 1
            continue
        b, after, cleared, mid = clean(path, args.dry_run)
        flag = ''
        if cleared < 5:
            flag = '  ← 透明区没变大，那层灰雾大概没被删掉'
        if mid > 12:
            flag += '  ← 还留着大片半透明'
        if flag:
            bad += 1
        print("%-30s %-42s %-42s %7.1f%% %7.1f%%%s" % (name, b, after, cleared, mid, flag))

    if args.dry_run:
        print("\n(dry run —— 没有写文件)")
    else:
        print("\n原件已备份到 art-originals/（不是构建输入，art/ 不受影响）。")
        print("下一步：npm run build && npm test && npm run test:browser")
    if missing >= len(TARGETS):
        print("\n一个目标文件都没有，路径大概不对。")
        return 1
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
