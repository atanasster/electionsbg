#!/usr/bin/env python3
"""Plan T3.2 — the pure halves of the reclassification: the committed query
and its four readings, the topic-only write with per-field provenance, the
refusals, and the before/after distribution."""
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reclassify_topics as rt  # noqa: E402

TAXONOMY = {
    "version": 2,
    "categories": [
        {"id": "elections-presidential", "subcategories": [{"id": "campaign"}, {"id": "candidates"}]},
        {"id": "elections-parliamentary", "subcategories": [{"id": "campaign"}]},
        {"id": "foreign-policy", "subcategories": [{"id": "eu"}]},
        {"id": "not-site-relevant", "subcategories": [{"id": "sports"}]},
    ],
}


def record(topics, site_relevant=True, version=1):
    return {"article_path": "news/data/x.bg/a.json", "url": "https://x.bg/a",
            "domain": "x.bg", "summary_bg": "Резюме без ключови думи.",
            "leaning": {"label": "neutral", "confidence": 0.5, "evidence": "e"},
            "topics": topics, "site_relevant": site_relevant,
            "taxonomy_version": version}


P = lambda cat, sub: [{"category": cat, "subcategory": sub, "primary": True}]  # noqa: E731


class TheQuery(unittest.TestCase):
    def test_it_is_committed_and_versioned(self):
        self.assertEqual(rt.QUERY_VERSION, 1)
        self.assertIn("Йотова", rt.PRESIDENTIAL_QUERY.pattern)

    def test_it_matches_the_election_and_the_named_traps(self):
        for text in ("президентски избори", "Президентските избори", "кандидат за президент",
                     "кандидатпрезидентска двойка", "кандидат-президентската двойка",
                     "битката за Дондуков 2", "вицепрезидентът", "Илияна Йотова",
                     "президентската кампания", "избори за президент"):
            with self.subTest(text=text):
                self.assertIsNotNone(rt.PRESIDENTIAL_QUERY.search(text))

    def test_it_does_not_match_a_president_acting_in_office(self):
        for text in ("президентът наложи вето", "Радев помилва", "президентската институция"):
            with self.subTest(text=text):
                self.assertIsNone(rt.PRESIDENTIAL_QUERY.search(text))

    def test_the_four_readings_are_reported_separately(self):
        # ⚠️ THE MUTATION THIS CATCHES: collapsing the readings into one. The
        # plan found 360 / 366 / 493 / 299 for an unstated query; the point
        # of reporting all four is that they differ.
        rec = record(P("foreign-policy", "eu"))
        rec["summary_bg"] = "йотова говори"       # lower-case: only the
        article = {"title": "Президентски избори", "content": ""}  # ignorecase arm
        got = rt.readings(rec, article)
        self.assertEqual(got, {"record_case_sensitive": False,
                               "record_ignorecase": True,
                               "source_text": True,
                               "summary_bg": True})
        self.assertFalse(rt.readings(record(P("foreign-policy", "eu")), None)["source_text"])


