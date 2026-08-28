"""Shared, closed Commons rights vocabulary for sourcing and application."""

from urllib.parse import urlparse

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
