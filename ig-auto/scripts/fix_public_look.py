#!/usr/bin/env python3
"""Threads 이름/소개/사진 + 인스타 링크만 다시 맞춤."""
from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROFILE = ROOT / "data" / "browser-profile"
PIC = ROOT / "out" / "profile-cruise.jpg"
LANDING = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"
NAME = "서울크루즈 루프탑축제"
TH_BIO = "10.1–10.13 여의도 4층\n매일 18:00–02:00 · 대인 2만 5천 원\n입장·문의는 링크"


def main() -> int:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=True,
            viewport={"width": 1280, "height": 980},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # --- Instagram: add website/link via edit sheet ---
        page.goto("https://www.instagram.com/accounts/edit/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        ig = page.evaluate(
            """async (url) => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const text = document.body.innerText || '';
          const inputs = [...document.querySelectorAll('input, textarea')].map(el => ({
            tag: el.tagName, type: el.type||'', name: el.name||'',
            aria: el.getAttribute('aria-label')||'', ph: el.placeholder||'',
            val: (el.value||'').slice(0,60)
          }));
          const buttons = [...document.querySelectorAll('button, a, div[role=button], span')]
            .map(el => (el.innerText||'').trim())
            .filter(t => t && t.length < 24)
            .slice(0, 40);
          // website field
          const web = [...document.querySelectorAll('input')].find(el =>
            /웹사이트|Website|링크|url/i.test((el.getAttribute('aria-label')||'') + (el.placeholder||'') + (el.name||''))
          );
          if (web) {
            const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
            if (proto) proto.call(web, url); else web.value = url;
            web.dispatchEvent(new Event('input', {bubbles:true}));
            web.dispatchEvent(new Event('change', {bubbles:true}));
          }
          const save = [...document.querySelectorAll('button, div[role=button]')].find(b =>
            /제출|저장|Submit|Done|완료/.test((b.innerText||'').trim())
          );
          if (save) { save.click(); await sleep(1500); }
          return {hasWeb: !!web, saved: !!save, inputs, buttons, text: text.slice(0,500)};
        }""",
            LANDING,
        )
        print("IG_EDIT", json.dumps(ig, ensure_ascii=False)[:1200])

        # profile page → 링크 추가
        page.goto("https://www.instagram.com/glowsiax/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)
        try:
            page.get_by_text("프로필 편집", exact=False).first.click(timeout=4000)
            time.sleep(2)
        except Exception as e:
            print("ig_edit_click", e)
        try:
            add = page.get_by_text("링크 추가").or_(page.get_by_text("Add links")).or_(page.get_by_text("링크"))
            if add.count():
                add.first.click()
                time.sleep(1.5)
                box = page.locator('input[type="url"], input[type="text"]').last
                if box.count():
                    box.fill(LANDING)
                    time.sleep(0.5)
                for lab in ("완료", "저장", "Done", "추가"):
                    btn = page.get_by_role("button", name=lab)
                    if btn.count():
                        btn.first.click()
                        time.sleep(1)
                        break
                print("ig_link_ui_ok")
            else:
                print("ig_link_btn_missing")
        except Exception as e:
            print("ig_link_fail", e)

        # --- Threads edit dialog (not the compose box) ---
        page.goto("https://www.threads.com/@siastreet", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        try:
            page.get_by_text("프로필 편집", exact=True).first.click(timeout=8000)
            time.sleep(2.5)
        except Exception:
            page.get_by_text("Edit profile", exact=False).first.click(timeout=5000)
            time.sleep(2.5)

        dlg = page.locator('[role="dialog"], [aria-modal="true"]').first
        scope = dlg if dlg.count() else page
        print("threads_dialog", dlg.count())

        # dump fields in dialog
        info = page.evaluate(
            """() => {
          const root = document.querySelector('[role=dialog], [aria-modal=true]') || document.body;
          const els = [...root.querySelectorAll('input, textarea')].map(el => ({
            tag: el.tagName, type: el.type||'', aria: el.getAttribute('aria-label')||'',
            ph: el.placeholder||'', name: el.name||'', val: (el.value||'').slice(0,40)
          }));
          return {els, text: (root.innerText||'').slice(0,400)};
        }"""
        )
        print("TH_FIELDS", json.dumps(info, ensure_ascii=False)[:900])

        inputs = scope.locator("input[type='text'], input:not([type]), input[type='search']")
        areas = scope.locator("textarea")
        if inputs.count():
            try:
                inputs.first.fill(NAME)
                print("th_name_filled", inputs.count())
            except Exception as e:
                print("th_name_fail", e)
        if areas.count():
            try:
                areas.first.fill(TH_BIO)
                print("th_bio_filled", areas.count())
            except Exception as e:
                print("th_bio_fail", e)

        fi = scope.locator('input[type="file"]')
        if fi.count() and PIC.exists():
            fi.first.set_input_files(str(PIC))
            time.sleep(2)
            print("th_photo_set")
        else:
            print("th_photo_missing", fi.count())

        for lab in ("완료", "저장", "Done"):
            btn = scope.get_by_role("button", name=lab)
            if btn.count():
                btn.first.click()
                print("th_saved", lab)
                time.sleep(2)
                break

        page.goto("https://www.threads.com/@siastreet", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)
        after = page.evaluate("() => ({title: document.title, text: (document.body.innerText||'').slice(0,500)})")
        print("TH_AFTER", json.dumps(after, ensure_ascii=False)[:600])
        ctx.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
