#!/usr/bin/env python3
"""Tests for build_gazetteer.py — the surface forms, and what each may claim.

⚠️ ONE rule underlies every test here: a surface form may carry an identity
only when that surface identifies exactly one public figure IN BULGARIA, not
one within whatever roster we happened to build. The plan specified „the bare
surname where it is unique within the roster", and the corpus refutes it:

    254 current MPs
    175 have a surname unique WITHIN that roster
     …137 of those are shared with at least one other public figure
     …only 27 are nationally unique
    „Иванов" alone is 1,554 public figures, „Георгиева" 678

The same measurement kills the weaker version: a three-part name is shared by
9,774 of 63,816 public figures (15.3%), so even the full name is not
automatically safe.

Run:  python3 news/scripts/test_build_gazetteer.py
"""

import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_gazetteer import (  # noqa: E402
    COMMON_WORDS_MIN_ARTICLES, GIVEN_NAME_EXEMPT, MIN_SURFACE_CHARS,
    PLACE_STOPWORDS, build_aliases, form, institution_entries,
    is_common_given_name,
    is_common_word, party_entries, people_entries, person_forms,
    place_entries, scan_common_words)

GAZETTEER = (Path(os.environ.get("DATA_BG_ROOT")
                  or Path(__file__).resolve().parents[2])
             / "news" / "data" / "gazetteer.json")


class TheIdLivesOnTheForm(unittest.TestCase):
    """⚠️ The safety property of the whole file.

    With the id on the ENTRY, a person whose every form was ambiguous still
    published a perfectly good-looking slug — 204 of them — and any consumer
    reading `entry.id` after a surface hit would link „Александър
    Александров" (47 public figures) to one specific person.
    """

    def test_a_refused_form_carries_no_id(self):
        self.assertIsNone(form("Иванов", False, "shared", "ivan-1")["id"])

    def test_a_resolvable_form_carries_the_id_it_was_given(self):
        self.assertEqual(form("Делян Пеевски", True, "unique", "dp-1")["id"],
                         "dp-1")

    def test_the_invariant_is_total(self):
        # resolvable is False  ⟺  id is None, for every combination.
        for resolvable in (True, False):
            for ident in ("x-1", None):
                f = form("Име", resolvable, "why", ident)
                self.assertEqual(f["id"] is None,
                                 not resolvable or ident is None)


class SurnamesNeverResolve(unittest.TestCase):
    def forms_for(self, full=1, full_self=True, two=1, two_self=True, sur=1):
        return person_forms("dp-1", "Делян Славчев Пеевски", "Делян",
                            "Пеевски", full, full_self, two, two_self, sur)

    def by_surface(self, forms, surface):
        return next(f for f in forms if f["surface"] == surface)

    def test_the_bare_surname_is_never_resolvable(self):
        # ⚠️ Not even when it is the ONLY holder in the corpus. A surname is a
        # coreference anchor: it attaches „Пеевски" in ¶4 to „Делян Пеевски"
        # in ¶1 of the SAME document. Letting it stand alone is a claim about
        # which Пеевски a newsroom meant, and that claim is not ours to make.
        for sur in (1, 2, 1554):
            with self.subTest(surname_holders=sur):
                f = self.by_surface(self.forms_for(sur=sur), "Пеевски")
                self.assertFalse(f["resolvable"])
                self.assertIsNone(f["id"])

    def test_the_surname_form_says_why(self):
        f = self.by_surface(self.forms_for(sur=1554), "Пеевски")
        self.assertIn("1554", f["why"])
        self.assertIn("coreference anchor", f["why"])

    def test_a_short_surname_gets_no_form_at_all(self):
        forms = person_forms("x-1", "Иван Петров Ем", "Иван", "Ем",
                             1, True, 1, True, 1)
        self.assertNotIn("Ем", [f["surface"] for f in forms])


