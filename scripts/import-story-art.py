#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""D2-D6 story art importer (one-off, like scripts/import-scene-art.ps1).

Why Python: the delivery is transitively "WebP q80 or bust". A 912x1216 PNG out of
the generator is 1.2-1.5 MB; the same frame as WebP q80 is ~45 KB. The repo's
single-file build inlines every image as base64 (x1.33), so importing the raw
deliverables would turn dist/index.html into a ~57 MB document. Node has no WebP
encoder without a dependency, PowerShell's System.Drawing cannot write WebP at
all, and Pillow (already installed here) can - so the one-off importer is Python.
The build/test pipeline does NOT depend on this script; it only writes art/*.webp.

Usage:
    python scripts/import-story-art.py            # import everything in JOBS
    python scripts/import-story-art.py --dry-run  # report only, write nothing
    python scripts/import-story-art.py --only d2  # only one delivery folder

Contract (do not break): the output filename is the AssetId, and the AssetId must
also exist in content/art.spec.json with the exact width/height written here,
otherwise `npm run art:check` fails the build on purpose.
"""

from __future__ import annotations

import argparse
import os
import sys

try:
    from PIL import Image, ImageOps
except ImportError:  # pragma: no cover - environment guard
    sys.exit("Pillow is required: pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "art")

# Delivery folders -> short key used in JOBS.
PACKS = {
    "d2": "如果有你_DAY2人物素材_可发送_v2.0",
    "d3": "如果有你_DAY3人物素材_可发送_v1.0",
    "d4": "如果有你_DAY4人物素材_可发送_v1.2",
    "d5": "如果有你_DAY5人物素材_可发送_v1.0",
    "d6": "如果有你_DAY6人物素材_可发送_v1.0",
    "d7": "如果有你_DAY7人物素材_可发送_v1.0",
}

# D1-D7 are all imported (D1 came in earlier through scripts/import-scene-art.ps1).
#
# (pack, path inside the pack, AssetId, target width, target height)
#
# Target sizes are the game's real render sizes, not "whatever the source was":
#   * 480x640  - a story CG card is at most ~572 px tall on a 1280x860 window
#                (see .moment-cg in src/styles/base.css), so 640 tall is 1:1 there
#                and still sharp on a 1440x1000 window because .cg-card maxes at 640.
#   * 640x480  - the same card budget for the 4:3 shots (the card is 100% of the
#                row height, width follows the aspect ratio).
#   * 512x512  - prop close-ups (道具). The delivery ships them 1:1; as the second
#                card of a two-card row the card is 88% of ~572 px, so 512 is 1:1.
#   * 1280x720 - full-stage scene backgrounds (map.*/ending.*), the stage baseline.
#
# NOT IMPORTED, on purpose:
#   day6/common/排名公布_投影道具.jpg - the frame has the boy on the left AND the
#   girl on the right at the same time, which breaks the delivery's own hard rule
#   ("任何剧情画面不得同时出现男生和女生", 说明 §一). It is also the only delivered
#   16:9 frame whose subject is people rather than a place, so it cannot be used as
#   a scene bed either. Reported in 美术交付清单.md and 待确认问题 §6.8; it needs a
#   reshoot as "empty classroom with the projected ranking" or two per-gender cuts.
JOBS = [
    # ---- DAY2: 成绩单来了 (D2_0800) -------------------------------------
    ("d2", "day2/boy/男生_查看成绩单.jpg", "art.story.boy.report", 480, 640),
    ("d2", "day2/girl/女生_查看成绩单.png", "art.story.girl.report", 480, 640),
    ("d2", "day2/teacher/老师_递出成绩单.png", "art.story.teacher.handout", 480, 640),
    ("d2", "day2/common/同学_聚拢围观.jpg", "art.story.common.crowd", 640, 480),
    # ---- DAY2: 卧室（赖床 / 睡眠不足）-----------------------------------
    ("d2", "day2/boy/男生_上下铺皱眉睡觉.jpg", "art.story.boy.bunkSleep", 480, 640),
    ("d2", "day2/girl/女生_上下铺皱眉睡觉.jpg", "art.story.girl.bunkSleep", 480, 640),
    # ---- DAY2: 午饭（说明书写 12:40 食堂）-------------------------------
    ("d2", "day2/boy/男生_食堂吃饭.jpg", "art.story.boy.canteen", 640, 480),
    ("d2", "day2/girl/女生_食堂吃饭.jpg", "art.story.girl.canteen", 640, 480),
    # ---- DAY3: 晨读喝豆浆 (D3_0750) -------------------------------------
    ("d3", "day3/boy/男生_晨读喝豆浆.jpg", "art.story.boy.morningRead", 640, 480),
    ("d3", "day3/girl/女生_晨读喝豆浆.jpg", "art.story.girl.morningRead", 640, 480),
    # ---- DAY3: 一个人的午饭 (D3_1230) -----------------------------------
    ("d3", "day3/boy/男生_一个人的午饭.jpg", "art.story.boy.lunchAlone", 640, 480),
    ("d3", "day3/girl/女生_一个人的午饭.jpg", "art.story.girl.lunchAlone", 640, 480),
    # ---- DAY3: 操场的风 (D3_1540) - 场景底图，不是 CG 卡 -----------------
    ("d3", "day3/common/操场_风把云吹得很快.jpg", "map.playground.windy", 1280, 720),

    # ---- DAY4: 清晨「梦里都在考试」(D4_0610) -----------------------------
    ("d4", "day4/boy/男生_梦里都在考试.jpg", "art.story.boy.examDream", 480, 640),
    ("d4", "day4/girl/女生_梦里都在考试.jpg", "art.story.girl.examDream", 480, 640),
    # ---- DAY4: 排名被当众念出 (D4_0930) ----------------------------------
    ("d4", "day4/boy/男生_排名被当众念出.jpg", "art.story.boy.rankCalled", 640, 480),
    ("d4", "day4/girl/女生_排名被当众念出.jpg", "art.story.girl.rankCalled", 640, 480),
    # ---- DAY4: 下午隔着雾 (D4_1400) - 环境空镜，场景底图 ------------------
    ("d4", "day4/common/教室_下午隔着雾.jpg", "map.classroom.foggy", 1280, 720),
    # ---- DAY4: 黄昏粉笔灰 (D4_1700) - 环境空镜，场景底图 ------------------
    ("d4", "day4/common/教室_黄昏粉笔灰.jpg", "map.classroom.dusk", 1280, 720),
    # ---- DAY4: 爸妈来电 (D4_2000) - 人物 + 道具特写 ------------------------
    ("d4", "day4/boy/男生_家长来电低头.jpg", "art.story.boy.phoneBow", 640, 480),
    ("d4", "day4/girl/女生_家长来电低头.jpg", "art.story.girl.phoneBow", 640, 480),
    ("d4", "day4/common/手机_家长来电.jpg", "art.story.common.phoneCall", 512, 512),

    # ---- DAY5: 天亮得早一点 (D5_0740) - 环境空镜，场景底图 ----------------
    ("d5", "day5/common/教室_天亮得早一点.jpg", "map.classroom.earlyLight", 1280, 720),
    # ---- DAY5: 同桌把笔记推过来 (D5_1000) - 人物 + 道具特写 ----------------
    ("d5", "day5/boy/男生_同桌把笔记推过来.jpg", "art.story.boy.notesPassed", 640, 480),
    ("d5", "day5/girl/女生_同桌把笔记推过来.jpg", "art.story.girl.notesPassed", 640, 480),
    ("d5", "day5/common/课堂笔记_道具.jpg", "art.story.common.notesProp", 512, 512),
    # ---- DAY5: 冰汽水 (D5_1300) - 道具本身就是这一刻的主角 ----------------
    ("d5", "day5/common/冰汽水_道具.jpg", "art.story.common.soda", 512, 512),
    # ---- DAY5: 操场的风 (D5_1630) - 环境空镜，场景底图 --------------------
    ("d5", "day5/common/操场_温柔的风.jpg", "map.playground.gentle", 1280, 720),
    # ---- DAY5: 羁绊检查点 (D5_2100 / D5_2101) -----------------------------
    ("d5", "day5/boy/男生_羁绊检查点.jpg", "art.story.boy.bondCheck", 640, 480),
    ("d5", "day5/girl/女生_羁绊检查点.jpg", "art.story.girl.bondCheck", 640, 480),

    # ---- DAY6: 补课清晨 (D6_0730) - 环境空镜，场景底图 --------------------
    ("d6", "day6/common/教室_补课清晨.jpg", "map.classroom.makeup", 1280, 720),
    # ---- DAY6: 监考压力 (D6_0830) - 人物 + 桌面道具 -----------------------
    ("d6", "day6/boy/男生_监考压力捂耳朵.jpg", "art.story.boy.invigilate", 640, 480),
    ("d6", "day6/girl/女生_监考压力捂耳朵.jpg", "art.story.girl.invigilate", 640, 480),
    ("d6", "day6/common/试卷与铅笔_道具.jpg", "art.story.common.examPaper", 512, 512),
    # ---- DAY6: 饭有点凉 (D6_1200) ---------------------------------------
    # 交付源是 1216x912（4:3），而其它教室空镜都是 1368x768（16:9）。做场景底图会被
    # cover 裁掉 25% 的画面高度，所以按 4:3 的**插画卡**接（就是一个冷掉的饭盒特写）。
    ("d6", "day6/common/教室_饭有点凉.jpg", "art.story.common.coldLunch", 640, 480),
    # ---- DAY6: 考后冒雨 / 雨后提前放晴 (D6_1500) - 双场景底图 -------------
    ("d6", "day6/common/操场_考后冒雨.jpg", "map.playground.rainRun", 1280, 720),
    ("d6", "day6/common/操场_雨后提前放晴.jpg", "map.playground.clearing", 1280, 720),
    # ---- DAY6: 排名公布 (D6_2030) ---------------------------------------
    ("d6", "day6/boy/男生_排名公布.jpg", "art.story.boy.rankPost", 640, 480),
    ("d6", "day6/girl/女生_排名公布.jpg", "art.story.girl.rankPost", 640, 480),
    # ---- DAY6: 最后一夜 (D6_2359) ---------------------------------------
    ("d6", "day6/boy/男生_最后一夜睡眠不足.jpg", "art.story.boy.lastNight", 480, 640),
    ("d6", "day6/girl/女生_最后一夜睡眠不足.jpg", "art.story.girl.lastNight", 480, 640),

    # ---- DAY7: 今天的天好蓝 (D7_0750) - 环境空镜，场景底图 ----------------
    ("d7", "day7/common/操场_今天的天好蓝.jpg", "map.playground.blueSky", 1280, 720),
    # ---- DAY7: 笔尖沙沙 (D7_1030) - 环境空镜，场景底图 --------------------
    ("d7", "day7/common/教室_笔尖沙沙.jpg", "map.classroom.penSound", 1280, 720),
    # ---- DAY7: 终章 (D7_1500) - 抬头背景（场景）+ 主角抬头（按性别）-------
    ("d7", "day7/common/终章_抬头背景.jpg", "map.classroom.finale", 1280, 720),
    ("d7", "day7/boy/男生_终章抬头.jpg", "art.story.boy.finalLookUp", 480, 640),
    ("d7", "day7/girl/女生_终章抬头.jpg", "art.story.girl.finalLookUp", 480, 640),
    # ---- DAY7: 记忆回响黑屏 + 结局页 ------------------------------------
    ("d7", "day7/common/黑屏_记忆回响背景.jpg", "ending.memoryEcho", 1280, 720),
    ("d7", "day7/common/结局页_七朵云背景.jpg", "ending.card", 1280, 720),
]

