#!/usr/bin/env python3
"""Export Instagram cookies from Playwright profile to ig-cookies.json (after login)."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "data" / "browser-profile"
OUT = ROOT / "data" / "ig-cookies.json"


def main() -> int:
    from playwright.sync_api import sync_playwright

    PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=True,
            viewport={"width": 1280, "height": 900},
        )
        cookies = [c for c in ctx.cookies() if "instagram.com" in c.get("domain", "")]
        ctx.close()
    if not any(c["name"] == "sessionid" for c in cookies):
        print("sessionid 없음 — 먼저 로그인.command 실행")
        return 1
    csrf = next((c["value"] for c in cookies if c["name"] == "csrftoken"), None)
    OUT.write_text(
        json.dumps({"cookies": cookies, "csrftoken": csrf}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"saved {len(cookies)} cookies -> {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
