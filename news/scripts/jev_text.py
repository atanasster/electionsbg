#!/usr/bin/env python3
"""The Cyrillic word-boundary rule and the sidecar key, in ONE place.

Both existed twice before this file: the boundary class was copied verbatim
out of `analyze_articles.entity_in_text` into the sentiment pass, and
`article_key` was byte-identical in `person_tones` and there. A rule copied is
a rule that drifts, and both of these are load-bearing —

⚠️ `\\b` IS ASCII-ONLY AND NEVER MATCHES AFTER A CYRILLIC LETTER. A boundary
written with it reports zero mentions for every Bulgarian surface, silently,
which in the sentiment pass means a subject derived `incidental` and given no
tone at all. That is why the class is spelled out, and why it is spelled out
once.
"""
from __future__ import annotations

import hashlib
import re

# ⚠️ THE FULL CYRILLIC BLOCK, not `А-Яа-яЁё`. That range omits `Ѝ`/`ѝ`
# (U+040D/U+045D) — a Bulgarian letter in everyday use, the possessive „ѝ" —
# so „ГЕРБѝ" would count as a mention of „ГЕРБ". `Ѐ-ӿ` (U+0400–U+04FF plus the
# supplement) covers the letters this corpus can contain.
WORD_CHAR = r"0-9A-Za-zЀ-ӿ"

# A Bulgarian definite article or inflectional tail is the SAME surface:
# „Възраждането" is „Възраждане". Capped at three letters so a short surface
# cannot swallow an unrelated longer word, and applied only to surfaces long
# enough that a tail is plausible.
#
# ⚠️ CALLERS MUST NOT ALLOW IT FOR A PERSON NAME. Parties take the definite
# article; people do not, and „Иван" plus a three-letter tail matches „Иванов" —
# which is the exact collision the word boundary exists to prevent.
MAX_TAIL = 3
MIN_TAIL_SURFACE = 4


# Characters that separate the words of a name, and that writers swap freely:
# „ПП-ДБ", „ПП–ДБ" (en dash), „ПП — ДБ", „пп дб", and a no-break space.
SEPARATORS = "-\u2010\u2011\u2012\u2013\u2014 \u00a0\t"
_SEPARATOR_RUN = "[" + "".join(re.escape(c) for c in SEPARATORS) + "]+"


def _surface_body(surface: str) -> str:
    """The escaped surface with every separator run matching ANY separator run.

    ⚠️ MEASURED, NOT ANTICIPATED. „ПП-ДБ" counted ZERO mentions in a pik.bg
    article whose text reads „Тия от пп дб…" — case was already folded; the
    hyphen was not. A zero count makes a party the first subject the cap drops
    and `incidental` when it is kept, so a spelling difference decided whether
    a party was assessed at all.
    """
    out, in_sep = [], False
    for ch in surface.lower():
        if ch in SEPARATORS:
            if not in_sep:
                out.append(_SEPARATOR_RUN)
            in_sep = True
        else:
            out.append(re.escape(ch))
            in_sep = False
    return "".join(out)


def mention_pattern(surface: str, *, allow_tail: bool = True) -> str:
    """A whole-word pattern for one surface, case-folded by the caller."""
    tail = ""
    if allow_tail and len(surface) >= MIN_TAIL_SURFACE:
        tail = rf"[а-яa-z]{{0,{MAX_TAIL}}}"
    return (rf"(?<![{WORD_CHAR}])" + _surface_body(surface.strip()) + tail
            + rf"(?![{WORD_CHAR}])")


def mention_matches(surface: str, haystack: str, *,
                    allow_tail: bool = True) -> list:
    """`(start, end)` for every whole-word occurrence of `surface`.

    Spans rather than a count, so a caller can fold overlapping surfaces — a
    longer name and a shorter one inside it must not score the same words
    twice.
    """
    if not surface or not haystack:
        return []
    return [m.span() for m in
            re.finditer(mention_pattern(surface, allow_tail=allow_tail),
                        haystack.lower())]


def contains_mention(surface: str, haystack: str, *,
                     allow_tail: bool = True) -> bool:
    return bool(mention_matches(surface, haystack, allow_tail=allow_tail))


def article_key(url: str) -> str:
    """The sidecar filename for one article's url.

    ⚠️ 16 hex characters of SHA-256, matching `person_tones.article_key`
    exactly — the two sidecar trees are read by the same tooling and a
    different truncation would make one unfindable from the other.
    """
    return hashlib.sha256((url or "").encode("utf-8")).hexdigest()[:16]
