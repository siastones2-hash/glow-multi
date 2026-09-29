#!/usr/bin/env python3
"""Find correct 게시 button in compose modal."""
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
BASE = "https://www.threads.com"
text = sys.argv[1] if len(sys.argv) > 1 else "selector test"

with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        str(PROFILE), headless=True,
        viewport={"width": 1280, "height": 900}, locale="ko-KR",
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
    page.wait_for_timeout(2500)
    page.get_by_role("button", name="만들기").first.click()
    page.wait_for_timeout(1500)

    box = page.locator('[contenteditable="true"][role="textbox"]').last
    box.click()
    page.keyboard.type(text, delay=20)
    page.wait_for_timeout(1000)

    info = page.evaluate("""() => {
      const box = document.querySelectorAll('[contenteditable="true"][role="textbox"]');
      const el = box[box.length - 1];
      const buttons = [...document.querySelectorAll('[role="button"], button')].filter(b => b.innerText.trim() === '게시');
      return {
        boxText: el?.innerText,
        buttons: buttons.map((b, i) => {
          let p = b;
          const path = [];
          for (let j = 0; j < 8 && p; j++) {
            path.push(p.tagName + (p.getAttribute('role') ? `[role=${p.getAttribute('role')}]` : '') + (p.className ? '.' + String(p.className).slice(0,40) : ''));
            p = p.parentElement;
          }
          const r = b.getBoundingClientRect();
          return { i, x: r.x, y: r.y, w: r.width, h: r.height, enabled: !b.hasAttribute('disabled') && b.getAttribute('aria-disabled') !== 'true', path: path.slice(0,5) };
        })
      };
    }""")
    import json
    print(json.dumps(info, ensure_ascii=False, indent=2))

    # try scoped selectors
    selectors = [
        ('options-row', page.locator('div:has-text("게시물 옵션")').get_by_role("button", name="게시")),
        ('box-ancestor', page.locator('[contenteditable="true"][role="textbox"]').last.locator('xpath=ancestor::div[.//button[contains(normalize-space(.),"게시")]][1]').get_by_role("button", name="게시")),
        ('presentation', page.locator('[role="presentation"]').filter(has_text="새로운 스레드").get_by_role("button", name="게시").last),
    ]
    for name, loc in selectors:
        try:
            c = loc.count()
            en = loc.first.is_enabled() if c else False
            print(f"{name}: count={c} enabled={en}")
        except Exception as e:
            print(f"{name}: err {e}")

    ctx.close()
