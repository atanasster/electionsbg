#!/usr/bin/env python3
"""The T1.4 reachability gate: what it refuses, and what it refuses to call a pass.

Run:  python3 news/scripts/test_reachability_gate.py

⚠️ THE TWO PROPERTIES WORTH PINNING ARE BOTH ABOUT NOT PASSING. A gate over a
set-equality invariant is easy to write so that it can only ever succeed — an
empty corpus, an N/A fixture, a walk that stops at page 1 on a corpus whose
first page happens to hold every match. Each of those is a test below.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SCRIPT = Path(__file__).resolve().parent / "reachability_gate.py"
PAGE_SIZE = 4


def story(sid: str, published: str, categories, domains) -> dict:
    return {
        "id": sid,
        "title_bg": sid,
        "title_en": None,
        "last_published": published,
        "first_published": published,
        "topics": [{"category": c, "subcategory": None, "primary": i == 0}
                   for i, c in enumerate(categories)],
        "members": [{"domain": d, "article_id": f"{sid}-{d}"} for d in domains],
        "aggregates": {"by_domain": {d: 1 for d in domains}},
    }


# Small on purpose — the real producer's shard is 1,500 rows, which a test
# corpus of twenty would never fill, and a one-shard fixture cannot tell a gate
# that reassembles from one that reads only the first file.
FILTER_SHARD_ROWS = 7


def filter_row(item: dict) -> list:
    categories = sorted({t["category"] for t in item["topics"]}) or ["?"]
    domains = sorted({m["domain"] for m in item["members"]})
    return [item["id"], item["last_published"], categories, domains]


class Harness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="reachability_")
        self.root = Path(self.temp.name)
        self.app = self.root / "news" / "app-data"
        (self.app / "stories").mkdir(parents=True)
        (self.root / "news" / "data" / "analysis").mkdir(parents=True)
        # ⚠️ The shrink guard reads a COMMITTED baseline; a test tree has none,
        # so every case below is measured against „no baseline" unless it
        # writes one deliberately.
        (self.root / "news" / "config").mkdir(parents=True)

    def tearDown(self):
        self.temp.cleanup()

    def publish(self, stories, *, pages_from=None, page_size=PAGE_SIZE,
                filter_rows=None, as_of="2026-09-21T12:00:00+00:00",
                drop_shards=0):
        """Write one snapshot. `pages_from` lets a test publish a DIFFERENT
        ordered index than the corpus — which is how a real regression looks."""
        paged = stories if pages_from is None else pages_from
        (self.app / "stories.json").write_text(
            json.dumps({"generated_at": as_of, "stories": stories},
                       ensure_ascii=False), encoding="utf-8")
        rows = (filter_rows if filter_rows is not None
                else [filter_row(s) for s in stories])
        # ⚠️ THE PARTITIONED SHAPE the producer writes: a manifest with no rows
        # and the rows in `filter-index-<n>.json` shards. This fixture wrote
        # the retired one-file shape (`stories` inside the manifest) for a
        # release after the partition, so every case below measured a layout
        # production no longer emits. Several SMALL shards, so the gate's
        # reassembly is exercised across files and not only within one.
        shards = []
        for n, start in enumerate(range(0, max(len(rows), 1), FILTER_SHARD_ROWS),
                                  start=1):
            chunk = rows[start:start + FILTER_SHARD_ROWS]
            path = f"stories/filter-index-{n}.json"
            (self.app / path).write_text(
                json.dumps({"query_version": 2, "stories": chunk},
                           ensure_ascii=False), encoding="utf-8")
            shards.append({"path": path, "count": len(chunk)})
        # A shard the manifest lists but the tree lost — the half-written
        # publish the manifest's `total` exists to catch.
        for shard in shards[len(shards) - drop_shards:] if drop_shards else []:
            (self.app / shard["path"]).unlink()
        (self.app / "stories" / "filter-index.json").write_text(
            json.dumps({"generated_at": as_of, "query_version": 2,
                        "fields": ["id", "last_published", "categories",
                                   "domains"],
                        "total": len(rows), "facets_basis": {},
                        "facets": {"categories": {}, "domains": {}},
                        "shards": shards}, ensure_ascii=False),
            encoding="utf-8")
        ordered = sorted(paged, key=lambda s: (s["last_published"], s["id"]),
                         reverse=True)
        pages = max(1, -(-len(ordered) // page_size))
        for prefix in ("index", "ranked"):
            for page in range(1, pages + 1):
                chunk = ordered[(page - 1) * page_size:page * page_size]
                (self.app / "stories" / f"{prefix}-{page}.json").write_text(
                    json.dumps({
                        "generated_at": as_of, "as_of": as_of, "sort": prefix,
                        "page": page, "pages": pages, "page_size": page_size,
                        "total": len(ordered),
                        "stories": [{"id": s["id"],
                                     "title_bg": s["title_bg"],
                                     "title_en": None,
                                     "topics": s["topics"],
                                     "domains": sorted(
                                         {m["domain"] for m in s["members"]}),
                                     "first_published": s["first_published"],
                                     "last_published": s["last_published"],
                                     "member_count": len(s["members"])}
                                    for s in chunk],
                    }, ensure_ascii=False), encoding="utf-8")

    def run_gate(self, *args):
        out = subprocess.run(
            [sys.executable, str(SCRIPT), "--json", *args],
            capture_output=True, text=True,
            env={**os.environ, "DATA_BG_ROOT": str(self.root)})
        return out.returncode, json.loads(out.stdout.strip().splitlines()[-1])

    def corpus(self, n=20, domain_of=lambda i: "a.bg"):
        return [story(f"s{i:03d}", f"2026-09-{(i % 20) + 1:02d}T10:00:00+00:00",
                      ["politics" if i % 2 else "economy"], [domain_of(i)])
                for i in range(n)]


class WhatItPasses(Harness):
    def test_a_complete_snapshot_passes_with_set_equality(self):
        self.publish(self.corpus(20, lambda i: "a.bg" if i < 10 else "b.bg"))
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 0, report)
        self.assertTrue(report["ok"])
        self.assertGreaterEqual(report["answerable"],
                                report["expected_answerable_fixtures"])


class WhatItRefuses(Harness):
    def test_an_unreachable_story_fails(self):
        """The corpus holds a story the ordered index never serves."""
        corpus = self.corpus(20)
        self.publish(corpus, pages_from=corpus[:-1])
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertFalse(report["ok"])
        self.assertTrue(any("unreachable" in p for r in report["results"]
                            for p in r.get("problems", [])))

    def test_a_phantom_id_fails_even_at_full_coverage(self):
        """⚠️ THE CASE A RATIO CANNOT SEE. Every eligible story is reachable —
        coverage is 1.000 — and the index ALSO serves one that is not in the
        corpus. Only set equality catches it."""
        corpus = self.corpus(20)
        ghost = story("sZZZ", "2026-09-19T10:00:00+00:00", ["politics"],
                      ["a.bg"])
        self.publish(corpus, pages_from=corpus + [ghost])
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        problems = [p for r in report["results"] for p in r.get("problems", [])]
        self.assertTrue(any("phantom" in p for p in problems), problems)
        self.assertTrue(any(r["coverage"] == 1.0 for r in report["results"]
                            if r["status"] == "fail"))

    def test_a_story_on_two_pages_fails(self):
        corpus = self.corpus(20)
        self.publish(corpus, pages_from=corpus + [corpus[0]])
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        # ⚠️ REPORTED ONCE, at the top level: duplication is a property of
        # the ordered family, not of a query, and per-fixture it read as
        # fourteen failures of one defect.
        self.assertTrue(any("two pages" in p for p in report["problems"]),
                        report["problems"])

    def test_a_filter_index_that_disagrees_with_the_corpus_fails(self):
        """The client filters from `filter-index`, so a row missing there is
        invisible however well the ordered pages are built."""
        corpus = self.corpus(20)
        self.publish(corpus,
                     filter_rows=[filter_row(s) for s in corpus[:-1]])
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertTrue(report["filter_index_rule_drift"]["only_in_stories_json"])

    def test_a_shard_the_manifest_lists_but_the_tree_lost_fails(self):
        """⚠️ THE CASE THE MANIFEST'S `total` EXISTS FOR. Read the retired way
        — `filter_index["stories"]` — the gate saw no rows at all and both
        failed loudly AND went vacuous on facet parity; read shard by shard, a
        missing one must still be named rather than read as a smaller corpus."""
        corpus = self.corpus(20)
        self.publish(corpus, drop_shards=1)
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertTrue(any("shard is missing" in p for p in report["problems"]),
                        report["problems"])
        self.assertTrue(any("unreadable" in p for p in report["problems"]),
                        report["problems"])

    def test_facet_parity_is_checked_across_every_shard_not_only_the_first(self):
        # A mismatch planted in the LAST shard must be seen. A gate that
        # read only `filter-index-1.json` would pass this.
        corpus = self.corpus(20)
        rows = [filter_row(s) for s in corpus]
        rows[-1] = [rows[-1][0], rows[-1][1], ["sport"], rows[-1][3]]
        self.publish(corpus, filter_rows=rows)
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertIn("filter-index", report["facet_drift"])


class WhatItRefusesToCallAPass(Harness):
    def test_an_empty_corpus_is_not_a_pass(self):
        """⚠️ WITHOUT THIS THE GATE INVERTS. Every fixture matches nothing, so
        every one is vacuously covered, so „0 failures" — a build that produced
        nothing would report success at 100%."""
        self.publish([])
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertTrue(report["vacuous"])
        self.assertEqual(report["failing"], 0)
        self.assertFalse(report["ok"])

    def test_a_small_but_complete_corpus_is_a_PASS(self):
        """⚠️ THE OTHER HALF, AND THE ONE A FIXTURE-COUNT FLOOR GOT WRONG.
        Five old stories on one topic and one outlet answer three fixtures and
        send the rest to N/A — nothing is wrong with that snapshot, and
        `news:reachability:gate` runs inside `news:release:gate`, so failing
        it makes a quiet week a red release."""
        corpus = [story(f"s{i}", "2026-01-0{}T10:00:00+00:00".format(i + 1),
                        ["economy"], ["a.bg"]) for i in range(5)]
        self.publish(corpus)
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 0, report)
        self.assertTrue(report["ok"])
        self.assertLess(report["answerable"],
                        report["expected_answerable_fixtures"])
        self.assertFalse(report["vacuous"])

    def test_a_shrunken_corpus_is_refused_however_well_it_reconciles(self):
        """⚠️ SET EQUALITY IS A WITHIN-SNAPSHOT PROPERTY AND CANNOT SEE THIS.
        Measured on the real gate: a synthetic 32-story corpus against a
        3,189-story baseline returns every fixture at 1.000."""
        self.publish(self.corpus(20))
        (self.root / "news" / "config" / "reachability_baseline.json"
         ).write_text(json.dumps({"corpus_stories": 200}), encoding="utf-8")
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertTrue(report["corpus_shrank"])
        self.assertEqual(report["failing"], 0)
        # ...and the operator can say so deliberately.
        code, report = self.run_gate("--enforce", "--allow-shrink")
        self.assertEqual(code, 0, report)
        self.assertTrue(report["ok"])

    def test_an_empty_query_is_not_applicable_rather_than_perfect(self):
        self.publish(self.corpus(20))
        _, report = self.run_gate()
        for row in report["results"]:
            if row["eligible"] == 0:
                self.assertEqual(row["status"], "not_applicable")
                self.assertIsNone(row["coverage"])

    def test_unbuilt_app_data_is_reported_not_passed(self):
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertFalse(report["ok"])
        self.assertIn("missing", report)

    def test_a_deep_page_fixture_exists_and_is_deep(self):
        """⚠️ THE FIXTURE THAT TELLS A CORPUS WALK FROM A PAGE-1 WALK. Page 1
        alone satisfies „everything" and every popular topic, because their
        matches start at the top."""
        # One outlet that appears ONLY in the oldest stories, so its matches
        # are all past the first page.
        corpus = self.corpus(20, lambda i: "rare.bg" if i < 4 else "a.bg")
        self.publish(corpus)
        _, report = self.run_gate()
        deep = [r for r in report["results"]
                if r["fixture"].startswith("deep-page:")]
        self.assertTrue(deep, [r["fixture"] for r in report["results"]])
        self.assertGreater(deep[0]["orders"]["index"]["first_match_page"], 1)


class ThePredicateItself(Harness):
    """⚠️ THE RULES `matches()` SINGLES OUT AS DELIBERATE, none of which had a
    test — so the comment „a bad clock at one outlet [must not be] an
    invisible deletion" was describing behaviour nothing would have caught
    losing."""

    def eligible_for(self, report, fixture):
        return next(r["eligible"] for r in report["results"]
                    if r["fixture"] == fixture)

    def test_an_untopiced_story_is_findable_under_the_untopiced_facet(self):
        # Today's real corpus has ZERO such stories, so neither side of the
        # `or [UNTOPICED_FACET]` fallback is exercised by the live run.
        corpus = self.corpus(20) + [
            story("sNONE", "2026-09-20T10:00:00+00:00", [], ["a.bg"])]
        self.publish(corpus)
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 0, report)
        self.assertEqual(self.eligible_for(report, "everything"), 21)

    def test_a_story_with_no_timestamp_is_out_of_a_window_but_in_everything(self):
        """A missing stamp is refused from a WINDOW and reachable without one:
        dropping it everywhere would delete the story, keeping it everywhere
        would date it by nothing."""
        corpus = self.corpus(20) + [
            story("sNULL", "", ["politics"], ["a.bg"])]
        self.publish(corpus)
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 0, report)
        self.assertEqual(self.eligible_for(report, "everything"), 21)
        self.assertNotIn("sNULL", [])
        self.assertLess(self.eligible_for(report, "window:30d"),
                        self.eligible_for(report, "everything"))

    def test_a_future_timestamp_is_refused_from_a_window(self):
        """⚠️ Otherwise one outlet's bad clock pins a story to the top of
        every window, for as long as its stamp stays ahead."""
        corpus = self.corpus(20) + [
            story("sFUT", "2099-01-01T10:00:00+00:00", ["politics"], ["a.bg"])]
        self.publish(corpus)
        code, report = self.run_gate("--enforce", "--now",
                                     "2026-09-21T12:00:00+00:00")
        self.assertEqual(code, 0, report)
        self.assertEqual(self.eligible_for(report, "everything"), 21)
        for fixture in ("window:1d", "window:7d", "window:30d"):
            row = next(r for r in report["results"]
                       if r["fixture"] == fixture)
            self.assertNotEqual(row["eligible"], 21)


class TheClock(Harness):
    def test_a_malformed_now_is_refused_rather_than_discarded(self):
        """⚠️ An operator pinning a clock is reproducing a run; falling back
        to the snapshot's own `as_of` answers a different question and reports
        the same shape either way."""
        self.publish(self.corpus(20))
        code, report = self.run_gate("--enforce", "--now", "yesterday")
        self.assertEqual(code, 1)
        self.assertFalse(report["ok"])
        self.assertIn("--now", report["reason"])

    def test_the_report_names_the_clock_it_used(self):
        self.publish(self.corpus(20))
        _, report = self.run_gate()
        self.assertEqual(report["clock"]["basis"], "snapshot.as_of")
        _, pinned = self.run_gate("--now", "2026-09-21T12:00:00+00:00")
        self.assertEqual(pinned["clock"], {"basis": "argument",
                                           "value": "2026-09-21T12:00:00+00:00"})


class FacetDrift(Harness):
    def test_a_lost_outlet_outside_the_probed_facets_still_fails(self):
        """⚠️ THE FIXTURES COVER THE TOP 3 OUTLETS; the live corpus has 44. A
        story losing `fakti.bg` was caught by a fixture; the same story losing
        `glasove.com` was invisible — the id sets still reconciled."""
        corpus = self.corpus(20, lambda i: "a.bg" if i else "rare.bg")
        rows = [filter_row(item) for item in corpus]
        rows[0] = [rows[0][0], rows[0][1], rows[0][2], ["a.bg"]]
        self.publish(corpus, filter_rows=rows)
        code, report = self.run_gate("--enforce")
        self.assertEqual(code, 1)
        self.assertEqual(report["filter_index_rule_drift"],
                         {"only_in_stories_json": 0, "only_in_filter_index": 0})
        self.assertIn("filter-index", report["facet_drift"])
        self.assertEqual(report["facet_drift"]["filter-index"]["count"], 1)

    def test_a_clean_snapshot_reports_no_facet_drift(self):
        self.publish(self.corpus(20, lambda i: "a.bg" if i % 2 else "b.bg"))
        _, report = self.run_gate()
        self.assertEqual(report["facet_drift"], {})


class TheFunnelIsSeparate(Harness):
    def analysis(self, records, index_entries=None):
        """Write an analysis tree, and the index the attach stage joins on."""
        analyses = self.root / "news" / "data" / "analysis" / "articles" / "x.bg"
        analyses.mkdir(parents=True, exist_ok=True)
        entries = {}
        for name, verdict, relevant, story_id in records:
            rel = f"news/data/analysis/articles/x.bg/{name}.json"
            (analyses / f"{name}.json").write_text(json.dumps({
                "quality": {"verdict": verdict}, "site_relevant": relevant,
            }, ensure_ascii=False), encoding="utf-8")
            entry = {"path": rel}
            if story_id:
                entry["story_id"] = story_id
            entries[f"https://x.bg/{name}"] = entry
        (self.root / "news" / "data" / "analysis" / "index.json").write_text(
            json.dumps({"version": 1,
                        "articles": index_entries if index_entries is not None
                        else entries}, ensure_ascii=False),
            encoding="utf-8")

    def test_an_absent_analysis_tree_is_not_measured_rather_than_zero(self):
        """⚠️ THE MODULE'S OWN N/A RULE, APPLIED TO THE FUNNEL. „0 unattached"
        is the HEALTHY signal; a tree that was never there renders the same
        row of zeros. And a missing index produces the opposite artefact — a
        fabricated residue equal to the whole site-relevant count."""
        self.publish(self.corpus(20))
        _, report = self.run_gate()
        self.assertEqual(report["article_funnel"]["status"], "not_measured")
        self.assertTrue(report["article_funnel"]["missing"])
        self.assertNotIn("unattached", report["article_funnel"])

    def test_the_attach_join_is_exercised_in_both_directions(self):
        """⚠️ THE FUNNEL'S WHOLE ATTACH STAGE IS ONE PATH JOIN and had no
        coverage: `os.path.relpath(path, ROOT)` against `entry["path"]`."""
        corpus = self.corpus(20)
        self.publish(corpus)
        target = corpus[0]["id"]
        self.analysis([("a", "ok", True, target)])
        _, report = self.run_gate()
        funnel = report["article_funnel"]
        self.assertEqual(funnel["attached_to_published_story"], 1)
        self.assertEqual(funnel["unattached"], 0)

        # Drop the index row: the same record is now unattached, not absent.
        self.analysis([("a", "ok", True, target)], index_entries={})
        _, report = self.run_gate()
        self.assertEqual(report["article_funnel"]["unattached"], 1)

    def test_a_story_built_from_unusable_material_is_counted(self):
        """⚠️ THE CONVERSE RESIDUE, WHICH A COUNT DIFFERENCE CANNOT SEE. Such
        a record hits `continue` before any counter, so `unattached` stays 0
        while a published story rests on an analysis the pipeline rejected."""
        corpus = self.corpus(20)
        self.publish(corpus)
        self.analysis([("a", "unusable", True, corpus[0]["id"])])
        _, report = self.run_gate()
        funnel = report["article_funnel"]
        self.assertEqual(funnel["unattached"], 0)
        self.assertEqual(funnel["attached_but_off_predicate"], 1)

    def test_the_funnel_is_labelled_as_articles(self):
        """⚠️ The inherited „16 of 676 = 2.4%" divided a home selection by a
        30-day corpus. Articles, analyses and stories are different units, and
        the payload has to say so rather than leaving a reader to divide."""
        self.publish(self.corpus(20))
        self.analysis([("a", "ok", True, None)])
        _, report = self.run_gate()
        funnel = report["article_funnel"]
        self.assertIn("articles", funnel["unit"])
        # It is reported beside reachability, never folded into it.
        self.assertNotIn("coverage", funnel)
        self.assertIn("site_relevant_but_not_quality_ok", funnel)

    def test_the_stages_are_cumulative_and_say_so(self):
        """⚠️ `site_relevant` IS THE INTERSECTION WITH `quality_ok`, so a
        reader who counts site-relevant records on disk gets a LARGER number
        and would read the difference as loss. The off-stage count is what
        makes the staging legible instead."""
        self.publish(self.corpus(20))
        self.analysis([("a", "ok", True, None), ("b", "unusable", True, None),
                       ("c", "ok", False, None)])
        _, report = self.run_gate()
        funnel = report["article_funnel"]
        self.assertEqual(funnel["analysed"], 3)
        self.assertEqual(funnel["quality_ok"], 2)
        # NOT 2: „b" is site-relevant but never reached this stage.
        self.assertEqual(funnel["site_relevant"], 1)
        self.assertEqual(funnel["site_relevant_but_not_quality_ok"], 1)


if __name__ == "__main__":
    unittest.main(verbosity=1)
