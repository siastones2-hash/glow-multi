#!/usr/bin/env python3
"""Post via Playwright — IG @glowsiax + Threads @siastreet (3D어라운드 전용)."""
from __future__ import annotations

import json
import os
import random
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

# Cursor/sandbox may point Playwright at an empty cache — pin real browsers
os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "data" / "state.json"
PROFILE = ROOT / "data" / "browser-profile"
LOG = ROOT / "data" / "run.log"
KST = ZoneInfo("Asia/Seoul")
IG_USER = "glowsiax"
THREADS_USER = "siastreet"  # owner OK: interim until @glowsiax Threads exists

sys.path.insert(0, str(ROOT / "scripts"))
from post_once import make_image, pick_post, reserve_post, load_state, save_state, log  # noqa: E402


def _inject_b64(page, var: str, path: Path) -> None:
    import base64

    b64s = base64.b64encode(path.read_bytes()).decode()
    page.evaluate(f"window.{var} = ''")
    step = 12000
    for i in range(0, len(b64s), step):
        page.evaluate(f"(c) => {{ window.{var} += c; }}", b64s[i : i + step])


def _inject_jpeg(page, image_path: Path) -> None:
    _inject_b64(page, "__IG_JPG_B64", image_path)


def threads_own_profile(page) -> bool:
    """공개 프로필이 아니라, 실제로 @{THREADS_USER} 로 로그인한 상태인지."""
    body = page.inner_text("body") or ""
    return "프로필 편집" in body or "Edit profile" in body


def ensure_threads_login(page) -> dict:
    """스레드 세션이 풀리면 인스타(glowsiax) SSO로 다시 붙임 → @{THREADS_USER}."""
    page.goto(
        f"https://www.threads.com/@{THREADS_USER}",
        wait_until="domcontentloaded",
        timeout=60000,
    )
    time.sleep(2)
    if threads_own_profile(page):
        return {"ok": True, "via": "already"}

    page.goto("https://www.threads.com/login", wait_until="domcontentloaded", timeout=60000)
    time.sleep(2.0)
    clicked = ""
    for name in (
        "Instagram으로 계속하기",
        "Continue with Instagram",
        IG_USER,
    ):
        loc = page.get_by_text(name, exact=False)
        if not loc.count():
            continue
        try:
            loc.first.click(timeout=6000, force=True)
            clicked = name
            break
        except Exception:
            continue
    if not clicked:
        return {"ok": False, "stage": "sso_no_button"}
    time.sleep(5.0)
    page.goto(
        f"https://www.threads.com/@{THREADS_USER}",
        wait_until="domcontentloaded",
        timeout=60000,
    )
    time.sleep(2.0)
    if threads_own_profile(page):
        return {"ok": True, "via": "ig_sso", "clicked": clicked}
    return {
        "ok": False,
        "stage": "sso_not_own_profile",
        "url": page.url,
        "clicked": clicked,
    }


def assert_threads_account(page) -> dict:
    """Ensure we are logged in as @{THREADS_USER} (not just viewing the public page)."""
    login = ensure_threads_login(page)
    check = {
        "href": page.url,
        "login": login,
        "own": threads_own_profile(page) if login.get("ok") else False,
    }
    check["ok"] = bool(login.get("ok") and check["own"])
    if not check["ok"]:
        check["msg"] = f"Threads @{THREADS_USER} 로그인 필요"
    return check


def post_instagram(page, image_path: Path, caption: str) -> dict:
    _inject_jpeg(page, image_path)
    return page.evaluate(
        """async (caption) => {
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
      const claim = sessionStorage.getItem('www-claim-v2') || localStorage.getItem('www-claim-v2');
      const b64 = window.__IG_JPG_B64;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      const uploadId = String(Date.now());
      const name = `fb_uploader_${uploadId}`;
      const ruploadParams = JSON.stringify({media_type:1, upload_id:uploadId, upload_media_height:1080, upload_media_width:1080});
      const up = await fetch(`/rupload_igphoto/${name}`, {
        method:'POST', credentials:'include',
        headers:{
          'Content-Type':'image/jpeg', Offset:'0',
          'X-Entity-Length': String(bytes.length),
          'X-Entity-Name': name+'.jpg',
          'X-Entity-Type':'image/jpeg',
          'X-Instagram-Rupload-Params': ruploadParams,
          'X-CSRFToken': csrf,
          'X-IG-App-ID':'936619743392459',
          ...(claim?{'X-IG-WWW-Claim':claim}:{}),
        },
        body: bytes,
      });
      const upText = await up.text();
      const form = new URLSearchParams({
        upload_id: uploadId, caption, source_type:'library',
        disable_comments:'0', like_and_view_counts_disabled:'0',
      });
      const cfg = await fetch('/api/v1/media/configure/', {
        method:'POST', credentials:'include',
        headers:{
          'Content-Type':'application/x-www-form-urlencoded',
          'X-CSRFToken': csrf, 'X-IG-App-ID':'936619743392459',
          'X-Requested-With':'XMLHttpRequest',
          ...(claim?{'X-IG-WWW-Claim':claim}:{}),
        },
        body: form,
      });
      const t = await cfg.text();
      let j; try { j = JSON.parse(t); } catch(e) { return {ok:false, stage:'configure', status:cfg.status, body:t.slice(0,200)}; }
      return {ok: j.status==='ok', status:cfg.status, upload:up.status, upBody:upText.slice(0,80), media:j.media?.code||j.media?.pk, msg:j.message};
    }""",
        caption,
    )


