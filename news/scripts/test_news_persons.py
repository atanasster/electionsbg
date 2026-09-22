#!/usr/bin/env python3
"""Plan T4.0 — the news-person identity registry and resolver. Every gate
fails closed: a global surname alias refuses the registry, an active record
without sources or an accepted alias refuses it, an ambiguous surface is
refused rather than picked, a pending identity never resolves and never
reaches the public index, and the identity version moves when — and only
when — the accepted alias set does."""
import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
sys.path.insert(0, str(HERE))
import news_persons as np  # noqa: E402

T = "2026-09-22T00:00:00Z"
SRC = {"url": "https://x.bg/s", "domain": "x.bg", "published": "2026-09-20", "supports": "s", "reviewer": "r", "reviewed_at": T}


def alias(surface, scope="global", status="accepted"):
    return {"surface": surface, "scope": scope, "status": status,
            "evidence": ["https://x.bg/e"] if status == "accepted" else [],
            "reviewer": "r" if status == "accepted" else None,
            "reviewed_at": T if status == "accepted" else None, "note": ""}


def person(pid, name, status="active", aliases=None, sources=None):
    return {"news_person_id": pid, "name_bg": name, "name_en": name, "status": status,
            "created_at": T, "reviewed_by": "r" if status == "active" else None,
            "reviewed_at": T if status == "active" else None,
            "disambiguation_bg": None, "disambiguation_en": None,
            "identity_sources": [SRC] if sources is None and status == "active" else (sources or []),
            "aliases": aliases if aliases is not None else [alias(name)],
            "verified_main_site_slug": None, "namesakes": [], "history": []}


def registry(*persons, retired=None, version="v1"):
    return {"version": 1, "registry_version": version, "retired_ids": retired or {}, "persons": list(persons)}


def write(doc):
    tmp = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8")
    json.dump(doc, tmp, ensure_ascii=False)
    tmp.close()
    return Path(tmp.name)


def rec(url="https://a.bg/1", people=(), mentions=()):
    return {"url": url, "entities": {"people": list(people)}, "mentions": list(mentions)}


class TheRegistry(unittest.TestCase):
    def test_the_committed_registry_loads_and_only_active_records_reach_the_index(self):
        doc = np.load_registry(ROOT / "news" / "config" / "news_persons.json")
        statuses = {p["news_person_id"]: p["status"] for p in doc["persons"]}
        self.assertEqual(statuses["np_7f3c1a94"], "active")
        self.assertEqual(statuses["np_c41d8e07"], "pending_review")
        index = np.public_index(doc, {"np_7f3c1a94": 3}, T)
        self.assertEqual([p["news_person_id"] for p in index["persons"]], ["np_7f3c1a94"])
        self.assertEqual(index["persons"][0]["article_count"], 3)
        self.assertEqual(index["persons"][0]["aliases"], ["Ивайло Калушев"])
        # Reviewed fields only: no history, no rejected alias, no reviewer name.
        self.assertNotIn("history", index["persons"][0])
        self.assertNotIn("Калушев", index["persons"][0]["aliases"])

    def test_a_malformed_entry_refuses(self):
        good = person("np_00000001", "Иван Петров")
        for mutate, message in (
            (lambda p: p["aliases"].append(alias("Петров")), "never a global alias"),
            # ⚠️ THE MUTATION THIS CATCHES: counting tokens — an honorific does
            # not make a surname a full name.
            (lambda p: p["aliases"].append(alias("г-н Петров")), "never a global alias"),
            (lambda p: p["aliases"].append(alias("проф. Петров")), "never a global alias"),
            (lambda p: p.__setitem__("aliases", {"surface": "x"}), "must be a list"),
            (lambda p: p.__setitem__("identity_sources", []), "lacks identity sources"),
            (lambda p: p.__setitem__("aliases", [alias("Иван Петров", status="pending_review")]), "no accepted alias"),
            (lambda p: p["aliases"][0].__setitem__("evidence", []), "needs evidence"),
            (lambda p: p["aliases"][0].__setitem__("evidence", ["http://x"]), "https"),
            (lambda p: p["aliases"][0].__setitem__("scope", "somewhere"), "scope must be"),
            (lambda p: p.__setitem__("news_person_id", "person-1"), "news_person_id"),
            (lambda p: p.__setitem__("status", "verified"), "status must be"),
            (lambda p: p.__setitem__("verified_main_site_slug", "Not A Slug"), "slug"),
        ):
            with self.subTest(message=message):
                p = copy.deepcopy(good)
                mutate(p)
                path = write(registry(p))
                try:
                    with self.assertRaisesRegex(ValueError, message):
                        np.load_registry(path)
                finally:
                    path.unlink()
        # A retired id must redirect to a live one, and may not be reused.
        path = write(registry(good, retired={"np_00000009": "np_00000042"}))
        try:
            with self.assertRaisesRegex(ValueError, "retired id"):
                np.load_registry(path)
        finally:
            path.unlink()
        path = write(registry(good, retired={"np_00000001": "np_00000001"}))
        try:
            with self.assertRaisesRegex(ValueError, "retired"):
                np.load_registry(path)
        finally:
            path.unlink()

    def test_a_missing_registry_is_an_empty_one(self):
        doc = np.load_registry(Path("/nonexistent/news_persons.json"))
        self.assertEqual(doc["persons"], [])
        self.assertEqual(np.Resolver(doc).resolve_surface("Иван Петров", "u", set())["basis"], "not_in_registry")


