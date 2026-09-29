#!/usr/bin/env python3
"""3D어라운드 Instagram + Threads post (image + caption + tags)."""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import requests

# Threads 본문 동일 문구 재사용 금지 기간
CAPTION_DEDUP_DAYS = 14
CAPTION_FP_KEEP = 240

ROOT = Path(__file__).resolve().parents[1]
POOL = ROOT / "captions" / "pool.json"
OUT = ROOT / "out"
STATE = ROOT / "data" / "state.json"
COOKIES = ROOT / "data" / "ig-cookies.json"
LOG = ROOT / "data" / "run.log"
KST = ZoneInfo("Asia/Seoul")
IG_APP = "936619743392459"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
)

def log(msg: str) -> None:
    line = f"{datetime.now(KST).isoformat(timespec='seconds')} {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_state() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {}


def save_state(st: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")


def make_image(title: str, subtitle: str, layout_hint: str | None = None, headline: str | None = None) -> Path:
    from render_image import (
        render_glow_image,
        LAYOUT_BY_HINT,
        PHOTO_LAYOUTS,
        list_stock_photos,
        pick_photo,
        remember_photo_use,
    )

    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"post-{datetime.now(KST).strftime('%Y%m%d-%H%M%S')}-{random.randint(100,999)}.jpg"
    st = load_state()
    recent = list(st.get("used_layouts", [])[-8:])
    used_photos = list(st.get("used_photos", []))
    photo_hints = list(PHOTO_LAYOUTS.keys())
    graphic_hints = [h for h in LAYOUT_BY_HINT if h not in PHOTO_LAYOUTS]
    # Instagram: always photo layouts when stock exists (owner liked this look)
    use_photo = bool(list_stock_photos())
    pool = photo_hints if use_photo else graphic_hints
    # weight the polished photo styles owner liked
    preferred = [
        "photo_bottom",
        "photo_card",
        "photo_frost",
        "photo_minimal",
        "photo_letterbox",
        "photo_frame",
        "photo_duo",
        "photo_top",
        "photo_center",
        "photo_side",
        "photo_note",
    ]
    if use_photo:
        pool = [h for h in preferred if h not in recent] or preferred
    else:
        pool = [h for h in pool if h not in recent] or pool
    if random.random() < 0.97 or not layout_hint or layout_hint not in (photo_hints + graphic_hints):
        layout_hint = random.choice(pool)
    elif use_photo and layout_hint not in photo_hints:
        layout_hint = random.choice(pool)
    st["used_layouts"] = (recent + [layout_hint])[-24:]

    # Stock photo: never repeat until the whole pool has been used (then LRU)
    photo_path = pick_photo(used_photos) if use_photo else None
    if photo_path is not None:
        used_photos = remember_photo_use(used_photos, photo_path.name)
        st["used_photos"] = used_photos
        st["last_photo"] = photo_path.name
    save_state(st)

    return render_glow_image(
        path,
        headline=headline or subtitle or title,
        subtitle=subtitle or "운영 메모",
        layout_hint=layout_hint,
        photo_path=photo_path,
        used_photos=used_photos,
    )


def humanize(text: str) -> str:
    """Make captions look a bit messy / human — not perfectly punctuated."""
    # strip polished trailing periods often
    lines = []
    for ln in text.split("\n"):
        s = ln.rstrip()
        if s.endswith(".") and random.random() < 0.7:
            s = s[:-1]
        if s.endswith("。"):
            s = s[:-1]
        # sometimes squash spaces around · ,
        if random.random() < 0.25:
            s = s.replace(" · ", "·").replace(" ,", ",")
        lines.append(s)
    body = "\n".join(lines).strip()
    # rare soft mutter at end
    if random.random() < 0.18:
        body += random.choice(["", "\n\nㅎㅎ", "\n\n그냥그말임", "\n\n오늘여기까지", "\n\n끝"])
    # sometimes collapse double blank lines
    if random.random() < 0.4:
        while "\n\n\n" in body:
            body = body.replace("\n\n\n", "\n\n")
    return body.strip()


def mix_topic_hashtags(topic_id: str | None, n: int | None = None) -> str:
    """인스타 해시 — 주제별. 3D 고정 태그는 공간투어일 때만."""
    meta = topic_meta(topic_id)
    tags = list(meta.get("ig_tags") or [])
    if not tags:
        tags = ["#사업일기", "#사장님", "#오늘"]
    n = n or random.randint(8, 12)
    random.shuffle(tags)
    out: list[str] = []
    seen = set()
    for t in tags:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= n:
            break
    return " ".join(out)


def _ig_headline_from_caption(caption: str, fallback: str) -> str:
    for ln in (caption or "").split("\n"):
        s = ln.strip().strip('"').strip()
        if len(s) >= 6:
            return s[:18]
    return (fallback or "오늘")[:18]


def mix_hashtags(sets: list[list[str]], n: int = 22, brand: list[str] | None = None) -> str:
    """Many discovery tags + always 3D어라운드 brand anchors."""
    bags = random.sample(sets, k=min(3, len(sets)))
    pool: list[str] = []
    for b in bags:
        pool.extend(b)
    random.shuffle(pool)
    brand = brand or ["#3D어라운드", "#3DVR", "#시아스트릿", "#siastreet"]
    seen = set()
    out: list[str] = []
    for t in brand:
        if t not in seen:
            seen.add(t)
            out.append(t)
    n = max(n, random.randint(18, 26))
    for t in pool:
        if t in seen:
            continue
        seen.add(t)
        out.append(t)
        if len(out) >= n:
            break
    # pad from all sets if short
    if len(out) < 18:
        all_tags = [t for bag in sets for t in bag]
        random.shuffle(all_tags)
        for t in all_tags:
            if t in seen:
                continue
            seen.add(t)
            out.append(t)
            if len(out) >= 18:
                break
    return " ".join(out[:30])


def _strip_cta_lines(body: str) -> str:
    skip = ("glowsiax.com", "siastreet.com", "siaphinix.com", "matterport.com")
    return "\n".join(
        ln for ln in body.split("\n") if not any(s in ln.lower() for s in skip)
    ).strip()


def load_topics() -> dict:
    path = ROOT / "captions" / "topics.json"
    if not path.exists():
        return {"topics": {}, "seedToTopic": {}, "bizToTopic": {}, "promoDefault": "space"}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {"topics": {}, "seedToTopic": {}, "bizToTopic": {}, "promoDefault": "space"}


def topic_meta(topic_id: str | None) -> dict:
    cfg = load_topics()
    tid = topic_id or cfg.get("promoDefault") or "daily"
    meta = (cfg.get("topics") or {}).get(tid) or {}
    tag = str(meta.get("tag") or tid).strip()
    return {
        "id": tid,
        "name": meta.get("name") or tid,
        "tag": tag,
        "community": meta.get("community") or "",
        "desc": meta.get("desc") or "",
        "ig_tags": list(meta.get("ig_tags") or []),
    }


def attach_topic_tag(caption: str, topic_id: str | None) -> str:
    """레거시 호환 — 본문 #해시 붙이지 않고 제거만."""
    return strip_trailing_topic_hashtag(caption, topic_id)


def strip_trailing_topic_hashtag(caption: str, topic_id: str | None = None) -> str:
    """본문 끝의 #주제 해시 제거 (주제는 topic_tag API/UI로만)."""
    body = (caption or "").strip()
    tags = set()
    if topic_id:
        meta = topic_meta(topic_id)
        for t in (meta.get("tag"), meta.get("name"), meta.get("community")):
            if t:
                tags.add(str(t).lstrip("#").strip())
    for m in (load_topics().get("topics") or {}).values():
        for k in ("tag", "name", "community"):
            if m.get(k):
                tags.add(str(m[k]).lstrip("#").strip())
    lines = body.split("\n")
    while lines:
        last = lines[-1].strip()
        if not last:
            lines.pop()
            continue
        if last.startswith("#") and last.lstrip("#").strip() in tags:
            lines.pop()
            continue
        break
    return "\n".join(lines).strip()


def normalize_caption_for_fp(text: str) -> str:
    """해시태그·공백 정리 후 본문만 비교."""
    t = str(text or "")
    t = re.sub(r"#\S+", " ", t)
    t = re.sub(r"https?://\S+", " ", t)
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t


def caption_fingerprint(text: str) -> str:
    norm = normalize_caption_for_fp(text)
    if not norm:
        return ""
    return hashlib.sha1(norm.encode("utf-8")).hexdigest()[:16]


def first_line_fingerprint(text: str) -> str:
    """첫 문장만 — 비슷한 일기/템플릿 반복 감지."""
    norm = normalize_caption_for_fp(text)
    if not norm:
        return ""
    first = norm.split(".")[0].split("?")[0].strip()[:48]
    if len(first) < 10:
        first = norm[:48]
    return hashlib.sha1(first.encode("utf-8")).hexdigest()[:16]


def recent_caption_fps(st: dict | None = None, days: int = CAPTION_DEDUP_DAYS) -> set[str]:
    st = st or load_state()
    _backfill_caption_fps_from_ids(st)
    cutoff = datetime.now(KST) - timedelta(days=days)
    out: set[str] = set()
    for row in st.get("used_caption_fps") or []:
        if isinstance(row, str):
            out.add(row)
            continue
        at = str(row.get("at") or "")
        try:
            ts = datetime.fromisoformat(at.replace("Z", "+00:00"))
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=KST)
            fresh = ts >= cutoff
        except Exception:
            fresh = True
        if not fresh:
            continue
        for key in ("fp", "fl"):
            v = str(row.get(key) or "")
            if v:
                out.add(v)
    return out


