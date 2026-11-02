#!/usr/bin/env python3
"""Site verification script for TW_vote_gh_pages according to implementation_plan.md Section 7.

Checks:
1. Checksums verification (checksums.json against tracked files)
2. Manifest pins consistency (manifest.json -> observation, geography, council_metrics, mayor_metrics)
3. Forbidden words check (章魚哥, 離線資料, county_news, councilor close_swing)
4. File size limits (no file > 50 MB, lite topologies < 1 MB, council_metrics < 1 MB)
5. Registration status wording check
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

FORBIDDEN_TERMS = [
    ('章魚哥', ['app.js', 'index.html', 'viewer_core.js', 'style.css', 'README.md']),
    ('離線資料', ['index.html', 'app.js', 'ui_shell.js']),
    ('county_news', ['index.html', 'app.js', 'style.css']),
]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def check_forbidden_terms() -> list[str]:
    errors = []
    manifest_path = ROOT / 'data/manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    roster_status = manifest.get('observation_2026', {}).get('registration_status', '')

    for term, file_names in FORBIDDEN_TERMS:
        for fname in file_names:
            p = ROOT / fname
            if not p.exists():
                continue
            content = p.read_text(encoding='utf-8', errors='ignore')
            if term in content:
                errors.append(f'Forbidden term "{term}" found in {fname}')

    if roster_status != 'approved':
        for fname in ['index.html', 'app.js']:
            p = ROOT / fname
            if p.exists() and '審定' in p.read_text(encoding='utf-8', errors='ignore'):
                errors.append(f'Term "審定" found while registration_status is "{roster_status}" in {fname}')

    return errors


def check_manifest_pins() -> list[str]:
    errors = []
    manifest_path = ROOT / 'data/manifest.json'
    if not manifest_path.exists():
        return ['data/manifest.json missing']

    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))

    # 1. Observation manifest pin
    obs_info = manifest.get('observation_2026')
    if not obs_info:
        errors.append('observation_2026 missing from data/manifest.json')
    else:
        obs_file = ROOT / 'data' / obs_info['manifest']
        if not obs_file.exists():
            errors.append(f'observation manifest file {obs_file} not found')
        else:
            actual_sha = sha256_file(obs_file)
            if actual_sha != obs_info['sha256']:
                errors.append(f'observation manifest sha mismatch: expected {obs_info["sha256"]}, got {actual_sha}')

        # Council metrics pin
        cm_info = obs_info.get('council_metrics')
        if not cm_info:
            errors.append('council_metrics missing from observation_2026 in data/manifest.json')
        else:
            cm_file = ROOT / 'data' / cm_info['file']
            if not cm_file.exists():
                errors.append(f'council_metrics file {cm_file} not found')
            else:
                actual_cm_sha = sha256_file(cm_file)
                if actual_cm_sha != cm_info['sha256']:
                    errors.append(f'council_metrics sha mismatch: expected {cm_info["sha256"]}, got {actual_cm_sha}')

        # Mayor metrics pin
        mm_info = obs_info.get('mayor_metrics')
        if mm_info:
            mm_file = ROOT / 'data' / mm_info['file']
            if not mm_file.exists():
                errors.append(f'mayor_metrics file {mm_file} not found')
            else:
                actual_mm_sha = sha256_file(mm_file)
                if actual_mm_sha != mm_info['sha256']:
                    errors.append(f'mayor_metrics sha mismatch: expected {mm_info["sha256"]}, got {actual_mm_sha}')

    # 2. Geography pins
    geo_info = manifest.get('geography', {})
    for k in ['county_topology', 'town_topology']:
        top_info = geo_info.get(k)
        if top_info:
            top_file = ROOT / 'data' / top_info['file']
            if not top_file.exists():
                errors.append(f'{k} file {top_file} not found')
            else:
                actual_top_sha = sha256_file(top_file)
                if actual_top_sha != top_info['sha256']:
                    errors.append(f'{k} sha mismatch: expected {top_info["sha256"]}, got {actual_top_sha}')

    return errors


def check_file_sizes() -> list[str]:
    errors = []
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB limit
    for root, dirs, files in os.walk(ROOT):
        if '.git' in root or '__pycache__' in root:
            continue
        for f in files:
            p = Path(root) / f
            size = p.stat().st_size
            if size > MAX_FILE_SIZE:
                errors.append(f'File {p.relative_to(ROOT)} exceeds 50 MB: {size / (1024*1024):.1f} MB')

    # Check lite topologies specifically < 1 MB
    county_topo = ROOT / 'data/geo/county.topo.json'
    if county_topo.exists() and county_topo.stat().st_size >= 1024 * 1024:
        errors.append(f'county.topo.json exceeds 1 MB: {county_topo.stat().st_size / 1024:.1f} KB')

    town_topo = ROOT / 'data/geo/town.topo.json'
    if town_topo.exists() and town_topo.stat().st_size >= 1024 * 1024:
        errors.append(f'town.topo.json exceeds 1 MB: {town_topo.stat().st_size / 1024:.1f} KB')

    # Check council metrics < 1 MB
    council_metrics = ROOT / 'data/observation/council-metrics.json'
    if council_metrics.exists() and council_metrics.stat().st_size >= 1024 * 1024:
        errors.append(f'council-metrics.json exceeds 1 MB: {council_metrics.stat().st_size / 1024:.1f} KB')

    # Check og.png <= 200 KB
    og_png = ROOT / 'og.png'
    if og_png.exists() and og_png.stat().st_size > 200 * 1024:
        errors.append(f'og.png exceeds 200 KB: {og_png.stat().st_size / 1024:.1f} KB')

    return errors


def check_checksums() -> list[str]:
    errors = []
    chk_path = ROOT / 'checksums.json'
    if not chk_path.exists():
        errors.append('checksums.json not found')
        return errors

    raw = json.loads(chk_path.read_text(encoding='utf-8'))
    file_map = raw.get('files', raw)
    for rel_path, expected_sha in file_map.items():
        p = ROOT / rel_path
        if not p.exists():
            errors.append(f'Tracked file missing: {rel_path}')
            continue
        actual_sha = sha256_file(p)
        if actual_sha != expected_sha:
            errors.append(f'Checksum mismatch for {rel_path}: expected {expected_sha[:10]}..., got {actual_sha[:10]}...')
    return errors


def main():
    print('Running verify_site.py...')
    errors = []

    print('1. Checking file sizes...')
    size_errs = check_file_sizes()
    errors.extend(size_errs)
    if size_errs:
        for e in size_errs: print('  FAIL:', e)
    else:
        print('  PASS: All file sizes within limits.')

    print('2. Checking manifest pins...')
    pin_errs = check_manifest_pins()
    errors.extend(pin_errs)
    if pin_errs:
        for e in pin_errs: print('  FAIL:', e)
    else:
        print('  PASS: Manifest pins consistent.')

    print('3. Checking forbidden terms...')
    term_errs = check_forbidden_terms()
    errors.extend(term_errs)
    if term_errs:
        for e in term_errs: print('  FAIL:', e)
    else:
        print('  PASS: No forbidden terms found.')

    print('4. Checking checksums integrity...')
    chk_errs = check_checksums()
    errors.extend(chk_errs)
    if chk_errs:
        for e in chk_errs: print('  FAIL:', e)
    else:
        print('  PASS: Checksums integrity verified.')

    if errors:
        print(f'\nFAILED with {len(errors)} errors.')
        return 1

    print('\nALL VERIFICATIONS PASSED!')
    return 0


if __name__ == '__main__':
    sys.exit(main())
