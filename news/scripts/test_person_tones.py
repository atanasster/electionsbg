#!/usr/bin/env python3
"""T4.3 — the four refusals, the status/tone consistency rule and the cache
key. No network: `generate` is never called here."""
import sys
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import person_tones as pt  # noqa: E402

ARTICLE = {"url": "https://a.bg/1", "title": "Прокуратурата обвини Калушев",
           "content": "Увод. Прокуратурата обвини Калушев за споразумението. "
                      "Сандов заяви, че всичко е законно. Край.",
           "analysis_provenance": {"body_truncated": False, "max_body_chars": 6000}}

IDENTITIES = [
    {"surface": "Ивайло Калушев", "news_person_id": "np_1", "identity_version": "2026.1:abc",
     "name_bg": "Ивайло Калушев", "basis": "registry_alias"},
    {"surface": "Калушев", "news_person_id": "np_1", "identity_version": "2026.1:abc"},
    {"surface": "Огнян Атанасов", "news_person_id": None, "basis": "ambiguous_registry",
     "candidates": ["np_2", "np_3"]},
    {"surface": "Борислав Сандов", "news_person_id": "np_9", "identity_version": "2026.1:def",
     "name_bg": "Борислав Сандов"},
]


def answer(target=1, role="primary", tone="unfavorable", quote="обвини Калушев",
           direction="unfavorable", voice="journalist", speaker=None):
    span = {"quote": quote, "field": "body", "direction": direction, "voice": voice}
    if speaker:
        span["speaker"] = speaker
    return {"people": [{
        "target": target, "subject_role": role, "tone": tone, "confidence": 0.8,
        "rationale": "Материалът го представя като обвиняем без отговор.",
        "evidence_spans": [] if tone in (None, "neutral") or role == "incidental" else [span],
    }]}


class Refusals(unittest.TestCase):
    def test_no_identity_no_tone(self):
        targets = pt.resolved_targets(IDENTITIES)
        # ⚠️ THE MUTATION THIS CATCHES: an unresolved surface treated as a
        # target — an ambiguous „Огнян Атанасов" given a public tone.
        self.assertEqual([t["news_person_id"] for t in targets], ["np_1", "np_9"])
        self.assertEqual(targets[0]["mention_refs"], ["Ивайло Калушев", "Калушев"])
        self.assertEqual(pt.resolved_targets(
            [r for r in IDENTITIES if not r.get("news_person_id")]), [])
        # And the validator refuses a row for an id outside the candidate set.
        rows, _ = pt.gate(answer(), targets, ARTICLE, model="m",
                          text_scope={"kind": "full"}, assessed_at="now")
        stray = [{**rows[0], "news_person_id": "np_stranger"}]
        self.assertTrue(any("candidate set" in e for e in pt.validate(stray, targets)))

    def test_a_directional_claim_needs_a_located_quote(self):
        targets = pt.resolved_targets(IDENTITIES)
        rows, dropped = pt.gate(answer(quote="тази фраза липсва"), targets, ARTICLE,
                                model="m", text_scope={"kind": "full"}, assessed_at="now")
        # ⚠️ THE MUTATION THIS CATCHES: publishing an unfavorable claim about
        # a NAMED PERSON on a quote the article does not contain.
        self.assertEqual(rows[0]["assessment_status"], "not_assessed")
        self.assertIsNone(rows[0]["tone"])
        self.assertTrue(any("no located span" in d["reason"] for d in dropped))
        self.assertIs(rows[0]["evidence_spans"][0]["located"], False)
        ok, _ = pt.gate(answer(), targets, ARTICLE, model="m",
                        text_scope={"kind": "full"}, assessed_at="now")
        self.assertEqual((ok[0]["assessment_status"], ok[0]["tone"]),
                         ("assessed", "unfavorable"))

    def test_an_incidental_mention_carries_no_sentiment(self):
        targets = pt.resolved_targets(IDENTITIES)
        # ⚠️ The answer carries a LOCATABLE span and a tone, so nothing but
        # the role rule can refuse it — otherwise the assertion passes on a
        # gate that forgot the rule and merely found no evidence.
        incidental = answer(role="incidental", tone="unfavorable")
        incidental["people"][0]["evidence_spans"] = [
            {"quote": "обвини Калушев", "field": "body",
             "direction": "unfavorable", "voice": "journalist"}]
        rows, _ = pt.gate(incidental, targets, ARTICLE,
                          model="m", text_scope={"kind": "full"}, assessed_at="now")
        self.assertEqual((rows[0]["subject_role"], rows[0]["assessment_status"],
                          rows[0]["tone"]), ("incidental", "not_assessed", None))
        self.assertTrue(any("incidental" in e for e in pt.validate(
            [{**rows[0], "assessment_status": "assessed", "tone": "unfavorable"}], targets)))

    def test_a_partial_read_is_insufficient_text_not_a_tone(self):
        targets = pt.resolved_targets(IDENTITIES)
        rows, _ = pt.gate(answer(), targets, ARTICLE, model="m",
                          text_scope={"kind": "prefix"}, assessed_at="now")
        # ⚠️ THE MUTATION THIS CATCHES: an article-wide claim about a person
        # from a partial read (T4.1c).
        self.assertEqual(rows[0]["assessment_status"], "insufficient_text")
        self.assertIsNone(rows[0]["tone"])
        self.assertEqual(pt.validate(rows, targets), [])


