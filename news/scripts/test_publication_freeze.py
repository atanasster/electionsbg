#!/usr/bin/env python3
"""The election freeze (news-person-sentiment-v1 §8.2).

The assertions are the plan's list: inside a window the aggregates are the
snapshot's bytes, a missing snapshot withholds rather than publishing fresh
numbers, the first build after `until` drops the stamp, the article rail
still updates, the warnings fire, and the windows are cut in Europe/Sofia.
"""
import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import publication_freeze as pf  # noqa: E402

FROM, UNTIL = pf.sofia_day_before("2026-11-08")


def freeze(**over):
    row = {"id": "pvr2026-r1", "from": FROM, "until": UNTIL, "status": "decreed"}
    row.update(over)
    return row


def load(rows):
    path = Path(tempfile.mkdtemp()) / "f.json"
    path.write_text(json.dumps({"freezes": rows}), encoding="utf-8")
    return pf.load_freezes(path)


def at(iso):
    return datetime.fromisoformat(iso)


class Build:
    """A fake app-data tree: the aggregates and one article bundle."""

    def __init__(self):
        self.out = Path(tempfile.mkdtemp())
        self.root = Path(tempfile.mkdtemp())

    def write(self, n, article_tone="neutral"):
        (self.out / "person").mkdir(exist_ok=True)
        pf._write(self.out / "persons.json",
                  {"generated_at": f"g{n}", "persons": [{"id": "mp-1", "n": n}]})
        pf._write(self.out / "person_baselines.json", {"persons": {"mp-1": {"n": n}}})
        pf._write(self.out / "person" / "mp-1.json", {"id": "mp-1", "n": n})
        pf._write(self.out / "article.json", {"tone": article_tone})

    def run(self, n, now, freezes, tone="neutral"):
        self.write(n, tone)
        return pf.apply(self.out, now, freezes, self.root)

    def bytes(self):
        return {p.relative_to(self.out).as_posix(): p.read_bytes()
                for p in sorted(self.out.rglob("*.json"))}


class Windows(unittest.TestCase):
    def test_the_cut_is_sofia_time(self):
        # 00:00 Sofia on 7 Nov is 22:00 UTC on 6 Nov (EET, +02:00) — a UTC cut
        # would start two hours late.
        self.assertEqual(FROM, "2026-11-07T00:00:00+02:00")
        self.assertEqual(UNTIL, "2026-11-08T20:00:00+02:00")
        self.assertEqual(pf.sofia_day_before("2026-06-14")[0],
                         "2026-06-13T00:00:00+03:00")
        f = load([freeze()])
        self.assertIsNotNone(pf.active(f, at("2026-11-06T22:00:00+00:00")))
        self.assertIsNone(pf.active(f, at("2026-11-06T21:59:59+00:00")))
        self.assertIsNone(pf.active(f, at("2026-11-08T18:00:00+00:00")))

    def test_a_malformed_file_refuses(self):
        for bad in ([freeze(**{"from": "2026-11-07T00:00:00"})],
                    [freeze(until=FROM)], [freeze(status="maybe")],
                    [freeze(), freeze()], [freeze(id="../x")]):
            with self.assertRaises(pf.FreezeConfigError):
                load(bad)

    def test_the_committed_file_loads(self):
        self.assertTrue(pf.load_freezes())


