#!/usr/bin/env python3
"""Plan T2.3 — the auto-join accuracy gate. It is UNMET on the committed
(empty) adjudication file and says so; these tests prove the gate CAN be
met by a synthetic adjudicated set, that each threshold fails it closed,
that hard negatives and explicit rejects fail it whatever the precision,
that development / straddling / unknown / duplicate pairs never count, that
a band is promotable only on its SOLE population with no recall loss, that
an own-story `different` label is a false positive, and that the shape
monitor asserts nothing."""
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import join_accuracy_gate as jag  # noqa: E402

SHA = "m" * 64


def manifest(n_articles=400, test_from=0, joined=()):
    """A frozen universe: articles a0..aN, story sK per article (all test by
    default). `joined` articles were put into s(K+1) by the pipeline."""
    arts = []
    for i in range(n_articles):
        own = f"s{(i + 1) % n_articles}" if i in joined else f"s{i}"
        arts.append({"id": f"a{i}", "url": f"https://x/{i}", "split": "test" if i >= test_from else "dev",
                     "strata": ["local_news"] if i % 10 == 0 else [],
                     "analysis": {"story_id": own, "publishable": True,
                                  "story_action": "same_story" if i in joined else "new_story"}})
    cands = [{"article_id": f"a{i}", "story_id": f"s{(i + 1) % n_articles}",
              "adjudicable_split": "test" if (i >= test_from and (i + 1) % n_articles >= test_from)
              else ("excluded" if i >= test_from else "dev")}
             for i in range(n_articles)]
    return {"_sha256": SHA, "articles": arts, "candidate_pairs": cands}


def review_pairs(n_articles=400, strict_true=lambda i: True, relax=lambda i: ["lede"]):
    out = {}
    for i in range(n_articles):
        key = (f"a{i}", f"s{(i + 1) % n_articles}")
        out[key] = {"strict_would_join": strict_true(i), "relaxations": [] if strict_true(i) else relax(i)}
    return out


def adjudications(n_articles=400, events=60, different_every=0):
    pairs = []
    for i in range(n_articles):
        label = "different" if different_every and i % different_every == 0 else "same_event"
        pairs.append({"article_id": f"a{i}", "story_id": f"s{(i + 1) % n_articles}", "manifest_sha256": SHA,
                      "label": label, "by": "h", "on": "2026-09-22", "event_id": f"e{i % events}"})
    return pairs


def usable(m=None, adj=None, rejected=None, rp=None, union=None):
    return jag.join_pairs(m or manifest(), adj or adjudications(), rejected or set(),
                          rp or review_pairs(), union)


