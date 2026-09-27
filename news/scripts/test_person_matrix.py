#!/usr/bin/env python3
"""The outlet × person grid (news-person-sentiment-v1 §7.1).

⚠️ The assertions are the refusals: no mean under five units, a deviation
colour only when its interval excludes zero, no tone total anywhere, order by
coverage, sparse lines pruned and the omission counted, a period offered only
when dense enough, and under-covered days kept out."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import person_matrix as pm  # noqa: E402

UN, NE, FA = 1, 2, 3


def unit(domain, value, day="2026-09-20", bucket=None):
    b = bucket or ("unfavorable" if value <= -0.5 else
                   "favorable" if value >= 0.5 else "neutral")
    return {"domain": domain, "value": value, "bucket": b,
            "published": f"{day}T10:00:00+00:00", "role": "primary"}


def entry(units):
    return {"units": {"story": units}}


COVERED = {f"2026-09-{d:02d}": [95, 100] for d in range(1, 30)}


class Cells(unittest.TestCase):
    def test_no_mean_under_five_units(self):
        c = pm.cell([unit("a.bg", -1)] * 4, [])
        self.assertEqual(c["n"], 4)
        self.assertNotIn("mean", c)
        self.assertEqual(c["counts"]["unfavorable"], 4)

    def test_a_clear_gap_is_coloured(self):
        here = [unit("a.bg", v) for v in (-1.2, -1.1, -1.0, -1.3, -1.1)]
        rest = [unit("b.bg", v) for v in (0.2, 0.1, 0.3, 0.0, 0.2)]
        c = pm.cell(here, rest)
        self.assertLess(c["dev"], 0)
        self.assertEqual(c["dev_sign"], -1)

    def test_a_gap_whose_interval_straddles_zero_is_grey(self):
        # Mutation check: the same mean gap, made noisy, must lose its colour.
        here = [unit("a.bg", v) for v in (-1.9, 1.5, -1.8, 1.4, -1.0)]
        rest = [unit("b.bg", v) for v in (1.9, -1.5, 1.8, -1.4, 0.8)]
        c = pm.cell(here, rest)
        self.assertEqual(c["dev_sign"], 0)

    def test_no_gap_without_enough_other_units(self):
        c = pm.cell([unit("a.bg", -1.0 + i / 10) for i in range(5)],
                    [unit("b.bg", 0)])
        self.assertIn("mean", c)
        self.assertNotIn("dev", c)


class Prune(unittest.TestCase):
    def test_sparse_lines_are_dropped_until_stable(self):
        cells = {"p1": {c: {"n": 5} for c in "abcd"},
                 "p2": {c: {"n": 5} for c in "abcd"},
                 "p3": {"a": {"n": 5}}}
        rows, cols = pm.prune(["p1", "p2", "p3"], list("abcde"), cells)
        self.assertEqual(rows, [])  # p1/p2 have 4 each, but columns have 2
        cells.update({f"q{i}": {c: {"n": 5} for c in "abcd"} for i in range(3)})
        rows, cols = pm.prune(["p1", "p2", "p3", "q0", "q1", "q2"],
                              list("abcde"), cells)
        self.assertEqual(rows, ["p1", "p2", "q0", "q1", "q2"])
        self.assertEqual(cols, list("abcd"))


class CapInsideTheLoop(unittest.TestCase):
    def test_no_line_ships_under_its_floor_after_the_cap(self):
        # 30 rows filled only in columns a–d; one column e filled only by
        # the rows the row cap removes — after the cap it must go too.
        cells = {f"r{i:02d}": {c: {"n": 5} for c in "abcd"} for i in range(30)}
        for i in range(25, 30):
            cells[f"r{i:02d}"]["e"] = {"n": 5}
        rows, cols = pm.prune(sorted(cells), list("abcde"), cells)
        self.assertEqual(len(rows), 25)
        self.assertEqual(cols, list("abcd"))
        for c in cols:
            self.assertGreaterEqual(sum(pm.filled(cells, r, c) for r in rows),
                                    pm.MIN_FILLED_PER_LINE)


class Build(unittest.TestCase):
    def people(self, n_people=10, outlets="abcdef", per=6, value=-0.8):
        return {f"p{i:02d}": entry([unit(f"{o}.bg", value) for o in outlets
                                    for _ in range(per)])
                for i in range(n_people)}

    def test_a_dense_grid_is_offered_and_ordered_by_coverage(self):
        people = self.people()
        people["p09"]["units"]["story"] += [unit("a.bg", 1.5)] * 3
        out = pm.build(people, {}, COVERED, "2026-09-27T00:00:00+00:00")
        grid = out["periods"]["all"]
        self.assertTrue(grid["offered"])
        self.assertEqual(grid["rows"][0]["id"], "p09")  # most units first
        self.assertEqual(grid["cols"][0]["domain"], "a.bg")

    def test_candidates_are_a_threshold_not_a_top_n(self):
        # §7.1 rule 1: ≥ 30 units in the period — a person under it never
        # enters, however few people qualify.
        people = self.people()
        people["thin"] = entry([unit(f"{o}.bg", -0.8) for o in "abcdef"
                                for _ in range(4)])  # 24 units
        out = pm.build(people, {}, COVERED, "2026-09-27T00:00:00+00:00")
        self.assertNotIn("thin", [r["id"] for r in out["periods"]["all"]["rows"]])

    def test_too_few_rows_is_not_offered(self):
        out = pm.build(self.people(n_people=5), {}, COVERED,
                       "2026-09-27T00:00:00+00:00")
        self.assertFalse(out["periods"]["all"]["offered"])

    def test_no_tone_total_anywhere(self):
        out = pm.build(self.people(), {}, COVERED, "2026-09-27T00:00:00+00:00")
        grid = out["periods"]["all"]
        for line in grid["rows"] + grid["cols"]:
            self.assertEqual(set(line) - {"id", "name_bg", "name_en", "domain", "n"},
                             set())
        self.assertNotIn("mean", json.dumps(grid["rows"]))
        self.assertNotIn("mean", json.dumps(grid["cols"]))

    def test_under_covered_days_stay_out(self):
        coverage = {**COVERED, "2026-09-20": [5, 100]}
        out = pm.build(self.people(), {}, coverage, "2026-09-27T00:00:00+00:00")
        self.assertEqual(out["periods"]["all"]["rows"], [])

    def test_a_period_counts_only_its_own_days(self):
        people = self.people()
        out = pm.build(people, {}, COVERED, "2026-12-31T00:00:00+00:00")
        self.assertEqual(out["periods"]["30"]["rows"], [])
        self.assertTrue(out["periods"]["all"]["offered"])

    def test_the_omission_is_counted(self):
        people = self.people()
        people["lonely"] = entry([unit("z.bg", 0)])
        out = pm.build(people, {}, COVERED, "2026-09-27T00:00:00+00:00")
        self.assertGreaterEqual(out["periods"]["all"]["omitted"]["people"], 1)
        self.assertGreaterEqual(out["periods"]["all"]["omitted"]["outlets"], 1)


if __name__ == "__main__":
    unittest.main()
