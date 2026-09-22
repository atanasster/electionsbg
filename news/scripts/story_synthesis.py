#!/usr/bin/env python3
"""Plan T5.1 — the cited synthesis at the top of a story page.

⚠️⚠️ EVERY CLAIM CITES A MEMBER ARTICLE, AND THE CITATION IS A QUOTE THE
GATE CAN FIND. The model is asked for three things over a story's member
articles — what the sources REPORT IN COMMON, what they DISPUTE (attributed,
with each side's own words), and where they DIFFER IN EMPHASIS — and every
item must carry a verbatim supporting quote from the article it cites.
`gate()` keeps an item only if each quote is a contiguous substring of the
cited article's own text (normalised the way `party_tone_evidence_grounded`
normalises — no token overlap, which loses the negation that reverses a
meaning) and drops the rest, reporting what it dropped. Agreement among
sources is not proof of truth, and the payload says so.

⚠️ A DETERMINISTIC SENTENCE MAY DESCRIBE ONLY A DISTRIBUTION; a semantic
comparison needs quoted spans. So the page's fallback — when there is one
outlet, when the cache is stale, when generation failed, when nothing
survived the gate — is the attributed single-source summary or nothing at
all beside the headlines and links. It never invents a contrast.

⚠️ CACHED BY MEMBER CONTENT HASHES AND RUBRIC VERSION. The cache key is
`sha256(RUBRIC_VERSION, sorted member (url, content_sha256))`, so a member
arriving, a member leaving, a corrected article and a rubric change each
invalidate the synthesis, and a story whose members did not move costs
nothing to rebuild. The cache lives in `news/data/analysis/synthesis/
<story_id>.json`; `build_app_data` attaches a synthesis only when its key
matches the story it is building.

Run:  python3 news/scripts/story_synthesis.py --limit 20      # newest first
      python3 news/scripts/story_synthesis.py --story <id>
      python3 news/scripts/story_synthesis.py --dry-run          # what would run
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

import analyze_articles as aa  # noqa: E402
import resolve_mentions as rm  # noqa: E402

RUBRIC_VERSION = "story-synthesis-v1"
MIN_OUTLETS = 2
MAX_MEMBERS = 8
LEDE_CHARS = 1500
MAX_ITEMS = {"common": 4, "disputed": 3, "emphasis": 4}
MIN_QUOTE_CHARS = 20
DEFAULT_MODEL = "z-ai/glm-5.3-flash"

SYSTEM = """Ти си редактор, който сравнява как различни български медии отразяват едно и също събитие.
Получаваш до осем материала (заглавие и начало на текста) от различни издания.
Отговори САМО с JSON по схемата, без коментар.

Правила, които не се нарушават:
- Всяко твърдение цитира ДОСЛОВНО откъс от посочения материал: копирай думите точно, без съкращения, парафрази или добавки.
- „common": факти, които поне два материала съобщават еднакво. Пиши ги неутрално, като репортаж („според източниците ..."), не като истина.
- „disputed": твърдения, по които материалите или цитираните в тях лица се разминават. Всяка страна се приписва на този, който я казва („според министъра", „според адвоката"), с дословен цитат от съответния материал.
- „emphasis": какво един материал подчертава, а другите не (ъгъл, заглавие, избор на говорещ) — по един ред за материал, с цитат.
- Не измисляй разногласие, ако го няма: празен списък е правилен отговор.
- Не оценявай кой е прав. Не използвай етикети като ляв/десен/проруски.
- Пиши на български, кратко: до 25 думи на твърдение."""

SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["common", "disputed", "emphasis"],
    "properties": {
        "common": {"type": "array", "maxItems": 6, "items": {
            "type": "object", "additionalProperties": False, "required": ["claim", "supports"],
            "properties": {"claim": {"type": "string"},
                           "supports": {"type": "array", "minItems": 1, "maxItems": 4, "items": {
                               "type": "object", "additionalProperties": False, "required": ["article", "quote"],
                               "properties": {"article": {"type": "integer"}, "quote": {"type": "string"}}}}}}},
        "disputed": {"type": "array", "maxItems": 4, "items": {
            "type": "object", "additionalProperties": False, "required": ["claim", "positions"],
            "properties": {"claim": {"type": "string"},
                           "positions": {"type": "array", "minItems": 2, "maxItems": 4, "items": {
                               "type": "object", "additionalProperties": False,
                               "required": ["article", "attributed_to", "quote"],
                               "properties": {"article": {"type": "integer"}, "attributed_to": {"type": "string"},
                                              "quote": {"type": "string"}}}}}}},
        "emphasis": {"type": "array", "maxItems": 8, "items": {
            "type": "object", "additionalProperties": False, "required": ["article", "note", "quote"],
            "properties": {"article": {"type": "integer"}, "note": {"type": "string"}, "quote": {"type": "string"}}}},
    },
}


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def synthesis_dir(data_dir: Path) -> Path:
    """The cache lives beside the analysis store of the SAME data dir the
    stories are read from — a build against a scratch tree must not attach
    documents from the real one."""
    return Path(data_dir) / "analysis" / "synthesis"


def repo_root(data_dir: Path) -> Path:
    """`article_path` is repo-relative (`news/data/<domain>/<file>`), so the
    root is two levels above the data dir."""
    return Path(data_dir).resolve().parent.parent


def squash(value) -> str:
    return " ".join(str(value or "").split())


def content_sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def synthesis_key(members: list) -> str:
    """The cache key: rubric + every member's identity and content hash."""
    rows = sorted((m["url"], m["content_sha256"]) for m in members)
    return hashlib.sha256(json.dumps([RUBRIC_VERSION, rows], ensure_ascii=False).encode("utf-8")).hexdigest()