class TheResolver(unittest.TestCase):
    def test_an_accepted_global_alias_resolves_and_a_pending_identity_never_does(self):
        doc = registry(person("np_00000001", "Иван Петров"),
                       person("np_00000002", "Мария Илиева", status="pending_review",
                              aliases=[alias("Мария Илиева", status="pending_review")]))
        r = np.Resolver(doc)
        got = r.resolve_surface("ИВАН ПЕТРОВ", "u", set())
        self.assertEqual((got["basis"], got["news_person_id"], got["alias_scope"]), ("registry_alias", "np_00000001", "global"))
        self.assertEqual(r.resolve_surface("Мария Илиева", "u", set())["basis"], "not_in_registry")
        # ⚠️ THE MUTATION THIS CATCHES: an accepted alias on a PENDING or
        # WITHDRAWN identity resolving. The record's status gates the person;
        # the alias status gates the surface; both must hold.
        for status in ("pending_review", "withdrawn"):
            doc = registry(person("np_00000003", "Петър Стоянов", status=status,
                                  aliases=[alias("Петър Стоянов")], sources=[SRC]))
            self.assertEqual(np.Resolver(doc).resolve_surface("Петър Стоянов", "u", set())["basis"], "not_in_registry", status)

    def test_scopes_apply_only_where_they_say(self):
        doc = registry(person("np_00000001", "Огнян Атанасов",
                              aliases=[alias("Огнян Атанасов", scope="case:narco-pardon"),
                                       alias("Атанасов", scope="article:https://a.bg/only")]))
        r = np.Resolver(doc)
        self.assertEqual(r.resolve_surface("Огнян Атанасов", "u", set())["basis"], "not_in_registry")
        self.assertEqual(r.resolve_surface("Огнян Атанасов", "u", {"narco-pardon"})["news_person_id"], "np_00000001")
        self.assertEqual(r.resolve_surface("Атанасов", "https://a.bg/other", set())["basis"], "not_in_registry")
        got = r.resolve_surface("Атанасов", "https://a.bg/only", set())
        self.assertEqual((got["news_person_id"], got["alias_scope"]), ("np_00000001", "article:https://a.bg/only"))

    def test_two_identities_claiming_one_surface_in_scope_are_refused_not_picked(self):
        # ⚠️ THE MUTATION THIS CATCHES: taking the first claim.
        doc = registry(person("np_00000001", "Огнян Атанасов"), person("np_00000002", "Огнян Атанасов"))
        got = np.Resolver(doc).resolve_surface("Огнян Атанасов", "u", set())
        self.assertEqual(got["basis"], "ambiguous_registry")
        self.assertIsNone(got["news_person_id"])
        self.assertEqual(got["candidates"], ["np_00000001", "np_00000002"])

    def test_resolve_article_carries_every_person_name_and_marks_the_rest_not_assessed(self):
        doc = registry(person("np_00000001", "Иван Петров"))
        r = np.Resolver(doc)
        rows = np.resolve_article(r, rec(people=["Иван Петров", "Георги Димов"],
                                          mentions=[{"kind": "person", "surface": "Петров", "basis": "coref_resolved", "id": "mp-1"},
                                                    {"kind": "place", "surface": "София", "basis": "gazetteer_exact", "id": "sofia"}]), [])
        by = {x["surface"]: x for x in rows}
        self.assertEqual(set(by), {"Петров", "Иван Петров", "Георги Димов"})
        self.assertEqual(by["Иван Петров"]["news_person_id"], "np_00000001")
        self.assertEqual(by["Иван Петров"]["name_en"], "Иван Петров")
        self.assertEqual(by["Георги Димов"]["basis"], "not_in_registry")
        self.assertEqual(by["Петров"]["main_site_ids"], ["mp-1"])
        self.assertTrue(all(x["assessment"] == "not_assessed" for x in rows))
        self.assertTrue(all("identity_version" in x for x in rows if x["news_person_id"]))

    def test_the_identity_version_moves_with_the_accepted_alias_set_only(self):
        p = person("np_00000001", "Иван Петров")
        doc = registry(p)
        v1 = np.identity_version(doc, p)
        p2 = copy.deepcopy(p)
        p2["aliases"].append(alias("Иван П. Петров"))
        self.assertNotEqual(np.identity_version(doc, p2), v1)
        p3 = copy.deepcopy(p)
        p3["aliases"].append(alias("И. Петров", status="pending_review"))
        self.assertEqual(np.identity_version(doc, p3), v1)
        p4 = copy.deepcopy(p)
        p4["disambiguation_bg"] = "друго"
        self.assertEqual(np.identity_version(doc, p4), v1)

    def test_a_retired_id_redirects_to_its_live_target(self):
        doc = registry(person("np_00000001", "Иван Петров"), retired={"np_00000009": "np_00000001"})
        self.assertEqual(np.Resolver(doc).canonical("np_00000009"), "np_00000001")


    def test_an_article_override_is_refused_when_the_namesake_is_also_named(self):
        # ⚠️ THE MUTATION THIS CATCHES: applying a bare-surname override to
        # every occurrence in an article that also names the namesake.
        p = person("np_00000001", "Ивайло Калушев",
                   aliases=[alias("Ивайло Калушев"), alias("Калушев", scope="article:https://a.bg/1")])
        p["namesakes"] = [{"name": "Георги Калушев", "note": "n"}]
        r = np.Resolver(registry(p))
        rows = {x["surface"]: x for x in np.resolve_article(r, rec(people=["Калушев", "Ивайло Калушев"]), [])}
        self.assertEqual(rows["Калушев"]["news_person_id"], "np_00000001")
        rows = {x["surface"]: x for x in np.resolve_article(
            r, rec(people=["Калушев", "Ивайло Калушев", "Георги Калушев"]), [])}
        self.assertIsNone(rows["Калушев"]["news_person_id"])
        self.assertEqual(rows["Калушев"]["basis"], "ambiguous_registry")
        self.assertIn("Георги Калушев", rows["Калушев"]["reason"])
        # The full name still resolves — only the bare surface is refused.
        self.assertEqual(rows["Ивайло Калушев"]["news_person_id"], "np_00000001")

    def test_two_dictionary_ids_on_one_surface_both_reach_the_reviewer(self):
        r = np.Resolver(registry())
        rows = np.resolve_article(r, rec(mentions=[
            {"kind": "person", "surface": "Петров", "basis": "coref_resolved", "id": "mp-1"},
            {"kind": "person", "surface": "Петров", "basis": "coref_resolved", "id": "mp-2"}]), [])
        self.assertEqual(rows[0]["main_site_ids"], ["mp-1", "mp-2"])