def _caption_lookup_map() -> dict[str, str]:
    """id → raw body text (no topic tag)."""
    m: dict[str, str] = {}
    for p in _load_diary_candidates():
        m[p["id"]] = _post_caption_body(p)
    path = ROOT / "captions" / "threads_pool.json"
    if path.exists():
        pool = json.loads(path.read_text(encoding="utf-8"))
        for p in pool.get("posts") or []:
            m[p["id"]] = _strip_cta_lines("\n".join(p.get("lines") or []).strip())
    return m


def _backfill_caption_fps_from_ids(st: dict) -> None:
    """기존 used_threads_ids 기준으로 지문 시드 (한 번만)."""
    if st.get("caption_fp_seeded"):
        return
    lookup = _caption_lookup_map()
    rows = list(st.get("used_caption_fps") or [])
    existing = {
        (r if isinstance(r, str) else r.get("fp")) for r in rows
    }
    now = datetime.now(KST)
    # 최근 쓴 id일수록 더 최근 시각으로 기록
    used_ids = list(st.get("used_threads_ids") or [])[-80:]
    for i, tid in enumerate(used_ids):
        body = lookup.get(tid)
        if not body:
            continue
        fp = caption_fingerprint(body)
        if not fp or fp in existing:
            continue
        # 과거로 분산 — 맨 앞이 더 오래됨
        age_hours = max(1, (len(used_ids) - i) * 6)
        at = (now - timedelta(hours=age_hours)).isoformat(timespec="seconds")
        rows.append({
            "fp": fp,
            "fl": first_line_fingerprint(body),
            "at": at,
            "id": tid,
        })
        existing.add(fp)
    st["used_caption_fps"] = rows[-CAPTION_FP_KEEP:]
    st["caption_fp_seeded"] = True
    save_state(st)
    log(f"caption_fp_backfill n={len(rows)}")


