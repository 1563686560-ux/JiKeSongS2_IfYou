#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成一张 D1 素材对照片（临时工具，不属于构建管线）。"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P1 = os.path.join(ROOT, "如果有你_DAY1人物素材_可发送_v2.0")

ROWS = [
    ("boy", [
        ("transparent/男生_平静状态.png", "boy calm"),
        ("transparent/男生_疲惫状态.png", "boy tired"),
        ("transparent/男生_紧绷状态.png", "boy tense"),
        ("transparent/男生_放松状态.png", "boy relax"),
        ("transparent/男生_被批评后低头.png", "boy down"),
        ("day1/男生_被老师批评_紧绷动作.jpg", "boy strain"),
        ("day1_new/boy/男生_正常坐姿_完整课桌.png", "boy sit"),
        ("day1_new/boy/男生_放松坐姿_完整课桌.png", "boy sitRelax"),
    ]),
    ("girl", [
        ("transparent/女生_平静状态.png", "girl calm"),
        ("transparent/女生_疲惫状态.png", "girl tired"),
        ("transparent/女生_紧绷状态.png", "girl tense"),
        ("transparent/女生_放松状态.png", "girl relax"),
        ("day1/女生_被老师批评_紧绷动作.jpg", "girl strain"),
        ("day1_new/girl/女生_正常坐姿_完整课桌.png", "girl sit"),
        ("day1_new/girl/女生_放松坐姿_完整课桌.png", "girl sitRelax"),
    ]),
]

CELL_W, CELL_H = 150, 200
LABEL_H = 14
BG = (200, 214, 226, 255)


def main() -> int:
    cols = max(len(r[1]) for r in ROWS)
    sheet = Image.new("RGB", (cols * CELL_W, len(ROWS) * (CELL_H + LABEL_H)), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    for ri, (_who, items) in enumerate(ROWS):
        for ci, (rel, label) in enumerate(items):
            path = os.path.join(P1, rel.replace("/", os.sep))
            cell = Image.new("RGBA", (CELL_W, CELL_H), BG)
            if os.path.exists(path):
                im = Image.open(path).convert("RGBA")
                im.thumbnail((CELL_W - 8, CELL_H - 8), Image.LANCZOS)
                cell.alpha_composite(im, ((CELL_W - im.width) // 2, (CELL_H - im.height) // 2))
            else:
                draw.text((6, ri * (CELL_H + LABEL_H) + CELL_H // 2), "MISSING", fill=(200, 0, 0))
            sheet.paste(cell.convert("RGB"), (ci * CELL_W, ri * (CELL_H + LABEL_H)))
            draw.text((ci * CELL_W + 4, ri * (CELL_H + LABEL_H) + CELL_H + 1), label, fill=(0, 0, 0))
    out = os.path.join(ROOT, "tmp-cutout", "d1-contact.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    sheet.save(out)
    print(out, sheet.size)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
