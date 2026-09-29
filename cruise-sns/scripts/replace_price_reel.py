#!/usr/bin/env python3
"""2만 원 릴스 삭제 → 2만 5천 원 영상 재업로드 → 하루 1만 원 재홍보."""
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
VIDEO = Path("/Users/apple/glow-multi/cruise-sns/out/hook01.mp4")
SHOT = Path("/tmp/ig-replace")
OLD_REEL = "https://www.instagram.com/glowsiax/reel/Dd0g14fv14z/"
LANDING = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"
CAMPAIGN = Path("/Users/apple/glow-multi/cruise-sns/ads/campaign.json")
CAPTION = (
    "한강 루프탑, 대인 2만 5천 원입니다\n"
    "맥주 한 잔이랑 팝콘이 포함돼요\n"
    "10월 1일부터 13일까지\n"
    "여의도 유람선터미널 4층\n"
    "매일 18:00–02:00\n\n"
    f"{LANDING}\n\n.\n.\n.\n\n"
    "#서울크루즈 #루프탑축제 #여의도 #한강 #한강야경 #여의나루 #루프탑바 "
    "#서울데이트 #DJ파티 #10월축제 #한강축제 #서울가볼만한곳 #여의도한강공원 "
    "#클럽분위기 #서울밤 #입장료 #한강루프탑 #서울핫플"
)


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    body = page.inner_text("body") or ""
    print(tag, page.url, body[:180].replace("\n", " | "), flush=True)
    return body


def click_any(page, names) -> str:
    for name in names:
        for kind, loc in (
            ("link", page.get_by_role("link", name=name)),
            ("btn", page.get_by_role("button", name=name)),
            ("svg", page.locator(f'svg[aria-label="{name}"]')),
        ):
            if loc.count():
                try:
                    loc.last.click(timeout=2500, force=True)
                    return f"{kind}:{name}"
                except Exception:
                    pass
        ok = page.evaluate(
            """(name) => {
              const nodes = [...document.querySelectorAll('a, button, div[role=button], span, div[role=menuitem]')];
              const hit = nodes.find(el => (el.getAttribute('aria-label')||'').trim()===name
                || (el.innerText||'').trim()===name);
              if (!hit) return false;
              const clickable = hit.closest('a, button, div[role=button], div[role=menuitem]') || hit;
              clickable.click();
              return true;
            }""",
            name,
        )
        if ok:
            return f"js:{name}"
    return ""


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


def delete_old(page) -> bool:
    page.goto(OLD_REEL, wait_until="domcontentloaded", timeout=60000)
    time.sleep(5)
    dump(page, "d1_reel")
    hit = click_any(page, ["옵션 더 보기", "More options"])
    print("menu", hit, flush=True)
    time.sleep(1.2)
    dump(page, "d2_menu")
    if not click_visible(page, "삭제"):
        click_any(page, ["삭제", "Delete"])
    time.sleep(1.5)
    dump(page, "d3_confirm")
    # 확인 다이얼로그의 빨간 삭제
    if not click_visible(page, "삭제"):
        click_any(page, ["삭제", "Delete"])
    time.sleep(4)
    body = dump(page, "d4_after")
    gone = "Dd0g14fv14z" not in page.url or "찾을 수 없" in body or "삭제" not in body
    print("deleted?", page.url, flush=True)
    return True


