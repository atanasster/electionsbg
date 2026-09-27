#!/usr/bin/env python3
"""Tests for the review workspace — the queues, the decision files, the server.

Run:  python3 news/scripts/test_review_persons.py
"""
import json
import os
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import review_persons as rp  # noqa: E402
import review_persons_queues as rq  # noqa: E402


def pair(url, domain, surface="Бойко Борисов", basis="exact",
         form_kind="two_part", published="2026-09-20"):
    return {"url": url, "domain": domain, "title": "t", "published": published,
            "surface": surface, "basis": basis, "form_kind": form_kind,
            "excerpt": {"before": "а ", "match": surface, "after": " б"}}


GAZ = {"entries": [
    {"kind": "person", "id": "mp-1", "canonical": "Бойко Методиев Борисов",
     "display": {"roles": [{"role": "mp", "start": "2024-10-27", "current": True}],
                 "photo": "/p/1.webp"}},
    {"kind": "person", "id": "mp-2", "canonical": "Лъчезар Димитров Борисов",
     "display": {"roles": []}},
    {"kind": "person", "id": "mp-3", "canonical": "Андрей Атанасов Гюров",
     "display": {"roles": []}},
]}
PEOPLE = {e["id"]: e for e in GAZ["entries"]}


def collected(n_boiko=6, n_guro=5, strong=False):
    by_person = {
        "mp-1": [pair(f"u{i}", f"d{i % 3}.bg") for i in range(n_boiko)],
        "mp-3": [pair(f"g{i}", "x.bg", "Андрей Гюров",
                      form_kind="full_name" if strong else "two_part")
                 for i in range(n_guro)],
    }
    surnames = {
        "борисов": [pair(f"s{i}", "y.bg", "Борисов", None, None) for i in range(4)],
        "тръмп": [pair(f"t{i}", "y.bg", "Тръмп", None, None) for i in range(9)],
        "рядък": [pair("r0", "y.bg", "Рядък", None, None)],
    }
    return {"by_person": by_person, "surnames": surnames}


class Excerpt(unittest.TestCase):
    def test_splits_around_the_name(self):
        x = rq.excerpt("Вчера Бойко Борисов каза нещо.", "Бойко Борисов")
        self.assertEqual(x["match"], "Бойко Борисов")
        self.assertTrue(x["before"].endswith("Вчера "))
        self.assertTrue(x["after"].startswith(" каза"))

    def test_absent_name(self):
        self.assertIsNone(rq.excerpt("нищо", "Борисов"))

    def test_case_insensitive_match_keeps_the_original_spelling(self):
        x = rq.excerpt("БОЙКО БОРИСОВ каза", "Бойко Борисов")
        self.assertEqual(x["match"], "БОЙКО БОРИСОВ")


class IdentityQueue(unittest.TestCase):
    def test_needs_the_page_threshold(self):
        items = rq.identity_items(collected(n_boiko=4), PEOPLE, {})
        self.assertNotIn("mp-1", [i["id"] for i in items])

    def test_two_part_only_people_come_first(self):
        items = rq.identity_items(collected(n_boiko=6, n_guro=9, strong=True),
                                  PEOPLE, {})
        self.assertEqual([i["id"] for i in items], ["mp-1", "mp-3"])
        self.assertTrue(items[0]["needs_audit"])
        self.assertFalse(items[1]["needs_audit"])

    def test_a_cue_or_alias_link_is_audited_below_the_threshold(self):
        # §3.2's precision audit covers every context and alias link, not only
        # the people with a page.
        c = collected(n_boiko=4)
        c["by_person"]["mp-1"][0]["basis"] = "surname_alias"
        self.assertIn("mp-1", [i["id"] for i in rq.identity_items(c, PEOPLE, {})])

    def test_decided_people_leave_the_queue(self):
        items = rq.identity_items(collected(), PEOPLE,
                                  {"decisions": [{"id": "mp-1"}]})
        self.assertNotIn("mp-1", [i["id"] for i in items])

    def test_excerpts_spread_across_outlets(self):
        item = rq.identity_items(collected(n_boiko=9), PEOPLE, {})[0]
        self.assertEqual(len(item["excerpts"]), 5)
        self.assertEqual(len({x["domain"] for x in item["excerpts"][:3]}), 3)

    def test_a_context_link_is_weak(self):
        self.assertTrue(rq.needs_audit([pair("u", "d")]))
        self.assertFalse(rq.needs_audit([pair("u", "d", basis="context")]))
        self.assertFalse(rq.needs_audit([pair("u", "d", form_kind="full_name")]))


