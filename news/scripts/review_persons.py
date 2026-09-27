#!/usr/bin/env python3
"""The person-sentiment review workspace — one local page for every human step.

Plan: `docs/plans/news-person-sentiment-v1.md` §8.1.

    npm run news:review -- --reviewer "Name"

Serves one page on 127.0.0.1 (nothing leaves the machine), opens the browser
and writes each decision to disk before the next item loads, so closing the tab
or the terminal loses nothing and the next launch resumes at the first
undecided item. Keyboard first; `?` on the page lists the keys.

Queues:
- **Самоличност** — do these excerpts name this gazetteer person? Writes
  `news/data/person_identity_audit.json`, which the identity join reads to
  refuse or cue-gate a link, and which lets a person whose links all rest on a
  two-part name get a page (plan §4.3).
- **Фамилии** — which person a bare surname means, and when. Writes
  `news/data/person_surname_aliases.json` (step 3 of the join).
- **Оценки** — the blinded tone labels behind the accuracy gate (plan §8).
  Answers go to a per-reviewer working copy under `news/var/review/`; only
  „Приключи" merges them into `news/evals/person_adjudications.json`, replacing
  this reviewer's rows and nobody else's. `--second-reader` limits the queue to
  the 50-pair agreement subset.
- **Нови лица** — full names Jev scored that resolve to nobody. Accepting
  writes a validated entry to `news/config/news_persons.json` (the registry
  refuses to save if `news_persons.load_registry` rejects it); „чужденец" and
  „не е лице" go to `news/data/person_scope_review.json` so the name is not
  proposed again.

⚠️ WHAT IT NEVER DOES: decide anything itself, show one queue's decision to
another, or write outside its target files. It reads the corpus as the build
last published it (`news/app-data`), so run the build first for a current view.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import socketserver
import sys
import threading
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import person_identity_join as pij  # noqa: E402
import review_persons_queues as rq  # noqa: E402

ROOT = pij.ROOT
APP_DATA = ROOT / "news" / "app-data"
SENTIMENT_DIR = pij.DATA / "analysis" / "sentiment"
MAIN_PROFILE = "https://naiasno.bg/person/"
SAMPLE_PATH = ROOT / "news" / "evals" / "person_sample.json"
ADJUDICATIONS_PATH = ROOT / "news" / "evals" / "person_adjudications.json"
WORKING_DIR = ROOT / "news" / "var" / "review"
REGISTRY_PATH = ROOT / "news" / "config" / "news_persons.json"
SCOPE_REVIEW_PATH = pij.DATA / "person_scope_review.json"
NEW_PERSON_ACTIONS = ("accept", "foreign", "reject")


def atomic_write_json(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")
    os.replace(tmp, path)


def read_json(path: Path, default: dict) -> dict:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def photo_base() -> str | None:
    """The main site's data origin, for MP photos — read from the same
    `.env.production` the site builds with; no photo when it is absent."""
    env = ROOT / ".env.production"
    if not env.exists():
        return None
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("VITE_DATA_BASE_URL="):
            return line.split("=", 1)[1].strip() or None
    return None


def role_labels() -> dict:
    """The site's own Bulgarian office labels (`pp_role_*`), so the page reads
    „Народен представител“ rather than `mp`. Absent locale → raw codes."""
    path = ROOT / "src" / "locales" / "bg" / "translation.json"
    if not path.exists():
        return {}
    doc = json.loads(path.read_text(encoding="utf-8"))
    return {k[len("pp_role_"):]: v for k, v in doc.items()
            if k.startswith("pp_role_") and not k.startswith("pp_role_plural_")}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def reviewer_slug(reviewer: str) -> str:
    return re.sub(r"[^\w-]+", "-", reviewer.lower()).strip("-") or "reviewer"


def next_registry_version(current: str, today: str) -> str:
    """`YYYY-MM-DD.N` — the next N today, or `.1` on a new day."""
    head, _, n = str(current or "").partition(".")
    if head == today and n.isdigit():
        return f"{today}.{int(n) + 1}"
    return f"{today}.1"


def validated_registry_write(path: Path, doc: dict) -> None:
    """Write the registry only if `load_registry` accepts it — an identity
    record is a published claim, so an invalid one never reaches disk."""
    import news_persons  # noqa: PLC0415
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n",
                   encoding="utf-8")
    try:
        news_persons.load_registry(tmp)
    except ValueError:
        tmp.unlink(missing_ok=True)
        raise
    os.replace(tmp, path)


class Workspace:
    """The queues, their decision files, and an undo stack — no HTTP here."""

    QUEUES = {
        "identity": pij.AUDIT_PATH,
        "surnames": pij.ALIASES_PATH,
    }
    LIST_KEY = {"identity": "decisions", "surnames": "aliases"}

    def __init__(self, reviewer: str, *, gazetteer_doc: dict, collected: dict,
                 bodies: dict, paths: dict | None = None,
                 sample: dict | None = None, registry_doc: dict | None = None,
                 second_reader: bool = False, extra_paths: dict | None = None):
        self.reviewer = reviewer
        self.paths = paths or dict(self.QUEUES)
        self.bodies = bodies
        self.sample = sample or {"pairs": []}
        extra = {"working": WORKING_DIR / f"annotations-{reviewer_slug(reviewer)}"
                            f"{'-second' if second_reader else ''}.json",
                 "adjudications": ADJUDICATIONS_PATH,
                 "registry": REGISTRY_PATH, "scope_review": SCOPE_REVIEW_PATH,
                 **(extra_paths or {})}
        self.extra = extra
        self.working = read_json(extra["working"],
                                 {"version": 1, "answers": {}, "revealed": []})
        self.registry = registry_doc or read_json(
            extra["registry"], {"version": 1, "registry_version": "none",
                                "retired_ids": {}, "persons": []})
        self.scope_review = read_json(extra["scope_review"],
                                      {"version": 1, "foreign": [], "rejected": []})
        people = {e["id"]: e for e in gazetteer_doc.get("entries") or []
                  if e.get("kind") == "person" and e.get("id")}
        self.docs = {q: read_json(p, {"version": 1, self.LIST_KEY[q]: []})
                     for q, p in self.paths.items()}
        self.items = {
            "identity": rq.identity_items(collected, people,
                                          self.docs["identity"]),
            "surnames": rq.surname_items(collected, gazetteer_doc,
                                         self.docs["surnames"]),
            "annotation": rq.annotation_items(self.sample,
                                              second_reader=second_reader),
            "new_people": rq.new_person_items(collected.get("names") or {},
                                              self.registry, self.scope_review),
        }
        self.decided: dict = {q: {} for q in self.items}
        # A working copy survives a restart: its answers are already decided.
        self.decided["annotation"] = dict(self.working.get("answers") or {})
        self.undo_stack: list = []
        self.lock = threading.Lock()

    def _item(self, queue: str, key: str) -> dict:
        for item in self.items[queue]:
            if item["key"] == key:
                return item
        raise KeyError(f"no {queue} item {key!r}")

    def _append(self, queue: str, key: str, entry: dict) -> None:
        if key in self.decided[queue]:
            raise ValueError("already decided — undo first")
        doc = self.docs[queue]
        doc.setdefault(self.LIST_KEY[queue], []).append(entry)
        atomic_write_json(self.paths[queue], doc)
        self.decided[queue][key] = entry
        self.undo_stack.append((queue, key, entry))

    def decide_identity(self, key: str, decision: str, surfaces: list) -> dict:
        with self.lock:
            entry = rq.identity_entry(self._item("identity", key), decision,
                                      surfaces, self.reviewer, now_iso())
            self._append("identity", key, entry)
            return entry

    def decide_surname(self, key: str, *, pick, valid_from: str,
                       valid_to: str, requires_cue: bool) -> dict:
        with self.lock:
            entry = rq.surname_entry(
                self._item("surnames", key), pick=pick, valid_from=valid_from,
                valid_to=valid_to, requires_cue=requires_cue,
                reviewer=self.reviewer, now=now_iso())
            self._append("surnames", key, entry)
            return entry

    def _save_working(self) -> None:
        atomic_write_json(self.extra["working"], self.working)

    def pair_text(self, key: str) -> dict:
        """One pair's article, BLINDED: the text and the name to find in it,
        never the outlet, the URL or the model's answer."""
        self._item("annotation", key)
        pair = next(p for p in self.sample["pairs"] if p["pair_id"] == key)
        body = self.bodies.get(pair.get("article_url")) or {}
        return {"title": body.get("title") or pair.get("title") or "",
                "content": body.get("content") or "",
                "highlight": [pair.get("surface") or ""]}

    def reveal(self, key: str) -> dict:
        """The source, on request — and the request is recorded on the row,
        so the gate can tell a label made knowing the outlet."""
        with self.lock:
            self._item("annotation", key)
            pair = next(p for p in self.sample["pairs"] if p["pair_id"] == key)
            revealed = self.working.setdefault("revealed", [])
            if key not in revealed:
                revealed.append(key)
                self._save_working()
            return {"url": pair.get("article_url"), "domain": pair.get("domain"),
                    "published": pair.get("published")}

    def decide_annotation(self, key: str, *, role, level, wrong_person: bool,
                          declined: bool) -> dict:
        with self.lock:
            self._item("annotation", key)
            if key in self.decided["annotation"]:
                raise ValueError("already decided — undo first")
            answer = rq.annotation_answer(role=role, level=level,
                                          wrong_person=wrong_person,
                                          declined=declined)
            self.working.setdefault("answers", {})[key] = answer
            self._save_working()
            self.decided["annotation"][key] = answer
            self.undo_stack.append(("annotation", key, answer))
            return answer

    def finalize(self) -> dict:
        """Merge this reviewer's answers into the gate's file."""
        with self.lock:
            answers = self.working.get("answers") or {}
            if not answers:
                raise ValueError("nothing to finalize")
            rows = rq.adjudication_rows(
                self.sample, answers, annotator=self.reviewer,
                rubric_version=self.sample.get("rubric_version") or "",
                finalized_at=now_iso(),
                revealed=set(self.working.get("revealed") or ()))
            doc = read_json(self.extra["adjudications"],
                            {"version": 2, "pairs": []})
            atomic_write_json(self.extra["adjudications"],
                              rq.merge_adjudications(
                                  doc, rows, self.reviewer,
                                  {i["key"] for i in self.items["annotation"]}))
            return {"rows": len(rows)}

    def decide_new_person(self, key: str, action: str, fields: dict) -> dict:
        with self.lock:
            item = self._item("new_people", key)
            if key in self.decided["new_people"]:
                raise ValueError("already decided — undo first")
            if action not in NEW_PERSON_ACTIONS:
                raise ValueError(f"action must be one of {NEW_PERSON_ACTIONS}")
            now = now_iso()
            if action == "accept":
                entry = rq.registry_person(
                    item, name_bg=fields.get("name_bg") or "",
                    name_en=fields.get("name_en") or "",
                    disambiguation_bg=fields.get("disambiguation_bg") or "",
                    disambiguation_en=fields.get("disambiguation_en") or "",
                    public_figure=bool(fields.get("public_figure")),
                    reviewer=self.reviewer, now=now)
                previous = self.registry.get("registry_version")
                doc = {**self.registry,
                       "registry_version": next_registry_version(previous, now[:10]),
                       "persons": list(self.registry.get("persons") or []) + [entry]}
                validated_registry_write(self.extra["registry"], doc)
                self.registry = doc
                record = {"action": "accept", "entry": entry,
                          "previous_version": previous}
            else:
                bucket = "foreign" if action == "foreign" else "rejected"
                entry = {"name": item["surface"], "reviewer": self.reviewer,
                         "reviewed_at": now}
                self.scope_review.setdefault(bucket, []).append(entry)
                atomic_write_json(self.extra["scope_review"], self.scope_review)
                record = {"action": action, "entry": entry, "bucket": bucket}
            self.decided["new_people"][key] = {"action": action}
            self.undo_stack.append(("new_people", key, record))
            return entry

    def _undo_new_person(self, record: dict) -> None:
        if record["action"] == "accept":
            pid = record["entry"]["news_person_id"]
            doc = {**self.registry,
                   "registry_version": record["previous_version"],
                   "persons": [p for p in self.registry.get("persons") or []
                               if p.get("news_person_id") != pid]}
            validated_registry_write(self.extra["registry"], doc)
            self.registry = doc
            return
        rows = self.scope_review.get(record["bucket"]) or []
        for i in range(len(rows) - 1, -1, -1):
            if rows[i] == record["entry"]:
                del rows[i]
                break
        atomic_write_json(self.extra["scope_review"], self.scope_review)

    def undo(self) -> dict | None:
        """Remove this session's last decision from its file."""
        with self.lock:
            if not self.undo_stack:
                return None
            queue, key, entry = self.undo_stack.pop()
            if queue == "annotation":
                self.working.get("answers", {}).pop(key, None)
                self._save_working()
                self.decided[queue].pop(key, None)
                return {"queue": queue, "key": key}
            if queue == "new_people":
                self._undo_new_person(entry)
                self.decided[queue].pop(key, None)
                return {"queue": queue, "key": key}
            rows = self.docs[queue][self.LIST_KEY[queue]]
            for i in range(len(rows) - 1, -1, -1):
                if rows[i] == entry:
                    del rows[i]
                    break
            atomic_write_json(self.paths[queue], self.docs[queue])
            self.decided[queue].pop(key, None)
            return {"queue": queue, "key": key}

    def state(self) -> dict:
        return {
            "reviewer": self.reviewer,
            "profile_base": MAIN_PROFILE,
            "photo_base": photo_base(),
            "role_labels": role_labels(),
            "second_reader": self.extra["working"].stem.endswith("-second"),
            "revealed": list(self.working.get("revealed") or []),
            "queues": {q: {"items": items,
                           "decided": {k: v for k, v in self.decided[q].items()}}
                       for q, items in self.items.items()},
        }

    def article(self, url: str) -> dict | None:
        body = self.bodies.get(url)
        if not body:
            return None
        return {"title": body.get("title") or "",
                "content": body.get("content") or ""}


