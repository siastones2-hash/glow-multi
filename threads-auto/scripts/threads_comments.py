#!/usr/bin/env python3
"""프로필 최근 글의 댓글(답글) 수집 → JSON stdout."""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / "data" / "browser-profile"
BASE = "https://www.threads.com"


def handle_from_argv() -> str:
    for a in sys.argv[1:]:
        if a.startswith("--user="):
            return a.split("=", 1)[1].lstrip("@")
    cfg = ROOT / "config" / "diary.json"
    if cfg.exists():
        try:
            return json.loads(cfg.read_text()).get("profileHandle") or "leestones2"
        except Exception:
            pass
    return "leestones2"


def normalize_url(href: str) -> str:
    if not href:
        return ""
    if href.startswith("http"):
        return href.split("?")[0]
    if href.startswith("/"):
        return BASE + href.split("?")[0]
    return ""


def fetch_comments(max_posts: int = 5, headed: bool = False) -> dict:
    if not PROFILE.exists():
        raise RuntimeError("로그인 필요 — 스레드-로그인.command")

    handle = handle_from_argv()
    items = []

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=not headed,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(f"{BASE}/@{handle}", wait_until="domcontentloaded", timeout=60000)
        page.wait_for_timeout(3500)

        if "login" in page.url:
            ctx.close()
            raise RuntimeError("세션 만료 — 스레드-로그인.command")

        # 최근 포스트 링크
        hrefs = []
        for a in page.locator('a[href*="/post/"]').all():
            href = normalize_url(a.get_attribute("href") or "")
            if href and href not in hrefs:
                hrefs.append(href)
            if len(hrefs) >= max_posts:
                break

        for post_url in hrefs:
            try:
                page.goto(post_url, wait_until="domcontentloaded", timeout=60000)
                page.wait_for_timeout(2500)
            except Exception:
                continue

            body = page.inner_text("body")
            # 원글 미리보기: 본문 앞부분
            post_preview = re.sub(r"\s+", " ", body)[:160]

            # 답글 블록 추정: @유저명 + 짧은 텍스트
            # Threads DOM이 자주 바뀌므로 링크 기반 유저 + 근처 텍스트 수집
            user_links = page.locator(f'a[href^="/@"]').all()
            seen = set()
            for link in user_links[:40]:
                href = link.get_attribute("href") or ""
                m = re.match(r"^/@([^/]+)/?$", href)
                if not m:
                    continue
                username = m.group(1)
                if username.lower() == handle.lower():
                    continue
                try:
                    # 카드성 상위 컨테이너 텍스트
                    parent = link.locator("xpath=ancestor::div[contains(@class,'x')][3]")
                    block = ""
                    if parent.count():
                        block = parent.first.inner_text(timeout=1000)
                    else:
                        block = link.evaluate(
                            """el => {
                              let n = el;
                              for (let i=0;i<6 && n;i++) n = n.parentElement;
                              return n ? n.innerText : el.innerText;
                            }"""
                        )
                except Exception:
                    continue

                lines = [ln.strip() for ln in (block or "").splitlines() if ln.strip()]
                # 유저명 줄 제외한 첫 실질 텍스트
                text = ""
                for ln in lines:
                    if ln.lstrip("@") == username:
                        continue
                    if ln in ("팔로우", "Follow", "답글", "Reply", "번역", "Translate"):
                        continue
                    if re.fullmatch(r"\d+[시간일분초주방금]+|\d+h|\d+m|\d+d", ln):
                        continue
                    if len(ln) < 2:
                        continue
                    text = ln
                    break
                if not text or len(text) > 400:
                    continue
                key = f"{post_url}::{username}::{text[:40]}"
                if key in seen:
                    continue
                seen.add(key)
                items.append(
                    {
                        "key": key,
                        "username": username,
                        "text": text,
                        "postUrl": post_url,
                        "postPreview": post_preview,
                    }
                )

        ctx.close()

    return {"ok": True, "handle": handle, "count": len(items), "items": items}


def main():
    headed = "--headed" in sys.argv
    max_posts = 5
    for a in sys.argv[1:]:
        if a.startswith("--max="):
            max_posts = int(a.split("=", 1)[1])
    try:
        print(json.dumps(fetch_comments(max_posts=max_posts, headed=headed), ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        sys.exit(1)


if __name__ == "__main__":
    main()
