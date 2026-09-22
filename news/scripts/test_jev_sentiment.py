#!/usr/bin/env python3
"""T4.4 — subjects, roles, the cache key and the sidecar store. No network."""
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import jev_axes as ax  # noqa: E402
import jev_client as jc  # noqa: E402
import jev_scales as js  # noqa: E402
import jev_sentiment as sm  # noqa: E402

ARTICLE = {
    "url": "https://a.bg/1",
    "title": "ПП-ДБ пита кой контролира плановете",
    "content": ("ПП-ДБ внесе питане. Общинският съветник Иван Иванов подписа. "
                "ГЕРБ не коментира. Иван говори по-късно."),
}
ANALYSIS = {"entities": {"parties": ["ПП-ДБ", "ГЕРБ"], "people": ["Иван Иванов", "Иван"]}}


def article(**over):
    return {**ARTICLE, **over}


def role_agreement():
    """`(matrix, n)` over the model-assigned roles in the person_tones sidecars.

    The plan's §3.7 check. The labelled population is `person_tones` identities
    rather than `entities` names, so it is indicative and reported, never a
    gate — which is what the plan asks for in those words.
    """
    import collections
    import glob
    root = HERE.parent.parent
    by_url = {}
    for path in glob.glob(str(root / "news/data/analysis/articles/*/*.json")):
        try:
            doc = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if doc.get("url"):
            by_url[doc["url"]] = doc
    matrix = collections.Counter()
    for path in glob.glob(str(root / "news/data/analysis/person_tones/*.json")):
        try:
            doc = json.loads(Path(path).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        analysis = by_url.get(doc.get("url"))
        if not analysis:
            continue
        try:
            art = json.loads((root / analysis["article_path"]).read_text(encoding="utf-8"))
        except (OSError, ValueError, KeyError):
            continue
        text = f"{art.get('title') or ''}\n{art.get('content') or ''}"
        title = art.get("title") or ""
        for row in doc.get("person_tones") or []:
            role = row.get("subject_role")
            refs = [r for r in row.get("mention_refs") or [] if isinstance(r, str)]
            if role not in sm.SUBJECT_ROLES or not refs:
                continue
            name = max(refs, key=len)
            subject = {"name": name, "kind": "person",
                       "mentions": sm.count_mentions(name, text, kind="person"),
                       "in_title": sm.count_mentions(name, title, kind="person") > 0}
            matrix[(role, sm.derive_role(subject, is_primary=(role == "primary")))] += 1
    return matrix, sum(matrix.values())


class Mentions(unittest.TestCase):
    def test_the_boundary_is_spelled_for_cyrillic(self):
        # ⚠️ `\b` IS ASCII-ONLY and never matches after a Cyrillic letter, so a
        # `\b`-based count returns 0 for every Bulgarian surface. And a plain
        # `str.count` would find „Иван" inside „Иванов".
        self.assertEqual(sm.count_mentions("Иван", "Иван Иванов и Иван.",
                                           kind="person"), 2)
        self.assertEqual(sm.count_mentions("Иванов", "Иван Иванов и Иван.",
                                           kind="person"), 1)
        self.assertEqual(sm.count_mentions("ДАНС", "Данс и ДАНС"), 2)

    def test_it_is_case_insensitive_and_zero_safe(self):
        self.assertEqual(sm.count_mentions("ГЕРБ", "герб, ГЕРБ"), 2)
        self.assertEqual(sm.count_mentions("ГЕРБ", "нищо"), 0)
        self.assertEqual(sm.count_mentions("", "нещо"), 0)
        self.assertEqual(sm.count_mentions("ГЕРБ", ""), 0)

    def test_a_surname_counts_for_the_canonical_name(self):
        # ⚠️ MEASURED SILENT DATA LOSS. `entities` carries „Росен Желязков"
        # while the article says „Желязков" after first reference — so a
        # verbatim count was 0, `derive_role` said `incidental`, and refusal 2
        # then gave the subject no tone at all. 148 of 7,782 subject rows.
        text = "Желязков откри заседанието. Росен Желязков подписа."
        self.assertEqual(sm.count_mentions("Росен Желязков", text, kind="person"), 2)
        self.assertEqual(sm.count_mentions("Владимир Путин", "Путин каза",
                                           kind="person"), 1)

    def test_an_overlapping_surface_is_not_counted_twice(self):
        # „Росен Желязков" and „Желязков" must not both score the same words.
        self.assertEqual(
            sm.count_mentions("Росен Желязков", "Росен Желязков", kind="person"), 1)

    def test_a_two_letter_fragment_is_not_a_surface(self):
        # „А." in „А. Б. Иванов" matches nothing useful and half the language.
        self.assertNotIn("А.", sm.surfaces_of("А. Б. Иванов"))
        self.assertEqual(sm.count_mentions("А. Б. Иванов", "А. каза", kind="person"), 0)

    def test_the_definite_article_is_the_same_party(self):
        self.assertEqual(sm.count_mentions("Възраждане", "Възраждането внесе",
                                           kind="party"), 1)
        self.assertEqual(sm.count_mentions("Лига", "„Лига“ и Лигата", kind="party"), 2)

    def test_the_tail_is_PARTY_ONLY(self):
        # ⚠️⚠️ THE RULE THAT KEEPS THE TAIL SAFE. A person name takes no
        # definite article, and „Иван" plus a three-letter tail matches
        # „Иванов" — reintroducing the exact collision the word boundary
        # exists to prevent, on a NAMED INDIVIDUAL.
        self.assertEqual(sm.count_mentions("Иван", "Иванов каза", kind="person"), 0)
        self.assertEqual(sm.count_mentions("меч", "мечта", kind="party"), 0)

    def test_a_typographically_quoted_party_name_still_counts(self):
        self.assertEqual(sm.count_mentions("„Лига“", "Лига поиска", kind="party"), 1)

    def test_a_regex_metacharacter_in_a_name_is_escaped(self):
        self.assertEqual(sm.count_mentions("ПП-ДБ", "ПП-ДБ и ПП-ДБ"), 2)
        self.assertEqual(sm.count_mentions("А.Б.", "А.Б. каза", kind="person"), 1)
        self.assertEqual(sm.count_mentions("А.Б.", "АХБЗ каза", kind="person"), 0)


class Subjects(unittest.TestCase):
    def test_parties_and_people_both_become_subjects_with_their_facts(self):
        subjects, total = sm.subjects_for(ANALYSIS, ARTICLE)
        self.assertEqual(total, 4)
        by_name = {s["name"]: s for s in subjects}
        self.assertEqual(by_name["ПП-ДБ"]["kind"], "party")
        self.assertTrue(by_name["ПП-ДБ"]["in_title"])
        self.assertFalse(by_name["ГЕРБ"]["in_title"])
        self.assertEqual(by_name["ГЕРБ"]["mentions"], 1)
        self.assertEqual(by_name["Иван"]["mentions"], 2)

    def test_the_most_mentioned_subject_comes_first(self):
        # ⚠️ Order is load-bearing BECAUSE a cap follows it: dropping by list
        # position discards whichever entity the model named last.
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        counts = [s["mentions"] for s in subjects]
        self.assertEqual(counts, sorted(counts, reverse=True))

    def test_the_cap_is_recorded_rather_than_silently_applied(self):
        # A subject the pass never looked at must not be indistinguishable
        # from one it assessed and found nothing to say about.
        many = {"entities": {"parties": [f"Партия{i}" for i in range(9)], "people": []}}
        body = " ".join(f"Партия{i} Партия{i}" for i in range(9))
        subjects, total = sm.subjects_for(many, article(content=body, title=""))
        self.assertEqual(len(subjects), sm.MAX_SUBJECTS)
        self.assertEqual(total, 9)

    def test_a_repeated_or_blank_surface_is_not_a_second_subject(self):
        dupes = {"entities": {"parties": ["ГЕРБ", "герб", "  ", None, 7], "people": []}}
        subjects, total = sm.subjects_for(dupes, ARTICLE)
        self.assertEqual(total, 1)
        self.assertEqual(subjects[0]["name"], "ГЕРБ")

    def test_a_malformed_entities_bucket_fabricates_nothing_and_crashes_on_nothing(self):
        # ⚠️ A STRING IS ITERABLE: `{"parties": "ГЕРБ"}` would otherwise
        # produce four single-character subjects, and a dict iterates its keys.
        for bucket in ("ГЕРБ", {"ГЕРБ": 1}, 7, None):
            subjects, total = sm.subjects_for({"entities": {"parties": bucket}}, ARTICLE)
            self.assertEqual((subjects, total), ([], 0), repr(bucket))
        subjects, total = sm.subjects_for({"entities": {"parties": ["ГЕРБ", 7, None]}},
                                          ARTICLE)
        self.assertEqual(total, 1)

    def test_whitespace_inside_a_name_is_normalised(self):
        odd = {"entities": {"parties": ["ПП-ДБ", " ПП-ДБ ", "ПП-ДБ"], "people": []}}
        subjects, total = sm.subjects_for(odd, ARTICLE)
        self.assertEqual(total, 1)
        self.assertEqual(subjects[0]["name"], "ПП-ДБ")

    def test_the_dedup_key_is_kind_AND_name(self):
        # A party and a person may legitimately share a surface.
        both = {"entities": {"parties": ["Възраждане"], "people": ["Възраждане"]}}
        _, total = sm.subjects_for(both, ARTICLE)
        self.assertEqual(total, 2)

    def test_an_article_naming_nobody_yields_no_subjects(self):
        subjects, total = sm.subjects_for({"entities": {}}, ARTICLE)
        self.assertEqual((subjects, total), ([], 0))
        self.assertEqual(sm.subjects_for({}, ARTICLE), ([], 0))


class Roles(unittest.TestCase):
    def test_one_mention_outside_the_title_is_incidental(self):
        # The rule that fixes "спомената само в цитат на Борисов" being
        # counted as a full assessment.
        passing = {"name": "ГЕРБ", "kind": "party", "mentions": 1, "in_title": False}
        self.assertEqual(sm.derive_role(passing, is_primary=False), "incidental")

    def test_the_title_or_a_second_mention_makes_it_secondary(self):
        for subject in ({"mentions": 1, "in_title": True},
                        {"mentions": 2, "in_title": False}):
            self.assertEqual(sm.derive_role(subject, is_primary=False), "secondary")

    def test_primary_wins_over_the_incidental_test(self):
        # If the model says the article is ABOUT this subject, one mention is
        # a fact about our counting, not about the article.
        passing = {"name": "ГЕРБ", "kind": "party", "mentions": 1, "in_title": False}
        self.assertEqual(sm.derive_role(passing, is_primary=True), "primary")

    def test_zero_mentions_is_not_named_in_passing(self):
        # ⚠️ "We could not count it" and "named in passing" are different
        # claims and only one of them withholds an assessment. Measured: 148 of
        # 7,782 subject rows score zero while the article does name the
        # subject, and `incidental` would publish nothing about any of them.
        uncounted = {"name": "Росен Желязков", "kind": "person",
                     "mentions": 0, "in_title": False}
        self.assertEqual(sm.derive_role(uncounted, is_primary=False), "secondary")

    def test_it_agrees_with_the_labelled_roles_well_enough_to_report(self):
        # Plan §3.7 asks for this check by name: "checked against the 52
        # model-assigned roles already in news/data/analysis/person_tones — a
        # small set, reported as such, NOT a gate". So the floor is loose and
        # the figure is printed; a ratchet on 52 rows would be a brittle claim.
        matrix, total = role_agreement()
        if total < 20:
            self.skipTest(f"only {total} labelled roles on disk")
        agree = sum(v for (a, b), v in matrix.items() if a == b)
        withheld = matrix[("secondary", "incidental")]
        secondary = sum(v for (a, _), v in matrix.items() if a == "secondary")
        print(f"\n  role agreement: {agree}/{total} = {agree / total:.1%}; "
              f"secondary withheld as incidental: {withheld}/{secondary}")
        self.assertGreaterEqual(agree / total, 0.65)
        # The direction that matters: `incidental` gives no tone at all, so
        # withholding a genuine secondary is worse than over-assessing an
        # incidental. It was 18/26 before the surface fix.
        self.assertLessEqual(withheld / max(secondary, 1), 0.45)

    def test_every_role_it_can_return_is_a_declared_one(self):
        seen = set()
        for mentions in (0, 1, 5):
            for in_title in (True, False):
                for primary in (True, False):
                    seen.add(sm.derive_role(
                        {"mentions": mentions, "in_title": in_title},
                        is_primary=primary))
        self.assertTrue(seen <= sm.SUBJECT_ROLES, seen)
        self.assertEqual(seen, sm.SUBJECT_ROLES)


class CacheKey(unittest.TestCase):
    def setUp(self):
        self.subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)

    def test_it_is_stable_for_the_same_article_and_subjects(self):
        self.assertEqual(sm.sentiment_key(ARTICLE, self.subjects),
                         sm.sentiment_key(article(), list(self.subjects)))

    def test_re_extracting_the_article_invalidates_it(self):
        # ⚠️ The property that stops a stored score outliving the words it was
        # made about: the key carries the content digest.
        moved = article(content=ARTICLE["content"] + " Допълнение.")
        self.assertNotEqual(sm.sentiment_key(ARTICLE, self.subjects),
                            sm.sentiment_key(moved, self.subjects))
        retitled = article(title=ARTICLE["title"] + "!")
        self.assertNotEqual(sm.sentiment_key(ARTICLE, self.subjects),
                            sm.sentiment_key(retitled, self.subjects))

    def test_a_different_subject_set_invalidates_it(self):
        self.assertNotEqual(sm.sentiment_key(ARTICLE, self.subjects),
                            sm.sentiment_key(ARTICLE, self.subjects[:1]))

    def test_the_subject_ORDER_is_part_of_it(self):
        # The cap drops by order, so two orders are two different questions.
        flipped = list(reversed(self.subjects))
        self.assertNotEqual(sm.sentiment_key(ARTICLE, self.subjects),
                            sm.sentiment_key(ARTICLE, flipped))

    def test_the_tier_1_facts_are_in_it(self):
        # ⚠️ THE INTERLOCK. `mentions` and `in_title` are SHOWN to the model
        # and decide the role, so a change to how they are counted is a change
        # to the question. Without them, fixing `count_mentions` leaves every
        # stored record current with the old counting behind it — "a stale
        # record served as current", which refusal 1 claims to prevent.
        recounted = [{**self.subjects[0], "mentions": self.subjects[0]["mentions"] + 1},
                     *self.subjects[1:]]
        self.assertNotEqual(sm.sentiment_key(ARTICLE, self.subjects),
                            sm.sentiment_key(ARTICLE, recounted))
        retitled = [{**self.subjects[0], "in_title": not self.subjects[0]["in_title"]},
                    *self.subjects[1:]]
        self.assertNotEqual(sm.sentiment_key(ARTICLE, self.subjects),
                            sm.sentiment_key(ARTICLE, retitled))

    def test_every_version_that_can_change_the_answer_is_in_it(self):
        base = sm.sentiment_key(ARTICLE, self.subjects)
        for module, attr in ((sm, "RUBRIC_VERSION"), (sm, "RECORD_VERSION"),
                             (sm, "MAX_STATE_CHARS"), (ax, "AXES_VERSION"),
                             (js, "SCALE_CONTRACT_VERSION")):
            original = getattr(module, attr)
            try:
                setattr(module, attr, "bumped" if isinstance(original, str) else 99)
                self.assertNotEqual(sm.sentiment_key(ARTICLE, self.subjects), base,
                                    f"{attr} is not in the key")
            finally:
                setattr(module, attr, original)
        self.assertEqual(sm.sentiment_key(ARTICLE, self.subjects), base)


