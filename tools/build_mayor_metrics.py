#!/usr/bin/env python3
"""Build lightweight mayor metrics for all 22 counties.
Pure stdlib. Read-only access to data/history and data/observation.
Outputs data/observation/mayor-metrics.json (~4 KB).
"""
import json
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

def build_mayor_metrics():
    with open(BASE_DIR / "data/manifest.json", "r", encoding="utf-8") as f:
        mf = json.load(f)

    county_entries = mf["mayor_history"]["counties"]

    with open(BASE_DIR / "data/observation/manifest.json", "r", encoding="utf-8") as f:
        obs_mf = json.load(f)

    current_22 = [c["name"] for c in obs_mf["counties"]]

    results = []
    for entry in county_entries:
        cname = entry["name"]
        if cname not in current_22:
            continue
        cfile = BASE_DIR / "data" / entry["file"]
        with open(cfile, "r", encoding="utf-8") as f:
            hdata = json.load(f)
        county_area = hdata["areas"][0]
        winners = {}
        electorate_2022 = None
        cands_2022 = []
        trend = {}
        for p in county_area.get("periods", []):
            yr = p["year"]
            for el in p.get("elections", []):
                if "mayor" in el.get("id", ""):
                    cands = el.get("candidates", [])
                    if cands:
                        top = sorted(cands, key=lambda b: b.get("votes", 0), reverse=True)
                        winners[yr] = top[0].get("party")
                        trend[yr] = [
                            {"name": b.get("name"), "party": b.get("party"), "votes": b.get("votes"), "rate": b.get("rate")}
                            for b in top
                        ]
                        if yr == 2022:
                            electorate_2022 = el.get("electorate", 0)
                            cands_2022 = top

        cycle = [yr for yr in [2010, 2014, 2018, 2022] if yr in winners]
        turnover = 0
        for i in range(1, len(cycle)):
            prev_p = winners[cycle[i-1]]
            curr_p = winners[cycle[i]]
            if prev_p and curr_p and prev_p != curr_p:
                turnover += 1

        margin_votes = None
        margin_pct = None
        winner_2022 = None
        if len(cands_2022) >= 2 and electorate_2022:
            margin_votes = cands_2022[0]["votes"] - cands_2022[1]["votes"]
            margin_pct = round(margin_votes / electorate_2022 * 100, 2)
            winner_2022 = {"name": cands_2022[0].get("name"), "party": cands_2022[0].get("party")}
        elif len(cands_2022) == 1:
            winner_2022 = {"name": cands_2022[0].get("name"), "party": cands_2022[0].get("party")}

        cshard_entry = next((c for c in obs_mf["counties"] if c["name"] == cname), None)
        cands_2026_count = 0
        candidates_2026 = []
        if cshard_entry:
            with open(BASE_DIR / "data" / cshard_entry["file"], "r", encoding="utf-8") as f:
                cshard = json.load(f)
            mayor_dist = next((d for d in cshard.get("districts", []) if d.get("office") in ("metro_mayor", "county_mayor")), None)
            if mayor_dist:
                candidates_2026 = mayor_dist.get("candidates", [])
                cands_2026_count = len(candidates_2026)

        if margin_pct is not None and margin_pct <= 3.0:
            band = "close_swing" if turnover >= 1 else "close_only"
            label = "核心激戰" if turnover >= 1 else "傳統激戰"
        else:
            band = "swing_only" if turnover >= 1 else "solid"
            label = "一般搖擺" if turnover >= 1 else "穩定領先"

        results.append({
            "county": cname,
            "band": band,
            "label": label,
            "margin_2022_pct": margin_pct,
            "margin_2022_votes": margin_votes,
            "electorate_2022": electorate_2022,
            "winner_2022": winner_2022,
            "turnover_count": turnover,
            "is_swing": turnover >= 1,
            "cands_2026_count": cands_2026_count,
            "candidates_2026": candidates_2026,
            "trend": {str(yr): trend[yr] for yr in [2014, 2018, 2022] if yr in trend}
        })

    results.sort(key=lambda r: (r["margin_2022_pct"] is None, r["margin_2022_pct"]))

    out_data = {
        "version": "v57",
        "generated_as_of": "2026-10-16",
        "counties": results
    }

    out_path = BASE_DIR / "data/observation/mayor-metrics.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(out_data, f, ensure_ascii=False, indent=2)

    print(f"Wrote {len(results)} counties to {out_path} ({out_path.stat().st_size} bytes)")

if __name__ == "__main__":
    build_mayor_metrics()
