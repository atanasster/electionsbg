#!/usr/bin/env python3
"""Plan T3.1 — taxonomy v2: `elections-presidential` and its paired fixtures.

⚠️ THE FIXTURES ARE THE CONTRACT A CLASSIFIER IS HELD TO, so this file checks
that the contract itself is sound: every pair has a positive AND a negative,
every negative is a real trap (it names the person or term that would route
it into the election) and forbids the presidential category, every expected
pair exists in the taxonomy, and the required negatives — a pardon, a
government-formation consultation, a Йотова mention, a Радев mention — are
all present. An empty fixture file passes nothing here.

It does NOT score a model: that is T3.2's reclassification run.
"""
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import analyze_articles as aa  # noqa: E402
import build_prompts as bp  # noqa: E402

TOPICS = ROOT / "news" / "topics.json"
FIXTURES = ROOT / "news" / "evals" / "taxonomy_v2_fixtures.json"
RUBRIC = ROOT / "news" / "prompts" / "analyze_system.source.md"
PRES = "elections-presidential"
PRES_SUBS = {"campaign", "candidates", "debates", "results", "cik-administration"}


def taxonomy():
    return json.loads(TOPICS.read_text(encoding="utf-8"))


def pairs_of(doc) -> set:
    return {(c["id"], s["id"]) for c in doc["categories"]
            for s in c.get("subcategories") or []}


class TaxonomyV2(unittest.TestCase):
    def test_presidential_is_its_own_category_with_the_five_subcategories(self):
        doc = taxonomy()
        self.assertEqual(doc["version"], 2)
        ids = [c["id"] for c in doc["categories"]]
        self.assertIn(PRES, ids)
        self.assertIn("elections-parliamentary", ids)
        cat = next(c for c in doc["categories"] if c["id"] == PRES)
        self.assertEqual({s["id"] for s in cat["subcategories"]}, PRES_SUBS)
        # A category of its OWN — not a subcategory of the parliamentary one.
        parl = next(c for c in doc["categories"] if c["id"] == "elections-parliamentary")
        self.assertNotIn("presidential", {s["id"] for s in parl["subcategories"]})

    def test_the_validator_accepts_v2_and_keys_subcategories_per_category(self):
        # ⚠️ THE MUTATION THIS CATCHES: a global „subcategory id used twice"
        # rule, which would refuse `campaign` under both election categories
        # and fail every save the moment v2 shipped.
        tax, cats = aa.load_taxonomy()
        self.assertEqual(tax["version"], 2)
        self.assertEqual(set(cats[PRES]["subcategories_map"]), PRES_SUBS)
        self.assertIn("campaign", cats["elections-parliamentary"]["subcategories_map"])

    def test_a_duplicate_WITHIN_a_category_is_still_refused(self):
        doc = taxonomy()
        cat = next(c for c in doc["categories"] if c["id"] == PRES)
        cat["subcategories"].append(dict(cat["subcategories"][0]))
        with tempfile.NamedTemporaryFile("w", suffix=".json", encoding="utf-8",
                                         delete=False) as fh:
            json.dump(doc, fh, ensure_ascii=False)
        tmp = Path(fh.name)
        try:
            original = aa.TOPICS_PATH
            aa.TOPICS_PATH = str(tmp)
            with self.assertRaisesRegex(ValueError, "subcategory id used twice"):
                aa.load_taxonomy()
        finally:
            aa.TOPICS_PATH = original
            tmp.unlink(missing_ok=True)

    def test_the_rubric_states_the_rule_the_fixtures_encode(self):
        rubric = RUBRIC.read_text(encoding="utf-8")
        self.assertIn("elections-presidential", rubric)
        for term in ("Помилване", "консултации", "Йотова", "Радев"):
            self.assertIn(term, rubric)

    def test_the_prompt_assets_are_regenerated(self):
        # The real gate — all four generated assets, byte-exact — plus one
        # direct check so a failure names the category.
        self.assertEqual(bp.write(check=True), 0,
                         "prompt assets are stale — run news/scripts/build_prompts.py")
        compact = json.loads((ROOT / "news/prompts/taxonomy_compact.json")
                             .read_text(encoding="utf-8"))
        self.assertEqual(compact["version"], 2)
        self.assertIn(PRES, {c["id"] for c in compact["categories"]})

    def test_the_three_shared_subcategory_ids_exist_under_both_election_categories(self):
        # The fact the per-category uniqueness rule cites; a rename on one
        # side would make that comment false with nothing red.
        _, cats = aa.load_taxonomy()
        for sid in ("campaign", "results", "cik-administration"):
            with self.subTest(sid=sid):
                self.assertIn(sid, cats["elections-parliamentary"]["subcategories_map"])
                self.assertIn(sid, cats[PRES]["subcategories_map"])


