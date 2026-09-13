#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""演出 / 移动 / D1 立绘的第二轮导入（一次性，和 import-scene-art.ps1、import-story-art.py 同类）。

为什么要它：
  1. 情绪信号层一直是 **emoji**（🌧 ◌ ✗ 💤 📱 🌫）。美工其实交了一整套水彩风信号图
     （`如果有你-场景-Day1/如果有你/03_signals/`），只是从来没接进来 —— 这就是画面上
     最后一批"占位图案"。本轮把它们按 AssetId 落进 art/。
  2. 人物自动移动（map_routes 交接包）要用校园地图 + 四方向行走帧，此前也没进 art/。
  3. D1 的立绘此前是从 `transparent/*.png` 直接转 JPEG 的，**alpha 被压平**，
     于是人物在画面上是一块灰卡片。这一轮做真正的抠图，输出带 alpha 的 WebP，
     人物才能"站在"铺满的背景上（这是本轮视觉改造的地基）。

抠图算法：交付的 D1 立绘是"带纯色画的背景的整幅插画"（四角 alpha=255），
所以只能靠**从四边向内连通的同色填充**去背。要点：
  · 参考色取四边中位数，容差收紧（默认 10）—— 松了会顺着白色校服漏进去；
  · 只删**与边缘连通**的区域 —— 人物内部的白色（校服）不与边缘相连，因此保住；
  · 去背后再按"连通域面积"清一遍碎屑（教室背景被去掉后剩的白点）；
  · 最后对 alpha 做 1.6px 高斯羽化，消掉锯齿。

用法：
    python scripts/import-stage-art.py --dry-run     # 只报告，不写文件
    python scripts/import-stage-art.py --only d1     # 只做某一组（d1 / signal / map / move）
    python scripts/import-stage-art.py               # 全部