class UniquenessIsMeasuredNationally(unittest.TestCase):
    def test_the_two_part_form_follows_the_public_figure_count(self):
        forms = person_forms("dp-1", "Делян Славчев Пеевски", "Делян",
                             "Пеевски", 1, True, 1, True, 90)
        two = next(f for f in forms if f["surface"] == "Делян Пеевски")
        self.assertTrue(two["resolvable"])
        self.assertEqual(two["id"], "dp-1")

        forms = person_forms("aa-1", "Александър Иванов Александров",
                             "Александър", "Александров",
                             11, True, 47, True, 224)
        two = next(f for f in forms if f["surface"] == "Александър Александров")
        self.assertFalse(two["resolvable"])
        self.assertIsNone(two["id"])
        self.assertIn("46", two["why"])

    def test_the_FULL_name_is_checked_too(self):
        # ⚠️ The obvious version marks the three-part form resolvable
        # unconditionally — it is the identity layer's own key, so it feels
        # safe. 15.3% of public figures share one. Marking it true by default
        # reported „0 people with no resolvable form" over a roster where the
        # real count is 202, which is the kind of coverage figure that reads
        # as success.
        forms = person_forms("x-1", "Ахмед Сюлейман Мехмед", "Ахмед",
                             "Мехмед", 5, True, 9, True, 221)
        self.assertEqual([f["resolvable"] for f in forms], [False, False, False])
        self.assertEqual([f["id"] for f in forms], [None, None, None])

    def test_a_unique_match_that_is_SOMEBODY_ELSE_is_refused(self):
        # ⚠️⚠️ THE compound-surname defect, and a count alone cannot see it.
        # „Надя Спасова Клисурска - Жекова" splits to the two-part surface
        # „Надя Жекова", which matches exactly one public figure — and it is
        # NOT her, because her family fold is the compound. Resolving on the
        # count would have linked her name to a stranger.
        forms = person_forms("nk-1", "Надя Спасова Клисурска - Жекова",
                             "Надя", "Жекова",
                             1, True, 1, False, 26)
        two = next(f for f in forms if f["surface"] == "Надя Жекова")
        self.assertFalse(two["resolvable"])
        self.assertIsNone(two["id"])
        self.assertIn("not this one", two["why"])
        # The full name still resolves — it does fold to her.
        self.assertTrue(forms[0]["resolvable"])

    def test_a_full_name_that_does_not_fold_to_this_person_is_refused(self):
        forms = person_forms("x-1", "Име Презиме Фамилия", "Име", "Фамилия",
                             1, False, 1, True, 1)
        self.assertFalse(forms[0]["resolvable"])
        self.assertIn("does not fold", forms[0]["why"])

    def test_the_surname_count_is_the_EMITTED_surface_count(self):
        # The `why` string must describe the string it sits on. Before the
        # fix it quoted the DB's fold-column count — „Жекова … 1 public
        # figures share it" against a measured 26.
        forms = person_forms("nk-1", "Надя Спасова Клисурска - Жекова",
                             "Надя", "Жекова", 1, True, 1, False, 26)
        sur = next(f for f in forms if f["surface"] == "Жекова")
        self.assertIn("26", sur["why"])

    def test_a_person_can_be_unreachable_by_name_and_that_is_recorded(self):
        forms = person_forms("x-1", "Албена Николова Георгиева", "Албена",
                             "Георгиева", 5, True, 6, True, 678)
        self.assertFalse(any(f["resolvable"] for f in forms))
        # Kept, not dropped: coreference can still reach them, and the count
        # is the honest measure of how far names get us.
        self.assertEqual(len(forms), 3)

    def test_a_two_part_name_produces_no_duplicate_form(self):
        # „Иван Петров" has two parts, so given+family IS the full name.
        forms = person_forms("x-1", "Иван Петров", "Иван", "Петров",
                             1, True, 1, True, 1)
        self.assertEqual([f["surface"] for f in forms], ["Иван Петров", "Петров"])

    def test_a_single_part_name_produces_no_surname_form(self):
        # ⚠️ A one-token name IS its own surname, so emitting the surname form
        # would duplicate the full name — and the duplicate would be an
        # ANCHOR, silently shadowing the resolvable one for any resolver that
        # takes the last match.
        forms = person_forms("x-1", "Мадона", "Мадона", "Мадона",
                             1, True, 1, True, 1)
        self.assertEqual([f["surface"] for f in forms], ["Мадона"])
        self.assertTrue(forms[0]["resolvable"])


