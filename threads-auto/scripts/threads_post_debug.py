#!/usr/bin/env python3
"""Debug post flow — screenshots + button state."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
SHOT = ROOT / "data" / "debug-screenshots"
BASE = "https://www.threads.com"

text = sys.argv[1] if len(sys.argv) > 1 else "debug test post"

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
    page.wait_for_timeout(3000)
    print("URL:", page.url)

    page.get_by_role("button", name="만들기").first.click(timeout=8000)
    page.wait_for_timeout(2000)
    page.screenshot(path=str(SHOT / "1-modal-open.png"))

    boxes = page.locator('[contenteditable="true"][role="textbox"]')
    print("textbox count:", boxes.count())
    box = boxes.last
    box.click()
    page.keyboard.type(text, delay=30)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOT / "2-typed.png"))

    # all 게시 buttons
    btns = page.get_by_role("button", name="게시")
    print("게시 button count:", btns.count())
    for i in range(btns.count()):
        b = btns.nth(i)
        print(f"  [{i}] enabled={b.is_enabled()} visible={b.is_visible()} aria-disabled={b.get_attribute('aria-disabled')}")

    # dialog-scoped
    dialog = page.locator('[role="dialog"]').first
    print("dialog count:", page.locator('[role="dialog"]').count())
    if dialog.count():
        dbtn = dialog.get_by_role("button", name="게시")
        print("dialog 게시 count:", dbtn.count())
        if dbtn.count():
            print("dialog 게시 enabled:", dbtn.last.is_enabled())

    post_btn = page.get_by_role("button", name="게시").last
    print("clicking last 게시, enabled=", post_btn.is_enabled())
    post_btn.click(force=True)
    page.wait_for_timeout(5000)
    page.screenshot(path=str(SHOT / "3-after-click.png"))

    page.goto(BASE + "/@leestones2", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    page.screenshot(path=str(SHOT / "4-profile.png"))
    body = page.inner_text("body")
    print("text on profile:", text in body)
    print("profile snippet:", body[:500])

    ctx.close()
