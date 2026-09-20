#!/usr/bin/env python3
"""Build the canonical target registry used by article link proposals."""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from pathlib import Path
from urllib.parse import quote

from news.eval_contract.canonical import canonical_sha256

ROOT = Path(__file__).resolve().parents[2]
MAIN_SITE = "https://electionsbg.com"
SECTOR_RE = re.compile(
    r'id: "([^"]+)",\s+titleKey: "([^"]+)",.*?to: "([^"]+)"',
    re.DOTALL,
)


# ⚠️ A CASE-FOLDED KEY IS NOT A TOTAL ORDER, AND A `set` IS NOT AN ORDER
# AT ALL. Aliases are collected into a set and sorted case-insensitively,
# so two spellings that differ only in case — „Община Сандански" and
# „община Сандански" — compare EQUAL under the key and keep whatever order
# the set happened to iterate in. That order depends on string hashing,
# which is randomised per process, so the registry came out in a different
# order on every build of identical data.
#
# Measured 2026-09-20 against the live release: 26 of 8,494 targets flipped
# between two builds minutes apart, with identical ids, canonicals and
# alias SETS. Two things follow, and the second is the serious one:
#
#   1. `feedback-targets.json` is 1.5 MB and differed on every release, so
#      a base+overlay release carried the whole of it — 1.5 MB of the
#      1.84 MB first overlay ever built, for no change at all.
#   2. `targets_sha256` moved with it. That hash is what an article
#      feedback submission is validated against (`target_registry_sha256`),
#      so a submission prepared against one build could be refused after
#      any later build, with nothing about the registry actually changed.
#
# The fix is a tie-break, not a different sort: fold first so the intended
# grouping survives, then compare the raw string so equal folds have one
# answer.
def alias_sort_key(value: str) -> tuple[str, str]:
    return (value.casefold(), value)


def _entity_target(entry: dict) -> dict | None:
    kind = entry.get("kind")
    ident = str(entry.get("id") or "").strip()
    canonical = str(entry.get("canonical") or "").strip()
    if not ident or not canonical:
        return None
    if kind == "person":
        target_kind, plain_id, href = "person", ident, f"{MAIN_SITE}/person/{ident}"
    elif kind == "party":
        target_kind, plain_id = "party", ident
        href = f"{MAIN_SITE}/party/{quote(canonical, safe='')}"
    elif kind == "institution":
        target_kind, plain_id, href = (
            "institution", ident, f"{MAIN_SITE}/awarder/{ident}")
    elif kind == "company":
        target_kind, plain_id, href = (
            "company", ident, f"{MAIN_SITE}/company/{ident}")
    elif kind == "place" and (
            ident.startswith("settlement:") or
            str(entry.get("path") or "").startswith("/settlement/")):
        plain_id = ident.removeprefix("settlement:")
        if not re.fullmatch(r"[0-9]{5}", plain_id):
            return None
        target_kind, href = "settlement", f"{MAIN_SITE}/settlement/{plain_id}"
    else:
        return None
    aliases = sorted({
        canonical,
        *(
            str(form.get("surface") or "").strip()
            for form in entry.get("forms") or []
            if form.get("resolvable") is True
        ),
    }, key=alias_sort_key)
    return {
        "kind": target_kind,
        "id": plain_id,
        "canonical": canonical,
        "href": href,
        "aliases": [alias for alias in aliases if alias][:20],
    }


def _curated_targets(root: Path) -> list[dict]:
    path = root / "news" / "data" / "entity_link_overrides.json"
    if not path.is_file():
        return []
    document = json.loads(path.read_text(encoding="utf-8"))
    out = []
    for entry in document.get("links") or []:
        target = _entity_target({
            **entry,
            "forms": [{"surface": entry.get("surface"), "resolvable": True}],
        })
        if target is None:
            continue
        route = str(entry.get("path") or "").strip()
        if route.startswith("/") and not route.startswith("//"):
            target["href"] = MAIN_SITE + route
        out.append(target)
    return out


def _observed_targets(records: Iterable[dict]) -> list[dict]:
    """Lift every exact identity already emitted by a public projection."""
    out = []
    for record in records:
        analysis = record.get("analysis") if isinstance(record, dict) else None
        links = ((analysis or {}).get("entity_links")
                 if isinstance(analysis, dict) else None)
        if not isinstance(links, dict):
            links = record.get("entity_links") if isinstance(record, dict) else None
        for surface, link in (links or {}).items():
            if not isinstance(link, dict):
                raise ValueError("public entity link is not an object")
            raw_kind = link.get("kind")
            kind = "settlement" if raw_kind == "place" else raw_kind
            ident = str(link.get("id") or "").strip()
            canonical = str(link.get("canonical") or "").strip()
            href = str(link.get("href") or "").strip()
            if kind not in TARGET_KINDS or not ident or not canonical or not href:
                raise ValueError(f"invalid public entity link: {surface!r}")
            out.append({
                "kind": kind,
                "id": ident,
                "canonical": canonical,
                "href": href,
                "aliases": sorted({canonical, str(surface).strip()},
                                  key=alias_sort_key),
            })
    return out


