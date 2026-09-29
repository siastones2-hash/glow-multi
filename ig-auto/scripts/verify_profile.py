#!/usr/bin/env python3
"""Confirm IG/Threads public look + attach landing link if missing."""
from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "data" / "browser-profile"
LANDING = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=True,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/glowsiax/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        ig = page.evaluate(
            """() => ({
              title: document.title,
              text: (document.body.innerText||'').slice(0,900),
              hasPay: /fee#pay|siastones|입장/.test(document.body.innerText||''),
            })"""
        )
        print("IG", json.dumps(ig, ensure_ascii=False)[:800])

        link = page.evaluate(
            """async (url) => {
          const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
          const claim = sessionStorage.getItem('www-claim-v2') || localStorage.getItem('www-claim-v2');
          const h = {
            'X-CSRFToken': csrf,
            'X-IG-App-ID': '936619743392459',
            'X-Requested-With': 'XMLHttpRequest',
            'Content-Type': 'application/x-www-form-urlencoded',
          };
          if (claim) h['X-IG-WWW-Claim'] = claim;
          const tries = [];
          const bodies = [
            new URLSearchParams({
              updated_links: JSON.stringify([{url, title: '입장료', open_external_url: true}]),
            }),
            new URLSearchParams({
              bio_links: JSON.stringify([{url, title: '입장료'}]),
            }),
          ];
          for (const path of ['/api/v1/accounts/update_bio_links/', '/api/v1/web/accounts/update_bio_links/']) {
            for (const body of bodies) {
              try {
                const r = await fetch(path, {method:'POST', credentials:'include', headers:h, body});
                const t = await r.text();
                let j; try { j = JSON.parse(t); } catch(e) { tries.push({path, status:r.status, body:t.slice(0,120)}); continue; }
                tries.push({path, status:r.status, ok:j.status==='ok', msg:j.message, keys:Object.keys(j).slice(0,8)});
                if (j.status==='ok') return {ok:true, path, tries};
              } catch(e) { tries.push({path, error:String(e).slice(0,80)}); }
            }
          }
          return {ok:false, tries};
        }""",
            LANDING,
        )
        print("LINK", json.dumps(link, ensure_ascii=False)[:700])

        page.goto("https://www.threads.com/@siastreet", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        th = page.evaluate(
            """() => ({
              url: location.href,
              title: document.title,
              text: (document.body.innerText||'').slice(0,900),
            })"""
        )
        print("TH", json.dumps(th, ensure_ascii=False)[:800])
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