class TheWrite(unittest.TestCase):
    def apply(self, rec, topics, relevant=True):
        return rt.apply_topics(rec, topics, relevant, TAXONOMY, model="m",
                               manifest_id="2026-09-21T000000Z", now="2026-09-21T00:00:00+00:00")

    def test_writes_topics_and_provenance_and_nothing_else(self):
        rec = record(P("elections-parliamentary", "campaign"))
        updated, refusal = self.apply(rec, P("elections-presidential", "candidates"))
        self.assertIsNone(refusal)
        self.assertEqual(updated["topics"], P("elections-presidential", "candidates"))
        self.assertEqual(updated["taxonomy_version"], 2)
        prov = updated["field_provenance"]["topics"]
        self.assertEqual(prov["previous"], {"topics": P("elections-parliamentary", "campaign"),
                                            "taxonomy_version": 1})
        self.assertEqual(prov["manifest"], "2026-09-21T000000Z")
        # Untouched: the sentiment fields keep their value and no restamp.
        self.assertEqual(updated["leaning"], rec["leaning"])
        self.assertEqual(updated["summary_bg"], rec["summary_bg"])
        self.assertNotIn("analyzed_at", updated)
        # And the input record is not mutated.
        self.assertEqual(rec["topics"], P("elections-parliamentary", "campaign"))
        self.assertEqual(rec["taxonomy_version"], 1)

    def test_refuses_a_primary_that_crosses_not_site_relevant_in_either_direction(self):
        # ⚠️ THE MUTATION THIS CATCHES: writing the crossing. That flag gates
        # story membership and publication as a group.
        _, refusal = self.apply(record(P("foreign-policy", "eu")), P("not-site-relevant", "sports"), False)
        self.assertEqual(refusal["kind"], "crosses_boundary")
        _, refusal = self.apply(record(P("not-site-relevant", "sports"), False), P("foreign-policy", "eu"), True)
        self.assertEqual(refusal["kind"], "crosses_boundary")

    def test_refuses_an_answer_that_disagrees_with_itself(self):
        _, refusal = self.apply(record(P("foreign-policy", "eu")), P("foreign-policy", "eu"), False)
        self.assertEqual(refusal["kind"], "self_disagreement")

    def test_refuses_topics_outside_the_taxonomy_or_without_one_primary(self):
        for bad in ([{"category": "scandal", "subcategory": None, "primary": True}],
                    [{"category": "elections-presidential", "subcategory": "eu", "primary": True}],
                    [{"category": "foreign-policy", "subcategory": "eu", "primary": False}],
                    []):
            with self.subTest(bad=bad):
                updated, refusal = self.apply(record(P("foreign-policy", "eu")), bad)
                self.assertIsNone(updated)
                self.assertEqual(refusal["kind"], "invalid_topics")
                self.assertIn(refusal["kind"], rt.REFUSAL_KINDS)

    def test_a_shared_subcategory_id_is_valid_under_both_categories(self):
        for cat in ("elections-presidential", "elections-parliamentary"):
            self.assertEqual(rt.validate_topics(P(cat, "campaign"), TAXONOMY), [])


class TheDistribution(unittest.TestCase):
    def test_counts_primaries_by_pair_and_category(self):
        rows = [P("elections-parliamentary", "campaign"), P("elections-parliamentary", "campaign"),
                P("elections-presidential", "candidates"), []]
        got = rt.distribution(rows)
        self.assertEqual(got["by_pair"], {"None/None": 1, "elections-parliamentary/campaign": 2,
                                          "elections-presidential/candidates": 1})
        self.assertEqual(got["by_category"], {"None": 1, "elections-parliamentary": 2,
                                              "elections-presidential": 1})


class TheStoryTopic(unittest.TestCase):
    """A story's topic is DERIVED from its members — the plurality, ties to
    the first member — and nothing re-derived it before T3.2."""

    def test_plurality_wins(self):
        got = rt.story_topics_from_members([P("foreign-policy", "eu"),
                                            P("elections-presidential", "candidates"),
                                            P("elections-presidential", "campaign"),
                                            P("elections-presidential", "candidates")])
        self.assertEqual(got, P("elections-presidential", "candidates"))

    def test_a_tie_keeps_the_first_member(self):
        # ⚠️ THE MUTATION THIS CATCHES: „last member wins" on a tie — the
        # story was created from its FIRST member, and that is the topic it
        # keeps until a plurality says otherwise.
        got = rt.story_topics_from_members([P("foreign-policy", "eu"),
                                            P("elections-presidential", "candidates")])
        self.assertEqual(got, P("foreign-policy", "eu"))

    def test_members_without_a_primary_do_not_vote_and_an_empty_story_keeps_its_topic(self):
        self.assertEqual(rt.story_topics_from_members([[], P("foreign-policy", "eu")]),
                         P("foreign-policy", "eu"))
        self.assertEqual(rt.story_topics_from_members([[], []]), [])


