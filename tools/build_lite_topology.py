#!/usr/bin/env python3
"""Build lightweight county and town TopoJSON from village.topo.json.

Dissolves village polygons to:
- data/geo/county.topo.json (< 1 MB, 22 counties)
- data/geo/town.topo.json (< 1 MB, 368 townships)
"""
from __future__ import annotations
import argparse
from collections import defaultdict
import json
import math
from pathlib import Path
import sys

DEFAULT_INPUT_TOPOLOGY = Path(__file__).resolve().parents[1] / 'data/village.topo.json'
DEFAULT_GEO_DIR = Path(__file__).resolve().parents[1] / 'data/geo'


def dist(p1, p2):
    return math.hypot(p1[0] - p2[0], p1[1] - p2[1])


def dissolve_geometries(group_geoms: list[dict], all_arcs: list[list[list[float]]]) -> list[list[int]]:
    """Extract exterior arcs for a group of geometries and chain them into closed rings."""
    def get_endpoints(a):
        s = all_arcs[a][0] if a >= 0 else all_arcs[~a][-1]
        e = all_arcs[a][-1] if a >= 0 else all_arcs[~a][0]
        return s, e

    directed_arcs = []
    for g in group_geoms:
        if g['type'] == 'Polygon':
            for ring in g['arcs']:
                directed_arcs.extend(ring)
        elif g['type'] == 'MultiPolygon':
            for poly in g['arcs']:
                for ring in poly:
                    directed_arcs.extend(ring)

    arc_counts = defaultdict(int)
    for a in directed_arcs:
        arc_counts[a if a >= 0 else ~a] += 1

    # Exterior arcs appear once
    exterior = [a for a in directed_arcs if arc_counts[a if a >= 0 else ~a] == 1]
    unused = set(exterior)
    rings = []

    while unused:
        first = next(iter(unused))
        unused.remove(first)
        ring = [first]
        start_pt, curr_end = get_endpoints(first)

        while dist(curr_end, start_pt) > 1e-4:
            best_cand, best_d = None, 1e-4
            for cand in unused:
                cs, ce = get_endpoints(cand)
                d = dist(curr_end, cs)
                if d < best_d:
                    best_d = d
                    best_cand = cand
            if best_cand is None:
                break
            unused.remove(best_cand)
            ring.append(best_cand)
            _, curr_end = get_endpoints(best_cand)

        rings.append(ring)

    return rings