class PureEntryBuilders(unittest.TestCase):
    """The grouping rules, driven directly — no Postgres, no artifact.

    ⚠️ These exist because the first cut's only coverage of them was
    `TheBuiltArtifact`, which reads the COMMITTED file: mutating the builder
    changed nothing those tests could see, and 5 of 9 mutations survived.
    """

    def test_institutions_group_case_insensitively(self):
        # ⚠️ 1,511 case-variant groups in the corpus, six of them spanning
        # different EIKs — so „В И К ООД" and „В и К ООД" were two entries,
        # each claiming a resolvable id for the same name.
        rows = [{"eik": "1", "name": "В И К ООД", "contracts": 30},
                {"eik": "2", "name": "В и К ООД", "contracts": 90}]
        entries, cov = institution_entries(rows)
        self.assertEqual(len(entries), 1)
        self.assertFalse(entries[0]["forms"][0]["resolvable"])
        self.assertIsNone(entries[0]["forms"][0]["id"])
        self.assertEqual(cov["institutions_ambiguous"], 1)

    def test_one_institution_spelled_twice_still_resolves(self):
        rows = [{"eik": "1", "name": "Община Ямбол", "contracts": 30},
                {"eik": "1", "name": "ОБЩИНА ЯМБОЛ", "contracts": 90}]
        entries, _ = institution_entries(rows)
        self.assertEqual(len(entries), 1)
        self.assertTrue(entries[0]["forms"][0]["resolvable"])
        self.assertEqual(entries[0]["forms"][0]["id"], "1")
        # The spelling shown is the busiest holder's, deterministically.
        self.assertEqual(entries[0]["canonical"], "ОБЩИНА ЯМБОЛ")

    def test_a_common_word_institution_advertises_no_id(self):
        # ⚠️ „Чистота" is a municipal cleaning company AND the word
        # cleanliness. The form is refused by the common-word filter, and the
        # entry must follow — an id set from name-uniqueness alone advertises
        # a link the only form on it will not honour.
        import build_gazetteer as b
        saved = b.COMMON_WORDS
        b.COMMON_WORDS = frozenset({"чистота"})
        try:
            entries, _ = institution_entries(
                [{"eik": "1", "name": "Чистота", "contracts": 99}])
        finally:
            b.COMMON_WORDS = saved
        self.assertFalse(entries[0]["forms"][0]["resolvable"])
        self.assertIsNone(entries[0]["forms"][0]["id"])
        self.assertIsNone(entries[0]["id"])

    def test_a_common_word_place_advertises_no_id(self):
        import build_gazetteer as b
        saved = b.COMMON_WORDS
        b.COMMON_WORDS = frozenset({"река"})
        try:
            entries, _ = place_entries(
                [{"kind": "settlement", "code": "1", "name_bg": "Река",
                  "obl": "SML", "obs": "SML01"}])
        finally:
            b.COMMON_WORDS = saved
        self.assertFalse(entries[0]["forms"][0]["resolvable"])
        self.assertIsNone(entries[0]["id"])

    def test_a_multi_word_surface_is_not_filtered_on_its_parts(self):
        # ⚠️ „Стара Загора" contains „стара", an ordinary adjective, and is
        # not remotely ambiguous. Filtering multi-word surfaces on their parts
        # would delete most of the real place names in the country.
        import build_gazetteer as b
        saved = b.COMMON_WORDS
        b.COMMON_WORDS = frozenset({"стара", "загора"})
        try:
            entries, _ = place_entries(
                [{"kind": "settlement", "code": "1", "name_bg": "Стара Загора",
                  "obl": "SZR", "obs": "SZR01"}])
        finally:
            b.COMMON_WORDS = saved
        self.assertTrue(entries[0]["forms"][0]["resolvable"])

    def test_an_UMBRELLA_eik_does_not_resolve(self):
        # ⚠️⚠️ THE WRONG LINK THIS RULE EXISTS FOR. „Софийска градска
        # прокуратура" is a unique NAME, but its EIK (121817309) is the whole
        # prosecution service — 179 district and regional offices share one
        # legal entity — so the reader landed on a page titled „Прокуратура
        # на република българия", seated in Благоевград. Asking only „is this
        # name unique to one EIK" cannot see that; the reverse question can.
        rows = [{"eik": "121817309", "name": "Софийска градска прокуратура",
                 "contracts": 892, "names_on_eik": 179}]
        entries, cov = institution_entries(rows)
        self.assertFalse(entries[0]["forms"][0]["resolvable"])
        self.assertIsNone(entries[0]["id"])
        self.assertIn("umbrella", entries[0]["forms"][0]["why"])

    def test_a_single_named_eik_still_resolves(self):
        rows = [{"eik": "000970496", "name": "Община Ямбол",
                 "contracts": 99, "names_on_eik": 1}]
        entries, _ = institution_entries(rows)
        self.assertTrue(entries[0]["forms"][0]["resolvable"])
        self.assertEqual(entries[0]["id"], "000970496")

    def test_the_two_refusals_are_DISTINGUISHABLE(self):
        # „two bodies share this name" and „this EIK is a legal umbrella" are
        # different facts and a reviewer acts on them differently.
        shared_name = institution_entries([
            {"eik": "1", "name": "ОУ Христо Ботев", "contracts": 30,
             "names_on_eik": 1},
            {"eik": "2", "name": "ОУ Христо Ботев", "contracts": 40,
             "names_on_eik": 1}])[0][0]["forms"][0]["why"]
        umbrella = institution_entries([
            {"eik": "3", "name": "Районна прокуратура", "contracts": 9,
             "names_on_eik": 50}])[0][0]["forms"][0]["why"]
        self.assertIn("share this name", shared_name)
        self.assertIn("umbrella", umbrella)
        self.assertNotIn("umbrella", shared_name)

    def test_a_contested_party_surface_resolves_to_NEITHER(self):
        # ⚠️ The single-pass version claimed each surface with `setdefault`,
        # awarding it to whichever party the file listed FIRST — six
        # contested surfaces shipped resolvable ids, and re-sorting the
        # source file would have moved them to a different party.
        doc = {"parties": [
            {"id": "a", "displayName": "Партия А",
             "history": [{"nickName": "Коалиция Х"}]},
            {"id": "b", "displayName": "Партия Б",
             "history": [{"nickName": "Коалиция Х"}]},
        ]}
        entries, cov = party_entries(doc)
        for e in entries:
            shared = next(f for f in e["forms"] if f["surface"] == "Коалиция Х")
            self.assertFalse(shared["resolvable"])
            self.assertIsNone(shared["id"])
            own = next(f for f in e["forms"] if f["surface"].startswith("Партия"))
            self.assertTrue(own["resolvable"])
        self.assertEqual(cov["party_forms_contested"], 2)

    def test_party_order_does_not_decide_a_contest(self):
        doc = {"parties": [
            {"id": "a", "displayName": "Партия А", "history": [{"name": "Общо"}]},
            {"id": "b", "displayName": "Партия Б", "history": [{"name": "Общо"}]},
        ]}
        forward, _ = party_entries(doc)
        doc["parties"].reverse()
        backward, _ = party_entries(doc)
        pick = lambda es: {e["canonical"]: [f["resolvable"] for f in e["forms"]]
                           for e in es}
        self.assertEqual(pick(forward), pick(backward))

    def test_a_place_id_is_kind_qualified(self):
        # ⚠️ `place_dim.code` is unique per (kind, code) and NOT on its own:
        # `AF` is both an obshtina and a settlement, `BGS` both a mir and an
        # oblast. A bare code sends a consumer to whichever table it looked in.
        rows = [{"kind": "obshtina", "code": "AF", "name_bg": "Айтос",
                 "obl": "BGS", "obs": "AF"}]
        entries, _ = place_entries(rows)
        self.assertEqual(entries[0]["id"], "obshtina:AF")
        self.assertEqual(entries[0]["forms"][0]["id"], "obshtina:AF")

    def test_one_place_at_several_levels_still_resolves(self):
        # ⚠️ SAME NAME ≠ DIFFERENT PLACE. „Пловдив" is a settlement, an
        # obshtina and an oblast — three rows, one city — and counting rows
        # called that a 3-way ambiguity and refused to link the second-largest
        # city in the country, along with Варна, Русе, Бургас and 211 other
        # groups.
        rows = [{"kind": "settlement", "code": "56784", "name_bg": "Пловдив",
                 "obl": "PDV", "obs": "PDV22"},
                {"kind": "obshtina", "code": "PDV22", "name_bg": "Пловдив",
                 "obl": "PDV", "obs": "PDV22"},
                {"kind": "oblast", "code": "PDV", "name_bg": "Пловдив",
                 "obl": "PDV", "obs": None}]
        entries, cov = place_entries(rows)
        self.assertEqual(len(entries), 1)
        self.assertTrue(entries[0]["forms"][0]["resolvable"])
        # The most SPECIFIC level — a reader means the city.
        self.assertEqual(entries[0]["id"], "settlement:56784")
        self.assertEqual(cov["places_collapsed_to_one"], 1)
        self.assertEqual(cov["places_ambiguous"], 0)

    def test_the_collapse_does_not_swallow_real_homonyms(self):
        # „Левски" really is villages in three different oblasti.
        rows = [{"kind": "settlement", "code": "43236", "name_bg": "Левски",
                 "obl": "PVN", "obs": "PVN16"},
                {"kind": "settlement", "code": "43222", "name_bg": "Левски",
                 "obl": "VAR", "obs": "VAR26"}]
        entries, cov = place_entries(rows)
        self.assertEqual([e["id"] for e in entries], [None, None])
        self.assertEqual(cov["places_collapsed_to_one"], 0)

    def test_homonym_places_resolve_to_neither(self):
        rows = [{"kind": "settlement", "code": "1", "name_bg": "Абланица",
                 "obl": "BLG", "obs": "BLG01"},
                {"kind": "settlement", "code": "2", "name_bg": "Абланица",
                 "obl": "LOV", "obs": "LOV02"}]
        entries, cov = place_entries(rows)
        self.assertEqual([e["id"] for e in entries], [None, None])
        self.assertEqual(cov["places_ambiguous"], 2)

    def test_a_stopworded_place_is_dropped_and_counted(self):
        rows = [{"kind": "settlement", "code": "1", "name_bg": "Победа",
                 "obl": "PDV", "obs": "PDV01"},
                {"kind": "settlement", "code": "2", "name_bg": "Айтос",
                 "obl": "BGS", "obs": "BGS01"}]
        entries, cov = place_entries(rows)
        self.assertEqual([e["canonical"] for e in entries], ["Айтос"])
        self.assertEqual(cov["places_stopworded"], 1)

    def test_people_entries_withholds_the_entry_id_when_nothing_resolves(self):
        rows = [{"slug": "x-1", "display_name": "Албена Николова Георгиева",
                 "tier": "mp", "party": None, "s_full": "Албена Николова Георгиева",
                 "tok_first": "Албена", "tok_last": "Георгиева",
                 "full_n": 5, "full_self": True, "two_n": 6, "two_self": True,
                 "sur_n": 678}]
        entries, cov = people_entries(rows, "52")
        self.assertIsNone(entries[0]["id"])
        self.assertEqual(cov["people_with_no_resolvable_form"], 1)

    def test_people_entries_reports_the_tier_mix_and_its_caveat(self):
        # ⚠️ 213 „regional_governor" rows against Bulgaria's 28 oblasti: the
        # test is `end_date IS NULL`, which means „no end date recorded", not
        # „still serving". Stated rather than implied.
        rows = [{"slug": "a", "display_name": "Абил Исмет Абил", "tier": "mp",
                 "party": None, "s_full": "Абил Исмет Абил", "tok_first": "Абил",
                 "tok_last": "Абил", "full_n": 1, "full_self": True,
                 "two_n": 1, "two_self": True, "sur_n": 4}]
        _, cov = people_entries(rows, "52")
        self.assertEqual(cov["people_by_tier"], {"mp": 1})
        self.assertIn("NOT current", cov["tiers_mean"])


