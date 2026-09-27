#!/usr/bin/env python3
"""Draw the (article, person) pairs a human labels for the person-sentiment
gate (news-person-sentiment-v1 §8).

⚠️ IT WRITES NO LABELS. It writes `news/evals/person_sample.json`, the queue
the review workspace's „Оценки" serves; every answer comes from a person.

⚠️ THE SAMPLE MUST BE ABLE TO SEE WHAT THE MODEL HIDES. A draw from scored
pairs alone measures tone and can never measure a miss, so four strata:

  model_scored      150  Jev scored the person as a subject — tone accuracy.
                         Stratified by the MODEL's group, oversampling the thin
                         favourable and unfavourable groups so each can reach
                         the gate's 30 human labels.
  model_incidental   40  Jev called the linked person a passing mention; a
                         human who says „main subject" found a hidden tone.
  unscored_subject   30  the gazetteer linked the person in the article and
                         Jev has no subject for them at all.
  text_only          30  a gazetteer FULL name is in the text but in neither
                         the entities nor Jev's subjects — the model's omissions.

The stratum is used to draw and to score; the annotator never sees it, nor
the outlet, the URL or the model's answer. A seeded 50-pair subset is marked
for a second, independent reader (the gate's agreement arm).

Run:  python3 news/scripts/sample_person_pairs.py [--seed 7] [--write]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import person_identity_join as pij  # noqa: E402
import sentiment_rollups as sr  # noqa: E402
from resolve_mentions import fold  # noqa: E402

OUT = HERE.parent / "evals" / "person_sample.json"
APP_DATA = HERE.parent / "app-data"
SENTIMENT_DIR = pij.DATA / "analysis" / "sentiment"
TARGETS = {"model_scored": 150, "model_incidental": 40,
           "unscored_subject": 30, "text_only": 30}
# Within model_scored, by the MODEL's group. The thin favourable group is
# oversampled hardest (§8: the gate needs 30 HUMAN favourable labels, and the
# model's group is not the human's), and a few pairs the model DECLINED to
# place are drawn so its silence is scored against a human answer.
SCORED_TARGETS = {"favorable": 65, "unfavorable": 45, "not_assessed": 10}
SECOND_READER = 50
TOKEN = re.compile(r"[^\W\d_]+", re.UNICODE)


def group_of(index) -> str | None:
    if not isinstance(index, int):
        return None
    return "unfavorable" if index < 2 else "neutral" if index == 2 else "favorable"


def pair_id(url: str, surface: str, pid) -> str:
    return hashlib.sha256(f"{url}\x00{surface}\x00{pid}".encode()).hexdigest()[:16]


def corpus(app_data: Path) -> tuple:
    """(app-data rows by url, (path, body) by url)."""
    paths: dict = {}
    articles, bodies = pij.corpus_articles(app_data, paths=paths)
    return articles, {url: (paths[url], d) for url, d in bodies.items()}


def full_name_forms(src: pij.Sources) -> dict:
    """Last token (folded) → [(surface, id)] for every RESOLVABLE full name."""
    out: dict = defaultdict(list)
    for pid, e in src.people.items():
        for f in e.get("forms") or []:
            if (f.get("resolvable") and f.get("id") == pid
                    and f.get("form_kind") == "full_name" and f.get("surface")):
                tokens = f["surface"].split()
                out[fold(tokens[-1])].append((f["surface"], pid))
    return out


def candidates(app_data: Path, src: pij.Sources) -> dict:
    articles, bodies = corpus(app_data)
    forms = full_name_forms(src)
    out: dict = {s: [] for s in TARGETS}
    for f in sorted(SENTIMENT_DIR.glob("*.json")):
        doc = json.loads(f.read_text(encoding="utf-8"))
        art = articles.get(doc.get("url"))
        path_body = bodies.get(doc.get("url"))
        if not art or not path_body or doc.get("status") != "ok":
            continue
        path, body = path_body
        analysis = art.get("analysis") or {}
        full = {**art, "content": body.get("content"),
                "description": body.get("description")}
        subjects = [dict(s) for s in doc.get("subjects") or []
                    if isinstance(s, dict) and s.get("kind") == "person"]
        pij.stamp(subjects, analysis, full, src)
        base = {"article_url": art["url"], "domain": art.get("domain"),
                "article_id": art.get("id"), "article_path": path,
                "title": art.get("title"), "published": art.get("published")}
        seen_ids = set()
        for s in subjects:
            ident = s.get("identity")
            if not ident:
                continue
            seen_ids.add(ident["id"])
            # The raw record stores the distribution; the bucket index is what
            # publication computes from the EXACT value (`score_public`), so
            # the sample uses the same projection the pages show.
            tone = (sr.score_public(s["tone"]) if isinstance(s.get("tone"), dict)
                    else {})
            row = {**base, "surface": s["name"],
                   "identity": {k: ident.get(k) for k in ("kind", "id", "canonical")},
                   "identity_basis": ident.get("basis"),
                   "identity_version": ident.get("identity_version"),
                   "pipeline_role": s.get("subject_role"),
                   "pipeline_value": tone.get("value"),
                   "pipeline_bucket_index": tone.get("bucket_index")}
            if s.get("subject_role") == "incidental":
                out["model_incidental"].append({**row, "stratum": "model_incidental"})
            elif (s.get("subject_role") in ("primary", "secondary")
                  and not s.get("conflict")):
                placed = isinstance(tone.get("bucket_index"), int)
                out["model_scored"].append({
                    **row, "stratum": "model_scored",
                    "model_group": (group_of(tone["bucket_index"]) if placed
                                    else "not_assessed")})
        links = analysis.get("entity_links") or {}
        linked_ids = set()
        for surface, link in links.items():
            if not isinstance(link, dict) or link.get("kind") != "person":
                continue
            linked_ids.add(link.get("id"))
            if link.get("id") not in seen_ids:
                e = src.people.get(link["id"]) or {}
                out["unscored_subject"].append({
                    **base, "stratum": "unscored_subject", "surface": surface,
                    "identity": {"kind": "person", "id": link["id"],
                                 "canonical": e.get("canonical") or link.get("canonical")},
                    "identity_version": e.get("identity_version"),
                    "pipeline_role": None, "pipeline_value": None,
                    "pipeline_bucket_index": None})
        text = f"{body.get('title') or ''}\n{body.get('content') or ''}"
        tokens = {fold(t) for t in TOKEN.findall(text)}
        people = {fold(n) for n in (analysis.get("entities") or {}).get("people") or []}
        for token in tokens & forms.keys():
            for surface, pid in forms[token]:
                if (pid in seen_ids or pid in linked_ids
                        or fold(surface) in people or not named_in(surface, text)):
                    continue
                e = src.people.get(pid) or {}
                out["text_only"].append({
                    **base, "stratum": "text_only", "surface": surface,
                    "identity": {"kind": "person", "id": pid,
                                 "canonical": e.get("canonical")},
                    "identity_version": e.get("identity_version"),
                    "pipeline_role": None, "pipeline_value": None,
                    "pipeline_bucket_index": None})
    return out


def named_in(surface: str, text: str) -> bool:
    """The name as a whole word run — „Иван Петров" is not in „Иван Петрова".
    Python's `\\w` is Unicode-aware on str, so the boundary holds after Cyrillic."""
    return re.search(rf"(?<!\w){re.escape(surface)}(?!\w)", text) is not None