class Consistency(unittest.TestCase):
    def setUp(self):
        self.targets = pt.resolved_targets(IDENTITIES)
        self.rows, _ = pt.gate(answer(), self.targets, ARTICLE, model="m",
                               text_scope={"kind": "full"}, assessed_at="now")

    def test_status_and_tone_are_one_decision(self):
        self.assertEqual(pt.validate(self.rows, self.targets), [])
        for status in ("not_assessed", "insufficient_text"):
            errs = pt.validate([{**self.rows[0], "assessment_status": status}], self.targets)
            self.assertTrue(any("must be null" in e for e in errs), (status, errs))
        errs = pt.validate([{**self.rows[0], "tone": None}], self.targets)
        self.assertTrue(any("an assessed target needs one of" in e for e in errs), errs)

    def test_a_duplicate_article_person_rubric_pair_is_refused(self):
        errs = pt.validate(self.rows + self.rows, self.targets)
        self.assertTrue(any("duplicate (article, person, rubric)" in e for e in errs), errs)

    def test_every_provenance_field_is_required(self):
        for field in ("text_scope", "model_version", "rubric_version",
                      "identity_version", "assessed_at"):
            row = {k: v for k, v in self.rows[0].items() if k != field}
            self.assertTrue(any(field in e for e in pt.validate([row], self.targets)), field)

    def test_a_second_answer_for_one_target_is_dropped(self):
        two = {"people": [answer()["people"][0], answer()["people"][0]]}
        rows, dropped = pt.gate(two, self.targets, ARTICLE, model="m",
                                text_scope={"kind": "full"}, assessed_at="now")
        self.assertEqual(len(rows), 1)
        self.assertTrue(any("duplicate target" in d["reason"] for d in dropped))

    def test_an_out_of_range_target_is_dropped(self):
        rows, dropped = pt.gate(answer(target=9), self.targets, ARTICLE, model="m",
                                text_scope={"kind": "full"}, assessed_at="now")
        self.assertEqual(rows, [])
        self.assertTrue(any("out of range" in d["reason"] for d in dropped))

    def test_a_quoted_accusation_is_recorded_as_quoted(self):
        rows, _ = pt.gate(answer(voice="quoted_speaker", speaker="Сандов"),
                          self.targets, ARTICLE, model="m",
                          text_scope={"kind": "full"}, assessed_at="now")
        self.assertEqual(rows[0]["quoted_attitudes"][0]["speaker"], "Сандов")
        self.assertEqual(rows[0]["evidence_spans"][0]["voice"], "quoted_speaker")


class PerRowValidation(unittest.TestCase):
    """⚠️ One malformed row must not discard another person's evidenced one."""

    def test_a_bad_row_is_dropped_and_the_good_ones_are_kept(self):
        good = answer()["people"][0]
        # The prompt forbids a span on a neutral tone; models send them.
        bad = {"target": 2, "subject_role": "secondary", "tone": "neutral",
               "confidence": 0.7, "rationale": "Материалът го представя фактически.",
               "evidence_spans": [{"quote": "Сандов заяви", "field": "body",
                                   "direction": "favorable", "voice": "journalist"}]}
        with mock.patch.object(pt, "generate",
                               return_value={"raw": {"people": [good, bad]},
                                             "model": "m", "usage": None}):
            out = pt.assess_article(ARTICLE, IDENTITIES, Path("."), "m")
        # ⚠️ THE MUTATION THIS CATCHES: voiding the WHOLE record — the first
        # person's correctly evidenced tone thrown away with the second's
        # contract failure, and the article regenerated on every run.
        self.assertEqual(out["status"], "ok")
        self.assertEqual([r["news_person_id"] for r in out["person_tones"]], ["np_1"])
        self.assertTrue(any(d.get("reason") == "failed its own contract"
                            for d in out["dropped"]))

    def test_the_scope_rule_is_in_the_validator_too(self):
        targets = pt.resolved_targets(IDENTITIES)
        rows, _ = pt.gate(answer(), targets, ARTICLE, model="m",
                          text_scope={"kind": "full"}, assessed_at="now")
        # ⚠️ THE MUTATION THIS CATCHES: the T4.1c rule living only in `gate`,
        # so a hand-written or re-imported row can carry an article-wide tone
        # from a partial read and validate clean.
        partial = [{**rows[0], "text_scope": {"kind": "prefix"}}]
        errs = pt.validate(partial, targets)
        self.assertTrue(any("needs a `full` text_scope" in e for e in errs), errs)

    def test_the_target_cap_is_recorded_not_silent(self):
        many = [{"surface": f"Лице {i}", "news_person_id": f"np_{i}",
                 "identity_version": "v", "basis": "registry_alias"}
                for i in range(pt.MAX_TARGETS + 3)]
        out = pt.assess_article(ARTICLE, many, Path("."), "m", dry_run=True)
        self.assertEqual(out["target_count"], pt.MAX_TARGETS)
        self.assertEqual(out["targets_total"], pt.MAX_TARGETS + 3)
        self.assertEqual(out["targets_dropped"], 3)

    def test_the_prefix_is_the_runners_own(self):
        import build_prompts
        # ⚠️ Two independent constants make a `full` stamp honest by
        # coincidence; this pins them to one.
        self.assertEqual(pt.LEDE_CHARS, build_prompts.MAX_BODY_CHARS)

    def test_quoted_attitudes_is_the_quoted_subset(self):
        targets = pt.resolved_targets(IDENTITIES)
        rows, _ = pt.gate(answer(voice="quoted_speaker", speaker="Сандов"), targets,
                          ARTICLE, model="m", text_scope={"kind": "full"}, assessed_at="now")
        self.assertEqual(rows[0]["quoted_attitudes"],
                         [s for s in rows[0]["evidence_spans"]
                          if s.get("voice") == "quoted_speaker"])

    def test_a_row_whose_basis_is_not_a_registry_alias_is_refused(self):
        # ⚠️ THE MUTATION THIS CATCHES: refusal 1 resting on „the id is
        # falsy" alone — a row carrying BOTH an id and an ambiguous basis.
        contradictory = [{"surface": "Х", "news_person_id": "np_1",
                          "identity_version": "v", "basis": "ambiguous_registry"}]
        self.assertEqual(pt.resolved_targets(contradictory), [])