class SurnameQueue(unittest.TestCase):
    def items(self, aliases=None):
        return rq.surname_items(collected(), GAZ, aliases or {},
                                today=date(2026, 9, 27))

    def test_only_surnames_a_public_figure_carries(self):
        # „Тръмп" is frequent and nobody in the gazetteer carries it.
        self.assertEqual([i["key"] for i in self.items()], ["борисов"])

    def test_a_surname_too_many_public_figures_carry_is_not_proposed(self):
        gaz = {"entries": [{"kind": "person", "id": f"d-{i}",
                            "canonical": f"Иван{i} Петров Димитров"}
                           for i in range(rq.MAX_SURNAME_HOLDERS + 1)]}
        col = {"by_person": {},
               "surnames": {"димитров": [pair(f"d{i}", "y.bg", "Димитров", None, None)
                                         for i in range(5)]}}
        self.assertEqual(rq.surname_items(col, gaz, {}), [])
        gaz["entries"].pop()
        self.assertEqual(len(rq.surname_items(col, gaz, {})), 1)

    def test_a_surname_the_texts_give_to_someone_else_is_not_proposed(self):
        # „Инджов": one public figure, Васил; every article says „Сергей Инджов".
        gaz = {"entries": [{"kind": "person", "id": "vi",
                            "canonical": "Васил Стаматов Инджов"}]}
        other = [{**pair(f"i{i}", "y.bg", "Инджов", None, None),
                  "named": ["Сергей"]} for i in range(5)]
        self.assertEqual(rq.surname_items({"by_person": {},
                                           "surnames": {"инджов": other}}, gaz, {}), [])
        own = [{**p, "named": ["Васил"]} for p in other]
        self.assertEqual(len(rq.surname_items({"by_person": {},
                                               "surnames": {"инджов": own}}, gaz, {})), 1)

    def test_given_names_are_read_from_the_text(self):
        self.assertEqual(rq.given_names_before(
            "ЦИК заличи Сергей Инджов. Инджов каза, че Васил Инджов не е той.",
            "Инджов"), ["Васил", "Сергей"])
        self.assertEqual(rq.given_names_before("Сергей Инджова", "Инджов"), [])

    def test_a_reviewed_surname_is_not_proposed_again(self):
        self.assertEqual(self.items({"aliases": [
            {"surface": "Борисов", "status": "rejected"}]}), [])

    def test_candidates_rank_people_the_news_names_first(self):
        item = self.items()[0]
        self.assertEqual(item["candidates"][0]["id"], "mp-1")
        self.assertEqual(item["candidates"][0]["linked_pairs"], 6)
        self.assertEqual(item["holders_total"], 2)

    def test_an_expired_decision_comes_back(self):
        live = {"surface": "Борисов", "status": "rejected", "valid_to": "2027-01-01"}
        gone = {**live, "valid_to": "2026-01-01"}
        self.assertEqual(self.items({"aliases": [live]}), [])
        self.assertEqual([i["key"] for i in self.items({"aliases": [gone]})],
                         ["борисов"])

    def test_window_prefill(self):
        item = self.items()[0]
        self.assertEqual(item["window"], {"from": "2026-09-20",
                                          "to": "2027-03-26"})


