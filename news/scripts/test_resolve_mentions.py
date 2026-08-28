#!/usr/bin/env python3
"""Tests for resolve_mentions.py — the dictionary pass.

⚠️ Every test here defends a rule whose failure is a WRONG LINK about a named
person or place, which is shape-identical to a right one in the output. The
resolver never picks a winner: every refusal in the gazetteer is carried
through as a refusal.

Run:  python3 news/scripts/test_resolve_mentions.py
"""

import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from resolve_mentions import (  # noqa: E402
    undefinite_forms, entity_links,
    BASIS_RANK, Gazetteer, article_text, dedupe, decide, fold, resolve)


def gz(*entries) -> Gazetteer:
    return Gazetteer({"version": 1, "entries": list(entries)})


def person(canonical, *forms) -> dict:
    return {"kind": "person", "canonical": canonical, "forms": list(forms)}


def f(surface, resolvable=True, ident=None, anchor=None, why="") -> dict:
    out = {"surface": surface, "resolvable": resolvable,
           "id": ident if resolvable else None, "why": why}
    if not resolvable and anchor:
        out["anchor_for"] = anchor
    return out


class Boundaries(unittest.TestCase):
    """⚠️ Python's `\\b` and `\\w` ARE Unicode-aware for str patterns, unlike
    JavaScript's — so the usual „`\\b` never matches after a Cyrillic letter"
    warning does not apply. What DOES bite is the hyphen."""

    def setUp(self):
        self.g = gz(person("Иван Петров", f("Иван Петров", True, "ip-1")))

    def test_it_does_not_match_inside_a_longer_word(self):
        got = resolve("Иван Петровски заяви.", self.g)
        self.assertEqual(got, [])

    def test_it_does_not_match_inside_a_hyphenated_surname(self):
        # ⚠️ „Иван Петров-Георгиев" is a DIFFERENT person. A plain
        # `(?<!\\w)…(?!\\w)` boundary matches inside him, because a hyphen is
        # not a word character — but in a Bulgarian compound surname it is.
        got = resolve("Иван Петров-Георгиев подаде оставка.", self.g)
        self.assertEqual(got, [])

    def test_it_matches_next_to_punctuation_and_quotes(self):
        for text in ('„Иван Петров", каза той.', "Иван Петров.",
                     "(Иван Петров)", "— Иван Петров"):
            with self.subTest(text=text):
                self.assertEqual(len(resolve(text, self.g)), 1)

    def test_it_is_case_insensitive(self):
        # All-caps headlines are ordinary in this corpus.
        self.assertEqual(len(resolve("ИВАН ПЕТРОВ ЗАЯВИ", self.g)), 1)

    def test_the_surface_reported_is_the_one_the_article_wrote(self):
        # ⚠️ „ИВАН ПЕТРОВ" must not be reported as „Иван Петров": the reader
        # is shown what the article said, and a roster reviewer needs the real
        # spelling to judge it.
        got = resolve("ИВАН ПЕТРОВ заяви", self.g)
        self.assertEqual(got[0]["surface"], "ИВАН ПЕТРОВ")

    def test_folding_ignores_combining_marks(self):
        # „Й" as a precomposed character and as И + breve must compare equal —
        # the register and the newsroom disagree about which they use.
        self.assertEqual(fold("Йончева"), fold("Йончева"))