class TheCacheKey(unittest.TestCase):
    def test_it_moves_with_the_text_and_with_every_identity_version(self):
        targets = pt.resolved_targets(IDENTITIES)
        key = pt.tones_key(ARTICLE, targets)
        self.assertEqual(key, pt.tones_key(ARTICLE, list(reversed(targets))))
        self.assertNotEqual(key, pt.tones_key({**ARTICLE, "content": "друг текст"}, targets))
        # ⚠️ THE MUTATION THIS CATCHES: a stored tone surviving a re-slug or a
        # merge — the identity it was made about is no longer that identity.
        moved = [{**targets[0], "identity_version": "2026.2:zzz"}, targets[1]]
        self.assertNotEqual(key, pt.tones_key(ARTICLE, moved))
        with mock.patch.object(pt, "RUBRIC_VERSION", "person-treatment-v2"):
            self.assertNotEqual(key, pt.tones_key(ARTICLE, targets))

    def test_current_for_attaches_only_a_matching_document(self):
        import tempfile
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            pt.tones_dir(data_dir).mkdir(parents=True)
            targets = pt.resolved_targets(IDENTITIES)
            doc = {"rubric_version": pt.RUBRIC_VERSION,
                   "tones_key": pt.tones_key(ARTICLE, targets),
                   "person_tones": [{"news_person_id": "np_1"}]}
            path = pt.tones_dir(data_dir) / f"{pt.article_key(ARTICLE['url'])}.json"
            import json
            path.write_text(json.dumps(doc), encoding="utf-8")
            self.assertIsNotNone(pt.current_for(ARTICLE, IDENTITIES, data_dir))
            self.assertIsNone(pt.current_for({**ARTICLE, "content": "друг"}, IDENTITIES, data_dir))
            doc["rubric_version"] = "old"
            path.write_text(json.dumps(doc), encoding="utf-8")
            self.assertIsNone(pt.current_for(ARTICLE, IDENTITIES, data_dir))

    def test_an_article_with_no_resolved_identity_is_recorded_as_such(self):
        out = pt.assess_article(ARTICLE, [IDENTITIES[2]], Path("."), "m")
        self.assertEqual(out["status"], "no_resolved_identity")
        self.assertEqual(out["person_tones"], [])
        self.assertIsNone(out["tones_key"])

    def test_a_failed_generation_claims_nothing(self):
        with mock.patch.object(pt, "generate", side_effect=RuntimeError("timeout")):
            out = pt.assess_article(ARTICLE, IDENTITIES, Path("."), "m")
        self.assertEqual(out["status"], "failed")
        self.assertEqual(out["person_tones"], [])
        self.assertIn("timeout", out["reason"])

    def test_a_record_that_fails_its_own_contract_is_not_stored_as_data(self):
        # A model answer whose role and tone contradict each other.
        bad = {"people": [{"target": 1, "subject_role": "primary", "tone": "sideways",
                           "confidence": 0.5, "rationale": "n", "evidence_spans": []}]}
        with mock.patch.object(pt, "generate", return_value={"raw": bad, "model": "m", "usage": None}):
            out = pt.assess_article(ARTICLE, IDENTITIES, Path("."), "m")
        self.assertEqual(out["status"], "ok")           # dropped, not invalid
        self.assertEqual(out["person_tones"], [])
        self.assertTrue(out["dropped"])


if __name__ == "__main__":
    unittest.main()
