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

    def test_the_page_builds_no_markup_from_data(self):
        # Excerpts and names are corpus text; the page must render them as
        # text nodes, never as HTML.
        _, page = self.call("/")
        self.assertNotIn("innerHTML", page)
        self.assertNotIn("insertAdjacentHTML", page)


if __name__ == "__main__":
    unittest.main()
