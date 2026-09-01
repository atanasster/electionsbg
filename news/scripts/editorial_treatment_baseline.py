#!/usr/bin/env python3
"""Freeze the editorial-treatment v2 decision fixtures and v1 baseline.

The checked-in outputs are historical, hash-bound evidence for the cutover.
They are not recomputed from a later live tree during ordinary tests.  This
script has two modes:

* ``--write`` snapshots the current analysis tree and writes all Tier 0
  artifacts;
* ``--check`` validates the fixture semantics and every internal hash in the
  checked-in artifacts. ``--verify-live-snapshot`` additionally verifies that
  the old analysis/article files have not moved yet.

The clean-amplification stratum is a review queue, not an inferred relabeling.
Every manual field starts pending and must be filled by a named human pass.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from party_identity import PartyIdentityResolver, article_context  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
EVAL_DIR = ROOT / "news" / "evals" / "editorial_treatment_v2"
FIXTURES_PATH = EVAL_DIR / "fixtures.json"
BASELINE_PATH = EVAL_DIR / "baseline-2026-09-01.json"
STRATUM_PATH = EVAL_DIR / "clean-amplification-stratum-2026-09-01.json"
IDENTITY_PATH = EVAL_DIR / "party-identity-review-2026-09-01.json"
AGREEMENT_PATH = EVAL_DIR / "human-agreement-sample-2026-09-01.json"
PASS_A_PATH = EVAL_DIR / "human-agreement-pass-a.template.json"
PASS_B_PATH = EVAL_DIR / "human-agreement-pass-b.template.json"

QUERY_VERSION = 1
IDENTITY_REVIEW_VERSION = 1
MIN_FIXTURES = 60

LEANING = {
    "strong_conservative", "conservative", "neutral", "progressive",
    "strong_progressive", "not_applicable",
}
RUSSIA = {
    "strong_pro_russia", "pro_russia", "neutral", "anti_russia",
    "strong_anti_russia", "not_applicable",
}
PARTY_TONES = {
    "strong_unfavorable", "unfavorable", "neutral", "favorable",
    "strong_favorable",
}
BASES = {
    "procedural_facts", "clean_amplification", "balanced_sources",
    "critical_context", "authorial_thesis", "not_applicable",
}

# Deliberately broad language used by the v1 reason field. A match only puts a
# neutral party pair into the review stratum; it never changes the label.
CLEAN_AMPLIFICATION_PATTERNS = (
    r"без\s+(?:редакцион(?:ен|на|но)\s+)?коментар",
    r"без\s+(?:критич(?:ен|на|но)\s+)?(?:контекст|оценка)",
    r"без\s+(?:материална\s+)?противотежест",
    r"без\s+(?:да\s+бъде\s+)?(?:оспорен[ао]?|проверен[ао]?)",
    r"неоспорен[ао]?",
    r"предаден[ао]?\s+(?:дословно|фактологично)",
    r"дословно\s+(?:предаден[ао]?|цитиран[ао]?)",
    r"само\s+(?:позицията|изявлението|съобщението)",
    r"едностранно\s+(?:предаден[ао]?|представен[ао]?)",
)
STRATUM_RE = re.compile("|".join(CLEAN_AMPLIFICATION_PATTERNS), re.IGNORECASE)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def canonical_bytes(value) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def canonical_sha(value) -> str:
    return sha256_bytes(canonical_bytes(value))


def normalized(text: str) -> str:
    value = unicodedata.normalize("NFKC", text or "").casefold()
    return " ".join(value.split())


def expected_quote_count(label: str, mixed: bool) -> int:
    if mixed:
        return 2
    if label in {"neutral", "not_applicable"}:
        return 0
    return 1


def validate_fixtures(doc: dict) -> list[str]:
    errors: list[str] = []
    cases = doc.get("cases") or []
    if len(cases) < MIN_FIXTURES:
        errors.append(f"fixture count {len(cases)} is below {MIN_FIXTURES}")
    ids = [row.get("id") for row in cases]
    if len(set(ids)) != len(ids):
        errors.append("fixture ids are not unique")
    axis_counts = Counter(row.get("axis") for row in cases)
    vocab = {"party_tone": PARTY_TONES, "russia_stance": RUSSIA,
             "leaning": LEANING}
    for axis in ("party_tone", "russia_stance", "leaning"):
        if axis_counts[axis] < 15:
            errors.append(f"{axis} has only {axis_counts[axis]} cases")
        present = {row.get("expected", {}).get("label") for row in cases
                   if row.get("axis") == axis}
        if present != vocab[axis]:
            errors.append(f"{axis} fixture labels differ: {sorted(present)}")
        if not any(row.get("expected", {}).get("mixed_evidence")
                   and row.get("expected", {}).get("label") not in
                   {"neutral", "not_applicable"}
                   for row in cases if row.get("axis") == axis):
            errors.append(f"{axis} lacks a mixed directional-net case")

    required_types = {
        "press_release", "wire_copy", "interview", "procedural_report",
        "multi_source_report", "opinion", "profile", "investigation",
    }
    present_types = {row.get("article_type") for row in cases}
    missing_types = sorted(required_types - present_types)
    if missing_types:
        errors.append(f"fixture article shapes missing: {missing_types}")
    if not any(row.get("axis") == "russia_stance"
               and row.get("article_type") in {"culture", "human_interest"}
               and row.get("expected", {}).get("label") == "not_applicable"
               for row in cases):
        errors.append("fixtures lack the Russia-state versus people/culture boundary")

    for row in cases:
        ident = row.get("id") or "<missing>"
        axis = row.get("axis")
        expected = row.get("expected") or {}
        label = expected.get("label")
        basis = expected.get("treatment_basis")
        mixed = expected.get("mixed_evidence")
        quotes = expected.get("evidence_quotes")
        excerpt = row.get("excerpt_bg") or ""
        if axis not in vocab:
            errors.append(f"{ident}: unknown axis {axis!r}")
            continue
        if label not in vocab[axis]:
            errors.append(f"{ident}: invalid {axis} label {label!r}")
        if basis not in BASES:
            errors.append(f"{ident}: invalid treatment basis {basis!r}")
        if not isinstance(mixed, bool):
            errors.append(f"{ident}: mixed_evidence is not boolean")
            continue
        if not isinstance(quotes, list):
            errors.append(f"{ident}: evidence_quotes is not a list")
            continue
        wanted = expected_quote_count(label, mixed)
        if len(quotes) != wanted:
            errors.append(f"{ident}: expected {wanted} quote(s), got {len(quotes)}")
        if len({normalized(q) for q in quotes}) != len(quotes):
            errors.append(f"{ident}: quotes are not unique")
        for quote in quotes:
            if not normalized(quote) or normalized(quote) not in normalized(excerpt):
                errors.append(f"{ident}: ungrounded quote {quote!r}")
        if axis == "party_tone" and basis == "not_applicable":
            errors.append(f"{ident}: party items cannot be not_applicable")
        if label == "not_applicable" and (
                basis != "not_applicable" or mixed or quotes):
            errors.append(f"{ident}: malformed not_applicable shape")
        if basis == "not_applicable" and label != "not_applicable":
            errors.append(f"{ident}: not_applicable basis with {label}")
        if not str(expected.get("reason") or "").strip():
            errors.append(f"{ident}: reason is empty")
    return errors


def analysis_paths(root: Path = ROOT) -> list[Path]:
    return sorted((root / "news" / "data" / "analysis" / "articles").glob("*/*.json"))


def corpus_count(root: Path = ROOT) -> int:
    data = root / "news" / "data"
    excluded = {"analysis", "evals", "gold"}
    return sum(
        1 for path in data.glob("*/*.json")
        if path.parent.name not in excluded and not path.parent.name.startswith("_")
    )


def path_from_record(root: Path, record: dict) -> Path | None:
    raw = record.get("article_path")
    if not raw:
        return None
    path = Path(raw)
    return path if path.is_absolute() else root / path


def snapshot_manifest(root: Path = ROOT) -> tuple[list[dict], list[dict]]:
    manifest, loaded = [], []
    for path in analysis_paths(root):
        raw = path.read_bytes()
        record = json.loads(raw)
        article = path_from_record(root, record)
        item = {
            "analysis_path": str(path.relative_to(root)),
            "analysis_sha256": sha256_bytes(raw),
            "article_path": str(article.relative_to(root)) if article and article.exists() else record.get("article_path"),
            "article_sha256": sha256_file(article) if article and article.exists() else None,
            "url": record.get("url"),
            "quality": (record.get("quality") or {}).get("verdict"),
        }
        manifest.append(item)
        loaded.append({"manifest": item, "record": record, "article": article})
    return manifest, loaded


def source_hashes(root: Path = ROOT) -> dict:
    paths = (
        "news/prompts/analyze_system.source.md",
        "news/prompts/analyze_system.md",
        "news/prompts/analyze_schema.json",
        "news/prompts/analyze_schema.gbnf",
        "news/eval_contract/contract.json",
    )
    return {name: sha256_file(root / name) if (root / name).exists() else None
            for name in paths}


def distribution(loaded: list[dict]) -> dict:
    quality = Counter()
    leaning_all, leaning_ok = Counter(), Counter()
    russia_all, russia_ok = Counter(), Counter()
    tones = Counter()
    grounded = Counter()
    party_pairs = unresolved = unstamped = accepted = 0
    for item in loaded:
        record = item["record"]
        verdict = (record.get("quality") or {}).get("verdict")
        quality[verdict or "absent"] += 1
        leaning = (record.get("leaning") or {}).get("label") or "absent"
        russia = (record.get("russia_stance") or {}).get("label") or "absent"
        leaning_all[leaning] += 1
        russia_all[russia] += 1
        if verdict == "ok":
            leaning_ok[leaning] += 1
            russia_ok[russia] += 1
        if record.get("party_tones_version") is None:
            unstamped += 1
        if record.get("human_review") is not None:
            accepted += 1
        for tone in record.get("party_tones") or []:
            party_pairs += 1
            tones[tone.get("tone") or "absent"] += 1
            if not tone.get("party_id"):
                unresolved += 1
            value = tone.get("evidence_grounded")
            grounded["absent" if value is None else str(bool(value)).lower()] += 1
    return {
        "analysis_records": len(loaded),
        "quality": dict(sorted(quality.items())),
        "quality_ok_records": quality["ok"],
        "leaning_all_records": dict(sorted(leaning_all.items())),
        "leaning_quality_ok": dict(sorted(leaning_ok.items())),
        "russia_all_records": dict(sorted(russia_all.items())),
        "russia_quality_ok": dict(sorted(russia_ok.items())),
        "party_pairs": party_pairs,
        "party_tones": dict(sorted(tones.items())),
        "party_evidence_grounded": dict(sorted(grounded.items())),
        "party_pairs_without_id": unresolved,
        "records_without_party_tones_version": unstamped,
        "records_with_human_review": accepted,
    }


def pair_hash(item: dict, index: int, tone: dict) -> str:
    return canonical_sha({
        "analysis_sha256": item["manifest"]["analysis_sha256"],
        "party_index": index,
        "party_item": tone,
    })


def clean_amplification_stratum(loaded: list[dict]) -> list[dict]:
    out = []
    for item in loaded:
        record = item["record"]
        for index, tone in enumerate(record.get("party_tones") or []):
            evidence = str(tone.get("evidence") or "")
            if tone.get("tone") != "neutral" or not STRATUM_RE.search(evidence):
                continue
            out.append({
                "pair_sha256": pair_hash(item, index, tone),
                "analysis_path": item["manifest"]["analysis_path"],
                "analysis_sha256": item["manifest"]["analysis_sha256"],
                "article_path": item["manifest"]["article_path"],
                "article_sha256": item["manifest"]["article_sha256"],
                "url": record.get("url"),
                "party": tone.get("party"),
                "party_id": tone.get("party_id"),
                "v1_tone": tone.get("tone"),
                "v1_evidence": evidence,
            })
    return out


def _article_doc(item: dict) -> dict:
    path = item.get("article")
    if not path or not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def identity_review(loaded: list[dict], resolver: PartyIdentityResolver) -> list[dict]:
    out = []
    for item in loaded:
        record, article = item["record"], _article_doc(item)
        parties = (record.get("entities") or {}).get("parties") or []
        context = article_context(article, parties)
        published = article.get("published") or article.get("published_at")
        for index, tone in enumerate(record.get("party_tones") or []):
            if tone.get("party_id"):
                continue
            surface = tone.get("party") or ""
            resolved = resolver.resolve(surface, context_text=context,
                                        published=published)
            pending = resolver.pending_context_candidates(
                surface, context_text=context, published=published)
            result = resolved.as_dict()
            if result["party_id"]:
                review_status = "pending_human_link_audit"
            elif result["party_identity_status"] == "foreign":
                review_status = "country_scoped_foreign"
            else:
                review_status = "unresolved_with_reason"
            out.append({
                "pair_sha256": pair_hash(item, index, tone),
                "analysis_path": item["manifest"]["analysis_path"],
                "article_path": item["manifest"]["article_path"],
                "article_sha256": item["manifest"]["article_sha256"],
                "url": record.get("url"),
                "published": published,
                "party": surface,
                "current_party_id": None,
                "proposed_identity": result,
                "pending_context_candidates": pending,
                "review_status": review_status,
            })
    return out


def agreement_sample(loaded: list[dict], limit: int = 50) -> list[dict]:
    """Deterministic, blinded real-article sample for the Tier 0 human gate.

    Selection is stratified using the old party label so rare cases are not
    lost, but that label is intentionally absent from the emitted rows. One
    party pair per article keeps the same 50 source reads usable for the two
    scalar axes and the party axis.
    """

    buckets: dict[str, list[dict]] = {key: [] for key in
                                     ("mixed", "favorable", "unfavorable", "neutral")}
    for item in loaded:
        record = item["record"]
        if ((record.get("quality") or {}).get("verdict") != "ok"
                or not item["manifest"].get("article_sha256")):
            continue
        for index, tone in enumerate(record.get("party_tones") or []):
            old = tone.get("tone")
            if old not in buckets:
                continue
            assignment = pair_hash(item, index, tone)
            buckets[old].append({
                "assignment_id": assignment[:20],
                "article_path": item["manifest"]["article_path"],
                "article_sha256": item["manifest"]["article_sha256"],
                "party_surface": tone.get("party"),
                "party_pair_sha256": assignment,
            })
    for rows in buckets.values():
        rows.sort(key=lambda row: canonical_sha({
            "salt": "editorial-treatment-v2-human-gate",
            "assignment": row["party_pair_sha256"],
        }))

    targets = {"mixed": 5, "favorable": 12, "unfavorable": 15, "neutral": 18}
    selected, used_articles = [], set()
    for label in ("mixed", "favorable", "unfavorable", "neutral"):
        for row in buckets[label]:
            if row["article_path"] in used_articles:
                continue
            selected.append(row)
            used_articles.add(row["article_path"])
            if sum(1 for value in selected
                   if value["party_pair_sha256"] in {
                       candidate["party_pair_sha256"] for candidate in buckets[label]
                   }) >= targets[label]:
                break
    if len(selected) < limit:
        remainder = [row for rows in buckets.values() for row in rows
                     if row["article_path"] not in used_articles]
        remainder.sort(key=lambda row: canonical_sha(row["party_pair_sha256"]))
        for row in remainder:
            selected.append(row)
            used_articles.add(row["article_path"])
            if len(selected) == limit:
                break
    if len(selected) < limit:
        raise ValueError(f"only {len(selected)} unique party articles for human gate")
    selected = selected[:limit]
    selected.sort(key=lambda row: row["assignment_id"])
    return selected


def agreement_pass(assignments: list[dict], pass_id: str) -> dict:
    """One blinded view; it never contains the other pass or v1 analysis path."""

    rows = [
        {
            "assignment_id": row["assignment_id"],
            "article_path": row["article_path"],
            "article_sha256": row["article_sha256"],
            "party_surface": row["party_surface"],
            "decision": None,
        }
        for row in assignments
    ]
    rows.sort(key=lambda row: canonical_sha({
        "salt": f"editorial-treatment-v2-pass-{pass_id.casefold()}",
        "assignment": row["assignment_id"],
    }))
    order = [row["assignment_id"] for row in rows]
    return {
        "pass_view_version": 1,
        "pass_id": pass_id,
        "assignments_sha256": canonical_sha(assignments),
        "order_sha256": canonical_sha(order),
        "annotator_kind": "human",
        "adjudicator": None,
        "completed_at": None,
        "rows_sha256": canonical_sha(rows),
        "rows": rows,
    }


def write_json(path: Path, value: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8")


def write_snapshot(root: Path = ROOT) -> dict:
    fixtures = json.loads(FIXTURES_PATH.read_text(encoding="utf-8"))
    errors = validate_fixtures(fixtures)
    if errors:
        raise ValueError("fixture errors:\n- " + "\n- ".join(errors))
    manifest, loaded = snapshot_manifest(root)
    manifest_hash = canonical_sha(manifest)
    generated = now_iso()
    baseline = {
        "baseline": "editorial-treatment-v1-before-v2",
        "snapshot_date": "2026-09-01",
        "generated_at": generated,
        "fixture_set_sha256": sha256_file(FIXTURES_PATH),
        "source_hashes": source_hashes(root),
        "corpus_articles": corpus_count(root),
        "counts": distribution(loaded),
        "analysis_manifest_sha256": manifest_hash,
        "analysis_manifest": manifest,
        "adjudication_gate": {
            "status": "blocked_pending_humans",
            "required_real_judgments": 50,
            "required_weighted_kappa_each_axis": 0.8,
            "allowed_fallback": "one_human_two_blinded_passes_at_least_one_week_apart",
            "selected_method": None,
            "adjudicators": [],
        },
    }
    stratum_rows = clean_amplification_stratum(loaded)
    stratum = {
        "stratum": "v1-neutral-evidence-suggesting-clean-amplification",
        "snapshot_date": "2026-09-01",
        "generated_at": generated,
        "query_version": QUERY_VERSION,
        "query_patterns": list(CLEAN_AMPLIFICATION_PATTERNS),
        "analysis_manifest_sha256": manifest_hash,
        "purpose": "Human review stratum only; no target transition or automatic relabeling.",
        "count": len(stratum_rows),
        "assignments_sha256": canonical_sha(stratum_rows),
        "pairs": stratum_rows,
    }
    resolver = PartyIdentityResolver.load()
    identity_rows = identity_review(loaded, resolver)
    identity = {
        "review": "party-identity-v2-unresolved-pairs",
        "snapshot_date": "2026-09-01",
        "generated_at": generated,
        "review_version": IDENTITY_REVIEW_VERSION,
        "party_identity_version": 2,
        "analysis_manifest_sha256": manifest_hash,
        "policy_sha256": sha256_file(ROOT / "news" / "config" / "party_identity_v2.json"),
        "count": len(identity_rows),
        "assignments_sha256": canonical_sha(identity_rows),
        "rows": identity_rows,
    }
    agreement_rows = agreement_sample(loaded)
    agreement = {
        "sample": "editorial-treatment-v2-human-agreement",
        "snapshot_date": "2026-09-01",
        "generated_at": generated,
        "analysis_manifest_sha256": manifest_hash,
        "selection": {
            "method": "deterministic stratification by hidden v1 party label; one party pair per article",
            "real_judgments": len(agreement_rows),
            "blinded_order": True,
            "old_labels_exposed": False,
        },
        "gate": {
            "required_weighted_kappa_each_axis": 0.8,
            "required_axes": ["leaning", "russia_stance", "party_tone"],
            "status": "blocked_pending_humans",
            "method": None,
            "adjudicators": []
        },
        "assignments_sha256": canonical_sha(agreement_rows),
        "assignments": agreement_rows
    }
    pass_a = agreement_pass(agreement_rows, "A")
    pass_b = agreement_pass(agreement_rows, "B")
    write_json(BASELINE_PATH, baseline)
    write_json(STRATUM_PATH, stratum)
    write_json(IDENTITY_PATH, identity)
    write_json(AGREEMENT_PATH, agreement)
    write_json(PASS_A_PATH, pass_a)
    write_json(PASS_B_PATH, pass_b)
    return {"baseline": BASELINE_PATH, "stratum": STRATUM_PATH,
            "identity": IDENTITY_PATH, "agreement": AGREEMENT_PATH,
            "pass_a": PASS_A_PATH, "pass_b": PASS_B_PATH,
            "counts": baseline["counts"],
            "stratum_count": len(stratum_rows), "identity_count": len(identity_rows)}


def verify_artifacts(root: Path = ROOT, verify_live: bool = False) -> list[str]:
    errors = validate_fixtures(json.loads(FIXTURES_PATH.read_text(encoding="utf-8")))
    for path in (BASELINE_PATH, STRATUM_PATH, IDENTITY_PATH, AGREEMENT_PATH,
                 PASS_A_PATH, PASS_B_PATH):
        if not path.exists():
            errors.append(f"missing artifact: {path.relative_to(root)}")
    if errors:
        return errors
    baseline = json.loads(BASELINE_PATH.read_text(encoding="utf-8"))
    stratum = json.loads(STRATUM_PATH.read_text(encoding="utf-8"))
    identity = json.loads(IDENTITY_PATH.read_text(encoding="utf-8"))
    agreement = json.loads(AGREEMENT_PATH.read_text(encoding="utf-8"))
    pass_a = json.loads(PASS_A_PATH.read_text(encoding="utf-8"))
    pass_b = json.loads(PASS_B_PATH.read_text(encoding="utf-8"))
    manifest = baseline.get("analysis_manifest") or []
    manifest_hash = canonical_sha(manifest)
    if manifest_hash != baseline.get("analysis_manifest_sha256"):
        errors.append("baseline analysis manifest hash mismatch")
    if stratum.get("analysis_manifest_sha256") != manifest_hash:
        errors.append("stratum points at a different analysis manifest")
    if identity.get("analysis_manifest_sha256") != manifest_hash:
        errors.append("identity review points at a different analysis manifest")
    if agreement.get("analysis_manifest_sha256") != manifest_hash:
        errors.append("human agreement sample points at a different analysis manifest")
    if canonical_sha(stratum.get("pairs") or []) != stratum.get("assignments_sha256"):
        errors.append("stratum assignment hash mismatch")
    if stratum.get("count") != len(stratum.get("pairs") or []):
        errors.append("stratum count mismatch")
    if canonical_sha(identity.get("rows") or []) != identity.get("assignments_sha256"):
        errors.append("identity review assignment hash mismatch")
    if identity.get("count") != len(identity.get("rows") or []):
        errors.append("identity review count mismatch")
    assignments = agreement.get("assignments") or []
    assignment_hash = canonical_sha(assignments)
    if assignment_hash != agreement.get("assignments_sha256"):
        errors.append("human agreement assignment hash mismatch")
    if len(assignments) < 50:
        errors.append("human agreement sample contains fewer than 50 real judgments")
    expected_ids = {row.get("assignment_id") for row in assignments}
    for pass_name, pass_doc in (("A", pass_a), ("B", pass_b)):
        rows = pass_doc.get("rows") or []
        ids = [row.get("assignment_id") for row in rows]
        if pass_doc.get("pass_id") != pass_name:
            errors.append(f"pass {pass_name} id mismatch")
        if pass_doc.get("assignments_sha256") != assignment_hash:
            errors.append(f"pass {pass_name} assignment hash mismatch")
        if set(ids) != expected_ids or len(ids) != len(expected_ids):
            errors.append(f"pass {pass_name} assignment membership mismatch")
        if canonical_sha(ids) != pass_doc.get("order_sha256"):
            errors.append(f"pass {pass_name} order hash mismatch")
        if canonical_sha(rows) != pass_doc.get("rows_sha256"):
            errors.append(f"pass {pass_name} row hash mismatch")
        if any("analysis_path" in row or "analysis_sha256" in row for row in rows):
            errors.append(f"pass {pass_name} exposes hidden v1 analysis")
    if pass_a.get("order_sha256") == pass_b.get("order_sha256"):
        errors.append("human agreement pass order was not reshuffled")
    if baseline.get("fixture_set_sha256") != sha256_file(FIXTURES_PATH):
        errors.append("fixture set changed after baseline snapshot")
    if verify_live:
        for row in manifest:
            for key, hash_key in (("analysis_path", "analysis_sha256"),
                                  ("article_path", "article_sha256")):
                if not row.get(hash_key):
                    continue
                path = root / row[key]
                if not path.exists():
                    errors.append(f"snapshot file missing: {row[key]}")
                elif sha256_file(path) != row[hash_key]:
                    errors.append(f"snapshot file changed: {row[key]}")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--write", action="store_true")
    mode.add_argument("--check", action="store_true")
    parser.add_argument("--verify-live-snapshot", action="store_true")
    args = parser.parse_args()
    if args.write:
        result = write_snapshot()
        print(json.dumps({
            "ok": True,
            "artifacts": {key: str(value.relative_to(ROOT))
                          for key, value in result.items() if isinstance(value, Path)},
            "counts": result["counts"],
            "stratum_count": result["stratum_count"],
            "identity_count": result["identity_count"],
        }, ensure_ascii=False, indent=2))
        return 0
    errors = verify_artifacts(verify_live=args.verify_live_snapshot)
    print(json.dumps({"ok": not errors, "errors": errors},
                     ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