class PlaceStopwords(unittest.TestCase):
    def test_words_that_are_also_villages_are_excluded(self):
        # ⚠️ A DENY list rather than a length rule, because length does not
        # separate them: „Победа" is six characters and is both a village and
        # the word victory.
        for word in ("победа", "средище", "надежда", "младост"):
            self.assertIn(word, PLACE_STOPWORDS)

    def test_it_is_matched_case_folded(self):
        self.assertTrue(all(w == w.casefold() for w in PLACE_STOPWORDS),
                        "entries must be pre-folded or the lookup misses")


class TheCommonWordFilter(unittest.TestCase):
    """⚠️ The dominant false match, and no length or kind rule separates it.

    Measured over 400 articles before this existed: 87% of all mentions were
    places, and the frequent ones were „места" (204 lowercase corpus
    occurrences), „подкрепа" (225), „било" (149), „река" (63) — every one a
    real village AND a word a newsroom writes constantly. „места" resolved as
    `gazetteer_exact` to a village, from an article about parking. Every true
    place — София, Пловдив, Варна, Германия — has exactly ZERO.
    """

    def setUp(self):
        import build_gazetteer as b
        self.b = b
        self._words, self._given = b.COMMON_WORDS, b.COMMON_GIVEN_NAMES
        b.COMMON_WORDS = frozenset({"места", "река", "стара"})
        b.COMMON_GIVEN_NAMES = frozenset({"владимир", "софия"})
        self.addCleanup(self.restore)

    def restore(self):
        self.b.COMMON_WORDS, self.b.COMMON_GIVEN_NAMES = self._words, self._given

    def test_a_one_word_common_noun_is_refused(self):
        self.assertTrue(is_common_word("Места"))
        self.assertFalse(form("Места", True, "why", "x", "place")["resolvable"])

    def test_a_multi_word_surface_is_never_filtered_on_its_parts(self):
        # ⚠️ „Стара Загора" contains an ordinary adjective and is not remotely
        # ambiguous. Filtering on parts deletes most of the country.
        self.assertFalse(is_common_word("Стара Загора"))
        self.assertTrue(form("Стара Загора", True, "why", "x", "place")["resolvable"])

    def test_a_common_given_name_is_refused_for_PLACES_ONLY(self):
        # ⚠️ „Владимир" is a village and 942 people's first name; it never
        # appears lowercase, so the word filter cannot see it.
        self.assertTrue(is_common_given_name("Владимир"))
        self.assertFalse(form("Владимир", True, "w", "x", "place")["resolvable"])
        # A party or institution named after somebody must not be refused.
        self.assertTrue(form("Владимир", True, "w", "x", "party")["resolvable"])
        self.assertTrue(form("Владимир", True, "w", "x", None)["resolvable"])

    def test_the_capital_is_exempt_and_the_exemption_is_narrow(self):
        # ⚠️ 53 of the 54 collisions are villages and the filter is right
        # about them. It is wrong about exactly one: София is the capital, and
        # 121 public figures share the name.
        self.assertIn("софия", GIVEN_NAME_EXEMPT)
        self.assertFalse(is_common_given_name("София"))
        self.assertTrue(form("София", True, "w", "x", "place")["resolvable"])
        self.assertEqual(len(GIVEN_NAME_EXEMPT), 1,
                         "the exemption list is curated — a new entry needs "
                         "its own reasoning, not a threshold tuned to fit")

    def test_each_refusal_records_a_MACHINE_READABLE_reason(self):
        # ⚠️ The consumer has to ACT on this and `why` is prose. Without a
        # code, the resolver cannot tell „refused because it is an ordinary
        # word" (a known non-entity) from „refused because two people share
        # it" (a review candidate) — and it emitted 583 mentions of the first
        # kind into the roster-review queue.
        self.assertEqual(form("Места", True, "w", "x", "place")["refusal"],
                         "common_word")
        self.assertEqual(form("Владимир", True, "w", "x", "place")["refusal"],
                         "given_name")

    def test_an_ORDINARY_refusal_carries_no_reason_code(self):
        # ⚠️ The surface must be one NEITHER filter matches, or this pins
        # nothing: the first version used „Иванов" — not in the fixture's
        # word or given-name sets — so removing the guards from both branches
        # of form() left it green, which is also how 99 shipped forms came to
        # be common words with no reason code.
        self.assertNotIn("refusal", form("Гоце Делчев", False, "shared", "x"))
        self.assertIn("refusal", form("Места", False, "shared", "x", "place"))

    def test_an_ALREADY_refused_common_word_still_gets_its_code(self):
        # ⚠️ Gated on `resolvable`, the code was computed only for forms the
        # filter itself refused — so a common word the CALLER had already
        # refused as an ambiguity carried none, and the resolver put it back
        # in the roster-review queue. 99 shipped forms were in that state.
        f = form("Места", False, "3 distinct places share this name", "x", "place")
        self.assertEqual(f["refusal"], "common_word")
        # …and the caller's reason survives, being the more useful one.
        self.assertIn("3 distinct places", f["why"])

    def test_the_filters_leave_the_anchor_in_place(self):
        # „Места" really is a village; a document that establishes it some
        # other way can still corefer to it.
        f = form("Места", True, "why", "settlement:1", "place")
        self.assertFalse(f["resolvable"])
        self.assertIsNone(f["id"])
        self.assertEqual(f["anchor_for"], "settlement:1")