class Entries(unittest.TestCase):
    ITEM = {"id": "mp-1", "surfaces": ["Бойко Борисов", "Б. Борисов"]}

    def test_identity_entry_shapes(self):
        e = rq.identity_entry(self.ITEM, "refused", ["Б. Борисов"], "R", "now")
        self.assertEqual(e["surfaces"], [])
        e = rq.identity_entry(self.ITEM, "mixed", ["Б. Борисов"], "R", "now")
        self.assertEqual(e["surfaces"], ["Б. Борисов"])
        with self.assertRaises(ValueError):
            rq.identity_entry(self.ITEM, "mixed", [], "R", "now")
        with self.assertRaises(ValueError):
            rq.identity_entry(self.ITEM, "mixed", ["Друг"], "R", "now")
        with self.assertRaises(ValueError):
            rq.identity_entry(self.ITEM, "maybe", [], "R", "now")

    def test_surname_entry_shapes(self):
        item = {"surface": "Борисов", "candidates": [{"id": "mp-1"}]}
        e = rq.surname_entry(item, pick="mp-1", valid_from="2026-01-01",
                             valid_to="2026-12-31", requires_cue=True,
                             reviewer="R", now="now")
        self.assertEqual((e["status"], e["id"], e["requires_cue"]),
                         ("accepted", "mp-1", True))
        e = rq.surname_entry(item, pick=None, valid_from="2026-01-01",
                             valid_to="2026-12-31", requires_cue=True,
                             reviewer="R", now="now")
        self.assertEqual((e["status"], e["id"], e["requires_cue"]),
                         ("rejected", None, False))
        for bad in ({"pick": "mp-9"}, {"valid_from": "2027-01-01"},
                    {"valid_to": "31.12.2026"}):
            kw = {"pick": "mp-1", "valid_from": "2026-01-01",
                  "valid_to": "2026-12-31", **bad}
            with self.assertRaises(ValueError):
                rq.surname_entry(item, requires_cue=False, reviewer="R",
                                 now="now", **kw)