def remember_caption_fp(st: dict, caption: str, th_id: str | None = None) -> dict:
    fp = caption_fingerprint(caption)
    fl = first_line_fingerprint(caption)
    if not fp:
        return st
    rows = list(st.get("used_caption_fps") or [])
    if rows:
        last = rows[-1]
        last_fp = last if isinstance(last, str) else last.get("fp")
        if last_fp == fp:
            return st
    rows.append({
        "fp": fp,
        "fl": fl,
        "at": datetime.now(KST).isoformat(timespec="seconds"),
        "id": th_id or "",
    })
    st["used_caption_fps"] = rows[-CAPTION_FP_KEEP:]
    return st


def _post_caption_body(post: dict) -> str:
    return _strip_cta_lines("\n".join(post.get("lines") or []).strip())


def filter_fresh_caption_posts(posts: list[dict], used_fps: set[str]) -> list[dict]:
    fresh = []
    for p in posts:
        body = _post_caption_body(p)
        fp = caption_fingerprint(body)
        fl = first_line_fingerprint(body)
        if fp and fp in used_fps:
            continue
        if fl and fl in used_fps:
            continue
        fresh.append(p)
    return fresh


def make_threads_caption(post: dict) -> str:
    """Main Threads body — 주제는 topic_tag(커뮤니티/주제)로만 붙임."""
    body = _post_caption_body(post)
    if random.random() < 0.25:
        body = humanize(body)
    return strip_trailing_topic_hashtag(body, post.get("topic"))


