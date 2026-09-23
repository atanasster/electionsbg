#!/usr/bin/env python3
"""The partitioned story filter index: shards, ranges and the budget.

⚠️ THIS EXISTS BECAUSE THE SINGLE FILE OUTGREW ITS BUDGET AND STOPPED EVERY
BUILD. At 4,899 stories it reached 66,122 gzipped bytes against 65,536, the
writer refused it, and `app-data` froze — nothing downstream of that line was
rewritten for hours. The partition is the first answer the constant's own
comment names; these tests pin the properties that make it EQUIVALENT rather
than merely smaller.
"""
import gzip
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import app_data_inventory as inv  # noqa: E402
import build_app_data as bad  # noqa: E402


def story(sid, published, categories=("politics",), domains=("a.bg",)):
    return {"id": sid, "last_published": published,
            "topics": [{"category": c} for c in categories],
            "domains": list(domains)}


class Sharding(unittest.TestCase):
    def test_shards_run_newest_first(self):
        # ⚠️ What makes the partition pay: a window reads from the top and
        # stops. Oldest-first, every window would read the whole corpus.
        rows = [bad.story_filter_row(story(f"s{i}", f"2026-09-{i:02d}T00:00:00+00:00"))
                for i in range(1, 10)]
        shards = bad.filter_index_shards(rows)
        flat = [row for shard in shards for row in shard["rows"]]
        self.assertEqual([r[1] for r in flat], sorted((r[1] for r in flat), reverse=True))

    def test_an_undated_row_sorts_last(self):
        # ⚠️ `withinDays` refuses a non-ISO stamp, so an undated story can
        # never match a WINDOW — but a query with no window admits it, and
        # that one reads every shard. Last is the only place it is both
        # skippable and never skipped wrongly.
        rows = [bad.story_filter_row(story("undated", None)),
                bad.story_filter_row(story("dated", "2026-09-01T00:00:00+00:00"))]
        flat = [r for s in bad.filter_index_shards(rows) for r in s["rows"]]
        self.assertEqual([r[0] for r in flat], ["dated", "undated"])

    def test_every_row_lands_in_exactly_one_shard(self):
        rows = [bad.story_filter_row(story(f"s{i}", f"2026-09-{(i % 28) + 1:02d}T00:00:00+00:00"))
                for i in range(bad.FILTER_INDEX_SHARD_ROWS * 2 + 7)]
        shards = bad.filter_index_shards(rows)
        flat = [r[0] for s in shards for r in s["rows"]]
        self.assertEqual(len(flat), len(rows))
        self.assertEqual(len(set(flat)), len(rows))

    def test_each_shard_declares_the_range_a_client_skips_on(self):
        rows = [bad.story_filter_row(story(f"s{i}", f"2026-09-{i:02d}T00:00:00+00:00"))
                for i in range(1, 6)]
        shard = bad.filter_index_shards(rows)[0]
        self.assertEqual(shard["newest"], "2026-09-05T00:00:00+00:00")
        self.assertEqual(shard["oldest"], "2026-09-01T00:00:00+00:00")
        self.assertEqual(shard["undated"], 0)

    def test_an_all_undated_shard_declares_no_range(self):
        # Null/null is what tells a windowed client it can skip the shard.
        rows = [bad.story_filter_row(story(f"s{i}", None)) for i in range(3)]
        shard = bad.filter_index_shards(rows)[0]
        self.assertIsNone(shard["newest"])
        self.assertIsNone(shard["oldest"])
        self.assertEqual(shard["undated"], 3)


