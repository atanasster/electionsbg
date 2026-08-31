"""Shared, closed Commons rights vocabulary for sourcing and application."""

import re
from urllib.parse import unquote, urlparse, urlunparse

LICENCE_URLS = {
    "CC0": "https://creativecommons.org/publicdomain/zero/1.0/",
    "Public domain": "https://creativecommons.org/publicdomain/mark/1.0/",
    "CC BY 4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC BY-SA 4.0": "https://creativecommons.org/licenses/by-sa/4.0/",
    "CC BY 3.0": "https://creativecommons.org/licenses/by/3.0/",
    "CC BY-SA 3.0": "https://creativecommons.org/licenses/by-sa/3.0/",
    "CC BY 2.0": "https://creativecommons.org/licenses/by/2.0/",
    "CC BY-SA 2.0": "https://creativecommons.org/licenses/by-sa/2.0/",
}


def canonical_licence_url(name: str) -> str | None:
    return LICENCE_URLS.get(name)


def is_https_host(value: str, host: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme == "https" and parsed.hostname == host


COMMONS_ORIGINAL_PATH = re.compile(
    r"^/wikipedia/commons/([0-9a-f])/([0-9a-f]{2})/([^/]+)$",
    re.IGNORECASE,
)
COMMONS_THUMB_PATH = re.compile(
    r"^/wikipedia/commons/thumb/[0-9a-f]/[0-9a-f]{2}/"
    r"(?P<original>[^/]+)/(?P<width>\d+)px-(?P<derivative>[^/]+)$",
    re.IGNORECASE,
)
COMMONS_BITMAP_SUFFIXES = frozenset({
    ".jpg", ".jpeg", ".png", ".webp",
})


def commons_thumbnail_url(original: str, *, width: int = 960) -> str:
    """Return the deterministic Commons derivative for one reviewed bitmap.

    The selection keeps the original object URL as provenance. Article cards
    receive this bounded derivative so a JSON-size gate cannot hide several
    multi-megabyte downloads.
    """
    if width < 1:
        raise ValueError("Commons thumbnail width must be positive")
    parsed = urlparse(original)
    if parsed.scheme != "https" or parsed.hostname != "upload.wikimedia.org":
        raise ValueError("Commons original must use Wikimedia upload HTTPS")
    match = COMMONS_ORIGINAL_PATH.fullmatch(parsed.path)
    if not match:
        raise ValueError("Commons image must be an original-object URL")
    filename = match.group(3)
    suffix = "." + unquote(filename).rsplit(".", 1)[-1].lower()
    if suffix not in COMMONS_BITMAP_SUFFIXES:
        raise ValueError(f"unsupported Commons bitmap suffix: {suffix}")
    output_suffix = ".png" if suffix == ".webp" else ""
    thumb_path = (
        f"/wikipedia/commons/thumb/{match.group(1)}/{match.group(2)}/"
        f"{filename}/{width}px-{filename}{output_suffix}"
    )
    return urlunparse(("https", "upload.wikimedia.org", thumb_path, "", "", ""))


def is_commons_thumbnail_url(value: str, *, max_width: int = 960) -> bool:
    parsed = urlparse(value)
    match = COMMONS_THUMB_PATH.fullmatch(parsed.path)
    if not (
        parsed.scheme == "https"
        and parsed.hostname == "upload.wikimedia.org"
        and match
        and 1 <= int(match.group("width")) <= max_width
    ):
        return False
    original = unquote(match.group("original"))
    suffix = "." + original.rsplit(".", 1)[-1].lower()
    if suffix not in COMMONS_BITMAP_SUFFIXES:
        return False
    expected = original + (".png" if suffix == ".webp" else "")
    return unquote(match.group("derivative")) == expected


def commons_thumbnail_file_title(value: str) -> str | None:
    """Return the normalized Commons file title embedded in a derivative."""
    parsed = urlparse(value)
    match = COMMONS_THUMB_PATH.fullmatch(parsed.path)
    if not match:
        return None
    return unquote(match.group("original")).replace("_", " ")


def commons_source_file_title(value: str) -> str | None:
    """Return the normalized file title from a Commons description URL."""
    parsed = urlparse(value)
    if parsed.scheme != "https" or parsed.hostname != "commons.wikimedia.org":
        return None
    marker = "/wiki/File:"
    if not parsed.path.startswith(marker):
        return None
    return unquote(parsed.path[len(marker):]).replace("_", " ")
