#!/usr/bin/env python3
"""Capture 10 validation screenshots required by implementation_plan.md Section 7 & 8.4.
Uses Brave Browser headless.
"""
import os
import subprocess
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SCREENSHOTS_DIR = BASE_DIR / "handoff/screenshots"
BRAVE_PATH = "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"

TASKS = [
    ("01_desktop_home_dark.png", 1440, 900, "http://127.0.0.1:8765/#/mayor"),
    ("02_desktop_home_light.png", 1440, 900, "http://127.0.0.1:8765/?theme=light#/mayor"),
    ("03_mobile_home_dark.png", 390, 844, "http://127.0.0.1:8765/#/mayor"),
    ("04_desktop_council_dark.png", 1440, 900, "http://127.0.0.1:8765/#/council"),
    ("05_mobile_council_dark.png", 390, 844, "http://127.0.0.1:8765/#/council"),
    ("06_desktop_mayor_select.png", 1440, 900, "http://127.0.0.1:8765/#/mayor/%E5%B1%8F%E6%9D%B1%E7%B8%A3"),
    ("07_mobile_mayor_select.png", 390, 844, "http://127.0.0.1:8765/#/mayor/%E5%B1%8F%E6%9D%B1%E7%B8%A3"),
    ("08_desktop_council_card.png", 1440, 900, "http://127.0.0.1:8765/#/council/%E8%87%BA%E4%B8%AD%E5%B8%82/regional/03"),
    ("09_mobile_council_card.png", 390, 844, "http://127.0.0.1:8765/#/council/%E8%87%BA%E4%B8%AD%E5%B8%82/regional/03"),
    ("10_desktop_council_light.png", 1440, 900, "http://127.0.0.1:8765/?theme=light#/council"),
]

def main():
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    print(f"Capturing {len(TASKS)} screenshots using {BRAVE_PATH}...")

    results = []
    for filename, w, h, url in TASKS:
        out_path = SCREENSHOTS_DIR / filename
        cmd = [
            BRAVE_PATH,
            "--headless=new",
            "--disable-gpu",
            "--no-sandbox",
            f"--window-size={w},{h}",
            "--virtual-time-budget=4000",
            f"--screenshot={out_path}",
            url
        ]
        start_t = time.time()
        p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        elapsed = time.time() - start_t
        if out_path.exists() and out_path.stat().st_size > 0:
            sz_kb = out_path.stat().st_size / 1024
            print(f"✓ {filename} ({w}x{h}): {sz_kb:.1f} KB, in {elapsed:.2f}s")
            results.append((filename, True, sz_kb))
        else:
            print(f"✗ Failed {filename}: {p.stderr[:200]}")
            results.append((filename, False, 0))

    success_count = sum(1 for r in results if r[1])
    print(f"\nCompleted {success_count}/{len(TASKS)} screenshots successfully.")

if __name__ == "__main__":
    main()
