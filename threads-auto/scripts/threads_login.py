#!/usr/bin/env python3
"""Threads 1회 로그인 — 브라우저 열리면 본인 계정으로 로그인 후 창 닫기."""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
STORAGE = ROOT / "data" / "threads-storage.json"
PROFILE = ROOT / "data" / "browser-profile"


def main():
    PROFILE.mkdir(parents=True, exist_ok=True)
    (ROOT / "data").mkdir(exist_ok=True)

    print("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    print("  Threads 로그인 창이 열립니다")
    print("  1) Instagram/Threads 계정으로 로그인")
    print("  2) 홈 화면 보이면 이 터미널로 돌아와 Enter")
    print("━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            str(PROFILE),
            headless=False,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.threads.net/login", wait_until="domcontentloaded")

        input("로그인 끝났으면 Enter 키… ")

        # 홈으로 이동 확인
        if "login" in page.url:
            page.goto("https://www.threads.net/", wait_until="domcontentloaded")

        ctx.storage_state(path=str(STORAGE))

        meta = {"url": page.url, "title": page.title()}
        (ROOT / "data" / "threads-session-meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2) + "\n"
        )
        ctx.close()

    print(f"\n✅ 저장 완료: {STORAGE}")
    print("   이제 UI에서 글 발행 가능합니다.\n")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(1)
