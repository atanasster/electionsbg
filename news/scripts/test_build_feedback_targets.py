import unittest

from news.eval_contract.canonical import canonical_sha256
import news.scripts.build_feedback_targets as bft
from news.scripts.build_feedback_targets import build, validate_registry


class FeedbackTargetTests(unittest.TestCase):
    def test_registry_has_unique_served_canonical_targets(self):
        registry = build()
        targets = registry["targets"]
        keys = [(item["kind"], item["id"]) for item in targets]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(registry["targets_sha256"], canonical_sha256(targets))
        self.assertGreater(registry["target_count"], 8_000)
        self.assertTrue({"person", "party", "settlement", "institution", "company", "sector"}
                        <= {item["kind"] for item in targets})
        for item in targets:
            self.assertTrue(item["href"].startswith(f"{bft.MAIN_SITE}/"))

    def test_a_registry_built_before_the_rebrand_still_validates(self):
        # ⚠️ `naiasno.bg` serves and `electionsbg.com` 301s to it, so BOTH
        # hosts are canonical. Narrowing the pattern to the new one alone does
        # not fail loudly — it raises on target 0 of an EXISTING registry, the
        # build dies, and the feedback surface keeps serving its old vintage.
        for host in ("https://naiasno.bg", "https://electionsbg.com"):
            with self.subTest(host=host):
                self.assertTrue(
                    bft.CANONICAL_HREF.fullmatch(f"{host}/person/mp-3643"))
        for bad in ("http://naiasno.bg/person/mp-1",
                    "https://naiasno.bg.evil.test/person/mp-1",
                    "https://naiasno.bg/with space"):
            with self.subTest(bad=bad):
                self.assertIsNone(bft.CANONICAL_HREF.fullmatch(bad))

    def test_sectors_follow_the_main_site_registry(self):
        sectors = [item for item in build()["targets"]
                   if item["kind"] == "sector"]
        self.assertGreaterEqual(len(sectors), 15)
        self.assertIn(("health", f"{bft.MAIN_SITE}/sector/health"),
                      {(item["id"], item["href"]) for item in sectors})

    def test_every_observed_public_link_enters_the_exact_registry(self):
        links = {
            "Фирмата": {
                "kind": "company", "id": "999999999",
                "canonical": "ПРОВЕРЕНО ДРУЖЕСТВО", "form_kind": "curated_entity",
                "href": f"{bft.MAIN_SITE}/company/999999999",
            },
            "Селото": {
                "kind": "place", "id": "03229",
                "canonical": "Безмер, община Тунджа, област Ямбол",
                "form_kind": "curated_entity",
                "href": f"{bft.MAIN_SITE}/settlement/03229",
            },
        }
        registry = build(public_records=[{"analysis": {"entity_links": links}}])
        indexed = {(target["kind"], target["id"]): target
                   for target in registry["targets"]}
        self.assertEqual(indexed[("company", "999999999")]["canonical"],
                         "ПРОВЕРЕНО ДРУЖЕСТВО")
        self.assertEqual(indexed[("settlement", "03229")]["href"],
                         f"{bft.MAIN_SITE}/settlement/03229")

    def test_registry_hash_is_recomputed_not_trusted(self):
        registry = build()
        registry["targets"][0]["aliases"].append("Подменен псевдоним")
        with self.assertRaisesRegex(ValueError, "hash does not match"):
            validate_registry(registry)


if __name__ == "__main__":
    unittest.main()