class PairedFixtures(unittest.TestCase):
    def setUp(self):
        self.doc = taxonomy()
        self.pairs = pairs_of(self.doc)
        self.fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))

    def test_fixtures_are_pinned_to_the_taxonomy_they_label_for(self):
        self.assertEqual(self.fixtures["taxonomy_version"], self.doc["version"])
        # The scoring contract is stated, not inferred by T3.2.
        self.assertEqual(self.fixtures["negatives_scored_on"], "forbidden_category")
        # ⚠️ Fails closed: an empty pair list is not a passing contract.
        self.assertGreaterEqual(len(self.fixtures["pairs"]), 4)

    def test_every_pair_has_a_positive_and_a_trapped_negative(self):
        for pair in self.fixtures["pairs"]:
            with self.subTest(pair=pair["id"]):
                pos, neg = pair["positive"], pair["negative"]
                self.assertEqual(pos["expected"]["category"], PRES)
                self.assertIn(pos["expected"]["subcategory"], PRES_SUBS)
                self.assertNotEqual(neg["expected"]["category"], PRES)
                self.assertEqual(neg.get("forbidden_category"), PRES)
                # The negative must be a TRAP: it names what would route it
                # into the election, and that name is in its own text.
                self.assertTrue(neg["mentions"], "a negative with no trap")
                # The full last token, as the author wrote it (an inflected
                # form is fine — it is a substring match, not a stem cut).
                text = (neg["title"] + " " + neg["lede"]).lower()
                for mention in neg["mentions"]:
                    self.assertIn(mention.split()[-1].lower(), text,
                                  f"{pair['id']}: {mention!r} is not in the text")
                for side in (pos, neg):
                    self.assertIn((side["expected"]["category"],
                                   side["expected"]["subcategory"]), self.pairs)

    def test_the_required_negatives_are_all_present(self):
        text_of = lambda f: (f["title"] + " " + f["lede"] + " " + " ".join(f["mentions"])).lower()  # noqa: E731
        negatives = [p["negative"] for p in self.fixtures["pairs"]]
        required = {
            "a pardon": lambda t: "помилв" in t,
            "a government-formation consultation": lambda t: "консултации" in t and "мандат" in t,
            "a Йотова mention": lambda t: "йотова" in t,
            "a Радев mention": lambda t: "радев" in t,
        }
        for name, predicate in required.items():
            with self.subTest(required=name):
                self.assertTrue(any(predicate(text_of(n)) for n in negatives),
                                f"no negative fixture for {name}")

    def test_a_real_fixture_names_its_source_and_a_synthetic_one_says_so(self):
        for pair in self.fixtures["pairs"]:
            for side in (pair["positive"], pair["negative"]):
                with self.subTest(pair=pair["id"], title=side["title"][:40]):
                    if side.get("synthetic"):
                        self.assertIn("SYNTHETIC", side["note"])
                        continue
                    src = side["source"]
                    self.assertTrue(src["url"].startswith("https://"))
                    self.assertRegex(src["content_sha256"], r"^[a-f0-9]{64}$")
                    self.assertTrue(src["article_path"].startswith("news/data/"))

    def test_a_real_fixture_still_matches_its_corpus_article_when_present(self):
        """The corpus is gitignored; where it IS present the pinned hash must
        match, so a re-fetched or edited article cannot silently change what
        a fixture claims."""
        checked = 0
        for pair in self.fixtures["pairs"]:
            for side in (pair["positive"], pair["negative"]):
                if side.get("synthetic"):
                    continue
                path = ROOT / side["source"]["article_path"]
                if not path.exists():
                    continue
                body = json.loads(path.read_text(encoding="utf-8")).get("content") or ""
                self.assertEqual(hashlib.sha256(body.encode("utf-8")).hexdigest(),
                                 side["source"]["content_sha256"], side["title"])
                checked += 1
        if checked == 0:
            self.skipTest("corpus not present — hashes not re-checked (not a pass)")

    def test_only_one_synthetic_and_it_is_the_consultation(self):
        synthetic = [s for p in self.fixtures["pairs"] for s in (p["positive"], p["negative"])
                     if s.get("synthetic")]
        self.assertEqual(len(synthetic), 1)
        self.assertIn("консултации", synthetic[0]["lede"])


if __name__ == "__main__":
    unittest.main()
