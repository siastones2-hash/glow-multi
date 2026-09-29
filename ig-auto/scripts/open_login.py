#!/usr/bin/env python3
"""로그인된 인스타 창. 창을 닫을 때까지 유지."""
from __future__ import annotations

import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "data" / "browser-profile"


def main() -> int:
    from playwright.sync_api import sync_playwright

    PROFILE.mkdir(parents=True, exist_ok=True)
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
        time.sleep(2)
        print(f"opened {page.url}", flush=True)
        if "accounts/login" in (page.url or ""):
            print("LOGIN_NEEDED", flush=True)
        else:
            print("LOGGED_IN", flush=True)
        while True:
            time.sleep(2)
            try:
                if not ctx.pages:
                    break
            except Exception:
                break
        try:
            ctx.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
