#!/usr/bin/env python3
"""Tests for person_identity_join.py — each step, each refusal, the merge.

Run:  python3 news/scripts/test_person_identity_join.py
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import person_identity_join as j  # noqa: E402


def person(pid, canonical, party=None, roles=None, version="v1"):
    return {"kind": "person", "id": pid, "canonical": canonical,
            "party": party, "identity_version": version,
            "display": {"roles": roles or []}, "forms": []}


GAZ = {"entries": [
    person("a-1", "Ана Петрова Иванова", party="gerb"),
    person("b-1", "Борис Иванов Петров",
           roles=[{"role": "mayor", "start": "2023-10-29", "current": True}]),
    person("b-2", "Борис Стоянов Петров",
           roles=[{"role": "mp", "start": "2024-10-27", "current": True}]),
    person("t-1", "Васил Терзиев Терзиев",
           roles=[{"role": "mayor", "start": "2023-11-06", "current": True}]),
    person("t-2", "Людмил Аспарухов Терзиев",
           roles=[{"role": "mayor", "start": "2023-11-06", "current": True}]),
    {"kind": "party", "id": "gerb", "canonical": "ГЕРБ", "forms": []},
]}
CUES = {"role_words": {"mayor": ["кмет"], "mp": ["депутат"],
                       "mep": ["евродепутат"], "rayon_mayor": ["районен кмет"],
                       "cabinet": ["министър"],
                       "deputy_minister": ["заместник-министър"]}}


def src(aliases=None, audit=None, registry=None):
    return j.Sources(gazetteer_doc=GAZ, aliases={"aliases": aliases or []},
                     cues=CUES, audit=audit or {}, registry=registry or {})


def run(subjects, analysis, text, published="2026-09-20T10:00:00+00:00",
        sources=None):
    article = {"title": "", "content": text, "published": published}
    report = j.stamp(subjects, analysis, article, sources or src())
    return subjects, report


def subj(name, role="secondary", value=0.0, mentions=2):
    return {"name": name, "kind": "person", "subject_role": role,
            "mentions": mentions, "tone": {"value": value}}


OFFER_B = [{"kind": "person", "id": "b-1", "canonical": "Борис Иванов Петров"},
           {"kind": "person", "id": "b-2", "canonical": "Борис Стоянов Петров"}]


class Exact(unittest.TestCase):
    def test_an_entity_link_is_the_identity(self):
        s, rep = run([subj("Ана Иванова")],
                     {"entity_links": {"Ана Иванова": {
                         "kind": "person", "id": "a-1", "form_kind": "two_part"}}},
                     "Ана Иванова каза.")
        self.assertEqual(s[0]["identity"]["id"], "a-1")
        self.assertEqual(s[0]["identity"]["basis"], "exact")
        self.assertEqual(s[0]["identity"]["form_kind"], "two_part")
        self.assertEqual(s[0]["identity"]["identity_version"], "v1")
        self.assertEqual(rep["exact"], 1)

    def test_a_non_person_link_is_refused(self):
        s, _ = run([subj("Варна")], {"entity_links": {"Варна": {
            "kind": "place", "id": "10135"}}}, "Варна")
        self.assertIsNone(s[0]["identity"])
        self.assertEqual(s[0]["refused_reason"], "not_a_person")

    def test_parties_are_left_alone(self):
        party = {"name": "ГЕРБ", "kind": "party", "tone": {"value": 1}}
        s, _ = run([party], {}, "ГЕРБ")
        self.assertNotIn("identity", s[0])


class Audit(unittest.TestCase):
    LINK = {"entity_links": {"Ана Иванова": {"kind": "person", "id": "a-1"}}}

    def test_a_refused_identity_never_links(self):
        s, _ = run([subj("Ана Иванова")], self.LINK, "Ана Иванова",
                   sources=src(audit={"decisions": [
                       {"id": "a-1", "decision": "refused", "surfaces": []}]}))
        self.assertIsNone(s[0]["identity"])
        self.assertEqual(s[0]["refused_reason"], "identity_refused")

    def test_a_refusal_scoped_to_other_surfaces_does_not_apply(self):
        s, _ = run([subj("Ана Иванова")], self.LINK, "Ана Иванова",
                   sources=src(audit={"decisions": [
                       {"id": "a-1", "decision": "refused",
                        "surfaces": ["Ана Петрова"]}]}))
        self.assertEqual(s[0]["identity"]["id"], "a-1")

    def test_mixed_needs_a_cue(self):
        audit = {"decisions": [{"id": "a-1", "decision": "mixed",
                                "surfaces": ["Ана Иванова"]}]}
        s, _ = run([subj("Ана Иванова")], self.LINK, "Ана Иванова говори.",
                   sources=src(audit=audit))
        self.assertEqual(s[0]["refused_reason"], "context_required")
        with_party = {"entity_links": {**self.LINK["entity_links"],
                                       "ГЕРБ": {"kind": "party", "id": "gerb"}}}
        s, _ = run([subj("Ана Иванова")], with_party, "Ана Иванова от ГЕРБ.",
                   sources=src(audit=audit))
        self.assertEqual(s[0]["identity"]["basis"], "context")


class Context(unittest.TestCase):
    def test_one_cued_candidate_resolves(self):
        s, rep = run([subj("Борис Петров")],
                     {"entity_candidates": {"Борис Петров": OFFER_B}},
                     "Кметът Борис Петров откри моста.")
        self.assertEqual(s[0]["identity"]["id"], "b-1")
        self.assertEqual(s[0]["identity"]["basis"], "context")
        self.assertEqual(rep["context"], 1)

    def test_a_cue_far_from_the_name_does_not_count(self):
        text = "Кметът откри моста." + " x" * 200 + " Борис Петров говори."
        s, _ = run([subj("Борис Петров")],
                   {"entity_candidates": {"Борис Петров": OFFER_B}}, text)
        self.assertEqual(s[0]["refused_reason"], "ambiguous")

    def test_two_cued_candidates_refuse(self):
        # Mutation check: the rule must still refuse when the cue fits both.
        s, _ = run([subj("Борис Петров")],
                   {"entity_candidates": {"Борис Петров": OFFER_B}},
                   "Депутатът и кметът Борис Петров.")
        self.assertIsNone(s[0]["identity"])
        self.assertEqual(s[0]["refused_reason"], "ambiguous")

    def test_an_office_not_held_on_the_date_is_no_cue(self):
        s, _ = run([subj("Борис Петров")],
                   {"entity_candidates": {"Борис Петров": OFFER_B}},
                   "Кметът Борис Петров.", published="2020-01-01T00:00:00Z")
        self.assertEqual(s[0]["refused_reason"], "ambiguous")

    def test_a_one_word_name_never_resolves_by_context(self):
        # The Терзиев shape: the office cue fits a candidate who is not the
        # person the article means.
        offer = [{"kind": "person", "id": "t-2", "canonical": "Людмил"},
                 {"kind": "person", "id": "b-2", "canonical": "Борис"}]
        s, _ = run([subj("Терзиев")], {"entity_candidates": {"Терзиев": offer}},
                   "Кметът Терзиев откри моста.")
        self.assertIsNone(s[0]["identity"])
        self.assertEqual(s[0]["refused_reason"], "ambiguous")

    def test_a_party_far_from_the_name_is_no_cue(self):
        gaz = {"entries": [person("x-1", "Х Х", party="gerb"), person("x-2", "Х Й"),
                           {"kind": "party", "id": "gerb", "forms": []}]}
        sources = j.Sources(gazetteer_doc=gaz, aliases={}, cues=CUES,
                            audit={}, registry={})
        offer = [{"kind": "person", "id": "x-1", "canonical": "Х Х"},
                 {"kind": "person", "id": "x-2", "canonical": "Х Й"}]
        analysis = {"entity_candidates": {"Иван Ас": offer},
                    "entity_links": {"ГЕРБ": {"kind": "party", "id": "gerb"}}}
        far = "ГЕРБ внесе закон." + " x" * 200 + " Иван Ас говори."
        s, _ = run([subj("Иван Ас")], analysis, far, sources=sources)
        self.assertEqual(s[0]["refused_reason"], "ambiguous")
        s, _ = run([subj("Иван Ас")], analysis, "Иван Ас от ГЕРБ.",
                   sources=sources)
        self.assertEqual(s[0]["identity"]["id"], "x-1")

    def test_a_longer_office_does_not_cue_the_shorter_one(self):
        for text in ("Евродепутатът Борис Петров.",
                     "Районен кмет Борис Петров.",
                     "Заместник-министър Борис Петров."):
            s, _ = run([subj("Борис Петров")],
                       {"entity_candidates": {"Борис Петров": OFFER_B}}, text)
            self.assertEqual(s[0]["refused_reason"], "ambiguous", text)

    def test_an_inflected_office_still_cues(self):
        s, _ = run([subj("Борис Петров")],
                   {"entity_candidates": {"Борис Петров": OFFER_B}},
                   "Кметът на града Борис Петров.")
        self.assertEqual(s[0]["identity"]["id"], "b-1")

    def test_a_local_party_code_is_not_a_cue(self):
        gaz = {"entries": [person("x-1", "Х Х", party="p_20"),
                           person("x-2", "Х Й")]}
        sources = j.Sources(gazetteer_doc=gaz, aliases={}, cues=CUES,
                            audit={}, registry={})
        offer = [{"kind": "person", "id": "x-1", "canonical": "Х Х"},
                 {"kind": "person", "id": "x-2", "canonical": "Х Й"}]
        s, _ = run([subj("Х Х")], {"entity_candidates": {"Х Х": offer},
                                   "entity_links": {"П": {"kind": "party",
                                                          "id": "p_20"}}},
                   "Х Х", sources=sources)
        self.assertEqual(s[0]["refused_reason"], "ambiguous")


class SurnameAlias(unittest.TestCase):
    ALIAS = {"surface": "Терзиев", "id": "t-1", "status": "accepted",
             "valid_from": "2023-11-06", "valid_to": "2027-11-06"}

    def test_a_reviewed_alias_in_its_window_resolves(self):
        s, rep = run([subj("Терзиев")], {}, "Терзиев каза.",
                     sources=src(aliases=[self.ALIAS]))
        self.assertEqual(s[0]["identity"]["id"], "t-1")
        self.assertEqual(s[0]["identity"]["basis"], "surname_alias")
        self.assertEqual(rep["surname_alias"], 1)

    def test_outside_the_window_it_does_not(self):
        s, _ = run([subj("Терзиев")], {}, "Терзиев",
                   published="2022-01-01T00:00:00Z",
                   sources=src(aliases=[self.ALIAS]))
        self.assertEqual(s[0]["refused_reason"], "no_match")

    def test_an_undated_article_gets_no_alias(self):
        s, _ = run([subj("Терзиев")], {}, "Терзиев", published=None,
                   sources=src(aliases=[self.ALIAS]))
        self.assertIsNone(s[0]["identity"])
        self.assertEqual(s[0]["refused_reason"], "no_match")

    def test_a_same_surname_jev_subject_blocks_it(self):
        s, _ = run([subj("Терзиев"), subj("Людмил Терзиев")], {},
                   "Людмил Терзиев и Терзиев.", sources=src(aliases=[self.ALIAS]))
        self.assertEqual(s[0]["refused_reason"], "surname_clash")

    def test_an_unaccepted_alias_is_ignored(self):
        s, _ = run([subj("Терзиев")], {}, "Терзиев",
                   sources=src(aliases=[{**self.ALIAS, "status": "pending"}]))
        self.assertEqual(s[0]["refused_reason"], "no_match")

    def test_another_person_with_the_surname_blocks_it(self):
        s, _ = run([subj("Терзиев")],
                   {"entities": {"people": ["Людмил Терзиев", "Терзиев"]}},
                   "Людмил Терзиев и Терзиев.",
                   sources=src(aliases=[self.ALIAS]))
        self.assertEqual(s[0]["refused_reason"], "surname_clash")

    def test_the_same_person_named_in_full_is_no_clash(self):
        links = {"Васил Терзиев": {"kind": "person", "id": "t-1"}}
        s, _ = run([subj("Терзиев")],
                   {"entities": {"people": ["Васил Терзиев", "Терзиев"]},
                    "entity_links": links},
                   "Васил Терзиев. Терзиев каза.",
                   sources=src(aliases=[self.ALIAS]))
        self.assertEqual(s[0]["identity"]["id"], "t-1")

    def test_requires_cue(self):
        alias = {**self.ALIAS, "requires_cue": True}
        s, _ = run([subj("Терзиев")], {}, "Терзиев каза.",
                   sources=src(aliases=[alias]))
        self.assertEqual(s[0]["refused_reason"], "cue_required")
        s, _ = run([subj("Терзиев")], {}, "Кметът Терзиев каза.",
                   sources=src(aliases=[alias]))
        self.assertEqual(s[0]["identity"]["id"], "t-1")

    def test_two_live_aliases_for_one_surname_refuse(self):
        s, _ = run([subj("Терзиев")], {}, "Терзиев",
                   sources=src(aliases=[self.ALIAS, {**self.ALIAS, "id": "t-2"}]))
        self.assertEqual(s[0]["refused_reason"], "ambiguous")


class Registry(unittest.TestCase):
    REG = {"persons": [{"news_person_id": "np_00000001", "status": "active",
                        "name_bg": "Ивайло Калушев", "identity_version": "r1",
                        "scope": "bg", "public_figure": False}]}

    def test_a_resolved_news_person_row_is_the_identity(self):
        s, rep = run([subj("Ивайло Калушев")],
                     {"news_persons": [{"surface": "Ивайло Калушев",
                                        "news_person_id": "np_00000001"}]},
                     "Ивайло Калушев", sources=src(registry=self.REG))
        ident = s[0]["identity"]
        self.assertEqual((ident["kind"], ident["id"], ident["basis"]),
                         ("news_person", "np_00000001", "registry"))
        self.assertEqual(ident["scope"], "bg")
        self.assertIs(ident["public_figure"], False)
        self.assertEqual(rep["registry"], 1)

    def test_an_inactive_registry_id_does_not_resolve(self):
        reg = {"persons": [{**self.REG["persons"][0], "status": "pending_review"}]}
        s, _ = run([subj("Ивайло Калушев")],
                   {"news_persons": [{"surface": "Ивайло Калушев",
                                      "news_person_id": "np_00000001"}]},
                   "Ивайло Калушев", sources=src(registry=reg))
        self.assertEqual(s[0]["refused_reason"], "no_match")


class Merge(unittest.TestCase):
    LINKS = {"Ана Иванова": {"kind": "person", "id": "a-1"}}
    ALIAS = {"surface": "Иванова", "id": "a-1", "status": "accepted"}

    def run_pair(self, full_value, short_value, short_role="primary"):
        subjects = [subj("Ана Иванова", "secondary", full_value, 1),
                    subj("Иванова", short_role, short_value, 5)]
        return run(subjects, {"entity_links": self.LINKS,
                              "entities": {"people": ["Ана Иванова", "Иванова"]}},
                   "Ана Иванова. Иванова.", sources=src(aliases=[self.ALIAS]))

    def test_one_row_per_identity_keeping_the_higher_role(self):
        s, rep = self.run_pair(0.1, 0.3)
        self.assertEqual(len(s), 1)
        self.assertEqual(s[0]["name"], "Иванова")
        self.assertEqual(s[0]["merged_surfaces"], ["Ана Иванова"])
        self.assertNotIn("conflict", s[0])
        self.assertEqual(rep["merged"], 1)

    def test_disagreeing_values_are_a_conflict(self):
        s, rep = self.run_pair(-0.8, 0.5)
        self.assertTrue(s[0]["conflict"])
        self.assertEqual(rep["conflict"], 1)

    def test_never_an_average(self):
        s, _ = self.run_pair(-0.8, 0.5)
        self.assertEqual(s[0]["tone"]["value"], 0.5)


class HeldOn(unittest.TestCase):
    def test_bounds(self):
        role = {"start": "2020-01-01", "end": "2021-01-01"}
        self.assertTrue(j.held_on(role, "2020-06-01"))
        self.assertTrue(j.held_on(role, "2021-01-01"))
        self.assertFalse(j.held_on(role, "2021-01-02"))
        self.assertFalse(j.held_on({"end": "2021-01-01"}, "2020-06-01"))
        self.assertFalse(j.held_on(role, None))


if __name__ == "__main__":
    unittest.main()