def temp_corpus(root: Path, records: dict, stories: dict):
    """A throwaway news/data/analysis tree under `root`, and the index."""
    articles_dir = root / "news" / "data" / "analysis" / "articles" / "x.bg"
    stories_dir = root / "news" / "data" / "analysis" / "stories"
    articles_dir.mkdir(parents=True); stories_dir.mkdir(parents=True)
    (root / "news" / "data" / "x.bg").mkdir(parents=True)
    index = {"version": 1, "updated_at": "S", "stories": {}, "articles": {}}
    for name, (rec, story_id) in records.items():
        path = articles_dir / f"{name}.json"
        path.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        (root / "news" / "data" / "x.bg" / f"{name}.json").write_text(
            json.dumps({"url": rec["url"], "domain": "x.bg", "title": name,
                        "content": "Президентски избори " * 5}), encoding="utf-8")
        index["articles"][rec["url"]] = {"path": f"news/data/analysis/articles/x.bg/{name}.json",
                                         "story_id": story_id, "domain": "x.bg"}
    for sid, story in stories.items():
        (stories_dir / f"{sid}.json").write_text(json.dumps(story, ensure_ascii=False), encoding="utf-8")
        index["stories"][sid] = {"topics": story["topics"], "path": f"news/data/analysis/stories/{sid}.json"}
    (root / "news" / "data" / "analysis" / "index.json").write_text(json.dumps(index), encoding="utf-8")
    return index


class ATempRoot(unittest.TestCase):
    """Points every module at a throwaway DATA_BG_ROOT and restores it."""

    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="reclassify_test_"))
        self.addCleanup(shutil.rmtree, self.root, True)
        import analyze_articles as aa
        self.aa = aa
        self.saved = {n: getattr(aa, n) for n in ("REPO_ROOT", "DATA_DIR", "ANALYSIS_DIR",
                                                   "STORIES_DIR", "INDEX_PATH")}
        aa.REPO_ROOT = str(self.root)
        aa.DATA_DIR = str(self.root / "news" / "data")
        aa.ANALYSIS_DIR = str(self.root / "news" / "data" / "analysis")
        aa.STORIES_DIR = str(self.root / "news" / "data" / "analysis" / "stories")
        aa.INDEX_PATH = str(self.root / "news" / "data" / "analysis" / "index.json")
        self.saved_rt = (rt.ROOT, rt.ANALYSIS, rt.TOPICS)
        rt.ROOT = self.root
        rt.ANALYSIS = self.root / "news" / "data" / "analysis"
        (self.root / "news").mkdir(exist_ok=True)
        rt.TOPICS = self.root / "news" / "topics.json"
        rt.TOPICS.write_text(json.dumps(TAXONOMY), encoding="utf-8")

    def tearDown(self):
        for n, v in self.saved.items():
            setattr(self.aa, n, v)
        rt.ROOT, rt.ANALYSIS, rt.TOPICS = self.saved_rt


class TheStoryRetopic(ATempRoot):
    def seed(self):
        a = record(P("elections-presidential", "candidates")); a["url"] = "https://x.bg/a"
        b = record(P("elections-presidential", "candidates")); b["url"] = "https://x.bg/b"
        c = record(P("foreign-policy", "eu")); c["url"] = "https://x.bg/c"
        story = {"id": "S", "topics": P("foreign-policy", "eu"),
                 "members": [{"url": "https://x.bg/c"}, {"url": "https://x.bg/a"},
                             {"url": "https://x.bg/b"}, {"url": "https://x.bg/ghost"}]}
        temp_corpus(self.root, {"a": (a, "S"), "b": (b, "S"), "c": (c, "S")}, {"S": story})

    def test_a_touched_story_moves_to_the_plurality_and_the_index_follows(self):
        self.seed()
        got = rt.retopic_stories({"news/data/analysis/articles/x.bg/a.json"}, dry_run=False)
        self.assertEqual(got["stories_touched"], 1)
        self.assertEqual(got["moved"][0]["after"], ("elections-presidential", "candidates"))
        # ⚠️ Voters beside members: the ghost member is not in the index and
        # does not vote, and the report says 3 of 4.
        self.assertEqual((got["moved"][0]["members"], got["moved"][0]["members_total"]), (3, 4))
        self.assertEqual(got["before_by_category"], {"foreign-policy": 1})
        self.assertEqual(got["after_by_category"], {"elections-presidential": 1})
        story = self.aa.load_story("S")
        self.assertEqual(story["topics"], P("elections-presidential", "candidates"))
        index = self.aa.load_index()
        self.assertEqual(index["stories"]["S"]["topics"], P("elections-presidential", "candidates"))

    def test_a_dry_run_writes_nothing(self):
        self.seed()
        got = rt.retopic_stories({"news/data/analysis/articles/x.bg/a.json"}, dry_run=True)
        self.assertEqual(len(got["moved"]), 1)
        self.assertEqual(self.aa.load_story("S")["topics"], P("foreign-policy", "eu"))


