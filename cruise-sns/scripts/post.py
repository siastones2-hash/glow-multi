#!/usr/bin/env python3
"""서울크루즈 루프탑축제 — 인스타 @glowsiax + 스레드 1회 발행."""
from __future__ import annotations

import json
import os
import random
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
IG_AUTO = ROOT.parent / "ig-auto"
PHOTO_DIR = ROOT.parent / "docs" / "cruise-festival" / "assets" / "photos"
STATE = ROOT / "data" / "state.json"
OUT = ROOT / "out"
LOG = ROOT / "data" / "run.log"
CFG_PATH = ROOT / "config.json"
CFG = json.loads(CFG_PATH.read_text(encoding="utf-8"))
KST = ZoneInfo("Asia/Seoul")

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)
sys.path.insert(0, str(IG_AUTO / "scripts"))


def log(msg: str) -> None:
    line = f"{datetime.now(KST).isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {}


def save_state(st: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")


def mix_tags(sets: list[list[str]], brand: list[str], n: int = 18) -> str:
    bag = list(brand)
    for s in sets:
        bag.extend(s)
    seen, out = set(), []
    random.shuffle(bag)
    for t in bag:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= n:
            break
    return " ".join(out)


def pick_pair() -> tuple[dict, dict, Path]:
    ig_pool = json.loads((ROOT / "captions" / "pool.json").read_text(encoding="utf-8"))
    th_pool = json.loads((ROOT / "captions" / "threads_pool.json").read_text(encoding="utf-8"))
    st = load_state()
    used = set(st.get("used_ids") or [])
    igs = [p for p in ig_pool["posts"] if p["id"] not in used] or list(ig_pool["posts"])
    ig = random.choice(igs)
    ths = [p for p in th_pool["posts"] if p["id"] not in used] or list(th_pool["posts"])
    # same theme if possible
    want = "T_" + ig["id"]
    th = next((p for p in ths if p["id"] == want), None) or random.choice(ths)

    photo = PHOTO_DIR / ig.get("photo", "")
    if not photo.exists():
        jpgs = sorted(PHOTO_DIR.glob("sc-*.jpg")) + sorted(PHOTO_DIR.glob("night-*.jpg"))
        if not jpgs:
            raise SystemExit(f"사진 없음: {PHOTO_DIR}")
        photo = random.choice(jpgs)

    OUT.mkdir(parents=True, exist_ok=True)
    dest = OUT / f"cruise-{datetime.now(KST).strftime('%Y%m%d-%H%M%S')}-{ig['id']}.jpg"
    if photo.suffix.lower() in {".jpg", ".jpeg"}:
        shutil.copy2(photo, dest)
    else:
        from PIL import Image
        Image.open(photo).convert("RGB").save(dest, "JPEG", quality=90)

    cta = CFG["landing"]
    ig_body = "\n".join(ig["lines"]) + f"\n\n{cta}"
    tags = mix_tags(ig_pool["hashtag_sets"], ig_pool["brand_tags"])
    ig_caption = f"{ig_body}\n\n.\n.\n.\n\n{tags}"
    th_caption = "\n".join(th["lines"]) + f"\n\n{cta}"
    return ig, th, dest, ig_caption, th_caption


def profile_dir() -> Path:
    if CFG.get("share_ig_auto_profile"):
        return IG_AUTO / "data" / "browser-profile"
    return ROOT / "data" / "browser-profile"


def main() -> int:
    force = "--force" in sys.argv
    login_only = "--login" in sys.argv
    skip_threads = "--no-threads" in sys.argv

    import post_playwright as pw

    pw.IG_USER = CFG["ig_user"]
    pw.THREADS_USER = CFG["threads_user"]
    pw.PROFILE = profile_dir()
    pw.LOG = LOG
    pw.ROOT = ROOT

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("playwright 미설치: pip3 install playwright && python3 -m playwright install chromium")
        return 2

    prof = profile_dir()
    prof.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(prof),
            headless=not login_only and "--headed" not in sys.argv,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)
        if login_only or "accounts/login" in page.url:
            if login_only:
                log(f"인스타 @{CFG['ig_user']} 로그인 후 창을 유지하세요")
                page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded")
                for _ in range(60):
                    time.sleep(5)
                    if "accounts/login" not in page.url:
                        break
                ctx.close()
                return 0
            log("로그인 필요: cruise-sns/로그인.command")
            ctx.close()
            return 3

        ig, th, path, ig_caption, th_caption = pick_pair()
        log(f"pick ig={ig['id']} th={th['id']} photo={path.name}")
        ig_res = pw.post_instagram(page, path, ig_caption)
        log(f"ig_result={json.dumps(ig_res, ensure_ascii=False)[:400]}")
        th_res = {"ok": False, "skipped": True}
        if not skip_threads:
            time.sleep(random.uniform(2.5, 5.0))
            th_res = pw.post_threads_text(page, th_caption)
            log(f"threads_result={json.dumps(th_res, ensure_ascii=False)[:400]}")
        ctx.close()

    if not ig_res.get("ok") and not th_res.get("ok"):
        return 1

    st = load_state()
    used = list(st.get("used_ids") or [])
    for i in (ig["id"], th["id"]):
        if i not in used:
            used.append(i)
    st["used_ids"] = used[-80:]
    st["last_ig_id"] = ig["id"]
    st["last_th_id"] = th["id"]
    st["last_post_at"] = datetime.now(KST).isoformat(timespec="seconds")
    st["landing"] = CFG["landing"]
    if ig_res.get("media"):
        st["last_ig_code"] = ig_res.get("media")
    if th_res.get("media"):
        st["last_threads_code"] = th_res.get("media")
    if not force:
        today = datetime.now(KST).date().isoformat()
        day = st.get("day") or {}
        if day.get("date") != today:
            day = {"date": today, "posted": 0, "target": CFG.get("posts_per_day", 2)}
        day["posted"] = int(day.get("posted", 0)) + 1
        st["day"] = day
    save_state(st)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