class TheCommonWordScan(unittest.TestCase):
    def test_it_counts_only_LOWERCASE_tokens(self):
        # ⚠️ Lowercase is the whole discriminator. A capitalised „Места" is
        # ambiguous between a village and a sentence-initial common noun; a
        # lowercase „места" can only be the word.
        import json as _json
        import tempfile
        root = Path(tempfile.mkdtemp())
        (root / "x.bg").mkdir()
        for i in range(6):
            (root / "x.bg" / f"a{i}.json").write_text(_json.dumps(
                {"content": "Места за паркиране. места, места и още места. "
                            "Пловдив е град."}), encoding="utf-8")
        doc = scan_common_words(root, min_count=5)
        self.assertIn("места", doc["words"])
        self.assertNotIn("пловдив", doc["words"])
        self.assertEqual(doc["articles_scanned"], 6)

    def test_an_uppercase_token_is_not_counted_however_often_it_appears(self):
        # ⚠️ The discriminator is LOWERCASE. Counting every token makes every
        # frequently-named place a „common word" — „Пловдив" would be refused
        # along with „места", and the filter would delete the corpus rather
        # than clean it.
        import json as _json
        import tempfile
        root = Path(tempfile.mkdtemp())
        (root / "x.bg").mkdir()
        for i in range(9):
            (root / "x.bg" / f"a{i}.json").write_text(_json.dumps(
                {"content": "Пловдив Пловдив Пловдив. места места места."}),
                encoding="utf-8")
        doc = scan_common_words(root, min_count=5)
        self.assertIn("места", doc["words"])
        # ⚠️ Asserting „пловдив" is absent proves NOTHING: the counter keys
        # on the RAW token, so counting uppercase would store „Пловдив" and
        # the lowercase probe misses it either way. What the rule actually
        # guarantees is that every stored word is lowercase.
        self.assertNotIn("Пловдив", doc["words"])
        self.assertEqual([w for w in doc["words"] if w != w.lower()], [],
                         "an uppercase token reached the common-word list")

    def test_the_rebuild_refuses_rather_than_clobbering(self):
        # ⚠️⚠️ news/data/<domain>/ is GITIGNORED, so on any machine without
        # the corpus the scan returns `words: []` — and writing that clobbers
        # the committed 21,943-word artifact, after which the `exists()`
        # guard is satisfied, the filter silently does nothing, and „Места"
        # is a resolvable village again at exit 0.
        import subprocess
        import tempfile
        root = Path(tempfile.mkdtemp())
        (root / "news" / "data").mkdir(parents=True)
        committed = root / "news" / "data" / "common_words.json"
        committed.write_text(json.dumps(
            {"articles_scanned": 4280, "min_count": 5,
             "words": ["места", "река"]}), encoding="utf-8")
        proc = subprocess.run(
            [sys.executable,
             str(Path(__file__).with_name("build_gazetteer.py")),
             "--rebuild-common-words"],
            capture_output=True, text=True,
            env={**os.environ, "DATA_BG_ROOT": str(root)})
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("refusing to overwrite", proc.stderr)
        kept = json.loads(committed.read_text(encoding="utf-8"))
        self.assertEqual(kept["words"], ["места", "река"])

    def test_the_article_floor_is_a_real_number(self):
        # The rebuild refuses below this rather than overwriting the
        # committed artifact with an empty list — see main().
        self.assertGreater(COMMON_WORDS_MIN_ARTICLES, 0)