class TheOutcomeBuckets(ATempRoot):
    """`apply()` with the model stubbed: a refusal is a decision (`refused`),
    a model failure is `failed`, a same-primary secondary change is
    `changed` but not `primary_changed`, and a record that moved on disk
    mid-run is refused at write time rather than clobbered."""

    def manifest(self, names):
        rows = []
        for name in names:
            path = self.root / "news" / "data" / "analysis" / "articles" / "x.bg" / f"{name}.json"
            rec = json.loads(path.read_text(encoding="utf-8"))
            rows.append({"analysis_path": f"news/data/analysis/articles/x.bg/{name}.json",
                         "article_path": f"news/data/x.bg/{name}.json", "url": rec["url"],
                         "domain": "x.bg", "published": None, "title": name,
                         "content_sha256": "0" * 64,
                         "analysis_sha256": rt.sha256_text(json.dumps(rec, ensure_ascii=False, sort_keys=True)),
                         "quality": "ok", "site_relevant": rec["site_relevant"],
                         "taxonomy_version": 1, "topics": rec["topics"], "readings": {}})
        manifest = {"version": 1, "frozen_at": "2026-09-21T000000Z", "taxonomy_version": 2,
                    "query": {"version": 1, "pattern": rt.PRESIDENTIAL_QUERY.pattern},
                    "readings": {"source_text": len(rows)}, "records_scanned": len(rows),
                    "candidates": len(rows), "reclassifiable": len(rows),
                    "before": rt.distribution([r["topics"] for r in rows]), "rows": rows}
        path = self.root / "manifest.json"
        path.write_text(json.dumps(manifest), encoding="utf-8")
        return path

    def run_apply(self, answers, manifest_path, dry_run=False):
        assets = {"taxonomy": json.dumps({"version": 2}), "system": "", "grammar": "",
                  "json_schema": {}, "provenance": {}}
        fake_al = mock.Mock(load_prompt_assets=lambda: assets)
        fake_llm = mock.Mock(load_env_files=lambda root=None: [])

        def classify(row, *_args, **_kw):
            return answers[row["title"]]
        with mock.patch.dict(sys.modules, {"analyze_local": fake_al, "llm_client": fake_llm}), \
                mock.patch.object(rt, "classify", classify):
            return rt.apply(manifest_path, limit=None, workers=2, dry_run=dry_run,
                            model="stub", max_tokens=10)

    def seed(self):
        recs = {}
        for name in ("moved", "secondary", "cross", "broken", "drifted"):
            r = record(P("elections-parliamentary", "campaign")); r["url"] = f"https://x.bg/{name}"
            recs[name] = (r, None)
        temp_corpus(self.root, recs, {})

    def test_every_bucket_is_routed_by_kind_not_by_message(self):
        self.seed()
        manifest = self.manifest(["moved", "secondary", "cross", "broken"])
        answers = {
            "moved": {"kind": "record", "record": {"topics": P("elections-presidential", "candidates"), "site_relevant": True, "model": "stub"}},
            "secondary": {"kind": "record", "record": {"topics": P("elections-parliamentary", "campaign") + [{"category": "foreign-policy", "subcategory": "eu", "primary": False}], "site_relevant": True}},
            "cross": {"kind": "record", "record": {"topics": P("not-site-relevant", "sports"), "site_relevant": False}},
            "broken": {"kind": "parse_failed", "detail": "Expecting ',' delimiter"},
        }
        report = self.run_apply(answers, manifest)
        self.assertEqual(report["counts"], {"changed": 2, "unchanged": 0, "refused": 1, "failed": 1,
                                            "primary_changed": 1, "secondaries_only": 1})
        self.assertEqual(report["refused"][0]["kind"], "crosses_boundary")
        self.assertEqual(report["written"], 2)
        # `after` is re-derivable from the rows the report carries.
        self.assertEqual(sum(report["after"]["by_category"].values()), 2)
        moved = json.loads((self.root / "news/data/analysis/articles/x.bg/moved.json").read_text())
        self.assertEqual(moved["taxonomy_version"], 2)
        self.assertEqual(moved["field_provenance"]["topics"]["previous"]["topics"], P("elections-parliamentary", "campaign"))
        # ⚠️ THE MUTATION THIS CATCHES: routing on the message text — a
        # refusal reworded lands in `failed`, flips the exit code and makes
        # --retry-failed re-ask the model for a decided row.
        cross = json.loads((self.root / "news/data/analysis/articles/x.bg/cross.json").read_text())
        self.assertNotIn("field_provenance", cross)

    def test_a_record_that_moved_on_disk_during_the_run_is_not_clobbered(self):
        self.seed()
        manifest = self.manifest(["drifted"])
        path = self.root / "news/data/analysis/articles/x.bg/drifted.json"

        def classify(row, *_a, **_k):
            # The hourly runner rewrites the record while the model answers.
            rec = json.loads(path.read_text()); rec["summary_bg"] = "пренаписано"
            path.write_text(json.dumps(rec, ensure_ascii=False))
            return {"kind": "record", "record": {"topics": P("elections-presidential", "campaign"), "site_relevant": True}}
        assets = {"taxonomy": json.dumps({"version": 2}), "system": "", "grammar": "", "json_schema": {}, "provenance": {}}
        with mock.patch.dict(sys.modules, {"analyze_local": mock.Mock(load_prompt_assets=lambda: assets),
                                           "llm_client": mock.Mock(load_env_files=lambda root=None: [])}), \
                mock.patch.object(rt, "classify", classify):
            report = rt.apply(manifest, limit=None, workers=1, dry_run=False, model="stub", max_tokens=10)
        self.assertEqual(report["counts"]["failed"], 1)
        self.assertIn("changed on disk", report["failed"][0]["reason"])
        self.assertEqual(json.loads(path.read_text())["summary_bg"], "пренаписано")
        self.assertNotIn("field_provenance", json.loads(path.read_text()))

    def test_a_stale_manifest_is_refused_before_any_model_call(self):
        self.seed()
        manifest = self.manifest(["moved"])
        path = self.root / "news/data/analysis/articles/x.bg/moved.json"
        rec = json.loads(path.read_text()); rec["summary_bg"] = "друго"; path.write_text(json.dumps(rec))
        with self.assertRaisesRegex(SystemExit, "re-freeze"):
            self.run_apply({}, manifest)

    def test_a_stale_prompt_asset_is_refused(self):
        self.seed()
        manifest = self.manifest(["moved"])
        assets = {"taxonomy": json.dumps({"version": 1}), "system": "", "grammar": "", "json_schema": {}, "provenance": {}}
        with mock.patch.dict(sys.modules, {"analyze_local": mock.Mock(load_prompt_assets=lambda: assets),
                                           "llm_client": mock.Mock(load_env_files=lambda root=None: [])}):
            with self.assertRaisesRegex(SystemExit, "build_prompts"):
                rt.apply(manifest, limit=None, workers=1, dry_run=True, model="stub", max_tokens=10)


