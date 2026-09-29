#!/usr/bin/env python3
"""라이브 광고: 타겟 서울·경기 20–45, 종료일 10/13. 예산·랜딩은 유지."""
from __future__ import annotations

import os
import time
from pathlib import Path

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)

PROFILE = Path("/Users/apple/glow-multi/ig-auto/data/browser-profile")
SHOT = Path("/tmp/ig-ads-fix")
AD_TOOLS = "https://www.instagram.com/ad_tools/?context=main_navigation"


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    body = page.inner_text("body") or ""
    print(tag, page.url.split("?")[0], body[-900:].replace("\n", " | "), flush=True)
    return body


def click_text(page, name: str) -> bool:
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


def open_edit(page) -> None:
    page.goto(AD_TOOLS, wait_until="domcontentloaded", timeout=60000)
    time.sleep(5)
    dump(page, "f1_dash")
    btn = page.get_by_role("button", name="수정")
    if btn.count():
        btn.first.click()
    else:
        click_text(page, "수정")
    time.sleep(4)
    dump(page, "f2_edit")


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
        open_edit(page)

        # 공개 대상
        click_text(page, "공개 대상") or click_text(page, "타게팅을 통해 선택한 사람들")
        time.sleep(3)
        dump(page, "f3_audience")

        # 직접 만들기
        click_text(page, "직접 만들기")
        time.sleep(2)
        dump(page, "f4_custom")

        # 위치: 대한민국을 서울/경기로
        # 검색창이 있으면 서울 입력
        inputs = page.locator("input")
        print("inputs", inputs.count(), flush=True)
        for i in range(inputs.count()):
            el = inputs.nth(i)
            try:
                if not el.is_visible():
                    continue
                ph = (el.get_attribute("placeholder") or "") + (el.get_attribute("aria-label") or "")
                print("input", i, ph, el.input_value()[:40] if True else "", flush=True)
            except Exception as e:
                print("input_err", i, e, flush=True)

        # 지역 검색
        for label in ("지역", "위치", "도시", "Locations", "Location"):
            if click_text(page, label):
                time.sleep(1)
                break
        dump(page, "f5_loc")

        # 연령
        click_text(page, "연령") or click_text(page, "나이")
        time.sleep(1)
        dump(page, "f6_age")

        # 뒤로 가서 기간
        click_text(page, "완료") or click_text(page, "저장") or click_text(page, "다음")
        time.sleep(2)
        dump(page, "f7_after_aud")

        click_text(page, "예산 및 기간")
        time.sleep(3)
        dump(page, "f8_budget")
        click_text(page, "기간 설정")
        time.sleep(2)
        dump(page, "f9_dates")

        print("HOLD 40s to inspect", flush=True)
        time.sleep(40)
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