class LongestMatchWins(unittest.TestCase):
    def test_the_full_name_beats_the_surname_on_the_same_words(self):
        # ⚠️ Correctness, not tidiness: „Делян Пеевски" resolves and „Пеевски"
        # never does, so taking the shorter turns a clean hit into an anchor.
        g = gz(person("Делян Пеевски",
                      f("Делян Пеевски", True, "dp-1"),
                      f("Пеевски", False, anchor="dp-1")))
        got = resolve("Делян Пеевски заяви.", g)
        self.assertEqual([m["surface"] for m in got], ["Делян Пеевски"])
        self.assertEqual(got[0]["basis"], "gazetteer_exact")

    def test_a_shorter_PREFIX_that_is_also_a_surface_loses(self):
        # ⚠️ The case that actually discriminates, and the obvious fixture
        # does not: with „Делян Пеевски" and „Пеевски", a shortest-first walk
        # finds „Делян" is not a surface and lands on the full name anyway.
        # It takes a shorter surface that is a PREFIX of a longer one —
        # „Мария" the village inside „Мария Габриел" the person — for the
        # direction of the scan to change the answer. Shortest-first links an
        # MEP's name to a village.
        g = gz({"kind": "place", "canonical": "Мария", "place_kind": "settlement",
                "forms": [f("Мария", True, "settlement:1")]},
               person("Мария Габриел", f("Мария Габриел", True, "mg-1")))
        got = resolve("Мария Габриел заяви.", g)
        self.assertEqual([m["surface"] for m in got], ["Мария Габриел"])
        self.assertEqual(got[0]["kind"], "person")
        self.assertEqual(got[0]["id"], "mg-1")

    def test_a_matched_span_is_not_rescanned(self):
        g = gz(person("Делян Пеевски",
                      f("Делян Пеевски", True, "dp-1"),
                      f("Пеевски", False, anchor="dp-1")))
        self.assertEqual(len(resolve("Делян Пеевски", g)), 1)


class Coreference(unittest.TestCase):
    """The bare surname resolves ONLY through the document itself."""

    def setUp(self):
        self.g = gz(person("Делян Пеевски",
                           f("Делян Пеевски", True, "dp-1"),
                           f("Пеевски", False, anchor="dp-1")))

    def test_a_surname_alone_never_resolves(self):
        # ⚠️ „Иванов" is 1,554 public figures. Without the full name in the
        # same document there is nothing to corefer to.
        got = resolve("Пеевски заяви пред медиите.", self.g)
        self.assertEqual(got[0]["basis"], "not_in_gazetteer")
        self.assertIsNone(got[0]["id"])

    def test_the_document_can_settle_it(self):
        got = resolve("Делян Пеевски заяви. По-късно Пеевски допълни.", self.g)
        self.assertEqual([m["basis"] for m in got],
                         ["gazetteer_exact", "coref_resolved"])
        self.assertEqual({m["id"] for m in got}, {"dp-1"})

    def test_order_does_not_matter(self):
        # ⚠️ TWO passes exist for this. A single forward pass resolves
        # whichever came first and refuses the other — on the same person, in
        # the same article, decided by paragraph order alone.
        got = resolve("Пеевски заяви. По-късно Делян Пеевски допълни.", self.g)
        self.assertEqual(sorted(m["basis"] for m in got),
                         ["coref_resolved", "gazetteer_exact"])

    def test_coref_needs_an_OUTRIGHT_resolution_not_another_anchor(self):
        # Two people share the surname; neither full name appears. Nothing in
        # the document says which, so nothing resolves.
        g = gz(person("Делян Пеевски", f("Делян Пеевски", True, "dp-1"),
                      f("Пеевски", False, anchor="dp-1")),
               person("Иван Пеевски", f("Иван Пеевски", True, "ip-1"),
                      f("Пеевски", False, anchor="ip-1")))
        got = resolve("Пеевски заяви.", g)
        self.assertEqual(got[0]["basis"], "ambiguous_refused")
        self.assertIsNone(got[0]["id"])
        self.assertEqual(len(got[0]["candidates"]), 2)

    def test_an_ambiguous_surname_stays_refused_when_both_are_named(self):
        g = gz(person("Делян Пеевски", f("Делян Пеевски", True, "dp-1"),
                      f("Пеевски", False, anchor="dp-1")),
               person("Иван Пеевски", f("Иван Пеевски", True, "ip-1"),
                      f("Пеевски", False, anchor="ip-1")))
        got = resolve("Делян Пеевски и Иван Пеевски. По-късно Пеевски каза.", g)
        bare = [m for m in got if m["surface"] == "Пеевски"]
        self.assertEqual(bare[0]["basis"], "ambiguous_refused")
        self.assertIsNone(bare[0]["id"])