契约（不要破坏）：输出文件名 = AssetId，且该 AssetId 必须同时存在于 content/art.spec.json
（尺寸与 alpha 标记要与这里一致），否则 `npm run art:check` 会（故意的）让构建失败。
"""

from __future__ import annotations

import argparse
import io
import os
import sys
from collections import deque

import numpy as np

try:
    from PIL import Image, ImageFilter, ImageOps
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, "art")

SCENE_PACK = os.path.join(ROOT, "如果有你-场景-Day1", "如果有你")
DAY1_PACK = os.path.join(ROOT, "如果有你_DAY1人物素材_可发送_v2.0")
MOVE_PACK = os.path.join(ROOT, "map_routes_ts_交接包_v1.0", "reuse_DAY1_DAY2_DAY3_DAY4_DAY5精选")
CAMPUS_SRC = os.path.join(ROOT, "map-campus-overview(1)", "map-campus-overview.png")
MOVE_SRC = os.path.join(ROOT, "如果有你_DAY1人物素材_可发送_v2.0", "player_move")

WEBP_QUALITY = 82
WEBP_METHOD = 6

# ── 抠图 ────────────────────────────────────────────────────────────

def _border_reference(rgb: np.ndarray) -> np.ndarray:
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]], axis=0)
    return np.median(border, axis=0)


def _connected_from_border(mask: np.ndarray) -> np.ndarray:
    h, w = mask.shape
    seen = np.zeros((h, w), dtype=bool)
    q: deque[tuple[int, int]] = deque()

    def push(y: int, x: int) -> None:
        if mask[y, x] and not seen[y, x]:
            seen[y, x] = True
            q.append((y, x))

    for x in range(w):
        push(0, x)
        push(h - 1, x)
    for y in range(h):
        push(y, 0)
        push(y, w - 1)
    while q:
        y, x = q.popleft()
        if y > 0:
            push(y - 1, x)
        if y + 1 < h:
            push(y + 1, x)
        if x > 0:
            push(y, x - 1)
        if x + 1 < w:
            push(y, x + 1)
    return seen


def _keep_big_components(mask: np.ndarray, min_ratio: float = 0.0018, min_of_largest: float = 0.05) -> np.ndarray:
    """去掉抠图后残留的小碎屑（教室背景被删掉之后剩的白点）。"""
    h, w = mask.shape
    labels = np.zeros((h, w), dtype=np.int32)
    comps: list[tuple[int, int, int]] = []  # (label, area, seed_y*w+seed_x)
    current = 0
    for sy in range(h):
        row = mask[sy]
        if not row.any():
            continue
        for sx in np.nonzero(row & (labels[sy] == 0))[0]:
            current += 1
            area = 0
            q: deque[tuple[int, int]] = deque([(sy, int(sx))])
            labels[sy, sx] = current
            while q:
                y, x = q.popleft()
                area += 1
                for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
                    if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and labels[ny, nx] == 0:
                        labels[ny, nx] = current
                        q.append((ny, nx))
            comps.append((current, area, sy * w + int(sx)))
    if not comps:
        return mask
    biggest = max(c[1] for c in comps)
    floor = max(min_ratio * h * w, min_of_largest * biggest)
    keep = {label for label, area, _ in comps if area >= floor}
    return np.isin(labels, list(keep))


def cutout(img: Image.Image, tol: float = 10.0, feather: float = 1.6, despeckle: bool = True) -> tuple[Image.Image, float]:
    rgba = np.array(img.convert("RGBA")).astype(np.int16)
    rgb = rgba[..., :3]
    ref = _border_reference(rgb)
    dist = np.sqrt(((rgb - ref) ** 2).sum(axis=2))
    background = _connected_from_border(dist <= tol)
    removed = float(background.mean())
    alpha = np.where(background, 0, 255).astype(np.uint8)
    if despeckle and removed > 0.02:
        kept = _keep_big_components(alpha > 0)
        alpha = np.where(kept, 255, 0).astype(np.uint8)
    if feather:
        alpha = np.array(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    out = rgba.astype(np.uint8)
    out[..., 3] = alpha
    return Image.fromarray(out), removed


# 被压平的透明棋盘底色。**写死是有意的**：
#   · 这两张源图是把带透明通道的成品导出成了 JPEG，"透明"变成了画上去的棋盘格；
#   · "底色是哪两种颜色"是**交付物的事实**，不是需要猜的东西，写清楚反而不会错；
#   · 自动判据在这两张上都半途而废（详见 cutout_flat 的注释：分簇会被白→浅灰的连续
#     渐变并成一簇；按频率取又会因为浅灰格只占 0.8%、被 JPEG 噪点打散成十几个小桶而漏掉）。
# 男生那张的深灰格是 104（约占图边 12%），女生那张的浅灰格是 204（约占 0.8%）。
# 美工按带 alpha 的 PNG 重出之后，这一条连同 cutout_flat 一起删掉即可。
CHECKER_BACKGROUNDS: dict[str, list[tuple[int, int, int]]] = {
    "day1/男生_被老师批评_紧绷动作.jpg": [(248, 248, 248), (104, 104, 104)],
    "day1/女生_被老师批评_紧绷动作.jpg": [(248, 248, 248), (204, 204, 204)],
}


def cutout_flat(img: Image.Image, refs_with: list[tuple[int, int, int]],
                tol: float = 22.0, feather: float = 1.6) -> tuple[Image.Image, float]:
    """按**显式给出的底色**去背（用于"透明棋盘被压平"的源图）。

    做法：把每格底色（以及它与图边的 8px 邻域的中位数，吸收 JPEG 偏色）当参考色，
    只删"与图边连通 且 接近任一参考色"的像素，最后按连通域面积清一遍碎屑。

    为什么不去猜底色：见 `CHECKER_BACKGROUNDS` 上面的注释。这里只保证"给定底色之后
    去得干净"，识别这一步交给数据。

    为什么要吸收边缘邻域：JPEG 在平坦区会有 ±6 的慢变偏色，纯用标称值会在块的接缝处
    留一行没删掉的像素（棋盘格会变成"虚线格"，比整块留着还难看）。
    """
    rgba = np.array(img.convert("RGBA")).astype(np.int16)
    rgb = rgba[..., :3]
    band = np.concatenate([
        rgb[:8].reshape(-1, 3), rgb[-8:].reshape(-1, 3),
        rgb[:, :8].reshape(-1, 3), rgb[:, -8:].reshape(-1, 3),
    ]).astype(np.float64)
    refs: list[np.ndarray] = [np.array(c, dtype=np.float64) for c in refs_with]
    for c in refs_with:
        near = band[np.sqrt(((band - np.array(c, dtype=np.float64)) ** 2).sum(axis=1)) <= 40]
        if len(near) >= 32:
            refs.append(np.median(near, axis=0))
    cutout_flat.last_refs = refs  # 只给日志看：这一张到底用了哪几种底色
    dist = np.minimum.reduce([np.sqrt(((rgb - r) ** 2).sum(axis=2)) for r in refs])
    background = _connected_from_border(dist <= tol)
    removed = float(background.mean())
    alpha = np.where(background, 0, 255).astype(np.uint8)
    if removed > 0.02:
        kept = _keep_big_components(alpha > 0)
        alpha = np.where(kept, 255, 0).astype(np.uint8)
    if feather:
        alpha = np.array(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(feather)))
    out = rgba.astype(np.uint8)
    out[..., 3] = alpha
    return Image.fromarray(out), removed


def opaque_bbox(im: Image.Image, threshold: int = 16) -> tuple[int, int, int, int] | None:
    a = np.array(im)[..., 3]
    ys, xs = np.where(a > threshold)
    if not len(xs):
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def register_like(img: Image.Image, ref_box: tuple[int, int, int, int],
                  canvas: tuple[int, int]) -> Image.Image:
    """把一张**画布尺寸与同组不一致**的图，按内容缩放并对齐到参考姿态的内容位置。

    为什么需要它：交付里 `男生_正常坐姿_完整课桌.png` 是 512×512、**完全没有 alpha、
    纯白背景**，而同组另外三张都是 912×1216 带 alpha 的抠图。引擎侧所有姿态共用**同一个
    裁剪框**（同一性别共框，否则切换姿态时人物会上下乱跳），而这一个共用框是按 912×1216
    的坐标算出来的 —— 直接把 512×512 塞进去，人物会缩在左上角一小块里（这就是修复前
    画面上那块白底小人）。

    对位基准取**姿态配对的那一张**：`sit` 对 `sitRelax`。同一个角色、同一把椅子、
    同一张桌子，只是坐姿不同，所以"内容等高 + 内容底边中点对齐"就是正确的对位关系。

    这是对交付缺陷的一次性补偿，不是通用能力。正确做法是让美工按 912×1216 重出一张；
    重出之后把 D1_JOBS 里这一条的 mode 改回 "alpha"、去掉 ref 即可。
    """
    box = opaque_bbox(img)
    if not box or not ref_box:
        return img
    ow, oh = img.size
    bw, bh = box[2] - box[0] + 1, box[3] - box[1] + 1
    rh = ref_box[3] - ref_box[1] + 1
    scale = rh / bh
    scaled = img.resize((max(1, round(ow * scale)), max(1, round(oh * scale))), Image.LANCZOS)
    # 缩放后的内容框（左上角 + 尺寸），用来算"该把整张图摆到哪儿"
    sx0, sy0 = round(box[0] * scale), round(box[1] * scale)
    sbw, sbh = round(bw * scale), round(bh * scale)
    ref_cx = (ref_box[0] + ref_box[2]) / 2
    dest = (round(ref_cx - sbw / 2 - sx0), round(ref_box[3] - sbh - sy0))
    out = Image.new("RGBA", canvas, (0, 0, 0, 0))
    out.alpha_composite(scaled, dest)
    return out


def fit_canvas(im: Image.Image, w: int, h: int) -> Image.Image:
    """等比缩放后居中放到 w×h 的透明画布上（绝不拉伸）。"""
    scale = min(w / im.width, h / im.height)
    resized = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(resized, ((w - resized.width) // 2, (h - resized.height) // 2))
    return canvas


def crop_bbox(im: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    x0, y0, x1, y1 = box
    canvas = Image.new("RGBA", (x1 - x0 + 1, y1 - y0 + 1), (0, 0, 0, 0))
    src = im.crop((x0, y0, x1 + 1, y1 + 1))
    canvas.alpha_composite(src)
    return canvas


def expand_to_ratio(box: tuple[int, int, int, int], ratio: float, w: int, h: int) -> tuple[int, int, int, int]:
    """把 bbox 扩成指定宽高比（不越界），保证裁剪后缩放不变形。"""
    x0, y0, x1, y1 = box
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    if bw / bh < ratio:
        bw = bh * ratio
    else:
        bh = bw / ratio
    nx0, ny0 = cx - bw / 2, cy - bh / 2
    nx1, ny1 = cx + bw / 2, cy + bh / 2
    # 越界就整体平移回图内
    if nx0 < 0:
        nx1 -= nx0
        nx0 = 0
    if ny0 < 0:
        ny1 -= ny0
        ny0 = 0
    if nx1 > w:
        nx0 -= nx1 - w
        nx1 = w
    if ny1 > h:
        ny0 -= ny1 - h
        ny1 = h
    return (int(max(0, nx0)), int(max(0, ny0)), int(min(w, nx1)), int(min(h, ny1)))


# ── D1 立绘 ─────────────────────────────────────────────────────────
#
# 交付的三个坑（都已在《待确认问题》里记录）：
#   a) `transparent/男生_平静状态.png` 里画的是**女生**，`女生_平静状态.png` 里画的是**男生** ——
#      两个文件性别写反了。所以下面 boy.calm 取的是"女生"那个文件，girl.calm 取"男生"那个。
#   b) `男生_被批评后低头.png`（对应 D1 的 down 姿态）**里画的是女生** —— 这一张**整张作废**，
#      不导入、也不留旧文件：`art.d1.boy.down` 一旦有文件，`realArt()` 就会用它，
#      于是整周里男生唯一一次"被批评后低头"会显示成一个女生（违反交付说明 §一.2
#      "绝不让男生和女生混进同一条剧情画面"）。删掉之后由引擎的姿态回退链退到 tense
#      （POSE_FALLBACK.down = ['tense','sit']），画面是对的，只是姿态弱一点。
#      女生本来就没有 down，一直走的回退链。
#   c) `*_被老师批评_紧绷动作.jpg` 是带课桌+白底的整幅插画，与其它姿态风格不一致 ——
#      但它**确实被内容引用**（D1_0810 干预窗口的 during），所以不能"不接"，
#      必须先去掉白底再按 sit 对位（见下面的 strain 两条）。
#   d) **第四个坑（本轮才修）**：`男生_正常坐姿_完整课桌.png` 是 512×512、完全没有 alpha、
#      纯白背景，而同组另外三张"完整课桌"都是 912×1216 带 alpha 的抠图。
#      按同一个裁剪框处理之后，画面上是一块**白色矩形 + 缩在左上角的小人**
#      （旧 art.spec.json 把它记成"待返工项"之后一直没人动）。本轮用 mode="white"
#      去白底 + 按 sitRelax 重新对位（见 register_like）。
#
# mode 的四种取值：
#   "cut"     从四边向内连色去背（transparent/ 那一批：带背景的整幅插画）
#   "alpha"   源本身已经是抠图，直接用
#   "white"   纯白底且无 alpha：去背 + 按 ref 姿态重新对位
#   "checker" 底色是**被压平的透明棋盘**（白 + 深灰两格）：按"灰阶 + 与边缘连通"去背，
#             再按 ref 对位

D1_JOBS = [
    ("d1", "boy", "calm", "transparent/女生_平静状态.png", "cut"),
    ("d1", "boy", "tired", "transparent/男生_疲惫状态.png", "cut"),
    ("d1", "boy", "tense", "transparent/男生_紧绷状态.png", "cut"),
    ("d1", "boy", "relax", "transparent/男生_放松状态.png", "cut"),
    ("d1", "boy", "sit", "day1_new/boy/男生_正常坐姿_完整课桌.png", "white", "sitRelax"),
    ("d1", "boy", "sitRelax", "day1_new/boy/男生_放松坐姿_完整课桌.png", "alpha"),
    # strain（被老师批评的紧绷动作）：第一版因为"带课桌、风格不一致"没接，靠 POSE_FALLBACK
    # 退到 tense；但旧导入留下的 art.d1.<who>.strain.jpg 一直在 art/ 里，而 `realArt()` 只认
    # "文件在不在" —— 于是回退根本没发生，画面上用的始终是那张**带白底的压平插画**
    # （真机验收里就是 CG 左边那块白色矩形）。所以这两张必须真的做出来。
    # 底色是被压平的透明棋盘，用 checker 模式。
    ("d1", "boy", "strain", "day1/男生_被老师批评_紧绷动作.jpg", "checker", "sit"),
    ("d1", "girl", "strain", "day1/女生_被老师批评_紧绷动作.jpg", "checker", "sit"),
    ("d1", "girl", "calm", "transparent/男生_平静状态.png", "cut"),
    ("d1", "girl", "tired", "transparent/女生_疲惫状态.png", "cut"),
    ("d1", "girl", "tense", "transparent/女生_紧绷状态.png", "cut"),
    ("d1", "girl", "relax", "transparent/女生_放松状态.png", "cut"),
    ("d1", "girl", "sit", "day1_new/girl/女生_正常坐姿_完整课桌.png", "alpha"),
    ("d1", "girl", "sitRelax", "day1_new/girl/女生_放松坐姿_完整课桌.png", "alpha"),
]

D1_TARGET = (480, 640)

# ── 信号 / VFX ──────────────────────────────────────────────────────

SIGNAL_JOBS = [
    ("signal", "signal.cloud.dark", "03_signals/signal_black_cloud_v1.png", 480, 320, True),
    ("signal", "signal.cloud.gray", "03_signals/signal_gray_cloud_v1.png", 480, 320, True),
    ("signal", "signal.cloud.white", "03_signals/signal_white_cloud_v1.png", 480, 320, True),
    ("signal", "signal.cloud.gold", "03_signals/signal_golden_cloud_v1.png", 480, 320, True),
    ("signal", "signal.zzz", "03_signals/signal_zzz_fragments_v1.png", 480, 320, True),
    ("signal", "signal.redCross", "03_signals/signal_red_cross_v1.png", 256, 256, True),
    ("signal", "signal.isolation", "03_signals/signal_isolation_circle_v1.png", 256, 256, True),
    ("signal", "signal.phone", "03_signals/signal_phone_vibration_v1.png", 256, 256, True),
    ("signal", "signal.arrow", "03_signals/signal_target_arrow_v1.png", 256, 256, True),
    ("signal", "signal.exitHighlight", "03_signals/signal_exit_highlight_v1.png", 256, 256, True),
    ("signal", "vfx.goldenZipper", "03_signals/vfx_golden_zipper_v1.png", 320, 480, True),
    ("signal", "vfx.protectiveHand", "03_signals/vfx_protective_hand_v1.png", 480, 400, True),
]

# ── 校园地图 ────────────────────────────────────────────────────────

MAP_JOBS = [
    ("map", "map.campus.base", CAMPUS_SRC, 1344, 768, False),
]

# ── 行走帧 ──────────────────────────────────────────────────────────

MOVE_DIRS = [("down", "向下"), ("up", "向上"), ("left", "向左"), ("right", "向右")]
MOVE_JOBS = []
for _who, _zh in (("boy", "男生"), ("girl", "女生")):
    _tw, _th = (128, 128) if _who == "boy" else (96, 128)
    for _dir, _dirZh in MOVE_DIRS:
        for _frame in (1, 2):
            MOVE_JOBS.append((
                "move",
                "move.%s.%s.%d" % (_who, _dir, _frame),
                os.path.join(MOVE_SRC, _who, "%s_行走第%d帧.png" % (_dirZh, _frame)),
                _tw, _th, True,
            ))


# ── 执行 ────────────────────────────────────────────────────────────

def save_webp(img: Image.Image, asset_id: str, has_alpha: bool, dry_run: bool) -> float:
    params = dict(quality=WEBP_QUALITY, method=WEBP_METHOD)
    if has_alpha:
        # exact：不让编码器把邻近颜色渗进全透明像素，否则抠图边缘会在亮背景上泛黑边
        params["exact"] = True
    if dry_run:
        buf = io.BytesIO()
        img.save(buf, "WEBP", **params)
        return len(buf.getvalue()) / 1024.0
    out = os.path.join(ART_DIR, asset_id + ".webp")
    img.save(out, "WEBP", **params)
    return os.path.getsize(out) / 1024.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", default="", help="d1 / signal / map / move")
    args = ap.parse_args()
    os.makedirs(ART_DIR, exist_ok=True)

    rows: list[tuple[str, str, str, str, float, float]] = []
    problems: list[str] = []

    def wanted(group: str) -> bool:
        return not args.only or args.only == group

    # ---- D1 ----
    if wanted("d1"):
        for who in ("boy", "girl"):
            jobs = [j for j in D1_JOBS if j[1] == who]
            staged: dict[str, Image.Image] = {}
            channels: dict[str, str] = {}
            src_kb: dict[str, float] = {}
            refs: dict[str, str] = {}
            for job in jobs:
                _group, _who, pose, rel, mode = job[:5]
                refs[pose] = job[5] if len(job) > 5 else ""
                path = os.path.join(DAY1_PACK, rel.replace("/", os.sep))
                if not os.path.exists(path):
                    problems.append("MISSING  art.d1.%s.%s  (%s)" % (who, pose, rel))
                    continue
                src_kb[pose] = os.path.getsize(path) / 1024.0
                with Image.open(path) as opened:
                    size = "%dx%d" % opened.size
                    img = ImageOps.exif_transpose(opened).convert("RGBA")
                if mode == "cut":
                    img, removed = cutout(img)
                    channels[pose] = "%s 抠图去背 %.0f%%" % (size, removed * 100)
                elif mode == "white":
                    # 纯白底容差要**收紧**（6 而不是 10）：再松一点就会顺着白校服漏进去，
                    # 把人物身上挖出一片洞。去背之后仍然按 ref 重新对位。
                    img, removed = cutout(img, tol=6.0)
                    channels[pose] = "%s 白底去背 %.0f%%" % (size, removed * 100)
                elif mode == "checker":
                    # 注意别把这个局部变量叫 refs —— 外层 refs 是"姿态 → 对位参考姿态"的映射，
                    # 覆盖掉之后下面 refs.items() 会炸（真炸过一次）。
                    bg_refs = CHECKER_BACKGROUNDS.get(rel.replace("\\", "/"))
                    if not bg_refs:
                        problems.append("checker 模式但没登记底色：%s（见 CHECKER_BACKGROUNDS）" % rel)
                        continue
                    img, removed = cutout_flat(img, bg_refs)
                    channels[pose] = "%s 棋盘底去背 %.0f%%" % (size, removed * 100)
                    print("  checker %s.%s refs=%s" % (who, pose, [[int(v) for v in r] for r in cutout_flat.last_refs]))
                else:
                    channels[pose] = "%s 源即抠图" % size
                staged[pose] = img

            # 先算一遍内容框：ref 姿态的对位要用到它
            boxes = {p: opaque_bbox(im) for p, im in staged.items()}
            for pose, ref in refs.items():
                if not ref or ref not in staged or boxes.get(ref) is None or boxes.get(pose) is None:
                    continue
                before = boxes[pose]
                staged[pose] = register_like(staged[pose], boxes[ref], staged[ref].size)
                boxes[pose] = opaque_bbox(staged[pose])
                channels[pose] += " → 按 %s 对位" % ref
                print("  register %s onto %s: %s -> %s, canvas %s"
                      % (pose, ref, before, boxes[pose], staged[ref].size))

            good = [b for b in boxes.values() if b]
            if not good:
                continue
            union = (
                min(b[0] for b in good), min(b[1] for b in good),
                max(b[2] for b in good), max(b[3] for b in good),
            )
            # 同一性别所有姿态共用同一个裁剪框：否则人物会在姿态切换时上下乱跳
            pad_x = int((union[2] - union[0]) * 0.04) + 6
            pad_y = int((union[3] - union[1]) * 0.04) + 6
            union = (union[0] - pad_x, union[1] - pad_y, union[2] + pad_x, union[3] + pad_y)
            frame = expand_to_ratio(union, D1_TARGET[0] / D1_TARGET[1], 10 ** 6, 10 ** 6)
            for pose, img in staged.items():
                final = crop_bbox(img, frame).resize(D1_TARGET, Image.LANCZOS)
                asset_id = "art.d1.%s.%s" % (who, pose)
                kb = save_webp(final, asset_id, True, args.dry_run)
                rows.append((asset_id, channels.get(pose, ""), "alpha", "%dx%d" % D1_TARGET, src_kb.get(pose, 0.0), kb))

    # ---- signals / map / move ----
    def simple_jobs(jobs, group: str, base: str):
        if not wanted(group):
            return
        for _g, asset_id, rel, tw, th, has_alpha in jobs:
            path = rel if os.path.isabs(rel) else os.path.join(base, rel.replace("/", os.sep))
            if not os.path.exists(path):
                problems.append("MISSING  %s  (%s)" % (asset_id, rel))
                continue
            with Image.open(path) as opened:
                img = ImageOps.exif_transpose(opened)
                sw, sh = img.size
                work = img.convert("RGBA") if has_alpha else img.convert("RGB")
                final = fit_canvas(work, tw, th) if has_alpha else work.resize((tw, th), Image.LANCZOS)
                kb = save_webp(final, asset_id, has_alpha, args.dry_run)
            rows.append((asset_id, "%dx%d" % (sw, sh), "alpha" if has_alpha else "opaque",
                         "%dx%d" % (tw, th), os.path.getsize(path) / 1024.0, kb))

    simple_jobs(SIGNAL_JOBS, "signal", SCENE_PACK)
    simple_jobs(MAP_JOBS, "map", "")
    simple_jobs(MOVE_JOBS, "move", "")

    print("%-34s %-11s %-12s %-11s %9s %9s" % ("AssetId", "source", "channel", "target", "src KB", "out KB"))
    for asset_id, src, ch, tgt, kb0, kb1 in rows:
        print("%-34s %-11s %-12s %-11s %9.1f %9.1f" % (asset_id, src, ch, tgt, kb0, kb1))

    total = sum(r[5] for r in rows if r[5])
    print("\n%d file(s) written, %.2f MB in art/ (base64 inlined x1.33 => +%.2f MB in dist)"
          % (len([r for r in rows if r[5]]), total / 1024.0, total * 1.33 / 1024.0))
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