def post_instagram_reel(
    page,
    video_path: Path,
    caption: str,
    cover_path: Path | None = None,
    duration_sec: float = 7.0,
    width: int = 1080,
    height: int = 1920,
) -> dict:
    """Upload a vertical MP4 as Reels (clips) + share to feed."""
    _inject_b64(page, "__IG_VID_B64", video_path)
    if cover_path and cover_path.exists():
        _inject_b64(page, "__IG_COVER_B64", cover_path)
    else:
        page.evaluate("window.__IG_COVER_B64 = ''")
    return page.evaluate(
        """async ({caption, duration, width, height}) => {
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
      const claim = sessionStorage.getItem('www-claim-v2') || localStorage.getItem('www-claim-v2');
      const h = {
        'X-CSRFToken': csrf,
        'X-IG-App-ID': '936619743392459',
        'X-Requested-With': 'XMLHttpRequest',
      };
      if (claim) h['X-IG-WWW-Claim'] = claim;
      const toBytes = (b64) => {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
        return bytes;
      };
      const vid = toBytes(window.__IG_VID_B64 || '');
      if (!vid.length) return {ok:false, stage:'no_video'};
      const uploadId = String(Date.now());
      const name = `fb_uploader_${uploadId}`;
      const durMs = Math.round(duration * 1000);
      const ruploadParams = JSON.stringify({
        is_clips_video: '1',
        media_type: 2,
        upload_id: uploadId,
        upload_media_duration_ms: durMs,
        upload_media_height: height,
        upload_media_width: width,
      });
      const up = await fetch(`/rupload_igvideo/${name}`, {
        method:'POST', credentials:'include',
        headers:{
          'Content-Type':'video/mp4', Offset:'0',
          'X-Entity-Length': String(vid.length),
          'X-Entity-Name': name+'.mp4',
          'X-Entity-Type':'video/mp4',
          'X-Instagram-Rupload-Params': ruploadParams,
          ...h,
        },
        body: vid,
      });
      const upText = await up.text();
      if (!up.ok) return {ok:false, stage:'rupload', status:up.status, body:upText.slice(0,180)};

      if (window.__IG_COVER_B64) {
        const cov = toBytes(window.__IG_COVER_B64);
        const cname = name + '_cover';
        const cparams = JSON.stringify({
          media_type: 2,
          upload_id: uploadId,
          upload_media_height: height,
          upload_media_width: width,
        });
        await fetch(`/rupload_igphoto/${cname}`, {
          method:'POST', credentials:'include',
          headers:{
            'Content-Type':'image/jpeg', Offset:'0',
            'X-Entity-Length': String(cov.length),
            'X-Entity-Name': cname+'.jpg',
            'X-Entity-Type':'image/jpeg',
            'X-Instagram-Rupload-Params': cparams,
            ...h,
          },
          body: cov,
        });
      }

      try {
        await fetch('/api/v1/media/upload_finish/?video=1', {
          method:'POST', credentials:'include',
          headers:{...h, 'Content-Type':'application/x-www-form-urlencoded'},
          body: new URLSearchParams({upload_id: uploadId}),
        });
      } catch (e) {}

      const form = new URLSearchParams({
        upload_id: uploadId,
        caption,
        source_type: 'library',
        length: String(duration),
        clips: JSON.stringify([{length: duration, source_type: 'library'}]),
        poster_frame_index: '0',
        audio_muted: '0',
        filter_type: '0',
        disable_comments: '0',
        like_and_view_counts_disabled: '0',
        clips_share_preview_to_feed: '1',
        extra: JSON.stringify({source_width: width, source_height: height}),
      });
      const paths = [
        '/api/v1/media/configure_to_clips/',
        '/api/v1/media/configure/?video=1',
        '/api/v1/media/configure/',
      ];
      const tries = [];
      for (const path of paths) {
        const body = new URLSearchParams(form);
        if (path.includes('configure/') && !path.includes('clips')) {
          body.set('media_type', '2');
          body.set('is_clips_video', '1');
        }
        const cfg = await fetch(path, {
          method:'POST', credentials:'include',
          headers:{...h, 'Content-Type':'application/x-www-form-urlencoded'},
          body,
        });
        const t = await cfg.text();
        let j; try { j = JSON.parse(t); } catch(e) {
          tries.push({path, status:cfg.status, html:true, body:t.slice(0,80)});
          continue;
        }
        if (j.status==='ok') {
          return {
            ok:true, path, status:cfg.status, upload:up.status,
            media: j.media?.code || j.media?.pk, msg:j.message,
          };
        }
        tries.push({path, status:cfg.status, msg:j.message, err:j.error_type});
      }
      return {ok:false, stage:'configure', upload:up.status, tries};
    }""",
        {
            "caption": caption,
            "duration": float(duration_sec),
            "width": int(width),
            "height": int(height),
        },
    )