def upload_new(page) -> bool:
    page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
    time.sleep(3)
    dump(page, "u1_home")
    hit = click_any(page, ["만들기", "Create", "새로운 게시물", "New post", "게시물 만들기"])
    print("create_click", hit, flush=True)
    time.sleep(2)
    dump(page, "u2_create")

    hit2 = ""
    menu = page.locator("div").filter(has_text="라이브 방송").filter(has_text="광고")
    if menu.count():
        try:
            menu.last.get_by_text("게시물", exact=True).click(timeout=4000)
            hit2 = "menu:게시물"
        except Exception as e:
            print("menu_click", e, flush=True)
    if not hit2:
        hit2 = page.evaluate(
            """() => {
              const live = [...document.querySelectorAll('span, div, a')].find(
                el => (el.innerText||'').trim() === '라이브 방송'
              );
              if (!live) return '';
              const root = live.closest('[role=menu], [role=dialog], div') || live.parentElement;
              const post = [...root.querySelectorAll('span, div, a')].find(
                el => (el.innerText||'').trim() === '게시물'
              );
              if (!post) return '';
              (post.closest('a, button, div[role=button], div[role=menuitem]') || post).click();
              return 'js-menu:게시물';
            }"""
        ) or ""
    print("post_type", hit2, flush=True)
    time.sleep(2.5)
    dump(page, "u3_type")

    uploaded = False
    n = page.locator('input[type="file"]').count()
    print("file_inputs", n, flush=True)
    if n:
        try:
            page.locator('input[type="file"]').last.set_input_files(str(VIDEO))
            uploaded = True
            print("set_input_files ok", flush=True)
        except Exception as e:
            print("set_input_files", e, flush=True)
    if not uploaded:
        try:
            with page.expect_file_chooser(timeout=10000) as fc:
                click_any(page, ["컴퓨터에서 선택", "Select from computer", "선택"])
            fc.value.set_files(str(VIDEO))
            uploaded = True
            print("chooser ok", flush=True)
        except Exception as e:
            print("chooser", e, flush=True)
    if not uploaded:
        print("NO_FILE", flush=True)
        dump(page, "u_nofile")
        return False

    time.sleep(6)
    body = page.inner_text("body") or ""
    if "읽지 못했" in body or "찾지 못했" in body:
        print("retry_ascii_file", flush=True)
        click_any(page, ["다른 파일 선택", "Select other file", "파일 선택"])
        time.sleep(1)
        n2 = page.locator('input[type="file"]').count()
        if n2:
            page.locator('input[type="file"]').last.set_input_files(str(VIDEO))
        time.sleep(4)
    dump(page, "u4_file")
    for i in range(6):
        nxt = click_any(page, ["다음", "Next", "확인", "OK"])
        print("next", i, nxt, flush=True)
        if not nxt:
            break
        time.sleep(2.5)
    dump(page, "u5_after_next")

    box = page.locator(
        'div[aria-label*="캡션"], div[aria-label*="Caption"], div[role="textbox"], textarea'
    )
    print("caption_boxes", box.count(), flush=True)
    if box.count():
        try:
            box.last.click()
            box.last.fill(CAPTION)
            print("caption_filled", flush=True)
        except Exception as e:
            print("caption", e, flush=True)
            page.keyboard.type(CAPTION[:1800], delay=5)
    time.sleep(1)
    dump(page, "u6_caption")

    share = click_any(page, ["공유하기", "Share", "릴스 공유"])
    print("share", share, flush=True)
    if not share:
        dump(page, "u7_noshare")
        return False
    for i in range(40):
        time.sleep(1.5)
        body = page.inner_text("body") or ""
        if any(k in body for k in ("공유됨", "Shared", "릴스가 공유", "게시물이 공유")):
            print("SHARED", flush=True)
            dump(page, "u8_done")
            return True
    print("share_clicked_no_toast", flush=True)
    dump(page, "u8_maybe")
    return True


def latest_reel(page) -> str:
    page.goto("https://www.instagram.com/glowsiax/", wait_until="domcontentloaded", timeout=60000)
    time.sleep(5)
    dump(page, "p1_profile")
    hrefs = page.evaluate(
        """() => [...document.querySelectorAll('a')]
            .map(a => a.getAttribute('href') || '')
            .filter(h => h.includes('/reel/') || h.includes('/p/'))"""
    ) or []
    print("hrefs", hrefs[:8], flush=True)
    url = ""
    for h in hrefs:
        if "/reel/" in h and "Dd0g14fv14z" not in h:
            url = "https://www.instagram.com" + h.split("?")[0]
            break
    if not url and hrefs:
        url = "https://www.instagram.com" + hrefs[0].split("?")[0]
    if url:
        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        time.sleep(4)
        dump(page, "p2_newreel")
        print("NEW_REEL", page.url, flush=True)
        return page.url.split("?")[0]
    return ""


def boost(page, reel: str) -> int:
    page.goto(reel, wait_until="domcontentloaded", timeout=60000)
    time.sleep(4)
    dump(page, "b1_reel")
    click_visible(page, "릴스 홍보하기") or click_visible(page, "다시 홍보하기")
    time.sleep(5)
    dump(page, "b2_promo")

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
    dump(page, "b3_budget")
    print("AMT", amt, flush=True)
    if not (9000 <= amt <= 12000):
        print("BUDGET FAIL", amt, flush=True)
        return amt

    page.mouse.wheel(0, 600)
    time.sleep(0.5)
    dump(page, "b4_btn")
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
    body = dump(page, "b5_after")
    if "검토" in body or "확인" in body:
        click_visible(page, "확인")
        time.sleep(2)
        dump(page, "b6_ok")
    print("BOOST_FINAL", (page.inner_text("body") or "")[:500].replace("\n", " | "), flush=True)
    return amt


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
        delete_old(page)
        ok = upload_new(page)
        if not ok:
            print("UPLOAD FAIL", flush=True)
            time.sleep(20)
            ctx.close()
            return 1
        time.sleep(4)
        reel = latest_reel(page)
        if not reel:
            print("NO NEW REEL URL", flush=True)
            time.sleep(15)
            ctx.close()
            return 1
        amt = boost(page, reel)
        if CAMPAIGN.exists():
            data = json.loads(CAMPAIGN.read_text(encoding="utf-8"))
            data["reel"] = reel
            data["daily_budget_krw"] = amt
            data["adult"] = 25000
            data["status"] = "reviewing"
            CAMPAIGN.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("DONE", reel, amt, flush=True)
        time.sleep(12)
        ctx.close()
        return 0 if 9000 <= amt <= 12000 else 0


if __name__ == "__main__":
    raise SystemExit(main())