class RefusalIsCarriedThrough(unittest.TestCase):
    def test_two_outright_owners_resolve_to_neither(self):
        g = gz({"kind": "place", "canonical": "Х", "place_kind": "settlement",
                "forms": [f("Х", True, "settlement:1")]},
               {"kind": "institution", "canonical": "Х",
                "forms": [f("Х", True, "2")]})
        basis, ident, cands = decide(g.by_surface[fold("Х")], set())
        self.assertEqual(basis, "ambiguous_refused")
        self.assertIsNone(ident)
        self.assertEqual(len(cands), 2)

    def test_candidates_distinguish_homonyms_sharing_a_canonical_name(self):
        # ⚠️ Two „Айтос" places both have canonical „Айтос", so a candidate
        # list built from canonical names alone collapses to ONE — and a
        # one-entry list is not an ambiguity, so the surface silently fell
        # through to „not in gazetteer".
        claims = [{"kind": "place", "canonical": "Айтос", "resolvable": False,
                   "id": None, "anchor_for": "settlement:1",
                   "detail": "settlement", "why": ""},
                  {"kind": "place", "canonical": "Айтос", "resolvable": False,
                   "id": None, "anchor_for": "obshtina:2",
                   "detail": "obshtina", "why": ""}]
        basis, ident, cands = decide(claims, set())
        self.assertEqual(basis, "ambiguous_refused")
        self.assertEqual(len(cands), 2)
        self.assertNotEqual(cands[0], cands[1])

    def test_a_lone_resolvable_claim_does_NOT_outvote_refusals(self):
        # ⚠️⚠️ MEASURED LIVE, 36 occurrences: „Ангелов" is refused as a
        # surname by seven public figures AND is a settlement — and counting
        # only the RESOLVABLE claims let the village win outright, emitting
        # `gazetteer_exact` with a settlement id on what an article meant as
        # a person's name. A refusal is evidence of ambiguity, not an
        # abstention.
        g = gz({"kind": "place", "canonical": "Ангелов",
                "place_kind": "settlement",
                "forms": [f("Ангелов", True, "settlement:456")]},
               person("Иван Ангелов", f("Ангелов", False, anchor="ia-1")),
               person("Петър Ангелов", f("Ангелов", False, anchor="pa-1")))
        got = resolve("Ангелов заяви пред медиите.", g)
        self.assertEqual(got[0]["basis"], "ambiguous_refused")
        self.assertIsNone(got[0]["id"])
        self.assertGreaterEqual(len(got[0]["candidates"]), 2)

    def test_the_kind_comes_from_the_WINNING_claim(self):
        # ⚠️ MEASURED LIVE, 37 mentions across 26 articles: `claims[0]` is
        # gazetteer FILE ORDER, so a mention carried `kind: "person"` with a
        # settlement id — and „Възраждане" resolved to a party while labelled
        # a place, which also split one party across two dedupe keys.
        # Two entries anchor „Възраждане": a PLACE (listed first, so
        # claims[0]) and a PARTY. The document resolves the party outright
        # elsewhere, so coreference settles the bare surface on the party —
        # and the mention must say `party`, not `place`.
        g = gz({"kind": "place", "canonical": "Възраждане",
                "place_kind": "settlement",
                "forms": [f("Възраждане", False, anchor="settlement:9")]},
               {"kind": "party", "canonical": "ПП Възраждане",
                "forms": [f("ПП Възраждане", True, "p_7"),
                          f("Възраждане", False, anchor="p_7")]})
        got = resolve("ПП Възраждане внесе. По-късно Възраждане поиска.", g)
        won = [m for m in got if m["basis"] == "coref_resolved"]
        self.assertTrue(won, got)
        self.assertEqual(won[0]["kind"], "party")
        self.assertEqual(won[0]["id"], "p_7")

    def test_candidates_name_a_refused_claim_by_its_anchor(self):
        # ⚠️ A refused claim carries its identity in `anchor_for`, not `id`,
        # so a label built from `id` alone collapsed „Ангелов (person)" ×7
        # into ONE string — and a one-entry list is not an ambiguity, so 453
        # genuinely contested surfaces reported „not in gazetteer" instead.
        claims = [{"kind": "person", "canonical": "Ангелов", "resolvable": False,
                   "id": None, "anchor_for": f"a-{i}", "detail": None, "why": ""}
                  for i in range(3)]
        basis, ident, cands = decide(claims, set())
        self.assertEqual(basis, "ambiguous_refused")
        self.assertEqual(len(cands), 3)

    def test_a_single_refused_claim_reports_no_identity(self):
        # ⚠️ `ambiguous_refused` requires candidates we can NAME — the
        # validator enforces ≥2, and „ambiguous" is a claim about a set.
        claims = [{"kind": "person", "canonical": "Александър Александров",
                   "resolvable": False, "id": None,
                   "anchor_for": "aa-1", "detail": None, "why": ""}]
        basis, ident, cands = decide(claims, set())
        self.assertEqual(basis, "not_in_gazetteer")
        self.assertIsNone(ident)
        self.assertIsNone(cands)

    def test_no_refused_mention_ever_carries_an_id(self):
        g = gz(person("Делян Пеевски", f("Делян Пеевски", True, "dp-1"),
                      f("Пеевски", False, anchor="dp-1")),
               person("Иван Пеевски", f("Иван Пеевски", True, "ip-1"),
                      f("Пеевски", False, anchor="ip-1")))
        for m in resolve("Пеевски и още Пеевски.", g):
            if m["basis"] in ("ambiguous_refused", "not_in_gazetteer"):
                self.assertIsNone(m["id"])

    def test_a_known_non_entity_never_reaches_the_review_queue(self):
        # ⚠️ „войници", „места", „река" are gazetteer surfaces refused as
        # ordinary Bulgarian words. Emitting them as `not_in_gazetteer` — the
        # basis whose whole purpose is „queue this for roster review" — filled
        # that queue with 583 mentions, 171 distinct, almost all noise. After
        # the drop it is 77 / 45, and every one is a real person's name.
        g = gz({"kind": "place", "canonical": "Река", "place_kind": "settlement",
                "forms": [{"surface": "Река", "resolvable": False, "id": None,
                           "anchor_for": "settlement:1",
                           "refusal": "common_word", "why": ""}]})
        self.assertEqual(resolve("Река тече през града.", g), [])

    def test_an_AMBIGUITY_still_reaches_the_queue(self):
        # A common noun is not a review candidate; a contested name is.
        g = gz(person("Иван Пеев", f("Пеев", False, anchor="a-1")),
               person("Георги Пеев", f("Пеев", False, anchor="b-1")))
        got = resolve("Пеев заяви.", g)
        self.assertEqual(got[0]["basis"], "ambiguous_refused")

    def test_the_drop_never_swallows_an_AMBIGUITY(self):
        # ⚠️ Even when every claim is a common-word refusal. „Елена" is a
        # word, a given name AND three villages — the villages are a real
        # ambiguity a reader may want disambiguated, and silently dropping it
        # loses the fact that the article named a place at all.
        g = gz({"kind": "place", "canonical": "Елена", "place_kind": "settlement",
                "forms": [{"surface": "Елена", "resolvable": False, "id": None,
                           "anchor_for": "settlement:1",
                           "refusal": "common_word", "why": ""}]},
               {"kind": "place", "canonical": "Елена", "place_kind": "obshtina",
                "forms": [{"surface": "Елена", "resolvable": False, "id": None,
                           "anchor_for": "obshtina:2",
                           "refusal": "common_word", "why": ""}]})
        got = resolve("Елена е красив град.", g)
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["basis"], "ambiguous_refused")

    def test_an_unknown_person_still_reaches_the_queue(self):
        g = gz(person("Румен Радев", f("Румен Радев", False, anchor="rr-1")))
        got = resolve("Румен Радев заяви.", g)
        self.assertEqual(got[0]["basis"], "not_in_gazetteer")

    def test_the_drop_does_not_defeat_coreference(self):
        # ⚠️ Dropped only when NOTHING about it resolved. A document that
        # establishes the place some other way still gets its coreference.
        g = gz({"kind": "place", "canonical": "Река", "place_kind": "settlement",
                "forms": [{"surface": "село Река", "resolvable": True,
                           "id": "settlement:1", "why": ""},
                          {"surface": "Река", "resolvable": False, "id": None,
                           "anchor_for": "settlement:1",
                           "refusal": "common_word", "why": ""}]})
        got = resolve("Пожар в село Река. Река остана без ток.", g)
        self.assertEqual([m["basis"] for m in got],
                         ["gazetteer_exact", "coref_resolved"])

    def test_the_role_is_never_claimed_by_the_dictionary_pass(self):
        # ⚠️ „subject" would put an article on somebody's page for being named
        # once in the last paragraph. Only the model can tell them apart.
        g = gz(person("Иван Петров", f("Иван Петров", True, "ip-1")))
        self.assertEqual(resolve("Иван Петров", g)[0]["role"], "mention")