def _sector_targets(root: Path) -> list[dict]:
    source = (root / "src" / "screens" / "governance" /
              "sectorRegistry.ts").read_text(encoding="utf-8")
    labels = json.loads((root / "src" / "locales" / "bg" /
                         "translation.json").read_text(encoding="utf-8"))
    out = []
    for ident, title_key, route in SECTOR_RE.findall(source):
        label = labels.get(title_key)
        if not isinstance(label, str) or not route.startswith("/"):
            raise ValueError(f"invalid canonical sector {ident}")
        out.append({
            "kind": "sector",
            "id": ident,
            "canonical": label,
            "href": MAIN_SITE + route,
            "aliases": [label],
        })
    if len(out) < 15 or len({item["id"] for item in out}) != len(out):
        raise ValueError("sector registry extraction is incomplete or duplicated")
    return out


TARGET_KINDS = {
    "person", "party", "settlement", "institution", "company", "sector"}
TARGET_KEYS = {"kind", "id", "canonical", "href", "aliases"}
REGISTRY_KEYS = {
    "version", "generated_at", "targets_sha256", "target_count", "targets"}


def _sort_key(item: dict) -> tuple[bytes, bytes, bytes]:
    return (
        item["kind"].encode("utf-8"),
        item["canonical"].casefold().encode("utf-8"),
        item["id"].encode("utf-8"),
    )


def validate_registry(value: object) -> dict:
    """Strictly validate and independently hash a target registry."""
    if not isinstance(value, dict) or set(value) != REGISTRY_KEYS:
        raise ValueError("feedback target registry fields are invalid")
    if value.get("version") != 1 or not isinstance(value.get("generated_at"), str):
        raise ValueError("feedback target registry version is invalid")
    targets = value.get("targets")
    if (not isinstance(targets, list) or len(targets) > 20_000 or
            value.get("target_count") != len(targets)):
        raise ValueError("feedback target registry count is invalid")
    seen: set[tuple[str, str]] = set()
    normalized = []
    for index, target in enumerate(targets):
        if not isinstance(target, dict) or set(target) != TARGET_KEYS:
            raise ValueError(f"feedback target {index} fields are invalid")
        kind, ident = target.get("kind"), target.get("id")
        canonical, href, aliases = (
            target.get("canonical"), target.get("href"), target.get("aliases"))
        if (kind not in TARGET_KINDS or not isinstance(ident, str) or
                not 1 <= len(ident) <= 160 or not isinstance(canonical, str) or
                not 1 <= len(canonical) <= 300 or not isinstance(href, str) or
                not re.fullmatch(r"https://electionsbg\.com/\S{1,500}", href) or
                not isinstance(aliases, list) or not 1 <= len(aliases) <= 20 or
                any(not isinstance(alias, str) or not 1 <= len(alias) <= 300
                    for alias in aliases) or len(set(aliases)) != len(aliases)):
            raise ValueError(f"feedback target {index} is invalid")
        key = (kind, ident)
        if key in seen:
            raise ValueError("feedback target registry has duplicate identities")
        seen.add(key)
        normalized.append({
            "kind": kind, "id": ident, "canonical": canonical,
            "href": href, "aliases": aliases,
        })
    if normalized != sorted(normalized, key=_sort_key):
        raise ValueError("feedback target registry is not strictly sorted")
    expected_hash = canonical_sha256(normalized)
    if value.get("targets_sha256") != expected_hash:
        raise ValueError("feedback target registry hash does not match targets")
    return value


def build(root: Path = ROOT, generated_at: str | None = None,
          public_records: Iterable[dict] = ()) -> dict:
    gazetteer = json.loads((root / "news" / "data" /
                            "gazetteer.json").read_text(encoding="utf-8"))
    raw_targets = [
        target for entry in gazetteer.get("entries") or []
        if (target := _entity_target(entry)) is not None
    ]
    raw_targets.extend(_curated_targets(root))
    raw_targets.extend(_observed_targets(public_records))
    raw_targets.extend(_sector_targets(root))
    merged: dict[tuple[str, str], dict] = {}
    for target in raw_targets:
        key = (target["kind"], target["id"])
        prior = merged.get(key)
        if prior and (prior["canonical"], prior["href"]) != (
                target["canonical"], target["href"]):
            raise ValueError(f"canonical target identity conflict: {key}")
        if prior:
            prior["aliases"] = sorted(
                {*prior["aliases"], *target["aliases"]},
                key=alias_sort_key,
            )[:20]
        else:
            merged[key] = target
    targets = list(merged.values())
    targets.sort(key=_sort_key)
    registry = {
        "version": 1,
        "generated_at": generated_at or gazetteer.get("generated_at"),
        "targets_sha256": canonical_sha256(targets),
        "target_count": len(targets),
        "targets": targets,
    }
    return validate_registry(registry)