def post_instagram_reel_ui(page, video_path: Path, caption: str) -> dict:
    """만들기 → 컴퓨터에서 선택 → 다음 → 캡션 → 공유."""
    page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
    time.sleep(2.5)
    clicked = ""
    for name in ("만들기", "Create"):
        loc = page.get_by_role("link", name=name)
        if not loc.count():
            loc = page.get_by_text(name, exact=True)
        if loc.count():
            try:
                loc.first.click(timeout=4000)
                clicked = name
                time.sleep(1.4)
                break
            except Exception:
                continue
    if not clicked:
        plus = page.locator(
            'svg[aria-label="새로운 게시물"], svg[aria-label="New post"], svg[aria-label="만들기"]'
        )
        if plus.count():
            plus.first.click()
            clicked = "plus"
            time.sleep(1.4)

    for name in ("릴스", "Reels", "게시물", "Post"):
        loc = page.get_by_text(name, exact=True)
        if loc.count():
            try:
                loc.first.click(timeout=2000)
                time.sleep(0.8)
                break
            except Exception:
                pass

    uploaded = False
    fi = page.locator('input[type="file"]')
    if fi.count():
        try:
            fi.first.set_input_files(str(video_path))
            uploaded = True
        except Exception:
            uploaded = False
    if not uploaded:
        pick = page.get_by_text("컴퓨터에서 선택").or_(page.get_by_text("Select from computer"))
        try:
            with page.expect_file_chooser(timeout=8000) as fc:
                if pick.count():
                    pick.first.click()
                elif fi.count():
                    fi.first.click()
                else:
                    page.get_by_text("만들기").first.click()
            fc.value.set_files(str(video_path))
            uploaded = True
        except Exception as e:
            return {
                "ok": False,
                "stage": "file_chooser",
                "clicked": clicked,
                "err": str(e)[:160],
                "snippet": (page.inner_text("body") or "")[:220],
            }
    time.sleep(7)
    for _ in range(5):
        nxt = page.get_by_role("button", name=re.compile(r"다음|Next"))
        if nxt.count():
            try:
                nxt.last.click(timeout=4000)
                time.sleep(2.4)
                continue
            except Exception:
                break
        break
    box = page.locator(
        'div[aria-label*="캡션"], div[aria-label*="Caption"], div[role="textbox"]'
    )
    if box.count():
        try:
            box.last.click()
            box.last.fill(caption)
        except Exception:
            page.keyboard.type(caption[:2000], delay=6)
    shared = False
    for name in ("공유하기", "Share"):
        btn = page.get_by_role("button", name=name)
        if btn.count():
            try:
                btn.last.click(timeout=5000)
                shared = True
                break
            except Exception:
                continue
    if not shared:
        return {
            "ok": False,
            "stage": "no_share",
            "clicked": clicked,
            "snippet": (page.inner_text("body") or "")[:240],
        }
    for _ in range(28):
        time.sleep(1.5)
        body = ""
        try:
            body = page.inner_text("body") or ""
        except Exception:
            pass
        if any(k in body for k in ("공유됨", "Shared", "릴스가 공유", "게시물이 공유")):
            return {"ok": True, "via": "ui", "clicked": clicked}
    return {"ok": True, "via": "ui_timeout_assumed", "clicked": clicked}