def spread(rows: list, n: int, rng: random.Random) -> list:
    """Up to `n` rows, round-robin over (identity basis, outlet) so neither an
    outlet nor the easiest link kind dominates (§8)."""
    by_domain: dict = defaultdict(list)
    for r in rows:
        by_domain[(str(r.get("identity_basis") or ""),
                   str(r.get("domain") or ""))].append(r)
    for bucket in by_domain.values():
        rng.shuffle(bucket)
    order = sorted(by_domain)
    rng.shuffle(order)
    out = []
    while len(out) < n and any(by_domain[d] for d in order):
        for d in order:
            if by_domain[d] and len(out) < n:
                out.append(by_domain[d].pop())
    return out


def draw(pool: dict, seed: int) -> dict:
    rng = random.Random(seed)
    picked = []
    scored = pool["model_scored"]
    by_group = defaultdict(list)
    for r in scored:
        by_group[r["model_group"]].append(r)
    taken = 0
    for group, n in SCORED_TARGETS.items():
        chosen = spread(by_group[group], n, rng)
        picked += chosen
        taken += len(chosen)
    picked += spread(by_group["neutral"], TARGETS["model_scored"] - taken, rng)
    for stratum in ("model_incidental", "unscored_subject", "text_only"):
        picked += spread(pool[stratum], TARGETS[stratum], rng)
    seen = set()
    unique = []
    # Shuffled with the same seed: the file must not list the pairs stratum
    # by stratum (the workspace orders by pair_id as well).
    rng.shuffle(picked)
    for r in picked:
        r["pair_id"] = pair_id(r["article_url"], r["surface"],
                               (r.get("identity") or {}).get("id"))
        if r["pair_id"] not in seen:
            seen.add(r["pair_id"])
            unique.append(r)
    second = rng.sample([r["pair_id"] for r in unique],
                        min(SECOND_READER, len(unique)))
    return {"pairs": unique, "second_reader": sorted(second)}


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--write", action="store_true",
                    help=f"write {OUT.relative_to(pij.ROOT)} (default: report only)")
    args = ap.parse_args()
    import jev_sentiment  # noqa: PLC0415
    import news_persons  # noqa: PLC0415
    registry = news_persons.load_registry(pij.ROOT / "news" / "config"
                                          / "news_persons.json")
    src = pij.Sources(registry=registry)
    pool = candidates(APP_DATA, src)
    sample = draw(pool, args.seed)
    report = {"available": {k: len(v) for k, v in pool.items()},
              "drawn": {k: sum(1 for r in sample["pairs"] if r["stratum"] == k)
                        for k in TARGETS},
              "model_scored_by_group": {
                  g: sum(1 for r in sample["pairs"] if r.get("model_group") == g)
                  for g in ("unfavorable", "neutral", "favorable", "not_assessed")},
              "second_reader": len(sample["second_reader"])}
    print(json.dumps(report, ensure_ascii=False, indent=1))
    if args.write:
        OUT.write_text(json.dumps({
            "version": 2,
            "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "seed": args.seed, "rubric_version": jev_sentiment.RUBRIC_VERSION,
            "how_to_read": "Candidates for human labelling in `npm run news:review` "
                           "(queue „Оценки“). No labels here; the stratum and the "
                           "pipeline fields are never shown to the annotator.",
            **report, **sample}, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
