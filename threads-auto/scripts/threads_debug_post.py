#!/usr/bin/env python3
"""발행 디버그 — headless 스크린샷"""
import sys
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
STORAGE = ROOT / "data" / "threads-storage.json"
SHOT = ROOT / "data" / "debug-screenshots"
TEXT = f"[테스트] threads-auto {datetime.now().strftime('%m/%d %H:%M')}"


def snap(page, name):
    SHOT.mkdir(parents=True, exist_ok=True)
    p = SHOT / f"{name}.png"
    page.screenshot(path=str(p), full_page=True)
    print(f"screenshot: {p}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        ctx = browser.new_context(storage_state=str(STORAGE), viewport={"width": 1280, "height": 900}, locale="ko-KR")
        page = ctx.new_page()

        for url in ["https://www.threads.com/", "https://www.threads.net/"]:
            page.goto(url, wait_until="networkidle", timeout=60000)
            page.wait_for_timeout(3000)
            snap(page, f"home-{url.split('//')[1].split('/')[0]}")
            print("url:", page.url, "login?", "login" in page.url)
            print("contenteditable:", page.locator('[contenteditable="true"]').count())
            for i, el in enumerate(page.locator('[contenteditable="true"]').all()[:5]):
                try:
                    aria = el.get_attribute("aria-label") or el.get_attribute("placeholder") or ""
                    print(f"  [{i}] aria/placeholder={aria!r} visible={el.is_visible()}")
                except Exception as e:
                    print(f"  [{i}] err={e}")

            # try compose on threads.com
            if "login" not in page.url:
                ce = page.locator('[contenteditable="true"]').first
                if ce.count() and ce.is_visible():
                    ce.click()
                    page.keyboard.type(TEXT, delay=15)
                    snap(page, "typed")
                    for name in ["게시", "Post"]:
                        btn = page.get_by_role("button", name=name)
                        print(f"buttons {name}:", btn.count())
                    post = page.get_by_role("button", name="게시")
                    if not post.count():
                        post = page.get_by_role("button", name="Post")
                    if post.count():
                        post.last.click(force=True)
                        page.wait_for_timeout(5000)
                        snap(page, "after-post")
                        # 프로필에서 확인
                        page.goto("https://www.threads.com/", wait_until="networkidle")
                        page.wait_for_timeout(3000)
                        body = page.content()
                        print("text on page after post:", TEXT[:20] in body)
                        snap(page, "feed-check")
                    break

        browser.close()

if __name__ == "__main__":
    main()