def member_inputs(story: dict, data_dir: Path) -> list:
    """The member articles with their text — publishable members only (the
    story file's members are already the index's resolved membership).
    `fields` keeps title / description / content APART: the gate tests a
    quote per field, so a span across the seam between them — words the
    article never printed together — can never pass (the same reason
    `resolve_mentions.article_text` joins them with a newline)."""
    out = []
    root = repo_root(data_dir)
    for m in story.get("members") or []:
        rel = m.get("article_path") or ""
        path = root / rel if rel else None
        if not path or not path.is_file():
            continue
        try:
            art = read_json(path)
        except (OSError, ValueError):
            continue
        fields = [str(art.get(k) or "") for k in ("title", "description", "content")]
        out.append({
            "url": m.get("url"), "domain": m.get("domain"), "article_path": rel,
            "title": art.get("title") or "", "published": m.get("published"),
            "content_sha256": content_sha256(art.get("content") or ""),
            "fields": fields, "lede": (art.get("content") or "")[:LEDE_CHARS],
        })
    return out


def eligible(members: list) -> tuple:
    """(ok, reason). Fewer than two DISTINCT outlets is the single-source case."""
    outlets = {m["domain"] for m in members if m.get("domain")}
    if len(outlets) < MIN_OUTLETS:
        return False, f"single_source:{len(outlets)}"
    return True, None


def pick_members(members: list) -> list:
    """At most MAX_MEMBERS, one per outlet first (the comparison is between
    outlets), then the rest by publication time."""
    by_outlet: dict = {}
    for m in sorted(members, key=lambda m: m.get("published") or ""):
        by_outlet.setdefault(m["domain"], []).append(m)
    picked = [rows[0] for rows in by_outlet.values()]
    rest = [m for rows in by_outlet.values() for m in rows[1:]]
    return (picked + rest)[:MAX_MEMBERS]


def prompt_for(members: list) -> str:
    parts = []
    for i, m in enumerate(members, 1):
        parts.append(f"### Материал {i} — {m['domain']}\n{m['title']}\n\n{m['lede']}")
    return "\n\n".join(parts)


# ------------------------------------------------------------------ gate ---

# Quotation marks and dashes carry no propositional content, and the model
# re-types them in its own style: measured on the first 139 cached documents,
# 13 of 40 „quote not found" drops were exact matches differing only in
# `„…“` vs `"…"` vs `„…”`. They are folded on BOTH sides here and nowhere
# else — `rm.fold` is shared with the mention resolver and stays as it is.
_QUOTE_GLYPHS = str.maketrans({c: '"' for c in "„“”‟«»"} | {c: "-" for c in "–—"})
_OUTER_QUOTES = '"\'' + "„“”‟«»"
# An older prompt labelled the title `Заглавие:`; two cached drops quoted a
# real headline with that label in front. It cannot occur in article text
# as a label, so it is not evidence either way.
_PROMPT_LABEL_RE = re.compile(r"^\s*заглавие:\s*", re.IGNORECASE)


def clean_quote(quote) -> str:
    """The quote as stored and rendered: whitespace squashed, a prompt label
    and ONE outer pair of quotation marks removed (the page's `<q>` adds its
    own; 60 of 1,468 shipped quotes carried a leading „ and rendered „„…“)."""
    q = _PROMPT_LABEL_RE.sub("", squash(quote))
    if len(q) >= 2 and q[0] in _OUTER_QUOTES and q[-1] in _OUTER_QUOTES:
        q = q[1:-1].strip()
    # A quote that OPENS with a mark closed mid-way („Лукойл“ има …) is left
    # alone — stripping one side would unbalance it; the page renders such a
    # quote without its own marks instead.
    return q