def post_threads_text(page, caption: str, reply: str = "", topic_tag: str = "") -> dict:
    """Threads text post + official topic (주제/커뮤니티), then optional self-reply.

    본문에 #해시를 넣지 않고, text_post_app_info.topic_tag 로 주제를 붙인다.
    """
    acct = assert_threads_account(page)
    log(f"threads_account_check={json.dumps(acct, ensure_ascii=False)[:300]}")
    if not acct.get("ok"):
        return {
            "ok": False,
            "stage": "wrong_account",
            "msg": f"Threads는 @{THREADS_USER} 여야 합니다",
            "check": acct,
        }
    # sanitize tag: no . & and strip #
    clean_tag = re.sub(r"[.&]", "", str(topic_tag or "").replace("#", "").strip())[:50]

    result: dict = {"ok": False}
    # 공식 주제는 API가 무시함 → 작성창 '커뮤니티 또는 주제'를 먼저 사용 (해시보다 피드 노출)
    if clean_tag:
        ui = post_threads_with_topic_ui(page, caption, clean_tag)
        if ui.get("ok"):
            log(f"threads_topic_ui_ok tag={clean_tag} picked={ui.get('picked')}")
            result = ui
        else:
            log(f"threads_topic_ui_fail={json.dumps(ui, ensure_ascii=False)[:280]}")
            _dismiss_threads_composer(page)

    if not result.get("ok"):
        page.goto("https://www.threads.com/", wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_url(re.compile(r"threads\.(com|net)"), timeout=15000)
        except Exception:
            pass
        time.sleep(2.5)
        result = page.evaluate(
        """async ({caption, topicTag}) => {
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
      const claim = sessionStorage.getItem('www-claim-v2') || localStorage.getItem('www-claim-v2') || '';
      const html = document.documentElement.innerHTML || '';
      const ajax = (html.match(/"rollout_hash"\\s*:\\s*"(\\w+)"/) || [])[1] || '';
      const asbd = (html.match(/"asbd_id"\\s*:\\s*"(\\d+)"/) || [])[1] || '';
      const path = '/api/v1/media/configure_text_only_post/';
      const origins = [...new Set([
        location.origin,
        'https://www.threads.com',
        'https://www.threads.net',
        'https://www.instagram.com',
      ])];
      const payloads = [
        { publish_mode: 'text_post', text_post_app_info: JSON.stringify({ reply_control: 0 }), caption, device_id: '' },
      ];
      if (topicTag) {
        payloads.push({
          publish_mode: 'text_post',
          text_post_app_info: JSON.stringify({ reply_control: 0, topic_tag: topicTag }),
          caption, device_id: '',
        });
      }
      const attempts = [];
      for (const origin of origins) {
        const appId = origin.includes('instagram') ? '936619743392459' : '238260118697367';
        for (const params of payloads) {
          try {
            const headers = {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-CSRFToken': csrf,
              'X-IG-App-ID': appId,
              'X-Requested-With': 'XMLHttpRequest',
            };
            if (claim) headers['X-IG-WWW-Claim'] = claim;
            if (ajax) headers['X-Instagram-AJAX'] = ajax;
            if (asbd) headers['X-ASBD-ID'] = asbd;
            const r = await fetch(origin + path, {
              method: 'POST', credentials: 'include', headers,
              body: new URLSearchParams(params),
            });
            const t = await r.text();
            let j;
            try { j = JSON.parse(t); } catch (e) {
              attempts.push({ origin, status: r.status, html: true, body: t.slice(0, 70) });
              continue;
            }
            if (j.status === 'ok') {
              const media = j.media || {};
              return {
                ok: true, mode: 'text_only', status: r.status,
                media: media.code || media.pk,
                pk: String(media.pk || media.id || ''),
                msg: j.message, via: origin + path,
                topic_tag: topicTag || '',
                topic_attached: !!(media.text_post_app_info?.topic_tag || media.topic_tag),
                topic_echo: media.text_post_app_info?.topic_tag || media.topic_tag || null,
              };
            }
            attempts.push({ origin, status: r.status, msg: j.message || j.status, err: j.error_type });
          } catch (e) {
            attempts.push({ origin, error: String(e).slice(0, 90) });
          }
        }
      }
      return { ok: false, stage: 'text_only', csrf: !!csrf, ajax: !!ajax, attempts: attempts.slice(0, 8) };
    }""",
        {"caption": caption, "topicTag": clean_tag},
    )
    log(
        f"threads_topic tag={clean_tag or '-'} attached={result.get('topic_attached')} "
        f"echo={result.get('topic_echo')} via={result.get('via') or result.get('stage')}"
    )
    if not result.get("ok"):
        log(f"threads_api_fail={json.dumps(result, ensure_ascii=False)[:500]}")
        # threads.com 이 HTML만 주면, 인스타 세션으로 같은 API 재시도
        try:
            page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=45000)
            time.sleep(1.5)
            ig_try = page.evaluate(
                """async ({caption}) => {
              const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1] || '';
              const claim = sessionStorage.getItem('www-claim-v2') || localStorage.getItem('www-claim-v2') || '';
              const form = new URLSearchParams({
                publish_mode: 'text_post',
                text_post_app_info: JSON.stringify({ reply_control: 0 }),
                caption, device_id: '',
              });
              const r = await fetch('/api/v1/media/configure_text_only_post/', {
                method: 'POST', credentials: 'include',
                headers: {
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'X-CSRFToken': csrf,
                  'X-IG-App-ID': '936619743392459',
                  'X-Requested-With': 'XMLHttpRequest',
                  ...(claim ? {'X-IG-WWW-Claim': claim} : {}),
                },
                body: form,
              });
              const t = await r.text();
              let j; try { j = JSON.parse(t); } catch(e) {
                return {ok:false, stage:'ig_text_only', status:r.status, body:t.slice(0,120)};
              }
              const media = j.media || {};
              return {
                ok: j.status==='ok', mode: 'ig_text_only', status: r.status,
                media: media.code || media.pk, pk: String(media.pk || media.id || ''),
                msg: j.message, via: 'instagram.com',
              };
            }""",
                {"caption": caption},
            )
            log(f"threads_ig_api={json.dumps(ig_try, ensure_ascii=False)[:300]}")
            if ig_try.get("ok"):
                result = ig_try
        except Exception as e:
            log(f"threads_ig_api_err {e}")

    # 주제 UI·API 모두 실패 시에만 본문만 UI 게시
    if not result.get("ok"):
        ui = post_threads_ui_simple(page, caption)
        if ui.get("ok"):
            result = ui
            log("threads_ui_simple_ok")
        else:
            result["topic_ui"] = ui
            log(f"threads_ui_simple_fail={json.dumps(ui, ensure_ascii=False)[:240]}")

    if not result.get("ok") or not reply or not str(reply).strip():
        return result

    # human-ish pause before self-reply
    time.sleep(random.uniform(3.0, 8.0))
    parent_pk = str(result.get("pk") or "")
    if not parent_pk:
        result["reply"] = {"ok": False, "stage": "no_parent_pk"}
        return result

    reply_res = page.evaluate(
        """async ({caption, parentPk}) => {
      const csrf = document.cookie.match(/csrftoken=([^;]+)/)?.[1];
      const claim = sessionStorage.getItem('www-claim-v2') || localStorage.getItem('www-claim-v2');
      // Threads self-reply = text_only post with reply_id
      const attempts = [
        { reply_control: 0, reply_id: parentPk },
        { reply_control: 0, reply_to_media_id: parentPk },
        { reply_control: 0, reply_id: parentPk, entry_point: 'reply' },
      ];
      let last = null;
      for (const info of attempts) {
        const form = new URLSearchParams({
          publish_mode: 'text_post',
          text_post_app_info: JSON.stringify(info),
          caption: caption,
          device_id: '',
        });
        const cfg = await fetch('/api/v1/media/configure_text_only_post/', {
          method: 'POST', credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'X-CSRFToken': csrf,
            'X-IG-App-ID': '238260118697367',
            'X-Requested-With': 'XMLHttpRequest',
            ...(claim ? {'X-IG-WWW-Claim': claim} : {}),
          },
          body: form,
        });
        const t = await cfg.text();
        let j; try { j = JSON.parse(t); } catch(e) {
          last = {ok:false, stage:'reply_parse', status:cfg.status, body:t.slice(0,180)};
          continue;
        }
        last = {
          ok: j.status==='ok',
          status: cfg.status,
          media: j.media?.code || j.media?.pk,
          msg: j.message,
          tried: Object.keys(info).join(','),
        };
        if (last.ok) return last;
      }
      // fallback: classic comment endpoint
      const form2 = new URLSearchParams({ comment_text: caption });
      const cfg2 = await fetch(`/api/v1/media/${parentPk}/comment/`, {
        method: 'POST', credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-CSRFToken': csrf,
          'X-IG-App-ID': '238260118697367',
          'X-Requested-With': 'XMLHttpRequest',
          ...(claim ? {'X-IG-WWW-Claim': claim} : {}),
        },
        body: form2,
      });
      const t2 = await cfg2.text();
      let j2; try { j2 = JSON.parse(t2); } catch(e) {
        return last || {ok:false, stage:'comment_parse', status:cfg2.status, body:t2.slice(0,180)};
      }
      return {
        ok: j2.status==='ok' || !!j2.comment,
        mode: 'comment_fallback',
        status: cfg2.status,
        media: j2.comment?.pk,
        msg: j2.message,
        prev: last,
      };
    }""",
        {"caption": reply.strip(), "parentPk": parent_pk},
    )
    result["reply"] = reply_res
    log(f"threads_self_reply={json.dumps(reply_res, ensure_ascii=False)[:350]}")
    return result


