#!/usr/bin/env python3
"""Tests for council metrics calculation according to implementation_plan.md Section 2 & 7."""
import unittest
import sqlite3
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.build_council_metrics import (
    last_seat_margin,
    seat_shift,
    seat_swing_metrics,
    assess_comparability,
    competition_intensity,
    normalize_party,
    COUNCIL_MARGIN_BANDS,
    SWING_RATE_BANDS,
    DELTA_FLAT_THRESHOLD, roster_district_key
)

CANONICAL_DB_PATH = Path(__file__).resolve().parents[2] / 'TW_vote_2026/releases/Election-Machine-2026-v38/data/canonical/election_history-v31.sqlite'

class TestCouncilMetricsSynthetic(unittest.TestCase):
    def test_roster_scope_uses_official_location(self):
        district = {'id': 'id7', 'county': '南投縣', 'name': '南投縣第7選舉區'}
        locations = {'id7': {'scope': 'mountain_indigenous'}}
        self.assertEqual(roster_district_key(district, locations), ('南投縣', 'mountain_indigenous', '07'))
        with self.assertRaises(ValueError):
            roster_district_key(district, {})

    def test_synthetic_margin_normal(self):
        # 3 seats, 5 candidates
        cands = [
            {'name': 'A', 'votes': 10000, 'note': '*', 'party': '民進黨'},
            {'name': 'B', 'votes': 8000, 'note': '*', 'party': '國民黨'},
            {'name': 'C', 'votes': 6000, 'note': '*', 'party': '民眾黨'},
            {'name': 'D', 'votes': 5500, 'note': '', 'party': '時代力量'},
            {'name': 'E', 'votes': 2000, 'note': '', 'party': '無黨籍'},
        ]
        valid_votes = sum(c['votes'] for c in cands)  # 31500
        res = last_seat_margin(cands, valid_votes)
        self.assertFalse(res['uncontested'])
        self.assertFalse(res['women_quota_applied'])
        self.assertEqual(res['last_win'], 'C')
        self.assertEqual(res['first_lose'], 'D')
        self.assertEqual(res['votes'], 500)
        self.assertAlmostEqual(res['pct'], round(500 / 31500 * 100, 2))

    def test_synthetic_margin_uncontested(self):
        # 3 seats, 3 candidates (uncontested)
        cands = [
            {'name': 'A', 'votes': 10000, 'note': '*', 'party': '民進黨'},
            {'name': 'B', 'votes': 8000, 'note': '*', 'party': '國民黨'},
            {'name': 'C', 'votes': 6000, 'note': '*', 'party': '無黨籍'},
        ]
        res = last_seat_margin(cands, 24000)
        self.assertTrue(res['uncontested'])
        self.assertIsNone(res['votes'])
        self.assertIsNone(res['pct'])

    def test_synthetic_margin_women_quota(self):
        # Women quota applied: D was bumped down by women quota, W elected by quota
        # Seats: 3. Regular elected: A, B. Women quota elected: W.
        # Losers: D (higher votes than W!), E.
        cands = [
            {'name': 'A', 'votes': 10000, 'note': '*', 'party': '民進黨'},
            {'name': 'B', 'votes': 8000, 'note': '*', 'party': '國民黨'},
            {'name': 'D', 'votes': 7500, 'note': '-', 'party': '無黨籍'},  # bumped loser
            {'name': 'W', 'votes': 6000, 'note': '!', 'party': '國民黨'},  # quota winner
            {'name': 'E', 'votes': 3000, 'note': '', 'party': '時代力量'},
        ]
        valid_votes = sum(c['votes'] for c in cands)
        res = last_seat_margin(cands, valid_votes)
        self.assertFalse(res['uncontested'])
        self.assertTrue(res['women_quota_applied'])
        # last_win should be min of regular (*) -> B (8000), NOT W (6000)
        self.assertEqual(res['last_win'], 'B')
        # first_lose should be max of losers ({'', '-'}) -> D (7500)
        self.assertEqual(res['first_lose'], 'D')
        self.assertEqual(res['votes'], 8000 - 7500)  # 500
        self.assertAlmostEqual(res['pct'], round(500 / valid_votes * 100, 2))

    def test_seat_shift_and_swing(self):
        # 2014: DPP: 2, KMT: 3 -> 2018: DPP: 1, KMT: 4
        # shift = (|1-2| + |4-3|) / 2 = 1.0
        s2014 = {'民進黨': 2, '國民黨': 3}
        s2018 = {'民進黨': 1, '國民黨': 4}
        shift = seat_shift(s2014, s2018)
        self.assertEqual(shift, 1.0)

        # 3 election cycle swing
        s2022 = {'民進黨': 2, '國民黨': 2, '民眾黨': 1}
        # 2018->2022: DPP: |2-1|=1, KMT: |2-4|=2, TPP: |1-0|=1 -> sum=4 / 2 = 2.0
        shift2 = seat_shift(s2018, s2022)
        self.assertEqual(shift2, 2.0)

        metrics = seat_swing_metrics({2014: s2014, 2018: s2018, 2022: s2022}, avg_seats=5.0)
        self.assertEqual(metrics['total'], 3.0)
        self.assertAlmostEqual(metrics['rate'], 3.0 / 5.0, places=3)
        self.assertEqual(metrics['band'], 'large')  # >= 0.5 is large

    def test_incomplete_swing_is_unavailable(self):
        self.assertIsNone(seat_swing_metrics({2022: {"國民黨": 2}}, 2)["rate"])

    def test_comparability(self):
        # Same townships, same seats -> comparable
        c1 = assess_comparability(['北投區', '士林區'], 12, ['北投區', '士林區'], 12)
        self.assertEqual(c1, 'comparable')

        # Same townships, different seats -> seats_changed
        c2 = assess_comparability(['北投區', '士林區'], 13, ['北投區', '士林區'], 12)
        self.assertEqual(c2, 'seats_changed')

        # Different townships -> redistricted
        c3 = assess_comparability(['大安區'], 8, ['文山區'], 8)
        self.assertEqual(c3, 'redistricted')

        # Partial townships -> redistricted
        c4 = assess_comparability(['竹北市'], 10, ['竹北市'], 10, partial_townships=['竹北市'])
        self.assertEqual(c4, 'redistricted')

    def test_competition_intensity(self):
        # ratio_2026 = 12 / 5 = 2.4, ratio_2022 = 9 / 5 = 1.8 -> delta = 0.6 -> trend = 'up'
        ci1 = competition_intensity(cands_2026=12, seats_2026=5, cands_2022=9, seats_2022=5)
        self.assertAlmostEqual(ci1['ratio_2026'], 2.4)
        self.assertAlmostEqual(ci1['ratio_2022'], 1.8)
        self.assertAlmostEqual(ci1['delta'], 0.6)
        self.assertEqual(ci1['trend'], 'up')

        # flat when |delta| < 0.1
        ci2 = competition_intensity(cands_2026=10, seats_2026=5, cands_2022=10, seats_2022=5)
        self.assertEqual(ci2['trend'], 'flat')


