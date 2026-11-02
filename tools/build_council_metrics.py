#!/usr/bin/env python3
"""Build council metrics according to implementation_plan.md Section 2 & 3.

Reads:
- Canonical SQLite (election_history-v31.sqlite) in read-only mode
- 2026 observation manifest (data/observation/manifest.json)
- 2026 councilor scopes (seats & townships)

Outputs:
- data/observation/council-metrics.json
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys

COUNCIL_MARGIN_BANDS = [1, 3, 6]  # <=1% tight, 1-3% close, 3-6% normal, >6% loose
SWING_RATE_BANDS = [0.2, 0.5]     # >=0.5 large, 0.2-0.5 moving, <0.2 stable
DELTA_FLAT_THRESHOLD = 0.1        # |delta| < 0.1 flat

DEFAULT_CANONICAL_PATH = Path(__file__).resolve().parents[2] / 'TW_vote_2026/releases/Election-Machine-2026-v38/data/canonical/election_history-v31.sqlite'
DEFAULT_OBSERVATION_MANIFEST = Path(__file__).resolve().parents[1] / 'data/observation/manifest.json'
DEFAULT_SCOPES_PATH = Path(__file__).resolve().parents[2] / 'TW_vote_2026/dev/provenance/viewer-v38/councilor-scopes.json'
DEFAULT_OUTPUT_PATH = Path(__file__).resolve().parents[1] / 'data/observation/council-metrics.json'

OFFICE_KIND_MAP = {
    '2014年直轄市區域議員': 'regional',
    '2014年縣市區域議員': 'regional',
    '2014年直轄市平原議員': 'plain_indigenous',
    '2014年縣市平原議員': 'plain_indigenous',
    '2014年直轄市山原議員': 'mountain_indigenous',
    '2014年縣市山原議員': 'mountain_indigenous',
    '2018年直轄市區域議員': 'regional',
    '2018年縣市區域議員': 'regional',
    '2018年直轄市平原議員': 'plain_indigenous',
    '2018年縣市平原議員': 'plain_indigenous',
    '2018年直轄市山原議員': 'mountain_indigenous',
    '2018年縣市山原議員': 'mountain_indigenous',
    '2022年直轄市區域議員': 'regional',
    '2022年縣市區域議員': 'regional',
    '2022年直轄市平地原住民議員': 'plain_indigenous',
    '2022年縣市平地原住民議員': 'plain_indigenous',
    '2022年直轄市山地原住民議員': 'mountain_indigenous',
    '2022年縣市山地原住民議員': 'mountain_indigenous',
}

SCOPE_TO_OFFICE_KIND = {
    'regional': 'regional',
    'plains_indigenous': 'plain_indigenous',
    'mountain_indigenous': 'mountain_indigenous',
}


def normalize_party(party: str | None) -> str:
    p = (party or '').strip()
    if not p or p in {'無', '無黨籍', '無黨籍及未經政黨推薦'}:
        return '無黨籍'
    if p in {'民主進步黨', '民進黨'}:
        return '民進黨'
    if p in {'中國國民黨', '國民黨'}:
        return '國民黨'
    if p in {'台灣民眾黨', '民眾黨'}:
        return '民眾黨'
    if p == '時代力量':
        return '時代力量'
    return '其他政黨'


def last_seat_margin(cands: list[dict], valid_votes: int | float | None) -> dict:
    """Calculate margin of the last winning seat."""
    elected = [c for c in cands if c.get('note') in ('*', '!')]
    losers = [c for c in cands if c.get('note') not in ('*', '!')]
    women_quota = any(c.get('note') in ('!', '-') for c in cands)

    if not losers:
        return {
            'votes': None,
            'pct': None,
            'uncontested': True,
            'women_quota_applied': women_quota,
            'last_win': None,
            'first_lose': None
        }

    regular = [c for c in elected if c.get('note') == '*'] or elected
    lw = min(regular, key=lambda c: c['votes'])
    fl = max(losers, key=lambda c: c['votes'])
    d = lw['votes'] - fl['votes']
    pct = round(d / valid_votes * 100, 2) if valid_votes and valid_votes > 0 else None

    return {
        'votes': int(d),
        'pct': pct,
        'last_win': lw['name'],
        'first_lose': fl['name'],
        'women_quota_applied': women_quota,
        'uncontested': False
    }


def seat_shift(a: dict, b: dict) -> float:
    """Calculate seats shifted between two distributions."""
    parties = set(a) | set(b)
    return sum(abs(b.get(p, 0) - a.get(p, 0)) for p in parties) / 2.0


def seat_swing_metrics(seats_by_party_by_year: dict[int, dict], avg_seats: float) -> dict:
    """Calculate total seat swing and rate across elections."""
    shifts = []
    years = sorted(k for k in (2014, 2018, 2022) if k in seats_by_party_by_year)
    if years != [2014, 2018, 2022]:
        return {"total": None, "rate": None, "band": "na"}
    for i in range(len(years) - 1):
        y1, y2 = years[i], years[i + 1]
        shifts.append(seat_shift(seats_by_party_by_year[y1], seats_by_party_by_year[y2]))

    total = sum(shifts)
    rate = total / avg_seats if avg_seats and avg_seats > 0 else 0.0
    band = 'large' if rate >= 0.5 else ('moving' if rate >= 0.2 else 'stable')

    return {
        'total': total,
        'rate': round(rate, 3),
        'band': band
    }


def assess_comparability(
    townships_old: list[str],
    seats_old: int,
    townships_new: list[str],
    seats_new: int,
    partial_townships: list[str] | None = None
) -> str:
    """Determine comparability between two cycles."""
    if partial_townships:
        return 'redistricted'
    if set(townships_old) != set(townships_new):
        return 'redistricted'
    if seats_old != seats_new:
        return 'seats_changed'
    return 'comparable'


def competition_intensity(
    cands_2026: int,
    seats_2026: int,
    cands_2022: int | None = None,
    seats_2022: int | None = None,
    comparable: bool = True
) -> dict:
    """Calculate 2026 candidate / seat ratio and delta vs 2022."""
    r_2026 = round(cands_2026 / seats_2026, 2) if cands_2026 is not None and seats_2026 and seats_2026 > 0 else None
    if r_2026 is None or not comparable or not cands_2022 or not seats_2022 or seats_2022 <= 0:
        return {
            'ratio_2026': r_2026,
            'ratio_2022': None,
            'delta': None,
            'trend': 'na'
        }

    r_2022 = round(cands_2022 / seats_2022, 2)
    delta = round(r_2026 - r_2022, 2)
    if abs(delta) < DELTA_FLAT_THRESHOLD:
        trend = 'flat'
    elif delta >= DELTA_FLAT_THRESHOLD:
        trend = 'up'
    else:
        trend = 'down'

    return {
        'ratio_2026': r_2026,
        'ratio_2022': r_2022,
        'delta': delta,
        'trend': trend
    }


def parse_district_no(raw_name: str) -> str:
    """Extract 2-digit district_no string e.g. '第01選舉區' -> '01', '第1選區' -> '01'."""
    m = re.search(r'第0*(\d+)選(?:舉)?區', raw_name)
    if m:
        return f'{int(m.group(1)):02d}'
    # If already just numbers
    m2 = re.search(r'(\d+)', raw_name)
    if m2:
        return f'{int(m2.group(1)):02d}'
    return '01'


def roster_district_key(district: dict, locations_by_id: dict) -> tuple:
    location = locations_by_id.get(district['id'])
    if not location or location.get('scope') not in SCOPE_TO_OFFICE_KIND:
        raise ValueError(f"Missing official council scope: {district['id']}")
    return district['county'], SCOPE_TO_OFFICE_KIND[location['scope']], parse_district_no(district['name'])


def load_canonical_councilor_data(conn: sqlite3.Connection):
    """Load historical candidate results for 2014, 2018, 2022 from canonical SQLite."""
    cur = conn.cursor()
    # 1. Map election_id to year and office_kind
    cur.execute('''
        SELECT election_id, election_year, election_name
        FROM dim_election
        WHERE office = '議員' AND election_kind = 'general' AND election_year IN (2014, 2018, 2022)
    ''')
    election_info = {}
    for eid, year, name in cur.fetchall():
        office_kind = OFFICE_KIND_MAP.get(name)
        if office_kind:
            election_info[eid] = {'year': year, 'office_kind': office_kind}

    # 2. Extract results: (county_name, office_kind, district_no, year) -> candidate list & townships
    districts = {}

    for eid, einfo in election_info.items():
        year = einfo['year']
        office_kind = einfo['office_kind']

        # Get candidate results
        cur.execute('''
            SELECT county_name, electoral_district_name, candidate_name, party_name, elected_note, SUM(votes) as total_votes
            FROM fact_candidate_result
            WHERE election_id = ?
            GROUP BY county_name, electoral_district_name, candidate_id
        ''', (eid,))

        for county, dname, cname, party, note, votes in cur.fetchall():
            if not county or not dname:
                continue
            dno = parse_district_no(dname)
            key = (county, office_kind, dno)
            if key not in districts:
                districts[key] = {
                    'county': county,
                    'office_kind': office_kind,
                    'district_no': dno,
                    'data_by_year': {}
                }
            yd = districts[key]['data_by_year'].setdefault(year, {
                'candidates': [],
                'townships': set()
            })
            yd['candidates'].append({
                'name': cname,
                'party': party,
                'note': note or '',
                'votes': int(votes) if votes is not None else 0
            })

        # Get townships covered
        cur.execute('''
            SELECT DISTINCT county_name, electoral_district_name, township_name
            FROM fact_candidate_result
            WHERE election_id = ? AND township_name IS NOT NULL AND township_name != ''
        ''', (eid,))
        for county, dname, town in cur.fetchall():
            dno = parse_district_no(dname)
            key = (county, office_kind, dno)
            if key in districts and year in districts[key]['data_by_year']:
                districts[key]['data_by_year'][year]['townships'].add(town)

    return districts


def build_all_council_metrics(
    canonical_db_path: Path,
    observation_manifest_path: Path,
    scopes_path: Path
) -> dict:
    """Build council-metrics-v1 structure."""
    canonical_sha = hashlib.sha256(canonical_db_path.read_bytes()).hexdigest()
    obs_manifest_bytes = observation_manifest_path.read_bytes()
    obs_manifest_sha = hashlib.sha256(obs_manifest_bytes).hexdigest()
    obs_manifest = json.loads(obs_manifest_bytes.decode('utf-8'))

    # Load 2026 councilor scopes (seats)
    scopes_data = json.loads(scopes_path.read_text(encoding='utf-8'))
    seats_2026_lookup = {}
    for entry in scopes_data.get('entries', []):
        c = entry['county']
        raw_name = entry['name']
        dno = parse_district_no(raw_name)
        # determine scope
        stext = entry.get('scope_text', '')
        if '平地原住民' in stext:
            okind = 'plain_indigenous'
        elif '山地原住民' in stext:
            okind = 'mountain_indigenous'
        else:
            okind = 'regional'
        seats_2026_lookup[(c, okind, dno)] = entry.get('seats', 0)

    # Connect to canonical SQLite
    conn = sqlite3.connect(f'file:{canonical_db_path}?mode=ro', uri=True)
    historical_data = load_canonical_councilor_data(conn)
    conn.close()

    # 2026 locations and candidates
    locations_2026 = obs_manifest.get('councilor_locations', [])
    loc_by_key = {}
    for loc in locations_2026:
        c = loc['county']
        okind = SCOPE_TO_OFFICE_KIND.get(loc['scope'], 'regional')
        dno = parse_district_no(loc.get('scope_text', ''))
        # If scope_text doesn't have district number (e.g. indigenous), find from district_id in shards
        loc_by_key[(c, okind, loc['district_id'])] = loc

    # We also need to map 2026 districts from observation county shards
    obs_dir = observation_manifest_path.parent
    cands_2026_by_key = {}
    for county_info in obs_manifest.get('counties', []):
        shard_path = obs_dir / Path(county_info['file']).name
        if not shard_path.exists():
            continue
        shard_data = json.loads(shard_path.read_text(encoding='utf-8'))
        for d in shard_data.get('districts', []):
            if d['office'] in ('metro_councilor', 'county_councilor'):
                c, okind, dno = roster_district_key(d, {loc['district_id']: loc for loc in locations_2026})
                if (c, okind, dno) in cands_2026_by_key:
                    raise ValueError(f"Duplicate council district: {(c, okind, dno)}")
                cands_2026_by_key[(c, okind, dno)] = {
                    'district_id': d['id'],
                    'cands_count': len(d.get('candidates', [])),
                    'candidates': d.get('candidates', [])
                }

    # Now assemble all 2026 districts
    districts_result = []

    # All unique keys across 2026
    all_keys = sorted(set(list(cands_2026_by_key.keys()) + list(seats_2026_lookup.keys())), key=lambda k: (k[0], k[1], k[2]))

    for c, okind, dno in all_keys:
        hist_entry = historical_data.get((c, okind, dno), {}).get('data_by_year', {})
        cand_2026_info = cands_2026_by_key.get((c, okind, dno), {})
        d_id = cand_2026_info.get('district_id', f'd-{c}-{okind}-{dno}')
        cands_2026_count = cand_2026_info.get('cands_count')
        seats_2026 = seats_2026_lookup.get((c, okind, dno), 0)

        # Find matching location
        loc = None
        for (lc, lokind, ldid), lval in loc_by_key.items():
            if lc == c and lokind == okind and ldid == d_id:
                loc = lval
                break

        townships_2026 = loc.get('townships', []) if loc else []
        partial_townships = loc.get('partial_townships', []) if loc else []

        # Seats across cycles
        seats_by_year = {}
        margin_by_year = {}
        seats_by_party_by_year = {}
        townships_by_year = {}

        for y in (2014, 2018, 2022):
            if y in hist_entry:
                y_cands = hist_entry[y]['candidates']
                y_towns = sorted(hist_entry[y]['townships'])
                y_valid = sum(cand['votes'] for cand in y_cands)
                y_seats = sum(1 for cand in y_cands if cand.get('note') in ('*', '!'))
                seats_by_year[str(y)] = y_seats
                margin_by_year[str(y)] = last_seat_margin(y_cands, y_valid)
                townships_by_year[y] = y_towns

                # Party seats
                party_counts = {}
                for cand in y_cands:
                    if cand.get('note') in ('*', '!'):
                        p = normalize_party(cand.get('party'))
                        party_counts[p] = party_counts.get(p, 0) + 1
                seats_by_party_by_year[y] = party_counts

        seats_by_year['2026'] = seats_2026

        # Comparability
        comparability = {}
        # 2014 -> 2018
        if 2014 in townships_by_year and 2018 in townships_by_year:
            comparability['2014_2018'] = assess_comparability(
                townships_by_year[2014], seats_by_year.get('2014', 0),
                townships_by_year[2018], seats_by_year.get('2018', 0)
            )
        else:
            comparability['2014_2018'] = 'na'

        # 2018 -> 2022
        if 2018 in townships_by_year and 2022 in townships_by_year:
            comparability['2018_2022'] = assess_comparability(
                townships_by_year[2018], seats_by_year.get('2018', 0),
                townships_by_year[2022], seats_by_year.get('2022', 0)
            )
        else:
            comparability['2018_2022'] = 'na'

        # 2022 -> 2026
        if 2022 in townships_by_year:
            comparability['2022_2026'] = assess_comparability(
                townships_by_year[2022], seats_by_year.get('2022', 0),
                townships_2026, seats_2026,
                partial_townships=partial_townships
            )
        else:
            comparability['2022_2026'] = 'na'

        # Seat swing
        active_seats = [v for k, v in seats_by_year.items() if k in ('2014', '2018', '2022') and v > 0]
        avg_seats = sum(active_seats) / len(active_seats) if active_seats else (seats_2026 or 1)
        seat_swing = seat_swing_metrics(seats_by_party_by_year, avg_seats)
        if any(comparability[k] not in ("comparable", "seats_changed") for k in ("2014_2018", "2018_2022")):
            seat_swing = {"total": None, "rate": None, "band": "na"}

        # Competition intensity
        is_comp = comparability.get('2022_2026') in ('comparable', 'seats_changed')
        cands_2022_cnt = len(hist_entry[2022]['candidates']) if 2022 in hist_entry else None
        seats_2022_cnt = seats_by_year.get('2022')
        competition = competition_intensity(
            cands_2026_count, seats_2026,
            cands_2022_cnt, seats_2022_cnt,
            comparable=is_comp
        )

        districts_result.append({
            'key': f'{c}|{okind}|{dno}',
            'county': c,
            'office_kind': okind,
            'district_no': dno,
            'townships_2026': townships_2026,
            'partial_townships': partial_townships,
            'seats': seats_by_year,
            'comparability': comparability,
            'margin': margin_by_year,
            'seats_by_party': {str(k): v for k, v in seats_by_party_by_year.items()},
            'seat_swing': seat_swing,
            'competition': competition,
            'cands_2026': cands_2026_count,
            'map_district_id': d_id
        })

    result = {
        'schema': 'council-metrics-v1',
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'inputs': {
            'canonical_sha256': canonical_sha,
            'observation_manifest_sha256': obs_manifest_sha,
            'seats_source': 'cec-63626'
        },
        'bands': {
            'margin_pct': COUNCIL_MARGIN_BANDS,
            'swing_rate': SWING_RATE_BANDS,
            'delta_flat': DELTA_FLAT_THRESHOLD
        },
        'districts': districts_result
    }
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--canonical-db', type=Path, default=DEFAULT_CANONICAL_PATH)
    p.add_argument('--observation-manifest', type=Path, default=DEFAULT_OBSERVATION_MANIFEST)
    p.add_argument('--scopes', type=Path, default=DEFAULT_SCOPES_PATH)
    p.add_argument('--output', type=Path, default=DEFAULT_OUTPUT_PATH)
    args = p.parse_args()

    data = build_all_council_metrics(args.canonical_db, args.observation_manifest, args.scopes)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'Built council metrics: {len(data["districts"])} districts -> {args.output}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
