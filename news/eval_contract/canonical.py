"""Canonical JSON and evaluation-boundary SHA-256 helpers."""

from __future__ import annotations

import hashlib
import json
import math
from decimal import Decimal
from typing import Any


MAX_SAFE_INTEGER = 9_007_199_254_740_991
UNICODE_SCALAR_ERROR = "string contains an unpaired surrogate"


def require_unicode_scalars(value: str) -> None:
    """Reject UTF-16 surrogate code points, which are not Unicode scalars."""
    if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
        raise ValueError(UNICODE_SCALAR_ERROR)


def canonical_number(value: int | float) -> str:
    """Serialize a finite number with the ECMAScript JSON spelling.

    Integer-valued numbers outside the shared IEEE-754 safe range are
    rejected: accepting them would let Python preserve a value that the
    TypeScript runtime has already rounded.
    """
    if isinstance(value, bool):
        raise TypeError("booleans are not numbers in canonical JSON")
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise ValueError("integer exceeds the cross-language safe range")
        return str(value)
    if not math.isfinite(value):
        raise ValueError("non-finite number is not canonical JSON")
    if value == 0:
        return "0"
    if value.is_integer() and abs(value) > MAX_SAFE_INTEGER:
        raise ValueError("integer exceeds the cross-language safe range")
    if value.is_integer():
        return str(int(value))
    decimal = Decimal(repr(value))
    absolute = abs(value)
    if 1e-6 <= absolute < 1e21:
        return format(decimal, "f").rstrip("0").rstrip(".")
    coefficient, exponent = format(decimal.normalize(), "e").split("e")
    coefficient = coefficient.rstrip("0").rstrip(".")
    exponent_value = int(exponent)
    sign = "+" if exponent_value >= 0 else ""
    return f"{coefficient}e{sign}{exponent_value}"


def canonical_json(value: Any) -> str:
    """Serialize JSON with code-point-sorted keys and no insignificant space."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        require_unicode_scalars(value)
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (int, float)):
        return canonical_number(value)
    if isinstance(value, list):
        return "[" + ",".join(canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise TypeError("canonical JSON object keys must be strings")
        for key in value:
            require_unicode_scalars(key)
        fields = (
            f"{json.dumps(key, ensure_ascii=False)}:{canonical_json(value[key])}"
            for key in sorted(value)
        )
        return "{" + ",".join(fields) + "}"
    raise TypeError(f"not a JSON value: {type(value).__name__}")


def _digest(payload: bytes) -> str:
    return f"sha256:{hashlib.sha256(payload).hexdigest()}"


def canonical_sha256(value: Any) -> str:
    return _digest(canonical_json(value).encode("utf-8"))


def content_sha256(content: str) -> str:
    """Hash the exact stored article body, without Unicode/newline rewriting."""
    if not isinstance(content, str):
        raise TypeError("article content must be a string")
    require_unicode_scalars(content)
    return _digest(content.encode("utf-8"))


def analysis_sha256(analysis: dict) -> str:
    """Hash one immutable original analysis object using canonical JSON."""
    if not isinstance(analysis, dict):
        raise TypeError("analysis must be an object")
    return canonical_sha256(analysis)
