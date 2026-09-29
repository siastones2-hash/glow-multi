#!/usr/bin/env python3
"""하루 ~1만 원 확인된 뒤 하단 홍보 버튼으로 제출."""
from __future__ import annotations

import os
import re
import time
from pathlib import Path

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)

PROFILE = Path("/Users/apple/glow-multi/ig-auto/data/browser-profile")
SHOT = Path("/tmp/ig-boost")
LANDING = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"
REEL = "https://www.instagram.com/glowsiax/reel/Dd1A7k5PsYd/"


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    body = page.inner_text("body") or ""
    print(tag, body[body.find("일일") : body.find("일일") + 120].replace("\n", " | ") if "일일" in body else body[:160].replace("\n", " | "), flush=True)
    return body


def click_visible(page, name: str) -> bool:
    loc = page.get_by_text(name, exact=True)
    for i in range(loc.count()):
        el = loc.nth(i)
        try:
            if not el.is_visible():
                continue
            box = el.bounding_box()
            if not box or box["width"] < 4:
                continue
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            print("clicked", name, i, box, flush=True)
            return True
        except Exception:
            continue
    return False


def daily_amt(body: str) -> int:
    for pat in (
        r"일일 예산:\s*₩([0-9,]+)",
        r"일일 ₩([0-9,]+)",
        r"일일 예산[:\s]*₩([0-9,]+)",
    ):
        m = re.search(pat, body)
        if m:
            return int(m.group(1).replace(",", ""))
    return 0


def set_budget(page) -> int:
    sl = page.locator("[role=slider]")
    if sl.count():
        track = sl.last.locator("xpath=..").bounding_box() or sl.last.bounding_box()
        if track:
            page.mouse.click(track["x"] + 8, track["y"] + max(track["height"], 10) / 2)
            time.sleep(0.6)
        sl.last.click()
        amt = daily_amt(page.inner_text("body") or "")
        print("after min", amt, flush=True)
        if amt == 0:
            return 0
        key = "ArrowRight" if amt < 9500 else "ArrowLeft"
        for n in range(80):
            page.keyboard.press(key)
            if n % 3 == 2:
                amt = daily_amt(page.inner_text("body") or "")
                print("arrow", n, amt, flush=True)
                if 9500 <= amt <= 11000:
                    break
                if amt > 11000:
                    key = "ArrowLeft"
                elif amt < 9500:
                    key = "ArrowRight"
    time.sleep(0.4)
    return daily_amt(page.inner_text("body") or "")


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=False,
            viewport={"width": 1440, "height": 1100},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(REEL, wait_until="domcontentloaded", timeout=60000)
        time.sleep(4)
        click_visible(page, "릴스 홍보하기") or click_visible(page, "다시 홍보하기")
        time.sleep(5)

        click_visible(page, "웹사이트 방문하기")
        time.sleep(2)
        for i in range(page.locator("input").count()):
            el = page.locator("input").nth(i)
            try:
                if not el.is_visible():
                    continue
                ph = (el.get_attribute("placeholder") or "") + (el.get_attribute("aria-label") or "")
                if "웹사이트" in ph or "URL" in ph.upper() or el.get_attribute("type") == "url":
                    el.fill(LANDING)
                    break
            except Exception:
                continue
        click_visible(page, "저장")
        time.sleep(2)
        page.mouse.wheel(0, 1000)
        time.sleep(1)

        amt = set_budget(page)
        dump(page, "d1_budget")
        print("AMT", amt, flush=True)
        if not (9000 <= amt <= 12000):
            print("BUDGET FAIL", amt, flush=True)
            time.sleep(20)
            ctx.close()
            return 1

        # 하단 파란 버튼까지
        page.mouse.wheel(0, 600)
        time.sleep(0.5)
        dumped = dump(page, "d2_btn")
        started = False
        btn = page.get_by_role("button", name="릴스 홍보하기")
        if btn.count():
            try:
                btn.last.scroll_into_view_if_needed(timeout=3000)
                btn.last.click(timeout=4000)
                print("role button click", flush=True)
                started = True
            except Exception as e:
                print("role btn", e, flush=True)
        if not started:
            loc = page.get_by_text("릴스 홍보하기", exact=True)
            for i in range(loc.count()):
                box = loc.nth(i).bounding_box()
                if box and box["width"] > 120:
                    page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    print("wide click", box, flush=True)
                    started = True
                    break
        time.sleep(4)
        body = dump(page, "d3_after")
        if "검토" in body or "확인" in body:
            click_visible(page, "확인")
            time.sleep(2)
            dump(page, "d4_ok")
        print("FINAL", (page.inner_text("body") or "")[:800].replace("\n", " | "), flush=True)
        print("HOLD 60s", flush=True)
        time.sleep(60)
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
