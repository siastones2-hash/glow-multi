#!/usr/bin/env python3
"""3D어라운드 Instagram creatives — site-led, not same navy title card."""
from __future__ import annotations

import os
import random
from pathlib import Path
from typing import Callable

from PIL import Image, ImageDraw, ImageFont

W = H = 1080

# Cool brand (avoid purple / cream-terracotta AI defaults)
NAVY = "#0B1C2E"
NAVY2 = "#163A5C"
INK = "#0A1628"
SKY = "#3EC6FF"
MINT = "#5EEAD4"
FOG = "#E8EEF5"
SLATE = "#94A3B8"
WHITE = "#FFFFFF"
SOFT = "#F4F7FB"
LINE = "#1E3A5F"

ASSETS = Path(__file__).resolve().parents[1] / "assets" / "photos"


def list_stock_photos() -> list[Path]:
    if not ASSETS.exists():
        return []
    files = sorted(ASSETS.glob("stock-*.jpg")) + sorted(ASSETS.glob("stock-*.jpeg"))
    files += sorted(ASSETS.glob("stock-*.png"))
    # also allow user-dropped real photos (not glow-ig / ad design graphics)
    for p in ASSETS.iterdir():
        if not p.is_file():
            continue
        if p.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
            continue
        name = p.name.lower()
        if name.startswith(("glow-ig", "ad-post", "profile", "readme")):
            continue
        if p not in files:
            files.append(p)
    return files


def pick_photo(used_ordered: list[str] | None = None) -> Path | None:
    """Prefer never-used stock; when all used, least-recently-used (no short-term repeats)."""
    photos = list_stock_photos()
    if not photos:
        return None
    used = list(used_ordered or [])
    used_set = set(used)
    by_name = {p.name: p for p in photos}
    fresh = [p for p in photos if p.name not in used_set]
    if fresh:
        return random.choice(fresh)
    # all used at least once — pick oldest still on disk, then caller appends to end
    for name in used:
        if name in by_name:
            return by_name[name]
    return random.choice(photos)


def remember_photo_use(used_ordered: list[str], photo_name: str, keep: int = 200) -> list[str]:
    """Append photo to used history (move to end if already present)."""
    out = [n for n in used_ordered if n != photo_name]
    out.append(photo_name)
    return out[-keep:]


