#!/usr/bin/env python3
"""Plan T2.0 — the frozen labelling universe. Every gate fails closed: an
empty window, an empty named stratum and a frame with no publishable article
refuse to write; copies and story members never straddle the split; the
story id is read from the index, not only the record; nothing is labelled."""
import copy
import io
import json
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import freeze_event_universe as feu  # noqa: E402

BI = {"bg": "б", "en": "b"}
REGISTRY = {"version": 1, "cases": [{
    "slug": "petrohan", "name": BI, "opened_on": "2026-02-13", "rule_version": 1,
    "reviewer": "t", "reviewed_on": "2026-09-22", "description": BI,
    "sources": [{"claim": BI, "url": "https://x/1", "domain": "x", "published": "2026-09-20"}],
    "contested": [], "namesakes": [], "auto_attach": True, "ambiguous_match": "review",
    "overrides": {"include": [], "exclude": []}, "history": [],
    "rule": {"basis": BI, "required_terms": ["петрохан"], "context_terms": ["прокуратур"],
             "excluded_terms": []}}]}

WIRE = ("Георги Кандев, бивш главен секретар на МВР и настоящ кандидат за вицепрезидент, "
        "заяви пред радио Дарик, че Огнян Атанасов, т.нар. Петричкия Ескобар, продължава да се "
        "занимава с наркотрафик. Атанасов бе помилван от вицепрезидентката през 2022 г., защото "
        "имало опасност за живота му. Според медицинската експертиза той има онкологично "
        "заболяване, перитонит, деменция и инсулт. Всъщност Атанасов не е лежал в български "
        "затвор, а е преведен от гръцки, където е получил петнадесет години за наркотрафик. "
        "В момента той е на свобода под парична гаранция по дело за пет килограма кокаин, "
        "което още не е приключило. В социалните мрежи се появи видео как танцува.")


