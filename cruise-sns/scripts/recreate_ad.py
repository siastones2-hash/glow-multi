#!/usr/bin/env python3
"""기존 광고 삭제 후, 웹사이트·1만원·서울경기 20-45·10/13 종료로 다시 홍보."""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)

PROFILE = Path("/Users/apple/glow-multi/ig-auto/data/browser-profile")
SHOT = Path("/tmp/ig-ads-fix")
REEL = "https://www.instagram.com/glowsiax/reel/Dd1A7k5PsYd/"
LANDING = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"
CAMPAIGN = Path("/Users/apple/glow-multi/cruise-sns/ads/campaign.json")
AD_TOOLS = "https://www.instagram.com/ad_tools/?context=main_navigation"


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    body = page.inner_text("body") or ""
    print(tag, body[body.find("광고") : body.find("광고") + 220].replace("\n", " | ") if "광고" in body else body[:180].replace("\n", " | "), flush=True)
    return body


def click_text(page, name: str, min_w: int = 4) -> bool:
    loc = page.get_by_text(name, exact=True)
    for i in range(loc.count()):
        el = loc.nth(i)
        try:
            if not el.is_visible():
                continue
            box = el.bounding_box()
            if not box or box["width"] < min_w:
                continue
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            print("clicked", name, i, int(box["width"]), flush=True)
            return True
        except Exception:
            continue
    return False


def daily_amt(body: str) -> int:
    for pat in (r"일일 예산:\s*₩([0-9,]+)", r"일일 ₩([0-9,]+)", r"일일 예산[:\s]*₩([0-9,]+)"):
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


def delete_live(page) -> None:
    page.goto(AD_TOOLS, wait_until="domcontentloaded", timeout=60000)
    time.sleep(5)
    dump(page, "r1_dash")
    if not click_text(page, "삭제"):
        btn = page.get_by_role("button", name="삭제")
        if btn.count():
            btn.first.click()
    time.sleep(2)
    dump(page, "r2_dlg")
    dlg = page.locator("[role=dialog]")
    if dlg.count():
        try:
            dlg.get_by_text("삭제", exact=True).last.click(timeout=4000, force=True)
            print("dlg delete", flush=True)
        except Exception as e:
            print("dlg", e, flush=True)
            click_text(page, "삭제", min_w=80)
    time.sleep(5)
    dump(page, "r3_gone")


def type_suggest(page, text: str) -> None:
    box = page.locator("input[type=text], input:not([type]), input[type=search]").last
    try:
        box.click()
        box.fill("")
        box.type(text, delay=40)
        time.sleep(1.2)
        click_text(page, text) or page.keyboard.press("Enter")
        print("typed", text, flush=True)
    except Exception as e:
        print("type_fail", text, e, flush=True)


def boost(page) -> int:
    page.goto(REEL, wait_until="domcontentloaded", timeout=60000)
    time.sleep(4)
    dump(page, "r4_reel")
    click_text(page, "릴스 홍보하기") or click_text(page, "다시 홍보하기")
    time.sleep(5)
    dump(page, "r5_form")
    click_text(page, "확인")  # 기존 광고 안내가 남아있으면
    time.sleep(1)

    click_text(page, "웹사이트 방문하기")
    time.sleep(2)
    dump(page, "r6_cta")
    for i in range(page.locator("input").count()):
        el = page.locator("input").nth(i)
        try:
            if not el.is_visible():
                continue
            ph = (el.get_attribute("placeholder") or "") + (el.get_attribute("aria-label") or "")
            if "웹사이트" in ph or "URL" in ph.upper() or el.get_attribute("type") == "url":
                el.fill(LANDING)
                print("url filled", flush=True)
                break
        except Exception:
            continue
    click_text(page, "저장")
    time.sleep(2)
    dump(page, "r7_url")

    # 타겟 직접 만들기
    page.mouse.wheel(0, 400)
    time.sleep(0.5)
    click_text(page, "직접 만들기")
    time.sleep(3)
    dump(page, "r8_custom")

    # 위치: 서울 / 경기
    for loc_name in ("서울", "서울특별시", "경기도", "경기"):
        # 검색 필드
        search = page.locator("input").filter(has=page.locator("xpath=."))
        found = False
        for i in range(page.locator("input").count()):
            el = page.locator("input").nth(i)
            try:
                if not el.is_visible():
                    continue
                ph = (el.get_attribute("placeholder") or "") + (el.get_attribute("aria-label") or "")
                if any(k in ph for k in ("검색", "지역", "위치", "도시", "Search", "Location")):
                    el.click()
                    el.fill(loc_name)
                    time.sleep(1.2)
                    click_text(page, loc_name)
                    print("loc", loc_name, "ph", ph, flush=True)
                    found = True
                    time.sleep(0.8)
                    break
            except Exception:
                continue
        if not found:
            print("no loc input for", loc_name, flush=True)
    dump(page, "r9_locs")

    # 연령 20–45: 슬라이더가 있으면 조절 시도
    sliders = page.locator("[role=slider]")
    print("sliders", sliders.count(), flush=True)
    dump(page, "r10_age")

    # 기간 설정
    page.mouse.wheel(0, 500)
    time.sleep(0.5)
    click_text(page, "기간 설정")
    time.sleep(2)
    dump(page, "r11_dates")

    # 종료일 필드
    for i in range(page.locator("input").count()):
        el = page.locator("input").nth(i)
        try:
            if not el.is_visible():
                continue
            typ = el.get_attribute("type") or ""
            ph = (el.get_attribute("placeholder") or "") + (el.get_attribute("aria-label") or "")
            print("date_input", i, typ, ph, flush=True)
            if "종료" in ph or "끝" in ph or "End" in ph or typ == "date":
                el.click()
                el.fill("2026-10-13")
                print("end date filled", flush=True)
        except Exception:
            continue
    dump(page, "r12_end")

    page.mouse.wheel(0, 600)
    time.sleep(1)
    amt = set_budget(page)
    dump(page, "r13_budget")
    print("AMT", amt, flush=True)
    if not (9000 <= amt <= 12000):
        print("BUDGET FAIL abort", amt, flush=True)
        time.sleep(20)
        return 0

    page.mouse.wheel(0, 700)
    time.sleep(0.5)
    dump(page, "r14_btn")
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
    body = dump(page, "r15_after")
    if "검토" in body or "확인" in body:
        click_text(page, "확인")
        time.sleep(2)
        dump(page, "r16_ok")
    return amt


def verify(page) -> str:
    page.goto(AD_TOOLS, wait_until="domcontentloaded", timeout=60000)
    time.sleep(5)
    body = dump(page, "r17_dash")
    btn = page.get_by_role("button", name="수정")
    if btn.count():
        btn.first.click()
        time.sleep(4)
        body = dump(page, "r18_edit")
    return body


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
        delete_live(page)
        amt = boost(page)
        body = verify(page)
        if CAMPAIGN.exists():
            data = json.loads(CAMPAIGN.read_text(encoding="utf-8"))
            data["daily_budget_krw"] = amt or data.get("daily_budget_krw")
            data["status"] = "reviewing"
            data["geo"] = "서울 · 경기"
            data["age"] = "20–45"
            data["schedule"] = {"start": "2026-09-28", "end": "2026-10-13"}
            CAMPAIGN.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("DONE amt", amt, flush=True)
        print("VERIFY", (body or "")[-500:].replace("\n", " | "), flush=True)
        time.sleep(8)
        ctx.close()
        return 0 if amt else 1


if __name__ == "__main__":
    raise SystemExit(main())