def make_ig_body(post: dict) -> str:
    body = "\n".join(post["lines"]).strip()
    if random.random() < 0.35:
        return humanize(body)
    return body


def make_threads_reply(post: dict, pool_meta: dict | None = None) -> str:
    """Self-comment under own Threads post — who/what + soft link."""
    if post.get("reply"):
        return "\n".join(post["reply"]).strip()
    replies = (pool_meta or {}).get("reply_pool") or [
        ["3D어라운드", "공간 미리 둘러보기", "siastreet.com"]
    ]
    lines = random.choice(replies)
    return "\n".join(lines).strip()


def _unused_or_oldest(items: list[dict], key: str, used_ordered: list) -> dict:
    """Never random-reuse the full pool. Prefer never-used; else oldest used (LRU)."""
    used_set = set(used_ordered)
    fresh = [p for p in items if p[key] not in used_set]
    if fresh:
        return random.choice(fresh)
    # all used at least once — pick least recently used
    order = {v: i for i, v in enumerate(used_ordered)}
    return min(items, key=lambda p: order.get(p[key], -1))


def _load_diary_candidates() -> list[dict]:
    """익명 일기 시드 + businesses 템플릿 (상호·실명 없는 글만)."""
    items: list[dict] = []
    diary_path = ROOT.parent / "threads-auto" / "config" / "diary.json"
    biz_path = ROOT.parent / "threads-auto" / "config" / "businesses.json"
    if diary_path.exists():
        try:
            diary = json.loads(diary_path.read_text(encoding="utf-8"))
            for seed in diary.get("seeds") or []:
                sid = seed.get("id") or "d"
                for i, line in enumerate(seed.get("lines") or []):
                    text = str(line).strip()
                    if len(text) < 12:
                        continue
                    items.append({
                        "id": f"D_{sid}_{i}",
                        "kind": "diary",
                        "topic": seed.get("topic") or (load_topics().get("seedToTopic") or {}).get(sid) or "daily",
                        "lines": text.split("\n"),
                        "reply": None,
                    })
        except Exception as e:
            log(f"diary_load_fail {e}")
    if biz_path.exists():
        try:
            biz = json.loads(biz_path.read_text(encoding="utf-8"))
            for bid, b in (biz.get("businesses") or {}).items():
                for i, tpl in enumerate(b.get("templates") or []):
                    text = str(tpl).strip()
                    # 플레이스홀더·메모 남은 템플릿 제외
                    if "○○" in text or "△△" in text or "※" in text:
                        continue
                    if len(text) < 12:
                        continue
                    items.append({
                        "id": f"B_{bid}_{i}",
                        "kind": "diary",
                        "topic": b.get("topic") or (load_topics().get("bizToTopic") or {}).get(bid) or "daily",
                        "lines": text.split("\n"),
                        "reply": None,
                    })
        except Exception as e:
            log(f"biz_load_fail {e}")
    return items