class CuratedEntityLinks(unittest.TestCase):
    def setUp(self):
        self.g = gz()
        self.overrides = {"links": [
            {"surface": "Димитър Стоянов", "kind": "person",
             "id": "mp-5118", "canonical": "Димитър Желязков Стоянов",
             "requires_any": ["МО"], "evidence": "verified fixture"},
            {"surface": "ДПС", "kind": "party", "id": "p_16",
             "canonical": "ДПС", "evidence": "verified fixture"},
            {"surface": "О-Рент", "kind": "company", "id": "206268628",
             "canonical": "О-РЕНТ", "evidence": "verified fixture"},
            {"surface": "КЗК", "kind": "institution", "id": "kzk",
             "canonical": "Комисия за защита на конкуренцията",
             "path": "/procurement/appeals", "evidence": "verified fixture"},
            {"surface": "Безмер", "kind": "place", "id": "03229",
             "canonical": "Безмер, община Тунджа, област Ямбол",
             "path": "/settlement/03229",
             "requires_text_any": ["авиобаза Безмер"],
             "evidence": "verified fixture"},
        ]}

    def test_a_contextual_person_override_needs_its_context(self):
        bare = {"people": ["Димитър Стоянов"], "institutions": []}
        self.assertNotIn("Димитър Стоянов",
                         entity_links(bare, self.g, self.overrides))
        contextual = {"people": ["Димитър Стоянов"],
                      "institutions": ["МО"]}
        link = entity_links(contextual, self.g, self.overrides)["Димитър Стоянов"]
        self.assertEqual(link["id"], "mp-5118")
        self.assertEqual(link["form_kind"], "curated_entity")

    def test_an_override_cannot_cross_entity_kinds(self):
        wrong = {"people": ["ДПС"]}
        self.assertNotIn("ДПС", entity_links(wrong, self.g, self.overrides))
        right = {"parties": ["ДПС"]}
        link = entity_links(right, self.g, self.overrides)["ДПС"]
        self.assertEqual(link["id"], "p_16")
        self.assertEqual(link["href"],
                         "https://electionsbg.com/party/%D0%94%D0%9F%D0%A1")

    def test_a_gazetteer_party_uses_its_nickname_not_canonical_id_in_the_url(self):
        g = gz({"kind": "party", "canonical": "ПрБ",
                "forms": [f("Прогресивна България", True, "p_20")]})
        got = entity_links(
            {"parties": ["Прогресивна България"]}, g, {"links": []})
        link = got["Прогресивна България"]
        self.assertEqual(link["id"], "p_20")
        self.assertEqual(link["href"],
                         "https://electionsbg.com/party/%D0%9F%D1%80%D0%91")

    def test_a_curated_company_uses_the_served_company_route(self):
        got = entity_links(
            {"companies": ["О-Рент"]}, self.g, self.overrides)
        self.assertEqual(got["О-Рент"]["kind"], "company")
        self.assertEqual(got["О-Рент"]["href"],
                         "https://electionsbg.com/company/206268628")

    def test_a_curated_entity_may_use_a_reviewed_main_site_path(self):
        got = entity_links(
            {"institutions": ["КЗК"]}, self.g, self.overrides)
        self.assertEqual(got["КЗК"]["href"],
                         "https://electionsbg.com/procurement/appeals")

    def test_an_ambiguous_place_override_needs_its_textual_context(self):
        entities = {"places": ["Безмер"]}
        self.assertNotIn(
            "Безмер", entity_links(entities, self.g, self.overrides))
        got = entity_links(
            entities, self.g, self.overrides,
            context_text="Самолетите напуснаха авиобаза Безмер.")
        self.assertEqual(got["Безмер"]["href"],
                         "https://electionsbg.com/settlement/03229")

    def test_the_committed_crosswalk_is_reviewable_and_non_contradictory(self):
        path = (Path(__file__).resolve().parents[1] / "data"
                / "entity_link_overrides.json")
        doc = json.loads(path.read_text(encoding="utf-8"))
        links = doc["links"]
        keys = [(o["kind"], fold(o["surface"])) for o in links]
        self.assertEqual(len(keys), len(set(keys)))
        for o in links:
            self.assertIn(o["kind"],
                          ("person", "party", "institution", "company", "place"))
            self.assertTrue(o["id"], o["surface"])
            self.assertTrue(o["canonical"], o["surface"])
            self.assertGreater(len(o.get("evidence") or ""), 60,
                               o["surface"])
        linked = {fold(o["surface"]) for o in links}
        for refusal in doc["refused"]:
            self.assertNotIn(fold(refusal["surface"]), linked)
            self.assertGreater(len(refusal.get("why") or ""), 60,
                               refusal["surface"])

    def test_the_construction_cartel_story_links_only_verified_entities(self):
        entities = {
            "institutions": ["КЗК", "Европейска комисия"],
            "companies": ["О-Рент", "Инжконсулт", "Земекоп"],
        }
        got = entity_links(entities, self.g)
        self.assertEqual(
            {name: link["href"] for name, link in got.items()},
            {
                "КЗК": "https://electionsbg.com/procurement/appeals",
                "О-Рент": "https://electionsbg.com/company/206268628",
                "Инжконсулт": "https://electionsbg.com/company/130083729",
                "Земекоп": "https://electionsbg.com/company/201256929",
            },
        )


