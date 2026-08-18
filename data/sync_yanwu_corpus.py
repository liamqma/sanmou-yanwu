#!/usr/bin/env python3
"""Download, verify, and normalize the repository's pinned Yanwu corpus."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from build_recommendation_data import InvalidBattleError, _load_catalog_context
    from yanwu_corpus import InvalidYanwuCorpus, sync_corpus
except ModuleNotFoundError:  # Support ``python -m data.sync_yanwu_corpus``.
    from .build_recommendation_data import InvalidBattleError, _load_catalog_context
    from .yanwu_corpus import InvalidYanwuCorpus, sync_corpus


def main(argv: list[str] | None = None) -> int:
    root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=root / "data/external/yanwu-release.json",
    )
    parser.add_argument(
        "--cache-dir",
        type=Path,
        default=root / ".cache/yanwu",
    )
    parser.add_argument(
        "--database",
        type=Path,
        default=root / "web/public/game-data/database.json",
    )
    args = parser.parse_args(argv)

    try:
        catalog = _load_catalog_context(str(args.database))
        path, summary, cache_hit = sync_corpus(
            args.manifest,
            args.cache_dir,
            catalog_version=catalog.metadata["catalog_version"],
            default_skill=catalog.metadata["default_skill"],
            catalog_skills=catalog.names.skills,
        )
    except (InvalidBattleError, InvalidYanwuCorpus, OSError) as exc:
        print(f"Yanwu corpus sync failed: {exc}", file=sys.stderr)
        return 1

    state = "cache hit" if cache_hit else "cache populated"
    print(
        f"Yanwu corpus {state}: {path} "
        f"({summary['source_rows']} cumulative source rows -> "
        f"{summary['unique_reports']} first-appearance reports; "
        f"{summary['accepted_reports']} accepted, "
        f"{summary['excluded_reports']} excluded)."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
