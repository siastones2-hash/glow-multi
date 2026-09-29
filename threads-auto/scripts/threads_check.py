#!/usr/bin/env python3
"""프로필에 테스트 글 있는지 확인만."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
BASE = "https://www.threads.com"
MARKERS = ["편하게 테스트", "실행테스트", "테스트2", "일단 하나 올립니다", "test-click", "test-meta"]


def main():
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE), headless=True,
            viewport={"width": 1280, "height": 900}, locale="ko-KR",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2000)
        if "login" in page.url:
            print(json.dumps({"error": "로그인 필요"}))
            ctx.close()
            return
        page.goto(BASE + "/@leestones2", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(4000)
        body = page.inner_text("body")
        found = [m for m in MARKERS if m in body]
        ctx.close()
        print(json.dumps({"found": found, "hasPost": len(found) > 0}, ensure_ascii=False))


if __name__ == "__main__":
    main()
