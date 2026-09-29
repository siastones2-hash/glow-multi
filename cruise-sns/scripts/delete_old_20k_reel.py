#!/usr/bin/env python3
"""2만 원 릴스 광고 삭제 후 게시물 삭제. 2만 5천 원 새 릴스 광고는 유지."""
from __future__ import annotations

import os
import time
from pathlib import Path

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)

PROFILE = Path("/Users/apple/glow-multi/ig-auto/data/browser-profile")
SHOT = Path("/tmp/ig-replace")
OLD_REEL = "https://www.instagram.com/glowsiax/reel/Dd0g14fv14z/"
NEW_REEL = "https://www.instagram.com/glowsiax/reel/Dd1A7k5PsYd/"
AD_TOOLS = "https://www.instagram.com/ad_tools/?context=main_navigation"


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    body = page.inner_text("body") or ""
    print(tag, page.url.split("?")[0], body[:420].replace("\n", " | "), flush=True)
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
            print("clicked", name, i, box, flush=True)
            return True
        except Exception:
            continue
    return False


def click_any(page, names) -> str:
    for name in names:
        loc = page.locator(f'svg[aria-label="{name}"]')
        if loc.count():
            try:
                loc.last.click(timeout=2500, force=True)
                return f"svg:{name}"
            except Exception:
                pass
        if click_visible(page, name):
            return f"txt:{name}"
        ok = page.evaluate(
            """(name) => {
              const nodes = [...document.querySelectorAll('a, button, div[role=button], span, div[role=menuitem]')];
              const hit = nodes.find(el => (el.getAttribute('aria-label')||'').trim()===name
                || (el.innerText||'').trim()===name);
              if (!hit) return false;
              (hit.closest('a, button, div[role=button], div[role=menuitem]') || hit).click();
              return true;
            }""",
            name,
        )
        if ok:
            return f"js:{name}"
    return ""


def delete_ads_on_tools(page) -> None:
    page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
    time.sleep(3)
    dash = page.get_by_role("link", name="대시보드")
    if dash.count():
        dash.first.click()
        time.sleep(4)
    else:
        page.goto(AD_TOOLS, wait_until="domcontentloaded", timeout=60000)
        time.sleep(4)
    dump(page, "a1_tools")

    # 카드마다 메뉴 → 삭제. 새 광고까지 지우면 안 되니 텍스트로 2만 원/옛 릴스만.
    body = page.inner_text("body") or ""
    print("ads_body_has_old", "Dd0g14fv14z" in body or "2만 원" in body, flush=True)

    # 목록에 삭제 버튼이 보이면, 첫 번째(보통 최근=새 광고)는 건너뛰고 나머지를 지울 수도 있음.
    # 안전하게: 각 카드 미리보기 텍스트를 보고 2만 원만 삭제.
    deleted = page.evaluate(
        """() => {
          const cards = [...document.querySelectorAll('div, article, li')];
          return cards
            .filter(el => (el.innerText||'').includes('삭제') && (el.innerText||'').length < 800)
            .slice(0, 8)
            .map(el => (el.innerText||'').slice(0, 120).replace(/\\n/g,' | '));
        }"""
    )
    print("cards", deleted, flush=True)


def delete_old_reel_ad_then_post(page) -> int:
    page.goto(OLD_REEL, wait_until="domcontentloaded", timeout=60000)
    time.sleep(5)
    dump(page, "o1_reel")
    # 홍보 배너/인사이트로 광고 관리
    if not click_visible(page, "현재 홍보 중인 게시물입니다."):
        click_visible(page, "인사이트 보기")
    time.sleep(4)
    dump(page, "o2_insight")

    # 광고 삭제/일시중지
    for name in ("삭제", "광고 삭제", "홍보 삭제", "일시 중지", "중지", "종료"):
        if click_visible(page, name):
            time.sleep(1.5)
            dump(page, "o3_dlg")
            dlg = page.locator("[role=dialog]")
            if dlg.count():
                try:
                    dlg.get_by_text("삭제", exact=True).last.click(timeout=4000, force=True)
                    print("dlg delete", flush=True)
                except Exception:
                    click_visible(page, "삭제") or click_visible(page, "확인") or click_visible(page, "중지")
            time.sleep(3)
            dump(page, "o4_adgone")
            break

    # 대시보드에서도 옛 광고 카드 삭제 시도
    page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
    time.sleep(2)
    dash = page.get_by_role("link", name="대시보드")
    if dash.count():
        dash.first.click()
        time.sleep(4)
        dump(page, "o5_dash")
        # 2만 원 / 옛 미디어가 보이면 그 카드의 삭제
        clicked = page.evaluate(
            """() => {
              const nodes = [...document.querySelectorAll('button, span, div[role=button], a')];
              const dels = nodes.filter(el => (el.innerText||'').trim()==='삭제');
              return dels.length;
            }"""
        )
        print("delete_btns", clicked, flush=True)

    # 게시물 삭제
    page.goto(OLD_REEL, wait_until="domcontentloaded", timeout=60000)
    time.sleep(4)
    dump(page, "o6_reel2")
    click_any(page, ["옵션 더 보기", "More options"])
    time.sleep(1.2)
    dump(page, "o7_menu")
    click_visible(page, "삭제")
    time.sleep(1.5)
    dump(page, "o8_confirm")
    dlg = page.locator("[role=dialog]")
    if dlg.count():
        try:
            dlg.get_by_text("삭제", exact=True).last.click(timeout=4000, force=True)
            print("post dlg delete", flush=True)
        except Exception:
            click_visible(page, "삭제")
    time.sleep(5)
    dump(page, "o9_after")

    page.goto("https://www.instagram.com/glowsiax/", wait_until="domcontentloaded", timeout=60000)
    time.sleep(4)
    hrefs = page.evaluate(
        """() => [...document.querySelectorAll('a')]
            .map(a => a.getAttribute('href')||'')
            .filter(h => h.includes('/reel/') || h.includes('/p/')).slice(0,6)"""
    )
    print("profile_hrefs", hrefs, flush=True)
    dump(page, "o10_profile")

    page.goto(NEW_REEL, wait_until="domcontentloaded", timeout=60000)
    time.sleep(4)
    dump(page, "o11_new")
    return 0


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
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        delete_ads_on_tools(page)
        delete_old_reel_ad_then_post(page)
        time.sleep(8)
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
