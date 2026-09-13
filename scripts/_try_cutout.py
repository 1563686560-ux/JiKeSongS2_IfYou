#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""临时实验：把 D1 的每一张源图都试一遍去背，输出对照片看效果。"""
from __future__ import annotations

import os
from collections import deque

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P1 = os.path.join(ROOT, "如果有你_DAY1人物素材_可发送_v2.0")

# (源文件, 标签, 是否交换男女)  —— *_平静状态.png 在交付里男女放反了
SOURCES = [
    ("boy", "transparent/女生_平静状态.png", "boy calm*"),
    ("boy", "transparent/男生_疲惫状态.png", "boy tired"),
    ("boy", "transparent/男生_紧绷状态.png", "boy tense"),
    ("boy", "transparent/男生_放松状态.png", "boy relax"),
    ("boy", "transparent/男生_被批评后低头.png", "boy down"),
    ("boy", "day1/男生_被老师批评_紧绷动作.jpg", "boy strain"),
    ("boy", "day1_new/boy/男生_正常坐姿_完整课桌.png", "boy sit"),
    ("boy", "day1_new/boy/男生_放松坐姿_完整课桌.png", "boy sitRelax"),
    ("girl", "transparent/男生_平静状态.png", "girl calm*"),
    ("girl", "transparent/女生_疲惫状态.png", "girl tired"),
    ("girl", "transparent/女生_紧绷状态.png", "girl tense"),
    ("girl", "transparent/女生_放松状态.png", "girl relax"),
    ("girl", "day1/女生_被老师批评_紧绷动作.jpg", "girl strain"),
    ("girl", "day1_new/girl/女生_正常坐姿_完整课桌.png", "girl sit"),
    ("girl", "day1_new/girl/女生_放松坐姿_完整课桌.png", "girl sitRelax"),
]


def flood_cutout(img: Image.Image, tol: float, feather: float = 1.6):
    rgba = np.array(img.convert("RGBA")).astype(np.int16)
    h, w, _ = rgba.shape
    rgb = rgba[..., :3]
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]], axis=0)
    ref = np.median(border, axis=0)
    dist = np.sqrt(((rgb - ref) ** 2).sum(axis=2))
    similar = dist <= tol
    visited = np.zeros((h, w), dtype=bool)
    q = deque()
    for x in range(w):
        for y in (0, h - 1):
            if similar[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if similar[y, x] and not visited[y, x]:
                visited[y, x] = True
                q.append((y, x))
    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not visited[ny, nx] and similar[ny, nx]:
                visited[ny, nx] = True
                q.append((ny, nx))
    out = np.array(img.convert("RGBA"))
    out[..., 3] = np.where(visited, 0, 255).astype(np.uint8)
    if feather:
        a = Image.fromarray(out[..., 3]).filter(ImageFilter.GaussianBlur(feather))
        out[..., 3] = np.array(a)
    return Image.fromarray(out), 100 * visited.mean()


def bbox_of(im: Image.Image):
    a = np.array(im)[..., 3]
    ys, xs = np.where(a > 16)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def main() -> int:
    CELL_W, CELL_H, LABEL_H = 150, 200, 14
    cols = 8
    rows = 2
    sheet = Image.new("RGB", (cols * CELL_W, rows * (CELL_H + LABEL_H)), (255, 255, 255))
    draw = ImageDraw.Draw(sheet)
    report = []
    per_who = {"boy": [], "girl": []}
    for who, rel, label in SOURCES:
        path = os.path.join(P1, rel.replace("/", os.sep))
        im = Image.open(path)
        cut, removed = flood_cutout(im, 10)
        per_who[who].append((label, cut, removed))
        report.append((label, im.size, removed, bbox_of(cut)))
    for ri, who in enumerate(("boy", "girl")):
        for ci, (label, cut, _removed) in enumerate(per_who[who]):
            x0 = ci * CELL_W
            y0 = ri * (CELL_H + LABEL_H)
            cell = Image.new("RGBA", (CELL_W, CELL_H), (170, 196, 214, 255))
            small = cut.copy()
            small.thumbnail((CELL_W - 6, CELL_H - 6), Image.LANCZOS)
            cell.alpha_composite(small, ((CELL_W - small.width) // 2, (CELL_H - small.height) // 2))
            sheet.paste(cell.convert("RGB"), (x0, y0))
            draw.text((x0 + 3, y0 + CELL_H + 1), label, fill=(0, 0, 0))
    out = os.path.join(ROOT, "tmp-cutout", "d1-cut-contact.png")
    sheet.save(out)
    print(out, sheet.size)
    for label, size, removed, bb in report:
        print("%-14s %-11s removed=%5.1f%%  bbox=%s" % (label, "%dx%d" % size, removed, bb))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
