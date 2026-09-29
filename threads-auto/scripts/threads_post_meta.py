#!/usr/bin/env python3
"""Modal post + Meta+Enter + network listen."""
import json
import sys
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
SHOT = ROOT / "data" / "debug-screenshots"
BASE = "https://www.threads.com"

text = sys.argv[1] if len(sys.argv) > 1 else f"meta {datetime.now():%H:%M:%S}"
method = sys.argv[2] if len(sys.argv) > 2 else "click"
SHOT.mkdir(parents=True, exist_ok=True)

responses = []

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(PROFILE), headless=True,
        viewport={"width": 1280, "height": 900}, locale="ko-KR",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    def on_response(r):
        u = r.url
        if "graphql" in u or "create" in u.lower() or "publish" in u.lower():
            responses.append({"url": u[:120], "status": r.status})

    page.on("response", on_response)

    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    page.get_by_role("button", name="만들기").first.click()
    page.wait_for_timeout(1500)
    box = page.locator('[contenteditable="true"][role="textbox"]').last
    box.click()
    page.keyboard.type(text, delay=25)
    page.wait_for_timeout(1500)
    page.screenshot(path=str(SHOT / "meta-before.png"))

    if method == "meta":
        page.keyboard.press("Meta+Enter")
    elif method == "enter":
        page.keyboard.press("Enter")
    else:
        for i in range(page.get_by_role("button", name="게시").count()):
            b = page.get_by_role("button", name="게시").nth(i)
            bb = b.bounding_box()
            if bb and bb["y"] > 400:
                b.click()
                break

    page.wait_for_timeout(10000)
    page.screenshot(path=str(SHOT / "meta-after.png"))

    # modal still open?
    modal_open = page.locator('[contenteditable="true"][role="textbox"]').count() > 0
    box_text = ""
    if modal_open:
        box_text = page.locator('[contenteditable="true"][role="textbox"]').last.inner_text()

    page.goto(BASE + "/@leestones2", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    body = page.inner_text("body")
    ok = text in body or text[:10] in body

    print(json.dumps({
        "method": method,
        "ok": ok,
        "text": text,
        "modal_open": modal_open,
        "box_text_after": box_text[:80],
        "responses": responses[:10],
    }, ensure_ascii=False, indent=2))
    ctx.close()
    sys.exit(0 if ok else 1)
