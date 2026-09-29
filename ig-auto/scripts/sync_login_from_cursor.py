#!/usr/bin/env python3
"""Cursor 브라우저에 로그인된 IG/Threads 세션 → Playwright 자동발행 프로필로 복사."""
from __future__ import annotations

import json
import shutil
import sqlite3
import tempfile
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "data" / "browser-profile"
COOKIE_JSON = ROOT / "data" / "ig-cookies.json"
LOG = ROOT / "data" / "run.log"
SRC = Path.home() / "Library/Application Support/Cursor/Partitions/cursor-browser/Cookies"
KST = ZoneInfo("Asia/Seoul")


def log(msg: str) -> None:
    line = f"{datetime.now(KST).isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_cookies() -> list[dict]:
    if not SRC.exists():
        raise SystemExit(f"Cursor 브라우저 쿠키 없음: {SRC}\nCursor에서 @glowsiax 로그인 후 다시 실행하세요.")
    td = Path(tempfile.mkdtemp())
    shutil.copy2(SRC, td / "Cookies")
    con = sqlite3.connect(str(td / "Cookies"))
    rows = con.execute(
        """
        SELECT host_key, name, value, path, expires_utc, is_secure, is_httponly, samesite
        FROM cookies
        WHERE host_key LIKE '%instagram%' OR host_key LIKE '%threads%'
        """
    ).fetchall()
    con.close()
    cookies = []
    for host, name, value, path, expires_utc, is_secure, is_httponly, samesite in rows:
        if not value:
            continue
        expires = -1
        if expires_utc and expires_utc > 0:
            expires = int(expires_utc / 1_000_000 - 11644473600)
        ss = {0: "None", 1: "Lax", 2: "Strict"}.get(samesite, "Lax")
        item = {
            "name": name,
            "value": value,
            "domain": host,
            "path": path or "/",
            "secure": bool(is_secure),
            "httpOnly": bool(is_httponly),
            "sameSite": ss if ss in ("Strict", "Lax", "None") else "Lax",
        }
        if expires > time.time():
            item["expires"] = expires
        cookies.append(item)
    return cookies


def main() -> int:
    from playwright.sync_api import sync_playwright

    cookies = load_cookies()
    COOKIE_JSON.parent.mkdir(parents=True, exist_ok=True)
    COOKIE_JSON.write_text(
        json.dumps(
            {
                "cookies": cookies,
                "source": "cursor-browser",
                "at": datetime.now(KST).isoformat(timespec="seconds"),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    log(f"login_sync cookies={len(cookies)}")

    PROFILE.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=True,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            ctx.clear_cookies()
        except Exception:
            pass
        ctx.add_cookies(cookies)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)
        ig = page.evaluate(
            """async () => {
          try {
            const r = await fetch('/api/v1/accounts/edit/web_form_data/', {
              credentials:'include',
              headers:{'X-IG-App-ID':'936619743392459','X-Requested-With':'XMLHttpRequest'}
            });
            const t = await r.text();
            let j; try { j = JSON.parse(t); } catch(e) {
              return {ok:false, status:r.status, body:t.slice(0,100)};
            }
            return {ok:true, username:j.form_data?.username||j.username||null};
          } catch(e) { return {ok:false, err:String(e)}; }
        }"""
        )
        log(f"login_sync_ig={json.dumps(ig, ensure_ascii=False)[:300]}")
        page.goto("https://www.threads.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(1.5)
        th = page.evaluate("() => ({href: location.href, text:(document.body?.innerText||'').slice(0,80)})")
        log(f"login_sync_threads={json.dumps(th, ensure_ascii=False)[:250]}")
        ctx.storage_state(path=str(ROOT / "data" / "storage-state.json"))
        ctx.close()

    if not ig.get("ok") or ig.get("username") != "glowsiax":
        log("login_sync_FAIL — Cursor에서 @glowsiax 로그인 후 재실행")
        return 1
    log(f"login_sync_OK @{ig.get('username')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
