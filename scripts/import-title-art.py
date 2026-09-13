#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""标题页交接包（title-screen-handoff/）的导入 —— 一次性，和 import-scene-art.ps1 /
import-story-art.py / import-stage-art.py 同类。

为什么要它：
  交接包直接把两张**全屏天空底图**当 CSS 背景用（`--title-bg: url('bg_title_dim.png')`），
  而本作是**单文件构建**：图片一律进 art/、由 Vite 内联成 data URL，页面零外部请求。
  交接包**本身不是构建输入**（title-screen-handoff/ 在 .gitignore 里），
  所以这两张图必须按 AssetId 落进 art/ 才能上屏。

三件交接包没给、但本作必须做的事：
  1. **重采样到舞台基准** 1280×720。交付原生 1672×941（1.77683），舞台基准 16:9（1.77778），
     横纵比差 0.05%（亚像素级，和《美术交付清单》里美工 A 的环境图同一档），
     所以直接重采样，既不裁画面也不拉伸。
  2. **压体积**。交付是 2.6 MB / 2.3 MB 的 PNG，而 `art.spec.json` 的 maxBytes 是 1.23 MB，
     单文件构建还要再 ×1.33（内联成 base64）。天空是连续渐变，WebP q88 就该在 300 KB 上下。
  3. 名字：文件名 = AssetId，所以 `bg_title_dim.png` → `title.bg.dim.webp`。

用法：
    python scripts/import-title-art.py --dry-run    # 只报告尺寸与体积，不写文件
    python scripts/import-title-art.py              # 写入 art/

契约（不要破坏）：输出文件名 = AssetId，且该 AssetId 必须同时存在于 content/art.spec.json
（尺寸要与这里一致），否则 `npm run art:check` 会（故意的）让构建失败。
"""

from __future__ import annotations

import argparse
import io
import os
import sys

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "art")
HANDOFF = os.path.join(ROOT, "title-screen-handoff")

# 交接包里的文件名 → AssetId（**别改**：art.spec.json 与 content/assets.ts 都按这个名字认）
SHOTS = [
    ("bg_title_dim.png", "title.bg.dim"),
    ("bg_title_gentle.png", "title.bg.gentle"),
]

STAGE_W, STAGE_H = 1280, 720
WEBP_QUALITY = 88
WEBP_METHOD = 6
MAX_BYTES = 1258291  # art.spec.json 的 maxBytes，超了 art:check 会让构建失败


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只报告，不写文件")
    args = ap.parse_args()

    os.makedirs(ART_DIR, exist_ok=True)
    failed = False
    for src_name, asset_id in SHOTS:
        src = os.path.join(HANDOFF, src_name)
        if not os.path.exists(src):
            print(f"✗ 找不到交接包里的 {src_name}（{src}）")
            failed = True
            continue

        with Image.open(src) as im:
            native = im.size
            # 天空图不带透明通道；交付若是 RGBA 也按不透明处理（WebP 有 alpha 会白胖一圈）
            rgb = im.convert("RGB")
        out = rgb.resize((STAGE_W, STAGE_H), Image.LANCZOS)

        buf = io.BytesIO()
        out.save(buf, format="WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
        data = buf.getvalue()

        over = "  ✗ 超过 maxBytes" if len(data) > MAX_BYTES else ""
        if over:
            failed = True
        print(f"{asset_id}")
        print(f"  源：{src_name} {native[0]}×{native[1]} → {STAGE_W}×{STAGE_H}")
        print(f"  体积：{os.path.getsize(src) / 1024:.0f} KB → {len(data) / 1024:.0f} KB{over}")

        if args.dry_run:
            continue
        dst = os.path.join(ART_DIR, f"{asset_id}.webp")
        with open(dst, "wb") as f:
            f.write(data)
        print(f"  写入：art/{asset_id}.webp")

    if args.dry_run:
        print("\n（--dry-run：没有写任何文件）")
    if failed:
        return 1
    print("\n接下来：npm run art:check && npm run build")
    return 0


if __name__ == "__main__":
    sys.exit(main())
