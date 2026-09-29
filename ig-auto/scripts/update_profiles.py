#!/usr/bin/env python3
"""Update IG @glowsiax + Threads @siastreet → 서울크루즈 루프탑축제."""
from __future__ import annotations

import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PHOTO_DIR = ROOT.parent / "docs" / "cruise-festival" / "assets" / "photos"
PROFILE = ROOT / "data" / "browser-profile"
LOG = ROOT / "data" / "run.log"
OUT_PIC = ROOT / "out" / "profile-cruise.jpg"

IG_NAME = "서울크루즈 루프탑축제"
IG_BIO = (
    "10.1–10.13 여의도 유람선터미널 4층\n"
    "매일 18:00–02:00\n"
    "대인 2만 5천 원 (맥주+팝콘)\n"
    "문의 02-1661-3394"
)
IG_WEBSITE = "https://siastones2-hash.github.io/glow-multi/cruise-festival/?v=fee#pay"

TH_NAME = "서울크루즈 루프탑축제"
TH_BIO = (
    "10.1–10.13 여의도 4층 루프탑축제\n"
    "매일 18:00–02:00 · 대인 2만 5천 원\n"
    "입장·문의 링크"
)


def log(msg: str) -> None:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    line = f"{datetime.now(ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def ensure_profile_pic() -> Path:
    from PIL import Image

    OUT_PIC.parent.mkdir(parents=True, exist_ok=True)
    src = None
    for name in ("sc-sign-night.jpg", "night-hero.jpg", "sc-63.jpg", "hero.jpg"):
        p = PHOTO_DIR / name
        if p.exists():
            src = p
            break
    if not src:
        raise SystemExit(f"축제 사진 없음: {PHOTO_DIR}")
    im = Image.open(src).convert("RGB")
    w, h = im.size
    s = min(w, h)
    left = (w - s) // 2
    top = (h - s) // 2
    im = im.crop((left, top, left + s, top + s)).resize((720, 720))
    im.save(OUT_PIC, "JPEG", quality=95)
    return OUT_PIC