class TheInstitutionAliases(unittest.TestCase):
    """⚠️ Every entry ASSERTS that an abbreviation means an EIK — a claim
    about a named public body, made by hand. These tests check the file's
    shape; `institution_aliases.data.test`-style verification against the
    live corpus is the arm below."""

    @classmethod
    def setUpClass(cls):
        path = (Path(__file__).resolve().parents[1] / "data"
                / "institution_aliases.json")
        if not path.exists():
            raise unittest.SkipTest(
                f"{path} absent — SKIPPING, not passing.")
        cls.doc = json.loads(path.read_text(encoding="utf-8"))

    def test_every_alias_carries_its_EVIDENCE(self):
        # ⚠️ „МВР means 000695235" is unfalsifiable without saying how it was
        # checked. An entry with no evidence is a guess wearing a fact's
        # clothes, and the next person cannot tell which it was.
        for a in self.doc["aliases"]:
            self.assertTrue(a.get("evidence"), a["alias"])
            self.assertGreater(len(a["evidence"]), 30, a["alias"])
            self.assertTrue(a.get("eik"), a["alias"])
            self.assertTrue(a.get("display"), a["alias"])
            self.assertIsInstance(a.get("names_on_eik"), int, a["alias"])

    def test_the_REFUSALS_are_published_with_reasons(self):
        # ⚠️ „КЗК is not linked" must read as a decision, not an oversight —
        # its EIK carries a school and a power company alongside the
        # commission, which is worth knowing before someone adds it.
        aliased = {a["alias"] for a in self.doc["aliases"]}
        for r in self.doc["refused"]:
            self.assertNotIn(r["alias"], aliased)
            self.assertGreater(len(r.get("why") or ""), 40, r["alias"])

    def test_no_alias_is_listed_twice(self):
        aliases = [a["alias"] for a in self.doc["aliases"]]
        self.assertEqual(len(aliases), len(set(aliases)))

    def test_the_predecessor_body_is_NOT_aliased(self):
        # ⚠️ 131463734 is КОНПИ/КУИППД, the body КПКОНПИ replaced. Aliasing
        # the current abbreviation to the old EIK would send a reader to a
        # commission that no longer exists.
        eiks = {a["eik"] for a in self.doc["aliases"]}
        self.assertNotIn("131463734", eiks)
        self.assertIn("129010997", eiks)

    def test_an_umbrella_EIK_says_how_it_was_checked(self):
        # ⚠️ АПИ's EIK carries 58 names. It is admitted only because the
        # rendered page was opened and found to show the parent — so the
        # entry has to say that, or the exception looks like an oversight.
        for a in self.doc["aliases"]:
            if a["names_on_eik"] > 5:
                self.assertIn("page", a["evidence"].lower(), a["alias"])