class TheRetryFold(unittest.TestCase):
    def test_retried_rows_leave_failed_and_the_totals_are_recomputed(self):
        previous = {"changed": [{"analysis_path": "p/a", "title": "a", "before": ["x", "y"], "after": ["z", "w"],
                                 "topics_after": P("z", "w")}],
                    "unchanged": [], "refused": [],
                    "failed": [{"analysis_path": "p/b", "title": "b", "before": ["x", "y"], "reason": "parse"},
                               {"analysis_path": "p/c", "title": "c", "before": ["x", "y"], "reason": "parse"}],
                    "written": 1, "counts": {}, "retries": []}
        retry = {"applied_at": "T", "changed": [{"analysis_path": "p/b", "title": "b", "before": ["x", "y"],
                                                  "after": ["z", "w"], "topics_after": P("z", "w")}],
                 "unchanged": [], "refused": [],
                 "failed": [{"analysis_path": "p/c", "title": "c", "before": ["x", "y"], "reason": "parse again"}],
                 "written": 1}
        out = rt.fold_retry(previous, retry)
        self.assertEqual([f["analysis_path"] for f in out["failed"]], ["p/c"])
        self.assertEqual([e["analysis_path"] for e in out["changed"]], ["p/a", "p/b"])
        self.assertEqual(out["written"], 2)
        self.assertEqual(out["counts"], {"changed": 2, "unchanged": 0, "refused": 0, "failed": 1,
                                         "primary_changed": 2, "secondaries_only": 0})
        self.assertEqual(out["after"]["by_pair"], {"z/w": 2})
        self.assertEqual(out["retries"][0]["rows"], 2)
        # The input is not mutated.
        self.assertEqual(len(previous["failed"]), 2)