def _open_threads_composer(page) -> bool:
    page.goto("https://www.threads.com/", wait_until="domcontentloaded", timeout=60000)
    time.sleep(2.0)
    for name in ("새로운 소식이 있나요?", "What's new?", "만들기", "Create"):
        loc = page.get_by_text(name, exact=False)
        if not loc.count():
            continue
        try:
            loc.first.click(timeout=4000, force=True)
            time.sleep(1.2)
            if page.locator('input[placeholder*="커뮤니티"], input[placeholder*="주제"]').count():
                return True
            if page.locator('[contenteditable="true"][role="textbox"]').count():
                return True
        except Exception:
            continue
    return False


def _dismiss_threads_composer(page) -> None:
    try:
        loc = page.get_by_role("button", name=re.compile(r"^(취소|Cancel)$", re.I))
        if loc.count():
            loc.first.click(timeout=2000, force=True)
            time.sleep(0.4)
            return
    except Exception:
        pass
    try:
        page.keyboard.press("Escape")
        time.sleep(0.3)
        page.keyboard.press("Escape")
    except Exception:
        pass


def _pick_topic_in_composer(page, topic_tag: str) -> bool:
    """작성창 맨 위 '커뮤니티 또는 주제' 입력 후 첫 추천(정확 일치 우선) 선택."""
    inp = page.locator('input[placeholder*="커뮤니티"], input[placeholder*="주제"]')
    if not inp.count():
        return False
    box = inp.last
    box.click(timeout=4000)
    time.sleep(0.2)
    box.fill("")
    box.type(topic_tag, delay=45)
    time.sleep(1.2)
    # 드롭다운 첫 항목이 입력어와 같음 (예: 마케팅 → 마케팅)
    loc = page.get_by_text(topic_tag, exact=True)
    for i in range(loc.count()):
        el = loc.nth(i)
        try:
            bb = el.bounding_box()
            if not bb or bb["y"] < 280 or bb["height"] < 12:
                continue
            el.click(timeout=2500)
            time.sleep(0.4)
            return True
        except Exception:
            continue
    page.keyboard.press("ArrowDown")
    time.sleep(0.15)
    page.keyboard.press("Enter")
    time.sleep(0.4)
    return True