def _prefer_fresh_topic(cands: list[dict], day_topics: list[str], used: list) -> dict:
    """하루 안 쓴 주제를 먼저. 같은 주제만 반복하지 않음."""
    if not cands:
        raise ValueError("no candidates")
    used_t = set(day_topics or [])
    fresh_topic = [p for p in cands if (p.get("topic") or "") not in used_t]
    pool = fresh_topic or cands
    return _unused_or_oldest(pool, "id", used)


def pick_threads_post() -> tuple[str, str, str, str]:
    """Returns threads_id, caption, self_reply, topic_id.
    Mix: 일기 우선 + 14일 이내 동일 본문 재사용 금지. self-reply 최소화.
    """
    path = ROOT / "captions" / "threads_pool.json"
    pool = json.loads(path.read_text(encoding="utf-8"))
    topics_cfg = load_topics()
    promo_topic = topics_cfg.get("promoDefault") or "space"
    st = load_state()
    used = list(st.get("used_threads_ids", []))
    used_fps = recent_caption_fps(st, CAPTION_DEDUP_DAYS)
    today = datetime.now(KST).date().isoformat()
    day = st.get("day") or {}
    day_used = set(day.get("threads_ids") or []) if day.get("date") == today else set()
    day_topics = list(day.get("topics") or []) if day.get("date") == today else []

    diary_items = _load_diary_candidates()
    promo_items = []
    for p in pool.get("posts") or []:
        q = dict(p)
        q["topic"] = p.get("topic") or promo_topic
        q["kind"] = "promo"
        promo_items.append(q)

    diary_day = [p for p in diary_items if p["id"] not in day_used] or diary_items
    promo_day = [p for p in promo_items if p["id"] not in day_used] or promo_items

    diary_fresh = filter_fresh_caption_posts(diary_day, used_fps) or filter_fresh_caption_posts(diary_items, used_fps)
    promo_fresh = filter_fresh_caption_posts(promo_day, used_fps) or filter_fresh_caption_posts(promo_items, used_fps)

    # 동일 문구 소진 시: 일기 풀을 더 쓰고, 그래도 없으면 LRU(최후)
    diary_cands = diary_fresh or diary_day
    promo_cands = promo_fresh or promo_day

    prefer_diary = 0.78 if diary_fresh else (0.55 if diary_cands else 0.0)
    if promo_fresh and not diary_fresh:
        prefer_diary = 0.25
    want_diary = bool(diary_cands) and (not promo_cands or random.random() < prefer_diary)

    soft_replies = [
        "비슷한 하루면 댓글 남겨요",
        "저만 그런 거 아니죠?",
        "같은 고민이면 편하게",
        "오늘도 일단 하나 올림",
    ]
    # 자금·개원·병원 등: 본문은 공감만, 자기댓글에만 가끔 프로필 유도 (하드 CTA X)
    soft_inbound = [
        "비슷한 정리 중이면 프로필 링크만 보면 됨",
        "필요하면 프로필에 정리해둠",
        "같은 고민이면 프로필 쪽 천천히",
    ]

    if want_diary:
        post = _prefer_fresh_topic(diary_cands, day_topics, used)
        caption = make_threads_caption(post)
        for _ in range(8):
            if caption_fingerprint(caption) not in used_fps and first_line_fingerprint(caption) not in used_fps:
                break
            alt_pool = [x for x in diary_cands if x["id"] != post["id"]] or diary_cands
            post = _prefer_fresh_topic(alt_pool, day_topics, used)
            caption = make_threads_caption(post)
        topic = post.get("topic") or "daily"
        reply = ""
        if topic in ("fund", "open", "marketing", "place", "space") and random.random() < 0.12:
            reply = random.choice(soft_inbound)
        elif random.random() < 0.08:
            reply = random.choice(soft_replies)
        return post["id"], caption, reply, topic

    post = _prefer_fresh_topic(promo_cands, day_topics, used)
    caption = make_threads_caption(post)
    for _ in range(8):
        if caption_fingerprint(caption) not in used_fps and first_line_fingerprint(caption) not in used_fps:
            break
        alt_pool = [x for x in promo_cands if x["id"] != post["id"]] or promo_cands
        post = _prefer_fresh_topic(alt_pool, day_topics, used)
        caption = make_threads_caption(post)
    # 홍보 자기댓글은 드물게 — 피드에 같은 글처럼 보이는 것 방지
    reply = ""
    if random.random() < 0.18:
        reply = make_threads_reply(post, pool) if random.random() < 0.4 else random.choice(soft_replies)
    return post["id"], caption, reply, post.get("topic") or promo_topic