def main() -> int:
    from playwright.sync_api import sync_playwright

    pic = ensure_profile_pic()
    log(f"profile_pic={pic}")

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=True,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        if "login" in page.url:
            log("IG login required — ig-auto/로그인.command")
            ctx.close()
            return 2

        api = page.evaluate(
            """async ({name, bio, website}) => {
          const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
          const claim = sessionStorage.getItem('www-claim-v2') || localStorage.getItem('www-claim-v2');
          const h = {
            'X-CSRFToken': csrf,
            'X-IG-App-ID': '936619743392459',
            'X-Requested-With': 'XMLHttpRequest',
          };
          if (claim) h['X-IG-WWW-Claim'] = claim;
          let form = {};
          try {
            const g = await fetch('/api/v1/accounts/edit/web_form_data/', {credentials:'include', headers:h});
            const j = await g.json();
            form = j.form_data || j || {};
          } catch (e) { form = {}; }
          const body = new URLSearchParams({
            first_name: name,
            biography: bio,
            external_url: website,
            username: form.username || 'glowsiax',
            email: form.email || '',
            phone_number: form.phone_number || '',
            chaining_enabled: 'on',
          });
          const r = await fetch('/api/v1/web/accounts/edit/', {
            method:'POST', credentials:'include',
            headers:{...h, 'Content-Type':'application/x-www-form-urlencoded'},
            body,
          });
          const t = await r.text();
          let j; try { j = JSON.parse(t); } catch(e) { return {ok:false, status:r.status, body:t.slice(0,200)}; }
          return {ok: j.status==='ok', status:r.status, msg:j.message, user:j.user?.full_name, bio:j.user?.biography};
        }""",
            {"name": IG_NAME, "bio": IG_BIO, "website": IG_WEBSITE},
        )
        log(f"ig_api_edit={json.dumps(api, ensure_ascii=False)[:500]}")

        # UI backup
        page.goto("https://www.instagram.com/accounts/edit/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(3)
        filled = page.evaluate(
            """async ({name, bio, website}) => {
          const sleep = (ms) => new Promise(r => setTimeout(r, ms));
          const setVal = (el, v) => {
            if (!el) return false;
            el.focus();
            const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (setter) setter.call(el, v); else el.value = v;
            el.dispatchEvent(new Event('input', {bubbles:true}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
            return true;
          };
          const inputs = [...document.querySelectorAll('input, textarea')];
          const pick = (preds) => inputs.find(el => preds.some(fn => fn(el)));
          const nameInput = pick([
            el => /이름|성명|Name/i.test(el.getAttribute('aria-label')||''),
            el => /이름|성명|Name/i.test(el.placeholder||''),
          ]);
          const bioInput = pick([
            el => el.tagName==='TEXTAREA',
            el => /소개|바이오|Bio/i.test(el.getAttribute('aria-label')||''),
          ]);
          const webInput = pick([
            el => /웹사이트|Website|링크/i.test(el.getAttribute('aria-label')||''),
            el => /website|url|http/i.test(el.name||''),
            el => /웹사이트|Website/i.test(el.placeholder||''),
          ]);
          const okName = setVal(nameInput, name);
          const okBio = setVal(bioInput, bio);
          const okWeb = setVal(webInput, website);
          const btn = [...document.querySelectorAll('button, div[role=button]')].find(b =>
            /제출|저장|Submit|Done|완료/.test((b.innerText||b.textContent||'').trim())
          );
          if (btn) { btn.click(); await sleep(2000); }
          return {okName, okBio, okWeb, nInputs: inputs.length};
        }""",
            {"name": IG_NAME, "bio": IG_BIO, "website": IG_WEBSITE},
        )
        log(f"ig_ui_edit={json.dumps(filled, ensure_ascii=False)[:400]}")

        try:
            page.goto("https://www.instagram.com/accounts/edit/", wait_until="domcontentloaded")
            time.sleep(2)
            change = page.get_by_text("프로필 사진 변경").or_(page.get_by_text("Change profile photo"))
            if change.count():
                change.first.click()
                time.sleep(1)
            file_inputs = page.locator('input[type="file"]')
            if file_inputs.count():
                file_inputs.first.set_input_files(str(pic))
                time.sleep(2)
                for label in ("완료", "저장", "Done", "Submit"):
                    btn = page.get_by_role("button", name=label)
                    if btn.count():
                        btn.first.click()
                        break
                time.sleep(2)
                log("ig_photo_upload_attempted")
            else:
                log("ig_photo_input_not_found")
        except Exception as e:
            log(f"ig_photo_fail {e}")

        try:
            page.goto("https://www.threads.com/@siastreet", wait_until="domcontentloaded", timeout=60000)
            time.sleep(2)
            edit = page.get_by_text("프로필 편집").or_(page.get_by_text("Edit profile"))
            if edit.count():
                edit.first.click()
                time.sleep(2)
                bio_box = page.locator("textarea").first
                if bio_box.count():
                    bio_box.fill(TH_BIO)
                name_box = page.locator('input[type="text"]').first
                if name_box.count():
                    try:
                        name_box.fill(TH_NAME)
                    except Exception:
                        pass
                fi = page.locator('input[type="file"]')
                if fi.count():
                    fi.first.set_input_files(str(pic))
                    time.sleep(1.5)
                for label in ("완료", "저장", "Done"):
                    btn = page.get_by_role("button", name=label)
                    if btn.count():
                        btn.first.click()
                        break
                time.sleep(2)
                log("threads_profile_edit_attempted")
            else:
                snippet = page.evaluate("() => (document.body.innerText||'').slice(0,300)")
                log(f"threads_edit_btn_missing snippet={snippet[:200]}")
        except Exception as e:
            log(f"threads_profile_fail {e}")

        ctx.close()
    log("profile_update_done cruise")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