class Harness(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="universe_")
        self.root = Path(self.tmp.name)
        self.data = self.root / "news" / "data"
        (self.data / "analysis" / "articles").mkdir(parents=True)
        (self.data / "analysis" / "stories").mkdir(parents=True)
        self.cases = self.root / "cases.json"
        self.cases.write_text(json.dumps(REGISTRY, ensure_ascii=False), encoding="utf-8")
        self.index = {"version": 1, "stories": {}, "articles": {}}

    def tearDown(self):
        self.tmp.cleanup()

    def article(self, domain, slug, title, content, published, *, analysed=True,
                category="government", ok=True, relevant=True, story_id=None,
                action="new_story", people=()):
        (self.data / domain).mkdir(exist_ok=True)
        url = f"https://{domain}/{slug}"
        art = {"url": url, "domain": domain, "title": title, "content": content,
               "published": published}
        (self.data / domain / f"{slug}.json").write_text(json.dumps(art, ensure_ascii=False), encoding="utf-8")
        if not analysed:
            return url
        rec = {"url": url, "domain": domain, "published": published, "analyzed_at": published,
               "model": "m", "taxonomy_version": 2, "prompt_hashes": {},
               "quality": {"verdict": "ok" if ok else "too_short", "notes": ""},
               "site_relevant": relevant, "summary_bg": title, "summary_en": title,
               "topics": [{"category": category, "subcategory": None, "primary": True}],
               "entities": {"people": list(people), "parties": [], "institutions": [],
                            "companies": [], "places": []},
               "story": {"action": action, "canonical_title_bg": title,
                         **({"story_id": story_id, "merge_basis": {"by": "same_event_evidence"}}
                            if action == "same_story" else {})}}
        (self.data / "analysis" / "articles" / domain).mkdir(exist_ok=True)
        (self.data / "analysis" / "articles" / domain / f"{slug}.json").write_text(
            json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        if story_id and relevant and ok:
            # ⚠️ Like the pipeline: a `new_story` record does NOT carry the id;
            # only the index does.
            self.index["articles"][url] = {"story_id": story_id, "domain": domain}
            st = self.index["stories"].setdefault(story_id, {
                "title_bg": title, "title_en": title, "first_published": published,
                "last_published": published, "member_count": 0, "topics": [],
                "entities": {"people": list(people)}})
            st["member_count"] += 1
            st["first_published"] = min(st["first_published"], published)
            st["last_published"] = max(st["last_published"], published)
            path = self.data / "analysis" / "stories" / f"{story_id}.json"
            story = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {
                "id": story_id, "members": []}
            story["members"].append({"domain": domain, "url": url, "published": published})
            path.write_text(json.dumps(story, ensure_ascii=False), encoding="utf-8")
        return url

    def seed_full(self):
        # Petrohan, presidential, local, foreign and a shared person across two stories.
        self.article("a.bg", "p1", "Делото Петрохан", "Прокуратурата по Петрохан. Петрохан отново. " * 5,
                     "2026-09-18T09:00:00+00:00", category="judiciary", story_id="s-pet", people=["Иван Иванов"])
        self.article("b.bg", "p2", "Делото Петрохан в съда", "Прокуратурата по Петрохан продължава. " * 5,
                     "2026-09-18T10:00:00+00:00", category="judiciary", story_id="s-pet",
                     action="same_story", people=["Иван Иванов"])
        # Names the Petrohan story's person in a DIFFERENT development — the
        # same-person PAIR the stratum exists for (weak title overlap, a shared
        # participant among the entity hits).
        self.article("a.bg", "e1", "Кампанията на кандидата", "Кандидатът Иван Иванов откри кампания. " * 5,
                     "2026-09-19T09:00:00+00:00", category="elections-presidential", story_id="s-pres",
                     people=["Иван Иванов"])
        self.article("c.bg", "l1", "Общински съвет Враца", "Общинският съвет заседава. " * 5,
                     "2026-09-19T12:00:00+00:00", category="local-news", story_id="s-loc")
        self.article("c.bg", "f1", "Срещата в Брюксел", "Министрите се срещнаха в Брюксел. " * 5,
                     "2026-09-20T12:00:00+00:00", category="foreign-policy", story_id="s-for")
        # A wire copy under two mastheads, one day apart — one unit.
        self.article("a.bg", "w1", "Кандев за Атанасов", WIRE, "2026-09-20T20:00:00+00:00", story_id="s-w1")
        self.article("d.bg", "w2", "Кандев: Атанасов действа", WIRE, "2026-09-21T06:00:00+00:00", story_id="s-w2")
        # Excluded and unanalysed rows are IN the universe, gated out.
        self.article("a.bg", "x1", "Кратък текст", "малко", "2026-09-21T09:00:00+00:00", ok=False)
        self.article("a.bg", "x2", "Неанализирана", "Текст без анализ. " * 5, "2026-09-21T10:00:00+00:00", analysed=False)
        (self.data / "analysis" / "index.json").write_text(json.dumps(self.index, ensure_ascii=False), encoding="utf-8")

    def build(self, since="2026-09-15", until="2026-09-21", test_share=0.3):
        return feu.build_universe(
            data_dir=self.data, analysis_dir=self.data / "analysis",
            since=date.fromisoformat(since), until=date.fromisoformat(until),
            test_share=test_share, cases_path=self.cases, generated_at="2026-09-22T00:00:00+00:00")


class TheFreeze(Harness):
    def test_the_recount_reads_the_story_id_from_the_index_for_new_story_records(self):
        # ⚠️ THE MUTATION THIS CATCHES: reading `story.story_id` off the record
        # only — a `new_story` record carries none, so the recount reported
        # 225 stories over 2,353 publishable articles on the first cut.
        self.seed_full()
        u = self.build()
        self.assertEqual(u["counts"]["publishable"], 7)
        self.assertEqual(u["counts"]["stories"], 6)
        self.assertEqual(u["counts"]["singleton_stories"], 5)
        self.assertEqual(u["counts"]["multi_outlet_stories"], 1)
        self.assertEqual(u["counts"]["story_action"], {"new_story": 7, "same_story": 1})
        self.assertEqual(u["counts"]["same_story_by"], {"same_event_evidence": 1})
        # The wire copy was filed under two stories — measured, not inferred.
        self.assertEqual(u["counts"]["copy_groups_split_across_stories"], 1)
        # The gate is frozen per record, and excluded/unanalysed rows are in
        # the frame — the universe is the corpus, not the release.
        self.assertEqual(u["counts"]["raw_articles"], 9)
        self.assertEqual(u["counts"]["analysed"], 8)
        by_id = {a["id"]: a for a in u["articles"]}
        self.assertFalse(by_id["a.bg/x1"]["analysis"]["publishable"])
        self.assertIsNone(by_id["a.bg/x2"]["analysis"])

    def test_copies_and_story_members_share_a_unit_and_never_straddle_the_split(self):
        self.seed_full()
        u = self.build(test_share=0.3)
        by_id = {a["id"]: a for a in u["articles"]}
        # The wire copy: two mastheads, two story ids, one day apart — one unit.
        self.assertEqual(by_id["a.bg/w1"]["copy_group"], by_id["d.bg/w2"]["copy_group"])
        self.assertEqual(by_id["a.bg/w1"]["unit"], by_id["d.bg/w2"]["unit"])
        self.assertEqual(by_id["a.bg/w1"]["split"], by_id["d.bg/w2"]["split"])
        # Story members: one unit.
        self.assertEqual(by_id["a.bg/p1"]["unit"], by_id["b.bg/p2"]["unit"])
        self.assertEqual(by_id["a.bg/p1"]["split"], by_id["b.bg/p2"]["split"])
        # Independent reports are NOT copies.
        self.assertNotEqual(by_id["a.bg/p1"]["copy_group"], by_id["b.bg/p2"]["copy_group"])
        self.assertEqual(u["split"]["copy_groups_multi"], 1)
        # Time-ordered over UNITS: a dev unit's EARLIEST article precedes the
        # boundary (a later copy of it may fall on the boundary day — that is
        # the unit staying whole, not a leak).
        boundary = u["split"]["boundary_day"]
        earliest = {}
        for a in u["articles"]:
            earliest[a["unit"]] = min(earliest.get(a["unit"], "9999"), a["published"][:10])
        for a in u["articles"]:
            if a["split"] == "dev":
                self.assertLess(earliest[a["unit"]], boundary)
            else:
                self.assertGreaterEqual(earliest[a["unit"]], boundary)
        self.assertEqual(by_id["d.bg/w2"]["split"], "dev")
        self.assertEqual(by_id["d.bg/w2"]["published"][:10], boundary)

    def test_the_split_is_over_units_and_deterministic(self):
        self.seed_full()
        first = self.build()
        second = self.build()
        self.assertEqual({a["id"]: a["split"] for a in first["articles"]},
                         {a["id"]: a["split"] for a in second["articles"]})
        self.assertEqual(first["split"]["units"]["dev"] + first["split"]["units"]["test"],
                         len({a["unit"] for a in first["articles"]}))
        # The artifact explains its own boundary.
        self.assertAlmostEqual(first["split"]["unit_test_share"],
                               first["split"]["units"]["test"] / (first["split"]["units"]["dev"] + first["split"]["units"]["test"]))
        self.assertEqual(sum(first["split"]["units_by_earliest_day"].values()),
                         first["split"]["units"]["dev"] + first["split"]["units"]["test"])

    def test_the_strata_are_counted_and_nothing_is_labelled(self):
        self.seed_full()
        u = self.build()
        self.assertEqual(u["strata"]["raw"], {"petrohan": 2, "presidential": 1, "local_news": 1,
                                              "foreign": 1})
        self.assertEqual(u["strata"]["publishable"], u["strata"]["raw"])
        # same_person is a PAIR stratum: e1 (Иван Иванов, presidential) against
        # the Petrohan story it does not belong to — weak title overlap, a
        # shared person among the entity hits.
        self.assertGreaterEqual(u["strata"]["pairs"]["same_person"], 1)
        sp = [p for p in u["candidate_pairs"] if p["same_person"]]
        self.assertTrue(all(not p["strong"] for p in sp))
        self.assertTrue(u["candidate_pairs"])
        self.assertTrue(all(p["label"] is None for p in u["candidate_pairs"]))
        self.assertEqual(u["adjudication"]["labelled"], 0)
        self.assertIn("UNMET", u["adjudication"]["note"])

    def test_the_baseline_reruns_retrieval_against_stories_that_existed_before_the_article(self):
        self.seed_full()
        u = self.build()
        by_article = {}
        for p in u["candidate_pairs"]:
            by_article.setdefault(p["article_id"], []).append(p)
        # p2 (b.bg) sees p1's story (a.bg, earlier, two shared title tokens):
        # strong AND cross-outlet.
        hits = [p for p in by_article.get("b.bg/p2", []) if p["story_id"] == "s-pet"]
        self.assertEqual(hits, [], "an article's OWN story is never its candidate")
        # w2 (d.bg) published after w1 (a.bg) sees s-w1: strong (Кандев, Атанасов),
        # cross-outlet — and it is w1's COPY TWIN, which the baseline can exclude.
        w2 = [p for p in by_article.get("d.bg/w2", []) if p["story_id"] == "s-w1"]
        self.assertEqual({p["arm"] for p in w2}, {"analysis_side", "raw"})
        self.assertTrue(all(p["strong"] and p["cross_outlet"] and p["copy_twin"] for p in w2))
        # w1 was published BEFORE w2, so s-w2 is not in its population.
        self.assertEqual([p for p in by_article.get("a.bg/w1", []) if p["story_id"] == "s-w2"], [])
        b = u["baseline"]
        self.assertEqual(b["publishable_articles"], 7)
        for arm in ("analysis_side", "raw"):
            arm_b = b["arms"][arm]
            self.assertGreaterEqual(arm_b["with_strong_cross_outlet_candidate"], 1)
            self.assertLessEqual(arm_b["singletons_with_strong_cross_outlet_candidate"],
                                 arm_b["with_strong_cross_outlet_candidate"])
            self.assertLess(arm_b["with_strong_cross_outlet_candidate_excluding_copy_twins"],
                            arm_b["with_strong_cross_outlet_candidate"])
        self.assertEqual(b["prior_2026_09_02"]["arm"], "analysis_side")

    def test_cross_outlet_is_judged_over_members_before_the_article(self):
        # ⚠️ THE MUTATION THIS CATCHES: reading the story's FULL frozen
        # membership. s-late gains a b.bg member AFTER the b.bg probe was
        # published; at probe time it was a.bg-only, so the pair is cross-outlet.
        self.article("a.bg", "l0", "Общински съвет Враца заседава", "Общинският съвет заседава днес. " * 5,
                     "2026-09-19T08:00:00+00:00", category="local-news", story_id="s-late")
        self.article("b.bg", "probe", "Общински съвет Враца гласува", "Общинският съвет гласува. " * 5,
                     "2026-09-19T10:00:00+00:00", category="local-news", story_id="s-probe")
        self.article("b.bg", "l2", "Общински съвет Враца прие", "Общинският съвет прие бюджета. " * 5,
                     "2026-09-19T12:00:00+00:00", category="local-news", story_id="s-late", action="same_story")
        self.seed_full()
        u = self.build()
        pair = [p for p in u["candidate_pairs"] if p["article_id"] == "b.bg/probe"
                and p["story_id"] == "s-late" and p["arm"] == "raw"]
        self.assertEqual(len(pair), 1)
        self.assertTrue(pair[0]["cross_outlet"])

    def test_a_candidate_pair_across_the_boundary_is_stamped_and_excluded_from_test(self):
        # ⚠️ THE CLAIM THIS SCOPES: units keep KNOWN pairs together; a
        # candidate pair can straddle, and the first freeze had 2,788 of them.
        # A dev story (09-19) with a test-day (09-21) candidate article.
        self.article("a.bg", "d1", "Съдът отложи делото за Петрохан", "Съдът отложи заседанието по делото. " * 5,
                     "2026-09-19T08:00:00+00:00", category="judiciary", story_id="s-dev")
        self.article("b.bg", "t1", "Делото за Петрохан: съдът отложи", "Прокуратурата поиска отлагане. " * 5,
                     "2026-09-21T08:00:00+00:00", category="judiciary", story_id="s-t1")
        self.seed_full()
        u = self.build()
        by_id = {a["id"]: a for a in u["articles"]}
        self.assertEqual(by_id["a.bg/d1"]["split"], "dev")
        self.assertEqual(by_id["b.bg/t1"]["split"], "test")
        pairs = [p for p in u["candidate_pairs"] if p["article_id"] == "b.bg/t1" and p["story_id"] == "s-dev"]
        self.assertTrue(pairs)
        for p in pairs:
            self.assertTrue(p["straddles"])
            self.assertEqual(p["adjudicable_split"], "excluded")
        self.assertGreaterEqual(u["split"]["straddling_pairs"], len(pairs))
        self.assertEqual(u["split"]["straddling_pairs"] + u["split"].get("adjudicable_dev", 0)
                         + u["split"].get("adjudicable_test", 0), len(u["candidate_pairs"]))
        self.assertEqual(u["adjudication"]["adjudicable_test_pairs"], u["split"].get("adjudicable_test", 0))
        # A non-straddling pair keeps its article's split.
        same = [p for p in u["candidate_pairs"] if not p["straddles"]]
        self.assertTrue(all(p["adjudicable_split"] == by_id[p["article_id"]]["split"] for p in same))

    def test_the_summary_carries_the_counts_and_the_manifest_hash_but_not_the_rows(self):
        self.seed_full()
        u = self.build()
        summary = feu.summary_of(u, self.root / "m.json", "sha")
        self.assertNotIn("articles", summary)
        self.assertNotIn("candidate_pairs", summary)
        self.assertEqual(summary["counts"], u["counts"])
        self.assertEqual(summary["manifest"]["sha256"], "sha")
        self.assertEqual(summary["manifest"]["articles"], len(u["articles"]))


class FailsClosed(Harness):
    def test_an_empty_window_refuses(self):
        self.seed_full()
        with self.assertRaisesRegex(ValueError, "no articles"):
            self.build(since="2025-01-01", until="2025-01-02")

    def test_an_empty_named_stratum_refuses(self):
        # ⚠️ THE MUTATION THIS CATCHES: writing a frame that cannot test one
        # of the plan's named strata — a later gate over it passes vacuously.
        self.seed_full()
        (self.data / "c.bg" / "f1.json").unlink()
        with self.assertRaisesRegex(ValueError, "foreign"):
            self.build()

    def test_an_empty_same_person_pair_stratum_refuses(self):
        self.seed_full()
        # Strip every person from every analysis record: no pair can be a
        # same-person pair, and the frame must refuse rather than count 0.
        for path in (self.data / "analysis" / "articles").glob("*/*.json"):
            rec = json.loads(path.read_text(encoding="utf-8"))
            rec["entities"]["people"] = []
            path.write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")
        for sid, st in self.index["stories"].items():
            st["entities"]["people"] = []
        (self.data / "analysis" / "index.json").write_text(json.dumps(self.index, ensure_ascii=False), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "same_person"):
            self.build()

    def test_a_missing_index_refuses_with_its_own_diagnosis(self):
        # ⚠️ THE MUTATION THIS CATCHES: treating a missing index as empty —
        # every new_story record then has no story id and the operator is
        # told the STRATA are empty, pointing at the window, not the file.
        self.seed_full()
        (self.data / "analysis" / "index.json").unlink()
        with self.assertRaisesRegex(ValueError, "index.json is missing"):
            self.build()

    def test_an_already_frozen_stamp_is_never_overwritten(self):
        self.seed_full()
        u = self.build()
        feu.write_freeze(u, "s1", self.root / "_universe")
        with self.assertRaisesRegex(ValueError, "already frozen"):
            feu.write_freeze(u, "s1", self.root / "_universe")

    def test_main_refuses_an_open_day_and_an_existing_report_and_records_both_outputs(self):
        self.seed_full()
        now = datetime(2026, 9, 21, 23, 0, tzinfo=timezone.utc)
        reports = self.root / "evals"
        reports.mkdir()
        argv = ["--data-dir", str(self.data), "--days", "7"]

        def run(extra):
            out = io.StringIO()
            with redirect_stdout(out):
                code = feu.main(argv + extra, now=now, freeze_dir=self.root / "_universe",
                                report_dir=reports, cases_path=self.cases)
            return code, json.loads(out.getvalue().strip().splitlines()[-1])

        # The window's last day is still being ingested: refused, named.
        code, payload = run(["--until", "2026-09-21"])
        self.assertEqual((code, payload["error"]), (1, "universe_refused"))
        self.assertIn("not over", payload["message"])
        # Allowed explicitly — and RECORDED in both outputs.
        code, payload = run(["--until", "2026-09-21", "--allow-open-day", "--stamp", "s1"])
        self.assertEqual(code, 0, payload)
        report = json.loads((reports / "event_universe_2026-09-21_7d.json").read_text(encoding="utf-8"))
        self.assertTrue(report["window"]["open_day"])
        manifest = json.loads((self.root / "_universe" / "s1" / "universe.json").read_text(encoding="utf-8"))
        self.assertTrue(manifest["window"]["open_day"])
        self.assertEqual(report["manifest"]["sha256"],
                         __import__("hashlib").sha256((self.root / "_universe" / "s1" / "universe.json").read_bytes()).hexdigest())
        # A committed report is not silently replaced.
        code, payload = run(["--until", "2026-09-21", "--allow-open-day", "--stamp", "s2"])
        self.assertEqual((code, payload["error"]), (1, "universe_refused"))
        self.assertIn("--force", payload["message"])
        code, payload = run(["--until", "2026-09-21", "--allow-open-day", "--stamp", "s2", "--force"])
        self.assertEqual(code, 0, payload)

    def test_a_window_with_no_publishable_article_refuses(self):
        self.article("a.bg", "x1", "Кратък", "малко", "2026-09-21T09:00:00+00:00", ok=False)
        (self.data / "analysis" / "index.json").write_text(json.dumps(self.index), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "no publishable"):
            self.build()


class PureRules(unittest.TestCase):
    def test_copy_detection_folds_the_wire_and_keeps_independent_reports_apart(self):
        arts = [
            {"id": "a", "content_sha256": "1", "content_chars": 300, "_content": WIRE},
            {"id": "b", "content_sha256": "2", "content_chars": 300,
             "_content": WIRE + "Снимка: БГНЕС. Още по темата четете тук."},
            {"id": "c", "content_sha256": "3", "content_chars": 300,
             "_content": "Прокуратурата представи експертиза по случая Петрохан пред медиите. " * 6},
            {"id": "d", "content_sha256": "1", "content_chars": 300, "_content": WIRE},
        ]
        groups = feu.copy_groups(arts)
        self.assertEqual(groups["a"], groups["b"])
        self.assertEqual(groups["a"], groups["d"])
        self.assertNotEqual(groups["a"], groups["c"])

    def test_split_boundary_is_the_day_closest_to_the_requested_unit_share(self):
        arts = [{"id": f"u{i}", "published": f"2026-09-{10 + i:02d}T00:00:00+00:00"} for i in range(10)]
        units = {a["id"]: a["id"] for a in arts}
        split, boundary, by_day = feu.split_by_time(arts, units, 0.3)
        self.assertEqual(boundary, "2026-09-17")
        self.assertEqual(sum(1 for v in split.values() if v == "test"), 3)
        self.assertEqual(sum(by_day.values()), 10)
        # A unit straddling the boundary is assigned by its EARLIEST day.
        units["u9"] = "u0"
        split, boundary, by_day = feu.split_by_time(arts, units, 0.3)
        self.assertEqual(split["u9"], split["u0"])
        self.assertEqual(split["u9"], "dev")

    def test_the_publication_gate_is_both_halves(self):
        self.assertTrue(feu.publishable({"quality": {"verdict": "ok"}, "site_relevant": True}))
        self.assertFalse(feu.publishable({"quality": {"verdict": "ok"}, "site_relevant": False}))
        self.assertFalse(feu.publishable({"quality": {"verdict": "too_short"}, "site_relevant": True}))
        self.assertFalse(feu.publishable(None))

    def test_freeze_analysis_prefers_the_record_id_and_falls_back_to_the_index(self):
        rec = {"story": {"action": "same_story", "story_id": "r"}, "quality": {"verdict": "ok"},
               "site_relevant": True, "topics": [], "entities": {}}
        self.assertEqual(feu.freeze_analysis(rec, {"story_id": "i"})["story_id"], "r")
        rec2 = copy.deepcopy(rec); rec2["story"] = {"action": "new_story"}
        self.assertEqual(feu.freeze_analysis(rec2, {"story_id": "i"})["story_id"], "i")
        self.assertIsNone(feu.freeze_analysis(rec2, None)["story_id"])


if __name__ == "__main__":
    unittest.main()