def pick_post() -> tuple[str, str, str, str, str | None, str | None, str, str, str]:
    """title, subtitle, ig_caption, threads_caption, layout, headline, threads_id, threads_reply, topic.
    인스타·스레드 같은 주제·같은 본문. 인스타만 주제별 해시.
    """
    th_id, th_caption, th_reply, th_topic = pick_threads_post()
    meta = topic_meta(th_topic)
    label = meta.get("name") or th_topic or "오늘"
    headline = _ig_headline_from_caption(th_caption, label)
    ig_tags = mix_topic_hashtags(th_topic)
    ig_caption = f"{th_caption}\n\n.\n.\n.\n\n{ig_tags}" if ig_tags else th_caption
    return (
        th_id,
        label,
        ig_caption,
        th_caption,
        None,
        headline,
        th_id,
        th_reply,
        th_topic,
    )


def reserve_post(
    title: str,
    th_id: str,
    headline: str | None = None,
    topic: str | None = None,
    threads_caption: str | None = None,
) -> None:
    """Mark selection used BEFORE upload so retries/double-fire cannot re-pick it."""
    st = load_state()
    today = datetime.now(KST).date().isoformat()
    day = st.get("day") or {}
    if day.get("date") != today:
        day = {"date": today, "posted": 0, "target": 2, "titles": [], "threads_ids": []}
    titles = list(day.get("titles") or [])
    if title and title not in titles:
        titles.append(title)
    day["titles"] = titles[-20:]
    ths = list(day.get("threads_ids") or [])
    if th_id and th_id not in ths:
        ths.append(th_id)
    day["threads_ids"] = ths[-20:]
    if topic:
        tops = list(day.get("topics") or [])
        tops.append(topic)
        day["topics"] = tops[-20:]
    st["day"] = day

    used = list(st.get("used_titles", []))
    if title and (not used or used[-1] != title):
        used.append(title)
    st["used_titles"] = used[-120:]

    th_used = list(st.get("used_threads_ids", []))
    if th_id and (not th_used or th_used[-1] != th_id):
        th_used.append(th_id)
    st["used_threads_ids"] = th_used[-180:]

    if headline:
        heads = list(st.get("used_headlines", []))
        if not heads or heads[-1] != headline:
            heads.append(headline)
        st["used_headlines"] = heads[-120:]

    if threads_caption:
        remember_caption_fp(st, threads_caption, th_id)

    save_state(st)