class Copyforward(unittest.TestCase):
    def test_inside_a_window_the_bytes_are_the_snapshots(self):
        f = load([freeze()])
        b = Build()
        self.assertEqual(b.run(1, at("2026-11-06T12:00:00+02:00"), f)["state"], "snapshot")
        first = b.run(2, at("2026-11-07T09:00:00+02:00"), f)
        self.assertEqual(first["state"], "frozen")
        inside = b.bytes()
        second = b.run(3, at("2026-11-08T12:00:00+02:00"), f)
        self.assertEqual(second["state"], "frozen")
        self.assertEqual(b.bytes(), inside)
        persons = json.loads((b.out / "persons.json").read_text())
        self.assertEqual(persons["persons"][0]["n"], 1)
        self.assertEqual(persons["frozen"]["id"], "pvr2026-r1")
        self.assertEqual(first["rows"], persons["persons"])

    def test_the_last_pre_window_build_is_the_one_served(self):
        f = load([freeze()])
        b = Build()
        b.run(1, at("2026-11-06T01:00:00+02:00"), f)
        b.run(2, at("2026-11-06T23:00:00+02:00"), f)
        b.run(3, at("2026-11-07T01:00:00+02:00"), f)
        self.assertEqual(json.loads((b.out / "person" / "mp-1.json").read_text())["n"], 2)

    def test_no_snapshot_withholds_never_fresh(self):
        f = load([freeze()])
        b = Build()
        out = b.run(9, at("2026-11-07T09:00:00+02:00"), f)
        self.assertEqual(out["state"], "withheld")
        persons = json.loads((b.out / "persons.json").read_text())
        self.assertEqual(persons["persons"], [])
        self.assertIn("withheld", persons)
        self.assertFalse((b.out / "person" / "mp-1.json").exists())
        self.assertNotIn(b"9", (b.out / "person_baselines.json").read_bytes())

    def test_a_stale_snapshot_is_not_a_pre_window_build(self):
        # The window moved (the decree replaced the estimate) under the same
        # id; a copy from before the old date is not served as frozen.
        old = load([freeze()])
        b = Build()
        b.run(1, at("2026-11-06T12:00:00+02:00"), old)
        moved = dict(zip(("from", "until"), pf.sofia_day_before("2026-11-22")))
        new = load([freeze(**moved)])
        self.assertEqual(b.run(2, at("2026-11-21T09:00:00+02:00"), new)["state"],
                         "withheld")

    def test_withheld_keeps_the_slug_redirects(self):
        f = load([freeze()])
        b = Build()
        b.write(1)
        pf._write(b.out / "persons.json",
                  {"persons": [], "retired_ids": {"old": "mp-1"}})
        pf.apply(b.out, at("2026-11-07T09:00:00+02:00"), f, b.root)
        persons = json.loads((b.out / "persons.json").read_text())
        self.assertEqual(persons["retired_ids"], {"old": "mp-1"})

    def test_the_first_build_after_until_drops_the_stamp(self):
        f = load([freeze()])
        b = Build()
        b.run(1, at("2026-11-06T12:00:00+02:00"), f)
        b.run(2, at("2026-11-07T12:00:00+02:00"), f)
        self.assertEqual(b.run(3, at("2026-11-08T20:00:00+02:00"), f)["state"], "live")
        persons = json.loads((b.out / "persons.json").read_text())
        self.assertNotIn("frozen", persons)
        self.assertEqual(persons["persons"][0]["n"], 3)

    def test_the_article_rail_still_updates(self):
        f = load([freeze()])
        b = Build()
        b.run(1, at("2026-11-06T12:00:00+02:00"), f, tone="neutral")
        b.run(2, at("2026-11-07T12:00:00+02:00"), f, tone="favorable")
        self.assertEqual(json.loads((b.out / "article.json").read_text())["tone"],
                         "favorable")

    def test_outside_any_window_nothing_changes(self):
        b = Build()
        self.assertEqual(b.run(1, at("2026-10-01T12:00:00+03:00"), load([freeze()]))["state"],
                         "live")
        self.assertFalse(b.root.joinpath("pvr2026-r1").exists())


class Warnings(unittest.TestCase):
    def test_an_estimate_within_45_days_warns(self):
        f = load([freeze(status="estimated")])
        self.assertTrue(pf.warnings(f, at("2026-10-01T00:00:00+03:00")))
        self.assertFalse(pf.warnings(f, at("2026-08-01T00:00:00+03:00")))
        self.assertFalse(pf.warnings(load([freeze()]), at("2026-10-01T00:00:00+03:00")))

    def test_a_closed_first_round_with_no_runoff_recorded_warns(self):
        after = at("2026-11-09T09:00:00+02:00")
        self.assertTrue(pf.warnings(load([freeze()]), after))
        self.assertFalse(pf.warnings(load([freeze(runoff="none")]), after))
        r2 = dict(zip(("from", "until"), pf.sofia_day_before("2026-11-15")))
        both = load([freeze(), {"id": "pvr2026-r2", "status": "decreed",
                                "runoff_of": "pvr2026-r1", **r2}])
        self.assertFalse(pf.warnings(both, after))
        self.assertFalse(pf.warnings(load([freeze()]),
                                     after + timedelta(days=30)))


class Posts(unittest.TestCase):
    def test_posts_are_refused_inside_and_24h_before(self):
        f = load([freeze()])
        self.assertIsNotNone(pf.post_blocked(f, at("2026-11-06T09:00:00+02:00")))
        self.assertIsNotNone(pf.post_blocked(f, at("2026-11-08T19:00:00+02:00")))
        self.assertIsNone(pf.post_blocked(f, at("2026-11-05T23:00:00+02:00")))
        self.assertIsNone(pf.post_blocked(f, at("2026-11-08T20:00:00+02:00")))


if __name__ == "__main__":
    unittest.main()
