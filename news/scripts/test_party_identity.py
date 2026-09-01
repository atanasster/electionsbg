#!/usr/bin/env python3

import copy
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from party_identity import (  # noqa: E402
    PARTY_IDENTITY_VERSION,
    PartyIdentityResolver,
    article_context,
)

ROOT = HERE.parents[1]


class PartyIdentityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.canonical = json.loads(
            (ROOT / "data" / "canonical_parties.json").read_text(encoding="utf-8")
        )
        cls.policy = json.loads(
            (ROOT / "news" / "config" / "party_identity_v2.json").read_text(encoding="utf-8")
        )
        cls.resolver = PartyIdentityResolver(cls.canonical, cls.policy)

    def test_unique_model_classified_surface_resolves_despite_common_word(self):
        got = self.resolver.resolve("Възраждане")
        self.assertEqual(got.party_id, "p_7")
        self.assertEqual(got.party_country_code, "BG")
        self.assertEqual(got.party_identity_status, "exact")
        self.assertEqual(got.party_identity_version, PARTY_IDENTITY_VERSION)

    def test_foreign_party_is_country_scoped_without_bulgarian_id(self):
        got = self.resolver.resolve(
            "Алтернатива за Германия",
            context_text="Изборите в Германия промениха състава на Бундестага.",
        )
        self.assertIsNone(got.party_id)
        self.assertEqual(got.party_country_code, "DE")
        self.assertEqual(got.party_identity_status, "foreign")

    def test_cross_country_surface_requires_document_country_context(self):
        for surface in ("Зелените", "ХДС"):
            refused = self.resolver.resolve(surface)
            german = self.resolver.resolve(
                surface, context_text="Германия избира нов състав на Бундестага."
            )
            self.assertIsNone(refused.party_id)
            self.assertIsNone(refused.party_country_code)
            self.assertEqual(refused.resolution_basis, "cross_country_ambiguous")
            self.assertEqual(german.party_country_code, "DE")
            self.assertEqual(german.party_identity_status, "foreign")

    def test_duplicate_foreign_country_claims_are_rejected(self):
        policy = copy.deepcopy(self.policy)
        policy["foreign_parties"].append({
            "country_code": "FR",
            "surfaces": ["AfD"],
            "reason": "test collision",
        })
        with self.assertRaisesRegex(ValueError, "multiple countries"):
            PartyIdentityResolver(self.canonical, policy)

    def test_ambiguous_bulgarian_surface_is_refused_without_reviewed_context(self):
        got = self.resolver.resolve(
            "ПП",
            context_text="Коалиция Продължаваме промяната – Демократична България",
            published="2026-08-30",
        )
        self.assertIsNone(got.party_id)
        self.assertEqual(got.party_country_code, "BG")
        self.assertEqual(got.resolution_basis, "ambiguous_refused")

    def test_pending_context_rule_is_exposed_only_for_human_review(self):
        candidates = self.resolver.pending_context_candidates(
            "ПП-ДБ",
            context_text="Коалиция Продължаваме промяната – Демократична България",
            published="2026-08-30",
        )
        self.assertEqual([row["party_id"] for row in candidates], ["p_6"])
        self.assertFalse(candidates[0]["reviewed"])

    def test_pending_context_rule_respects_forbidden_coalition_phrase(self):
        candidates = self.resolver.pending_context_candidates(
            "ПП",
            context_text="Коалиция Продължаваме промяната – Демократична България",
            published="2026-08-30",
        )
        self.assertEqual(candidates, [])

    def test_reviewed_context_rule_is_date_bounded(self):
        policy = copy.deepcopy(self.policy)
        rule = next(r for r in policy["reviewed_context_rules"]
                    if r["id"] == "db-historic-full-coalition-name")
        rule["reviewed"] = True
        resolver = PartyIdentityResolver(self.canonical, policy)
        text = "Демократична България – Обединение представи листата си."
        historical = resolver.resolve("ДБ", context_text=text, published="2022-09-01")
        current = resolver.resolve("ДБ", context_text=text, published="2026-08-30")
        self.assertEqual(historical.party_id, "p_72")
        self.assertIsNone(current.party_id)

    def test_context_rule_does_not_overwrite_exact_identity_with_family(self):
        policy = copy.deepcopy(self.policy)
        rule = next(r for r in policy["reviewed_context_rules"]
                    if r["id"] == "ppdb-full-coalition-name")
        rule["reviewed"] = True
        resolver = PartyIdentityResolver(self.canonical, policy)
        got = resolver.resolve(
            "ПП-ДБ",
            context_text="Коалиция Продължаваме промяната – Демократична България",
            published="2026-08-30",
        )
        self.assertEqual(got.party_id, "p_6")
        self.assertEqual(got.party_aggregate_id, "p_6")

    def test_unknown_surface_keeps_country_unknown(self):
        got = self.resolver.resolve("Несъществуваща партия")
        self.assertIsNone(got.party_id)
        self.assertIsNone(got.party_country_code)
        self.assertEqual(got.party_identity_status, "unresolved")

    def test_article_context_includes_document_and_party_entities(self):
        text = article_context(
            {"title": "Заглавие", "description": "Описание", "content": "Текст"},
            ["ПП-ДБ"],
        )
        self.assertIn("Заглавие", text)
        self.assertIn("ПП-ДБ", text)


if __name__ == "__main__":
    unittest.main(verbosity=2)
