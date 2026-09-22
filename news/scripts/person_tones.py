#!/usr/bin/env python3
"""T4.3 — generic PERSON treatment: how one article presents one named
person, with the same evidence contract the axes and party tones carry.

⚠️ FOUR REFUSALS, and each is a claim we decline to make.

1. **No identity, no public tone.** A tone is stored against a
   `news_person_id` the T4.0 resolver produced FOR THIS ARTICLE, never
   against a surface. A name the registry refuses (an ambiguous „Огнян
   Атанасов", of whom the corpus holds three) stays where the resolver put
   it — in the `news_persons` sidecar with its basis — and gets no tone at
   all. `ambiguous_identity` is a property of that mention record, not of a
   tone: requiring a canonical id and permitting ambiguity in one array is
   the contradiction this file exists to avoid.
2. **Tone is about the ARTICLE's presentation, never the person.** Neutral
   reporting of an allegation, a death or an investigation is `neutral`. A
   tragedy does not make every person in it treated unfavourably, and one
   article may treat two people differently. The prompt says so; the gate
   cannot check it, and nothing here claims otherwise.
3. **A directional claim needs a located quote**, exactly as for party tones
   (`analyze_articles.locate_evidence_spans` / `party_tone_spans_support`
   are reused rather than reimplemented) — and `neutral` carries none,
   because an absence of framing is not provable by a quote.
4. **An incidental mention gets no forced sentiment.** `subject_role`
   separates the person the article is about from the person it names in
   passing; an incidental target is stored with `assessment_status:
   not_assessed` and no tone.

`assessment_status` and `tone` are consistent by validation: `assessed`
requires a tone, and everything else forbids one. `insufficient_text` is the
T4.1c answer — the model did not see the whole article, so an article-wide
claim about a person in it is not available.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("DATA_BG_ROOT") or HERE.parent.parent)
sys.path.insert(0, str(HERE))

import analyze_articles as aa  # noqa: E402
import resolve_mentions as rm  # noqa: E402

RUBRIC_VERSION = "person-treatment-v1"
TONE_LABELS = frozenset({"favorable", "unfavorable", "neutral", "mixed"})
SUBJECT_ROLES = frozenset({"primary", "secondary", "incidental"})
ASSESSMENT_STATUSES = frozenset({"assessed", "insufficient_text", "not_assessed"})
SPAN_DIRECTIONS = frozenset({"favorable", "unfavorable"})
DEFAULT_MODEL = "z-ai/glm-5.3-flash"
# ⚠️ Targets are capped so one prompt stays answerable, and the cap is
# RECORDED per article (`targets_total` / `targets_dropped`) rather than
# silently applied: a person this pass never looked at must not be
# indistinguishable from one it assessed and found nothing to say about.
MAX_TARGETS = 6
# ⚠️ THE SAME PREFIX THE ANALYSIS RUNNER USES, imported rather than restated:
# `text_scope` stamps what the model saw, so a second, independent constant
# would let an article-wide claim made on 60% of a text wear a `full` badge.
from build_prompts import MAX_BODY_CHARS as LEDE_CHARS  # noqa: E402

SYSTEM = """Ти си редактор, който преценява КАК един материал представя конкретно лице.

Оценяваш ТЕКСТА, не човека. Фактическо съобщаване за обвинение, разследване,
присъда или смърт е `neutral` — тежестта на събитието не е отношение на
изданието. Един материал може да представя двама души различно.

За всяко подадено лице върни:
- `subject_role`: `primary` (материалът е за него), `secondary` (съществен
  участник) или `incidental` (само споменат мимоходом).
- `tone`: `favorable`, `unfavorable`, `neutral` или `mixed` — САМО когато
  ролята е `primary` или `secondary`. За `incidental` върни `null`.
- `rationale`: обяснението, което чете човек. Свободен текст; никъде не се
  сверява с текста на статията.
- `evidence_spans`: доказателството. Всеки елемент е `quote` (ДОСЛОВЕН низ,
  копиран буква по буква от статията), `field` (`title` или `body`),
  `direction` (`favorable` или `unfavorable`) и `voice` (`journalist`,
  `quoted_speaker` или `unclear`); при `quoted_speaker` добави `speaker`.
  `favorable`/`unfavorable` искат поне един span в същата посока; `mixed` —
  по един във всяка; `neutral` и `incidental` — БЕЗ spans.

