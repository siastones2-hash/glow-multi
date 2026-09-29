#!/usr/bin/env python3
"""10분마다 체크 → 하루 2회 (09–22시). 자동은 켠 뒤에만 동작."""
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

ROOT = Path(__file__).resolve().parents[1]
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
STATE = ROOT / "data" / "state.json"
POST = ROOT / "scripts" / "post.py"
LOG = ROOT / "data" / "run.log"
KST = ZoneInfo("Asia/Seoul")
START_H = int(CFG.get("start_hour", 9))
END_H = int(CFG.get("end_hour", 22))
TARGET = int(CFG.get("posts_per_day", 2))


def log(msg: str) -> None:
    line = f"{datetime.now(KST).isoformat(timespec='seconds')} [cruise] {msg}"
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


def plan_slots(n: int) -> list[int]:
    start, end = START_H * 60, END_H * 60 - 5
    span = max(60, end - start)
    slots = []
    for i in range(n):
        mid = start + int(span * (i + 0.5) / n)
        jitter = random.randint(-20, 20)
        slots.append(max(start + 10, min(end - 10, mid + jitter)))
    return sorted(slots)


def main() -> int:
    if not CFG.get("auto_enabled"):
        log("auto_off — config.json auto_enabled=false")
        return 0
    now = datetime.now(KST)
    if now.hour < START_H or now.hour >= END_H:
        return 0
    today = now.date().isoformat()
    mins = now.hour * 60 + now.minute
    st = load()
    day = st.get("day") or {}
    if day.get("date") != today:
        slots = plan_slots(TARGET)
        day = {
            "date": today,
            "posted": 0,
            "target": TARGET,
            "slots_min": slots,
            "next_idx": 0,
            "plan": [f"{m//60:02d}:{m%60:02d}" for m in slots],
        }
        st["day"] = day
        save(st)
        log(f"new_day plan={day['plan']}")

    if day.get("posted", 0) >= day.get("target", TARGET):
        return 0
    idx = int(day.get("next_idx", 0))
    slots = day.get("slots_min") or []
    if idx >= len(slots):
        return 0
    due = slots[idx]
    if mins < due - 8:
        return 0
    if mins > due + 40:
        day["next_idx"] = idx + 1
        st["day"] = day
        save(st)
        log(f"missed {due//60:02d}:{due%60:02d}")
        return 0

    lock = ROOT / "data" / "post.lock"
    if lock.exists() and time.time() - lock.stat().st_mtime < 180:
        return 0
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text(datetime.now(KST).isoformat(), encoding="utf-8")
    log(f"fire {due//60:02d}:{due%60:02d}")
    rc = subprocess.call([sys.executable, str(POST), "--force"])
    try:
        lock.unlink(missing_ok=True)
    except Exception:
        pass
    if rc == 0:
        day["posted"] = int(day.get("posted", 0)) + 1
        day["next_idx"] = idx + 1
        st["day"] = day
        save(st)
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
