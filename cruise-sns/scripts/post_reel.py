#!/usr/bin/env python3
"""서울크루즈 릴스 1개 — 인스타 @glowsiax + 스레드 @siastreet."""
from __future__ import annotations

import json
import os
import random
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
IG_AUTO = ROOT.parent / "ig-auto"
REELS = ROOT.parent / "docs" / "cruise-festival" / "reels"
STATE = ROOT / "data" / "state.json"
LOG = ROOT / "data" / "run.log"
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
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


def mix_tags() -> str:
    pool = json.loads((ROOT / "captions" / "pool.json").read_text(encoding="utf-8"))
    bag = list(pool["brand_tags"])
    for s in pool["hashtag_sets"]:
        bag.extend(s)
    extra = [
        "#여의도데이트",
        "#한강루프탑",
        "#서울축제",
        "#10월1일",
        "#루프탑파티",
        "#서울핫플",
    ]
    bag.extend(extra)
    seen, out = set(), []
    random.shuffle(bag)
    for t in bag:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= 18:
            break
    # brand first, stable
    head = ["#서울크루즈", "#루프탑축제", "#여의도", "#한강"]
    rest = [t for t in out if t not in head]
    return " ".join(head + rest[:14])


def cover_from(video: Path, dest: Path) -> Path:
    import cv2

    dest.parent.mkdir(parents=True, exist_ok=True)
    cap = cv2.VideoCapture(str(video))
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(1, n // 3))
    ok, frame = cap.read()
    if not ok:
        cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
        ok, frame = cap.read()
    cap.release()
    if not ok:
        raise SystemExit(f"커버 추출 실패: {video}")
    import cv2 as _cv

    _cv.imwrite(str(dest), frame, [int(_cv.IMWRITE_JPEG_QUALITY), 90])
    return dest


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    video = Path(args[0]) if args else REELS / "hook-01-2만원.mp4"
    if not video.exists():
        raise SystemExit(f"영상 없음: {video}")

    import cv2
    import post_playwright as pw
    from playwright.sync_api import sync_playwright

    cap = cv2.VideoCapture(str(video))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1080)
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1920)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 30)
    n = float(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    cap.release()
    dur = n / fps if fps else 7.0

    cta = CFG["landing"]
    ig_body = (
        "한강 루프탑, 대인 2만 5천 원입니다\n"
        "맥주 한 잔이랑 팝콘이 포함돼요\n"
        "10월 1일부터 13일까지\n"
        "여의도 유람선터미널 4층\n"
        "매일 18:00–02:00\n"
        "\n"
        f"{cta}"
    )
    ig_caption = f"{ig_body}\n\n.\n.\n.\n\n{mix_tags()}"
    th_caption = (
        "한강 루프탑이 2만 5천 원입니다\n"
        "맥주 한 잔 + 팝콘\n"
        "10.1–10.13 여의도 유람선터미널 4층\n"
        f"\n{cta}"
    )

    cover = cover_from(video, ROOT / "out" / f"cover-{video.stem}.jpg")
    log(f"reel={video.name} {w}x{h} {dur:.1f}s cover={cover.name}")

    pw.IG_USER = CFG["ig_user"]
    pw.THREADS_USER = CFG["threads_user"]
    pw.PROFILE = IG_AUTO / "data" / "browser-profile"
    pw.LOG = LOG
    pw.ROOT = ROOT

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(pw.PROFILE),
            headless="--headed" not in sys.argv,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)
        if "accounts/login" in page.url:
            log("로그인 필요")
            ctx.close()
            return 3
        ig_res = pw.post_instagram_reel(
            page, video, ig_caption, cover_path=cover, duration_sec=dur, width=w, height=h
        )
        log(f"ig_reel={json.dumps(ig_res, ensure_ascii=False)[:500]}")
        if not ig_res.get("ok"):
            log("ig_reel_api_fail → UI")
            ig_res = pw.post_instagram_reel_ui(page, video, ig_caption)
            log(f"ig_reel_ui={json.dumps(ig_res, ensure_ascii=False)[:400]}")
        th_res = {"ok": False, "skipped": True}
        skip_th = "--no-threads" in sys.argv
        if not skip_th:
            time.sleep(random.uniform(2.0, 4.0))
            th_res = pw.post_threads_text(page, th_caption, topic_tag="서울")
            log(f"threads={json.dumps(th_res, ensure_ascii=False)[:400]}")
        ctx.close()

    if not ig_res.get("ok") and not th_res.get("ok"):
        return 1
    st = {}
    if STATE.exists():
        st = json.loads(STATE.read_text(encoding="utf-8"))
    st.update(
        {
            "last_reel": video.name,
            "last_ig_id": "HOOK01",
            "last_th_id": "T_FEE",
            "last_post_at": datetime.now(KST).isoformat(timespec="seconds"),
            "landing": cta,
            "last_ig_code": ig_res.get("media"),
            "last_threads_code": th_res.get("media"),
        }
    )
    used = list(st.get("used_ids") or [])
    for i in ("HOOK01", "T_FEE"):
        if i not in used:
            used.append(i)
    st["used_ids"] = used
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0 if ig_res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
