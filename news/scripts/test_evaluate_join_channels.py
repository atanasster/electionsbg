#!/usr/bin/env python3
"""Plan T2.1 — the counterfactual harness over a frozen universe. It reports
pipeline CONSISTENCY, never accuracy: 0 labels, and the report says so."""
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import evaluate_join_channels as ejc  # noqa: E402
from home_event_dedupe import RELAXATION_KINDS  # noqa: E402
from test_freeze_event_universe import Harness  # noqa: E402


class TheCounterfactual(Harness):
    def test_it_reports_consistency_over_the_frozen_set_and_labels_nothing(self):
        self.seed_full()
        manifest = self.build()
        manifest["_path"] = "m"; manifest["_sha256"] = "sha"
        out = ejc.evaluate(manifest, self.data)
        self.assertEqual(out["population"], {"publishable": 7, "drifted_since_freeze": 0,
                                             "no_headline": 0, "evaluated": 7, "pipeline_joined": 1})
        # The one pipeline join (p2 → s-pet) is retrievable under both rankings.
        self.assertEqual(out["retrieval_of_the_known_host"]["union"]["retrieved"], 1)
        self.assertEqual(out["retrieval_of_the_known_host"]["old"]["retrieved"], 1)
        self.assertIn("title", out["union_hit_channels"])
        # The wire copy filed under two stories: reachable, and the review
        # rule's lede class is what accepts it.
        self.assertEqual(out["copy_twins"]["groups"], 1)
        self.assertEqual(out["copy_twins"]["later_copy_reaches_twin_story"]["union"], 1)
        self.assertEqual(out["copy_twins"]["review_rule_accepts_twin"]
                         + out["copy_twins"]["twin_refused_by_both"], 1)
        rp = out["review_proposals"]
        self.assertEqual(sum(rp["by_split"].values()), rp["pairs"])
        self.assertEqual(sum(rp["by_story_action"].values()), rp["pairs"])
        self.assertEqual(rp["pairs_the_shipped_channel_would_emit"], rp["by_story_action"].get("new_story", 0))
        self.assertEqual(set(rp["by_relaxation"]), set(RELAXATION_KINDS))
        self.assertIn("verbatim", out["versions"]["retrieval_old"])
        self.assertEqual(out["adjudication"]["labelled"], 0)
        self.assertIn("NOT accuracy", out["basis"])
        self.assertEqual(out["versions"]["review_rule"], "review-v1")

    def test_a_record_that_moved_since_the_freeze_is_counted_and_skipped(self):
        # ⚠️ THE MUTATION THIS CATCHES: evaluating against whatever record is
        # on disk now — the freeze pinned analysis_sha256 for exactly this.
        self.seed_full()
        manifest = self.build()
        path = self.data / "analysis" / "articles" / "a.bg" / "e1.json"
        rec = json.loads(path.read_text(encoding="utf-8"))
        rec["summary_bg"] = "пренаписано"
        path.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        out = ejc.evaluate(manifest, self.data)
        self.assertEqual(out["population"]["drifted_since_freeze"], 1)
        self.assertEqual(out["population"]["evaluated"], 6)

    def test_an_empty_manifest_refuses(self):
        with self.assertRaisesRegex(ValueError, "no publishable"):
            ejc.evaluate({"articles": []}, self.data)

    def test_the_old_ranking_is_the_retired_function_and_agrees_with_the_union_composite(self):
        # The verbatim replay must score exactly what the union function
        # scores as `score` for every story both retrieve — same composite,
        # different SLOT rule. And its top-six honours the composite floor.
        index = {"stories": {f"s{i}": {"title_bg": f"Общ ред {i}", "title_en": "", "member_count": 1,
                                       "first_published": "2026-09-20T08:00:00+00:00",
                                       "last_published": "2026-09-20T08:00:00+00:00", "topics": [],
                                       "entities": {"people": [f"Лице {i}"], "parties": [], "institutions": [],
                                                    "companies": [], "places": []}}
                             for i in range(10)}}
        probe = {"title": "Общ ред", "description": "", "keywords": "",
                 "content": "Лице 3 говори.", "published": "2026-09-20T10:00:00+00:00"}
        old = ejc.old_ranking(index, probe, 6)
        self.assertEqual(len(old), 6)
        self.assertTrue(all(c["score"] >= 3 for c in old))
        self.assertEqual([c["score"] for c in old], sorted((c["score"] for c in old), reverse=True))
        union = {c["story_id"]: c["score"] for c in ejc.aa.candidate_stories(index, probe, limit=100)}
        for c in old:
            self.assertEqual(c["score"], union[c["story_id"]], c["story_id"])

    def test_refusals_fail_closed(self):
        # ⚠️ THE MUTATION THIS CATCHES: writing a report whose every share is
        # None — all records drifted, or no pipeline join in the window.
        self.seed_full()
        manifest = self.build()
        for a in manifest["articles"]:
            if a.get("analysis"):
                a["analysis"]["analysis_sha256"] = "moved"
        with self.assertRaisesRegex(ValueError, "drifted"):
            ejc.evaluate(manifest, self.data)
        manifest = self.build()
        for a in manifest["articles"]:
            if a.get("analysis") and a["analysis"]["story_action"] == "same_story":
                a["analysis"]["story_action"] = "new_story"
        with self.assertRaisesRegex(ValueError, "no pipeline join"):
            ejc.evaluate(manifest, self.data)

    def test_main_reports_an_unreadable_manifest_as_json_not_a_traceback(self):
        import io
        from contextlib import redirect_stdout
        bad = self.root / "nope.json"
        bad.write_text("{", encoding="utf-8")
        out = io.StringIO()
        with redirect_stdout(out):
            code = ejc.main(["--manifest", str(bad), "--data-dir", str(self.data)])
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(out.getvalue())["error"], "manifest_unreadable")


if __name__ == "__main__":
    unittest.main()