def square_cover(path: Path) -> Image.Image:
    im = Image.open(path).convert("RGB")
    w, h = im.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    if w > side:
        left = max(0, min(w - side, left + random.randint(-side // 10, side // 10)))
    if h > side:
        top = max(0, min(h - side, top + random.randint(-side // 10, side // 10)))
    im = im.crop((left, top, left + side, top + side)).resize((W, H), Image.Resampling.LANCZOS)
    return enhance_photo(im)


def enhance_photo(img: Image.Image) -> Image.Image:
    """Slight editorial grade — richer, not flat phone dump."""
    from PIL import ImageEnhance

    img = ImageEnhance.Contrast(img).enhance(1.1)
    img = ImageEnhance.Color(img).enhance(1.06)
    img = ImageEnhance.Brightness(img).enhance(0.97)
    img = ImageEnhance.Sharpness(img).enhance(1.12)
    return img


def apply_rgba(base: Image.Image, overlay: Image.Image) -> Image.Image:
    return Image.alpha_composite(base.convert("RGBA"), overlay).convert("RGB")


def gradient_band(
    w: int,
    h: int,
    *,
    from_top: bool = False,
    color: tuple[int, int, int] = (0, 0, 0),
    max_alpha: int = 200,
    band: int | None = None,
) -> Image.Image:
    """Fast row-based gradient (not per-pixel nested loops)."""
    band = band or int(h * 0.48)
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for i in range(band):
        t = i / max(band - 1, 1)
        # ease-in
        t = t * t
        a = int(max_alpha * t)
        y = i if from_top else (h - 1 - i)
        draw.line([(0, y), (w, y)], fill=(*color, a))
    return overlay


def soft_vignette(img: Image.Image, strength: int = 70) -> Image.Image:
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    # concentric soft rings — cheap vignette
    for i in range(12):
        a = int(strength * (i + 1) / 12)
        m = int(40 + i * 28)
        draw.rectangle([m, m, W - m, H - m], outline=(0, 0, 0, a), width=28)
    return apply_rgba(img, overlay)


def draw_text_shadow(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    f: ImageFont.ImageFont,
    fill,
    *,
    anchor: str = "lm",
    shadow: tuple[int, int, int] = (0, 0, 0),
    shadow_a: int = 140,
) -> None:
    x, y = xy
    # soft shadow stack
    for dx, dy, a in ((2, 2, shadow_a), (1, 1, shadow_a // 2)):
        draw.text((x + dx, y + dy), text, fill=(*shadow, a) if False else shadow, font=f, anchor=anchor)
    draw.text((x, y), text, fill=fill, font=f, anchor=anchor)


def draw_headline_block(
    draw: ImageDraw.ImageDraw,
    headline: str,
    sub: str,
    *,
    y: int,
    fill=(255, 255, 255),
    sub_fill=(210, 225, 235),
    align: str = "lm",
    max_w: int = 860,
    size: int = 48,
    shadow: bool = True,
) -> int:
    """Draw headline; returns y after last line."""
    # keep image text short & readable
    headline = (headline or "").strip()
    if len(headline) > 22:
        # prefer natural break
        for sep in (" ", "·", ","):
            if sep in headline[:22]:
                cut = headline[:22].rfind(sep)
                if cut > 8:
                    headline = headline[:cut]
                    break
        else:
            headline = headline[:20]
    f = font(size, True)
    x = 540 if align == "mm" else (80 if align.endswith("m") or align == "lm" else 80)
    if align == "rm":
        x = 1000
    lines = wrap(draw, headline, f, max_w)[:3]
    use_shadow = shadow and (
        fill == (255, 255, 255)
        or (isinstance(fill, tuple) and len(fill) >= 3 and fill[0] > 200 and fill[1] > 200)
    )
    for line in lines:
        if use_shadow:
            draw.text((x + 2, y + 2), line, fill=(0, 0, 0), font=f, anchor=align)
        draw.text((x, y), line, fill=fill, font=f, anchor=align)
        y += int(size * 1.22)
    if sub:
        sf = font(22)
        if use_shadow:
            draw.text((x + 1, y + 18), sub, fill=(0, 0, 0), font=sf, anchor=align)
        draw.text((x, y + 16), sub, fill=sub_fill, font=sf, anchor=align)
        y += 50
    return y


def accent_bar(draw: ImageDraw.ImageDraw, x: int, y: int, w: int = 72, color=SKY) -> None:
    draw.rounded_rectangle([x, y, x + w, y + 6], radius=3, fill=hex_rgb(color))


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = h.lstrip("#")
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def font(size: int, bold: bool = False) -> ImageFont.ImageFont:
    # 한글 필수 — Arial을 먼저 쓰면 □(tofu)로 깨짐
    cands = [
        "/System/Library/Fonts/AppleSDGothicNeo.ttc",
        "/System/Library/Fonts/Supplemental/AppleGothic.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/AppleMyungjo.ttf",
        "/System/Library/Fonts/Helvetica.ttc",
    ]
    for p in cands:
        if not os.path.exists(p):
            continue
        try:
            # TTC: try a few faces (bold-ish indices when requested)
            if p.endswith(".ttc"):
                for idx in ([3, 6, 0, 1] if bold else [0, 1, 2]):
                    try:
                        return ImageFont.truetype(p, size, index=idx)
                    except Exception:
                        continue
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def fill_vgrad(draw: ImageDraw.ImageDraw, c0: str, c1: str) -> None:
    a, b = hex_rgb(c0), hex_rgb(c1)
    for y in range(H):
        t = y / (H - 1)
        rgb = tuple(int(a[i] * (1 - t) + b[i] * t) for i in range(3))
        draw.line([(0, y), (W, y)], fill=rgb)


def text_w(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.ImageFont) -> int:
    box = draw.textbbox((0, 0), text, font=f)
    return box[2] - box[0]


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.ImageFont, max_w: int) -> list[str]:
    """Wrap Korean + English. Prefer breaks at spaces / · / 、 before mid-word."""
    text = (text or "").strip()
    if not text:
        return [""]

    # tokenize: keep spaces/punctuation as soft break points
    tokens: list[str] = []
    buf = ""
    for ch in text:
        if ch in " \t·、,/|/":
            if buf:
                tokens.append(buf)
                buf = ""
            tokens.append(ch)
        else:
            buf += ch
    if buf:
        tokens.append(buf)

    lines: list[str] = []
    cur = ""
    for tok in tokens:
        trial = cur + tok
        if cur and text_w(draw, trial, f) > max_w:
            # if single long token overflows, hard-split by char
            if not cur.strip():
                chunk = ""
                for ch in tok:
                    t2 = chunk + ch
                    if chunk and text_w(draw, t2, f) > max_w:
                        lines.append(chunk)
                        chunk = ch
                    else:
                        chunk = t2
                cur = chunk
            else:
                lines.append(cur.rstrip())
                cur = tok.lstrip() if tok in " \t" else tok
        else:
            cur = trial
    if cur.strip():
        lines.append(cur.rstrip())
    return lines or [text]


def draw_quiet_footer(draw: ImageDraw.ImageDraw, y: int = 1000) -> None:
    """Tiny brand mark only — no URL / CTA button."""
    draw.text((540, y), "3D", fill=hex_rgb(SLATE), font=font(20), anchor="mm")


def draw_brand_mark(draw: ImageDraw.ImageDraw, x: int, y: int, size: int = 64) -> None:
    r = size // 2
    draw.ellipse([x - r, y - r, x + r, y + r], fill=hex_rgb(SKY))
    draw.text((x, y), "G", fill=hex_rgb(INK), font=font(int(size * 0.7), True), anchor="mm")


# --- layouts (note / diary tone — no sell buttons, no URL pills) ---

def layout_hero_brand(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    fill_vgrad(draw, INK, NAVY2)
    draw_brand_mark(draw, 140, 140, 88)
    draw.text((210, 140), "3D", fill=hex_rgb(WHITE), font=font(42, True), anchor="lm")
    draw.text((210, 180), "운영 메모", fill=hex_rgb(SLATE), font=font(22), anchor="lm")
    f = font(56, True)
    y = 360
    for line in wrap(draw, headline, f, 860):
        draw.text((540, y), line, fill=hex_rgb(WHITE), font=f, anchor="mm")
        y += 72
    draw.text((540, y + 30), sub, fill=hex_rgb(MINT), font=font(28), anchor="mm")
    draw_quiet_footer(draw, 1000)


def layout_three_pillars(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb(SOFT))
    draw.rectangle([0, 0, W, 220], fill=hex_rgb(NAVY))
    draw.text((80, 90), "3D", fill=hex_rgb(WHITE), font=font(36, True), anchor="lm")
    draw.text((80, 145), headline[:28], fill=hex_rgb(SKY), font=font(28), anchor="lm")
    cards = [
        ("01", "자리", "다시 찾아올\n주소가 있나"),
        ("02", "창구", "문의가 한곳에\n모이나"),
        ("03", "흐름", "응대가 끊기지\n않나"),
    ]
    xs = [70, 390, 710]
    for i, (num, title, body) in enumerate(cards):
        x = xs[i]
        draw.rounded_rectangle([x, 280, x + 290, 780], radius=24, fill=hex_rgb(WHITE), outline=hex_rgb("#D6DEE8"), width=2)
        draw.text((x + 145, 340), num, fill=hex_rgb(SKY), font=font(28, True), anchor="mm")
        draw.text((x + 145, 420), title, fill=hex_rgb(INK), font=font(30, True), anchor="mm")
        by = 500
        for bl in body.split("\n"):
            draw.text((x + 145, by), bl, fill=hex_rgb(SLATE), font=font(22), anchor="mm")
            by += 36
    draw.text((540, 860), sub, fill=hex_rgb(NAVY2), font=font(26), anchor="mm")
    draw_quiet_footer(draw, 980)


def layout_big_url(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    # renamed conceptually: quiet note card (kept key "url" for pool hints)
    fill_vgrad(draw, NAVY, INK)
    draw.text((540, 200), "메모", fill=hex_rgb(MINT), font=font(26), anchor="mm")
    f = font(48, True)
    y = 340
    for line in wrap(draw, headline, f, 860):
        draw.text((540, y), line, fill=hex_rgb(WHITE), font=f, anchor="mm")
        y += 62
    draw.rounded_rectangle([280, y + 20, 800, y + 28], radius=2, fill=hex_rgb(SKY))
    draw.text((540, y + 100), sub, fill=hex_rgb(SLATE), font=font(26), anchor="mm")
    draw_brand_mark(draw, 540, 980, 56)


def layout_split(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, 500, H], fill=hex_rgb(INK))
    draw.rectangle([500, 0, W, H], fill=hex_rgb(SOFT))
    draw_brand_mark(draw, 250, 200, 100)
    draw.text((250, 320), "3D", fill=hex_rgb(WHITE), font=font(48, True), anchor="mm")
    draw.text((250, 390), "오늘 생각", fill=hex_rgb(SKY), font=font(30), anchor="mm")
    draw.text((250, 980), "짧게 남김", fill=hex_rgb(SLATE), font=font(22), anchor="mm")
    f = font(40, True)
    y = 220
    for line in wrap(draw, headline, f, 480):
        draw.text((790, y), line, fill=hex_rgb(INK), font=f, anchor="mm")
        y += 56
    bullets = [
        "· 집이 있나",
        "· 창구가 흩어졌나",
        "· 혼자 막혔나",
        "· 흐름이 끊겼나",
    ]
    y = 480
    for b in bullets:
        draw.text((790, y), b, fill=hex_rgb(NAVY2), font=font(28), anchor="mm")
        y += 58
    draw.text((790, 820), sub, fill=hex_rgb(SLATE), font=font(24), anchor="mm")


def layout_browser_mock(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#0E1A28"))
    draw.rounded_rectangle([70, 120, 1010, 920], radius=20, fill=hex_rgb(SOFT))
    draw.rounded_rectangle([70, 120, 1010, 190], radius=20, fill=hex_rgb("#DCE4EE"))
    draw.rectangle([70, 170, 1010, 190], fill=hex_rgb("#DCE4EE"))
    for i, col in enumerate(["#FF5F57", "#FEBC2E", "#28C840"]):
        draw.ellipse([100 + i * 36, 145, 118 + i * 36, 163], fill=hex_rgb(col))
    draw.rounded_rectangle([220, 140, 920, 170], radius=10, fill=hex_rgb(WHITE))
    draw.text((570, 155), "notes / today", fill=hex_rgb(NAVY2), font=font(20), anchor="mm")
    draw.text((540, 280), "3D", fill=hex_rgb(NAVY), font=font(28, True), anchor="mm")
    f = font(44, True)
    y = 380
    for line in wrap(draw, headline, f, 820):
        draw.text((540, y), line, fill=hex_rgb(INK), font=f, anchor="mm")
        y += 58
    draw.text((540, 580), sub, fill=hex_rgb(SLATE), font=font(26), anchor="mm")
    draw.text((540, 720), "그냥 적어둔 메모", fill=hex_rgb(NAVY2), font=font(24), anchor="mm")
    draw_quiet_footer(draw, 1000)


def layout_checklist(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    fill_vgrad(draw, NAVY2, INK)
    draw.text((80, 100), "CHECK", fill=hex_rgb(SKY), font=font(24, True), anchor="lm")
    f = font(44, True)
    y = 180
    for line in wrap(draw, headline, f, 900):
        draw.text((80, y), line, fill=hex_rgb(WHITE), font=f, anchor="lm")
        y += 58
    items = [
        "다시 찾을 주소가 있나",
        "문의가 한곳으로 모이나",
        "같은 설명을 세 번 쓰나",
        "막힐 때 물어볼 사람이 있나",
    ]
    y = 420
    for item in items:
        draw.rounded_rectangle([80, y, 1000, y + 90], radius=16, fill=hex_rgb("#12283C"))
        draw.ellipse([110, y + 28, 150, y + 68], outline=hex_rgb(MINT), width=3)
        draw.line([(122, y + 48), (132, y + 58), (148, y + 38)], fill=hex_rgb(MINT), width=3)
        draw.text((180, y + 45), item, fill=hex_rgb(FOG), font=font(28), anchor="lm")
        y += 110
    draw.text((540, 1000), sub or "운영 메모", fill=hex_rgb(SLATE), font=font(22), anchor="mm")


def layout_quote(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb(SOFT))
    draw.rectangle([0, 0, 28, H], fill=hex_rgb(SKY))
    draw.text((100, 160), "“", fill=hex_rgb(SKY), font=font(120, True), anchor="lm")
    f = font(48, True)
    y = 280
    for line in wrap(draw, headline, f, 860):
        draw.text((100, y), line, fill=hex_rgb(INK), font=f, anchor="lm")
        y += 66
    draw.text((100, y + 40), f"— {sub or '3D'}", fill=hex_rgb(NAVY2), font=font(28), anchor="lm")
    draw_brand_mark(draw, 920, 920, 72)


def layout_terminal(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#071018"))
    draw.rounded_rectangle([60, 140, 1020, 900], radius=18, fill=hex_rgb("#0D1B2A"), outline=hex_rgb(LINE), width=2)
    draw.rounded_rectangle([60, 140, 1020, 210], radius=18, fill=hex_rgb("#12263A"))
    draw.rectangle([60, 190, 1020, 210], fill=hex_rgb("#12263A"))
    for i, col in enumerate(["#FF5F57", "#FEBC2E", "#28C840"]):
        draw.ellipse([90 + i * 34, 162, 106 + i * 34, 178], fill=hex_rgb(col))
    draw.text((540, 175), "glow — notes", fill=hex_rgb(SLATE), font=font(20), anchor="mm")
    lines = [
        ("> think.home", "다시 올 자리"),
        ("> think.inbox", "문의 창구"),
        ("> think.flow", "끊기지 않기"),
        ("> think.pace", "천천히"),
    ]
    y = 280
    for cmd, st in lines:
        draw.text((110, y), cmd, fill=hex_rgb(MINT), font=font(26), anchor="lm")
        draw.text((620, y), st, fill=hex_rgb(SKY), font=font(26), anchor="lm")
        y += 70
    draw.text((110, y + 40), headline[:40], fill=hex_rgb(WHITE), font=font(32, True), anchor="lm")
    draw.text((110, y + 100), sub, fill=hex_rgb(SLATE), font=font(24), anchor="lm")
    draw_quiet_footer(draw, 1000)


def layout_magazine(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb(WHITE))
    draw.rectangle([0, 0, W, 18], fill=hex_rgb(INK))
    draw.text((80, 80), "3D  ·  NOTE", fill=hex_rgb(SKY), font=font(22, True), anchor="lm")
    draw.rectangle([80, 120, 280, 126], fill=hex_rgb(INK))
    f = font(64, True)
    y = 200
    for line in wrap(draw, headline, f, 900):
        draw.text((80, y), line, fill=hex_rgb(INK), font=f, anchor="lm")
        y += 80
    draw.text((80, y + 40), sub, fill=hex_rgb(SLATE), font=font(28), anchor="lm")
    draw.rectangle([80, 820, 1000, 920], fill=hex_rgb(INK))
    draw.text((540, 870), "오늘은 여기까지", fill=hex_rgb(FOG), font=font(28), anchor="mm")


def layout_mint_card(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    fill_vgrad(draw, "#0F766E", "#134E4A")
    draw.rounded_rectangle([70, 160, 1010, 860], radius=32, fill=hex_rgb(WHITE))
    draw.text((540, 240), "3D", fill=hex_rgb("#0F766E"), font=font(28, True), anchor="mm")
    f = font(48, True)
    y = 360
    for line in wrap(draw, headline, f, 820):
        draw.text((540, y), line, fill=hex_rgb(INK), font=f, anchor="mm")
        y += 62
    draw.text((540, 660), sub, fill=hex_rgb(SLATE), font=font(26), anchor="mm")
    draw.text((540, 780), "천천히 보면 됨", fill=hex_rgb("#0F766E"), font=font(24), anchor="mm")


def layout_bold_type(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#F8FAFC"))
    draw.ellipse([-200, -200, 500, 500], fill=hex_rgb("#DBEAFE"))
    draw.ellipse([700, 700, 1300, 1300], fill=hex_rgb("#CCFBF1"))
    words = headline.split()
    top = " ".join(words[:2]) if len(words) > 2 else headline
    rest = " ".join(words[2:]) if len(words) > 2 else sub
    draw.text((80, 280), top[:18], fill=hex_rgb(INK), font=font(92, True), anchor="lm")
    f = font(40, True)
    y = 420
    for line in wrap(draw, rest or sub, f, 900):
        draw.text((80, y), line, fill=hex_rgb(NAVY2), font=f, anchor="lm")
        y += 54
    draw.text((80, 920), "3D", fill=hex_rgb("#0F766E"), font=font(26, True), anchor="lm")


def layout_night_neon(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#020617"))
    draw.ellipse([600, -100, 1200, 500], outline=hex_rgb("#22D3EE"), width=3)
    draw.ellipse([-100, 600, 500, 1200], outline=hex_rgb("#34D399"), width=2)
    draw.text((100, 140), "3D", fill=hex_rgb("#22D3EE"), font=font(28, True), anchor="lm")
    f = font(52, True)
    y = 320
    for line in wrap(draw, headline, f, 880):
        draw.text((100, y), line, fill=hex_rgb(WHITE), font=f, anchor="lm")
        y += 68
    draw.text((100, y + 40), sub, fill=hex_rgb("#94A3B8"), font=font(28), anchor="lm")
    draw_quiet_footer(draw, 980)


def layout_stat_row(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb(SOFT))
    draw.rectangle([0, 0, W, 360], fill=hex_rgb(INK))
    draw.text((540, 120), "오늘 메모", fill=hex_rgb(SKY), font=font(24, True), anchor="mm")
    f = font(44, True)
    y = 190
    for line in wrap(draw, headline, f, 900):
        draw.text((540, y), line, fill=hex_rgb(WHITE), font=f, anchor="mm")
        y += 56
    stats = [("자리", "다시 올 곳"), ("창구", "한곳으로"), ("속도", "덜 헷갈리게")]
    xs = [90, 400, 710]
    for i, (a, b) in enumerate(stats):
        x = xs[i]
        draw.rounded_rectangle([x, 440, x + 270, 720], radius=20, fill=hex_rgb(WHITE))
        draw.text((x + 135, 520), a, fill=hex_rgb(INK), font=font(36, True), anchor="mm")
        draw.text((x + 135, 600), b, fill=hex_rgb(SLATE), font=font(24), anchor="mm")
    draw.text((540, 820), sub, fill=hex_rgb(NAVY2), font=font(26), anchor="mm")
    draw_quiet_footer(draw, 980)


def layout_lined_paper(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#F7F4EC"))
    draw.rectangle([0, 0, 90, H], fill=hex_rgb("#E8DFD0"))
    for y in range(160, 1000, 54):
        draw.line([(110, y), (1000, y)], fill=hex_rgb("#D6CBB8"), width=1)
    draw.text((120, 100), "메모", fill=hex_rgb("#8B7355"), font=font(22), anchor="lm")
    f = font(44, True)
    y = 200
    for line in wrap(draw, headline, f, 820):
        draw.text((120, y), line, fill=hex_rgb("#2C2416"), font=f, anchor="lm")
        y += 54
    draw.text((120, y + 40), sub, fill=hex_rgb("#8B7355"), font=font(26), anchor="lm")
    draw.text((960, 1000), "3D", fill=hex_rgb("#A89880"), font=font(18), anchor="rm")


def layout_big_number(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    fill_vgrad(draw, "#0B1220", "#1A2740")
    n = random.choice(["01", "02", "03", "07", "12", "24"])
    draw.text((80, 120), n, fill=hex_rgb("#1E3A5F"), font=font(220, True), anchor="lm")
    f = font(48, True)
    y = 420
    for line in wrap(draw, headline, f, 900):
        draw.text((80, y), line, fill=hex_rgb(WHITE), font=f, anchor="lm")
        y += 62
    draw.text((80, y + 30), sub, fill=hex_rgb(MINT), font=font(26), anchor="lm")
    draw_quiet_footer(draw, 1000)


def layout_diagonal(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#E8F4F8"))
    # diagonal band
    pts = [(0, 200), (W, 0), (W, 420), (0, 620)]
    draw.polygon(pts, fill=hex_rgb(NAVY))
    f = font(48, True)
    y = 700
    for line in wrap(draw, headline, f, 900):
        draw.text((80, y), line, fill=hex_rgb(INK), font=f, anchor="lm")
        y += 60
    draw.text((80, 180), "3D", fill=hex_rgb(SKY), font=font(28, True), anchor="lm")
    draw.text((80, y + 20), sub, fill=hex_rgb(SLATE), font=font(24), anchor="lm")


def layout_circle_focus(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#F0F7FA"))
    draw.ellipse([140, 180, 940, 980], fill=hex_rgb(NAVY))
    draw.ellipse([200, 240, 880, 920], outline=hex_rgb(SKY), width=2)
    f = font(40, True)
    y = 420
    for line in wrap(draw, headline, f, 560):
        draw.text((540, y), line, fill=hex_rgb(WHITE), font=f, anchor="mm")
        y += 54
    draw.text((540, y + 30), sub, fill=hex_rgb(MINT), font=font(24), anchor="mm")
    draw.text((540, 140), "3D", fill=hex_rgb(NAVY2), font=font(24, True), anchor="mm")


def layout_postcard(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#1C2B3A"))
    draw.rounded_rectangle([70, 90, 1010, 990], radius=8, fill=hex_rgb("#FAFAF7"), outline=hex_rgb("#CBD5E1"), width=2)
    draw.line([(540, 140), (540, 940)], fill=hex_rgb("#E2E8F0"), width=2)
    # stamp
    draw.rounded_rectangle([820, 130, 960, 270], radius=6, outline=hex_rgb("#94A3B8"), width=2)
    draw.text((890, 200), "G", fill=hex_rgb(SKY), font=font(48, True), anchor="mm")
    f = font(36, True)
    y = 200
    for line in wrap(draw, headline, f, 400):
        draw.text((120, y), line, fill=hex_rgb(INK), font=f, anchor="lm")
        y += 48
    draw.text((120, y + 40), sub, fill=hex_rgb(SLATE), font=font(22), anchor="lm")
    draw.text((700, 500), "to.", fill=hex_rgb(SLATE), font=font(22), anchor="lm")
    draw.text((700, 560), "내일의 나", fill=hex_rgb(NAVY2), font=font(28), anchor="lm")


def layout_chat_bubbles(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    fill_vgrad(draw, "#0F172A", "#1E293B")
    draw.text((80, 80), "대화 메모", fill=hex_rgb(SLATE), font=font(22), anchor="lm")
    parts = wrap(draw, headline, font(32), 620)
    # left bubble
    left = " ".join(parts[:2]) if parts else headline
    draw.rounded_rectangle([80, 200, 720, 380], radius=28, fill=hex_rgb("#334155"))
    draw.text((140, 290), left[:28], fill=hex_rgb(WHITE), font=font(28), anchor="lm")
    # right bubble
    right = " ".join(parts[2:4]) if len(parts) > 2 else sub
    draw.rounded_rectangle([360, 440, 1000, 620], radius=28, fill=hex_rgb(SKY))
    draw.text((940, 530), (right or "…")[:26], fill=hex_rgb(INK), font=font(28), anchor="rm")
    # small
    draw.rounded_rectangle([80, 700, 640, 820], radius=24, fill=hex_rgb("#1E293B"), outline=hex_rgb(LINE), width=2)
    draw.text((120, 760), sub or "오늘은 여기까지", fill=hex_rgb(FOG), font=font(24), anchor="lm")
    draw_quiet_footer(draw, 980)


def layout_film_strip(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#111111"))
    draw.rectangle([0, 80, W, 1000], fill=hex_rgb("#1A1A1A"))
    for x in range(40, 1040, 70):
        draw.rounded_rectangle([x, 100, x + 36, 140], radius=4, fill=hex_rgb("#0A0A0A"))
        draw.rounded_rectangle([x, 940, x + 36, 980], radius=4, fill=hex_rgb("#0A0A0A"))
    draw.rounded_rectangle([100, 200, 980, 860], radius=12, fill=hex_rgb("#0B1C2E"))
    f = font(44, True)
    y = 360
    for line in wrap(draw, headline, f, 780):
        draw.text((540, y), line, fill=hex_rgb(WHITE), font=f, anchor="mm")
        y += 58
    draw.text((540, y + 40), sub, fill=hex_rgb(MINT), font=font(24), anchor="mm")
    draw.text((540, 240), "FRAME", fill=hex_rgb(SLATE), font=font(20), anchor="mm")


def layout_sticky(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#2D3748"))
    colors = ["#FEF08A", "#BBF7D0", "#BAE6FD", "#FBCFE8"]
    # background sticks
    draw.rounded_rectangle([120, 140, 520, 480], radius=8, fill=hex_rgb(colors[0]))
    draw.rounded_rectangle([560, 200, 960, 540], radius=8, fill=hex_rgb(colors[1]))
    draw.rounded_rectangle([200, 560, 880, 960], radius=12, fill=hex_rgb(colors[2]))
    f = font(40, True)
    y = 640
    for line in wrap(draw, headline, f, 580):
        draw.text((540, y), line, fill=hex_rgb(INK), font=f, anchor="mm")
        y += 52
    draw.text((540, y + 20), sub, fill=hex_rgb(NAVY2), font=font(24), anchor="mm")
    draw.text((180, 220), "?", fill=hex_rgb("#854D0E"), font=font(64, True), anchor="mm")
    draw.text((760, 320), "ok", fill=hex_rgb("#166534"), font=font(40, True), anchor="mm")


def layout_sunrise(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    # cool dawn — not cream/terracotta
    fill_vgrad(draw, "#0B1C2E", "#3B82F6")
    draw.ellipse([290, 520, 790, 1020], fill=hex_rgb("#93C5FD"))
    draw.ellipse([340, 570, 740, 970], fill=hex_rgb("#DBEAFE"))
    f = font(46, True)
    y = 180
    for line in wrap(draw, headline, f, 880):
        draw.text((540, y), line, fill=hex_rgb(WHITE), font=f, anchor="mm")
        y += 60
    draw.text((540, y + 20), sub, fill=hex_rgb("#BFDBFE"), font=font(26), anchor="mm")
    draw.text((80, 1000), "3D", fill=hex_rgb("#93C5FD"), font=font(20), anchor="lm")


def layout_vertical_stack(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb(WHITE))
    bands = [NAVY, NAVY2, "#1E4D6B", "#0F766E"]
    parts = wrap(draw, headline, font(36, True), 900) or [headline]
    # pad to 4
    while len(parts) < 4:
        parts.append("")
    for i in range(4):
        y0, y1 = i * 270, (i + 1) * 270
        draw.rectangle([0, y0, W, y1], fill=hex_rgb(bands[i]))
        txt = parts[i] if parts[i] else (sub if i == 3 else "·")
        draw.text((80, y0 + 135), txt[:22], fill=hex_rgb(WHITE), font=font(36, True), anchor="lm")
    draw.text((980, 40), "3D", fill=hex_rgb(SKY), font=font(18), anchor="rm")


def layout_dot_grid(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#0A1628"))
    for x in range(40, 1080, 40):
        for y in range(40, 1080, 40):
            draw.ellipse([x - 1, y - 1, x + 1, y + 1], fill=hex_rgb("#1E3A5F"))
    draw.rounded_rectangle([100, 280, 980, 780], radius=20, fill=hex_rgb("#0F2137"), outline=hex_rgb(LINE), width=2)
    f = font(44, True)
    y = 400
    for line in wrap(draw, headline, f, 780):
        draw.text((540, y), line, fill=hex_rgb(WHITE), font=f, anchor="mm")
        y += 58
    draw.text((540, y + 30), sub, fill=hex_rgb(SLATE), font=font(24), anchor="mm")
    draw_brand_mark(draw, 540, 180, 56)


def layout_typewriter(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#1A1A1A"))
    draw.rounded_rectangle([80, 160, 1000, 920], radius=4, fill=hex_rgb("#F5F0E6"))
    draw.text((120, 220), "TODAY —", fill=hex_rgb("#6B7280"), font=font(22), anchor="lm")
    f = font(40, True)
    y = 320
    for line in wrap(draw, headline, f, 800):
        draw.text((120, y), line, fill=hex_rgb("#111827"), font=f, anchor="lm")
        y += 54
    # fake underscore cursor
    draw.rectangle([120, y + 20, 160, y + 28], fill=hex_rgb("#111827"))
    draw.text((120, 820), sub, fill=hex_rgb("#6B7280"), font=font(24), anchor="lm")
    draw.text((900, 860), "3D", fill=hex_rgb("#9CA3AF"), font=font(18), anchor="rm")


def layout_wave(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb("#ECFEFF"))
    # simple wave bands at bottom
    for i, col in enumerate(["#A5F3FC", "#67E8F9", "#22D3EE", "#0891B2"]):
        y = 720 + i * 50
        pts = [(0, y + 40)]
        for x in range(0, 1081, 40):
            yy = y + int(28 * (1 if (x // 40) % 2 == 0 else -1))
            pts.append((x, yy))
        pts += [(W, H), (0, H)]
        draw.polygon(pts, fill=hex_rgb(col))
    f = font(48, True)
    y = 200
    for line in wrap(draw, headline, f, 900):
        draw.text((80, y), line, fill=hex_rgb(INK), font=f, anchor="lm")
        y += 62
    draw.text((80, y + 20), sub, fill=hex_rgb(NAVY2), font=font(26), anchor="lm")
    draw.text((80, 100), "3D", fill=hex_rgb("#0891B2"), font=font(22, True), anchor="lm")


def layout_corner_tag(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    fill_vgrad(draw, SOFT, "#E0F2FE")
    draw.polygon([(0, 0), (320, 0), (0, 320)], fill=hex_rgb(NAVY))
    draw.text((70, 70), "NOTE", fill=hex_rgb(SKY), font=font(22, True), anchor="mm")
    f = font(52, True)
    y = 380
    for line in wrap(draw, headline, f, 880):
        draw.text((80, y), line, fill=hex_rgb(INK), font=f, anchor="lm")
        y += 66
    draw.rounded_rectangle([80, y + 40, 420, y + 110], radius=8, fill=hex_rgb(NAVY))
    draw.text((250, y + 75), sub[:14] or "메모", fill=hex_rgb(WHITE), font=font(24), anchor="mm")
    draw_quiet_footer(draw, 1000)


def layout_split_bars(draw: ImageDraw.ImageDraw, headline: str, sub: str) -> None:
    draw.rectangle([0, 0, W, H], fill=hex_rgb(INK))
    for i, hgt in enumerate([180, 260, 140, 220, 160]):
        x = 80 + i * 190
        y = H - 120 - hgt
        draw.rounded_rectangle([x, y, x + 140, H - 120], radius=12, fill=hex_rgb(SKY if i % 2 else MINT))
    f = font(44, True)
    y = 120
    for line in wrap(draw, headline, f, 900):
        draw.text((80, y), line, fill=hex_rgb(WHITE), font=f, anchor="lm")
        y += 58
    draw.text((80, y + 20), sub, fill=hex_rgb(SLATE), font=font(24), anchor="lm")


LAYOUTS: list[Callable[[ImageDraw.ImageDraw, str, str], None]] = [
    layout_hero_brand,
    layout_three_pillars,
    layout_big_url,
    layout_split,
    layout_browser_mock,
    layout_checklist,
    layout_quote,
    layout_terminal,
    layout_magazine,
    layout_mint_card,
    layout_bold_type,
    layout_night_neon,
    layout_stat_row,
    layout_lined_paper,
    layout_big_number,
    layout_diagonal,
    layout_circle_focus,
    layout_postcard,
    layout_chat_bubbles,
    layout_film_strip,
    layout_sticky,
    layout_sunrise,
    layout_vertical_stack,
    layout_dot_grid,
    layout_typewriter,
    layout_wave,
    layout_corner_tag,
    layout_split_bars,
]

LAYOUT_BY_HINT = {
    "hero": layout_hero_brand,
    "pillars": layout_three_pillars,
    "url": layout_big_url,
    "split": layout_split,
    "browser": layout_browser_mock,
    "checklist": layout_checklist,
    "quote": layout_quote,
    "terminal": layout_terminal,
    "magazine": layout_magazine,
    "mint": layout_mint_card,
    "bold": layout_bold_type,
    "neon": layout_night_neon,
    "stats": layout_stat_row,
    "paper": layout_lined_paper,
    "number": layout_big_number,
    "diagonal": layout_diagonal,
    "circle": layout_circle_focus,
    "postcard": layout_postcard,
    "chat": layout_chat_bubbles,
    "film": layout_film_strip,
    "sticky": layout_sticky,
    "sunrise": layout_sunrise,
    "stack": layout_vertical_stack,
    "dots": layout_dot_grid,
    "type": layout_typewriter,
    "wave": layout_wave,
    "corner": layout_corner_tag,
    "bars": layout_split_bars,
}


# --- real photo layouts (Image in → Image out) — IG-focused polish ---

def photo_bottom(img: Image.Image, headline: str, sub: str) -> Image.Image:
    img = soft_vignette(img, 55)
    img = apply_rgba(img, gradient_band(W, H, from_top=False, max_alpha=220, band=480))
    draw = ImageDraw.Draw(img)
    accent_bar(draw, 80, 680)
    draw_headline_block(draw, headline, sub or "메모", y=710, align="lm", max_w=900, size=50)
    draw.text((980, 1010), "3D", fill=hex_rgb(SLATE), font=font(16), anchor="rm")
    return img


def photo_top(img: Image.Image, headline: str, sub: str) -> Image.Image:
    img = soft_vignette(img, 45)
    img = apply_rgba(img, gradient_band(W, H, from_top=True, max_alpha=210, band=460))
    draw = ImageDraw.Draw(img)
    draw.text((80, 64), "3D", fill=hex_rgb(SKY), font=font(20, True), anchor="lm")
    accent_bar(draw, 80, 110, 56)
    draw_headline_block(draw, headline, sub, y=140, align="lm", max_w=900, size=48)
    return img


def photo_center(img: Image.Image, headline: str, sub: str) -> Image.Image:
    img = soft_vignette(img, 80)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 70))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([70, 340, 1010, 740], radius=28, fill=(8, 18, 32, 185))
    img = apply_rgba(img, overlay)
    draw = ImageDraw.Draw(img)
    accent_bar(draw, 540 - 36, 390, 72)
    draw_headline_block(draw, headline, sub, y=430, align="mm", max_w=820, size=44)
    return img


def photo_card(img: Image.Image, headline: str, sub: str) -> Image.Image:
    img = soft_vignette(img, 40)
    # lift bottom with soft white card + thin top accent
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([48, 700, 1032, 1032], radius=28, fill=(255, 255, 255, 235))
    od.rectangle([48, 700, 1032, 708], fill=(*hex_rgb(SKY), 255))
    img = apply_rgba(img, overlay)
    draw = ImageDraw.Draw(img)
    draw_headline_block(
        draw,
        headline,
        sub or "메모",
        y=760,
        fill=hex_rgb(INK),
        sub_fill=hex_rgb(SLATE),
        align="lm",
        max_w=880,
        size=42,
        shadow=False,
    )
    draw.text((980, 990), "3D", fill=hex_rgb(SKY), font=font(16, True), anchor="rm")
    return img


def photo_side(img: Image.Image, headline: str, sub: str) -> Image.Image:
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    # soft left panel with fade edge
    for x in range(0, 560):
        a = 215 if x < 480 else int(215 * (560 - x) / 80)
        od.line([(x, 0), (x, H)], fill=(10, 24, 40, a))
    img = apply_rgba(img, overlay)
    draw = ImageDraw.Draw(img)
    draw.text((64, 72), "3D", fill=hex_rgb(SKY), font=font(20, True), anchor="lm")
    accent_bar(draw, 64, 250, 56)
    draw_headline_block(draw, headline, sub, y=280, align="lm", max_w=400, size=40)
    return img


def photo_minimal(img: Image.Image, headline: str, sub: str) -> Image.Image:
    img = soft_vignette(img, 35)
    img = apply_rgba(img, gradient_band(W, H, from_top=False, max_alpha=160, band=260))
    draw = ImageDraw.Draw(img)
    short = headline if len(headline) <= 16 else headline[:15]
    accent_bar(draw, 80, 880, 48)
    f = font(36, True)
    draw.text((82, 922), short, fill=(0, 0, 0), font=f, anchor="lm")
    draw.text((80, 920), short, fill=hex_rgb(WHITE), font=f, anchor="lm")
    if sub:
        draw.text((80, 980), sub, fill=hex_rgb(FOG), font=font(18), anchor="lm")
    return img


def photo_frame(img: Image.Image, headline: str, sub: str) -> Image.Image:
    canvas = Image.new("RGB", (W, H), hex_rgb("#EEF2F6"))
    # matte border
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([36, 36, W - 36, 820], fill=hex_rgb(WHITE))
    inner = img.resize((960, 740), Image.Resampling.LANCZOS)
    canvas.paste(inner, (60, 56))
    draw = ImageDraw.Draw(canvas)
    accent_bar(draw, 60, 860, 56, SKY)
    draw_headline_block(
        draw,
        headline,
        sub,
        y=890,
        fill=hex_rgb(INK),
        sub_fill=hex_rgb(SLATE),
        align="lm",
        max_w=900,
        size=36,
        shadow=False,
    )
    return canvas


def photo_duo(img: Image.Image, headline: str, sub: str) -> Image.Image:
    canvas = Image.new("RGB", (W, H), hex_rgb("#071018"))
    top = img.crop((0, 80, W, 700)).resize((W, 640), Image.Resampling.LANCZOS)
    canvas.paste(top, (0, 0))
    # thin sky line
    draw = ImageDraw.Draw(canvas)
    draw.rectangle([0, 640, W, 648], fill=hex_rgb(SKY))
    draw.rectangle([0, 648, W, H], fill=hex_rgb("#0B1C2E"))
    accent_bar(draw, 80, 700, 64)
    draw_headline_block(draw, headline, sub, y=730, align="lm", max_w=900, size=44)
    return canvas


def photo_blur_panel(img: Image.Image, headline: str, sub: str) -> Image.Image:
    img = soft_vignette(img, 40)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([56, 720, 1024, 1000], radius=32, fill=(255, 255, 255, 220))
    img = apply_rgba(img, overlay)
    draw = ImageDraw.Draw(img)
    accent_bar(draw, 88, 755, 56, "#0F766E")
    draw_headline_block(
        draw,
        headline,
        sub,
        y=780,
        fill=hex_rgb(INK),
        sub_fill=hex_rgb(NAVY2),
        align="lm",
        max_w=860,
        size=40,
        shadow=False,
    )
    return img


def photo_letterbox(img: Image.Image, headline: str, sub: str) -> Image.Image:
    """Cinematic bars — photo stays hero."""
    canvas = Image.new("RGB", (W, H), (0, 0, 0))
    mid = img.resize((W, 780), Image.Resampling.LANCZOS)
    canvas.paste(mid, (0, 150))
    draw = ImageDraw.Draw(canvas)
    accent_bar(draw, 80, 980, 48)
    f = font(34, True)
    short = headline if len(headline) <= 18 else headline[:17]
    draw.text((80, 1010), short, fill=hex_rgb(WHITE), font=f, anchor="lm")
    draw.text((980, 60), "3D", fill=hex_rgb(SLATE), font=font(16), anchor="rm")
    if sub:
        draw.text((80, 70), sub, fill=hex_rgb(SLATE), font=font(18), anchor="lm")
    return canvas


def photo_note(img: Image.Image, headline: str, sub: str) -> Image.Image:
    """Small paper note on photo — casual, human."""
    img = soft_vignette(img, 30)
    overlay = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([480, 700, 1020, 1010], radius=10, fill=(255, 252, 240, 240))
    img = apply_rgba(img, overlay)
    draw = ImageDraw.Draw(img)
    f = font(32, True)
    short = headline if len(headline) <= 14 else headline[:13]
    draw.text((520, 780), short, fill=hex_rgb("#1C1917"), font=f, anchor="lm")
    draw.text((520, 850), (sub or "메모")[:12], fill=hex_rgb("#78716C"), font=font(20), anchor="lm")
    draw.text((520, 960), "3D", fill=hex_rgb("#A8A29E"), font=font(14), anchor="lm")
    return img


PHOTO_LAYOUTS: dict[str, Callable[[Image.Image, str, str], Image.Image]] = {
    "photo": photo_bottom,
    "photo_bottom": photo_bottom,
    "photo_top": photo_top,
    "photo_center": photo_center,
    "photo_card": photo_card,
    "photo_side": photo_side,
    "photo_minimal": photo_minimal,
    "photo_frame": photo_frame,
    "photo_duo": photo_duo,
    "photo_frost": photo_blur_panel,
    "photo_letterbox": photo_letterbox,
    "photo_note": photo_note,
}


def render_glow_image(
    out_path: Path,
    headline: str,
    subtitle: str,
    layout_hint: str | None = None,
    photo_path: Path | None = None,
    used_photos: list[str] | None = None,
) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if layout_hint in PHOTO_LAYOUTS and (photo_path or list_stock_photos()):
        src = photo_path if photo_path and photo_path.is_file() else pick_photo(used_photos)
        if src is not None:
            img = square_cover(src)
            img = PHOTO_LAYOUTS[layout_hint](img, headline, subtitle)
            img.save(out_path, "JPEG", quality=94)
            # stash for caller (post_once) to persist used_photos
            render_glow_image.last_photo_name = src.name  # type: ignore[attr-defined]
            return out_path
    render_glow_image.last_photo_name = None  # type: ignore[attr-defined]
    img = Image.new("RGB", (W, H), hex_rgb(NAVY))
    draw = ImageDraw.Draw(img)
    layout = LAYOUT_BY_HINT.get(layout_hint or "") if layout_hint else None
    if not callable(layout):
        layout = random.choice(LAYOUTS)
    layout(draw, headline, subtitle)
    img.save(out_path, "JPEG", quality=93)
    return out_path


# expose combined hints for post_once variety (photo keys map to None — handled in render)
LAYOUT_BY_HINT = {**LAYOUT_BY_HINT, **{k: None for k in PHOTO_LAYOUTS}}


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1] / "out" / "previews"
    samples = [
        ("photo_bottom", "다시 올 자리가 있나", "메모"),
        ("photo_card", "창구하나면", "정리"),
        ("photo_frost", "막힌지점부터", "체크"),
        ("photo_minimal", "천천히보면됨", ""),
        ("photo_letterbox", "집이먼저", "오늘"),
        ("photo_frame", "흐름이끊기면", "노트"),
        ("photo_duo", "크게시작안해도", "가볍게"),
        ("photo_note", "중구난방인날", "메모"),
        ("photo_center", "처음이제일막힘", "메모"),
        ("photo_side", "숫자보다남는거", "3D"),
    ]
    print("photos:", len(list_stock_photos()))
    for hint, h, s in samples:
        p = root / f"preview-{hint}.jpg"
        render_glow_image(p, h, s, hint)
        print(p)
