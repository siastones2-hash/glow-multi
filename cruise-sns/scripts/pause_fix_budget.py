#!/usr/bin/env python3
"""67만 원 광고 삭제 확인 후, 하루 1만 원으로만 다시 홍보."""
from __future__ import annotations

import os
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
AD_TOOLS = "https://www.instagram.com/ad_tools/?context=main_navigation"


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    body = page.inner_text("body") or ""
    print(tag, page.url.split("?")[0], body[:380].replace("\n", " | "), flush=True)
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
            el.scroll_into_view_if_needed(timeout=2500)
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            print("clicked", name, i, flush=True)
            return True
        except Exception:
            continue
    return False


def budget_is_10k(body: str) -> bool:
    return any(
        s in body.replace(" ", "")
        for s in ("₩10,000", "₩10000", "일일₩10,000", "일일예산:₩10,000", "일일예산₩10,000")
    ) or ("10,000" in body and "678,854" not in body)


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=False,
            viewport={"width": 1440, "height": 1000},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        dash = page.get_by_role("link", name="대시보드")
        if dash.count():
            dash.first.click()
        else:
            page.goto(AD_TOOLS, wait_until="domcontentloaded", timeout=60000)
        time.sleep(4)
        body = dump(page, "90_tools")

        still = "검토 중" in body or "삭제" in body and "웹사이트 방문" in body
        if still:
            print("still live, delete", flush=True)
            click_visible(page, "삭제")
            time.sleep(2)
            dump(page, "91_dlg")
            dlg = page.locator("[role=dialog]")
            if dlg.count():
                # 빨간 삭제
                try:
                    dlg.get_by_text("삭제", exact=True).last.click(timeout=4000, force=True)
                    print("dlg force delete", flush=True)
                except Exception as e:
                    print("dlg click", e, flush=True)
                    click_visible(page, "삭제")
            time.sleep(6)
            body = dump(page, "92_deleted")

        # 릴스 다시 홍보
        page.goto(REEL, wait_until="domcontentloaded", timeout=60000)
        time.sleep(4)
        dump(page, "93_reel")
        if not click_visible(page, "다시 홍보하기"):
            click_visible(page, "릴스 홍보하기")
        time.sleep(5)
        dump(page, "94_ads")

        click_visible(page, "웹사이트 방문하기")
        time.sleep(2)
        inputs = page.locator("input")
        for i in range(inputs.count()):
            el = inputs.nth(i)
            try:
                if not el.is_visible():
                    continue
                ph = (el.get_attribute("placeholder") or "") + (el.get_attribute("aria-label") or "")
                if "웹사이트" in ph or "URL" in ph.upper() or el.get_attribute("type") == "url":
                    el.fill(LANDING)
                    print("url ok", flush=True)
                    break
            except Exception:
                continue
        click_visible(page, "저장")
        time.sleep(2)

        page.mouse.wheel(0, 850)
        time.sleep(1)
        dump(page, "95_budget_ui")

        # 연필 옆 금액 클릭 후 10000
        clicked_amt = page.evaluate(
            """() => {
              const nodes = [...document.querySelectorAll('span,div,label')];
              const hit = nodes.find(el => /₩\\s*678/.test(el.innerText||'') && (el.innerText||'').length < 30);
              if (!hit) return false;
              hit.click();
              return true;
            }"""
        )
        print("click_amount", clicked_amt, flush=True)
        time.sleep(0.4)
        # 보이는 숫자 input
        filled = False
        for i in range(page.locator("input").count()):
            el = page.locator("input").nth(i)
            try:
                if not el.is_visible():
                    continue
                val = el.input_value()
                if "678" in val or "854" in val or el.get_attribute("inputmode") in ("numeric", "decimal"):
                    el.click()
                    el.fill("10000")
                    print("filled input", val, flush=True)
                    filled = True
                    break
            except Exception:
                continue
        if not filled:
            page.keyboard.press("Meta+A")
            page.keyboard.type("10000", delay=40)
            page.keyboard.press("Enter")
            print("typed fallback", flush=True)
        time.sleep(1)

        # 슬라이더를 왼쪽(1만원 쪽)으로
        sl = page.locator("[role=slider]")
        if sl.count():
            box = sl.last.bounding_box()
            if box:
                page.mouse.move(box["x"] + box["width"] * 0.95, box["y"] + box["height"] / 2)
                page.mouse.down()
                page.mouse.move(box["x"] + 8, box["y"] + box["height"] / 2, steps=25)
                page.mouse.up()
                print("dragged slider left", flush=True)
                time.sleep(0.6)
                page.keyboard.press("Meta+A")
                page.keyboard.type("10000", delay=40)
                page.keyboard.press("Enter")

        time.sleep(1)
        body = dump(page, "96_budget_set")
        print("is_10k", budget_is_10k(body), "has_678", "678,854" in body, flush=True)

        if budget_is_10k(body):
            click_visible(page, "릴스 홍보하기")
            time.sleep(5)
            dump(page, "97_started")
        else:
            print("NOT STARTING — budget not 10000", flush=True)

        print("FINAL", (page.inner_text("body") or "")[:900].replace("\n", " | "), flush=True)
        print("HOLD 80s", flush=True)
        time.sleep(80)
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
