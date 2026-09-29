#!/usr/bin/env python3
"""Delete a Threads post by shortcode or media pk (uses ig-auto browser profile)."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "data" / "browser-profile"
LOG = ROOT / "data" / "run.log"


def log(msg: str) -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    line = f"{datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: delete_threads_post.py <shortcode|pk> [--headed]")
        return 2
    target = sys.argv[1].strip()
    headed = "--headed" in sys.argv

    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=not headed,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.threads.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)

        # Resolve shortcode → pk via post page
        pk = target if target.isdigit() else ""
        shortcode = "" if target.isdigit() else target
        if shortcode:
            url = f"https://www.threads.com/@siastreet/post/{shortcode}"
            page.goto(url, wait_until="domcontentloaded", timeout=60000)
            time.sleep(2)
            pk = page.evaluate(
                """() => {
                  const html = document.documentElement.innerHTML;
                  const m = html.match(/"pk"\\s*:\\s*"?(\\d{15,})"?/)
                    || html.match(/"id"\\s*:\\s*"(\\d{15,})"/);
                  return m ? m[1] : "";
                }"""
            ) or ""
            if not pk:
                # GraphQL / embedded
                pk = page.evaluate(
                    """() => {
                      const scripts = [...document.querySelectorAll('script')].map(s => s.textContent||'');
                      for (const t of scripts) {
                        const m = t.match(/"pk"\\s*:\\s*"(\\d{15,})"/);
                        if (m) return m[1];
                      }
                      return "";
                    }"""
                ) or ""
            log(f"delete_resolve shortcode={shortcode} pk={pk or '?'} url={page.url}")

        if not pk:
            log("delete_fail: pk 확인 불가")
            ctx.close()
            return 1

        # Prefer Threads/IG media delete API
        result = page.evaluate(
            """async (mediaId) => {
              const tryUrls = [
                `https://www.threads.net/api/v1/media/${mediaId}/delete/`,
                `https://www.threads.com/api/v1/media/${mediaId}/delete/`,
                `https://www.instagram.com/api/v1/media/${mediaId}/delete/`,
              ];
              const csrf = (document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)||[])[1] || '';
              let last = {ok:false};
              for (const url of tryUrls) {
                try {
                  const r = await fetch(url, {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                      'X-CSRFToken': csrf,
                      'X-IG-App-ID': '238260118693799',
                      'X-Requested-With': 'XMLHttpRequest',
                      'Content-Type': 'application/x-www-form-urlencoded',
                      'Referer': location.href,
                    },
                    body: 'media_id=' + encodeURIComponent(mediaId),
                  });
                  const t = await r.text();
                  let j = null;
                  try { j = JSON.parse(t); } catch {}
                  last = {ok: r.ok && (!j || j.status === 'ok' || j.status_code === 200), status: r.status, body: t.slice(0,220), url};
                  if (last.ok) return last;
                } catch (e) {
                  last = {ok:false, error: String(e), url};
                }
              }
              return last;
            }""",
            pk,
        )
        log(f"delete_api={json.dumps(result, ensure_ascii=False)[:500]}")

        if not result.get("ok") and shortcode:
            # UI fallback: open menu → 삭제
            page.goto(f"https://www.threads.com/@siastreet/post/{shortcode}", wait_until="domcontentloaded")
            time.sleep(2)
            clicked = page.evaluate(
                """() => {
                  const buttons = [...document.querySelectorAll('div[role="button"], button')];
                  const more = buttons.find(b => /더 보기|More|옵션|Options/i.test(b.getAttribute('aria-label')||b.textContent||''));
                  if (more) { more.click(); return 'more'; }
                  // svg three-dot near article
                  const svgs = [...document.querySelectorAll('svg')];
                  for (const s of svgs) {
                    const lab = s.getAttribute('aria-label') || '';
                    if (/더 보기|More/i.test(lab)) { s.closest('div[role="button"]')?.click(); return 'svg'; }
                  }
                  return '';
                }"""
            )
            time.sleep(1)
            del_clicked = page.evaluate(
                """() => {
                  const items = [...document.querySelectorAll('div[role="menuitem"], button, div[role="button"]')];
                  const del = items.find(el => /^\\s*삭제\\s*$|^\\s*Delete\\s*$/i.test((el.textContent||'').trim()));
                  if (del) { del.click(); return true; }
                  return false;
                }"""
            )
            time.sleep(1)
            confirm = page.evaluate(
                """() => {
                  const items = [...document.querySelectorAll('button, div[role="button"]')];
                  const ok = items.find(el => /삭제|Delete|확인/i.test((el.textContent||'').trim()));
                  if (ok) { ok.click(); return (ok.textContent||'').trim().slice(0,20); }
                  return '';
                }"""
            )
            log(f"delete_ui more={clicked} del={del_clicked} confirm={confirm}")
            time.sleep(2)
            # verify gone
            page.goto(f"https://www.threads.com/@siastreet/post/{shortcode}", wait_until="domcontentloaded")
            time.sleep(2)
            gone = "unavailable" in page.url.lower() or page.evaluate(
                """() => /사용할 수 없|unavailable|삭제|존재하지/i.test(document.body.innerText||'')"""
            )
            result = {"ok": bool(gone or del_clicked), "ui": True, "gone": gone}

        ctx.close()
        return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
