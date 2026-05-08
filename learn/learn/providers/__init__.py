"""Provider registry. First match wins; `GenericProvider` is the catch-all."""

from __future__ import annotations

from .base import Provider, ProviderHints
from .bilibili import BilibiliProvider
from .douyin import DouyinProvider
from .generic import GenericProvider

# Registration order matters — more-specific providers must come before generic.
PROVIDERS: list[Provider] = [
    BilibiliProvider(),
    DouyinProvider(),
    GenericProvider(),  # always last
]


def get_provider_for(url: str) -> Provider:
    for p in PROVIDERS:
        if p.matches(url):
            return p
    return PROVIDERS[-1]


__all__ = [
    "Provider",
    "ProviderHints",
    "BilibiliProvider",
    "DouyinProvider",
    "GenericProvider",
    "PROVIDERS",
    "get_provider_for",
]