def _gate_fold(value) -> str:
    return rm.fold(squash(value)).translate(_QUOTE_GLYPHS)


def quote_found(quote: str, fields) -> bool:
    """A contiguous folded span of at least MIN_QUOTE_CHARS inside ONE field.
    `fields` is a list (title / description / content) or a single string;
    the seam between fields is never a source."""
    # A trailing terminator is the model's, not evidence: „…събития." is
    # the same words as the article's „…събития", and an ellipsis marks a
    # truncation rather than a claim.
    folded = _gate_fold(clean_quote(quote)).strip('"').rstrip('.…!?,;: "').strip()
    if len(folded) < MIN_QUOTE_CHARS:
        return False
    parts = [fields] if isinstance(fields, str) else list(fields or [])
    return any(folded in _gate_fold(part) for part in parts)


def gate(answer: dict, members: list) -> tuple:
    """Keep only what the articles themselves support. Returns
    (synthesis, dropped) where `dropped` names each refusal."""
    dropped = []
    n = len(members)

    def cite(article_no, quote, where):
        if not isinstance(article_no, int) or not 1 <= article_no <= n:
            dropped.append({"where": where, "reason": "article index out of range", "quote": quote})
            return None
        m = members[article_no - 1]
        if not quote_found(quote, m["fields"]):
            dropped.append({"where": where, "reason": "quote not found in the cited article",
                            "article": article_no, "quote": quote})
            return None
        return {"url": m["url"], "domain": m["domain"], "quote": clean_quote(quote)}

    common = []
    for i, item in enumerate((answer.get("common") or [])[:MAX_ITEMS["common"] * 2]):
        supports = [c for c in (cite(s.get("article"), s.get("quote"), f"common[{i}]")
                                for s in item.get("supports") or []) if c]
        # „In common" needs two DIFFERENT outlets saying it.
        if len({s["domain"] for s in supports}) >= 2:
            common.append({"claim": squash(item.get("claim")), "supports": supports})
        else:
            dropped.append({"where": f"common[{i}]", "reason": "fewer than two outlets support it after the gate"})
    disputed = []
    for i, item in enumerate((answer.get("disputed") or [])[:MAX_ITEMS["disputed"] * 2]):
        positions = []
        for p in item.get("positions") or []:
            c = cite(p.get("article"), p.get("quote"), f"disputed[{i}]")
            if c:
                positions.append({**c, "attributed_to": squash(p.get("attributed_to"))})
        if len({p["domain"] for p in positions}) >= 2 and all(p["attributed_to"] for p in positions):
            disputed.append({"claim": squash(item.get("claim")), "positions": positions})
        else:
            dropped.append({"where": f"disputed[{i}]", "reason": "a dispute needs two attributed, quoted sides from two outlets"})
    emphasis = []
    seen_articles = set()
    for i, item in enumerate((answer.get("emphasis") or [])[:MAX_ITEMS["emphasis"] * 2]):
        c = cite(item.get("article"), item.get("quote"), f"emphasis[{i}]")
        if c and c["url"] not in seen_articles:
            seen_articles.add(c["url"])
            emphasis.append({**c, "note": squash(item.get("note"))})
    return ({"common": common[:MAX_ITEMS["common"]], "disputed": disputed[:MAX_ITEMS["disputed"]],
             "emphasis": emphasis[:MAX_ITEMS["emphasis"]]}, dropped)


# --------------------------------------------------------------- generate ---

def generate(members: list, model: str, max_tokens: int = 3000) -> dict:
    import llm_client  # noqa: PLC0415
    answer = llm_client.complete(SYSTEM, prompt_for(members), model=model, json_schema=SCHEMA,
                                 max_tokens=max_tokens, temperature=0.1)
    text = answer.get("text") or ""
    return {"raw": json.loads(text), "usage": answer.get("usage"), "model": answer.get("model") or model}


def synthesize_story(story: dict, data_dir: Path, model: str, *, dry_run: bool = False) -> dict:
    members = member_inputs(story, data_dir)
    key = synthesis_key(members)
    record = {
        "version": 1, "rubric_version": RUBRIC_VERSION, "story_id": story["id"],
        "synthesis_key": key, "member_count": len(members),
        "outlets": sorted({m["domain"] for m in members}),
        "generated_at": aa.now_iso(),
        "caveat_bg": "Съвпадение между източниците не е доказателство за истинност; всяко твърдение сочи материала и думите, на които се основава.",
        "caveat_en": "Agreement among sources is not proof of truth; every claim points to the article and the words it rests on.",
    }
    ok, reason = eligible(members)
    if not ok:
        return {**record, "status": "single_source", "reason": reason, "synthesis": None}
    chosen = pick_members(members)
    if dry_run:
        return {**record, "status": "would_generate", "members_in_prompt": len(chosen), "synthesis": None}
    try:
        answer = generate(chosen, model)
    except Exception as exc:  # noqa: BLE001 — a failed generation keeps the headlines, never invents
        return {**record, "status": "failed", "reason": f"{type(exc).__name__}: {str(exc)[:200]}", "synthesis": None}
    synthesis, dropped = gate(answer["raw"], chosen)
    empty = not (synthesis["common"] or synthesis["disputed"] or synthesis["emphasis"])
    return {**record, "status": "empty" if empty else "ok", "model": answer["model"],
            "members_in_prompt": [{"url": m["url"], "domain": m["domain"]} for m in chosen],
            "synthesis": None if empty else synthesis, "dropped": dropped,
            "usage": answer.get("usage")}


