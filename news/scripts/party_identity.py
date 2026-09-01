#!/usr/bin/env python3
"""Context-aware party identity resolution for editorial-treatment v2.

The model supplies a surface string because it must preserve what the article
wrote.  This module decides whether that surface can safely carry an exact
Bulgarian party id, is a known foreign party, or must remain unresolved.  It
never turns a null id into a guess: ambiguous Bulgarian aliases require an
explicit, reviewed, date-bounded context rule.

Tier 0 deliberately keeps this resolver separate from analysis persistence.
`analyze_articles.py` starts stamping the returned metadata only with the v2
stored contract in Tier 1.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

ROOT = Path(__file__).resolve().parents[2]
CANONICAL_PARTIES = ROOT / "data" / "canonical_parties.json"
POLICY_PATH = ROOT / "news" / "config" / "party_identity_v2.json"
PARTY_IDENTITY_VERSION = 2


def fold(text: str) -> str:
    """Whitespace-, case- and punctuation-stable comparison key."""

    decomposed = unicodedata.normalize("NFKD", (text or "").casefold())
    plain = "".join(c for c in decomposed if not unicodedata.combining(c))
    return " ".join(re.findall(r"[^\W_]+", plain, flags=re.UNICODE))


def parse_day(value: str | None) -> date | None:
    if not value:
        return None
    raw = value.strip().replace("_", "-")[:10]
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def _in_window(day: date | None, start: str | None, end: str | None) -> bool:
    if day is None:
        return start is None and end is None
    lower, upper = parse_day(start), parse_day(end)
    return (lower is None or day >= lower) and (upper is None or day <= upper)


@dataclass(frozen=True)
class PartyIdentity:
    party_id: str | None
    party_country_code: str | None
    party_identity_status: str
    party_aggregate_id: str | None
    party_identity_version: int
    resolution_basis: str
    resolution_reason: str

    def as_dict(self) -> dict:
        return {
            "party_id": self.party_id,
            "party_country_code": self.party_country_code,
            "party_identity_status": self.party_identity_status,
            "party_aggregate_id": self.party_aggregate_id,
            "party_identity_version": self.party_identity_version,
            "resolution_basis": self.resolution_basis,
            "resolution_reason": self.resolution_reason,
        }


class PartyIdentityResolver:
    def __init__(self, canonical: dict, policy: dict):
        if policy.get("party_identity_version") != PARTY_IDENTITY_VERSION:
            raise ValueError("party identity policy version mismatch")
        self.policy = policy
        self.canonical_by_id = {
            str(row["id"]): row for row in canonical.get("parties") or []
            if row.get("id")
        }
        self.exact_claims: dict[str, set[str]] = {}
        for ident, row in self.canonical_by_id.items():
            surfaces = {row.get("displayName") or ""}
            for history in row.get("history") or []:
                surfaces.add(history.get("nickName") or "")
                surfaces.add(history.get("name") or "")
            for surface in surfaces:
                if fold(surface):
                    self.exact_claims.setdefault(fold(surface), set()).add(ident)

        self.ambiguous: dict[str, dict] = {}
        for row in policy.get("ambiguous_bg_surfaces") or []:
            key = fold(row.get("surface") or "")
            if not key:
                raise ValueError("ambiguous party policy contains an empty surface")
            if key in self.ambiguous:
                raise ValueError(f"duplicate ambiguous party surface: {row['surface']}")
            if not str(row.get("reason") or "").strip():
                raise ValueError(f"ambiguous party surface lacks reason: {row['surface']}")
            self.ambiguous[key] = row

        self.foreign: dict[str, list[dict]] = {}
        foreign_claims: dict[str, set[str]] = {}
        for row in policy.get("foreign_parties") or []:
            country = str(row.get("country_code") or "")
            if not re.fullmatch(r"[A-Z]{2}", country):
                raise ValueError(f"invalid foreign party country code: {country!r}")
            if not str(row.get("reason") or "").strip():
                raise ValueError(f"foreign party row lacks reason: {country}")
            for surface in row.get("surfaces") or []:
                key = fold(surface)
                if not key:
                    raise ValueError(f"foreign party row {country} has empty surface")
                foreign_claims.setdefault(key, set()).add(country)
                self.foreign.setdefault(key, []).append(row)
        collisions = {key: countries for key, countries in foreign_claims.items()
                      if len(countries) > 1}
        if collisions:
            raise ValueError(f"foreign party surfaces claim multiple countries: {collisions}")
        for key, rows in self.foreign.items():
            if key in self.exact_claims and not all(
                    row.get("requires_text_any") for row in rows):
                raise ValueError(
                    "foreign/Bulgarian surface collision requires country context: "
                    f"{key}"
                )
        self.context_rules = policy.get("reviewed_context_rules") or []
        self._validate_context_rules()

    def _validate_context_rules(self) -> None:
        rule_ids = set()
        for rule in self.context_rules:
            ident = str(rule.get("id") or "")
            if not ident or ident in rule_ids:
                raise ValueError(f"missing or duplicate context rule id: {ident!r}")
            rule_ids.add(ident)
            party_id = str(rule.get("party_id") or "")
            aggregate_id = rule.get("party_aggregate_id")
            if party_id not in self.canonical_by_id:
                raise ValueError(f"unknown context-rule party_id: {party_id}")
            if aggregate_id is not None and str(aggregate_id) not in self.canonical_by_id:
                raise ValueError(f"unknown context-rule aggregate id: {aggregate_id}")
            if not (rule.get("surfaces") and rule.get("requires_text_any")):
                raise ValueError(f"context rule lacks surface or evidence: {ident}")
            if not str(rule.get("reason") or "").strip():
                raise ValueError(f"context rule lacks reason: {ident}")
            for field in ("valid_from", "valid_to"):
                if rule.get(field) and parse_day(rule[field]) is None:
                    raise ValueError(f"context rule {ident} has invalid {field}")

    @classmethod
    def load(cls, canonical_path: Path = CANONICAL_PARTIES,
             policy_path: Path = POLICY_PATH) -> "PartyIdentityResolver":
        return cls(
            json.loads(canonical_path.read_text(encoding="utf-8")),
            json.loads(policy_path.read_text(encoding="utf-8")),
        )

    @staticmethod
    def _rule_matches(rule: dict, *, surface_key: str, context_key: str,
                      day: date | None) -> bool:
        if surface_key not in {fold(v) for v in rule.get("surfaces") or []}:
            return False
        if not _in_window(day, rule.get("valid_from"), rule.get("valid_to")):
            return False
        required = [fold(v) for v in rule.get("requires_text_any") or []]
        if required and not any(value in context_key for value in required):
            return False
        forbidden = [fold(v) for v in rule.get("forbids_text_any") or []]
        return not (forbidden and any(value in context_key for value in forbidden))

    def _context_rule(self, surface: str, context_text: str,
                      published: str | None) -> PartyIdentity | None:
        surface_key = fold(surface)
        context_key = fold(context_text)
        day = parse_day(published)
        for rule in self.context_rules:
            if not rule.get("reviewed"):
                continue
            if not self._rule_matches(rule, surface_key=surface_key,
                                      context_key=context_key, day=day):
                continue
            ident = str(rule.get("party_id") or "")
            if ident not in self.canonical_by_id:
                raise ValueError(f"unknown reviewed party_id: {ident}")
            return PartyIdentity(
                party_id=ident,
                party_country_code="BG",
                party_identity_status="exact",
                party_aggregate_id=rule.get("party_aggregate_id"),
                party_identity_version=PARTY_IDENTITY_VERSION,
                resolution_basis="reviewed_context",
                resolution_reason=rule["reason"],
            )
        return None

    def _foreign_identity(self, key: str, context_text: str) -> PartyIdentity | None:
        claims = self.foreign.get(key) or []
        if not claims:
            return None
        context_key = fold(context_text)
        matches = []
        for row in claims:
            required = [fold(value) for value in row.get("requires_text_any") or []]
            if required and not any(value in context_key for value in required):
                continue
            matches.append(row)
        if len(matches) == 1:
            foreign = matches[0]
            return PartyIdentity(
                party_id=None,
                party_country_code=foreign["country_code"],
                party_identity_status="foreign",
                party_aggregate_id=None,
                party_identity_version=PARTY_IDENTITY_VERSION,
                resolution_basis="reviewed_foreign_surface",
                resolution_reason=foreign["reason"],
            )
        if len(matches) > 1 or key in self.exact_claims:
            return PartyIdentity(
                party_id=None,
                party_country_code=None,
                party_identity_status="unresolved",
                party_aggregate_id=None,
                party_identity_version=PARTY_IDENTITY_VERSION,
                resolution_basis="cross_country_ambiguous",
                resolution_reason=(
                    "The surface is claimed in more than one country and the "
                    "document does not provide reviewed country context."
                ),
            )
        return PartyIdentity(
            party_id=None,
            party_country_code=None,
            party_identity_status="unresolved",
            party_aggregate_id=None,
            party_identity_version=PARTY_IDENTITY_VERSION,
            resolution_basis="foreign_context_missing",
            resolution_reason=(
                "The foreign surface requires country evidence that is absent "
                "from this document."
            ),
        )

    def resolve(self, surface: str, *, context_text: str = "",
                published: str | None = None) -> PartyIdentity:
        """Resolve one model-classified party surface without guessing."""

        key = fold(surface)
        if not key:
            return PartyIdentity(None, None, "unresolved", None,
                                 PARTY_IDENTITY_VERSION, "empty_surface",
                                 "The party surface is empty.")

        contextual = self._context_rule(surface, context_text, published)
        if contextual:
            return contextual

        foreign = self._foreign_identity(key, context_text)
        if foreign:
            return foreign

        refusal = self.ambiguous.get(key)
        if refusal:
            return PartyIdentity(
                party_id=None,
                party_country_code="BG",
                party_identity_status="unresolved",
                party_aggregate_id=None,
                party_identity_version=PARTY_IDENTITY_VERSION,
                resolution_basis="ambiguous_refused",
                resolution_reason=refusal["reason"],
            )

        holders = self.exact_claims.get(key, set())
        if len(holders) == 1:
            ident = next(iter(holders))
            return PartyIdentity(
                party_id=ident,
                party_country_code="BG",
                party_identity_status="exact",
                party_aggregate_id=ident,
                party_identity_version=PARTY_IDENTITY_VERSION,
                resolution_basis="canonical_exact",
                resolution_reason=(
                    "The model-classified party surface uniquely matches the "
                    "canonical Bulgarian party registry."
                ),
            )
        if len(holders) > 1:
            reason = "The canonical registry assigns this surface to multiple parties."
            basis = "canonical_collision"
            country = "BG"
        else:
            reason = "No reviewed Bulgarian or foreign identity rule matches this surface."
            basis = "not_in_reviewed_registry"
            country = None
        return PartyIdentity(None, country, "unresolved", None,
                             PARTY_IDENTITY_VERSION, basis, reason)

    def pending_context_candidates(self, surface: str, *, context_text: str,
                                   published: str | None) -> list[dict]:
        """Human-review candidates; never consumed by ``resolve``."""

        key, context_key, day = fold(surface), fold(context_text), parse_day(published)
        out = []
        for rule in self.context_rules:
            if rule.get("reviewed"):
                continue
            if not self._rule_matches(rule, surface_key=key,
                                      context_key=context_key, day=day):
                continue
            out.append({
                "rule_id": rule["id"],
                "party_id": rule["party_id"],
                "party_aggregate_id": rule.get("party_aggregate_id"),
                "reason": rule["reason"],
                "reviewed": False,
            })
        return out


def article_context(article: dict, entity_parties: Iterable[str] = ()) -> str:
    """The document evidence available to contextual rules."""

    fields = [article.get("title"), article.get("description"), article.get("content")]
    fields.extend(entity_parties)
    return "\n".join(str(value or "") for value in fields)
