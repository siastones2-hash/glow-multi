#!/usr/bin/env python3
"""
소림사 네이버 플레이스 리뷰 수집 (베이스라인)

- 맥 크롬 실제 프로필(user-data-dir)을 Playwright에 연결해 네이버 보안 차단 완화
- 정기 실행: cron / launchd 예시는 파일 하단 주석 참고

사전 준비:
  pip3 install playwright
  python3 -m playwright install chromium   # 최초 1회 (크롬 채널 사용 시 생략 가능)

주의:
  - 크롬이 같은 프로필로 이미 실행 중이면 충돌합니다. 수집 전 크롬 완전 종료(Cmd+Q).
  - 또는 NAVER_CHROME_USER_DATA_DIR 에 복사한 프로필 경로 지정.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ── 맥 크롬 프로필 (네이버 로그인·쿠키 유지) ──
DEFAULT_MAC_CHROME_USER_DATA = os.path.expanduser(
    "~/Library/Application Support/Google/Chrome"
)
CHROME_USER_DATA_DIR = os.environ.get(
    "NAVER_CHROME_USER_DATA_DIR", DEFAULT_MAC_CHROME_USER_DATA
)
CHROME_PROFILE = os.environ.get("CHROME_PROFILE_DIRECTORY", "Default")

OUTPUT_DIR = Path(__file__).resolve().parent / "data" / "naver_reviews"

# place_url 은 네이버 지도 → 업체 → 리뷰 탭 URL 을 브라우저에서 복사해 넣으면 가장 안정적입니다.
STORE_TARGETS: list[dict[str, str]] = [
    {
        "id": "sorimsa_yangsan",
        "name": "소림사 양산석산점",
        "search_query": "소림사 양산석산점",
        "place_url": os.environ.get("NAVER_PLACE_URL_YANGSAN", ""),
    },
    {
        "id": "sorimsa_dongnam",
        "name": "소림사 동남지구점",
        "search_query": "소림사 동남지구점",
        "place_url": os.environ.get("NAVER_PLACE_URL_DONGNAM", ""),
    },
]

HEADLESS = os.environ.get("NAVER_HEADLESS", "0") == "1"
MAX_REVIEWS_PER_STORE = int(os.environ.get("NAVER_MAX_REVIEWS", "30"))


def _now_iso() -> str:
    return datetime.now(timezone.utc).astimezone().isoformat()


def _ensure_playwright():
    try:
        from playwright.sync_api import sync_playwright  # noqa: F401
        return True
    except ImportError:
        print(
            "playwright 미설치: pip3 install playwright && python3 -m playwright install chromium",
            file=sys.stderr,
        )
        return False


def _search_place_url(page, query: str) -> str:
    """지도 검색으로 첫 번째 업체 링크 추정 (베이스라인)."""
    url = f"https://map.naver.com/p/search/{query}"
    page.goto(url, wait_until="domcontentloaded", timeout=60_000)
    page.wait_for_timeout(3000)
    for selector in (
        "a[href*='/place/']",
        "a[href*='place.naver.com']",
        "a.place_bluelink",
    ):
        loc = page.locator(selector).first
        if loc.count() > 0:
            href = loc.get_attribute("href")
            if href:
                if href.startswith("/"):
                    return "https://map.naver.com" + href
                return href
    return page.url


def _open_reviews_section(page) -> None:
    """리뷰 탭/버튼 클릭 시도."""
    labels = ["리뷰", "방문자리뷰", "방문자 리뷰", "Review"]
    for label in labels:
        btn = page.get_by_role("button", name=re.compile(label, re.I))
        if btn.count() > 0:
            btn.first.click(timeout=5000)
            page.wait_for_timeout(2000)
            return
        tab = page.get_by_text(re.compile(f"^{label}$", re.I))
        if tab.count() > 0:
            tab.first.click(timeout=5000)
            page.wait_for_timeout(2000)
            return


def _extract_reviews_from_page(page) -> list[dict[str, Any]]:
    """
    DOM 구조 변경에 대비한 다중 셀렉터 베이스라인.
    실패 시 빈 리스트 — 이후 셀렉터만 수정하면 됨.
    """
    reviews: list[dict[str, Any]] = []
    containers = page.locator(
        "li[class*='review'], div[class*='review'], "
        "[data-testid*='review'], .place_section_content li"
    )
    count = min(containers.count(), MAX_REVIEWS_PER_STORE)
    for i in range(count):
        item = containers.nth(i)
        text = ""
        for sel in (".review_desc", ".zPfVt", "span", "p"):
            part = item.locator(sel).first
            if part.count() > 0:
                t = (part.inner_text(timeout=2000) or "").strip()
                if len(t) > len(text):
                    text = t
        if not text:
            text = (item.inner_text(timeout=2000) or "").strip()
        if len(text) < 5:
            continue
        author = ""
        for sel in (".name", ".nickname", "a[class*='name']", "strong"):
            a = item.locator(sel).first
            if a.count() > 0:
                author = (a.inner_text(timeout=1000) or "").strip()
                if author:
                    break
        date = ""
        for sel in (".time", "time", "span[class*='date']"):
            d = item.locator(sel).first
            if d.count() > 0:
                date = (d.inner_text(timeout=1000) or "").strip()
                if date:
                    break
        reviews.append(
            {
                "author": author or None,
                "date": date or None,
                "text": text[:2000],
            }
        )
    return reviews


def collect_store(page, store: dict[str, str]) -> dict[str, Any]:
    name = store["name"]
    print(f"\n▶ {name} 수집 중...")
    target_url = (store.get("place_url") or "").strip()
    if not target_url:
        target_url = _search_place_url(page, store["search_query"])
        print(f"  검색 URL: {target_url}")
    else:
        page.goto(target_url, wait_until="domcontentloaded", timeout=60_000)
        print(f"  지정 URL: {target_url}")

    page.wait_for_timeout(2500)
    _open_reviews_section(page)
    page.wait_for_timeout(2000)

    # 네이버 지도는 iframe 을 쓰는 경우가 많음
    reviews: list[dict[str, Any]] = []
    for frame in page.frames:
        try:
            found = _extract_reviews_from_page(frame)
            if len(found) > len(reviews):
                reviews = found
        except Exception:
            continue
    if not reviews:
        reviews = _extract_reviews_from_page(page)

    print(f"  ✓ 리뷰 {len(reviews)}건 추출")
    return {
        "store_id": store["id"],
        "store_name": name,
        "source_url": page.url,
        "collected_at": _now_iso(),
        "review_count": len(reviews),
        "reviews": reviews,
    }


def run() -> int:
    if not _ensure_playwright():
        return 1

    if not Path(CHROME_USER_DATA_DIR).is_dir():
        print(f"크롬 프로필 없음: {CHROME_USER_DATA_DIR}", file=sys.stderr)
        return 1

    from playwright.sync_api import sync_playwright

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []

    print("Chrome user-data-dir:", CHROME_USER_DATA_DIR)
    print("Profile:", CHROME_PROFILE)
    print("※ 같은 프로필로 크롬이 켜져 있으면 종료 후 실행하세요.\n")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=CHROME_USER_DATA_DIR,
            channel="chrome",
            headless=HEADLESS,
            locale="ko-KR",
            viewport={"width": 1400, "height": 900},
            args=[
                f"--profile-directory={CHROME_PROFILE}",
                "--disable-blink-features=AutomationControlled",
            ],
        )
        page = context.pages[0] if context.pages else context.new_page()

        for store in STORE_TARGETS:
            try:
                payload = collect_store(page, store)
                results.append(payload)
                out = OUTPUT_DIR / f"{store['id']}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
                print(f"  저장: {out}")
            except Exception as e:
                print(f"  ✗ 오류 ({store['name']}): {e}", file=sys.stderr)
                results.append(
                    {
                        "store_id": store["id"],
                        "store_name": store["name"],
                        "error": str(e),
                        "collected_at": _now_iso(),
                    }
                )
            time.sleep(2)

        context.close()

    summary_path = OUTPUT_DIR / f"summary_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    summary_path.write_text(
        json.dumps({"collected_at": _now_iso(), "stores": results}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"\n완료 → {summary_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(run())

# ── 정기 실행 예시 (맥 launchd / cron) ──
# 매일 09:00:
#   0 9 * * * cd /Users/apple/glow-multi && /usr/bin/python3 naver_review_collector.py >> logs/naver_review.log 2>&1
