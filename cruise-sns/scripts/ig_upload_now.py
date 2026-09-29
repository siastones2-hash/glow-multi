#!/usr/bin/env python3
"""Logged-in IG session → 첫 릴스 업로드 (만들기 UI)."""
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
VIDEO = Path("/Users/apple/glow-multi/cruise-sns/out/hook01.mp4")
SHOT = Path("/tmp/ig-upload")
CTA = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"
CAPTION = (
    "한강 루프탑, 대인 2만 5천 원입니다\n"
    "맥주 한 잔이랑 팝콘이 포함돼요\n"
    "10월 1일부터 13일까지\n"
    "여의도 유람선터미널 4층\n"
    "매일 18:00–02:00\n\n"
    f"{CTA}\n\n.\n.\n.\n\n"
    "#서울크루즈 #루프탑축제 #여의도 #한강 #한강야경 #여의나루 #루프탑바 "
    "#서울데이트 #DJ파티 #10월축제 #한강축제 #서울가볼만한곳 #여의도한강공원 "
    "#클럽분위기 #서울밤 #입장료 #한강루프탑 #서울핫플"
)


def dump(page, tag: str) -> str:
    SHOT.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(SHOT / f"{tag}.png"), full_page=False)
    info = page.evaluate(
        """() => {
      const texts = [...document.querySelectorAll('button, a, div[role=button], span')]
        .map(el => (el.getAttribute('aria-label') || el.innerText || '').trim())
        .filter(t => t && t.length < 40)
        .slice(0, 60);
      const files = document.querySelectorAll('input[type=file]').length;
      return {url: location.href, files, texts};
    }"""
    )
    print(tag, json.dumps(info, ensure_ascii=False)[:700], flush=True)
    return (page.inner_text("body") or "")[:300]


def click_any(page, names) -> str:
    for name in names:
        for kind, loc in (
            ("link", page.get_by_role("link", name=name)),
            ("btn", page.get_by_role("button", name=name)),
            ("svg", page.locator(f'svg[aria-label="{name}"]')),
        ):
            if loc.count():
                try:
                    loc.first.click(timeout=2500, force=True)
                    return f"{kind}:{name}"
                except Exception:
                    pass
        ok = page.evaluate(
            """(name) => {
              const nodes = [...document.querySelectorAll('a, button, div[role=button], span')];
              const hit = nodes.find(el => (el.getAttribute('aria-label')||'').trim()===name
                || (el.innerText||'').trim()===name);
              if (!hit) return false;
              const clickable = hit.closest('a, button, div[role=button]') || hit;
              clickable.click();
              return true;
            }""",
            name,
        )
        if ok:
            return f"js:{name}"
    return ""


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=False,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        dump(page, "01_home")

        hit = click_any(
            page,
            ["만들기", "Create", "새로운 게시물", "New post", "게시물 만들기"],
        )
        print("create_click", hit, flush=True)
        time.sleep(2)
        dump(page, "02_create")

        # 만들기 팝업 안의 '게시물'만 (피드의 게시물 버튼과 구분)
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
        dump(page, "03_type")

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
            time.sleep(10)
            ctx.close()
            return 1

        time.sleep(4)
        # 한글 경로 실패 시 '다른 파일 선택'
        body = page.inner_text("body") or ""
        if "읽지 못했" in body or "찾지 못했" in body:
            print("retry_ascii_file", flush=True)
            click_any(page, ["다른 파일 선택", "Select other file", "파일 선택"])
            time.sleep(1)
            n2 = page.locator('input[type="file"]').count()
            if n2:
                page.locator('input[type="file"]').last.set_input_files(str(VIDEO))
            time.sleep(4)
        time.sleep(4)
        dump(page, "04_file")
        for i in range(6):
            nxt = click_any(page, ["다음", "Next", "확인", "OK"])
            print("next", i, nxt, flush=True)
            if not nxt:
                break
            time.sleep(2.5)
        dump(page, "05_after_next")

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
        dump(page, "06_caption")

        share = click_any(page, ["공유하기", "Share", "릴스 공유"])
        print("share", share, flush=True)
        if not share:
            time.sleep(12)
            dump(page, "07_noshare")
            ctx.close()
            return 1
        for i in range(30):
            time.sleep(1.5)
            body = page.inner_text("body") or ""
            if any(k in body for k in ("공유됨", "Shared", "릴스가 공유", "게시물이 공유")):
                print("SHARED", flush=True)
                dump(page, "08_done")
                ctx.close()
                return 0
        print("share_clicked_no_toast", flush=True)
        dump(page, "08_maybe")
        ctx.close()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