class WorkspaceFiles(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = Path(self.dir.name)
        self.paths = {"identity": d / "audit.json", "surnames": d / "aliases.json"}
        self.paths["identity"].write_text(json.dumps(
            {"_comment": "keep me", "version": 1, "decisions": []}))
        self.ws = rp.Workspace("Рецензент", gazetteer_doc=GAZ,
                               collected=collected(), bodies={},
                               paths=self.paths)

    def tearDown(self):
        self.dir.cleanup()

    def read(self, q):
        return json.loads(self.paths[q].read_text(encoding="utf-8"))

    def test_a_decision_is_on_disk_immediately_and_keeps_the_header(self):
        self.ws.decide_identity("mp-1", "confirmed", [])
        doc = self.read("identity")
        self.assertEqual(doc["_comment"], "keep me")
        self.assertEqual(doc["decisions"][0]["id"], "mp-1")
        self.assertEqual(doc["decisions"][0]["reviewer"], "Рецензент")

    def test_a_second_decision_on_one_item_is_refused(self):
        self.ws.decide_identity("mp-1", "confirmed", [])
        with self.assertRaises(ValueError):
            self.ws.decide_identity("mp-1", "refused", [])

    def test_undo_removes_exactly_the_last_decision(self):
        self.ws.decide_identity("mp-1", "confirmed", [])
        self.ws.decide_surname("борисов", pick="mp-1", valid_from="2026-01-01",
                               valid_to="2026-12-31", requires_cue=False)
        self.assertEqual(self.ws.undo(), {"queue": "surnames", "key": "борисов"})
        self.assertEqual(self.read("surnames")["aliases"], [])
        self.assertEqual(len(self.read("identity")["decisions"]), 1)
        self.assertEqual(self.ws.undo(), {"queue": "identity", "key": "mp-1"})
        self.assertIsNone(self.ws.undo())

    def test_resume_skips_what_is_already_decided(self):
        self.ws.decide_identity("mp-1", "confirmed", [])
        again = rp.Workspace("Рецензент", gazetteer_doc=GAZ,
                             collected=collected(), bodies={}, paths=self.paths)
        self.assertNotIn("mp-1", [i["id"] for i in again.items["identity"]])

    def test_an_unknown_item_is_an_error(self):
        with self.assertRaises(KeyError):
            self.ws.decide_identity("nobody", "confirmed", [])


SAMPLE = {"rubric_version": "r1", "pairs": [
    {"pair_id": f"k{i}", "stratum": "model_scored", "article_url": f"u{i}",
     "domain": "secret.bg", "published": "2026-09-20", "surface": "Иван Петров",
     "identity": {"kind": "person", "id": "mp-1", "canonical": "Иван Петров Иванов"},
     "identity_version": "v1", "pipeline_role": "primary",
     "pipeline_value": -1.2, "pipeline_bucket_index": 0} for i in range(3)],
    "second_reader": ["k1"]}


def names(n=6, surface="Мария Стоянова"):
    return {rq.fold(surface): [pair(f"https://n.bg/{i}", f"o{i % 2}.bg", surface)
                               for i in range(n)]}


REGISTRY = {"version": 1, "registry_version": "2026-09-20.3",
            "retired_ids": {}, "persons": []}


class NewPeopleHelp(unittest.TestCase):
    def test_similar_names_share_the_surname_same_first_name_first(self):
        people = {"x": {"canonical": "Мария Иванова Стоянова"},
                  "y": {"canonical": "Петя Стоянова"},
                  "z": {"canonical": "Мария Петрова"}}
        self.assertEqual([p["id"] for p in rq.similar_people("Мария Стоянова", people)],
                         ["x", "y"])

    def test_the_stoplist_keeps_foreign_leaders_out(self):
        self.assertEqual(rq.new_person_items(names(surface="Доналд Тръмп"), REGISTRY,
                                             {}, stoplist=["Доналд Тръмп"]), [])

    def test_a_candidates_window_is_their_roles_within_the_corpus(self):
        e = {"display": {"roles": [{"start": "2021-05-01", "end": "2024-02-01"}]}}
        self.assertEqual(rq.candidate_window(e, "2023-01-01", "2027-03-01"),
                         {"from": "2023-01-01", "to": "2024-02-01"})
        open_ = {"display": {"roles": [{"start": "2025-06-01"}]}}
        self.assertEqual(rq.candidate_window(open_, "2023-01-01", "2027-03-01"),
                         {"from": "2025-06-01", "to": "2027-03-01"})


class Collect(unittest.TestCase):
    def test_unlinked_full_names_are_collected_apart_from_surnames(self):
        subj = [{"name": "Мария Стоянова", "refused_reason": "no_match"},
                {"name": "Стоянова", "refused_reason": "no_match"},
                {"name": "Друг Човек", "refused_reason": "ambiguous"}]
        art = {"url": "https://n.bg/1", "domain": "n.bg", "published": "2026-09-20"}
        out = rq.collect([(art, {**art, "content": "Мария Стоянова и Стоянова"},
                           subj, None)])
        self.assertEqual(list(out["names"]), [rq.fold("Мария Стоянова")])
        self.assertIn(rq.fold("Стоянова"), out["surnames"])


class AnnotationQueue(unittest.TestCase):
    def test_items_are_blinded(self):
        items = rq.annotation_items(SAMPLE, second_reader=False)
        self.assertEqual(len(items), 3)
        text = json.dumps(items, ensure_ascii=False)
        for secret in ("secret.bg", "u0", "model_scored", "-1.2", "primary"):
            self.assertNotIn(secret, text)

    def test_second_reader_sees_only_the_subset(self):
        items = rq.annotation_items(SAMPLE, second_reader=True)
        self.assertEqual([i["key"] for i in items], ["k1"])

    def test_answers_are_validated(self):
        self.assertEqual(rq.annotation_answer(role="primary", level=4,
                                              wrong_person=False, declined=False),
                         {"role": "primary", "level": 4})
        self.assertEqual(rq.annotation_answer(role="incidental", level=3,
                                              wrong_person=False, declined=False),
                         {"role": "incidental"})
        with self.assertRaises(ValueError):
            rq.annotation_answer(role="primary", level=None,
                                 wrong_person=False, declined=False)
        with self.assertRaises(ValueError):
            rq.annotation_answer(role="guess", level=None,
                                 wrong_person=False, declined=False)

    def test_merge_keeps_other_annotators(self):
        doc = {"pairs": [{"pair_id": "k0", "annotator": "A"},
                         {"pair_id": "k0", "annotator": "B"}]}
        out = rq.merge_adjudications(doc, [{"pair_id": "k1", "annotator": "A"}],
                                     "A", {"k0", "k1"})
        self.assertEqual(sorted((r["pair_id"], r["annotator"]) for r in out["pairs"]),
                         [("k0", "B"), ("k1", "A")])

    def test_a_second_pass_keeps_the_same_reviewers_first_pass(self):
        doc = {"pairs": [{"pair_id": "k0", "annotator": "A"},
                         {"pair_id": "k1", "annotator": "A"}]}
        out = rq.merge_adjudications(doc, [{"pair_id": "k1", "annotator": "A",
                                            "level": 3}], "A", {"k1"})
        self.assertEqual(sorted((r["pair_id"], r.get("level")) for r in out["pairs"]),
                         [("k0", None), ("k1", 3)])

    def test_the_order_does_not_follow_the_stratum(self):
        sample = {"pairs": [{"pair_id": pid, "stratum": st, "identity": {}}
                            for pid, st in (("f9", "a"), ("a1", "a"),
                                            ("c3", "b"), ("b2", "b"))]}
        self.assertEqual([i["key"] for i in rq.annotation_items(
            sample, second_reader=False)], ["a1", "b2", "c3", "f9"])

    def test_the_same_person_cannot_be_their_own_second_reader(self):
        doc = {"pairs": [{"pair_id": "k1", "annotator": "A", "pass": "first"}]}
        with self.assertRaises(ValueError):
            rq.merge_adjudications(doc, [{"pair_id": "k1", "annotator": "A"}],
                                   "A", {"k1"}, second_pass=True)
        out = rq.merge_adjudications(doc, [{"pair_id": "k1", "annotator": "B"}],
                                     "B", {"k1"}, second_pass=True,
                                     finalized_at="t")
        self.assertEqual(len(out["pairs"]), 2)
        self.assertEqual(out["finalized"], {"B:second": "t"})

    def test_finalized_rows_are_sealed(self):
        import person_accuracy_gate as gate  # noqa: PLC0415
        rows = rq.adjudication_rows(SAMPLE, {"k0": {"role": "primary", "level": 1}},
                                    annotator="A", rubric_version="r1",
                                    finalized_at="t", revealed=set())
        self.assertEqual(rows[0]["seal"], gate.seal_of(rows[0]))

    def test_a_wrong_person_role_is_validated(self):
        with self.assertRaises(ValueError):
            rq.annotation_answer(role="guess", level=None,
                                 wrong_person=True, declined=False)


class NewPeopleQueue(unittest.TestCase):
    def test_threshold_registry_and_decided_names_are_filtered(self):
        self.assertEqual(len(rq.new_person_items(names(), REGISTRY, {})), 1)
        self.assertEqual(rq.new_person_items(names(4), REGISTRY, {}), [])
        decided = {"foreign": [{"name": "Мария Стоянова"}]}
        self.assertEqual(rq.new_person_items(names(), REGISTRY, decided), [])

    def test_an_unedited_draft_is_refused(self):
        item = rq.new_person_items(names(), REGISTRY, {})[0]
        with self.assertRaises(ValueError):
            rq.registry_person(item, name_bg="Мария Стоянова", name_en="Maria Stoyanova",
                               disambiguation_bg=item["draft_bg"],
                               disambiguation_en="x", public_figure=True,
                               reviewer="R", now="2026-09-27T10:00:00+00:00")


class WorkspaceNewQueues(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = Path(self.dir.name)
        self.extra = {"working": d / "work.json", "adjudications": d / "adj.json",
                      "registry": d / "registry.json", "scope_review": d / "scope.json"}
        self.extra["registry"].write_text(json.dumps(REGISTRY), encoding="utf-8")
        self.extra["adjudications"].write_text(json.dumps(
            {"version": 2, "how_to_read": ["keep"],
             "pairs": [{"pair_id": "k0", "annotator": "Друг"}]}), encoding="utf-8")
        self.ws = self.make()

    def make(self, **kw):
        return rp.Workspace(
            "Рецензент", gazetteer_doc=GAZ,
            collected={**collected(), "names": names()},
            bodies={"u0": {"title": "Заглавие", "content": "Иван Петров каза."}},
            paths={"identity": Path(self.dir.name) / "a.json",
                   "surnames": Path(self.dir.name) / "s.json"},
            sample=SAMPLE, extra_paths=self.extra, **kw)

    def tearDown(self):
        self.dir.cleanup()

    def read(self, k):
        return json.loads(self.extra[k].read_text(encoding="utf-8"))

    def test_the_pair_text_is_blinded(self):
        t = self.ws.pair_text("k0")
        self.assertEqual(t["content"], "Иван Петров каза.")
        self.assertEqual(t["highlight"], ["Иван Петров"])
        self.assertNotIn("secret.bg", json.dumps(t))

    def test_answer_reveal_undo_and_resume(self):
        self.ws.decide_annotation("k0", role="primary", level=1,
                                  wrong_person=False, declined=False)
        self.assertEqual(self.ws.reveal("k0")["domain"], "secret.bg")
        self.assertEqual(self.read("working")["answers"]["k0"],
                         {"role": "primary", "level": 1})
        self.assertEqual(self.read("working")["revealed"], ["k0"])
        self.assertIn("k0", self.make().decided["annotation"])
        self.assertEqual(self.ws.undo(), {"queue": "annotation", "key": "k0"})
        self.assertEqual(self.read("working")["answers"], {})

    def test_finalize_merges_and_records_the_reveal(self):
        self.ws.decide_annotation("k0", role="primary", level=1,
                                  wrong_person=False, declined=False)
        self.ws.reveal("k0")
        self.ws.decide_annotation("k2", role=None, level=None,
                                  wrong_person=False, declined=True)
        self.assertEqual(self.ws.finalize(), {"rows": 2})
        doc = self.read("adjudications")
        self.assertEqual(doc["how_to_read"], ["keep"])
        mine = [r for r in doc["pairs"] if r["annotator"] == "Рецензент"]
        self.assertEqual(len(doc["pairs"]), 3)
        k0 = next(r for r in mine if r["pair_id"] == "k0")
        self.assertTrue(k0["source_revealed"])
        self.assertEqual((k0["level"], k0["pipeline_bucket_index"], k0["rubric_version"]),
                         (1, 0, "r1"))
        self.assertTrue(next(r for r in mine if r["pair_id"] == "k2")["declined"])

    def test_finalize_with_nothing_is_refused(self):
        with self.assertRaises(ValueError):
            self.ws.finalize()

    def test_accept_writes_a_valid_registry_entry_and_undo_restores_it(self):
        import news_persons  # noqa: PLC0415
        key = self.ws.items["new_people"][0]["key"]
        entry = self.ws.decide_new_person(key, "accept", {
            "name_bg": "Мария Стоянова", "name_en": "Maria Stoyanova",
            "disambiguation_bg": "Кметица на Х.", "disambiguation_en": "Mayor of X.",
            "public_figure": True})
        reg = news_persons.load_registry(self.extra["registry"])
        self.assertEqual([p["news_person_id"] for p in reg["persons"]],
                         [entry["news_person_id"]])
        self.assertNotEqual(reg["registry_version"], REGISTRY["registry_version"])
        self.assertEqual(reg["persons"][0]["scope"], "bg")
        self.assertTrue(reg["persons"][0]["public_figure"])
        self.ws.undo()
        self.assertEqual(self.read("registry"), REGISTRY)

    def test_an_invalid_entry_never_reaches_disk(self):
        key = self.ws.items["new_people"][0]["key"]
        with self.assertRaises(ValueError):
            self.ws.decide_new_person(key, "accept", {"name_bg": "М"})
        self.assertEqual(self.read("registry"), REGISTRY)

    def test_foreign_is_remembered_and_not_proposed_again(self):
        key = self.ws.items["new_people"][0]["key"]
        self.ws.decide_new_person(key, "foreign", {})
        self.assertEqual(self.read("scope_review")["foreign"][0]["name"],
                         "Мария Стоянова")
        self.assertEqual(self.make().items["new_people"], [])
        self.ws.undo()
        self.assertEqual(self.read("scope_review")["foreign"], [])

    def test_next_registry_version(self):
        self.assertEqual(rp.next_registry_version("2026-09-27.2", "2026-09-27"),
                         "2026-09-27.3")
        self.assertEqual(rp.next_registry_version("2026-09-20.3", "2026-09-27"),
                         "2026-09-27.1")
        self.assertEqual(rp.next_registry_version("none", "2026-09-27"),
                         "2026-09-27.1")


class TheJoinReadsWhatTheWorkspaceWrites(unittest.TestCase):
    """The decision files are the only contract between the two modules."""

    def setUp(self):
        import person_identity_join as pij  # noqa: PLC0415
        self.pij = pij
        self.dir = tempfile.TemporaryDirectory()
        d = Path(self.dir.name)
        self.paths = {"identity": d / "audit.json", "surnames": d / "aliases.json"}
        self.ws = rp.Workspace("R", gazetteer_doc=GAZ, collected=collected(),
                               bodies={}, paths=self.paths)

    def tearDown(self):
        self.dir.cleanup()

    def join(self, name, links=None, published="2026-09-20T10:00:00Z"):
        src = self.pij.Sources(
            gazetteer_doc=GAZ, cues={},
            audit=json.loads(self.paths["identity"].read_text())
            if self.paths["identity"].exists() else {},
            aliases=json.loads(self.paths["surnames"].read_text())
            if self.paths["surnames"].exists() else {}, registry={})
        subject = {"name": name, "kind": "person", "subject_role": "primary",
                   "tone": {"value": 0}}
        self.pij.stamp([subject], {"entity_links": links or {}},
                       {"content": name, "published": published}, src)
        return subject

    LINK = {"Бойко Борисов": {"kind": "person", "id": "mp-1"}}

    def test_refused(self):
        self.ws.decide_identity("mp-1", "refused", [])
        self.assertEqual(self.join("Бойко Борисов", self.LINK)["refused_reason"],
                         "identity_refused")

    def test_mixed(self):
        self.ws.decide_identity("mp-1", "mixed", ["Бойко Борисов"])
        self.assertEqual(self.join("Бойко Борисов", self.LINK)["refused_reason"],
                         "context_required")

    def test_accepted_alias_and_its_window(self):
        self.ws.decide_surname("борисов", pick="mp-1", valid_from="2026-09-01",
                               valid_to="2026-12-31", requires_cue=False)
        self.assertEqual(self.join("Борисов")["identity"]["id"], "mp-1")
        self.assertEqual(self.join("Борисов", published="2027-02-01T00:00:00Z")
                         ["refused_reason"], "no_match")

    def test_rejected_surname_links_nothing(self):
        self.ws.decide_surname("борисов", pick=None, valid_from="2026-09-01",
                               valid_to="2026-12-31", requires_cue=False)
        self.assertIsNone(self.join("Борисов")["identity"])


class Server(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        d = Path(self.dir.name)
        paths = {"identity": d / "audit.json", "surnames": d / "aliases.json"}
        ws = rp.Workspace("R", gazetteer_doc=GAZ, collected=collected(),
                          bodies={"u0": {"title": "Т", "content": "текст"}},
                          paths=paths)
        handler = type("H", (rp.Handler,), {"workspace": ws})
        self.srv = rp.socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
        self.base = f"http://127.0.0.1:{self.srv.server_address[1]}"
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.dir.cleanup()

    def call(self, path, body=None):
        req = urllib.request.Request(
            self.base + path, method="POST" if body is not None else "GET",
            data=None if body is None else json.dumps(body).encode(),
            headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode()

    def test_page_state_article_and_decisions(self):
        code, page = self.call("/")
        self.assertEqual(code, 200)
        self.assertIn("Преглед", page)
        code, state = self.call("/api/state")
        self.assertEqual(json.loads(state)["reviewer"], "R")
        code, art = self.call("/api/article?url=u0")
        self.assertEqual(json.loads(art)["content"], "текст")
        self.assertEqual(self.call("/api/article?url=zz")[0], 404)
        code, _ = self.call("/api/identity", {"key": "mp-1", "decision": "confirmed"})
        self.assertEqual(code, 200)
        code, body = self.call("/api/identity", {"key": "mp-1", "decision": "refused"})
        self.assertEqual(code, 400)
        self.assertIn("already decided", body)
        self.assertEqual(self.call("/api/undo", {})[0], 200)
        self.assertEqual(self.call("/api/pair?id=nope")[0], 404)
        code, body = self.call("/api/annotation", {"key": "nope", "role": "primary",
                                                   "level": 1})
        self.assertEqual(code, 400)

    def raw(self, path, *, method="GET", headers=None, body=b""):
        import http.client  # noqa: PLC0415
        conn = http.client.HTTPConnection("127.0.0.1", self.srv.server_address[1])
        conn.putrequest(method, path, skip_host=True)
        for k, v in (headers or {}).items():
            conn.putheader(k, v)
        conn.putheader("Content-Length", str(len(body)))
        conn.endheaders(body)
        return conn.getresponse().status

    def test_cross_site_requests_are_refused(self):
        host = f"127.0.0.1:{self.srv.server_address[1]}"
        body = json.dumps({"key": "mp-1", "decision": "refused"}).encode()
        # A form-style POST from another page: no preflight, text/plain.
        self.assertEqual(self.raw("/api/identity", method="POST", body=body,
                                  headers={"Host": host,
                                           "Content-Type": "text/plain"}), 415)
        self.assertEqual(self.raw("/api/identity", method="POST", body=body,
                                  headers={"Host": host,
                                           "Content-Type": "application/json",
                                           "Origin": "https://evil.example"}), 403)
        # DNS rebinding: the right socket, a foreign Host.
        self.assertEqual(self.raw("/api/state", headers={"Host": "evil.example"}), 403)
        self.assertEqual(self.raw("/api/state", headers={"Host": host}), 200)

    def test_the_served_state_keeps_the_annotation_queue_blind(self):
        # The blinding is a property of what the page RECEIVES, not only of
        # the function that builds the items.
        self.srv.RequestHandlerClass.workspace = rp.Workspace(
            "R", gazetteer_doc=GAZ, collected=collected(), bodies={},
            paths={"identity": Path(self.dir.name) / "a2.json",
                   "surnames": Path(self.dir.name) / "s2.json"},
            sample=SAMPLE,
            extra_paths={"working": Path(self.dir.name) / "w.json",
                         "adjudications": Path(self.dir.name) / "adj.json",
                         "registry": Path(self.dir.name) / "reg.json",
                         "scope_review": Path(self.dir.name) / "sc.json",
                         "stoplist": Path(self.dir.name) / "stop.json"})
        _, state = self.call("/api/state")
        served = json.dumps(json.loads(state)["queues"]["annotation"],
                            ensure_ascii=False)
        for secret in ("secret.bg", "model_scored", "pipeline", "-1.2", "u0"):
            self.assertNotIn(secret, served)
        _, text = self.call("/api/pair?id=k0")
        self.assertNotIn("secret.bg", text)

    def test_the_page_builds_no_markup_from_data(self):
        # Excerpts and names are corpus text; the page must render them as
        # text nodes, never as HTML.
        _, page = self.call("/")
        self.assertNotIn("innerHTML", page)
        self.assertNotIn("insertAdjacentHTML", page)


if __name__ == "__main__":
    unittest.main()
