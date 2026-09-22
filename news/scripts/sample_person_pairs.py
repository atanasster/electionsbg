#!/usr/bin/env python3
"""Plan T4.5 — draw the (article, person) pairs a human is asked to label.

⚠️ IT WRITES NO LABELS, and that is the whole point. The gate
(`person_accuracy_gate.py`) is unmet because nobody has adjudicated a pair;
this draws the candidates so that annotating them is possible, and every
`tone`/`human_assessable` field it emits is `null`. A model may not fill
them in — a frontier model is a comparison baseline, not ground truth.

⚠️ IT TARGETED-SAMPLES PERSON-BEARING ANALYSES, because the plan says the
200 pairs are NEW annotation and not an assembly of existing material: the
committed gold set reports `shortfall: {person_linked: {wanted: 40,
got: 30}}` — it could not fill a 40-article person cell under its own
selection method, so drawing from it again reproduces the same shortfall.

⚠️ A RESOLVED IDENTITY IS NOT A PRECONDITION. Sampling only pairs the
pipeline already resolved would make recall unmeasurable by construction:
the pairs it MISSED are exactly the ones a recall floor is about. Every
article carrying a person NAME is in the frame, resolved or not, and the
`pipeline_resolved` / `pipeline_assessed` fields record what the pipeline
did so the human's answer can disagree with it.

Strata (the plan's five, one pair may carry several):
  generic_person  — a person the identity registry has no entry for
  official        — a name the officials roster or the gazetteer knows
  ambiguous_name  — a surface the resolver REFUSED as ambiguous
  quotation       — the person is quoted, or quoted about
  long_article    — a body past `LONG_ARTICLE_CHARS`

The draw is SEEDED and the seed is written into the output, so the same
call reproduces the same sample and a later top-up is auditable.
"""
from __future__ import annotations

import argparse
import json
import random
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from score_analyses import (  # noqa: E402
    PERSON_STRATA as REQUIRED_STRATA, PERSON_STRATA_REPORTED as PERSON_STRATA,
)

LONG_ARTICLE_CHARS = 6000
DEFAULT_TARGET = 200
# ⚠️ The gate requires each stratum to be NON-EMPTY (there is no per-stratum
# count floor); the per-TONE floor of 30 is enforced on the answers. The draw
# aims higher than the target because some pairs come back `unclear`, stale
# or unlabelled.
OVERSAMPLE = 1.25