def load_workspace(reviewer: str, *, second_reader: bool = False) -> Workspace:
    import news_persons  # noqa: PLC0415
    registry = news_persons.load_registry(REGISTRY_PATH)
    gazetteer_doc = read_json(pij.GAZETTEER_PATH, {})
    src = pij.Sources(gazetteer_doc=gazetteer_doc, registry=registry)
    print("reading the corpus (a minute on a full checkout)…", file=sys.stderr)
    corpus = pij.corpus_articles(APP_DATA)
    collected = rq.collect(pij.corpus_pairs(APP_DATA, SENTIMENT_DIR, src,
                                            corpus=corpus))
    bodies = corpus[1]
    return Workspace(reviewer, gazetteer_doc=gazetteer_doc,
                     collected=collected, bodies=bodies,
                     sample=read_json(SAMPLE_PATH, {"pairs": []}),
                     registry_doc=registry, second_reader=second_reader)


class Handler(http.server.BaseHTTPRequestHandler):
    workspace: Workspace | None = None

    def log_message(self, *args):
        pass

    def _same_origin(self) -> bool:
        """⚠️ LOCALHOST IS NOT A SECURITY BOUNDARY. Any page open in the
        reviewer's browser can reach 127.0.0.1: a `text/plain` POST needs no
        preflight, and DNS rebinding can read a GET. So the Host must be this
        server, and an Origin, when sent, must be too."""
        port = self.server.server_address[1]
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if (self.headers.get("Host") or "") not in allowed:
            return False
        origin = self.headers.get("Origin")
        return origin is None or origin in {f"http://{h}" for h in allowed}

    def _send(self, code: int, payload, content_type="application/json"):
        body = (payload.encode("utf-8") if isinstance(payload, str)
                else json.dumps(payload, ensure_ascii=False).encode("utf-8"))
        self.send_response(code)
        self.send_header("Content-Type", f"{content_type}; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if not self._same_origin():
            return self._send(403, {"error": "forbidden"})
        url = urlparse(self.path)
        ws = self.workspace
        if url.path == "/":
            return self._send(200, PAGE, "text/html")
        if url.path == "/api/state":
            return self._send(200, ws.state())
        if url.path == "/api/article":
            target = (parse_qs(url.query).get("url") or [""])[0]
            found = ws.article(target)
            return self._send(200 if found else 404,
                              found or {"error": "not in the corpus"})
        if url.path == "/api/pair":
            key = (parse_qs(url.query).get("id") or [""])[0]
            try:
                return self._send(200, ws.pair_text(key))
            except (KeyError, StopIteration):
                return self._send(404, {"error": "no such pair"})
        return self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if not self._same_origin():
            return self._send(403, {"error": "forbidden"})
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip()
        if ctype != "application/json":
            return self._send(415, {"error": "application/json only"})
        ws = self.workspace
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
            route = urlparse(self.path).path
            if route == "/api/identity":
                entry = ws.decide_identity(body["key"], body["decision"],
                                           list(body.get("surfaces") or []))
            elif route == "/api/surname":
                entry = ws.decide_surname(
                    body["key"], pick=body.get("pick"),
                    valid_from=body.get("valid_from"),
                    valid_to=body.get("valid_to"),
                    requires_cue=bool(body.get("requires_cue")))
            elif route == "/api/annotation":
                level = body.get("level")
                entry = ws.decide_annotation(
                    body["key"], role=body.get("role"),
                    level=level if isinstance(level, int) else None,
                    wrong_person=bool(body.get("wrong_person")),
                    declined=bool(body.get("declined")))
            elif route == "/api/reveal":
                entry = ws.reveal(body["key"])
            elif route == "/api/finalize":
                entry = ws.finalize()
            elif route == "/api/new_person":
                entry = ws.decide_new_person(body["key"], body.get("action"),
                                             dict(body.get("fields") or {}))
            elif route == "/api/undo":
                entry = ws.undo()
            else:
                return self._send(404, {"error": "not found"})
        except (KeyError, ValueError, TypeError) as exc:
            return self._send(400, {"error": str(exc)})
        return self._send(200, {"ok": True, "entry": entry})


PAGE = r"""<!doctype html>
<html lang="bg"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Преглед на лица</title>
<style>
:root{--bg:#f7f7f5;--panel:#fff;--line:#dedcd6;--ink:#1d1d1b;--dim:#6b6a66;
--accent:#c2410c;--ok:#15803d;--bad:#b91c1c;--mark:#fde68a}
@media (prefers-color-scheme:dark){:root{--bg:#121316;--panel:#1b1d22;--line:#2d3038;
--ink:#e9e9ec;--dim:#9a9ca6;--accent:#fb923c;--ok:#4ade80;--bad:#f87171;--mark:#713f12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
.app{display:grid;grid-template-columns:230px 1fr;min-height:100vh}
nav{border-right:1px solid var(--line);padding:16px;position:sticky;top:0;height:100vh}
nav h1{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--dim);margin:0 0 12px}
nav button{display:flex;justify-content:space-between;width:100%;padding:8px 10px;margin:2px 0;
border:1px solid transparent;border-radius:8px;background:none;color:inherit;font:inherit;cursor:pointer;text-align:left}
nav button.on{background:var(--panel);border-color:var(--line);font-weight:600}
nav .count{color:var(--dim);font-variant-numeric:tabular-nums}
.bar{height:6px;background:var(--line);border-radius:3px;margin:16px 0 6px;overflow:hidden}
.bar i{display:block;height:100%;background:var(--accent)}
.saved{color:var(--dim);font-size:12px}
main{padding:24px 32px;max-width:980px}
.head{display:flex;justify-content:space-between;align-items:baseline;color:var(--dim);font-size:13px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin-top:12px}
.who{display:flex;gap:14px;align-items:center}
.who img,.who .ph{width:56px;height:56px;border-radius:50%;object-fit:cover;background:var(--line);
display:flex;align-items:center;justify-content:center;font-weight:600;color:var(--dim)}
.who h2{margin:0;font-size:20px}.roles{color:var(--dim);font-size:13px}
.q{margin:18px 0 8px;font-weight:600}
ol.ex{list-style:none;padding:0;margin:0}
ol.ex li{border-top:1px solid var(--line);padding:10px 4px;display:grid;grid-template-columns:28px 1fr auto;gap:8px}
ol.ex li.pick{background:color-mix(in srgb,var(--bad) 12%,transparent)}
ol.ex .n{color:var(--dim);font-variant-numeric:tabular-nums}
ol.ex .src{color:var(--dim);font-size:12px;white-space:nowrap}
mark{background:var(--mark);color:inherit;border-radius:3px;padding:0 2px}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:18px}
.actions button,.cands button{font:inherit;padding:8px 12px;border-radius:8px;border:1px solid var(--line);
background:var(--panel);color:inherit;cursor:pointer}
.actions button kbd,.cands kbd{font:12px ui-monospace,monospace;border:1px solid var(--line);
border-radius:4px;padding:0 4px;margin-right:6px;color:var(--dim)}
.cands{display:grid;gap:6px}.cands button{text-align:left;display:flex;gap:8px;align-items:baseline}
.cands button.sel{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}
.cands .meta{color:var(--dim);font-size:13px}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px}
input[type=text],textarea{font:inherit;width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:inherit}
textarea{min-height:56px}.form{display:grid;gap:8px;margin-top:12px}.form label{display:grid;gap:2px;font-size:13px;color:var(--dim)}
.text{max-height:55vh;overflow:auto;border-top:1px solid var(--line);margin-top:12px;padding-top:8px}
.text p{margin:0 0 10px}.step{color:var(--accent);font-weight:600}
input[type=date]{font:inherit;padding:6px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:inherit}
.hint{color:var(--dim);font-size:13px}.err{color:var(--bad)}.done{color:var(--ok)}
aside{position:fixed;top:0;right:0;width:min(560px,90vw);height:100vh;overflow:auto;
background:var(--panel);border-left:1px solid var(--line);padding:24px;display:none}
aside.open{display:block}aside h3{margin-top:0}
#keys{display:none}#keys.open{display:block}
a{color:var(--accent)}
@media (max-width:760px){.app{grid-template-columns:1fr}nav{position:static;height:auto}}
</style></head><body>
<div class="app">
<nav><h1>Преглед</h1><div id="rail"></div>
<div class="bar"><i id="prog"></i></div><div class="saved" id="saved"></div>
<p class="hint">Преглеждащ: <b id="rev"></b></p>
<p class="hint"><kbd>?</kbd> клавиши</p></nav>
<main><div id="view"></div>
<div id="keys" class="card"><b>Клавиши</b><ul>
<li><b>Самоличност:</b> Y — да, същият · N — друг човек · M — смесено (после 1–5 за откъсите, които са за друг, и Enter) · S — пропусни</li>
<li><b>Фамилии:</b> 1–9 — избери човек · C — изисква контекст · Enter — потвърди · R — отхвърли фамилията · S — пропусни</li>
<li><b>Оценки:</b> P — основен субект · E — участник · после 1–5 (1 силно неблагоприятно … 5 силно благоприятно) · I — мимоходом · N — не е по същество · X — не е този човек · D — не мога да реша · O — покажи източника (записва се) · F — приключи и запиши в оценките · S — пропусни</li>
<li><b>Нови лица:</b> Enter — добави в регистъра (след като редактираш описанието) · F — чужденец · R — не е лице / не е публично · S — пропусни</li>
<li>A — целия текст на първия откъс · U — отмени последното решение · ? — тази помощ</li></ul></div>
</main></div>
<aside id="panel"></aside>
<script>
const Q={identity:"Самоличност",surnames:"Фамилии",annotation:"Оценки",new_people:"Нови лица"};
let S=null,cur="identity",skipped={identity:[],surnames:[],annotation:[],new_people:[]},mixed=null,sel=null,cue=false,msg="",role=null,pairText={},source=null;
const $=id=>document.getElementById(id);
const el=(t,p={},...kids)=>{const e=document.createElement(t);
 for(const[k,v]of Object.entries(p)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;
 else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v)}
 for(const c of kids)if(c!=null)e.append(c);return e};
async function load(){S=await(await fetch("/api/state")).json();$("rev").textContent=S.reviewer;render()}
function pending(q){const d=S.queues[q].decided;return S.queues[q].items.filter(i=>!(i.key in d))}
function current(q){const p=pending(q);const s=skipped[q];
 return p.find(i=>!s.includes(i.key))||p[0]||null}
function roleText(r){const bits=[(S.role_labels||{})[r.role]||r.role];if(r.start)bits.push(r.start.slice(0,4)+"–"+(r.end?r.end.slice(0,4):(r.current?"":"?")));
 return(r.current?"":"бивш: ")+bits.join(" ")}
function excerptNode(x,i){const e=x.excerpt||{};
 return el("li",{class:mixed&&mixed.has(x.surface+"|"+i)?"pick":""},el("span",{class:"n",text:String(i+1)}),
  el("span",{},e.before||"",el("mark",{text:e.match||""}),e.after||"",
   el("div",{class:"src",text:(x.domain||"")+" · "+(x.published||"")+(x.basis?" · "+x.basis+(x.form_kind?"/"+x.form_kind:""):"")})),
  el("a",{href:x.url,target:"_blank",rel:"noopener",class:"src",text:"източник ↗"}))}
function renderRail(){const r=$("rail");r.replaceChildren();let done=0,total=0;
 for(const q of Object.keys(Q)){const n=S.queues[q].items.length,d=Object.keys(S.queues[q].decided).length;done+=d;total+=n;
  r.append(el("button",{class:q===cur?"on":"",onclick:()=>{cur=q;reset();render()}},el("span",{text:Q[q]}),el("span",{class:"count",text:d+"/"+n})))}
 $("prog").style.width=(total?Math.round(100*done/total):0)+"%"}
function reset(){mixed=null;sel=null;cue=false;msg="";role=null;source=null}
function render(){renderRail();const v=$("view");v.replaceChildren();const it=current(cur);
 const d=Object.keys(S.queues[cur].decided).length,n=S.queues[cur].items.length;
 v.append(el("div",{class:"head"},el("span",{text:Q[cur]+" · "+Math.min(d+1,n)+" от "+n}),el("span",{class:msg.startsWith("!")?"err":"done",text:msg.replace(/^!/,"")})));
 if(!it){v.append(el("div",{class:"card"},el("p",{class:"done",text:"Опашката е празна — няма какво да се преглежда."})));return}
 ({identity:renderIdentity,surnames:renderSurname,annotation:renderAnnotation,new_people:renderNewPerson})[cur](v,it)}
function highlighted(text,terms){const t=(terms||[]).filter(Boolean);if(!t.length)return[text];
 const re=new RegExp("("+t.map(x=>x.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")","gi");
 return text.split(re).map((part,i)=>i%2?el("mark",{text:part}):part)}
function renderAnnotation(v,it){const c=el("div",{class:"card"});
 c.append(el("h2",{text:"„"+it.surface+"“"}),el("div",{class:"roles",text:it.canonical?"т.е. "+it.canonical:""}));
 const t=pairText[it.key];
 if(!t){fetch("/api/pair?id="+encodeURIComponent(it.key)).then(r=>r.json()).then(j=>{pairText[it.key]=j;render()});
  c.append(el("p",{class:"hint",text:"зарежда се…"}))}
 else{const box=el("div",{class:"text"},el("h3",{text:t.title||""}));
  for(const para of(t.content||"").split("\n").filter(Boolean))box.append(el("p",{},...highlighted(para,t.highlight)));c.append(box)}
 c.append(el("div",{class:"q"},role?el("span",{class:"step",text:"Тон към човека: 1–5"}):"Каква е ролята на човека в материала?"));
 if(source)c.append(el("div",{class:"hint",text:"Източник: "+(source.domain||"")+" · "+(source.published||"")+" (показан — записва се)"}));
 const a=el("div",{class:"actions"});const b=(k,x,fn)=>el("button",{onclick:fn},el("kbd",{text:k}),x);
 if(role)["силно неблагоприятно","неблагоприятно","неутрално","благоприятно","силно благоприятно"].forEach((x,i)=>a.append(b(String(i+1),x,()=>annotate(it,{role,level:i}))));
 else a.append(b("P","основен субект",()=>{role="primary";render()}),b("E","участник",()=>{role="secondary";render()}),
  b("I","мимоходом",()=>annotate(it,{role:"incidental"})),b("N","не е по същество",()=>annotate(it,{role:"not_substantive"})),
  b("X","не е този човек",()=>annotate(it,{wrong_person:true})),b("D","не мога да реша",()=>annotate(it,{declined:true})));
 a.append(b("O","източник",()=>reveal(it)),b("S","Пропусни",()=>skip(it)),b("U","Отмени последното",undo),b("F","Приключи",finalize));
 c.append(a);v.append(c)}
function renderNewPerson(v,it){const c=el("div",{class:"card"});
 c.append(el("h2",{text:"„"+it.surface+"“"}),el("div",{class:"roles",text:it.pairs+" оценени материала · "+it.outlets+" издания · няма го в речника"}));
 const ol=el("ol",{class:"ex"});it.excerpts.forEach((x,i)=>ol.append(excerptNode(x,i)));c.append(ol);
 const f=(id,label,val,area)=>el("label",{},label,el(area?"textarea":"input",area?{id}:{id,type:"text",value:val}));
 const form=el("div",{class:"form"},f("nbg","Име (български)",it.surface),f("nen","Име (латиница)",""),
  f("dbg","Кой е — само изворно потвърдено, без оценки",""),f("den","Кой е (английски)",""),
  el("label",{},el("span",{},el("input",{type:"checkbox",id:"pf"})," публична личност (без отметка — без собствена страница)")));
 c.append(form);
 const a=el("div",{class:"actions"});const b=(k,x,fn)=>el("button",{onclick:fn},el("kbd",{text:k}),x);
 a.append(b("Enter","Добави в регистъра",()=>npDecide(it,"accept")),b("F","Чужденец",()=>npDecide(it,"foreign")),
  b("R","Не е лице / не е публично",()=>npDecide(it,"reject")),b("S","Пропусни",()=>skip(it)),b("U","Отмени последното",undo));
 c.append(a);v.append(c);setTimeout(()=>{const d=$("dbg");if(d&&!d.value)d.value=it.draft_bg},0)}
function renderIdentity(v,it){const c=el("div",{class:"card"});
 const ph=it.photo&&S.photo_base?el("img",{src:S.photo_base+it.photo,alt:""}):el("div",{class:"ph",text:(it.canonical||"?").split(" ").map(w=>w[0]).join("").slice(0,2)});
 c.append(el("div",{class:"who"},ph,el("div",{},el("h2",{text:it.canonical||it.id}),
  el("div",{class:"roles",text:(it.roles||[]).slice(0,3).map(roleText).join(" · ")||"без записана длъжност"}),
  el("div",{class:"roles"},it.pairs+" материала · "+(it.needs_audit?"само двуименна връзка — нужна проверка":"има и по-силна връзка")+" · ",
   el("a",{href:S.profile_base+it.id,target:"_blank",rel:"noopener",text:"профил в Наясно ↗"})))));
 c.append(el("div",{class:"q",text:mixed?"Отбележи с 1–5 откъсите, които са за ДРУГ човек, после Enter":"Тези откъси за този човек ли са?"}));
 const ol=el("ol",{class:"ex"});it.excerpts.forEach((x,i)=>ol.append(excerptNode(x,i)));c.append(ol);
 const a=el("div",{class:"actions"});
 const b=(k,t,f)=>el("button",{onclick:f},el("kbd",{text:k}),t);
 if(mixed)a.append(b("Enter","Запиши „смесено“",()=>submitMixed(it)),b("Esc","Откажи",()=>{reset();render()}));
 else a.append(b("Y","Да, същият",()=>idDecide(it,"confirmed",[])),b("N","Друг човек",()=>idDecide(it,"refused",[])),
  b("M","Смесено",()=>{mixed=new Set();render()}),b("S","Пропусни",()=>skip(it)),b("U","Отмени последното",undo));
 c.append(a);v.append(c)}
function renderSurname(v,it){const c=el("div",{class:"card"});
 c.append(el("h2",{text:"„"+it.surface+"“"}),el("div",{class:"roles",text:it.pairs+" материала без връзка · "+it.holders_total+" публични лица с тази фамилия"+(it.holders_total>it.candidates.length?" (показани "+it.candidates.length+")":"")}));
 c.append(el("div",{class:"q",text:"Кого означава само фамилията в тези материали?"}));
 const ol=el("ol",{class:"ex"});it.excerpts.forEach((x,i)=>ol.append(excerptNode(x,i)));c.append(ol);
 const cs=el("div",{class:"cands"});it.candidates.forEach((p,i)=>cs.append(el("button",{class:sel===p.id?"sel":"",onclick:()=>{sel=p.id;render()}},
  el("kbd",{text:String(i+1)}),el("span",{text:p.canonical}),el("span",{class:"meta",text:((p.roles||[]).slice(0,2).map(roleText).join(" · ")||"—")+" · "+p.linked_pairs+" с пълно име"}))));
 c.append(el("div",{class:"q",text:"Човек"}),cs);
 const f=el("input",{type:"date",id:"from",value:it.window.from}),t=el("input",{type:"date",id:"to",value:it.window.to});
 c.append(el("div",{class:"row"},el("label",{},"валиден от ",f),el("label",{},"до ",t),
  el("label",{},el("input",{type:"checkbox",id:"cue",...(cue?{checked:""}:{}),onchange:e=>{cue=e.target.checked}})," изисква контекст (C)")));
 const a=el("div",{class:"actions"});const b=(k,x,fn)=>el("button",{onclick:fn},el("kbd",{text:k}),x);
 a.append(b("Enter","Потвърди",()=>snAccept(it)),b("R","Отхвърли фамилията",()=>snReject(it)),b("S","Пропусни",()=>skip(it)),b("U","Отмени последното",undo));
 c.append(a);v.append(c)}
async function post(path,body){const r=await fetch(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
 const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
function saved(){$("saved").textContent="запазено "+new Date().toLocaleTimeString("bg-BG")}
async function idDecide(it,decision,surfaces){try{await post("/api/identity",{key:it.key,decision,surfaces});
 S.queues.identity.decided[it.key]={decision};saved();reset();msg="записано"}catch(e){msg="!"+e.message}render()}
async function submitMixed(it){const sf=[...new Set([...mixed].map(k=>k.split("|")[0]))];
 if(!sf.length){msg="!отбележи поне един откъс";return render()}await idDecide(it,"mixed",sf)}
async function snPost(it,pick){try{await post("/api/surname",{key:it.key,pick,valid_from:$("from").value,valid_to:$("to").value,requires_cue:cue});
 S.queues.surnames.decided[it.key]={pick};saved();reset();msg="записано"}catch(e){msg="!"+e.message}render()}
async function annotate(it,body){try{const r=await post("/api/annotation",{key:it.key,...body});
 S.queues.annotation.decided[it.key]=r.entry;saved();reset();msg="записано"}catch(e){msg="!"+e.message}render()}
async function reveal(it){try{const r=await post("/api/reveal",{key:it.key});source=r.entry}catch(e){msg="!"+e.message}render()}
async function finalize(){try{const r=await post("/api/finalize",{});msg="записани "+r.entry.rows+" оценки";saved()}catch(e){msg="!"+e.message}render()}
async function npDecide(it,action){const g=id=>($(id)||{}).value||"";
 const fields={name_bg:g("nbg"),name_en:g("nen"),disambiguation_bg:g("dbg"),disambiguation_en:g("den"),public_figure:!!($("pf")||{}).checked};
 try{await post("/api/new_person",{key:it.key,action,fields});S.queues.new_people.decided[it.key]={action};saved();reset();msg="записано"}
 catch(e){msg="!"+e.message}render()}
function snAccept(it){if(!sel){msg="!избери човек с 1–9 или отхвърли с R";return render()}snPost(it,sel)}
function snReject(it){snPost(it,null)}
function skip(it){skipped[cur]=skipped[cur].filter(k=>k!==it.key).concat(it.key);reset();render()}
async function undo(){try{const r=await post("/api/undo",{});if(r.entry){delete S.queues[r.entry.queue].decided[r.entry.key];
 skipped[r.entry.queue]=skipped[r.entry.queue].filter(k=>k!==r.entry.key);cur=r.entry.queue;msg="отменено";saved()}else msg="!няма какво да се отмени"}
 catch(e){msg="!"+e.message}reset();render()}
async function article(it){const x=(it.excerpts||[])[0];if(!x)return;const p=$("panel");
 if(p.classList.contains("open")){p.classList.remove("open");return}
 const r=await fetch("/api/article?url="+encodeURIComponent(x.url));const j=await r.json();
 p.replaceChildren(el("h3",{text:j.title||""}),...(j.content||j.error||"").split("\n").filter(Boolean).map(t=>el("p",{text:t})));p.classList.add("open")}
document.addEventListener("keydown",e=>{if(e.target.tagName==="TEXTAREA")return;if(e.target.tagName==="INPUT"&&e.key!=="Enter")return;const it=current(cur);const k=e.key;
 if(k==="?"){$("keys").classList.toggle("open");return}if(k==="u"||k==="U")return undo();if(!it)return;
 if(k==="a"||k==="A")return article(it);if(k==="s"||k==="S")return skip(it);
 if(cur==="annotation"){const K=k.toUpperCase();
  if(role){if(/^[1-5]$/.test(k))annotate(it,{role,level:+k-1});else if(k==="Escape"){role=null;render()}return}
  if(K==="P"){role="primary";render()}else if(K==="E"){role="secondary";render()}else if(K==="I")annotate(it,{role:"incidental"});
  else if(K==="N")annotate(it,{role:"not_substantive"});else if(K==="X")annotate(it,{wrong_person:true});
  else if(K==="D")annotate(it,{declined:true});else if(K==="O")reveal(it);else if(K==="F")finalize();return}
 if(cur==="new_people"){const K=k.toUpperCase();if(k==="Enter")npDecide(it,"accept");
  else if(e.target.tagName!=="INPUT"){if(K==="F")npDecide(it,"foreign");else if(K==="R")npDecide(it,"reject")}return}
 if(cur==="identity"){if(mixed){if(/^[1-5]$/.test(k)){const x=it.excerpts[+k-1];if(x){const id=x.surface+"|"+(+k-1);mixed.has(id)?mixed.delete(id):mixed.add(id);render()}}
   else if(k==="Enter")submitMixed(it);else if(k==="Escape"){reset();render()}return}
  if(k==="y"||k==="Y")idDecide(it,"confirmed",[]);else if(k==="n"||k==="N")idDecide(it,"refused",[]);else if(k==="m"||k==="M"){mixed=new Set();render()}}
 else{if(/^[1-9]$/.test(k)){const p=it.candidates[+k-1];if(p){sel=p.id;render()}}else if(k==="c"||k==="C"){cue=!cue;render()}
  else if(k==="Enter")snAccept(it);else if(k==="r"||k==="R")snReject(it)}});
load();
</script></body></html>"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--reviewer", required=True,
                    help="your name — stamped on every decision")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--no-browser", action="store_true")
    ap.add_argument("--second-reader", action="store_true",
                    help="label only the 50-pair agreement subset, blind to the first reader")
    args = ap.parse_args()
    if not args.reviewer.strip():
        ap.error("--reviewer must not be empty")
    Handler.workspace = load_workspace(args.reviewer.strip(),
                                       second_reader=args.second_reader)
    counts = {q: len(v) for q, v in Handler.workspace.items.items()}
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.ThreadingTCPServer(("127.0.0.1", args.port), Handler) as srv:
        url = f"http://127.0.0.1:{args.port}/"
        print(f"review workspace at {url} — queues {counts}. Ctrl-C to stop; "
              "every decision is already on disk.", file=sys.stderr)
        if not args.no_browser:
            webbrowser.open(url)
        try:
            srv.serve_forever()
        except KeyboardInterrupt:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
