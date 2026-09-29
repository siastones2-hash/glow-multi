#!/usr/bin/env python3
"""정보 수정 창에서 캡션을 2만 5천 원으로 붙여넣고 저장."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)

PROFILE = Path("/Users/apple/glow-multi/ig-auto/data/browser-profile")
SHOT = Path("/tmp/ig-price")
REEL = "https://www.instagram.com/glowsiax/reel/Dd1A7k5PsYd/"
NEW = (
    "한강 루프탑, 대인 2만 5천 원입니다\n"
    "맥주 한 잔이랑 팝콘이 포함돼요\n"
    "10월 1일부터 13일까지\n"
    "여의도 유람선터미널 4층\n"
    "매일 18:00–02:00\n\n"
    "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay\n\n"
    ".\n.\n.\n\n"
    "#서울크루즈 #루프탑축제 #여의도 #한강 #한강야경 #여의나루 #루프탑바 "
    "#서울데이트 #DJ파티 #10월축제 #한강축제 #서울가볼만한곳 #여의도한강공원 "
    "#클럽분위기 #서울밤 #입장료 #한강루프탑 #서울핫플"
)


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    print(tag, (page.inner_text("body") or "")[:160].replace("\n", " | "), flush=True)
    return page.inner_text("body") or ""


def box_text(page) -> str:
    return page.evaluate(
        """() => {
          const box = document.querySelector('[role=dialog] [contenteditable=true][role=textbox]');
          return box ? (box.innerText || '') : '';
        }"""
    ) or ""


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=False,
            viewport={"width": 1400, "height": 980},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin="https://www.instagram.com")
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(REEL, wait_until="domcontentloaded", timeout=60000)
        time.sleep(5)
        page.locator('svg[aria-label="옵션 더 보기"]').last.click(force=True)
        time.sleep(1.2)
        page.get_by_text("수정", exact=True).last.click(force=True)
        time.sleep(3)
        dump(page, "v1")

        loc = page.locator('[role=dialog] [contenteditable=true][role=textbox]')
        loc.click()
        time.sleep(0.3)

        filled = False
        try:
            loc.fill(NEW)
            time.sleep(0.4)
            print("fill", box_text(page)[:40], flush=True)
            filled = "2만 5천" in box_text(page)
        except Exception as e:
            print("fill_err", e, flush=True)

        if not filled:
            page.evaluate("""async (t) => { await navigator.clipboard.writeText(t); }""", NEW)
            loc.click()
            page.keyboard.press("Meta+A")
            time.sleep(0.2)
            page.keyboard.press("Meta+V")
            time.sleep(0.6)
            print("paste", box_text(page)[:50], flush=True)
            filled = "2만 5천" in box_text(page)

        if not filled:
            loc.click()
            page.keyboard.press("Meta+A")
            time.sleep(0.1)
            page.keyboard.press("Backspace")
            page.keyboard.type("한강 루프탑, 대인 2만 5천 원입니다", delay=25)
            print("typed first line", box_text(page)[:50], flush=True)
            filled = "2만 5천" in box_text(page)

        dump(page, "v2")
        print("HAS", filled, "TEXT", box_text(page)[:80], flush=True)

        if filled:
            page.locator('[role=dialog]').get_by_text("완료", exact=True).first.click()
            print("saved", flush=True)
            time.sleep(4)
        else:
            print("NOT SAVING — caption unchanged", flush=True)

        page.goto(REEL, wait_until="domcontentloaded", timeout=60000)
        time.sleep(4)
        body = dump(page, "v3")
        print("OK", "2만 5천" in body, "OLD", "대인 2만 원입니다" in body, flush=True)
        time.sleep(8)
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