Не перифразирай в `quote`. Ако не можеш да копираш точния низ, не давай span.
Цитирано обвинение от опонент не е рамка на изданието — отбележи го с `voice`.
Не връщай идентификатори: самоличността е решена преди твоя отговор."""

SCHEMA = {
    "type": "object",
    "properties": {
        "people": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "target": {"type": "integer"},
                    "subject_role": {"type": "string", "enum": sorted(SUBJECT_ROLES)},
                    "tone": {"type": ["string", "null"], "enum": sorted(TONE_LABELS) + [None]},
                    "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                    "rationale": {"type": "string", "minLength": 1},
                    "evidence_spans": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "quote": {"type": "string", "minLength": 1},
                                "field": {"type": "string", "enum": ["title", "body"]},
                                "direction": {"type": "string", "enum": sorted(SPAN_DIRECTIONS)},
                                "voice": {"type": "string",
                                          "enum": ["journalist", "quoted_speaker", "unclear"]},
                                "speaker": {"type": "string"},
                            },
                            "required": ["quote", "field", "direction", "voice"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["target", "subject_role", "tone", "confidence",
                             "rationale", "evidence_spans"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["people"],
    "additionalProperties": False,
}


# ------------------------------------------------------------------ inputs ---

def resolved_targets(identities: list) -> list:
    """The people an article may carry a tone for: one entry per RESOLVED
    `news_person_id`, with every surface that resolved to it.

    ⚠️ An unresolved surface is NOT here. It stays in the `news_persons`
    sidecar with its own basis (`ambiguous_registry`, `not_in_registry`), and
    no tone is ever attached to it — see refusal 1."""
    by_id: dict = {}
    for row in identities or []:
        if not isinstance(row, dict):
            continue
        person_id = row.get("news_person_id")
        # Refusal 1, checked HERE rather than inherited: an ambiguous or
        # unregistered decision carries no id, and a row that somehow had
        # both is refused on the basis, which is the authoritative field.
        if not person_id or row.get("basis") not in (None, "registry_alias"):
            continue
        entry = by_id.setdefault(person_id, {
            "news_person_id": person_id,
            "name_bg": row.get("name_bg"),
            "name_en": row.get("name_en"),
            "identity_version": row.get("identity_version"),
            "mention_refs": [],
        })
        surface = row.get("surface")
        if surface and surface not in entry["mention_refs"]:
            entry["mention_refs"].append(surface)
    # Sorted by how many surfaces resolved to the identity (the article's own
    # emphasis, the best proxy for „primary" available BEFORE the model
    # answers), then by id for determinism.
    ordered = sorted(by_id.values(),
                     key=lambda t: (-len(t["mention_refs"]), t["news_person_id"]))
    return ordered[:MAX_TARGETS]


def tones_key(article: dict, targets: list) -> str:
    """The cache key: rubric + the article's content + every target identity
    AT ITS VERSION. A re-slug, a merged identity or an edited article all
    move it, so a stored tone can never outlive what it was made about."""
    rows = sorted((t["news_person_id"], t.get("identity_version") or "")
                  for t in targets)
    _, _, digest = aa.evidence_snapshot(article)
    payload = json.dumps([RUBRIC_VERSION, digest, rows], ensure_ascii=False)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def prompt_for(article: dict, targets: list) -> str:
    body = str(article.get("content") or "")[:LEDE_CHARS]
    people = "\n".join(
        f"{i}. {t.get('name_bg') or t['news_person_id']}"
        f" (в текста: {', '.join(t['mention_refs'])})"
        for i, t in enumerate(targets, 1))
    return (f"ЛИЦА ЗА ОЦЕНКА (използвай номера като `target`):\n{people}\n\n"
            f"ЗАГЛАВИЕ: {article.get('title') or ''}\n\n{body}")


# -------------------------------------------------------------- validation ---

def validate(rows: list, targets: list, *, seen_pairs=None) -> list:
    """Shape and consistency of a stored `person_tones` array.

    ⚠️ Status and tone are one decision, not two fields: `assessed` REQUIRES
    a tone, and `insufficient_text` / `not_assessed` forbid one — otherwise a
    consumer reads a tone the record says was never made."""
    errs: list = []
    known = {t["news_person_id"] for t in targets}
    seen = set(seen_pairs or ())
    if not isinstance(rows, list):
        return ["person_tones: must be a list"]
    for i, row in enumerate(rows):
        at = f"person_tones[{i}]"
        if not isinstance(row, dict):
            errs.append(f"{at}: must be an object")
            continue
        person_id = row.get("news_person_id")
        if person_id not in known:
            errs.append(f"{at}.news_person_id: not in this article's resolved "
                        "candidate set — no identity, no public tone")
        pair = (person_id, row.get("rubric_version"))
        if pair in seen:
            errs.append(f"{at}: duplicate (article, person, rubric) pair")
        seen.add(pair)
        if row.get("subject_role") not in SUBJECT_ROLES:
            errs.append(f"{at}.subject_role must be one of {sorted(SUBJECT_ROLES)}")
        status = row.get("assessment_status")
        if status not in ASSESSMENT_STATUSES:
            errs.append(f"{at}.assessment_status must be one of {sorted(ASSESSMENT_STATUSES)}")
        tone = row.get("tone")
        if status == "assessed":
            if tone not in TONE_LABELS:
                errs.append(f"{at}.tone: an assessed target needs one of {sorted(TONE_LABELS)}")
        elif tone is not None:
            errs.append(f"{at}.tone: must be null when the status is {status!r}")
        if row.get("subject_role") == "incidental" and status == "assessed":
            errs.append(f"{at}: an incidental mention carries no forced sentiment")
        confidence = row.get("confidence")
        if confidence is not None and not (isinstance(confidence, (int, float))
                                           and not isinstance(confidence, bool)
                                           and 0.0 <= confidence <= 1.0):
            errs.append(f"{at}.confidence must be a number in [0,1] or null")
        scope = row.get("text_scope")
        if (status == "assessed"
                and isinstance(scope, dict) and scope.get("kind") != "full"):
            # ⚠️ T4.1c IN THE VALIDATOR, not only in the gate: `validate` is
            # what a future writer (a re-import, a hand fix) is checked by,
            # and an article-wide claim from a partial read is exactly what
            # `insufficient_text` exists to say instead.
            errs.append(f"{at}: an article-wide tone needs a `full` text_scope; "
                        f"this row is {scope.get('kind')!r} — use insufficient_text")
        if status == "assessed":
            rationale = row.get("rationale")
            if not isinstance(rationale, str) or len(rationale.split()) < 4:
                errs.append(f"{at}.rationale: must explain the article's treatment")
            # ⚠️ The shared span validator judges what an ANALYST may send,
            # so it refuses the keys the pipeline computes (`located`,
            # offsets, the content hash). A STORED row carries them by
            # construction, so they are stripped before delegating — the
            # rule being checked is the model's claim, not our stamp.
            raw_spans = row.get("evidence_spans")
            if isinstance(raw_spans, list):
                raw_spans = [{k: v for k, v in span.items()
                              if k in aa.PARTY_TONE_SPAN_RAW_KEYS}
                             if isinstance(span, dict) else span
                             for span in raw_spans]
            errs.extend(aa.validate_evidence_spans(
                raw_spans, at, tone, directions_allowed=SPAN_DIRECTIONS))
        for field in ("text_scope", "model_version", "rubric_version",
                      "identity_version", "assessed_at"):
            if field not in row:
                errs.append(f"{at}.{field}: required")
    return errs


def gate(answer: dict, targets: list, article: dict, *, model: str,
         text_scope: dict, assessed_at: str) -> tuple:
    """Turn one model answer into stored rows, keeping only what the article
    supports. Returns (rows, dropped)."""
    dropped: list = []
    rows: list = []
    by_index = {i: t for i, t in enumerate(targets, 1)}
    claimed = set()
    scope_kind = (text_scope or {}).get("kind")
    for item in (answer.get("people") or []):
        if not isinstance(item, dict):
            dropped.append({"reason": "person entry is not an object"})
            continue
        target = by_index.get(item.get("target"))
        if target is None:
            dropped.append({"reason": "target index out of range",
                            "target": item.get("target")})
            continue
        if target["news_person_id"] in claimed:
            dropped.append({"reason": "duplicate target in one answer",
                            "news_person_id": target["news_person_id"]})
            continue
        claimed.add(target["news_person_id"])
        role = item.get("subject_role")
        if role not in SUBJECT_ROLES:
            dropped.append({"reason": "unknown subject_role", "role": role})
            continue
        base = {
            "news_person_id": target["news_person_id"],
            "mention_refs": list(target["mention_refs"]),
            "subject_role": role,
            "confidence": item.get("confidence"),
            "rationale": " ".join(str(item.get("rationale") or "").split()),
            "evidence_spans": [],
            "quoted_attitudes": [],
            "text_scope": text_scope,
            "model_version": model,
            "rubric_version": RUBRIC_VERSION,
            "identity_version": target.get("identity_version"),
            "assessed_at": assessed_at,
        }
        if role == "incidental":
            # Refusal 4: named in passing, shown without a forced sentiment.
            rows.append({**base, "assessment_status": "not_assessed", "tone": None})
            continue
        if scope_kind != "full":
            # Refusal / T4.1c: an article-wide claim needs the whole article.
            rows.append({**base, "assessment_status": "insufficient_text",
                         "tone": None,
                         "rationale": base["rationale"]})
            continue
        tone = item.get("tone")
        if tone not in TONE_LABELS:
            dropped.append({"reason": "unknown tone", "tone": tone,
                            "news_person_id": target["news_person_id"]})
            continue
        located = aa.locate_evidence_spans(
            {"evidence_spans": item.get("evidence_spans") or []}, article)
        supported = aa.party_tone_spans_support({"tone": tone, "evidence_spans": located})
        quoted = [s for s in located if s.get("voice") == "quoted_speaker"]
        if not supported:
            # Refusal 3: a directional claim with no located quote on its side.
            dropped.append({"reason": "no located span supports the claimed tone",
                            "news_person_id": target["news_person_id"], "tone": tone})
            rows.append({**base, "assessment_status": "not_assessed", "tone": None,
                         "evidence_spans": located, "quoted_attitudes": quoted})
            continue
        rows.append({**base, "assessment_status": "assessed", "tone": tone,
                     "evidence_spans": located, "quoted_attitudes": quoted})
    return rows, dropped


# ---------------------------------------------------------------- storage ---

def tones_dir(data_dir) -> Path:
    return Path(data_dir) / "analysis" / "person_tones"


def article_key(url: str) -> str:
    return hashlib.sha256((url or "").encode("utf-8")).hexdigest()[:16]


def cached(url: str, data_dir) -> dict | None:
    path = tones_dir(data_dir) / f"{article_key(url)}.json"
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def current_for(article: dict, identities: list, data_dir) -> dict | None:
    """The stored person tones for THIS article and THIS identity set, or
    None. A stale document is nothing, never a stale claim."""
    doc = cached(article.get("url") or "", data_dir)
    if not doc or doc.get("rubric_version") != RUBRIC_VERSION:
        return None
    targets = resolved_targets(identities)
    if not targets:
        return None
    if doc.get("tones_key") != tones_key(article, targets):
        return None
    return doc


def generate(article: dict, targets: list, model: str) -> dict:
    import llm_client  # noqa: PLC0415
    answer = llm_client.complete(SYSTEM, prompt_for(article, targets), model=model,
                                 json_schema=SCHEMA, max_tokens=2500, temperature=0.1)
    return {"raw": json.loads(answer.get("text") or "{}"),
            "model": answer.get("model") or model, "usage": answer.get("usage")}


def assess_article(article: dict, identities: list, data_dir, model: str, *,
                   dry_run: bool = False) -> dict:
    """One article's person tones, or a record saying why there are none."""
    targets = resolved_targets(identities)
    distinct = {r.get("news_person_id") for r in (identities or [])
                if isinstance(r, dict) and r.get("news_person_id")
                and r.get("basis") in (None, "registry_alias")}
    record = {
        "version": 1,
        "rubric_version": RUBRIC_VERSION,
        "url": article.get("url"),
        "tones_key": tones_key(article, targets) if targets else None,
        "target_count": len(targets),
        "targets_total": len(distinct),
        "targets_dropped": max(0, len(distinct) - len(targets)),
        "generated_at": aa.now_iso(),
    }
    if not targets:
        # Refusal 1: nobody in this article has an identity.
        return {**record, "status": "no_resolved_identity", "person_tones": []}
    text_scope = aa.text_scope_of({"analysis_provenance": article.get("analysis_provenance")},
                                  article)
    if dry_run:
        return {**record, "status": "would_generate", "person_tones": []}
    try:
        answer = generate(article, targets, model)
    except Exception as exc:  # noqa: BLE001 — a failed run claims nothing
        return {**record, "status": "failed",
                "reason": f"{type(exc).__name__}: {str(exc)[:200]}",
                "person_tones": []}
    rows, dropped = gate(answer["raw"], targets, article, model=answer["model"],
                         text_scope=text_scope, assessed_at=record["generated_at"])
    # ⚠️ PER ROW, NOT PER RECORD. One malformed row must not discard another
    # person's correctly evidenced one — and a whole-record refusal also
    # never cached, so the article regenerated on every run for ever.
    kept, invalid = [], []
    seen_pairs: set = set()
    for row in rows:
        errs = validate([row], targets, seen_pairs=seen_pairs)
        if errs:
            invalid.append({"news_person_id": row.get("news_person_id"),
                            "reason": "failed its own contract", "errors": errs[:4]})
            continue
        seen_pairs.add((row.get("news_person_id"), row.get("rubric_version")))
        kept.append(row)
    return {**record, "status": "ok", "model": answer["model"],
            "person_tones": kept, "dropped": dropped + invalid,
            "assessed": sum(1 for r in kept if r["assessment_status"] == "assessed")}


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--data-dir", type=Path, default=ROOT / "news" / "data")
    ap.add_argument("--app-data", type=Path, default=ROOT / "news" / "app-data")
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--model", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args(argv)
    import llm_client  # noqa: PLC0415
    llm_client.load_env_files(root=ROOT)
    model = args.model or os.environ.get("NEWS_LLM_MODEL") or DEFAULT_MODEL
    out_dir = tones_dir(args.data_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stats = {"generated": 0, "cached": 0, "no_resolved_identity": 0, "ok": 0,
             "failed": 0, "invalid": 0, "would_generate": 0, "assessed": 0,
             "dropped": 0,
             # ⚠️ Counted, not silent: a broken corpus lookup otherwise
             # reports all-zeros at exit 0 and reads as „nothing to do".
             "skipped_no_index_entry": 0, "skipped_unreadable": 0,
             "skipped_no_corpus_file": 0}
    # The resolved identities live on the PUBLIC analysis, so the app-data
    # bundles are the input: identity resolution is a build-time decision.
    try:
        index = json.loads((args.data_dir / "analysis" / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        index = {}
    for bundle in sorted((args.app_data / "articles").glob("*.json")):
        if stats["generated"] >= args.limit:
            break
        try:
            rows = json.loads(bundle.read_text(encoding="utf-8")).get("articles") or []
        except (OSError, ValueError):
            continue
        for row in rows:
            if stats["generated"] >= args.limit:
                break
            analysis = row.get("analysis") or {}
            identities = analysis.get("news_persons") or []
            if not any(i.get("news_person_id") for i in identities):
                continue
            # The CORPUS file is the snapshot a span is located in; the
            # analysis index is what maps a url to it.
            entry = (index.get("articles") or {}).get(row.get("url")) or {}
            analysis_path = ROOT / (entry.get("path") or "")
            if not analysis_path.is_file():
                stats["skipped_no_index_entry"] += 1
                continue
            try:
                saved = json.loads(analysis_path.read_text(encoding="utf-8"))
                path = ROOT / (saved.get("article_path") or "")
            except (OSError, ValueError):
                stats["skipped_unreadable"] += 1
                continue
            if not path.is_file():
                stats["skipped_no_corpus_file"] += 1
                continue
            try:
                article = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                stats["skipped_unreadable"] += 1
                continue
            article.setdefault("url", row.get("url"))
            article["analysis_provenance"] = saved.get("analysis_provenance")
            existing = cached(article["url"], args.data_dir)
            targets = resolved_targets(identities)
            if (existing and not args.force
                    and existing.get("tones_key") == tones_key(article, targets)
                    and existing.get("status") in ("ok", "no_resolved_identity")):
                stats["cached"] += 1
                continue
            record = assess_article(article, identities, args.data_dir, model,
                                    dry_run=args.dry_run)
            if not args.dry_run:
                aa.write_json_atomic(
                    str(out_dir / f"{article_key(article['url'])}.json"), record)
            stats["generated"] += 1
            stats[record["status"]] = stats.get(record["status"], 0) + 1
            stats["assessed"] += record.get("assessed", 0)
            stats["dropped"] += len(record.get("dropped") or [])
    return aa.emit(0, mode="person_tones", model=model, dry_run=args.dry_run, **stats)


if __name__ == "__main__":
    sys.exit(main())