class TheAliasBuilder(unittest.TestCase):
    """`build_aliases()` driven directly — the artifact tests read the
    COMMITTED gazetteer, so mutating the builder changes nothing they see."""

    def test_it_emits_one_entry_per_alias(self):
        entries, cov = build_aliases()
        if not entries:
            self.skipTest("no crosswalk here — SKIPPING, not passing")
        self.assertEqual(len(entries), cov["aliases"])
        surfaces = {e["forms"][0]["surface"] for e in entries}
        self.assertIn("МВР", surfaces)
        self.assertIn("КПКОНПИ", surfaces)

    def test_every_emitted_alias_RESOLVES(self):
        # ⚠️ An alias that came out unresolvable would be a hand-verified
        # claim the builder then threw away — the point of the curation is
        # that it overrides the heuristics.
        entries, _ = build_aliases()
        if not entries:
            self.skipTest("no crosswalk here — SKIPPING, not passing")
        for e in entries:
            f = e["forms"][0]
            self.assertTrue(f["resolvable"], f["surface"])
            self.assertEqual(f["id"], e["id"], f["surface"])

    def test_the_evidence_travels_into_the_gazetteer(self):
        # So „why is МВР linked" is answerable from the artifact alone.
        entries, _ = build_aliases()
        if not entries:
            self.skipTest("no crosswalk here — SKIPPING, not passing")
        why = entries[0]["forms"][0]["why"]
        self.assertIn("hand-verified", why)
        self.assertGreater(len(why), 40)

    def test_each_entry_carries_the_EIK_THE_FILE_NAMES(self):
        # ⚠️ The builder must not substitute an id. „КПКОНПИ → 131463734"
        # would send a reader to the PREDECESSOR commission, and a test that
        # only reads the JSON cannot see a builder that ignores it.
        entries, _ = build_aliases()
        if not entries:
            self.skipTest("no crosswalk here — SKIPPING, not passing")
        path = (Path(__file__).resolve().parents[1] / "data"
                / "institution_aliases.json")
        want = {a["alias"]: a["eik"] for a in
                json.loads(path.read_text(encoding="utf-8"))["aliases"]}
        for e in entries:
            surface = e["forms"][0]["surface"]
            self.assertEqual(e["id"], want[surface], surface)
            self.assertEqual(e["forms"][0]["id"], want[surface], surface)

    def test_the_builder_is_actually_WIRED_INTO_the_build(self):
        # ⚠️ A STATIC SOURCE CHECK, because the artifact tests read the
        # COMMITTED gazetteer: with `build_aliases()` unwired, the committed
        # file still holds the aliases and every other test stays green while
        # the next rebuild drops them.
        src = (Path(__file__).resolve().parent / "build_gazetteer.py").read_text(
            encoding="utf-8")
        body = src[src.index("def main("):]
        # ⚠️ The SEQUENCE, not just the call. Asserting „build_aliases() is
        # mentioned" passes on a main() that calls it and then throws the
        # rows away — which is exactly the shape a careless refactor takes.
        self.assertIn("rows, cov = build_aliases()\n    entries.extend(rows)",
                      body,
                      "main() calls build_aliases but does not extend the "
                      "entries with its rows — the crosswalk would vanish on "
                      "the next rebuild while every artifact test stayed "
                      "green off the committed file")

    def test_the_refusals_reach_the_coverage_block(self):
        _, cov = build_aliases()
        if not cov.get("aliases"):
            self.skipTest("no crosswalk here — SKIPPING, not passing")
        self.assertIn("КЗК", cov["aliases_refused"])


