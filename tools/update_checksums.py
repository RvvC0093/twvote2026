#!/usr/bin/env python3
"""Generate data/checksums.json and root checksums.json.
Format: {"schema": "sha256-manifest-v1", "files": {"relpath": "sha256"}}
Pure stdlib. Excludes git, tests, tools, handoff, implementation_plan.
"""
import hashlib
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()

def update_checksums():
    data_dir = BASE_DIR / "data"
    data_files = {}

    for p in sorted(data_dir.rglob("*")):
        if p.is_file() and p.name != "checksums.json" and not p.name.startswith("."):
            rel = p.relative_to(data_dir).as_posix()
            data_files[rel] = compute_sha256(p)

    data_checksums_path = data_dir / "checksums.json"
    with open(data_checksums_path, "w", encoding="utf-8") as f:
        json.dump({"schema": "sha256-manifest-v1", "files": data_files}, f, separators=(",", ":"))

    print(f"Updated {data_checksums_path} with {len(data_files)} files.")

    # Root checksums.json
    root_files = {}
    # include web assets and data/
    include_exts = {".html", ".css", ".js", ".json", ".svg", ".png", ".txt", ".md"}
    exclude_dirs = {".git", "tests", "tools", "handoff", ".staging", ".runtime"}

    for p in sorted(BASE_DIR.rglob("*")):
        if not p.is_file():
            continue
        if any(part in exclude_dirs for part in p.parts):
            continue
        if p.name in ("checksums.json", "implementation_plan.md", "implementation_plan.md.metadata.json"):
            continue
        if p.name.startswith("."):
            continue
        rel = p.relative_to(BASE_DIR).as_posix()
        root_files[rel] = compute_sha256(p)

    # Also add data/checksums.json itself to root checksums
    root_files["data/checksums.json"] = compute_sha256(data_checksums_path)

    # Sort keys
    sorted_root_files = {k: root_files[k] for k in sorted(root_files.keys())}

    root_checksums_path = BASE_DIR / "checksums.json"
    with open(root_checksums_path, "w", encoding="utf-8") as f:
        json.dump({"schema": "sha256-manifest-v1", "files": sorted_root_files}, f, separators=(",", ":"))

    print(f"Updated {root_checksums_path} with {len(sorted_root_files)} files.")

if __name__ == "__main__":
    update_checksums()
