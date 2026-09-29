#!/usr/bin/env python3
"""특정 포스트 URL에 답글 달기."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"


def reply_on_post(post_url: str, text: str, headed: bool = False) -> dict:
    if not PROFILE.exists():
        raise RuntimeError("로그인 필요 — 스레드-로그인.command")

    text = (text or "").strip()[:300]
    if not text:
        raise RuntimeError("답글 내용 없음")
    if not post_url or "threads.com" not in post_url:
        raise RuntimeError("postUrl 필요")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=not headed,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(post_url, wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(2500)

        if "login" in page.url:
            ctx.close()
            raise RuntimeError("세션 만료 — 스레드-로그인.command")

        # 답글 입력창
        box = page.locator('[contenteditable="true"][role="textbox"]').last
        box.wait_for(state="visible", timeout=10000)
        box.click()
        page.wait_for_timeout(300)
        page.keyboard.type(text, delay=18)
        page.wait_for_timeout(800)
        page.keyboard.press("Meta+Enter")
        page.wait_for_timeout(4500)

        body = page.inner_text("body")
        verified = text in body or text[:12] in body
        ctx.close()

        if not verified:
            # 느린 반영일 수 있어 경고만
            return {"ok": True, "verified": False, "text": text, "postUrl": post_url}
        return {"ok": True, "verified": True, "text": text, "postUrl": post_url}


def main():
    headed = "--headed" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 2:
        print(json.dumps({"error": "usage: threads_reply.py <postUrl> <text>"}))
        sys.exit(1)
    try:
        print(json.dumps(reply_on_post(args[0], args[1], headed=headed), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
