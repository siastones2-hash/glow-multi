#!/usr/bin/env python3
"""지금 상황(입장료 랜딩, 개막 3일 전)에 맞는 첫 릴스 1개 업로드."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path("/Users/apple/glow-multi/cruise-sns")
IG_AUTO = ROOT.parent / "ig-auto"
VIDEO = ROOT.parent / "docs" / "cruise-festival" / "reels" / "hook-01-2만원.mp4"
PROFILE = IG_AUTO / "data" / "browser-profile"
COOKIE_JSON = IG_AUTO / "data" / "ig-cookies.json"
CTA = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"
CAPTION = (
    "한강 루프탑, 대인 2만 5천 원입니다\n"
    "맥주 한 잔이랑 팝콘이 포함돼요\n"
    "10월 1일부터 13일까지\n"
    "여의도 유람선터미널 4층\n"
    "매일 18:00–02:00\n"
    "\n"
    f"{CTA}\n"
    "\n.\n.\n.\n\n"
    "#서울크루즈 #루프탑축제 #여의도 #한강 #한강야경 #여의나루 "
    "#루프탑바 #서울데이트 #DJ파티 #10월축제 #한강축제 "
    "#서울가볼만한곳 #여의도한강공원 #클럽분위기 #서울밤 "
    "#입장료 #한강루프탑 #서울핫플"
)

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)
sys.path.insert(0, str(IG_AUTO / "scripts"))


def logged_in(page) -> bool:
    url = page.url or ""
    body = page.inner_text("body") or ""
    if "accounts/login" in url:
        return False
    if "시작하기" in body and "새 계정 만들기" in body:
        return False
    if "계속" in body and "다른 프로필 사용하기" in body:
        return False
    return "만들기" in body or "Create" in body


def main() -> int:
    from playwright.sync_api import sync_playwright
    import post_playwright as pw

    if not VIDEO.exists():
        print("no video", VIDEO)
        return 2

    cookies = []
    if COOKIE_JSON.exists():
        cookies = [c for c in json.loads(COOKIE_JSON.read_text())["cookies"] if c.get("value")]

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=False,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        if cookies:
            try:
                ctx.add_cookies(cookies)
            except Exception as e:
                print("cookies", e)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2.5)
        body = page.inner_text("body") or ""
        print("open", page.url, flush=True)
        if "계속" in body and "glowsiax" in body.lower():
            try:
                page.get_by_role("button", name="계속").first.click(timeout=4000)
            except Exception:
                page.get_by_text("계속", exact=True).first.click()
            print("clicked 계속", flush=True)
            time.sleep(5)
        # 한 번 더 홈
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        print("after", page.url, "in=", logged_in(page), flush=True)
        print((page.inner_text("body") or "")[:220].replace("\n", " | "), flush=True)
        if not logged_in(page):
            print("NEED_LOGIN", flush=True)
            # 창 유지해서 직접 계속 누를 수 있게
            for _ in range(90):
                time.sleep(2)
                if logged_in(page):
                    print("NOW_IN", flush=True)
                    break
            else:
                ctx.close()
                return 3

        res = pw.post_instagram_reel_ui(page, VIDEO, CAPTION)
        print("ui", json.dumps(res, ensure_ascii=False)[:500], flush=True)
        time.sleep(4)
        ctx.close()
        return 0 if res.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
