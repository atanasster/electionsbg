#!/usr/bin/env python3
"""Plan T3.3 — the case registry, the article rule, what earns auto-attach,
the story roll-up and the payload. Every gate here fails closed: no
fixtures, an absent fixture article or one wrong classification withholds
auto-attach, and a registry entry without a dated source refuses the build."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import cases  # noqa: E402

REGISTRY = ROOT / "news" / "config" / "cases.json"
FIXTURES = ROOT / "news" / "evals" / "case_fixtures.json"

CASE = {
    "slug": "petrohan", "name": {"bg": "П", "en": "P"}, "opened_on": "2026-02-13",
    "rule_version": 1, "reviewer": "r", "reviewed_on": "2026-09-22",
    "description": {"bg": "о", "en": "d"},
    "sources": [{"claim": {"bg": "т", "en": "c"}, "url": "https://x/1", "domain": "x", "published": "2026-09-20"}],
    "contested": [], "namesakes": [], "auto_attach": True, "ambiguous_match": "review",
    "overrides": {"include": [], "exclude": []}, "history": [],
    "rule": {"basis": {"bg": "б", "en": "b"}, "required_terms": ["петрохан", "околчица"],
             "context_terms": ["прокуратур", "калушев"], "excluded_terms": []},
}


BI = {"bg": "б", "en": "b"}


def article(title, content, url="https://x/a"):
    return {"url": url, "title": title, "content": content}


def fixture(corpus, key, expected):
    return {"article_path": key, "url": key, "expected": expected, "why": "w",
            "content_sha256": cases.article_sha256(corpus[key])}


class TheRule(unittest.TestCase):
    def test_the_affair_named_twice_with_context_matches_with_evidence(self):
        got = cases.match_article(CASE, article("Делото Петрохан", "Прокуратурата по Петрохан."))
        self.assertEqual(got["basis"], "rule")
        self.assertEqual(got["terms"], ["петрохан"])
        self.assertEqual(got["context"], ["прокуратур"])
        self.assertEqual(got["hits"], 3)  # title counts double

    def test_the_place_without_context_does_not_match(self):
        self.assertIsNone(cases.match_article(CASE, article("Пътна обстановка",
                                                            "По прохода Петрохан е забранено за камиони. Петрохан е затворен.")))

    def test_a_passing_reference_does_not_match(self):
        # ⚠️ THE MUTATION THIS CATCHES: dropping the min-hits floor. One
        # mention of „случая Петрохан" in a campaign interview beside a
        # context word pulls every such interview into the case.
        self.assertIsNone(cases.match_article(CASE, article("Интервю",
                                                            "Кампанията започна със случая Петрохан, каза той пред прокуратурата.")))

    def test_a_road_mention_inside_an_investigation_article_is_not_rejected(self):
        # No blacklist: an investigation that also mentions the road passes.
        got = cases.match_article(CASE, article("Петрохан", "Калушев и прохода Петрохан, затворен за движение."))
        self.assertIsNotNone(got)

    def test_overrides_win_in_both_directions(self):
        case = copy.deepcopy(CASE)
        case["overrides"] = {"include": ["https://x/in"], "exclude": ["https://x/out"]}
        self.assertEqual(cases.match_article(case, article("нищо", "нищо", "https://x/in"))["basis"], "override")
        self.assertIsNone(cases.match_article(case, article("Петрохан Петрохан", "прокуратура", "https://x/out")))

    def test_one_mention_of_the_compound_name_is_not_two_hits(self):
        # ⚠️ THE MUTATION THIS CATCHES: summing hits per required term. The
        # affair's own name „Петрохан – Околчица" is BOTH terms once, and a
        # per-term sum scores it 2 against a floor of 2 — measured, 12 published
        # members whose whole evidence was that one phrase.
        self.assertIsNone(cases.match_article(CASE, article("Училище",
                                                            "По случая „Петрохан – Околчица“ министърът призова прокуратурата.")))
        # Named twice — even as the compound — it is substantive.
        got = cases.match_article(CASE, article("Училище",
                                                "По случая „Петрохан – Околчица“ прокуратурата работи. Петрохан отново."))
        self.assertEqual(got["hits"], 2)

    def test_a_term_must_start_a_word(self):
        # ⚠️ THE MUTATION THIS CATCHES: bare substring matching. „данс" is
        # inside „Сандански" and „терзиев" inside a street name; both attached
        # real road / street-washing articles to the Petrohan case.
        case = copy.deepcopy(CASE)
        case["rule"]["context_terms"] = ["данс"]
        self.assertIsNone(cases.match_article(case, article("Пътища",
                                                            "Проход Петрохан затворен. Петрохан ограничен. Участък Кресна–Сандански.")))
        self.assertIsNotNone(cases.match_article(case, article("Пътища",
                                                               "Проход Петрохан затворен. Петрохан ограничен. ДАНС проверява.")))
        # A stem may still CONTINUE a word.
        self.assertIsNotNone(cases.match_article(CASE, article("Петрохан", "Петрохан: прокуратурата")))

    def test_an_override_carries_the_rule_version(self):
        case = copy.deepcopy(CASE)
        case["overrides"] = {"include": ["https://x/in"], "exclude": []}
        got = cases.match_article(case, article("нищо", "нищо", "https://x/in"))
        self.assertEqual(got["rule_version"], 1)
        self.assertIsNone(got["hits"])

    def test_an_excluded_term_vetoes(self):
        case = copy.deepcopy(CASE)
        case["rule"]["excluded_terms"] = ["туристически маршрут"]
        self.assertIsNone(cases.match_article(case, article("Петрохан Петрохан",
                                                            "прокуратурата и туристически маршрут")))


class WhatEarnsAutoAttach(unittest.TestCase):
    def corpus(self):
        return {
            "p1": article("Петрохан Петрохан", "прокуратурата"),
            "p2": article("Делото Петрохан", "Калушев и прокуратурата по Петрохан"),
            "n1": article("Проход", "Петрохан е затворен"),
            "n2": article("Ботев", "връх Околчица, поклонение"),
        }

    def test_all_correct_earns_it_and_a_wrong_one_withholds_it(self):
        corpus = self.corpus()
        fixtures = [fixture(corpus, k, k.startswith("p")) for k in corpus]
        got = cases.verify_fixtures(CASE, fixtures, lambda k: corpus.get(k, {}))
        self.assertTrue(got["ok"])
        self.assertEqual(got["checked"], 4)
        fixtures[2]["expected"] = True   # the road is now claimed as the affair
        got = cases.verify_fixtures(CASE, fixtures, lambda k: corpus.get(k, {}))
        self.assertFalse(got["ok"])
        self.assertEqual(got["failed"][0]["url"], "n1")

    def test_no_fixtures_an_absent_article_and_too_few_negatives_each_withhold(self):
        corpus = self.corpus()
        self.assertFalse(cases.verify_fixtures(CASE, [], lambda k: corpus.get(k, {}))["ok"])
        fixtures = [fixture(corpus, k, k.startswith("p")) for k in corpus]
        fixtures[0]["article_path"] = "missing"
        got = cases.verify_fixtures(CASE, fixtures, lambda k: corpus.get(k, {}))
        self.assertFalse(got["ok"])
        self.assertEqual(got["failed"][0]["reason"], "article_absent")
        few = [fixture(corpus, k, k.startswith("p")) for k in ("p1", "p2", "n1")]
        self.assertFalse(cases.verify_fixtures(CASE, few, lambda k: corpus.get(k, {}))["ok"])

    def test_a_re_fetched_article_no_longer_matching_its_label_withholds(self):
        # ⚠️ THE MUTATION THIS CATCHES: never reading `content_sha256`. The
        # harvester rewrites files, so the label would be verified against a
        # body it was never made for.
        corpus = self.corpus()
        fixtures = [fixture(corpus, k, k.startswith("p")) for k in corpus]
        corpus["n1"] = article("Проход", "Петрохан е затворен, Петрохан. Калушев.")  # now a positive
        got = cases.verify_fixtures(CASE, fixtures, lambda k: corpus.get(k, {}))
        self.assertFalse(got["ok"])
        self.assertEqual(got["failed"][0], {"url": "n1", "reason": "article_changed"})

    def test_a_malformed_fixture_row_is_a_named_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "f.json"
            path.write_text(json.dumps({"version": 1, "cases": {"petrohan": [
                {"article_path": "a", "url": "a", "expected": True}]}}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "petrohan fixture #0 lacks"):
                cases.load_fixtures(path)
            path.write_text(json.dumps({"version": 2, "cases": {}}), encoding="utf-8")
            with self.assertRaises(ValueError):
                cases.load_fixtures(path)


class TheRollUp(unittest.TestCase):
    def test_case_ids_come_from_matched_members_of_attachable_cases_only(self):
        story = {"id": "S", "members": [{"url": "a"}, {"url": "b"}]}
        matches = {"a": {"petrohan": {"basis": "rule"}}, "b": {"narco-pardon": {"basis": "rule"}}}
        self.assertEqual(cases.attach_case_ids(story, matches, {"petrohan", "narco-pardon"}),
                         ["narco-pardon", "petrohan"])
        # ⚠️ A case that did not earn auto-attach attaches to nothing.
        self.assertEqual(cases.attach_case_ids(story, matches, {"petrohan"}), ["petrohan"])

    def test_the_payload_carries_evidence_and_says_what_membership_means(self):
        stories = [{"id": "S", "title_bg": "t", "title_en": "t", "first_published": "2026-09-20T00:00:00+00:00",
                    "last_published": "2026-09-21T00:00:00+00:00", "topics": [],
                    "members": [{"url": "a", "domain": "x.bg", "article_id": "1", "published": "2026-09-20T00:00:00+00:00",
                                 "leaning": "neutral", "russia_stance": "not_applicable"},
                                {"url": "z", "domain": "y.bg", "article_id": "2", "published": None}]}]
        matches = {"a": {"petrohan": {"basis": "rule", "terms": ["петрохан"], "context": ["калушев"]}}}
        ok = {"ok": True, "reason": None, "checked": 4, "failed": []}
        payload = cases.build_case_payload(CASE, stories, matches, ok, "G")
        self.assertEqual(payload["membership"], "attached")
        self.assertEqual(payload["story_count"], 1)
        self.assertEqual(payload["article_count"], 1)
        self.assertEqual(payload["timeline"][0]["supporting"][0]["evidence"]["terms"], ["петрохан"])
        self.assertEqual(payload["outlets"], {"x.bg": 1})
        self.assertEqual(payload["framing"], {"by_leaning": {"neutral": 1}, "by_russia_stance": {"not_applicable": 1},
                                              "rated": 1, "prefix_scope_count": 0, "articles": 1})
        self.assertIn("редакционен подбор", payload["editorial_note"]["bg"])
        # Under review: the registry entry ships, the timeline does not.
        withheld = cases.build_case_payload(CASE, stories, matches,
                                            {"ok": False, "reason": "no_fixtures", "checked": 0, "failed": []}, "G")
        self.assertEqual(withheld["membership"], "review")
        self.assertEqual(withheld["timeline"], [])
        self.assertEqual(withheld["description"], CASE["description"])


class TheRegistry(unittest.TestCase):
    def test_the_committed_registry_loads_and_its_fixtures_are_complete(self):
        reg = cases.load_cases(REGISTRY)
        self.assertEqual({c["slug"] for c in reg}, {"petrohan", "narco-pardon"})
        fixtures = cases.load_fixtures(FIXTURES)
        for c in reg:
            with self.subTest(case=c["slug"]):
                rows = fixtures.get(c["slug"]) or []
                self.assertGreaterEqual(sum(1 for r in rows if r["expected"]), 2)
                self.assertGreaterEqual(sum(1 for r in rows if not r["expected"]), 2)
                self.assertTrue(c["sources"])
                for claim in c["contested"]:
                    self.assertIn("response", claim)

    def test_the_committed_fixtures_classify_correctly_where_the_corpus_is_present(self):
        reg = {c["slug"]: c for c in cases.load_cases(REGISTRY)}
        fixtures = cases.load_fixtures(FIXTURES)
        checked = 0
        for slug, rows in fixtures.items():
            for fx in rows:
                path = ROOT / fx["article_path"]
                if not path.exists():
                    continue
                art = json.loads(path.read_text(encoding="utf-8"))
                got = cases.match_article(reg[slug], art) is not None
                self.assertEqual(got, fx["expected"], f"{slug}: {fx.get('title') or fx['url']}")
                checked += 1
        if checked == 0:
            self.skipTest("corpus not present — fixtures not re-checked (not a pass)")

    def test_a_malformed_entry_refuses(self):
        for mutate, message in (
            (lambda c: c.__setitem__("sources", []), "no sources"),
            (lambda c: c["rule"].__setitem__("context_terms", []), "context_terms"),
            (lambda c: c.__setitem__("opened_on", "yesterday"), "YYYY-MM-DD"),
            (lambda c: c.__setitem__("ambiguous_match", "maybe"), "ambiguous_match"),
            (lambda c: c["contested"].append({"claim": BI, "speaker": BI, "note": BI, "date": "2026-09-22",
                                              "source_url": "https://x"}), "response"),
            # Reader-facing prose in one language is a defect no count sees.
            (lambda c: c["contested"].append({"claim": "English only", "speaker": BI, "note": BI,
                                              "date": "2026-09-22", "source_url": "https://x",
                                              "response": None}), "bg\+en claim"),
            (lambda c: c["rule"].__setitem__("basis", "English only"), "basis must be bg\+en"),
            (lambda c: c["sources"][0].__setitem__("claim", "English only"), "bg\+en claim"),
            # Every URL a reader can click is https, not only the sources'.
            (lambda c: c["contested"].append({"claim": BI, "speaker": BI, "note": BI, "date": "2026-09-22",
                                              "source_url": "https://x", "response": BI,
                                              "response_source_url": "javascript:alert(1)"}),
             "response_source_url must be https"),
            (lambda c: c["rule"].__setitem__("min_required_hits", 0), "min_required_hits"),
            (lambda c: c["rule"].__setitem__("required_mentions", "x"), "required_mentions must be a list"),
        ):
            with self.subTest(message=message):
                case = copy.deepcopy(CASE)
                mutate(case)
                with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
                    json.dump({"version": 1, "cases": [case]}, fh, ensure_ascii=False)
                try:
                    with self.assertRaisesRegex(ValueError, message):
                        cases.load_cases(Path(fh.name))
                finally:
                    Path(fh.name).unlink()


if __name__ == "__main__":
    unittest.main()
