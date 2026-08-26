#!/usr/bin/env python3
"""Tests for build_gold_set.py — what gets measured, and what must not.

⚠️ The gold set decides what every later number means. Two failures here are
worse than a bug: a set that inherits the corpus's 90% `not_applicable` skew
makes every agreement metric meaningless, and a stratum read as a label makes
the scores measure this file's regex instead of a model.

Run:  python3 news/scripts/test_build_gold_set.py
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_gold_set as bgs  # noqa: E402


class CellAssignment(unittest.TestCase):
    def cell(self, **rec):
        mentions = rec.pop("_mentions", [])
        base = {"content": "дума " * 200, "author": "Автор"}
        return bgs.cell_for({**base, **rec}, mentions)

    def test_an_empty_body_is_its_own_cell(self):
        # ⚠️ Distinct from `quality_short`: no body at all is the EXTRACTOR's
        # failure, a 200-character body is the article's.
        self.assertEqual(self.cell(content=""), "quality_no_body")
        self.assertEqual(self.cell(content="   \n "), "quality_no_body")

    def test_a_short_body_is_drawn_for_the_quality_gate(self):
        self.assertEqual(self.cell(content="кратко"), "quality_short")

    def test_russia_terms_need_a_THRESHOLD_not_a_mention(self):
        # ⚠️ One passing mention of Русия is most of the corpus. Three is a
        # signal that the axis is worth paying a frontier model to judge.
        body = "дума " * 200
        # ⚠️ The first version read `X if False else X` — a literal
        # tautology asserting a value equals itself.
        self.assertNotEqual(self.cell(content=body + " Русия "), "russia_dense")
        self.assertNotEqual(self.cell(content=body + " Русия Путин "),
                            "russia_dense")
        self.assertEqual(
            self.cell(content=body + " Русия Путин Украйна "), "russia_dense")

    def test_the_russia_pattern_does_not_match_inside_a_word(self):
        # „Прусия" is Prussia and „НАТОварен" is loaded — neither is a signal.
        body = "дума " * 200 + " Прусия Прусия Прусия "
        self.assertNotEqual(self.cell(content=body), "russia_dense")

    def test_it_matches_bulgarian_inflections(self):
        body = "дума " * 200 + " руската руски Русия "
        self.assertEqual(self.cell(content=body), "russia_dense")

    def test_it_reaches_the_UKRAINIAN_DEMONYM(self):
        # ⚠️ „Украйн[а-я]*" structurally cannot match украински / украинци —
        # the demonym stem is Украин-, with и, not й — so 44 genuine
        # Russia/Ukraine articles were excluded by a pattern that looked
        # complete. They are different words and both are needed.
        body = "дума " * 200 + " украински украинци украинската "
        self.assertEqual(self.cell(content=body), "russia_dense")

    def test_it_reaches_an_INFLECTED_санкции(self):
        body = "дума " * 200 + " санкциите санкции санкционен "
        self.assertEqual(self.cell(content=body), "russia_dense")

    def test_the_false_stems_stay_out(self):
        # Русе is a city, руса is blonde, русалка is a mermaid — 5 of the 50
        # shipped entries were a puppet-theatre obituary, two missing
        # sisters, a Danube water level and a petrol-price story.
        for word in ("Русе", "русенски", "руса", "русалка"):
            with self.subTest(word=word):
                body = "дума " * 200 + f" {word} {word} {word} "
                self.assertNotEqual(self.cell(content=body), "russia_dense")

    def test_entity_rich_needs_three_LINKED_mentions(self):
        linked = [{"kind": "place", "id": f"p{i}"} for i in range(3)]
        self.assertEqual(self.cell(_mentions=linked), "entity_rich")
        # ⚠️ Refused mentions do not count — an article of ambiguous names is
        # not an article rich in entities.
        refused = [{"kind": "person", "id": None} for _ in range(5)]
        self.assertNotEqual(self.cell(_mentions=refused), "entity_rich")

    def test_a_single_person_link_gets_its_own_cell(self):
        self.assertEqual(
            self.cell(_mentions=[{"kind": "person", "id": "dp-1"}]),
            "person_linked")

    def test_a_missing_byline_is_a_cell_of_last_resort(self):
        self.assertEqual(self.cell(author=""), "no_author")
        self.assertEqual(self.cell(author=None), "no_author")

    def test_everything_else_is_mainstream(self):
        self.assertEqual(self.cell(), "mainstream")

    def test_the_rare_cells_come_FIRST(self):
        # ⚠️ ORDER IS THE DESIGN. With `mainstream` first it would swallow
        # every Russia-dense and entity-rich article, and the gold set would
        # be a random sample wearing a stratified label.
        names = [name for name, _ in bgs.CELLS]
        # ⚠️ Asserting only `names[-1]` is satisfied by a list with
        # „mainstream" at BOTH ends — which is exactly the mutation that
        # swallows every rare cell. Uniqueness plus position is the rule.
        self.assertEqual(names.count("mainstream"), 1)
        self.assertEqual(names[-1], "mainstream")
        self.assertEqual(len(names), len(set(names)))
        self.assertLess(names.index("russia_dense"), names.index("no_author"))
        self.assertLess(names.index("quality_short"),
                        names.index("russia_dense"))

    def test_an_ordinary_looking_russia_article_is_NOT_mainstream(self):
        # The behavioural version of the rule above: a first-match-wins list
        # with „mainstream" ahead of the rare cells would draw this article
        # for „mainstream" and the gold set would inherit the corpus skew.
        body = "дума " * 200 + " Русия Путин Украйна "
        self.assertEqual(
            bgs.cell_for({"content": body, "author": "Автор"}, []),
            "russia_dense")

    def test_a_short_RUSSIA_article_is_drawn_for_the_gate(self):
        # The gate classes must win: measuring `too_short` needs short
        # articles, and a short Russia-dense one is still short.
        self.assertEqual(self.cell(content="Русия Путин Украйна"),
                         "quality_short")


class NonOutletDirectories(unittest.TestCase):
    def setUp(self):
        import tempfile
        self.root = Path(tempfile.mkdtemp())

    def test_a_directory_without_a_dot_is_not_an_outlet(self):
        # An outlet directory is named after a domain, so the dot is the real
        # discriminator — `analysis`, `gold` and `stories` have none.
        for name in ("analysis", "gold", "stories", "notes"):
            (self.root / name).mkdir()
            self.assertFalse(bgs.is_corpus_dir(self.root / name), name)
        (self.root / "dnevnik.bg").mkdir()
        self.assertTrue(bgs.is_corpus_dir(self.root / "dnevnik.bg"))

    def test_the_named_list_holds_even_WITH_a_dot(self):
        # ⚠️ The dot rule alone covers today's names; the list is what holds
        # when a future working directory is called `analysis.v2`. Tested
        # directly, because against only today's names the list is
        # unreachable and deleting it changes nothing a test can see.
        for name in bgs.NON_CORPUS_DIRS:
            (self.root / f"{name}.v2").mkdir()
            self.assertFalse(bgs.is_corpus_dir(self.root / f"{name}.v2"), name)

    def test_a_leading_underscore_is_still_refused(self):
        (self.root / "_quarantine.bg").mkdir()
        self.assertFalse(bgs.is_corpus_dir(self.root / "_quarantine.bg"))


class Determinism(unittest.TestCase):
    def test_the_same_seed_gives_the_same_order(self):
        # ⚠️ A HASH, not `random`: „why is this article in the gold set" has
        # to be answerable a year later on another machine, and a seeded
        # PRNG is only stable within one Python version.
        a = [bgs.rank_key(f"u{i}", "s") for i in range(20)]
        b = [bgs.rank_key(f"u{i}", "s") for i in range(20)]
        self.assertEqual(a, b)

    def test_a_different_seed_gives_a_different_order(self):
        a = sorted(range(50), key=lambda i: bgs.rank_key(f"u{i}", "one"))
        b = sorted(range(50), key=lambda i: bgs.rank_key(f"u{i}", "two"))
        self.assertNotEqual(a, b)


class TheBuiltSet(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp(prefix="gold_"))
        (self.root / "news" / "data" / "ex.bg").mkdir(parents=True)
        bgs.NEWS_DATA = self.root / "news" / "data"

    def write(self, name, **over):
        rec = {"url": f"https://ex.bg/{name}", "title": name,
               "content": "дума " * 200, "author": "Автор",
               "published": "2026-08-20T00:00:00+00:00"}
        rec.update(over)
        (self.root / "news" / "data" / "ex.bg" / f"{name}.json").write_text(
            json.dumps(rec, ensure_ascii=False), encoding="utf-8")

    def build(self, size=20, out=None):
        import argparse
        argv = sys.argv
        sys.argv = ["x", "--size", str(size), "--out",
                    str(out or self.root / "gold.json"), "--json"]
        try:
            bgs.main()
        finally:
            sys.argv = argv
        return json.loads((out or self.root / "gold.json").read_text(
            encoding="utf-8"))

    def test_every_article_records_WHY_it_was_drawn(self):
        # ⚠️ Asserting the KEY exists is satisfied by a hard-coded constant.
        # The value has to match the cell the article actually belongs to.
        for i in range(20):
            self.write(f"m{i}")
            self.write(f"s{i}", content="кратко")
            self.write(f"r{i}", content="дума " * 200 + " Русия Путин Украйна ")
        doc = self.build(size=60)
        drawn = {a["drawn_for"] for a in doc["articles"]}
        self.assertGreaterEqual(len(drawn), 3, drawn)
        for a in doc["articles"]:
            rec = json.loads((self.root / a["path"].replace(
                "news/data", "news/data")).read_text(encoding="utf-8"))
            self.assertEqual(a["drawn_for"], bgs.cell_for(rec, []))

    def test_no_article_carries_a_JUDGMENT(self):
        # ⚠️⚠️ The stratum is not a label. A gold-set entry carrying
        # `leaning` or `russia_stance` would let a scorer grade a model
        # against this file's regex instead of against a frontier model.
        for i in range(30):
            self.write(f"a{i}", content="дума " * 200 + " Русия Путин Украйна ")
        doc = self.build()
        forbidden = {"leaning", "russia_stance", "quality", "ai_generated",
                     "topics", "label", "verdict"}
        for a in doc["articles"]:
            self.assertEqual(set(a) & forbidden, set(), a)
        self.assertIn("never a judgment", doc["drawn_for_is_not_a_label"])

    def test_a_shortfall_is_REPORTED_not_topped_up(self):
        # ⚠️ A gold set that quietly refilled a rare cell from another would
        # be a random sample wearing a stratified label.
        for i in range(40):
            self.write(f"m{i}")          # all mainstream
        doc = self.build(size=100)
        self.assertIn("russia_dense", doc["shortfall"])
        self.assertEqual(doc["cells"]["russia_dense"]["taken"], 0)
        # …and nothing was substituted for it.
        drawn = {a["drawn_for"] for a in doc["articles"]}
        self.assertNotIn("russia_dense", drawn)

    def test_the_share_is_a_PREVALENCE_not_a_residual(self):
        # ⚠️ `corpus_share` counted what was LEFT after the earlier cells
        # took theirs, so person-linked read as 0.69% of the corpus when
        # 7.65% of articles carry a resolvable person — making the
        # oversampling look 11x more aggressive than it is (1.6x, not 17x)
        # and reporting an ordering artifact as scarcity.
        for i in range(20):
            self.write(f"a{i}", author="")           # no_author only
            self.write(f"b{i}", author="", content="дума " * 200 +
                       " Русия Путин Украйна ")      # russia AND no_author
        doc = self.build(size=40)
        na = doc["cells"]["no_author"]
        self.assertGreater(na["signal_prevalence"], na["residual_share"],
                           "prevalence must count every article carrying the "
                           "signal, not only those no earlier cell claimed")

    def test_each_cell_reports_its_corpus_share_beside_its_gold_share(self):
        # ⚠️ The oversampling is the POINT and must be visible: person-linked
        # articles are 0.7% of the corpus and 12% of the gold set, a 17x
        # distortion that a reader has to be able to see.
        for i in range(50):
            self.write(f"a{i}")
        doc = self.build()
        for cell in doc["cells"].values():
            self.assertIn("residual_share", cell)
            self.assertIn("signal_prevalence", cell)
            self.assertIn("gold_share", cell)
            self.assertIn("why", cell)

    def test_the_size_changes_the_size_and_not_the_SHAPE(self):
        for i in range(60):
            self.write(f"a{i}")
            self.write(f"r{i}", content="дума " * 200 + " Русия Путин Украйна ")
        small = self.build(size=20, out=self.root / "s.json")
        big = self.build(size=60, out=self.root / "b.json")
        self.assertGreater(big["actual_size"], small["actual_size"])
        for name in ("russia_dense", "mainstream"):
            self.assertAlmostEqual(small["cells"][name]["gold_share"],
                                   big["cells"][name]["gold_share"], places=2)

    def test_the_cells_are_NOT_equally_weighted(self):
        # ⚠️ Comparing one build's gold_share against another's is
        # self-referential — both read the same TARGET_SHARE table, so
        # flattening it to an equal share everywhere leaves the test green
        # and the gold set unstratified, which is the whole defect.
        shares = bgs.TARGET_SHARE
        self.assertAlmostEqual(sum(shares.values()), 1.0, places=2)
        self.assertGreater(len(set(shares.values())), 3,
                           "every cell has the same weight — the set is not "
                           "stratified, it is a random sample with labels")
        self.assertGreater(shares["russia_dense"], shares["no_author"])

    def test_the_draw_uses_the_seeded_ORDER(self):
        # ⚠️ The Determinism class tests rank_key in ISOLATION and never
        # checks that main() calls it — with the sort deleted, the draw falls
        # back to directory order and one outlet dominates every cell.
        for d in ("a.bg", "b.bg", "c.bg"):
            (self.root / "news" / "data" / d).mkdir(exist_ok=True)
            for i in range(20):
                (self.root / "news" / "data" / d / f"x{i}.json").write_text(
                    json.dumps({"url": f"https://{d}/x{i}", "title": "t",
                                "content": "дума " * 200, "author": "A"}),
                    encoding="utf-8")
        doc = self.build(size=30, out=self.root / "d.json")
        outlets = {a["domain"] for a in doc["articles"]}
        self.assertGreaterEqual(
            len(outlets), 3,
            "the draw collapsed onto one outlet — is the hash sort still "
            f"applied? got {outlets}")

    def test_non_outlet_directories_are_skipped(self):
        # ⚠️ `analysis/` holds an index of the articles we have already
        # JUDGED and `gold/` holds this file's own output — neither starts
        # with an underscore, so the „skip _dirs" rule let the selector draw
        # its own predecessor into the pool and inflate `corpus_scanned`,
        # the denominator of every published share.
        for name in ("analysis", "gold", "stories"):
            d = self.root / "news" / "data" / name
            d.mkdir(exist_ok=True)
            (d / "index.json").write_text(
                json.dumps({"url": f"https://x/{name}", "content": "x" * 900}),
                encoding="utf-8")
        for i in range(10):
            self.write(f"a{i}")
        doc = self.build()
        self.assertEqual(doc["corpus_scanned"], 10)
        self.assertFalse([a for a in doc["articles"]
                          if a["domain"] in ("analysis", "gold", "stories")])

    def test_working_directories_are_skipped(self):
        # `_quarantine` holds records we REJECTED; grading a model on them
        # would measure the extractor's rejects.
        (self.root / "news" / "data" / "_quarantine").mkdir()
        (self.root / "news" / "data" / "_quarantine" / "bad.json").write_text(
            json.dumps({"url": "https://x/bad", "content": "x" * 900}),
            encoding="utf-8")
        for i in range(10):
            self.write(f"a{i}")
        doc = self.build()
        self.assertEqual(doc["corpus_scanned"], 10)

    def test_an_empty_corpus_is_an_ERROR_not_an_empty_set(self):
        # ⚠️ A gold set of zero articles that exits 0 would be „measured" as
        # 100% agreement on everything.
        argv = sys.argv
        sys.argv = ["x", "--size", "10", "--out", str(self.root / "g.json")]
        try:
            (self.root / "news" / "data" / "ex.bg").rmdir()
            self.assertEqual(bgs.main(), 2)
        finally:
            sys.argv = argv


if __name__ == "__main__":
    unittest.main()