def ramer_douglas_peucker(points: list[list[float]], epsilon: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    dmax = 0.0
    index = 0
    end = len(points) - 1
    p1 = points[0]
    p2 = points[end]
    dx = p2[0] - p1[0]
    dy = p2[1] - p1[1]
    norm = math.hypot(dx, dy)
    for i in range(1, end):
        p = points[i]
        if norm == 0:
            d = math.hypot(p[0] - p1[0], p[1] - p1[1])
        else:
            d = abs(dy * p[0] - dx * p[1] + p2[0] * p1[1] - p2[1] * p1[0]) / norm
        if d > dmax:
            index = i
            dmax = d
    if dmax > epsilon:
        rec1 = ramer_douglas_peucker(points[:index + 1], epsilon)
        rec2 = ramer_douglas_peucker(points[index:], epsilon)
        return rec1[:-1] + rec2
    else:
        return [points[0], points[end]]


def simplify_and_pack_topojson(
    object_name: str,
    geometries: list[dict],
    raw_arcs: list[list[list[float]]],
    bbox: list[float],
    precision: int = 4,
    epsilon: float = 0.0008
) -> dict:
    """Pack dissolved geometries and only referenced arcs into a clean TopoJSON."""
    # Find all unique raw arc indices used
    used_raw_indices = set()
    for g in geometries:
        for poly in g['arcs']:
            for ring in poly:
                for a in ring:
                    used_raw_indices.add(a if a >= 0 else ~a)

    sorted_old = sorted(used_raw_indices)
    old_to_new = {old: new for new, old in enumerate(sorted_old)}

    # Simplify arcs with Ramer-Douglas-Peucker
    new_arcs = []
    for old in sorted_old:
        arc = raw_arcs[old]
        simplified = ramer_douglas_peucker(arc, epsilon) if epsilon > 0 else arc
        cleaned = []
        for p in simplified:
            pt = [round(p[0], precision), round(p[1], precision)]
            if not cleaned or cleaned[-1] != pt:
                cleaned.append(pt)
        if len(cleaned) < 2:
            cleaned = [[round(p[0], precision), round(p[1], precision)] for p in arc[:2]]
        new_arcs.append(cleaned)

    # Remap geometry arc indices
    remapped_geoms = []
    for g in geometries:
        remapped_polys = []
        for poly in g['arcs']:
            remapped_rings = []
            for ring in poly:
                remapped_ring = [
                    old_to_new[a] if a >= 0 else ~old_to_new[~a]
                    for a in ring
                ]
                remapped_rings.append(remapped_ring)
            remapped_polys.append(remapped_rings)

        remapped_geoms.append({
            'type': 'MultiPolygon',
            'properties': g['properties'],
            'arcs': remapped_polys
        })

    return {
        'type': 'Topology',
        'bbox': bbox,
        'objects': {
            object_name: {
                'type': 'GeometryCollection',
                'geometries': remapped_geoms
            }
        },
        'arcs': new_arcs
    }


def build_county_topology(village_topo: dict) -> dict:
    raw_arcs = village_topo['arcs']
    geoms = village_topo['objects']['village']['geometries']

    county_groups = defaultdict(list)
    county_props = {}
    for g in geoms:
        p = g['properties']
        c = p['COUNTYNAME']
        county_groups[c].append(g)
        if c not in county_props:
            county_props[c] = {
                'COUNTYNAME': c,
                'COUNTYID': p.get('COUNTYID'),
                'COUNTYCODE': p.get('COUNTYCODE')
            }

    geometries = []
    for c in sorted(county_groups.keys()):
        rings = dissolve_geometries(county_groups[c], raw_arcs)
        polys = [[ring] for ring in rings]
        geometries.append({
            'properties': county_props[c],
            'arcs': polys
        })

    return simplify_and_pack_topojson('county', geometries, raw_arcs, village_topo.get('bbox', []), precision=4, epsilon=0.001)


def build_town_topology(village_topo: dict) -> dict:
    raw_arcs = village_topo['arcs']
    geoms = village_topo['objects']['village']['geometries']

    town_groups = defaultdict(list)
    town_props = {}
    for g in geoms:
        p = g['properties']
        key = (p['COUNTYNAME'], p['TOWNNAME'])
        town_groups[key].append(g)
        if key not in town_props:
            town_props[key] = {
                'COUNTYNAME': p['COUNTYNAME'],
                'COUNTYID': p.get('COUNTYID'),
                'COUNTYCODE': p.get('COUNTYCODE'),
                'TOWNNAME': p['TOWNNAME'],
                'TOWNID': p.get('TOWNID'),
                'TOWNCODE': p.get('TOWNCODE')
            }

    geometries = []
    for key in sorted(town_groups.keys()):
        rings = dissolve_geometries(town_groups[key], raw_arcs)
        polys = [[ring] for ring in rings]
        geometries.append({
            'properties': town_props[key],
            'arcs': polys
        })

    return simplify_and_pack_topojson('town', geometries, raw_arcs, village_topo.get('bbox', []), precision=4, epsilon=0.0006)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--input', type=Path, default=DEFAULT_INPUT_TOPOLOGY)
    p.add_argument('--geo-dir', type=Path, default=DEFAULT_GEO_DIR)
    args = p.parse_args()

    print(f'Reading input topology from {args.input}...')
    with args.input.open('r', encoding='utf-8') as f:
        village_topo = json.load(f)

    args.geo_dir.mkdir(parents=True, exist_ok=True)

    print('Building county topology...')
    county_topo = build_county_topology(village_topo)
    county_file = args.geo_dir / 'county.topo.json'
    with county_file.open('w', encoding='utf-8') as f:
        json.dump(county_topo, f, ensure_ascii=False, separators=(',', ':'))

    print(f'County topology written: {county_file} ({county_file.stat().st_size / 1024:.1f} KB, {len(county_topo["objects"]["county"]["geometries"])} counties)')

    print('Building town topology...')
    town_topo = build_town_topology(village_topo)
    town_file = args.geo_dir / 'town.topo.json'
    with town_file.open('w', encoding='utf-8') as f:
        json.dump(town_topo, f, ensure_ascii=False, separators=(',', ':'))

    print(f'Town topology written: {town_file} ({town_file.stat().st_size / 1024:.1f} KB, {len(town_topo["objects"]["town"]["geometries"])} towns)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