class Dedupe(unittest.TestCase):
    def test_the_strongest_basis_wins_not_the_first_seen(self):
        # ⚠️ „Пеевски" (coref) arriving before „Делян Пеевски" (exact) kept
        # the weaker of the two, so an article with a clean full-name hit
        # reported a coreference. Paragraph order was the only difference.
        g = gz(person("Делян Пеевски", f("Делян Пеевски", True, "dp-1"),
                      f("Пеевски", False, anchor="dp-1")))
        got = dedupe(resolve("Пеевски заяви. Делян Пеевски допълни.", g))
        self.assertEqual(len(got), 1)
        self.assertEqual(got[0]["basis"], "gazetteer_exact")
        self.assertEqual(got[0]["surface"], "Делян Пеевски")

    def test_the_rank_is_a_total_order(self):
        self.assertEqual(len(set(BASIS_RANK.values())), len(BASIS_RANK))
        self.assertEqual(min(BASIS_RANK, key=BASIS_RANK.get), "gazetteer_exact")

    def test_two_unresolved_namesakes_are_not_merged(self):
        # ⚠️ Keyed on the folded SURFACE when there is no id, so two different
        # unresolved people do not collapse into one.
        g = gz(person("А Б", f("Иванов", False, anchor="a-1")),
               person("В Г", f("Петров", False, anchor="b-1")))
        got = dedupe(resolve("Иванов и Петров.", g))
        self.assertEqual(len(got), 2)

    def test_case_variants_of_one_name_are_one_mention(self):
        g = gz(person("Иван Петров", f("Иван Петров", True, "ip-1")))
        got = dedupe(resolve("ИВАН ПЕТРОВ. По-късно Иван Петров.", g))
        self.assertEqual(len(got), 1)


