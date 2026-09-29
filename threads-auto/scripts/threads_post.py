#!/usr/bin/env python3
"""browser-profile로 Threads 텍스트 발행."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
SHOT = ROOT / "data" / "browser-profile-check"
BASE = "https://www.threads.com"


def post_text(text: str, headed: bool = False) -> dict:
    if not PROFILE.exists():
        raise RuntimeError("로그인 필요 — 스레드-로그인.command")

    text = (text or "").strip()[:500]
    if not text:
        raise RuntimeError("글 내용 없음")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=not headed,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(BASE + "/", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)

        if "login" in page.url:
            ctx.close()
            raise RuntimeError("세션 만료 — 스레드-로그인.command")

        page.get_by_role("button", name="만들기").first.click(timeout=8000)
        page.wait_for_timeout(1500)

        dialog = page.locator('[role="presentation"]').filter(has_text="새로운 스레드").first
        if not dialog.count():
            dialog = page.locator('[role="dialog"]').first

        box = page.locator('[contenteditable="true"][role="textbox"]').last
        box.wait_for(state="visible", timeout=8000)
        box.click()
        page.wait_for_timeout(300)
        page.keyboard.type(text, delay=20)
        page.wait_for_timeout(1200)

        # 게시: Cmd+Enter가 가장 안정적 (클릭은 상단/옵션 버튼과 혼동)
        page.keyboard.press("Meta+Enter")
        page.wait_for_timeout(6000)

        # 모달 닫힘 확인 (남아 있으면 y>400 게시 버튼 클릭)
        if page.locator('[contenteditable="true"][role="textbox"]').count():
            for i in range(page.get_by_role("button", name="게시").count()):
                b = page.get_by_role("button", name="게시").nth(i)
                bb = b.bounding_box()
                if bb and bb["y"] > 400 and b.is_enabled():
                    b.click()
                    break
            page.wait_for_timeout(6000)

        # 프로필에서 확인 (사이드바 '새로운 스레드' 텍스트로는 판별 불가)
        page.goto(BASE + "/@leestones2", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(5000)
        body = page.inner_text("body")
        verified = text in body or text[:15] in body

        if not verified:
            # 한 번 더 홈 갔다 프로필 새로고침
            page.reload(wait_until="domcontentloaded")
            page.wait_for_timeout(4000)
            body = page.inner_text("body")
            verified = text in body or text[:15] in body

        ctx.close()
        if not verified:
            raise RuntimeError(f"프로필에 글 없음: {text!r}")

        return {"ok": True, "verified": True, "text": text, "profile": "@leestones2"}


def main():
    headed = "--headed" in sys.argv
    args = [a for a in sys.argv[1:] if a != "--headed"]
    if not args:
        print(json.dumps({"error": "usage: threads_post.py [--headed] <text>"}))
        sys.exit(1)
    try:
        print(json.dumps(post_text(args[0], headed=headed), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