def load_officials(gazetteer: Path, app_data: Path) -> set:
    """Every RESOLVABLE person form the gazetteer knows, plus the news
    registry's own names.

    ⚠️ THE GAZETTEER IS THE SOURCE, not `news_persons.json`. That file is the
    news IDENTITY registry and holds ONE person today, so building the
    `official` stratum from it drew 53 mentions of one human and reported the
    stratum „covered" — the more dangerous shape than an honest zero. The
    gazetteer carries 5,121 people across 19 office tiers.
    """
    names: set = set()
    if gazetteer.exists():
        try:
            payload = json.loads(gazetteer.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            payload = {}
        for entry in payload.get("entries") or []:
            if entry.get("kind") != "person":
                continue
            for form in entry.get("forms") or []:
                if form.get("resolvable") and form.get("surface"):
                    names.add(str(form["surface"]).casefold())
            if entry.get("canonical"):
                names.add(str(entry["canonical"]).casefold())
    index = app_data / "news_persons.json"
    if index.exists():
        try:
            payload = json.loads(index.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            payload = {}
        for person in payload.get("persons") or []:
            for key in ("name_bg", "name_en"):
                if person.get(key):
                    names.add(str(person[key]).casefold())
    return names


def strata_for(mention: dict, article: dict, *, officials: set) -> list:
    names = []
    resolved = bool(mention.get("news_person_id"))
    basis = mention.get("basis") or mention.get("decision")
    surface = (mention.get("surface") or "").strip()
    if basis == "ambiguous_registry" or mention.get("ambiguous"):
        names.append("ambiguous_name")
    if surface and surface.casefold() in officials:
        names.append("official")
    elif not resolved:
        names.append("generic_person")
    elif resolved:
        # ⚠️ NOT `generic_person`, which means „the registry has no entry".
        # A resolved non-official mention is its own thing, and the old
        # fallback silently mixed the two the moment a second identity was
        # activated.
        names.append("resolved_non_official")
    if mention.get("quoted") or _quoted(article, surface):
        names.append("quotation")
    if int(article.get("content_chars") or 0) >= LONG_ARTICLE_CHARS:
        names.append("long_article")
    return names or ["unclassified"]


def _quoted(article: dict, surface: str) -> bool:
    """A cheap „is this person quoted, or quoted about" heuristic.

    ⚠️ SCOPE: title + excerpt, because the published corpus carries NO body
    text (a typical article is ~1,351 chars against a ~199-char excerpt). The
    stratum is therefore UNDER-detected and its count is a floor, not a count.
 ⚠️ It matches the SURNAME as well as the
    full surface: Bulgarian copy names a person in full once and by surname
    thereafter, so a full-surface-only test scores the stratum on how the
    headline happened to be written."""
    if not surface:
        return False
    text = " ".join(str(article.get(k) or "") for k in ("title", "excerpt"))
    if not any(mark in text for mark in ('"', "„", "«", "заяви", "каза",
                                         "според", "обяви")):
        return False
    if surface in text:
        return True
    tokens = [t for t in surface.split() if len(t) > 2]
    # ⚠️ A BOUNDARY, not a substring: „Калушев" in „Калушева" is a different
    # person's name. Python's \b is Unicode-aware, unlike JavaScript's.
    return any(re.search(rf"\b{re.escape(t)}", text) for t in tokens[-1:])


def candidate_rows(records: list, *, officials: set) -> list:
    rows = []
    for article in records:
        analysis = article.get("analysis") or {}
        mentions = analysis.get("news_persons") or []
        tones = {t.get("news_person_id"): t
                 for t in (analysis.get("person_tones") or [])
                 if isinstance(t, dict)}
        for mention in mentions:
            if not isinstance(mention, dict):
                continue
            person_id = mention.get("news_person_id")
            tone = tones.get(person_id) if person_id else None
            rows.append({
                "article_id": article.get("id"),
                "url": article.get("url"),
                "domain": article.get("domain"),
                "surface": mention.get("surface"),
                "news_person_id": person_id,
                "identity_version": mention.get("identity_version"),
                "rubric_version": (tone or {}).get("rubric_version"),
                "pipeline_resolved": bool(person_id),
                "pipeline_assessed": bool(
                    tone and tone.get("assessment_status") == "assessed"),
                "pipeline_tone": (tone or {}).get("tone"),
            # The pipeline's STATUS is a real answer (`not_assessed` /
            # `insufficient_text`), and the gate scores it as one.
            "pipeline_status": (tone or {}).get("assessment_status"),
                "pipeline_subject_role": (tone or {}).get("subject_role"),
                "strata": strata_for(mention, article, officials=officials),
                # ⚠️ THE HUMAN'S FIELDS, LEFT EMPTY ON PURPOSE.
                "split": "test",
                "sample": "natural",
                "annotator": None,
                "tone": None,
                "human_assessable": None,
                "subject_role": None,
                "evidence_supports": None,
                "wrong_canonical_target": None,
                "labelled_at": None,
            })
    return rows


def draw(rows: list, *, target: int, seed: int) -> dict:
    """Round-robin across strata so no stratum is starved by the corpus's
    own prevalence — which is the point of a hard-case set."""
    rng = random.Random(seed)
    by_stratum = defaultdict(list)
    for row in rows:
        for name in row["strata"]:
            by_stratum[name].append(row)
    for bucket in by_stratum.values():
        rng.shuffle(bucket)
    picked, seen = [], set()
    order = sorted(by_stratum)
    cursor = {name: 0 for name in order}
    while len(picked) < target and any(
            cursor[n] < len(by_stratum[n]) for n in order):
        for name in order:
            while cursor[name] < len(by_stratum[name]):
                row = by_stratum[name][cursor[name]]
                cursor[name] += 1
                key = (row["article_id"], row["surface"], row["news_person_id"])
                if key in seen:
                    continue
                seen.add(key)
                picked.append(row)
                break
            if len(picked) >= target:
                break
    shortfall = {}
    if len(picked) < target:
        shortfall["pairs"] = {"wanted": target, "got": len(picked)}
    covered = Counter(n for row in picked for n in row["strata"])
    # ⚠️ Every declared stratum is reported, ZERO included. A missing key
    # reads as „not measured"; a zero reads as „the corpus cannot fill this",
    # which is a finding the gate needs rather than an omission.
    available = {name: len(by_stratum.get(name, ()))
                 for name in sorted(set(PERSON_STRATA) | set(by_stratum))}
    # Only the REQUIRED strata are a shortfall; `resolved_non_official` and
    # `unclassified` are reported so a growing bucket is visible, never
    # demanded.
    empty = [name for name in REQUIRED_STRATA if not available.get(name)]
    if empty:
        shortfall["strata_unavailable"] = empty
    return {"pairs": picked, "shortfall": shortfall,
            "strata": {name: covered.get(name, 0) for name in available},
            "available": available}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--app-data", type=Path,
                    default=HERE.parent / "app-data")
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--target", type=int, default=DEFAULT_TARGET)
    ap.add_argument("--seed", type=int, default=20260922)
    ap.add_argument("--gazetteer", type=Path,
                    default=HERE.parent / "data" / "gazetteer.json")
    args = ap.parse_args(argv)

    # ⚠️ THE FRAME IS THE WHOLE PUBLISHED CORPUS, not `latest.json`. That
    # file is a 150-article window: drawing from it caps the sample at what
    # the last few hours happened to contain, which is how a „200 pairs"
    # target turns into a shortfall that looks like a corpus property.
    records = []
    for bundle in sorted((args.app_data / "articles").glob("*.json")):
        try:
            payload = json.loads(bundle.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        records.extend(payload.get("articles") or [])
    if not records:
        print(f"no corpus under {args.app_data / 'articles'}", file=sys.stderr)
        return 1
    officials = load_officials(args.gazetteer, args.app_data)
    rows = candidate_rows(records or [], officials=officials)
    draw_target = int(args.target * OVERSAMPLE)
    result = draw(rows, target=draw_target, seed=args.seed)
    out = {
        "version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "seed": args.seed,
        "target": args.target,
        "draw_target": draw_target,
        "oversample": OVERSAMPLE,
        "drawn": len(result["pairs"]),
        # ⚠️ Distinct SUBJECTS per stratum, so „53 pairs over 1 person" can
        # never render as „53 officials".
        "strata_subjects": {
            name: len({(r["surface"], r["news_person_id"])
                       for r in result["pairs"] if name in r["strata"]})
            for name in result["available"]},
        "strata": result["strata"],
        "available_by_stratum": result["available"],
        "shortfall": result["shortfall"],
        "how_to_read": [
            "Plan T4.5: CANDIDATE pairs for human annotation. Every label "
            "field is null on purpose — a model may not fill them.",
            "Fill `annotator`, `tone`, `human_assessable`, `subject_role`, "
            "`evidence_supports` and `wrong_canonical_target`, then append "
            "the rows to news/evals/person_adjudications.json.",
            "A pair labelled by two annotators is appended TWICE with "
            "different `annotator` values; that is what agreement is "
            "computed over.",
        ],
        "pairs": result["pairs"],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n",
                        encoding="utf-8")
    print(f"drew {len(result['pairs'])} candidate pairs → {args.out}",
          file=sys.stderr)
    if result["shortfall"]:
        print(f"  ⚠️ shortfall: {result['shortfall']}"
              f" · available by stratum: {result['available']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