class ArticleText(unittest.TestCase):
    def test_a_surface_cannot_form_across_the_field_seam(self):
        # ⚠️ A title ending „…каза Иван" and a body starting „Петров съобщи"
        # would otherwise produce „Иван Петров" — a person the article never
        # named.
        g = gz(person("Иван Петров", f("Иван Петров", True, "ip-1")))
        rec = {"title": "Това каза Иван", "description": "",
               "content": "Петров съобщи вчера."}
        self.assertEqual(resolve(article_text(rec), g), [])

    def test_a_surface_cannot_span_a_full_stop(self):
        # ⚠️ Ordinary prose, not an edge case: „…това каза Иван. Петров
        # съобщи вчера." A name is written with spaces; punctuation between
        # two words means they belong to different phrases.
        g = gz(person("Иван Петров", f("Иван Петров", True, "ip-1")))
        for text in ("каза Иван. Петров съобщи", "Иван, Петров и трети",
                     "Иван; Петров", "Иван (Петров)", "Иван\nПетров"):
            with self.subTest(text=text):
                self.assertEqual(resolve(text, g), [], text)

    def test_quotes_and_dashes_join_deliberately(self):
        # ⚠️ A DECIDED TRADE, not an oversight. An institution's name
        # legitimately carries internal quotes and dashes — ОУ „Христо
        # Ботев", „В и К" ООД, Гечева - Захариева — and a spaces-only gap
        # made 3,211 resolvable forms (34.4% of the gazetteer) unreachable,
        # including a sitting minister in both spellings a newsroom writes.
        # The cost is that „Иван" Петров — a quoted given name followed by a
        # surname — can now form. That shape is vanishingly rare in Bulgarian
        # news prose; 3,211 dead entries were not.
        g = gz({"kind": "institution", "canonical": "ОУ Христо Ботев",
                "forms": [f("ОУ „Христо Ботев\u201c", True, "1")]})
        self.assertEqual(len(resolve("ОУ „Христо Ботев\u201c получи", g)), 1)
        # …and the sentence terminators still separate.
        self.assertEqual(resolve("ОУ. Христо Ботев", g), [])

    def test_a_surface_may_span_ordinary_whitespace(self):
        g = gz(person("Иван Петров", f("Иван Петров", True, "ip-1")))
        for text in ("Иван Петров", "Иван  Петров", "Иван\u00a0Петров"):
            with self.subTest(text=text):
                self.assertEqual(len(resolve(text, g)), 1, text)

    def test_it_reads_title_description_and_body(self):
        g = gz(person("Иван Петров", f("Иван Петров", True, "ip-1")))
        for field in ("title", "description", "content"):
            with self.subTest(field=field):
                rec = {field: "Иван Петров заяви"}
                self.assertEqual(len(resolve(article_text(rec), g)), 1)

    def test_a_missing_field_is_not_a_crash(self):
        self.assertEqual(article_text({}), "\n\n")
        self.assertEqual(article_text({"title": None}), "\n\n")


