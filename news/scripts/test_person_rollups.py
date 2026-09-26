#!/usr/bin/env python3
"""The person archive on Jev scores (news-person-sentiment-v1 §4).

⚠️ Most assertions here are about a DENOMINATOR: what is inside M, what is
beside it, what each basis counts as one unit, and what the page guard
refuses."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import person_rollups as pr  # noqa: E402

# bucket indexes on the five-level scale
SU, UN, NE, FA, SF = range(5)


def subject(pid, *, value=-0.8, index=UN, role="primary", kind="person",
            basis="exact", form_kind="two_part", conflict=False, tone=True,
            name=None):
    s = {"name": name or f"Име {pid}", "kind": "person", "subject_role": role,
         "identity": {"kind": kind, "id": pid, "basis": basis,
                      "form_kind": form_kind, "identity_version": "iv",
                      "canonical": f"Канон {pid}"}}
    if tone:
        s["tone"] = {"value": value, "bucket_index": index}
    if conflict:
        s["conflict"] = True
    return s


def article(url, subjects, *, domain="a.bg", title=None, story="s1",
            published="2026-09-10T10:00:00+00:00", scope="full", links=None,
            jev=True):
    analysis = {"entity_links": links or {}}
    if jev:
        analysis["jev_sentiment"] = {"subjects": subjects,
                                     "text_scope": {"kind": scope}}
    return {"url": url, "domain": domain, "article_id": url[-3:],
            "title": title or url, "published": published, "story_id": story,
            "analysis": analysis}


class Accounting(unittest.TestCase):
    def test_both_identities_hold_across_every_status(self):
        rows = [
            article("u/1", [subject("p")]),
            article("u/2", [subject("p", tone=False)]),                   # pending
            article("u/3", [subject("p")], scope="prefix"),               # insufficient
            article("u/4", [subject("p", index=None)]),                   # unplaceable
            article("u/5", [subject("p", conflict=True)]),                # conflict
            article("u/6", [subject("p", role="incidental", tone=False)]),  # beside M
            article("u/7", [subject("p", role="weird")]),                 # beside M
        ]
        e = pr.collect(rows)["p"]
        self.assertEqual(pr.check_accounting(e), [])
        self.assertEqual((e["eligible"], e["assessed"]), (5, 1))
        self.assertEqual({k: e[k] for k in pr.UNASSESSED_KINDS},
                         {"insufficient_text": 1, "pending": 1,
                          "unplaceable": 1, "conflict": 1})
        self.assertEqual((e["incidental"], e["unreadable_role"]), (1, 1))

    def test_a_conflicted_or_truncated_row_carries_no_score(self):
        rows = [article("u/1", [subject("p", conflict=True)]),
                article("u/2", [subject("p")], scope="prefix")]
        for r in pr.collect(rows)["p"]["rows"]:
            self.assertIsNone(r["value"])
            self.assertIsNone(r["bucket"])

    def test_a_linked_person_in_an_unscored_article_is_counted_beside_m(self):
        rows = [article("u/1", [subject("p")]),
                article("u/2", [], jev=False,
                        links={"Име": {"kind": "person", "id": "p"}})]
        e = pr.collect(rows)["p"]
        self.assertEqual(e["unscored_mentions"], 1)
        self.assertEqual(e["eligible"], 1)
        self.assertEqual(pr.check_accounting(e), [])

    def test_an_unscored_article_read_first_still_counts(self):
        rows = [article("u/0", [], jev=False,
                        links={"Име": {"kind": "person", "id": "p"}}),
                article("u/1", [subject("p")])]
        self.assertEqual(pr.collect(rows)["p"]["unscored_mentions"], 1)

    def test_a_forced_mismatch_is_reported(self):
        e = pr.collect([article("u/1", [subject("p")])])["p"]
        e["assessed"] += 1
        self.assertTrue(pr.check_accounting(e))

    def test_only_stamped_person_subjects_count(self):
        party = {"name": "ГЕРБ", "kind": "party", "subject_role": "primary",
                 "tone": {"value": 1, "bucket_index": FA}}
        unlinked = {"name": "Тръмп", "kind": "person", "subject_role": "primary",
                    "identity": None, "tone": {"value": 1, "bucket_index": FA}}
        self.assertEqual(pr.collect([article("u/1", [party, unlinked])]), {})


class Bases(unittest.TestCase):
    def rows(self):
        # One outlet, one story, three follow-ups; a second outlet copying a
        # headline; a third outlet with no story.
        return [
            article("a/1", [subject("p", value=-1.0, index=UN)], story="s1",
                    title="Заглавие А"),
            article("a/2", [subject("p", value=-0.6, index=UN)], story="s1"),
            article("a/3", [subject("p", value=-0.8, index=UN)], story="s1"),
            article("b/1", [subject("p", value=0.2, index=NE)], domain="b.bg",
                    story="s1", title="Заглавие А"),
            article("c/1", [subject("p", value=1.0, index=FA)], domain="c.bg",
                    story=None),
        ]

    def test_story_basis_counts_an_outlet_story_once(self):
        e = pr.collect(self.rows())["p"]
        story = pr.summarize(e["units"]["story"])
        self.assertEqual(story["n"], 3)
        self.assertAlmostEqual(story["mean"], round((-0.8 + 0.2 + 1.0) / 3, 4))

    def test_same_headline_folds_copies_across_outlets(self):
        e = pr.collect(self.rows())["p"]
        self.assertEqual(len(e["units"]["same_headline"]), 4)
        self.assertEqual(len(e["units"]["raw"]), 5)

    def test_raw_counts_match_the_rows(self):
        e = pr.collect(self.rows())["p"]
        self.assertEqual(e["raw_counts"]["unfavorable"], 3)
        self.assertEqual(sum(e["raw_counts"].values()), e["assessed"])

    def test_se_is_between_units_and_absent_for_one(self):
        e = pr.collect(self.rows()[:3])["p"]
        s = pr.summarize(e["units"]["story"])
        self.assertEqual(s["n"], 1)
        self.assertIsNone(s["se"])
        self.assertIsNone(s["ci_low"])

    def test_a_mean_buckets_with_the_row_edges(self):
        e = pr.collect(self.rows())["p"]
        s = pr.summarize(e["units"]["story"])
        self.assertEqual(s["mean_bucket"], "neutral")


class ByOutlet(unittest.TestCase):
    def test_mean_withheld_below_five_and_counts_kept(self):
        rows = [article(f"a/{i}", [subject("p")], story=f"s{i}") for i in range(5)]
        rows += [article("b/1", [subject("p")], domain="b.bg")]
        out = {o["domain"]: o for o in pr.by_outlet(pr.collect(rows)["p"])}
        self.assertIsNotNone(out["a.bg"]["mean"])
        self.assertIsNone(out["b.bg"]["mean"])
        self.assertTrue(out["b.bg"]["mean_withheld"])
        self.assertEqual(out["b.bg"]["counts"]["unfavorable"], 1)

    def test_ordered_by_coverage_not_tone(self):
        rows = [article(f"a/{i}", [subject("p", value=-1.9, index=SU)],
                        story=f"s{i}") for i in range(2)]
        rows += [article(f"b/{i}", [subject("p", value=1.9, index=SF)],
                         domain="b.bg", story=f"t{i}") for i in range(3)]
        self.assertEqual([o["domain"] for o in pr.by_outlet(pr.collect(rows)["p"])],
                         ["b.bg", "a.bg"])


class Series(unittest.TestCase):
    def test_every_point_carries_its_own_coverage(self):
        rows = [article("a/1", [subject("p")], published="2026-09-01T10:00:00+00:00",
                        story="s1"),
                article("a/2", [subject("p")], published="2026-09-20T10:00:00+00:00",
                        story="s2")]
        coverage = {"2026-09-01": [9, 10], "2026-09-20": [6, 10]}
        s = pr.series(pr.collect(rows)["p"], coverage)
        self.assertEqual(s["granularity"], "day")
        by = {p["period"]: p for p in s["points"]}
        self.assertFalse(by["2026-09-01"]["below_floor"])
        self.assertTrue(by["2026-09-20"]["below_floor"])
        self.assertEqual(by["2026-09-20"]["coverage"], 0.6)

    def test_a_period_with_no_denominator_is_below_the_floor(self):
        rows = [article("a/1", [subject("p")], story="s1")]
        s = pr.series(pr.collect(rows)["p"], {})
        self.assertTrue(s["points"][0]["below_floor"])

    def test_undated_units_are_counted_not_plotted(self):
        rows = [article("a/1", [subject("p")], published=None, story="s1")]
        s = pr.series(pr.collect(rows)["p"], {})
        self.assertEqual((s["points"], s["undated"]), ([], 1))


class PageGuard(unittest.TestCase):
    def entry(self, n, **kw):
        rows = [article(f"a/{i}", [subject("p", **kw)], story=f"s{i}")
                for i in range(n)]
        return pr.collect(rows)["p"]

    def test_threshold(self):
        self.assertEqual(pr.page_decision(self.entry(4, form_kind="full_name"),
                                          confirmed=set(), refused=set()),
                         "below_threshold")

    def test_two_part_only_needs_a_confirmation(self):
        e = self.entry(5)
        self.assertEqual(pr.page_decision(e, confirmed=set(), refused=set()),
                         "identity_unconfirmed")
        self.assertEqual(pr.page_decision(e, confirmed={"p"}, refused=set()),
                         "publish")

    def test_a_strong_link_is_enough(self):
        for kw in ({"form_kind": "full_name"}, {"basis": "context"},
                   {"basis": "surname_alias"}):
            self.assertEqual(pr.page_decision(self.entry(5, **kw),
                                              confirmed=set(), refused=set()),
                             "publish", kw)

    def test_a_refusal_wins(self):
        self.assertEqual(pr.page_decision(self.entry(9, form_kind="full_name"),
                                          confirmed={"p"}, refused={"p"}),
                         "identity_refused")

    def test_a_news_only_identity_must_be_a_bulgarian_public_figure(self):
        def np(scope, public):
            s = subject("np_1", kind="news_person")
            s["identity"].update(scope=scope, public_figure=public)
            return pr.collect([article("a/1", [s])])["np_1"]
        self.assertEqual(pr.page_decision(np("bg", True), confirmed=set(),
                                          refused=set()), "publish")
        for scope, public in (("bg", False), ("foreign", True), (None, None)):
            self.assertEqual(pr.page_decision(np(scope, public), confirmed=set(),
                                              refused=set()), "not_public_bg")


class Shapes(unittest.TestCase):
    def entry(self):
        rows = [article(f"a/{i}", [subject("p", value=-0.8 + i / 10)],
                        story=f"s{i}") for i in range(6)]
        return pr.collect(rows)["p"]

    def test_the_index_has_no_mean(self):
        row = pr.index_row(self.entry(), {"name_bg": "Х"})
        self.assertNotIn("mean", json.dumps(row))
        self.assertEqual(row["n"], 6)

    def test_payload_carries_every_basis_and_the_accounting(self):
        p = pr.payload(self.entry(), {"name_bg": "Х"}, "t", "r", {})
        self.assertEqual(set(p["bases"]), set(pr.BASES))
        self.assertEqual(p["default_basis"], "story")
        self.assertEqual(p["accounting"]["eligible"], 6)

    def test_baseline_is_sum_and_count(self):
        b = pr.baseline(self.entry())
        self.assertEqual(b["n"], 6)
        self.assertAlmostEqual(b["sum"], round(sum(-0.8 + i / 10 for i in range(6)), 4))

    def test_page_names_cannot_collide_across_hyphenated_slugs(self):
        self.assertEqual(pr.page_name("ivan-ivanov", 1), "ivan-ivanov.json")
        self.assertEqual(pr.page_name("ivan-ivanov", 2), "ivan-ivanov.p2.json")
        self.assertNotEqual(pr.page_name("ivan-ivanov", 2),
                            pr.page_name("ivan-ivanov-2", 1))

    def test_co_subjects_count_other_eligible_subjects(self):
        rows = [article("a/1", [subject("p"), subject("q"),
                                {"name": "ГЕРБ", "kind": "party",
                                 "subject_role": "secondary"}])]
        co = pr.co_subjects(pr.collect(rows)["p"])
        self.assertEqual({(c["kind"], c["id"]) for c in co},
                         {("person", "q"), ("party", "ГЕРБ")})


class ShardWriter(unittest.TestCase):
    """`write_person_shards` — the guard, the refusal, the pruning."""

    def setUp(self):
        import build_app_data
        import person_identity_join as pij
        self.bad = build_app_data
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        gaz = {"entries": [{"kind": "person", "id": "mp-1", "canonical": "А Б В",
                            "display": {"roles": [{"role": "mp", "current": True}],
                                        "retired_slugs": ["a-b-v-old"]}}]}
        self.sources = pij.Sources(gazetteer_doc=gaz, cues={}, aliases={},
                                   audit={}, registry={})
        # The digest is a review artifact under REPO; point it at the temp dir.
        self._repo = build_app_data.REPO
        build_app_data.REPO = self.out
        self.addCleanup(setattr, build_app_data, "REPO", self._repo)

    def rows(self, n=5, pid="mp-1", **kw):
        return [article(f"a/{i}", [subject(pid, form_kind="full_name", **kw)],
                        story=f"s{i}") for i in range(n)]

    def write(self, rows):
        return self.bad.write_person_shards(self.out, {}, rows, "t",
                                            sources=self.sources, coverage_days={})

    def test_writes_the_page_the_index_the_baseline_and_redirects(self):
        stale = self.out / "person" / "gone.json"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text("{}")
        out = self.write(self.rows())
        self.assertEqual([r["id"] for r in out["rows"]], ["mp-1"])
        self.assertTrue((self.out / "person" / "mp-1.json").exists())
        self.assertFalse(stale.exists())
        index = json.loads((self.out / "persons.json").read_text())
        self.assertEqual(index["retired_ids"], {"a-b-v-old": "mp-1"})
        self.assertEqual(index["persons"][0]["role"], "mp")
        base = json.loads((self.out / "person_baselines.json").read_text())
        self.assertEqual(base["persons"]["mp-1"]["n"], 5)

    def test_an_unconfirmed_two_part_person_goes_to_the_digest(self):
        rows = [article(f"a/{i}", [subject("mp-1")], story=f"s{i}")
                for i in range(5)]
        out = self.write(rows)
        self.assertEqual(out["rows"], [])
        self.assertEqual(out["digest"][0]["id"], "mp-1")
        digest = json.loads((self.out / "news" / "review"
                             / "person_page_candidates.json").read_text())
        self.assertEqual(digest["items"][0]["id"], "mp-1")

    def test_a_surface_scoped_refusal_keeps_the_page(self):
        import person_identity_join as pij
        gaz = {"entries": [{"kind": "person", "id": "mp-1", "canonical": "А Б В"}]}
        for surfaces, published in ((["Б"], True), ([], False)):
            self.sources = pij.Sources(
                gazetteer_doc=gaz, cues={}, aliases={}, registry={},
                audit={"decisions": [{"id": "mp-1", "decision": "refused",
                                      "surfaces": surfaces}]})
            out = self.write(self.rows())
            self.assertEqual(bool(out["rows"]), published, surfaces)

    def test_refuses_a_shard_whose_accounting_does_not_check_out(self):
        real = pr.check_accounting
        try:
            pr.check_accounting = lambda entry: ["forced"]
            out = self.write(self.rows())
        finally:
            pr.check_accounting = real
        self.assertEqual(out["rows"], [])
        self.assertEqual(out["refused"][0]["id"], "mp-1")
        self.assertFalse((self.out / "person" / "mp-1.json").exists())

    def test_refuses_an_id_the_client_charset_would_not_serve(self):
        out = self.write(self.rows(pid="../etc"))
        self.assertEqual(out["rows"], [])
        self.assertEqual(out["refused"][0]["problems"], ["unsafe id"])


if __name__ == "__main__":
    unittest.main()