class Writing(unittest.TestCase):
    def build(self, count):
        rows = [story(f"s{i}", f"2026-09-{(i % 28) + 1:02d}T12:00:00+00:00",
                      categories=("politics", "economy"),
                      domains=("a.bg", "b.bg"))
                for i in range(count)]
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = Path(tmp.name)
        payload = bad.write_filter_index(out, rows, "2026-09-22T00:00:00+00:00")
        return out, payload

    def test_the_manifest_carries_no_rows_and_the_shards_carry_them_all(self):
        out, payload = self.build(bad.FILTER_INDEX_SHARD_ROWS + 10)
        self.assertNotIn("stories", payload)
        self.assertEqual(len(payload["shards"]), 2)
        self.assertEqual(sum(s["count"] for s in payload["shards"]),
                         payload["total"])

    def test_the_reachability_gate_can_still_reassemble_every_row(self):
        # ⚠️ THE GATE READS THE ARTIFACT, NOT THIS MODULE. When the rows moved
        # out of the manifest it kept reading `filter_index["stories"]`, got
        # [], and reported the whole corpus "unreachable" — 14 of 14 fixtures
        # red — while its facet-parity arm went VACUOUS at the same time, so
        # repairing only the loud half would have left a green gate checking
        # nothing. Fourteen passing shard tests did not see it, because none
        # of them reassembled the corpus the way a consumer must.
        out, payload = self.build(bad.FILTER_INDEX_SHARD_ROWS + 10)
        rows = []
        for entry in payload["shards"]:
            shard = json.loads((out / entry["path"]).read_text(encoding="utf-8"))
            rows.extend(shard["stories"])
        self.assertEqual(len(rows), payload["total"])
        self.assertEqual(len({r[0] for r in rows}), payload["total"])
        # And each row is the 4-field positional shape the gate indexes into
        # (`row[0]` id, `row[1]` stamp, `row[2]` categories, `row[3]` domains).
        for row in rows:
            self.assertIsInstance(row, list)
            self.assertGreaterEqual(len(row), 4)
            self.assertIsInstance(row[0], str)

    def test_the_counts_sum_to_the_whole_corpus(self):
        # ⚠️ The check that a shard was not dropped. A missing shard would
        # narrow every count with nothing saying so.
        _, payload = self.build(bad.FILTER_INDEX_SHARD_ROWS * 2 + 3)
        self.assertEqual(sum(s["count"] for s in payload["shards"]), payload["total"])

    def test_every_shard_is_inside_the_budget(self):
        out, payload = self.build(bad.FILTER_INDEX_SHARD_ROWS * 2)
        for entry in payload["shards"]:
            data = (out / entry["path"]).read_bytes()
            self.assertLessEqual(len(gzip.compress(data, 6)),
                                 bad.FILTER_INDEX_GZIP_BUDGET_BYTES, entry["path"])
        manifest = (out / "stories/filter-index.json").read_bytes()
        self.assertLessEqual(len(gzip.compress(manifest, 6)),
                             bad.FILTER_INDEX_GZIP_BUDGET_BYTES)

    def test_the_manifest_is_far_smaller_than_the_corpus_it_describes(self):
        # The point of the split: a reader pays for the manifest plus the
        # shards the window needs, not for every story ever published.
        out, payload = self.build(bad.FILTER_INDEX_SHARD_ROWS * 2)
        manifest = len(gzip.compress(
            (out / "stories/filter-index.json").read_bytes(), 6))
        biggest = max(entry["gzip_bytes"] for entry in payload["shards"])
        self.assertLess(manifest, biggest)

    def test_every_shard_declares_the_contract_its_rows_were_written_under(self):
        # ⚠️ The rows are POSITIONAL, so a shard written under another
        # contract parses cleanly and answers wrongly. The client checks each.
        out, payload = self.build(10)
        for entry in payload["shards"]:
            doc = json.loads((out / entry["path"]).read_text(encoding="utf-8"))
            self.assertEqual(doc["query_version"], bad.QUERY_VERSION)

    def test_a_shrinking_corpus_leaves_no_orphan_shard(self):
        # ⚠️ A shard the manifest no longer lists is a release a reader could
        # still fetch and answer from.
        rows_big = [story(f"s{i}", f"2026-09-{(i % 28) + 1:02d}T12:00:00+00:00")
                    for i in range(bad.FILTER_INDEX_SHARD_ROWS * 3)]
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            bad.write_filter_index(out, rows_big, "2026-09-22T00:00:00+00:00")
            before = sorted(p.name for p in (out / "stories").glob("filter-index-*.json"))
            self.assertGreaterEqual(len(before), 3)
            bad.write_filter_index(out, rows_big[:5], "2026-09-22T00:00:00+00:00")
            after = sorted(p.name for p in (out / "stories").glob("filter-index-*.json"))
            self.assertEqual(after, ["filter-index-1.json"])

    def test_the_facets_stay_over_the_WHOLE_corpus(self):
        # ⚠️ They are the one thing that must not be narrowed by the split:
        # `total` and `facets` answer "in the corpus", not "in what you
        # downloaded".
        _, payload = self.build(bad.FILTER_INDEX_SHARD_ROWS + 5)
        self.assertEqual(payload["total"], bad.FILTER_INDEX_SHARD_ROWS + 5)
        self.assertEqual(payload["facets"]["categories"]["politics"],
                         bad.FILTER_INDEX_SHARD_ROWS + 5)


class OverlayRouting(unittest.TestCase):
    def test_a_shard_is_a_whole_file_not_a_story(self):
        # ⚠️ `filter-index-1` matches the story-id charset, so without an
        # explicit rule it reaches the story-detail arm and resolves to a
        # story no release holds.
        self.assertTrue(inv.is_filter_index_path("stories/filter-index.json"))
        self.assertTrue(inv.is_filter_index_path("stories/filter-index-1.json"))
        self.assertTrue(inv.is_filter_index_path("stories/filter-index-12.json"))
        self.assertFalse(inv.is_filter_index_path("stories/filter-index-x.json"))
        self.assertFalse(inv.is_filter_index_path("stories/abc123.json"))

    def test_a_shard_is_not_a_story_detail(self):
        self.assertFalse(inv.is_story_detail_path("stories/filter-index-1.json"))
        self.assertFalse(inv.is_story_detail_path("stories/filter-index.json"))
        self.assertTrue(inv.is_story_detail_path("stories/abc123.json"))


if __name__ == "__main__":
    unittest.main()
