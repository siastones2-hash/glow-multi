#!/usr/bin/env python3
"""Tick ~10min: post IG + Threads, 2×/day evenly across 09:00–22:00 KST."""
from __future__ import annotations

import json
import os
import random
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

os.environ.setdefault(
    "PLAYWRIGHT_BROWSERS_PATH",
    str(Path.home() / "Library" / "Caches" / "ms-playwright"),
)

ROOT = Path(__file__).resolve().parents[1]
STATE = ROOT / "data" / "state.json"
POST = ROOT / "scripts" / "post_playwright.py"
LOG = ROOT / "data" / "run.log"
KST = ZoneInfo("Asia/Seoul")

START_H, END_H = 9, 22  # [09:00, 22:00)
TARGET_MIN, TARGET_MAX = 2, 2  # 하루 정확히 2개
SCHEDULE_VER = 6  # bump → replan day


def log(msg: str) -> None:
    line = f"{datetime.now(KST).isoformat(timespec='seconds')} [sched] {msg}"
    print(line, flush=True)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def load() -> dict:
    if STATE.exists():
        return json.loads(STATE.read_text(encoding="utf-8"))
    return {}


def save(st: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, ensure_ascii=False, indent=2), encoding="utf-8")


def plan_slots(target: int, start_min: int | None = None) -> list[int]:
    """Evenly space `target` posts across [start, 22:00) with light jitter."""
    start = max(START_H * 60, start_min if start_min is not None else START_H * 60)
    end = END_H * 60 - 5  # 21:55
    if target <= 0:
        return []
    span = end - start
    if span < 30:
        return [start] if target else []

    # average gap; keep a floor so 10/day still looks human (~45m+)
    avg = span / target
    min_gap = max(45, int(avg * 0.55))

    slots: list[int] = []
    for i in range(target):
        # equal segments; pick near center with ±20% jitter
        seg_lo = start + int(span * i / target)
        seg_hi = start + int(span * (i + 1) / target)
        mid = (seg_lo + seg_hi) // 2
        jitter = max(5, int((seg_hi - seg_lo) * 0.2))
        pick = random.randint(mid - jitter, mid + jitter)
        pick = max(seg_lo + 2, min(seg_hi - 2, pick))
        if slots:
            pick = max(pick, slots[-1] + min_gap)
        if pick >= end:
            break
        slots.append(pick)

    # if min_gap ate the tail, pack remaining into leftover evening
    while len(slots) < target:
        nxt = (slots[-1] + min_gap) if slots else start
        if nxt >= end:
            break
        slots.append(nxt)

    return slots


def ensure_day(st: dict, today: str, now_mins: int) -> dict:
    day = st.get("day") or {}
    need_plan = day.get("date") != today or day.get("schedule_ver") != SCHEDULE_VER
    if need_plan:
        already = int(day.get("posted", 0)) if day.get("date") == today else 0
        titles = list(day.get("titles") or []) if day.get("date") == today else []
        ths = list(day.get("threads_ids") or []) if day.get("date") == today else []

        target = random.randint(TARGET_MIN, TARGET_MAX)
        # 하루 최소 TARGET_MIN 보장 (이미 올린 수보다 작아지지 않게)
        target = max(TARGET_MIN, target, already)
        if already >= TARGET_MAX:
            target = already

        remaining = max(0, target - already)
        # if mid-day replan, start from now (not past morning slots)
        start_from = now_mins + 5 if (day.get("date") == today and already > 0) else START_H * 60
        if day.get("date") == today and day.get("schedule_ver") != SCHEDULE_VER and already == 0:
            start_from = max(START_H * 60, now_mins + 3)

        new_slots = plan_slots(remaining, start_min=start_from)
        # pad with already-"done" placeholders so next_idx aligns
        slots = [0] * already + new_slots
        target = already + len(new_slots)

        day = {
            "date": today,
            "posted": already,
            "target": target,
            "slots_min": slots,
            "next_idx": already,
            "plan": [f"{m // 60:02d}:{m % 60:02d}" for m in new_slots],
            "schedule_ver": SCHEDULE_VER,
            "titles": titles,
            "threads_ids": ths,
            "note": f"IG+Threads mix+topics {TARGET_MIN}–{TARGET_MAX}/day, even 09–22",
        }
        st["day"] = day
        save(st)
        log(
            f"new_day target={target} (done={already}) "
            f"remaining={day['plan']} gap≈even 09–22"
        )
    return st


def main() -> int:
    if (ROOT / "STOPPED").exists():
        log("STOPPED — 콘텐츠는 cruise-sns (서울크루즈). 3D 자동발행 안 함")
        return 0
    now = datetime.now(KST)
    today = now.date().isoformat()
    mins = now.hour * 60 + now.minute

    if now.hour < START_H or now.hour >= END_H:
        log(f"outside_window hour={now.hour}")
        return 0

    st = ensure_day(load(), today, mins)
    day = st["day"]
    if day.get("posted", 0) >= day.get("target", 3):
        log(f"quota_done posted={day['posted']}/{day['target']}")
        return 0

    idx = int(day.get("next_idx", 0))
    slots = day.get("slots_min") or []
    if idx >= len(slots):
        log("no_more_slots")
        return 0

    due = slots[idx]
    if due <= 0:
        day["next_idx"] = idx + 1
        st["day"] = day
        save(st)
        return 0

    # Early grace: launchd may tick a few minutes before due.
    # Fire window: [due - 8, due + 35]
    early = 8
    late = 35
    if mins < due - early:
        log(f"wait until {due//60:02d}:{due%60:02d} now={now.hour:02d}:{now.minute:02d}")
        return 0
    if mins > due + late:
        misses = int(day.get("miss_streak", 0)) + 1
        day["miss_streak"] = misses
        if misses >= 2 or mins > due + 90:
            day["next_idx"] = idx + 1
            day["miss_streak"] = 0
            st["day"] = day
            save(st)
            log(f"missed_slot {due//60:02d}:{due%60:02d}, advance (streak={misses})")
        else:
            st["day"] = day
            save(st)
            log(f"missed_slot {due//60:02d}:{due%60:02d}, will_retry")
        return 0

    log(f"firing slot={due//60:02d}:{due%60:02d} ({idx+1}/{day.get('target')})")
    lock = ROOT / "data" / "post.lock"
    if lock.exists():
        age = time.time() - lock.stat().st_mtime
        if age < 180:
            log(f"skip_locked age={age:.0f}s")
            return 0
    try:
        lock.write_text(datetime.now(KST).isoformat(), encoding="utf-8")
    except Exception:
        pass
    rc = subprocess.call([sys.executable, str(POST), "--force"])
    try:
        lock.unlink(missing_ok=True)
    except Exception:
        pass
    st = load()
    day = st.get("day") or day
    if day.get("date") != today:
        day = {
            "date": today,
            "posted": 0,
            "target": day.get("target", 3),
            "slots_min": slots,
            "next_idx": idx,
            "schedule_ver": SCHEDULE_VER,
        }
    if rc == 0:
        day["posted"] = int(day.get("posted", 0)) + 1
        day["next_idx"] = idx + 1
        day["miss_streak"] = 0
        day["slots_min"] = slots
        day["target"] = day.get("target") or len(slots)
        day["schedule_ver"] = SCHEDULE_VER
        st["day"] = day
        save(st)
        log(f"posted_ok {day['posted']}/{day['target']}")
    else:
        day["miss_streak"] = int(day.get("miss_streak", 0)) + 1
        st["day"] = day
        save(st)
        log(f"post_failed rc={rc} (will_retry, streak={day['miss_streak']})")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