class TheBuiltArtifact(unittest.TestCase):
    """Reads news/data/gazetteer.json when it exists.

    ⚠️ SKIPS on a checkout that has not built one, and says so — a skip must
    never read as a pass. The build needs the identity layer in Postgres,
    which the standalone analysis machine deliberately does not have.
    """

    @classmethod
    def setUpClass(cls):
        if not GAZETTEER.exists():
            raise unittest.SkipTest(
                f"{GAZETTEER} absent — SKIPPING, not passing. Run "
                "`python3 news/scripts/build_gazetteer.py` on a machine with "
                "the identity layer in Postgres.")
        cls.doc = json.loads(GAZETTEER.read_text(encoding="utf-8"))

    def test_no_refused_form_anywhere_carries_an_id(self):
        leaks = [(e["canonical"], f["surface"]) for e in self.doc["entries"]
                 for f in e["forms"] if not f["resolvable"] and f["id"]]
        self.assertEqual(leaks, [])

    def test_no_entry_advertises_an_id_it_cannot_deliver(self):
        bad = [e["canonical"] for e in self.doc["entries"]
               if e["id"] and not any(f["resolvable"] for f in e["forms"])]
        self.assertEqual(bad, [])

    def test_it_is_not_vacuous(self):
        # ⚠️ Without this every assertion above passes on an empty file.
        cov = self.doc["coverage"]
        self.assertGreater(len(self.doc["entries"]), 1000)
        self.assertGreater(cov["people"], 200)
        self.assertGreater(cov["forms_resolvable"], 0)

    def test_the_refusals_are_non_trivial(self):
        # ⚠️ A gazetteer that refuses NOTHING has stopped discriminating, and
        # would look identical to a correct one in every count above.
        cov = self.doc["coverage"]
        self.assertGreater(cov["people_with_no_resolvable_form"], 0)
        self.assertGreater(cov["places_ambiguous"], 0)
        self.assertGreater(cov["institutions_ambiguous"], 0)
        self.assertLess(cov["forms_resolvable"], cov["forms_total"])

    def test_companies_are_absent_and_the_absence_is_explained(self):
        # ⚠️ „no company entries" must not read as „no companies matched".
        cov = self.doc["coverage"]
        self.assertEqual(cov["companies"], 0)
        self.assertIn("EIK", cov["companies_excluded_because"])
        self.assertEqual([e for e in self.doc["entries"]
                          if e["kind"] == "company"], [])

    def test_no_surface_is_shorter_than_the_floor(self):
        # ⚠️ ONE EXEMPTION, and it is the curated crosswalk. „МВР" is three
        # characters, which the floor exists to exclude — because in FREE
        # TEXT a three-letter token is noise. An alias never meets free text:
        # the string arrives already classified by the model as an
        # institution and is matched against a hand-verified list of seven.
        # The exemption is checked AGAINST THAT FILE, not hard-coded, so a
        # short surface arriving from anywhere else still fails.
        path = (Path(__file__).resolve().parents[1] / "data"
                / "institution_aliases.json")
        allowed = set()
        if path.exists():
            allowed = {a["alias"] for a in
                       json.loads(path.read_text(encoding="utf-8"))["aliases"]}
        short = [f["surface"] for e in self.doc["entries"] for f in e["forms"]
                 if len(f["surface"]) < MIN_SURFACE_CHARS
                 and f["surface"] not in allowed]
        self.assertEqual(short, [])

    def test_every_short_surface_IS_an_alias(self):
        # The converse, so the exemption cannot quietly widen: anything under
        # the floor must be in the crosswalk and must carry its evidence.
        path = (Path(__file__).resolve().parents[1] / "data"
                / "institution_aliases.json")
        if not path.exists():
            self.skipTest("no crosswalk here — SKIPPING, not passing")
        by_alias = {a["alias"]: a for a in
                    json.loads(path.read_text(encoding="utf-8"))["aliases"]}
        short = {f["surface"] for e in self.doc["entries"] for f in e["forms"]
                 if len(f["surface"]) < MIN_SURFACE_CHARS}
        self.assertTrue(short, "no short surfaces at all — is the crosswalk "
                               "reaching the gazetteer?")
        for s in short:
            self.assertIn(s, by_alias)
            self.assertTrue(by_alias[s].get("evidence"))

    def test_no_stopworded_place_survived(self):
        surfaces = {f["surface"].casefold() for e in self.doc["entries"]
                    if e["kind"] == "place" for f in e["forms"]}
        self.assertEqual(sorted(surfaces & PLACE_STOPWORDS), [])


if __name__ == "__main__":
    unittest.main()