def session_from_cookies() -> requests.Session:
    if not COOKIES.exists():
        raise SystemExit(
            f"쿠키 없음: {COOKIES}\n"
            "Cursor/Chrome에서 @glowsiax 로그인한 뒤 "
            "`python3 ig-auto/scripts/export_cookies_hint.py` 안내를 따르거나 "
            "브라우저 탭에서 세션을 저장하세요."
        )
    data = json.loads(COOKIES.read_text(encoding="utf-8"))
    s = requests.Session()
    s.trust_env = False
    s.headers.update(
        {
            "User-Agent": UA,
            "X-IG-App-ID": IG_APP,
            "X-Requested-With": "XMLHttpRequest",
            "Referer": "https://www.instagram.com/",
            "Origin": "https://www.instagram.com",
        }
    )
    for c in data.get("cookies", data if isinstance(data, list) else []):
        name = c.get("name")
        value = c.get("value")
        if not name or value is None:
            continue
        domain = c.get("domain") or ".instagram.com"
        s.cookies.set(name, value, domain=domain)
    csrf = s.cookies.get("csrftoken") or data.get("csrftoken")
    if csrf:
        s.headers["X-CSRFToken"] = csrf
    claim = data.get("claim")
    if claim:
        s.headers["X-IG-WWW-Claim"] = claim
    return s


def post_photo(s: requests.Session, image_path: Path, caption: str) -> dict:
    jpeg = image_path.read_bytes()
    upload_id = str(int(time.time() * 1000))
    name = f"fb_uploader_{upload_id}"
    rupload_params = json.dumps(
        {
            "media_type": 1,
            "upload_id": upload_id,
            "upload_media_height": 1080,
            "upload_media_width": 1080,
        }
    )
    headers = {
        "Content-Type": "image/jpeg",
        "Offset": "0",
        "X-Entity-Length": str(len(jpeg)),
        "X-Entity-Name": f"{name}.jpg",
        "X-Entity-Type": "image/jpeg",
        "X-Instagram-Rupload-Params": rupload_params,
    }
    up = s.post(
        f"https://www.instagram.com/rupload_igphoto/{name}",
        data=jpeg,
        headers=headers,
        timeout=60,
    )
    if up.status_code not in (200, 201):
        return {"ok": False, "stage": "upload", "status": up.status_code, "body": up.text[:400]}

    form = {
        "upload_id": upload_id,
        "caption": caption,
        "source_type": "library",
        "disable_comments": "0",
        "like_and_view_counts_disabled": "0",
    }
    cfg = s.post(
        "https://www.instagram.com/api/v1/media/configure/",
        data=form,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=60,
    )
    try:
        j = cfg.json()
    except Exception:
        return {"ok": False, "stage": "configure", "status": cfg.status_code, "body": cfg.text[:400]}
    ok = cfg.status_code == 200 and j.get("status") == "ok"
    return {"ok": ok, "status": cfg.status_code, "upload_id": upload_id, "resp": j}


def main() -> int:
    if (ROOT / "STOPPED").exists() and "--force-3d" not in sys.argv:
        log("STOPPED — 3D 발행 중지. 축제는 cruise-sns")
        return 0
    force = "--force" in sys.argv
    title, subtitle, caption, _th_caption, layout, headline, th_id, _th_reply, _th_topic = pick_post()
    reserve_post(title, th_id, headline, threads_caption=_th_caption)
    path = make_image(title, subtitle, layout_hint=layout, headline=headline)
    log(f"image={path.name} title={title}")
    s = session_from_cookies()
    # sanity
    me = s.get(
        "https://www.instagram.com/api/v1/accounts/edit/web_form_data/",
        timeout=30,
    )
    if me.status_code != 200:
        log(f"session_bad status={me.status_code} body={me.text[:120]}")
        return 2
    result = post_photo(s, path, caption)
    log(f"post_result={json.dumps(result, ensure_ascii=False)[:500]}")
    if not result.get("ok"):
        return 1
    st = load_state()
    st["last_post_at"] = datetime.now(KST).isoformat(timespec="seconds")
    st["last_title"] = title
    if not force:
        today = datetime.now(KST).date().isoformat()
        day = st.get("day") or {}
        if day.get("date") != today:
            day = {"date": today, "posted": 0, "target": 2, "titles": [], "threads_ids": []}
        day["posted"] = int(day.get("posted", 0)) + 1
        st["day"] = day
    save_state(st)
    log(f"ok title={title} day={st.get('day')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
