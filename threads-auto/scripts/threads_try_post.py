#!/usr/bin/env python3
"""Try multiple post strategies."""
import json
import sys
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
SHOT = ROOT / "data" / "debug-screenshots"
BASE = "https://www.threads.com"

text = sys.argv[1] if len(sys.argv) > 1 else f"try {datetime.now():%H:%M:%S}"
SHOT.mkdir(parents=True, exist_ok=True)


def modal_post(page, text):
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    page.get_by_role("button", name="만들기").first.click()
    page.wait_for_timeout(1500)
    box = page.locator('[contenteditable="true"][role="textbox"]').last
    box.click()
    page.keyboard.type(text, delay=25)
    page.wait_for_timeout(1500)
    for i in range(page.get_by_role("button", name="게시").count()):
        b = page.get_by_role("button", name="게시").nth(i)
        bb = b.bounding_box()
        if bb and bb["y"] > 400:
            b.click()
            break
    page.wait_for_timeout(8000)
    page.screenshot(path=str(SHOT / "try-modal-after.png"))


def profile_inline(page, text):
    page.goto(BASE + "/@leestones2", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(3000)
    # 프로필 상단 "새로운 소식이 있나요?"
    ce = page.locator('[contenteditable="true"]').first
    ce.click()
    page.keyboard.type(text, delay=25)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOT / "try-profile-typed.png"))
    # 프로필 compose 게시 — 보통 y < 400
    for i in range(page.get_by_role("button", name="게시").count()):
        b = page.get_by_role("button", name="게시").nth(i)
        bb = b.bounding_box()
        if bb and bb["y"] < 400 and b.is_enabled():
            b.click()
            break
    page.wait_for_timeout(8000)
    page.screenshot(path=str(SHOT / "try-profile-after.png"))


def home_inline(page, text):
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    ce = page.locator('[contenteditable="true"]').first
    ce.click()
    page.keyboard.type(text, delay=25)
    page.wait_for_timeout(1500)
    for i in range(page.get_by_role("button", name="게시").count()):
        b = page.get_by_role("button", name="게시").nth(i)
        bb = b.bounding_box()
        if bb and bb["y"] < 200 and b.is_enabled():
            b.click()
            break
    page.wait_for_timeout(8000)


def verify(page, text):
    page.goto(BASE + "/@leestones2", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    body = page.inner_text("body")
    return text in body or text[:12] in body


mode = sys.argv[2] if len(sys.argv) > 2 else "modal"

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(PROFILE), headless=False,
        viewport={"width": 1280, "height": 900}, locale="ko-KR",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    if mode == "profile":
        profile_inline(page, text)
    elif mode == "home":
        home_inline(page, text)
    else:
        modal_post(page, text)
    ok = verify(page, text)
    print(json.dumps({"mode": mode, "ok": ok, "text": text}, ensure_ascii=False))
    ctx.close()
    sys.exit(0 if ok else 1)