class GazetteerLoading(unittest.TestCase):
    def test_an_over_long_surface_is_skipped(self):
        # The longest institution name in the corpus is 67 words; a window
        # that long is 67 dict lookups per token for entries nobody writes out.
        long_name = " ".join(["дума"] * 40)
        g = gz({"kind": "institution", "canonical": long_name,
                "forms": [f(long_name, True, "1")]})
        self.assertEqual(g.by_surface, {})

    def test_two_entries_can_claim_one_surface(self):
        # ⚠️ A LIST per key, not a single form — keeping only one would pick
        # by file order, which is exactly the party-surface defect the
        # gazetteer builder already had once.
        g = gz(person("А", f("Х", True, "a-1")), person("Б", f("Х", True, "b-1")))
        self.assertEqual(len(g.by_surface[fold("Х")]), 2)



class DefiniteArticle(unittest.TestCase):
    """⚠️ Bulgarian institutions take the definite article and personal names
    do not, so a newsroom writes „Антикорупционната комисия" where the
    register holds the bare form — and nothing in the gazetteer carries the
    inflected spelling."""

    def test_the_article_comes_off_the_FIRST_word(self):
        self.assertIn("Софийска градска прокуратура",
                      undefinite_forms("Софийската градска прокуратура"))

    def test_a_feminine_noun_gets_its_ya_back(self):
        # „Комисията" − „та" is „Комисия"; the bare stem is tried too.
        self.assertIn("Комисия", undefinite_forms("Комисията"))

    def test_NATA_is_not_a_suffix(self):
        # ⚠️ „ната"/„ята" look like suffixes and are not — the „н" belongs to
        # the stem, so stripping them yields „Антикорупцион", not a word.
        forms = undefinite_forms("Антикорупционната комисия")
        self.assertIn("Антикорупционна комисия", forms)
        self.assertNotIn("Антикорупцион комисия", forms)

    def test_a_short_word_is_left_alone(self):
        # ⚠️ The word must actually END in a suffix, or the floor is never
        # reached and the test proves nothing — „Съда" ends in „да" and was
        # the first version of this, which let the floor be deleted silently.
        # „Тото" ends in „то" and leaves a two-letter stem.
        self.assertEqual(undefinite_forms("Тото"), [])
        self.assertEqual(undefinite_forms("Ято"), [])

    def test_a_word_with_no_article_yields_nothing(self):
        # ⚠️ Empty, not the same string back — a caller must be able to tell
        # „no alternative spelling" from „try this again".
        self.assertEqual(undefinite_forms("България"), [])

    def test_it_never_returns_the_input(self):
        for w in ("Комисията", "Софийската градска прокуратура", "Прокуратурата"):
            self.assertNotIn(w, undefinite_forms(w))

if __name__ == "__main__":
    unittest.main()