class TestPublishedCouncilData(unittest.TestCase):
    def test_roster_ids_counts_and_competition_match_sources(self):
        root = Path(__file__).resolve().parents[1]
        manifest = json.loads((root / 'data/observation/manifest.json').read_text())
        locations = {loc['district_id']: loc for loc in manifest['councilor_locations']}
        expected = {}
        for county in manifest['counties']:
            shard = json.loads((root / 'data' / county['file']).read_text())
            for district in shard['districts']:
                if district['office'] in ('metro_councilor', 'county_councilor'):
                    key = roster_district_key(district, locations)
                    self.assertNotIn(key, expected)
                    expected[key] = district
        metrics = json.loads((root / 'data/observation/council-metrics.json').read_text())['districts']
        self.assertEqual(len(metrics), len(expected))
        for metric in metrics:
            key = (metric['county'], metric['office_kind'], metric['district_no'])
            district = expected[key]
            self.assertEqual(metric['map_district_id'], district['id'])
            self.assertEqual(metric['cands_2026'], len(district['candidates']))
            seats = metric['seats']['2026']
            self.assertEqual(metric['competition']['ratio_2026'], round(len(district['candidates']) / seats, 2) if seats else None)


class TestCouncilMetricsRealData(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not CANONICAL_DB_PATH.exists():
            raise unittest.SkipTest('Canonical SQLite database not found')
        cls.conn = sqlite3.connect(f'file:{CANONICAL_DB_PATH}?mode=ro', uri=True)

    @classmethod
    def tearDownClass(cls):
        cls.conn.close()

    def test_real_data_seats_totals(self):
        # 2022 total seats = 910
        cur = self.conn.cursor()
        cur.execute('''
            SELECT e.election_year, COUNT(*)
            FROM dim_candidate c
            JOIN dim_election e ON c.election_id = e.election_id
            WHERE e.office = '議員' AND e.election_kind = 'general' AND c.elected_note IN ('*', '!')
            GROUP BY e.election_year
            ORDER BY e.election_year
        ''')
        rows = dict(cur.fetchall())
        self.assertEqual(rows.get(2014), 907)
        self.assertEqual(rows.get(2018), 912)
        self.assertEqual(rows.get(2022), 910)

    def test_sample_district_tainan_01(self):
        # 臺南市第01選區 2022: 婦保選區
        # 蔡育輝(*) 18304, 趙昆原(*) 12730, 王宣貿(*) 12660, 張世賢(*) 12650, 李宗翰(*) 11597
        # 劉米山() 9446, 沈家鳳(!) 9055, 姚正玉() 5986, 廖志峯() 835
        cur = self.conn.cursor()
        cur.execute('''
            SELECT candidate_name, party_name, elected_note, SUM(votes) as votes
            FROM fact_candidate_result
            WHERE election_year = 2022 AND county_name = '臺南市' AND electoral_district_name = '第01選舉區'
            GROUP BY candidate_id
            ORDER BY votes DESC
        ''')
        cands = [{'name': r[0], 'party': r[1], 'note': r[2], 'votes': int(r[3])} for r in cur.fetchall()]
        valid_votes = sum(c['votes'] for c in cands)
        margin = last_seat_margin(cands, valid_votes)
        self.assertEqual(margin['last_win'], '李宗翰')
        self.assertEqual(margin['first_lose'], '劉米山')
        self.assertEqual(margin['votes'], 11597 - 9446)  # 2151
        self.assertAlmostEqual(margin['pct'], round(2151 / valid_votes * 100, 2))
        self.assertTrue(margin['women_quota_applied'])

    def test_sample_district_taipei_02(self):
        # 臺北市第02選區 (內湖區、南港區) 2022
        cur = self.conn.cursor()
        cur.execute('''
            SELECT candidate_name, party_name, elected_note, SUM(votes) as votes
            FROM fact_candidate_result
            WHERE election_year = 2022 AND county_name = '臺北市' AND electoral_district_name = '第02選舉區'
            GROUP BY candidate_id
            ORDER BY votes DESC
        ''')
        cands = [{'name': r[0], 'party': r[1], 'note': r[2], 'votes': int(r[3])} for r in cur.fetchall()]
        valid_votes = sum(c['votes'] for c in cands)
        margin = last_seat_margin(cands, valid_votes)
        # 應選 9 席
        elected = [c for c in cands if c['note'] in ('*', '!')]
        self.assertEqual(len(elected), 9)
        self.assertFalse(margin['women_quota_applied'])
        self.assertIsNotNone(margin['votes'])
        self.assertGreater(margin['votes'], 0)

    def test_sample_district_taichung_03(self):
        # 臺中市第03選區 (烏日區、大肚區、龍井區)
        cur = self.conn.cursor()
        cur.execute('''
            SELECT candidate_name, party_name, elected_note, SUM(votes) as votes
            FROM fact_candidate_result
            WHERE election_year = 2022 AND county_name = '臺中市' AND electoral_district_name = '第03選舉區'
            GROUP BY candidate_id
            ORDER BY votes DESC
        ''')
        cands = [{'name': r[0], 'party': r[1], 'note': r[2], 'votes': int(r[3])} for r in cur.fetchall()]
        valid_votes = sum(c['votes'] for c in cands)
        margin = last_seat_margin(cands, valid_votes)
        self.assertIsNotNone(margin['votes'])
        self.assertGreater(margin['votes'], 0)


if __name__ == '__main__':
    unittest.main()