class TheCommittedReport(unittest.TestCase):
    """The published before/after (news/evals/reclassify_presidential_*.json),
    when present, must be a real run: a stated query, non-empty candidate
    set, and after-counts that reconcile with the outcome buckets."""

    def test_the_report_reconciles(self):
        reports = sorted((HERE.parent / "evals").glob("reclassify_presidential_*.json"))
        if not reports:
            self.skipTest("no committed reclassification report yet (not a pass)")
        report = json.loads(reports[-1].read_text(encoding="utf-8"))
        self.assertEqual(report["query"]["pattern"], rt.PRESIDENTIAL_QUERY.pattern)
        self.assertFalse(report["dry_run"])
        self.assertGreater(report["candidates"], 0)
        self.assertGreater(report["reclassifiable"], 0)
        counts = report["counts"]
        self.assertEqual(counts["changed"] + counts["unchanged"] + counts["refused"] + counts["failed"],
                         report["reclassifiable"])
        self.assertEqual(sum(report["after"]["by_category"].values()),
                         counts["changed"] + counts["unchanged"])
        self.assertEqual(sum(report["before"]["by_category"].values()), report["reclassifiable"])
        self.assertEqual(report["written"], counts["changed"] + counts["unchanged"])
        self.assertEqual(counts["primary_changed"] + counts["secondaries_only"], counts["changed"])
        self.assertEqual(sum(1 for e in report["changed"] if e["after"] != e["before"]),
                         counts["primary_changed"])
        self.assertEqual(len(report["unchanged"]), counts["unchanged"])
        for r in report.get("retries") or []:
            self.assertEqual(r["changed"] + r["unchanged"] + r["refused"] + r["failed"], r["rows"])
        self.assertTrue(all(sum(bool(t.get("primary")) for t in e["topics_after"]) == 1
                            for e in report["changed"]))
        # `after` is re-derivable from the rows.
        from collections import Counter
        derived = Counter(f"{e['after'][0]}/{e['after'][1]}" for e in report["changed"] + report["unchanged"])
        self.assertEqual(dict(derived), report["after"]["by_pair"])
        for f in report["refused"]:
            self.assertIn(f["kind"], rt.REFUSAL_KINDS)
        # The four readings differ, as the plan predicted they would.
        self.assertGreater(len(set(report["readings"].values())), 1)
        # And the stories were re-derived afterwards — the step that makes
        # a reclassified article reach a reader at all.
        self.assertIn("stories", report)
        self.assertGreater(report["stories"]["stories_touched"], 0)
        self.assertEqual(report["stories"]["missing"], [])


if __name__ == "__main__":
    unittest.main()