def cached(story_id: str, data_dir: Path) -> dict | None:
    path = synthesis_dir(data_dir) / f"{story_id}.json"
    if not path.is_file():
        return None
    try:
        return read_json(path)
    except (OSError, ValueError):
        return None


def current_for(story: dict, data_dir: Path) -> dict | None:
    """The cached synthesis for THIS membership, or None. What the build
    attaches; a stale cache is silently nothing, never a stale claim."""
    doc = cached(story["id"], data_dir)
    if not doc or doc.get("rubric_version") != RUBRIC_VERSION:
        return None
    # A failed generation is retried on the next run and carries an exception
    # string; `single_source` and `would_generate` carry nothing. Only a
    # document the gate actually passed (ok / empty) is worth shipping.
    if doc.get("status") not in ("ok", "empty"):
        return None
    members = member_inputs(story, data_dir)
    if doc.get("synthesis_key") != synthesis_key(members):
        return None
    return doc


def current_for_id(story_id: str, data_dir: Path) -> dict | None:
    """`current_for` from the ANALYSIS story file. The app-data writer's story
    rows carry no `article_path`, so a key computed from them is empty and
    matches nothing — measured 2026-09-22: 0 of 70 cached syntheses attached
    through that path. The key must be derived from the same inputs the
    generator read."""
    path = data_dir / "analysis" / "stories" / f"{story_id}.json"
    if not path.is_file():
        return None
    try:
        story = read_json(path)
    except (OSError, ValueError):
        return None
    # The file name is the id; an analysis story written without one (older
    # fixtures) is still addressable by it.
    return current_for({**story, "id": story.get("id") or story_id}, data_dir)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data-dir", type=Path, default=ROOT / "news" / "data")
    ap.add_argument("--story", action="append", default=[])
    ap.add_argument("--limit", type=int, default=20, help="stories to generate this run, newest first")
    ap.add_argument("--model", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="regenerate even when the cache key matches")
    args = ap.parse_args(argv)
    import llm_client  # noqa: PLC0415
    llm_client.load_env_files(root=ROOT)
    model = args.model or os.environ.get("NEWS_LLM_MODEL") or DEFAULT_MODEL
    index = read_json(args.data_dir / "analysis" / "index.json")
    story_dir = args.data_dir / "analysis" / "stories"
    ids = args.story or [sid for sid, _ in sorted(index.get("stories", {}).items(),
                                                   key=lambda kv: kv[1].get("last_published") or "", reverse=True)
                         if (index["stories"][sid].get("member_count") or 0) >= 2]
    out_dir = synthesis_dir(args.data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stats = {"generated": 0, "cached": 0, "single_source": 0, "would_generate": 0,
             "failed": 0, "empty": 0, "ok": 0, "dropped_items": 0}
    started = time.monotonic()
    for sid in ids:
        if stats["generated"] >= args.limit and not args.story:
            break
        path = story_dir / f"{sid}.json"
        if not path.is_file():
            continue
        story = read_json(path)
        members = member_inputs(story, args.data_dir)
        ok, _ = eligible(members)
        if not ok:
            stats["single_source"] += 1
            continue
        existing = cached(sid, args.data_dir)
        if existing and not args.force and existing.get("synthesis_key") == synthesis_key(members) \
                and existing.get("rubric_version") == RUBRIC_VERSION and existing.get("status") in ("ok", "empty"):
            stats["cached"] += 1
            continue
        result = synthesize_story(story, args.data_dir, model, dry_run=args.dry_run)
        if not args.dry_run:
            aa.write_json_atomic(str(out_dir / f"{sid}.json"), result)
        stats["generated"] += 1
        stats[result["status"]] += 1
        stats["dropped_items"] += len(result.get("dropped") or [])
    return aa.emit(0, mode="story_synthesis", model=model, dry_run=args.dry_run,
                   seconds=round(time.monotonic() - started, 1), **stats)


if __name__ == "__main__":
    sys.exit(main())