class TheQueue(unittest.TestCase):
    def test_unresolved_names_are_queued_with_where_they_occurred(self):
        doc = registry(person("np_00000001", "Иван Петров"),
                       person("np_00000002", "Мария Илиева", status="pending_review",
                              aliases=[alias("Мария Илиева", status="pending_review")]))
        r = np.Resolver(doc)
        rows = {u: np.resolve_article(r, rec(url=u, people=people, mentions=m), [])
                for u, people, m in (
                    ("https://a.bg/1", ["Иван Петров", "Мария Илиева", "Радев"], []),
                    ("https://a.bg/2", ["Мария Илиева"], [{"kind": "person", "surface": "Радев", "basis": "coref_resolved", "id": "mp-7"}]),
                )}
        q = np.candidate_queue(rows, doc, T)
        by = {i["surface"]: i for i in q["items"]}
        self.assertNotIn("Иван Петров", by)
        self.assertEqual(by["Мария Илиева"]["articles"], 2)
        self.assertEqual(by["Мария Илиева"]["pending_identity"], "np_00000002")
        self.assertTrue(by["Радев"]["single_word"])
        self.assertEqual(by["Радев"]["main_site_ids"], ["mp-7"])
        self.assertEqual(q["counts"], {"surfaces": 2, "singletons_omitted": 0, "articles_with_person_names": 2,
                                       "published_articles": None, "ambiguous": 0, "pending_in_registry": 1})
        # A name seen once is counted, not listed.
        rows["https://a.bg/3"] = np.resolve_article(r, rec(url="https://a.bg/3", people=["Само Веднъж"]), [])
        q = np.candidate_queue(rows, doc, T)
        self.assertNotIn("Само Веднъж", {i["surface"] for i in q["items"]})
        self.assertEqual(q["counts"]["singletons_omitted"], 1)
        # ⚠️ Fails closed on nothing: an empty corpus is an empty queue that says so.
        self.assertEqual(np.candidate_queue({}, doc, T)["counts"]["surfaces"], 0)

    def test_ambiguity_anywhere_is_the_row_basis_and_the_common_spelling_labels_it(self):
        # ⚠️ THE MUTATION THIS CATCHES: last-wins basis — an ambiguous surface
        # filed as `not_in_registry` because its last article did not collide.
        doc = registry(person("np_00000001", "Огнян Атанасов",
                              aliases=[alias("Огнян Атанасов", scope="case:a")]),
                       person("np_00000002", "Огнян Атанасов",
                              aliases=[alias("Огнян Атанасов", scope="case:a")]))
        r = np.Resolver(doc)
        rows = {"https://a.bg/1": np.resolve_article(r, rec(url="https://a.bg/1", people=["Огнян Атанасов"]), ["a"]),
                "https://a.bg/2": np.resolve_article(r, rec(url="https://a.bg/2", people=["огнян атанасов"]), [])}
        q = np.candidate_queue(rows, doc, T)
        self.assertEqual(q["items"][0]["basis"], "ambiguous_registry")
        self.assertEqual(q["counts"]["ambiguous"], 1)
        self.assertEqual(q["items"][0]["candidates"], ["np_00000001", "np_00000002"])
        rows["https://a.bg/3"] = np.resolve_article(r, rec(url="https://a.bg/3", people=["огнян атанасов"]), [])
        self.assertEqual(np.candidate_queue(rows, doc, T)["items"][0]["surface"], "огнян атанасов")

    def test_the_public_index_exports_only_redirects_into_active_identities(self):
        doc = registry(person("np_00000001", "Иван Петров"),
                       person("np_00000002", "Мария Илиева", status="pending_review",
                              aliases=[alias("Мария Илиева", status="pending_review")]),
                       retired={"np_00000009": "np_00000001", "np_00000008": "np_00000002"})
        index = np.public_index(doc, {}, T)
        self.assertEqual(index["retired_ids"], {"np_00000009": "np_00000001"})


if __name__ == "__main__":
    unittest.main()