class TheGate(unittest.TestCase):
    def test_a_synthetic_adjudicated_set_can_meet_it(self):
        # ⚠️ A gate that can never be met is decoration. 400 accepted test
        # pairs over 60 events, all strict-joined and all labelled same_event.
        pairs, excluded = usable()
        self.assertEqual(excluded, {})
        gate = jag.evaluate_gate(pairs)
        self.assertTrue(gate["met"], gate["reasons"])
        self.assertEqual(gate["accepted_test_pairs"], 400)
        self.assertEqual(gate["events"], 60)
        self.assertEqual(gate["strict_rule"]["precision"], 1.0)
        self.assertGreaterEqual(gate["strict_rule"]["precision_lower_95"], 0.97)
        self.assertEqual(gate["strict_rule"]["recall"], 1.0)
        self.assertEqual(gate["candidate_retrieval_recall"], 1.0)
        self.assertEqual(gate["local_news"]["recall"], 1.0)
        self.assertIsNotNone(gate["strict_rule"]["event_bootstrap"]["precision_p2_5"])

    def test_it_is_unmet_and_names_every_reason_on_zero_pairs(self):
        gate = jag.evaluate_gate([])
        self.assertFalse(gate["met"])
        self.assertIn("no adjudicated pairs", gate["reasons"])
        self.assertTrue(any("accepted test pairs 0 < 300" in r for r in gate["reasons"]))
        self.assertTrue(any("events 0 < 50" in r for r in gate["reasons"]))
        self.assertIsNone(gate["strict_rule"]["precision"])
        self.assertIsNone(gate["strict_rule"]["recall"])
        self.assertIsNone(gate["cluster_purity"])
        for band in gate["bands"].values():
            self.assertFalse(band["promotable"])
            self.assertTrue(band["reason"])
            self.assertNotIn("recall", band)   # a band's recall is a GAIN over strict, inside sole/any

    def test_each_threshold_fails_it_closed(self):
        pairs, _ = usable(manifest(200), adjudications(200, 60), rp=review_pairs(200))
        self.assertTrue(any("accepted test pairs 200 < 300" in r for r in jag.evaluate_gate(pairs)["reasons"]))
        pairs, _ = usable(adj=adjudications(events=20))
        self.assertTrue(any("events 20 < 50" in r for r in jag.evaluate_gate(pairs)["reasons"]))
        # Precision: 1 in 50 labelled different → 0.98 < 0.99.
        pairs, _ = usable(adj=adjudications(different_every=50))
        gate = jag.evaluate_gate(pairs)
        self.assertAlmostEqual(gate["strict_rule"]["precision"], 392 / 400)
        self.assertTrue(any("precision 0.98" in r for r in gate["reasons"]))
        self.assertEqual(gate["non_event_false_matches"], 8)

    def test_one_hard_negative_or_explicit_reject_fails_it_whatever_the_precision(self):
        # ⚠️ THE MUTATION THIS CATCHES: precision-only gating. 400 pairs, all
        # same_event except one the human marked hard_negative — 0.9975
        # precision, and still a failed gate.
        adj = adjudications()
        adj[7]["label"] = "different"
        adj[7]["hard_negative"] = True
        pairs, _ = usable(adj=adj)
        gate = jag.evaluate_gate(pairs)
        self.assertGreaterEqual(gate["strict_rule"]["precision"], 0.99)
        self.assertEqual(len(gate["violations"]), 1)
        self.assertTrue(gate["violations"][0]["hard_negative"])
        self.assertFalse(gate["met"])
        self.assertTrue(any("violations" in r for r in gate["reasons"]))
        # ⚠️ An explicit reject is a QUEUE decision over a STORY pair. The
        # adjudicated (a3, s4) maps through a3's own story s3 → (s3, s4).
        adj = adjudications()
        adj[3]["label"] = "different"
        pairs, _ = usable(adj=adj, rejected={frozenset(("s3", "s4"))})
        gate = jag.evaluate_gate(pairs)
        self.assertEqual([v["explicit_reject"] for v in gate["violations"]], [True])
        self.assertFalse(gate["met"])
        # The article-shaped key never matches — that was the defect.
        pairs, _ = usable(adj=adj, rejected={frozenset(("a3", "s4"))})
        self.assertEqual(jag.evaluate_gate(pairs)["violations"], [])

    def test_an_own_story_different_label_is_a_false_positive_of_the_live_rule(self):
        # ⚠️ THE MUTATION THIS CATCHES: excluding the pipeline's own joins from
        # the measured population, so a wrong live join can never be a false
        # positive. a5 was joined by the pipeline into s6; the human says
        # different.
        m = manifest(joined={5})
        adj = adjudications()
        adj[5]["label"] = "different"
        pairs, _ = usable(m, adj, rp=review_pairs(strict_true=lambda i: i != 5))
        own = next(p for p in pairs if p["article_id"] == "a5")
        self.assertEqual(own["strict_basis"], "own_story")
        self.assertTrue(own["strict_would_join"])
        self.assertTrue(own["retrieved"])
        gate = jag.evaluate_gate(pairs)
        self.assertEqual(gate["strict_rule"]["fp"], 1)
        self.assertEqual(gate["non_event_false_matches"], 1)
        # a4's default pair (a4, s5) lost its story to the join: unknown now.
        self.assertEqual(gate["strict_rule"]["basis_counts"], {"own_story": 1, "counterfactual": 398})

    def test_a_local_news_loss_blocks_a_band_even_when_global_figures_clear(self):
        # ⚠️ THE MUTATION THIS CATCHES: the local-news stratum reported but
        # not gated. A band is strict ∪ band, so its recall cannot fall
        # below the strict rule's — what can fall on local news is PRECISION:
        # the relaxation joins two councils. 400 sole-lede pairs, all
        # same_event except ONE local pair labelled different (global
        # precision 0.9975 — clears 0.99), while the strict rule joined only
        # local same_event pairs (local precision 1.0).
        strict = lambda i: i % 10 == 0 and i != 20  # noqa: E731
        adj = adjudications()
        adj[20]["label"] = "different"    # a local pair the band joins and strict does not
        rp = review_pairs(strict_true=strict, relax=lambda i: ["lede"])
        pairs, _ = usable(adj=adj, rp=rp)
        gate = jag.evaluate_gate(pairs)
        sole = gate["bands"]["lede"]["sole"]
        self.assertGreaterEqual(sole["precision"], 0.99)
        self.assertGreater(sole["recall"], gate["strict_rule"]["recall"])
        self.assertEqual(gate["local_news"]["precision"], 1.0)
        self.assertLess(sole["local_news_precision"], 1.0)
        self.assertFalse(gate["bands"]["lede"]["promotable"])
        self.assertIn("local-news precision", gate["bands"]["lede"]["reason"])
        # Without the local loss the same band is promotable.
        adj[20]["label"] = "same_event"
        pairs, _ = usable(adj=adj, rp=rp)
        gate = jag.evaluate_gate(pairs)
        self.assertTrue(gate["bands"]["lede"]["promotable"], gate["bands"]["lede"]["reason"])

    def test_a_band_is_promotable_on_its_sole_population_only(self):
        # A pair needing TWO relaxations is in the band's `any` population,
        # not its `sole` one — promoting the band alone would not join it.
        rp = review_pairs(strict_true=lambda i: False,
                          relax=lambda i: ["lede"] if i % 2 else ["lede", "topic:none"])
        pairs, _ = usable(rp=rp)
        gate = jag.evaluate_gate(pairs)
        band = gate["bands"]["lede"]
        self.assertEqual(band["sole"]["tp"], 200)
        self.assertEqual(band["any"]["tp"], 400)
        self.assertFalse(band["promotable"])   # 200 sole pairs < 300
        self.assertIn("accepted test pairs 200", band["reason"])
        # With every pair needing only lede, the band clears the floors.
        pairs, _ = usable(rp=review_pairs(strict_true=lambda i: False))
        gate = jag.evaluate_gate(pairs)
        self.assertTrue(gate["bands"]["lede"]["promotable"], gate["bands"]["lede"]["reason"])
        # Its precision-fail twin.
        pairs, _ = usable(adj=adjudications(different_every=50), rp=review_pairs(strict_true=lambda i: False))
        gate = jag.evaluate_gate(pairs)
        self.assertFalse(gate["bands"]["lede"]["promotable"])
        self.assertIn("precision", gate["bands"]["lede"]["reason"])
        # And its hard-negative twin: one hard negative in the band's sole
        # population fails it whatever the precision (0.9975 here).
        adj = adjudications()
        adj[7]["label"] = "different"
        adj[7]["hard_negative"] = True
        pairs, _ = usable(adj=adj, rp=review_pairs(strict_true=lambda i: False))
        gate = jag.evaluate_gate(pairs)
        self.assertGreaterEqual(gate["bands"]["lede"]["sole"]["precision"], 0.99)
        self.assertEqual(gate["bands"]["lede"]["sole"]["violations"], 1)
        self.assertFalse(gate["bands"]["lede"]["promotable"])
        self.assertIn("violations", gate["bands"]["lede"]["reason"])

    def test_dev_straddling_unclear_unknown_and_other_manifest_pairs_never_count(self):
        m = manifest(test_from=100)   # a0..a99 are development
        adj = adjudications()
        adj[150]["label"] = "unclear"
        adj[151]["manifest_sha256"] = "x" * 64
        adj[152]["story_id"] = "s-nope"
        pairs, excluded = usable(m, adj)
        # a99 → s100: a dev article; a399 → s0: story s0 is dev → straddles.
        self.assertEqual(excluded["not_test"], 100)
        self.assertEqual(excluded["straddles"], 1)
        self.assertEqual(excluded["unclear"], 1)
        self.assertEqual(excluded["other_manifest"], 1)
        self.assertEqual(excluded["unknown_story"], 1)
        self.assertEqual(len(pairs), 400 - 100 - 4)

    def test_the_straddle_rule_is_cross_checked_against_the_manifest_stamp(self):
        m = manifest(test_from=100)
        m["candidate_pairs"][399]["adjudicable_split"] = "test"   # the stamp says test, the rule says excluded
        with self.assertRaisesRegex(ValueError, "drifted"):
            usable(m)

    def test_retrieval_recall_counts_labelled_pairs_outside_the_retrieved_set(self):
        # ⚠️ Accepted pairs alone cannot measure recall: a same_event pair
        # retrieval never surfaced must count against it — under the UNION
        # ranking when the join report carries it.
        union = {(f"a{i}", f"s{(i + 1) % 400}") for i in range(300)}
        pairs, _ = usable(union=union)
        self.assertEqual(jag.evaluate_gate(pairs)["candidate_retrieval_recall"], 0.75)

    def test_cluster_purity_is_over_clusters_with_two_labelled_members(self):
        # ⚠️ THE MUTATION THIS CATCHES: a constant purity. Two articles
        # joined to one story from two events → impure.
        adj = adjudications()
        adj[3]["story_id"] = "s2"    # a1 → s2 (default) and a3 → s2, from two events
        adj[3]["event_id"] = "e-other"
        rp = review_pairs()
        rp[("a3", "s2")] = {"strict_would_join": True, "relaxations": []}
        pairs, _ = usable(adj=adj, rp=rp)
        purity = jag.evaluate_gate(pairs)["cluster_purity"]
        self.assertEqual(purity["clusters_with_2plus_labelled"], 1)
        self.assertEqual(purity["labelled_members_in_those"], 2)
        self.assertEqual(purity["purity"], 0.5)
        # All singletons: no claim.
        pairs, _ = usable()
        self.assertIsNone(jag.evaluate_gate(pairs)["cluster_purity"]["purity"])

    def test_wilson_and_the_prior(self):
        self.assertIsNone(jag.wilson_lower(0, 0))
        self.assertAlmostEqual(jag.wilson_lower(85, 90), 0.8765, places=3)
        self.assertLess(jag.wilson_lower(85, 90), jag.GATE["min_precision_lower_bound"])
        self.assertGreater(jag.wilson_lower(400, 400), 0.99)
        self.assertEqual(jag.wilson_lower(0, 10), 0.0)

    def test_the_bootstrap_is_seeded_resamples_events_and_reports_effective_rounds(self):
        pairs, _ = usable(adj=adjudications(different_every=50))
        one = jag.event_bootstrap(pairs, lambda p: p["strict_would_join"], rounds=200)
        two = jag.event_bootstrap(pairs, lambda p: p["strict_would_join"], rounds=200)
        self.assertEqual(one, two)
        self.assertEqual((one["events"], one["effective_rounds"]), (60, 200))
        self.assertLessEqual(one["precision_p2_5"], 392 / 400)
        self.assertGreaterEqual(one["precision_p97_5"], 392 / 400)
        self.assertIsNone(jag.event_bootstrap([], lambda p: True))
        # A predicate that rarely fires: the interval is withheld, not biased.
        few = jag.event_bootstrap(pairs, lambda p: p["article_id"] == "a0", rounds=200)
        self.assertLess(few["effective_rounds"], 200)
        self.assertIsNone(few["precision_p2_5"])
        self.assertIn("withheld", few["reason"])

    def test_a_malformed_adjudication_file_refuses(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "adj.json"
            good = {"article_id": "a", "story_id": "s", "manifest_sha256": SHA, "label": "different",
                    "by": "h", "on": "2026-09-22", "event_id": "e"}
            for bad, message in (
                ({"article_id": "a", "story_id": "s"}, "lacks"),
                ({**good, "label": "maybe"}, "label"),
                ({**good, "label": "same_event", "hard_negative": True}, "hard_negative but not"),
            ):
                path.write_text(json.dumps({"version": 1, "pairs": [bad]}), encoding="utf-8")
                with self.assertRaisesRegex(ValueError, message):
                    jag.load_adjudications(path)
            path.write_text(json.dumps({"version": 1, "pairs": [good, good]}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicates"):
                jag.load_adjudications(path)
            self.assertEqual(jag.load_adjudications(Path(tmp) / "missing.json")["pairs"], [])

    def test_the_committed_adjudication_file_is_empty_and_says_so(self):
        # The plan's constraint: build the gate, leave the threshold unmet,
        # say so. The day this assertion fails is the day somebody labelled.
        doc = jag.load_adjudications(jag.ADJUDICATIONS_PATH)
        self.assertEqual(doc["pairs"], [])
        text = " ".join(doc["how_to_read"])
        self.assertIn("EMPTY on purpose", text)
        self.assertIn("ARTICLE's event", text)


class MainEndToEnd(unittest.TestCase):
    def test_enforce_exits_nonzero_on_the_empty_file_and_the_output_says_unmet(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            m = manifest(20)
            (root / "universe.json").write_text(json.dumps(m), encoding="utf-8")
            adj = root / "adj.json"
            adj.write_text(json.dumps({"version": 1, "pairs": []}), encoding="utf-8")
            queue = root / "queue.json"
            queue.write_text(json.dumps({"version": 1, "items": [
                {"active": True, "status": "rejected", "keeper": {"id": "s1"}, "candidate": {"id": "s2"}}]}),
                encoding="utf-8")
            old_dir = jag.REPORT_DIR
            jag.REPORT_DIR = root
            try:
                out = io.StringIO()
                with redirect_stdout(out):
                    code = jag.main(["--manifest", str(root / "universe.json"), "--adjudications", str(adj),
                                     "--queue", str(queue), "--stories", str(root / "none.json"), "--enforce"])
                payload = json.loads(out.getvalue().strip().splitlines()[-1])
                self.assertEqual(code, 1)
                self.assertFalse(payload["met"])
                self.assertEqual(payload["n_usable"], 0)
                self.assertIn("UNMET", payload["status"])
                report = json.loads(Path(payload["report"]).read_text(encoding="utf-8"))
                self.assertFalse(report["met"])
                self.assertIn("basis", report)
                self.assertFalse(report["priors"]["strict_rule_2026_09_02"]["clears_gate"])
                # Without --enforce the report is written and the exit is 0.
                with redirect_stdout(io.StringIO()):
                    code = jag.main(["--manifest", str(root / "universe.json"), "--adjudications", str(adj),
                                     "--queue", str(queue), "--stories", str(root / "none.json"), "--force"])
                self.assertEqual(code, 0)
            finally:
                jag.REPORT_DIR = old_dir


class TheShapeMonitor(unittest.TestCase):
    def test_it_reports_and_requires_nothing(self):
        stories = [
            {"id": "s1", "members": [{"domain": "a.bg", "published": "2026-09-20T10:00:00+00:00",
                                      "first_seen": "2026-09-20T11:00:00+00:00"},
                                     {"domain": "b.bg", "published": "2026-09-20T10:00:00+00:00",
                                      "first_seen": "2026-09-22T11:00:00+00:00"}]},
            {"id": "s2", "members": [{"domain": "a.bg", "published": "2026-09-20T10:00:00+00:00"}]},
            {"id": "s3", "members": [{"domain": "a.bg"}]},
        ]
        queue = {"items": [{"active": True, "status": "pending"}, {"active": False, "status": "pending"},
                           {"active": True, "status": "accepted"}]}
        got = jag.cluster_shape(stories, queue)
        self.assertEqual(got["stories"], 3)
        self.assertAlmostEqual(got["singleton_share"], 2 / 3)
        self.assertAlmostEqual(got["multi_outlet_comparison_share"], 1 / 3)
        self.assertEqual(got["max_cluster_size"], 2)
        self.assertEqual(got["review_backlog_pending"], 1)
        lag = got["first_seen_minus_published_hours"]
        self.assertEqual(lag["members_measured"], 2)
        self.assertEqual(lag["backfill_share_over_24h"], 0.5)
        self.assertIn("No figure here is a target", got["basis"])
        empty = jag.cluster_shape([], None)
        self.assertIsNone(empty["singleton_share"])
        self.assertEqual(empty["max_cluster_size"], 0)
        self.assertFalse({"met", "ready", "ok"} & set(got))


if __name__ == "__main__":
    unittest.main()
