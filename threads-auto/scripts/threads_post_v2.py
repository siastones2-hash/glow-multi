#!/usr/bin/env python3
"""로그인 프로필로 직접 발행 — storage_state 대신 persistent context"""
import json
import sys
from datetime import datetime
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
SHOT = ROOT / "data" / "debug-screenshots"
BASE = "https://www.threads.com"


def main():
    text = sys.argv[1] if len(sys.argv) > 1 else f"실행테스트 {datetime.now():%H:%M}"
    if not PROFILE.exists():
        print(json.dumps({"error": "browser-profile 없음 — 스레드-로그인.command 다시"}))
        sys.exit(1)

    SHOT.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=False,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)

        if "login" in page.url:
            print(json.dumps({"error": "로그인 필요"}))
            ctx.close()
            sys.exit(1)

        # 메인 compose
        ce = page.locator('[contenteditable="true"]').first
        ce.click()
        page.keyboard.type(text, delay=15)
        page.wait_for_timeout(1500)
        page.screenshot(path=str(SHOT / "v2-before.png"))

        # 게시
        for name in ["게시", "Post"]:
            btn = page.get_by_role("button", name=name)
            for i in range(btn.count() - 1, -1, -1):
                b = btn.nth(i)
                if b.is_visible() and b.is_enabled():
                    b.click()
                    break
            else:
                continue
            break

        page.wait_for_timeout(8000)
        page.screenshot(path=str(SHOT / "v2-after.png"))

        html = page.content()
        ok = text[:15] in html or text in html
        print(json.dumps({"ok": ok, "verified": ok, "text": text, "url": page.url}, ensure_ascii=False))
        ctx.close()
        sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