class State(unittest.TestCase):
    def test_the_state_cap_matches_the_client(self):
        self.assertEqual(sm.MAX_STATE_CHARS, jc.LIMITS["state_chars"])

    def test_it_names_the_fields_the_questions_refer_to(self):
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        state, truncated = sm.state_for(ARTICLE, subjects)
        self.assertEqual(set(state), {"title", "body", "subjects"})
        self.assertFalse(truncated)
        self.assertEqual(len(state["subjects"]), len(subjects))
        self.assertEqual(state["subjects"][0]["i"], 0)
        self.assertIn("mentions", state["subjects"][0])
        for instructions in (ax.SUBJECT_TONE_INSTRUCTIONS, ax.LEANING_INSTRUCTIONS):
            self.assertIn("`body`", instructions)

    def test_only_the_body_absorbs_the_truncation(self):
        # ⚠️ A long body must not squeeze out the subject block — the
        # questions index into it, so losing an entry re-points every answer.
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        long_article = article(content="я" * (sm.MAX_STATE_CHARS * 2))
        state, truncated = sm.state_for(long_article, subjects)
        self.assertTrue(truncated)
        self.assertEqual(state["title"], ARTICLE["title"])
        self.assertEqual(len(state["subjects"]), len(subjects))
        self.assertLessEqual(
            len(json.dumps(state, ensure_ascii=False)), sm.MAX_STATE_CHARS)

    def test_a_body_full_of_escapes_still_fits_the_cap(self):
        # ⚠️ THE FIXTURE IS THE POINT. `"я" * N` has nothing to escape, so a
        # raw-length cap passes on it by construction — while JSON escaping
        # expands a real body by one character per quote, backslash and
        # newline. Measured: 52 of the 53 articles long enough to truncate
        # produced a state over 24,000, worst +650, which
        # `jev_client.build_payload` refuses as `invalid_state` — its own
        # contract's word for OUR bug.
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        for body in ('я"\n\\' * 20000, "\n" * 40000, 'цитат "тук"\n' * 5000):
            state, truncated = sm.state_for(article(content=body), subjects)
            serialized = len(json.dumps(state, ensure_ascii=False))
            self.assertTrue(truncated)
            self.assertLessEqual(serialized, sm.MAX_STATE_CHARS, repr(body[:8]))
            # And it keeps as much as fits, rather than bailing to a stub.
            self.assertGreater(serialized, sm.MAX_STATE_CHARS * 0.9)

    def test_an_ordinary_article_is_not_truncated_at_all(self):
        # The point of the pass: GLM sees 6,000 characters and 9.93% of
        # articles are longer; at 24,000 that is 0.41%.
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        _, truncated = sm.state_for(article(content="я" * 12000), subjects)
        self.assertFalse(truncated)

    def test_no_room_for_a_body_is_refused_rather_than_silently_empty(self):
        subjects = [{"name": "я" * 5000, "kind": "party", "mentions": 1,
                     "in_title": False} for _ in range(6)]
        with self.assertRaises(sm.JevSentimentError):
            sm.state_for(ARTICLE, subjects)

    def test_a_body_squeezed_below_the_floor_is_refused(self):
        subjects = [{"name": "я" * 3900, "kind": "party", "mentions": 1,
                     "in_title": False} for _ in range(6)]
        with self.assertRaises(sm.JevSentimentError):
            sm.state_for(article(content="текст " * 2000), subjects)

    def test_more_subjects_than_the_question_budget_are_refused(self):
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        too_many = [dict(subjects[0], name=f"П{i}") for i in range(sm.MAX_SUBJECTS + 1)]
        with self.assertRaises(sm.JevSentimentError):
            sm.state_for(ARTICLE, too_many)

    def test_the_scope_badge_is_about_THIS_pass_not_the_glm_one(self):
        # ⚠️ `aa.text_scope_of` on the ANALYSIS record reads the GLM runner's
        # 6,000-char prefix, so it would badge a 10,000-char article Jev read
        # IN FULL as a `prefix` of 6,000 — making the whole point of this pass
        # invisible in the badge that exists to show it.
        long_article = article(content="я" * 10000)
        scope = sm.text_scope_for(long_article, truncated=False)
        self.assertEqual(scope["kind"], "full")
        self.assertEqual(scope["chars_seen"], 10000)
        cut = sm.text_scope_for(article(content="я" * 40000), truncated=True)
        self.assertEqual(cut["kind"], "prefix")
        self.assertEqual(cut["chars_seen"], sm.MAX_STATE_CHARS)


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.data = Path(self.tmp.name)
        self.addCleanup(self.tmp.cleanup)
        subjects, _ = sm.subjects_for(ANALYSIS, ARTICLE)
        self.record = {
            **sm.empty_record(ARTICLE, status="ok"),
            "sentiment_key": sm.sentiment_key(ARTICLE, subjects),
        }

    def test_a_record_round_trips(self):
        path = sm.store(self.record, self.data)
        self.assertTrue(path.is_file())
        self.assertEqual(sm.cached(ARTICLE["url"], self.data)["url"], ARTICLE["url"])
        self.assertEqual(sm.current_for(ARTICLE, ANALYSIS, self.data)["status"], "ok")

    def test_nothing_stored_is_none_not_an_empty_record(self):
        self.assertIsNone(sm.cached(ARTICLE["url"], self.data))
        self.assertIsNone(sm.current_for(ARTICLE, ANALYSIS, self.data))

    def test_an_unreadable_sidecar_is_nothing_never_a_partial_claim(self):
        path = sm.path_for(ARTICLE["url"], self.data)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("{not json", encoding="utf-8")
        self.assertIsNone(sm.cached(ARTICLE["url"], self.data))
        self.assertIsNone(sm.current_for(ARTICLE, ANALYSIS, self.data))

    def test_a_stale_record_is_nothing_never_a_stale_claim(self):
        sm.store(self.record, self.data)
        for field, value in (("rubric_version", "jev-sentiment-v0"),
                             ("axes_version", 99),
                             ("contract_version", 99),
                             ("sentiment_key", "deadbeef")):
            sm.store({**self.record, field: value}, self.data)
            self.assertIsNone(sm.current_for(ARTICLE, ANALYSIS, self.data), field)

    def test_a_re_extracted_article_no_longer_matches_its_record(self):
        sm.store(self.record, self.data)
        moved = article(content=ARTICLE["content"] + " Допълнение.")
        self.assertIsNone(sm.current_for(moved, ANALYSIS, self.data))

    def test_the_store_lives_beside_the_analysis_and_nowhere_else(self):
        # The whole footprint of the pass is one directory, so it is
        # reversible by deleting it; the 8,925 analysis records are untouched.
        path = sm.store(self.record, self.data)
        self.assertEqual(path.parent, self.data / "analysis" / "sentiment")

    def test_valid_json_that_is_not_an_object_is_also_nothing(self):
        path = sm.path_for(ARTICLE["url"], self.data)
        path.parent.mkdir(parents=True, exist_ok=True)
        for payload in ("[1, 2]", '"a string"', "null", "7"):
            path.write_text(payload, encoding="utf-8")
            self.assertIsNone(sm.cached(ARTICLE["url"], self.data), payload)
            self.assertIsNone(sm.current_for(ARTICLE, ANALYSIS, self.data), payload)

    def test_a_record_shape_bump_invalidates_every_stored_record(self):
        sm.store(self.record, self.data)
        original = sm.RECORD_VERSION
        try:
            sm.RECORD_VERSION = original + 1
            self.assertIsNone(sm.current_for(ARTICLE, ANALYSIS, self.data))
        finally:
            sm.RECORD_VERSION = original

    def test_a_url_less_record_is_refused_rather_than_sharing_one_sidecar(self):
        # Every url-less record would otherwise collide on one file and
        # overwrite each other — which reads as a cache hit for an unrelated
        # article.
        with self.assertRaises(sm.JevSentimentError):
            sm.store({**self.record, "url": None}, self.data)
        with self.assertRaises(sm.JevSentimentError):
            sm.path_for("   ", self.data)
        self.assertIsNone(sm.cached("", self.data))

    def test_storing_twice_replaces_rather_than_appends(self):
        sm.store(self.record, self.data)
        sm.store({**self.record, "status": "failed", "reason": "second"}, self.data)
        doc = sm.cached(ARTICLE["url"], self.data)
        self.assertEqual(doc["status"], "failed")
        self.assertEqual(doc["reason"], "second")

    def test_an_unknown_record_status_is_refused(self):
        with self.assertRaises(sm.JevSentimentError):
            sm.empty_record(ARTICLE, status="assessed")   # the per-SUBJECT word
        self.assertTrue(sm.RECORD_STATUSES.isdisjoint(sm.ASSESSMENT_STATUSES))

    def test_an_empty_record_carries_its_reason_and_no_scores(self):
        record = sm.empty_record(ARTICLE, status="failed", reason="timeout",
                                 subjects_total=3)
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["reason"], "timeout")
        self.assertEqual(record["axes"], {})
        self.assertEqual(record["subjects"], [])
        self.assertEqual(record["subjects_total"], 3)
        self.assertIsNone(record["sentiment_key"])


if __name__ == "__main__":
    unittest.main()