def _composer_click_post(page) -> bool:
    for i in range(page.get_by_role("button", name="게시").count()):
        b = page.get_by_role("button", name="게시").nth(i)
        try:
            bb = b.bounding_box()
            if bb and bb["y"] > 350 and b.is_enabled():
                b.click(timeout=4000)
                return True
        except Exception:
            continue
    page.keyboard.press("Meta+Enter")
    time.sleep(0.3)
    page.keyboard.press("Control+Enter")
    return True


def post_threads_ui_simple(page, caption: str) -> dict:
    """작성창만 열어 텍스트 게시 (주제 없어도 됨)."""
    try:
        page.goto("https://www.threads.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2.0)

        opened = False
        for name in ("만들기", "Create", "새로운 소식이 있나요?", "What's new?", "스레드 시작", "Start a thread", "새 스레드"):
            loc = page.get_by_text(name, exact=False)
            if loc.count():
                try:
                    loc.first.click(timeout=4000, force=True)
                    opened = True
                    break
                except Exception:
                    pass
        if not opened:
            loc = page.get_by_role("button", name="만들기")
            if loc.count():
                try:
                    loc.first.click(timeout=4000, force=True)
                    opened = True
                except Exception:
                    pass
        if not opened:
            for sel in [
                'svg[aria-label="새 스레드 작성"]',
                'svg[aria-label="Create"]',
                'svg[aria-label="New thread"]',
                '[aria-label="새 스레드 작성"]',
                '[aria-label="Create"]',
                '[placeholder*="새로운"]',
                '[placeholder*="What"]',
            ]:
                loc = page.locator(sel).first
                if loc.count():
                    try:
                        loc.click(timeout=3000)
                        opened = True
                        break
                    except Exception:
                        pass
        if not opened:
            page.keyboard.press("c")
            time.sleep(0.8)

        box = None
        for _ in range(8):
            loc = page.locator('div[role="textbox"][contenteditable="true"], div[contenteditable="true"][role="textbox"]')
            if loc.count():
                box = loc.first
                break
            loc = page.locator('[contenteditable="true"]')
            if loc.count():
                box = loc.first
                break
            time.sleep(0.5)
        if box is None:
            return {"ok": False, "stage": "ui_no_textbox"}

        box.click()
        try:
            box.fill(caption)
        except Exception:
            page.keyboard.type(caption, delay=8)
        time.sleep(0.6)

        posted = False
        for label in ("게시", "Post", "게시하기"):
            loc = page.get_by_role("button", name=re.compile(label, re.I))
            if loc.count():
                try:
                    loc.last.click(timeout=4000)
                    posted = True
                    break
                except Exception:
                    pass
        if not posted:
            page.keyboard.press("Meta+Enter")
            time.sleep(0.4)
            page.keyboard.press("Control+Enter")
            posted = True

        time.sleep(2.5)
        return {"ok": True, "mode": "ui_simple", "pk": "", "media": ""}
    except Exception as e:
        return {"ok": False, "stage": "ui_simple_error", "error": str(e)[:200]}


def post_threads_with_topic_ui(page, caption: str, topic_tag: str) -> dict:
    """작성창 맨 위 '커뮤니티 또는 주제'에 공식 토픽을 붙인 뒤 게시."""
    try:
        if not _open_threads_composer(page):
            return {"ok": False, "stage": "ui_no_composer", "topic_tag": topic_tag}

        picked = _pick_topic_in_composer(page, topic_tag)
        if not picked:
            return {"ok": False, "stage": "ui_topic_not_picked", "topic_tag": topic_tag}

        box = page.locator('[contenteditable="true"][role="textbox"]').last
        if not box.count():
            box = page.locator('[contenteditable="true"]').last
        if not box.count():
            return {"ok": False, "stage": "ui_no_textbox", "topic_tag": topic_tag, "picked": picked}

        box.click()
        time.sleep(0.2)
        try:
            box.fill(caption)
        except Exception:
            page.keyboard.type(caption, delay=10)
        time.sleep(0.6)

        _composer_click_post(page)
        time.sleep(3.0)
        return {
            "ok": True,
            "mode": "ui_topic",
            "topic_tag": topic_tag,
            "picked": True,
            "pk": "",
            "media": "",
        }
    except Exception as e:
        return {"ok": False, "stage": "ui_topic_error", "error": str(e)[:200], "topic_tag": topic_tag}


def _parse_matterport_id() -> str | None:
    """--matterport or --matterport=ID or --matterport ID"""
    for i, a in enumerate(sys.argv):
        if a == "--matterport":
            nxt = sys.argv[i + 1] if i + 1 < len(sys.argv) else ""
            if nxt and not nxt.startswith("-") and len(nxt) >= 8:
                return nxt
            return None  # rotate
        if a.startswith("--matterport="):
            return a.split("=", 1)[1].strip() or None
    return None


def matterport_payload(prefer_id: str | None = None) -> tuple[str, str, str, str, str, Path]:
    """title, ig_caption, th_id, th_caption, th_reply, image_path — rotate unused refs."""
    from post_once import (  # noqa: WPS433
        make_ig_body,
        make_threads_caption,
        mix_hashtags,
        pick_threads_post,
        recent_caption_fps,
        caption_fingerprint,
        CAPTION_DEDUP_DAYS,
    )

    catalog = json.loads((ROOT / "data" / "matterport_showcase.json").read_text(encoding="utf-8"))
    showcases = catalog.get("showcases") or []
    if not showcases:
        raise SystemExit("matterport_showcase.json 비어 있음")

    pool = json.loads((ROOT / "captions" / "pool.json").read_text(encoding="utf-8"))
    th_pool = json.loads((ROOT / "captions" / "threads_pool.json").read_text(encoding="utf-8"))
    st = load_state()
    used_mp = list(st.get("used_matterport_ids") or [])
    used_fps = recent_caption_fps(st, CAPTION_DEDUP_DAYS)

    by_id = {s["id"]: s for s in showcases}
    if prefer_id and prefer_id in by_id:
        sc = by_id[prefer_id]
    else:
        fresh = [s for s in showcases if s["id"] not in set(used_mp)]
        if not fresh:
            # all used — least recently used
            order = {v: i for i, v in enumerate(used_mp)}
            sc = min(showcases, key=lambda s: order.get(s["id"], -1))
        else:
            sc = random.choice(fresh)

    ig_title = sc.get("ig_title")
    th_id = sc.get("th_id")
    ig_post = next((p for p in pool["posts"] if p["title"] == ig_title), None)
    th_post = next((p for p in th_pool["posts"] if p["id"] == th_id), None)
    if not ig_post or not th_post:
        raise SystemExit(f"캡션 풀 누락: ig={ig_title} th={th_id}")

    brand = pool.get("brand_tags") or ["#3D어라운드", "#3DVR", "#시아스트릿", "#siastreet"]
    extra_tags = list(sc.get("tags") or ["#3D투어"])
    ig_tags = mix_hashtags(pool["hashtag_sets"], n=22, brand=brand + extra_tags)
    ig_caption = f"{make_ig_body(ig_post)}\n\n.\n.\n.\n\n{ig_tags}"
    th_post = dict(th_post)
    th_post["topic"] = th_post.get("topic") or "space"
    th_caption = make_threads_caption(th_post)
    # 최근 14일 안에 같은 본문이면 Matterport 이미지는 유지하고 스레드 문구만 새로 고름
    if caption_fingerprint(th_caption) in used_fps:
        th_id, th_caption, th_reply, th_topic = pick_threads_post()
        log(f"matterport_caption_dedup → {th_id}")
    else:
        th_topic = th_post.get("topic") or "space"
        th_reply = ""
        if random.random() < 0.15:
            th_reply = "\n".join(th_post.get("reply") or []).strip()
    path = ROOT / sc["image"]
    if not path.exists():
        # fallback relative
        path = ROOT / "out" / f"mp-{sc['id']}-ig.jpg"
    if not path.exists():
        raise SystemExit(f"Matterport 이미지 없음: {path}")

    # track rotation
    used_mp = [x for x in used_mp if x != sc["id"]] + [sc["id"]]
    st["used_matterport_ids"] = used_mp[-40:]
    st["last_matterport_id"] = sc["id"]
    save_state(st)

    log(f"matterport_showcase={sc['url']} title={sc['title']}")
    return ig_post["title"], ig_caption, th_id, th_caption, th_reply, path, th_topic


def main() -> int:
    login_only = "--login" in sys.argv
    if (ROOT / "STOPPED").exists() and "--force-3d" not in sys.argv and not login_only:
        log("STOPPED — 3D 발행 중지. 축제는 cruise-sns/오늘-올리기.command")
        return 0
    force = "--force" in sys.argv
    skip_threads = "--no-threads" in sys.argv
    use_matterport = any(a == "--matterport" or a.startswith("--matterport=") for a in sys.argv)
    mp_prefer = _parse_matterport_id() if use_matterport else None
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        log("playwright 미설치: pip3 install playwright && python3 -m playwright install chromium")
        return 2

    PROFILE.mkdir(parents=True, exist_ok=True)
    result = {"ok": False}
    th_result = {"ok": False, "skipped": True}
    title = ""
    th_id = ""

    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            user_data_dir=str(PROFILE),
            headless=not login_only and "--headed" not in sys.argv,
            viewport={"width": 1280, "height": 900},
            locale="ko-KR",
            args=["--disable-blink-features=AutomationControlled"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto("https://www.instagram.com/", wait_until="domcontentloaded", timeout=60000)
        time.sleep(2)
        if login_only or "accounts/login" in page.url:
            if login_only:
                log(
                    f"1) 인스타 @{IG_USER} 로그인 → "
                    f"2) Threads @{THREADS_USER} 확인 → 최대 5분 대기"
                )
                page.goto("https://www.instagram.com/accounts/login/", wait_until="domcontentloaded")
                for _ in range(60):
                    time.sleep(5)
                    if "accounts/login" not in page.url:
                        break
                try:
                    page.goto(
                        f"https://www.threads.net/@{THREADS_USER}",
                        wait_until="domcontentloaded",
                        timeout=60000,
                    )
                    time.sleep(3)
                    acct = assert_threads_account(page)
                    log(f"threads_login_check={json.dumps(acct, ensure_ascii=False)[:400]}")
                    if not acct.get("ok"):
                        log(f"경고: Threads가 @{THREADS_USER} 가 아닙니다.")
                except Exception as e:
                    log(f"threads_open_fail {e}")
                log(f"login_done url={page.url}")
                ctx.close()
                return 0
            log("로그인 필요: ig-auto/로그인.command 실행")
            ctx.close()
            return 3

        th_topic = "space"
        if use_matterport:
            title, ig_caption, th_id, th_caption, th_reply, path, th_topic = matterport_payload(mp_prefer)
            headline = title
        else:
            title, subtitle, ig_caption, th_caption, layout, headline, th_id, th_reply, th_topic = pick_post()
            path = make_image(title, subtitle, layout_hint=layout, headline=headline)
        reserve_post(title, th_id, headline, topic=th_topic, threads_caption=th_caption)
        log(f"pw_image={path.name} title={title} threads_id={th_id} topic={th_topic} reply={'y' if th_reply else 'n'}")

        page.goto("https://www.instagram.com/", wait_until="domcontentloaded")
        time.sleep(1)
        result = post_instagram(page, path, ig_caption)
        log(f"ig_result={json.dumps(result, ensure_ascii=False)[:400]}")

        if not skip_threads:
            time.sleep(random.uniform(2.5, 5.0))
            from post_once import topic_meta  # noqa: WPS433
            tag = topic_meta(th_topic).get("tag") or ""
            th_result = post_threads_text(page, th_caption, reply=th_reply or "", topic_tag=tag)
            th_result["topic"] = th_topic
            th_result["topic_tag"] = tag
            log(f"threads_result={json.dumps(th_result, ensure_ascii=False)[:450]}")
        else:
            log("threads_skipped --no-threads")
        ctx.close()

    # slot counts if either channel succeeded (하루 2회 · 인스타+스레드)
    if not result.get("ok") and not th_result.get("ok"):
        return 1

    st = load_state()
    # titles/threads already reserved before upload — only refresh "last_*"
    if result.get("ok") and result.get("media"):
        st["last_ig_code"] = result.get("media")
    st["last_post_at"] = datetime.now(KST).isoformat(timespec="seconds")
    st["last_title"] = title
    st["last_threads_id"] = th_id
    st["last_threads_topic"] = th_topic
    st["last_threads_ok"] = bool(th_result.get("ok"))
    st["threads_user"] = THREADS_USER
    if th_result.get("media"):
        st["last_threads_code"] = th_result.get("media")
    if not force:
        today = datetime.now(KST).date().isoformat()
        day = st.get("day") or {}
        if day.get("date") != today:
            day = {"date": today, "posted": 0, "target": 2, "titles": [], "threads_ids": []}
        day["posted"] = int(day.get("posted", 0)) + 1
        st["day"] = day
    save_state(st)

    if result.get("ok") and not skip_threads and not th_result.get("ok") and not th_result.get("skipped"):
        log(f"threads_failed_but_ig_ok — @{THREADS_USER} Threads 로그인 확인")
    if th_result.get("ok") and not result.get("ok"):
        log("ig_failed_but_threads_ok")
    return 0


post_in_page = post_instagram


if __name__ == "__main__":
    raise SystemExit(main())
