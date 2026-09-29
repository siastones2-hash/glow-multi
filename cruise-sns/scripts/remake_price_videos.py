#!/usr/bin/env python3
"""hook-01 / 03-입장료 영상 글자를 대인 2만 5천 원으로 다시 씌움."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path("/Users/apple/glow-multi")
REELS = ROOT / "docs" / "cruise-festival" / "reels"
OUT = ROOT / "cruise-sns" / "out"
FONT = "/System/Library/Fonts/AppleSDGothicNeo.ttc"
FF = "/Users/apple/Library/Python/3.9/lib/python/site-packages/imageio_ffmpeg/binaries/ffmpeg-macos-aarch64-v7.1"


def font(size: int, index: int = 0) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT, size=size, index=index)


def center_text(draw: ImageDraw.ImageDraw, y: int, text: str, f, fill=(255, 255, 255), w: int = 1080) -> None:
    x0, y0, x1, y1 = draw.textbbox((0, 0), text, font=f)
    draw.text(((w - (x1 - x0)) / 2, y), text, font=f, fill=fill)


def inpaint_white(frame: np.ndarray, y0: int, y1: int, thresh: int = 160, dilate: int = 11) -> None:
    roi = frame[y0:y1]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    mask = (gray > thresh).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dilate, dilate))
    mask = cv2.dilate(mask, k, iterations=1)
    frame[y0:y1] = cv2.inpaint(roi, mask, 7, cv2.INPAINT_TELEA)


def remake_hook(src: Path, dst_raw: Path) -> None:
    cap = cv2.VideoCapture(str(src))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    dst_raw.parent.mkdir(parents=True, exist_ok=True)
    wr = cv2.VideoWriter(str(dst_raw), fourcc, fps, (w, h))
    f_big = font(56, 1)
    f_foot = font(26, 0)
    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        inpaint_white(frame, 1095, 1185, 160, 11)
        inpaint_white(frame, 1848, 1888, 150, 7)
        img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        draw = ImageDraw.Draw(img)
        center_text(draw, 1108, "한강 루프탑이 2만 5천 원인데.", f_big, (255, 255, 255), w)
        draw.text((48, 1854), "대인 2만 5천 원  ·  010-6773-0419", font=f_foot, fill=(230, 230, 230))
        wr.write(cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR))
        n += 1
    cap.release()
    wr.release()
    print("hook frames", n, flush=True)


def remake_fee(src: Path, dst_raw: Path) -> None:
    cap = cv2.VideoCapture(str(src))
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    wr = cv2.VideoWriter(str(dst_raw), fourcc, fps, (w, h))
    f_big = font(92, 1)
    n = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        roi_y0, roi_y1 = 780, 1120
        roi = frame[roi_y0:roi_y1]
        b, g, r = cv2.split(roi)
        mn = np.minimum(np.minimum(r, g), b)
        mx = np.maximum(np.maximum(r, g), b)
        mask = ((mn > 170) & ((mx.astype(int) - mn.astype(int)) < 40)).astype(np.uint8) * 255
        mask[:, :80] = 0
        mask[:, -80:] = 0
        if mask.mean() > 0.4:
            k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
            mask = cv2.dilate(mask, k, 1)
            frame[roi_y0:roi_y1] = cv2.inpaint(roi, mask, 8, cv2.INPAINT_TELEA)
            img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            draw = ImageDraw.Draw(img)
            center_text(draw, 880, "2만 5천 원", f_big, (255, 255, 255), w)
            frame = cv2.cvtColor(np.array(img), cv2.COLOR_RGB2BGR)
        wr.write(frame)
        n += 1
    cap.release()
    wr.release()
    print("fee frames", n, flush=True)


def encode_h264(raw: Path, dst: Path) -> None:
    import subprocess

    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        FF, "-y",
        "-i", str(raw),
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "18",
        "-c:a", "aac", "-shortest",
        "-movflags", "+faststart",
        str(dst),
    ]
    print("encode", dst.name, flush=True)
    subprocess.check_call(cmd)


def main() -> int:
    hook_raw = OUT / "_hook01_raw.mp4"
    fee_raw = OUT / "_fee03_raw.mp4"
    remake_hook(REELS / "hook-01-2만원.mp4", hook_raw)
    encode_h264(hook_raw, OUT / "hook01.mp4")
    encode_h264(hook_raw, REELS / "hook-01-2만5천.mp4")
    fee_src = REELS / "03-입장료-2만원.bak.mp4"
    if not fee_src.exists():
        fee_src = REELS / "03-입장료.mp4"
    remake_fee(fee_src, fee_raw)
    encode_h264(fee_raw, REELS / "03-입장료.mp4")
    print("DONE", OUT / "hook01.mp4", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
