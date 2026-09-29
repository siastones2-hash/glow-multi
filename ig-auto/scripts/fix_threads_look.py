#!/usr/bin/env python3
"""Threads 이름 force-click + 소개 확인 + 링크 추가."""
from __future__ import annotations

import json
import time
from pathlib import Path

PROFILE = Path("/Users/apple/glow-multi/ig-auto/data/browser-profile")
LANDING = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"
NAME = "서울크루즈 루프탑축제"
BIO = "10.1–10.13 여의도 4층 · 매일 18:00–02:00 · 대인 2만 5천 원"


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=True,
            viewport={"width": 1280, "height": 980},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.threads.com/@siastreet", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        page.get_by_text("프로필 편집", exact=True).first.click(timeout=8000)
        time.sleep(2)

        # 이름 — overlay 때문에 force
        name_row = page.locator('[role="dialog"]').get_by_text("시아스트릿", exact=True)
        if name_row.count():
            name_row.first.click(force=True)
            time.sleep(1.2)
            box = page.locator('[role="dialog"] input[type="text"]')
            print("name_inputs", box.count())
            if box.count():
                box.last.fill(NAME)
            else:
                page.keyboard.press("Meta+a")
                page.keyboard.type(NAME, delay=20)
            time.sleep(0.3)
            page.get_by_role("button", name="완료").last.click()
            print("name_saved")
            time.sleep(1.2)
        else:
            print("name_row_missing")

        # 소개 다시
        intro = page.get_by_text("소개 작성").or_(page.get_by_text("소개 수정")).or_(page.get_by_text("소개"))
        if intro.count():
            intro.first.click(force=True)
            time.sleep(1)
            ta = page.locator("[role='dialog'] textarea")
            print("bio_ta", ta.count(), ta.last.input_value() if ta.count() else "")
            if ta.count():
                ta.last.fill(BIO)
            page.get_by_role("button", name="완료").last.click()
            print("bio_saved")
            time.sleep(1.2)

        # 링크 추가
        add = page.get_by_text("링크 추가", exact=False)
        if add.count():
            add.first.click(force=True)
            time.sleep(1.2)
            inp = page.locator("[role='dialog'] input")
            print("link_inputs", inp.count())
            filled = False
            for i in range(inp.count()):
                t = inp.nth(i).get_attribute("type") or "text"
                if t in {"text", "url", "search", ""}:
                    inp.nth(i).fill(LANDING)
                    filled = True
                    print("link_filled", t)
                    break
            if not filled:
                page.keyboard.type(LANDING, delay=10)
                print("link_typed")
            for lab in ("완료", "추가", "저장"):
                if page.get_by_role("button", name=lab).count():
                    page.get_by_role("button", name=lab).last.click()
                    print("link_saved", lab)
                    time.sleep(1)
                    break
        else:
            print("link_add_missing")

        # 바깥 완료
        done = page.locator('[role="dialog"]').get_by_role("button", name="완료")
        if done.count():
            done.first.click(force=True)
            print("outer_done")
            time.sleep(2)

        page.goto("https://www.threads.com/@siastreet", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2.5)
        after = page.evaluate("() => ({title: document.title, text: (document.body.innerText||'').slice(0,700)})")
        print("AFTER", json.dumps(after, ensure_ascii=False)[:800])
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