WEBP_QUALITY = 80
WEBP_METHOD = 6


def aspect_ratio(w: int, h: int) -> tuple[int, int]:
    from math import gcd

    g = gcd(w, h)
    return (w // g, h // g)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="report only, write nothing")
    ap.add_argument("--only", default="", help="only this pack key (e.g. d2)")
    args = ap.parse_args()

    if not os.path.isdir(ART_DIR):
        os.makedirs(ART_DIR)

    rows = []
    problems = []
    for pack, rel, asset_id, tw, th in JOBS:
        if args.only and pack != args.only:
            continue
        src = os.path.join(ROOT, PACKS[pack], rel.replace("/", os.sep))
        if not os.path.exists(src):
            problems.append("MISSING  %s  (%s)" % (asset_id, rel))
            continue

        with Image.open(src) as opened:
            img = ImageOps.exif_transpose(opened)
            sw, sh = img.size
            # The delivered environment frames are 1368x768, i.e. 1.78125 against the
            # stage's 1.77778 - a 0.2% deviation (sub-pixel on a 1280x720 cover). Report
            # the skew and only fail on a *real* ratio change: a genuinely different
            # aspect (e.g. 4:3 art dropped into a 16:9 slot) would either distort the
            # composition or crop it, and that must never be discovered later by eye.
            skew = abs((tw / sw) - (th / sh)) / (th / sh) * 100.0
            if skew > 0.5:
                problems.append(
                    "ASPECT   %s  source %dx%d (%d:%d) vs target %dx%d (%d:%d), skew %.2f%%"
                    % (asset_id, sw, sh, *aspect_ratio(sw, sh), tw, th, *aspect_ratio(tw, th), skew)
                )
                continue

            has_alpha = img.mode in ("RGBA", "LA") or "transparency" in img.info
            work = img.convert("RGBA") if has_alpha else img.convert("RGB")
            if has_alpha:
                # "Is the alpha channel actually used?" - a PNG can be RGBA and still
                # be fully opaque (all nine D1 "transparent/" files were exactly that).
                # Only a genuinely cut-out image needs the cut-out rendering path.
                alpha = work.getchannel("A")
                lo, _hi = alpha.getextrema()
                used = lo < 250
            else:
                used = False

            resized = work.resize((tw, th), Image.LANCZOS)
            out = os.path.join(ART_DIR, asset_id + ".webp")
            params = dict(quality=WEBP_QUALITY, method=WEBP_METHOD)
            if used:
                # Keep RGB under fully transparent pixels: without `exact` the encoder
                # is free to bleed the neighbouring colour into them and the cut-out
                # edge fringes dark against the light stage.
                params["exact"] = True
            if args.dry_run:
                # Encode into memory anyway: the whole point of the dry run is to know
                # the size budget before committing 13 files to art/.
                import io

                buf = io.BytesIO()
                resized.save(buf, "WEBP", **params)
                kb_after = len(buf.getvalue()) / 1024.0
            else:
                resized.save(out, "WEBP", **params)
                kb_after = os.path.getsize(out) / 1024.0

        kb_before = os.path.getsize(src) / 1024.0
        rows.append((asset_id, "%dx%d" % (sw, sh), "%dx%d" % (tw, th), "alpha" if used else "opaque",
                     kb_before, kb_after, skew))

    print("%-34s %-11s %-11s %-7s %9s %9s %6s" % ("AssetId", "source", "target", "channel", "src KB", "out KB", "skew"))
    for asset_id, s, t, ch, kb0, kb1, skew in rows:
        print("%-34s %-11s %-11s %-7s %9.1f %9.1f %5.2f%%" % (asset_id, s, t, ch, kb0, kb1, skew))

    total_before = sum(r[4] for r in rows)
    total_after = sum(r[5] for r in rows)
    print("\n%d file(s): %.1f MB -> %.2f MB  (base64 inlined x1.33 => +%.2f MB in dist)"
          % (len(rows), total_before / 1024.0, total_after / 1024.0, total_after * 1.33 / 1024.0))
    if args.dry_run:
        print("(dry run - nothing written)")

    if problems:
        print("\nPROBLEMS:")
        for p in problems:
            print("  " + p)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
