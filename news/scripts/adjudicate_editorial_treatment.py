#!/usr/bin/env python3
"""Blinded local workspace for the Tier 0 editorial-treatment v2 human gate.

The gate needs 50 real judgments on three axes, twice. Doing that by hand-editing
a 50-row JSON template while opening 50 article files in another window is the
reason the gate has not moved, so this serves the article, the rubric and the
three pickers on one page and writes the pass file for you.

    python3 news/scripts/adjudicate_editorial_treatment.py --pass A --adjudicator "Name"

What it deliberately does NOT do:

- it never shows a v1 label, an analysis file, the clean-amplification stratum
  or the other pass. Those are the things the sample was built to hide, and a
  tool that leaked one would make the kappa meaningless rather than merely
  inconvenient;
- it never shows the outlet or URL until you ask. §3.2 rule 7 says judge the
  text, never outlet reputation — so the source is one deliberate click, and
  the click is RECORDED on the row's sidecar note. A reveal is not misconduct;
  an unrecorded one is unauditable;
- it never writes inside `news/evals/`. Working copies live in the gitignored
  `news/var/adjudication/`, because the checked-in templates are the frozen
  input to the gate and must stay pending;
- it never touches `article_path`, `article_sha256` or `party_surface`. It
  writes `decision` and, on finalize, `adjudicator` / `completed_at` /
  `rows_sha256` — nothing else. The scorer rejects a pass whose immutable
  fields moved, so a bug here fails loudly instead of scoring the wrong thing.

Notes go to a SIDECAR (`<work>.notes.json`), never into the sealed rows: a note
is how you reconstruct WHY an axis missed 0.80 when you come to revise the
rubric, and the pass file has no field for one.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import socketserver
import sys
import webbrowser
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from score_editorial_treatment_agreement import (  # noqa: E402
    AXES, ORDERS, ROOT, canonical_sha, file_sha,
)

EVAL_DIR = ROOT / "news" / "evals" / "editorial_treatment_v2"
WORK_DIR = ROOT / "news" / "var" / "adjudication"
TEMPLATES = {
    "A": EVAL_DIR / "human-agreement-pass-a.template.json",
    "B": EVAL_DIR / "human-agreement-pass-b.template.json",
}


def atomic_write_json(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2) + "\n",
                   encoding="utf-8")
    os.replace(tmp, path)


def load_article(row: dict) -> dict:
    """Return only the fields an adjudicator may see before a source reveal."""

    path = ROOT / row["article_path"]
    if not path.exists():
        return {"missing": True, "title": "", "content": "", "hash_ok": False}
    doc = json.loads(path.read_text(encoding="utf-8"))
    return {
        "missing": False,
        "hash_ok": file_sha(path) == row.get("article_sha256"),
        "title": doc.get("title") or "",
        "content": doc.get("content") or "",
        "description": doc.get("description") or "",
        "chars": doc.get("content_chars") or len(doc.get("content") or ""),
    }


def open_work(pass_id: str, work: Path, adjudicator: str | None) -> dict:
    if work.exists():
        doc = json.loads(work.read_text(encoding="utf-8"))
        if doc.get("pass_id") != pass_id:
            raise SystemExit(f"{work} is pass {doc.get('pass_id')}, not {pass_id}")
    else:
        doc = json.loads(TEMPLATES[pass_id].read_text(encoding="utf-8"))
        for row in doc["rows"]:
            row["decision"] = None
    if adjudicator:
        doc["adjudicator"] = adjudicator
    return doc


class Handler(http.server.BaseHTTPRequestHandler):
    state: dict = {}

    def log_message(self, *args):  # keep the console quiet
        pass

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _persist(self) -> None:
        atomic_write_json(self.state["work"], self.state["doc"])

    def _persist_notes(self) -> None:
        atomic_write_json(self.state["notes_path"], self.state["notes"])

    def do_GET(self):  # noqa: N802
        route = urlparse(self.path).path
        if route == "/":
            body = PAGE.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if route == "/api/state":
            doc = self.state["doc"]
            rows = []
            for index, row in enumerate(doc["rows"]):
                article = self.state["articles"][index]
                rows.append({
                    "index": index,
                    "assignment_id": row["assignment_id"],
                    "party_surface": row["party_surface"],
                    "title": article["title"],
                    "content": article["content"],
                    "chars": article["chars"],
                    "hash_ok": article["hash_ok"],
                    "missing": article["missing"],
                    "decision": row.get("decision"),
                    "note": self.state["notes"]["rows"].get(
                        row["assignment_id"], {}).get("note", ""),
                    "source_revealed": self.state["notes"]["rows"].get(
                        row["assignment_id"], {}).get("source_revealed", False),
                })
            self._send(200, {
                "pass_id": doc["pass_id"],
                "adjudicator": doc.get("adjudicator"),
                "completed_at": doc.get("completed_at"),
                "axes": {axis: ORDERS[axis] for axis in AXES},
                "scale": {axis: AXES[axis]["scale"] for axis in AXES},
                "off_scale": {axis: AXES[axis]["off_scale"] for axis in AXES},
                "work_path": str(self.state["work"]),
                "rows": rows,
            })
            return
        if route.startswith("/api/source/"):
            index = int(route.rsplit("/", 1)[-1])
            row = self.state["doc"]["rows"][index]
            doc = json.loads((ROOT / row["article_path"]).read_text(encoding="utf-8"))
            entry = self.state["notes"]["rows"].setdefault(
                row["assignment_id"], {})
            entry["source_revealed"] = True
            entry["source_revealed_at"] = datetime.now(timezone.utc).isoformat()
            self._persist_notes()
            self._send(200, {"domain": doc.get("domain"), "url": doc.get("url"),
                             "published": doc.get("published"),
                             "author": doc.get("author")})
            return
        self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        route = urlparse(self.path).path
        length = int(self.headers.get("Content-Length") or 0)
        payload = json.loads(self.rfile.read(length) or b"{}")
        if route == "/api/decision":
            index = int(payload["index"])
            row = self.state["doc"]["rows"][index]
            decision = {}
            for axis in AXES:
                value = payload.get(axis)
                if value is not None and value not in ORDERS[axis]:
                    self._send(400, {"error": f"invalid {axis}: {value}"})
                    return
                decision[axis] = value
            row["decision"] = (decision if all(decision.values()) else None)
            self.state["doc"]["completed_at"] = None  # any edit un-finalizes
            self._persist()
            self._send(200, {"ok": True, "decision": row["decision"],
                             "partial": decision})
            return
        if route == "/api/note":
            row = self.state["doc"]["rows"][int(payload["index"])]
            entry = self.state["notes"]["rows"].setdefault(
                row["assignment_id"], {})
            entry["note"] = payload.get("note", "")
            self._persist_notes()
            self._send(200, {"ok": True})
            return
        if route == "/api/finalize":
            doc = self.state["doc"]
            missing = [i + 1 for i, row in enumerate(doc["rows"])
                       if not row.get("decision")]
            if missing:
                self._send(400, {"error": "incomplete", "missing": missing})
                return
            if not doc.get("adjudicator"):
                self._send(400, {"error": "no adjudicator name"})
                return
            doc["completed_at"] = datetime.now(timezone.utc).isoformat()
            doc["rows_sha256"] = canonical_sha(doc["rows"])
            self._persist()
            self._send(200, {"ok": True, "path": str(self.state["work"]),
                             "completed_at": doc["completed_at"],
                             "rows_sha256": doc["rows_sha256"]})
            return
        self._send(404, {"error": "not found"})


PAGE = r"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Editorial-treatment v2 — adjudication</title>
<style>
:root{--bg:#0f1115;--panel:#171a21;--line:#2a2f3a;--ink:#e8eaf0;--dim:#9aa3b2;
--accent:#e2554a;--ok:#3fb27f;--warn:#e0a33e}
*{box-sizing:border-box}
body{margin:0;font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
background:var(--bg);color:var(--ink)}
header{position:sticky;top:0;z-index:5;background:var(--panel);border-bottom:1px solid var(--line);
padding:10px 16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
header b{font-size:14px}
.bar{flex:1;min-width:160px;height:6px;background:#232833;border-radius:3px;overflow:hidden}
.bar span{display:block;height:100%;background:var(--ok);width:0}
button{background:#232833;color:var(--ink);border:1px solid var(--line);border-radius:6px;
padding:6px 10px;cursor:pointer;font:inherit}
button:hover{border-color:#3b4250}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}
main{display:grid;grid-template-columns:minmax(0,1fr) 380px;gap:0;align-items:start}
@media(max-width:960px){main{grid-template-columns:1fr}}
#article{padding:22px 28px;max-width:60rem}
#article h1{font-size:24px;line-height:1.3;margin:0 0 6px}
#article .meta{color:var(--dim);font-size:13px;margin-bottom:18px}
#article .body{white-space:pre-wrap;font-size:16px;line-height:1.75}
aside{position:sticky;top:49px;max-height:calc(100vh - 49px);overflow:auto;
padding:18px;border-left:1px solid var(--line);background:var(--panel)}
.axis{margin-bottom:20px}
.axis h3{margin:0 0 2px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim)}
.axis .hint{font-size:12px;color:var(--dim);margin:0 0 8px}
.opt{display:block;width:100%;text-align:left;margin:3px 0;padding:7px 10px;border-radius:6px;
border:1px solid var(--line);background:#1c2029;cursor:pointer;font-size:13px}
.opt kbd{display:inline-block;min-width:15px;text-align:center;margin-right:8px;
border:1px solid var(--line);border-radius:4px;padding:0 4px;color:var(--dim);font-size:11px}
.opt.on{background:var(--accent);border-color:var(--accent);color:#fff}
.opt.on kbd{border-color:rgba(255,255,255,.5);color:#fff}
textarea{width:100%;background:#1c2029;color:var(--ink);border:1px solid var(--line);
border-radius:6px;padding:8px;font:inherit;font-size:13px;min-height:60px}
.party{background:#2a2036;border:1px solid #46325c;border-radius:6px;padding:8px 10px;
margin-bottom:14px;font-size:14px}
.rubric{font-size:12.5px;color:var(--dim);border-top:1px solid var(--line);margin-top:16px;padding-top:12px}
.rubric b{color:var(--ink)}
.rubric li{margin-bottom:6px}
.src{font-size:12px;color:var(--dim);margin-top:10px}
#toast{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#232833;
border:1px solid var(--line);border-radius:8px;padding:10px 16px;display:none;z-index:9}
.warn{color:var(--warn)}
</style></head><body>
<header>
  <b id="who">…</b>
  <button onclick="go(-1)">← Prev</button>
  <span id="pos">–</span>
  <button onclick="go(1)">Next →</button>
  <button onclick="jumpUndecided()">Next undecided</button>
  <div class="bar"><span id="prog"></span></div>
  <span id="count" style="font-size:13px;color:var(--dim)"></span>
  <button class="primary" onclick="finalize()">Finalize &amp; seal</button>
</header>
<main>
  <section id="article">
    <h1 id="title"></h1>
    <div class="meta" id="meta"></div>
    <div class="body" id="body"></div>
  </section>
  <aside>
    <div class="party">Party under judgment: <b id="party"></b></div>
    <div id="axes"></div>
    <div class="axis">
      <h3>Note (sidecar, not scored)</h3>
      <p class="hint">Why this was hard. This is what you read if an axis misses 0.80.</p>
      <textarea id="note" placeholder="optional"></textarea>
    </div>
    <div class="src">
      <button onclick="reveal()">Reveal source</button>
      — §3.2 r7: judge the text, not the outlet. A reveal is recorded.
      <div id="srcout"></div>
    </div>
    <div class="rubric">
      <b>Five positions</b> (§3.1) — −2 dominant hostile authorial thesis ·
      −1 materially weakened by selected criticism · 0 procedural or genuinely
      balanced · +1 the subject's message controls headline/lead with no
      material challenge (clean amplification, not praise) · +2 dominant
      favorable thesis.
      <ul>
        <li><b>Centrality is required.</b> A bare mention, historical fact or
        vote table is neutral and does not become favorable because no rebuttal
        follows.</li>
        <li><b>Strong needs an editorial thesis.</b> A politician praising
        themselves is not enough — headline, narration or structure must adopt
        and sustain it.</li>
        <li><b>A second source is not automatically negative.</b> Proportionate
        response and counter-response is neutral.</li>
        <li><b>A right of reply does not neutralize an investigation.</b></li>
        <li><b>Truth and stance are different questions.</b></li>
        <li><b>Leaning applicability is the TOPIC</b>; direction is the
        treatment. A political article with no ideological proposition is
        <b>neutral</b>, never not_applicable (B4). not_applicable means no
        political dimension at all — weather, a football result.</li>
        <li><b>Russia applicability is material involvement.</b> A political
        article that never touches Russia is not_applicable; balanced treatment
        of a Russia issue is neutral. The target is the Russian state and its
        policy — not Russian people, language or culture.</li>
        <li><b>Anchors (§3.5):</b> progressive = civil/minority rights,
        pluralism, institutional checks, rule-of-law reform, EU liberal-democratic
        norms. conservative = traditional order, church/family authority,
        sovereignty-first, anti-pluralist framing. Economic liberalism, welfare,
        tax levels and generic anti-corruption do <b>not</b> decide this axis.</li>
        <li>Party and framing judgments stay <b>independent</b>.</li>
      </ul>
    </div>
  </aside>
</main>
<div id="toast"></div>
<script>
let S=null,i=0;
const KEYS={leaning:['1','2','3','4','5','0'],russia_stance:['q','w','e','r','t','y'],
            party_tone:['a','s','d','f','g']};
const HINT={leaning:'Topic decides applicability; treatment decides direction.',
            russia_stance:'Russia must be materially involved.',
            party_tone:'Treatment of this party in this article.'};
function toast(m,ms=1800){const t=document.getElementById('toast');t.textContent=m;
  t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',ms)}
async function load(){S=await(await fetch('/api/state')).json();
  document.getElementById('who').textContent=`Pass ${S.pass_id} · ${S.adjudicator||'(no name)'}`;
  const first=S.rows.findIndex(r=>!r.decision); i=first<0?0:first; render()}
function decided(){return S.rows.filter(r=>r.decision).length}
function render(){const r=S.rows[i];
  document.getElementById('pos').textContent=`${i+1}/${S.rows.length}`;
  document.getElementById('count').textContent=`${decided()} decided`;
  document.getElementById('prog').style.width=(100*decided()/S.rows.length)+'%';
  document.getElementById('title').textContent=r.title||'(no title)';
  document.getElementById('meta').innerHTML=`${r.chars} chars`+
    (r.hash_ok?'':' <span class="warn">— article hash does not match the frozen sample</span>');
  document.getElementById('body').textContent=r.content||'(no body)';
  document.getElementById('party').textContent=r.party_surface;
  document.getElementById('note').value=r.note||'';
  document.getElementById('srcout').textContent='';
  const host=document.getElementById('axes');host.innerHTML='';
  for(const axis of Object.keys(S.axes)){
    const box=document.createElement('div');box.className='axis';
    box.innerHTML=`<h3>${axis.replace('_',' ')}</h3><p class="hint">${HINT[axis]}</p>`;
    S.axes[axis].forEach((label,n)=>{
      const b=document.createElement('button');b.className='opt';
      const k=KEYS[axis][label===S.off_scale[axis]?5:n];
      b.innerHTML=`<kbd>${k||'·'}</kbd>${label}`;
      if(r.decision&&r.decision[axis]===label)b.classList.add('on');
      if(!r.decision&&r._partial&&r._partial[axis]===label)b.classList.add('on');
      b.onclick=()=>pick(axis,label);box.appendChild(b)});
    host.appendChild(box)}
  window.scrollTo(0,0)}
async function pick(axis,label){const r=S.rows[i];const before=r.decision;
  r._partial=Object.assign({},r.decision||r._partial||{});r._partial[axis]=label;
  const res=await(await fetch('/api/decision',{method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(Object.assign({index:i},r._partial))})).json();
  const was=!!before;r.decision=res.decision;r._partial=res.partial;render();
  if(r.decision&&!was)setTimeout(()=>go(1),140)}
function go(d){const n=i+d;if(n>=0&&n<S.rows.length){i=n;render()}}
function jumpUndecided(){const n=S.rows.findIndex(r=>!r.decision);
  if(n<0)toast('All 50 decided — Finalize & seal');else{i=n;render()}}
async function reveal(){const d=await(await fetch('/api/source/'+i)).json();
  S.rows[i].source_revealed=true;
  document.getElementById('srcout').innerHTML=
    `<b>${d.domain||''}</b> · ${d.published||'no date'} · ${d.author||'no byline'}<br>${d.url||''}`}
document.getElementById('note').addEventListener('change',e=>{
  S.rows[i].note=e.target.value;
  fetch('/api/note',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({index:i,note:e.target.value})})});
async function finalize(){const res=await fetch('/api/finalize',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{}'});const d=await res.json();
  if(!res.ok){toast(d.error==='incomplete'
    ?`${d.missing.length} rows still undecided (first: #${d.missing[0]})`:d.error,4000);return}
  toast('Sealed → '+d.path,9000)}
document.addEventListener('keydown',e=>{
  if(e.target.tagName==='TEXTAREA'||e.metaKey||e.ctrlKey)return;
  if(e.key==='ArrowRight'){go(1);return} if(e.key==='ArrowLeft'){go(-1);return}
  for(const axis of Object.keys(KEYS)){const n=KEYS[axis].indexOf(e.key.toLowerCase());
    if(n<0)continue;
    const label=n===5?S.off_scale[axis]:S.scale[axis][n];
    if(label){pick(axis,label);e.preventDefault()}return}});
load();
</script></body></html>
"""


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pass", dest="pass_id", choices=["A", "B"], required=True)
    parser.add_argument("--adjudicator", default=None)
    parser.add_argument("--work", default=None,
                        help="working copy (default news/var/adjudication/pass-<id>.json)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true")
    args = parser.parse_args()

    work = Path(args.work) if args.work else WORK_DIR / f"pass-{args.pass_id.lower()}.json"
    work = work.resolve()
    if EVAL_DIR.resolve() in work.parents:
        raise SystemExit(
            f"refusing to write inside {EVAL_DIR} — the checked-in templates are "
            "the frozen input to the gate and must stay pending")

    doc = open_work(args.pass_id, work, args.adjudicator)
    atomic_write_json(work, doc)
    notes_path = work.with_suffix(".notes.json")
    notes = (json.loads(notes_path.read_text(encoding="utf-8"))
             if notes_path.exists() else {"pass_id": args.pass_id, "rows": {}})

    articles = [load_article(row) for row in doc["rows"]]
    bad = [i + 1 for i, a in enumerate(articles) if a["missing"] or not a["hash_ok"]]
    if bad:
        print(f"⚠️  {len(bad)} article(s) missing or hash-moved: rows {bad[:10]}"
              f"{'…' if len(bad) > 10 else ''}\n"
              "    The scorer will reject the pass until the corpus matches the "
              "frozen sample.", file=sys.stderr)

    Handler.state = {"doc": doc, "work": work, "articles": articles,
                     "notes": notes, "notes_path": notes_path}
    socketserver.TCPServer.allow_reuse_address = True
    url = f"http://127.0.0.1:{args.port}/"
    with socketserver.TCPServer(("127.0.0.1", args.port), Handler) as server:
        who = doc.get("adjudicator") or "(no name — pass --adjudicator)"
        print(f"pass {args.pass_id} · {who}\n"
              f"working copy: {work}\n"
              f"notes:        {notes_path}\n"
              f"open:         {url}\n\n"
              "Ctrl-C to stop. Every choice is saved as you make it.")
        if not args.no_open:
            webbrowser.open(url)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nstopped; progress is on disk.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
