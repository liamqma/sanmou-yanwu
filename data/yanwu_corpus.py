"""Verified, deterministic normalization for a pinned Yanwu release corpus."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import urllib.request
from collections import Counter
from datetime import datetime
from pathlib import Path
from typing import Any, BinaryIO, Mapping


MANIFEST_SCHEMA_VERSION = 1
NORMALIZED_FORMAT = "sanmou-normalized-yanwu-corpus"
NORMALIZED_VERSION = 1
NORMALIZER_VERSION = 1
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
USER_AGENT = "sanmou-yanwu-corpus-sync/1"

HERO_ALIASES = {
    "SP周瑜": "周瑜2",
    "SP孙坚": "孙坚2",
    "SP诸葛亮": "诸葛亮2",
    "皇甫嵩": "皇甫嵩2",
    "祝融夫人": "祝融",
}
SHADOW_SKILL_PREFIX = "影・"

_SHA256_RE = re.compile(r"[0-9a-f]{64}")


class InvalidYanwuCorpus(ValueError):
    """Raised when a manifest, source release, or normalized cache is invalid."""


def _reject_constant(value: str) -> None:
    raise InvalidYanwuCorpus(f"non-finite JSON constant {value!r} is invalid")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise InvalidYanwuCorpus(f"duplicate JSON key {key!r}")
        value[key] = item
    return value


def _load_json(path: Path, description: str) -> Any:
    try:
        with path.open("r", encoding="utf-8") as handle:
            return json.load(
                handle,
                object_pairs_hook=_unique_object,
                parse_constant=_reject_constant,
            )
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise InvalidYanwuCorpus(f"cannot read {description} {path}: {exc}") from exc


def _exact_keys(value: Any, expected: set[str], description: str) -> Mapping[str, Any]:
    if not isinstance(value, dict) or set(value) != expected:
        actual = sorted(value) if isinstance(value, dict) else type(value).__name__
        raise InvalidYanwuCorpus(
            f"{description} has unexpected keys/type {actual!r}"
        )
    return value


def load_manifest(path: Path) -> dict[str, Any]:
    value = _exact_keys(
        _load_json(path, "Yanwu release manifest"),
        {"asset", "license", "release_tag", "repository", "schema_version", "source"},
        "Yanwu release manifest",
    )
    if value["schema_version"] != MANIFEST_SCHEMA_VERSION:
        raise InvalidYanwuCorpus("unsupported Yanwu manifest schema version")

    for field in ("repository", "release_tag"):
        if not isinstance(value[field], str) or not value[field]:
            raise InvalidYanwuCorpus(f"Yanwu manifest {field} must be non-empty")

    asset = _exact_keys(
        value["asset"],
        {"bytes", "filename", "report_count", "sha256", "url"},
        "Yanwu manifest asset",
    )
    if (
        not isinstance(asset["bytes"], int)
        or isinstance(asset["bytes"], bool)
        or asset["bytes"] <= 0
        or not isinstance(asset["report_count"], int)
        or isinstance(asset["report_count"], bool)
        or asset["report_count"] <= 0
    ):
        raise InvalidYanwuCorpus("Yanwu manifest asset counts must be positive integers")
    if not isinstance(asset["sha256"], str) or not _SHA256_RE.fullmatch(asset["sha256"]):
        raise InvalidYanwuCorpus("Yanwu manifest asset SHA-256 is invalid")
    for field in ("filename", "url"):
        if not isinstance(asset[field], str) or not asset[field]:
            raise InvalidYanwuCorpus(f"Yanwu manifest asset {field} must be non-empty")
    if not asset["url"].startswith("https://github.com/"):
        raise InvalidYanwuCorpus("Yanwu manifest asset URL must use HTTPS on github.com")

    source = _exact_keys(
        value["source"],
        {"format", "season", "version"},
        "Yanwu manifest source",
    )
    if (
        not isinstance(source["format"], str)
        or not source["format"]
        or not isinstance(source["version"], int)
        or isinstance(source["version"], bool)
        or source["version"] <= 0
        or not isinstance(source["season"], str)
        or not re.fullmatch(r"S[1-9][0-9]*", source["season"])
    ):
        raise InvalidYanwuCorpus("Yanwu manifest source contract is invalid")

    license_value = _exact_keys(
        value["license"],
        {"name", "url"},
        "Yanwu manifest license",
    )
    if not all(
        isinstance(license_value[field], str) and license_value[field]
        for field in ("name", "url")
    ):
        raise InvalidYanwuCorpus("Yanwu manifest license fields must be non-empty")
    return dict(value)


def normalized_cache_path(manifest: Mapping[str, Any], cache_dir: Path) -> Path:
    return cache_dir / f"{manifest['asset']['sha256']}.normalized.json"


def raw_cache_path(manifest: Mapping[str, Any], cache_dir: Path) -> Path:
    return cache_dir / f"{manifest['asset']['sha256']}.ywrlib.json"


def default_normalized_cache_path(manifest_path: Path, cache_dir: Path) -> Path:
    return normalized_cache_path(load_manifest(manifest_path), cache_dir)


def _parse_timestamp(value: Any, description: str) -> str:
    if not isinstance(value, str) or not value:
        raise InvalidYanwuCorpus(f"{description} must be a non-empty timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise InvalidYanwuCorpus(f"{description} is not ISO-8601") from exc
    if parsed.tzinfo is None:
        raise InvalidYanwuCorpus(f"{description} must include a timezone")
    return value


def _normalized_skill(name: Any, description: str) -> str:
    if not isinstance(name, str) or not name:
        raise InvalidYanwuCorpus(f"{description} must be a non-empty string")
    return name.removeprefix(SHADOW_SKILL_PREFIX)


def normalize_release(
    release: Any,
    manifest: Mapping[str, Any],
    *,
    catalog_version: str,
    default_skill: Mapping[str, str],
    catalog_skills: set[str] | frozenset[str],
) -> dict[str, Any]:
    """Normalize one verified source release into the model's compact battle shape."""
    root = _exact_keys(
        release,
        {"exportedAt", "format", "reports", "version"},
        "Yanwu release",
    )
    source = manifest["source"]
    if root["format"] != source["format"] or root["version"] != source["version"]:
        raise InvalidYanwuCorpus("Yanwu release format/version does not match manifest")
    exported_at = _parse_timestamp(root["exportedAt"], "Yanwu exportedAt")
    reports = root["reports"]
    if not isinstance(reports, list) or len(reports) != manifest["asset"]["report_count"]:
        raise InvalidYanwuCorpus("Yanwu release report count does not match manifest")

    expected_season = source["season"]
    season_number = int(expected_season[1:])
    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    accepted: list[dict[str, Any]] = []
    exclusions: Counter[str] = Counter()

    for index, raw in enumerate(reports):
        if not isinstance(raw, dict):
            raise InvalidYanwuCorpus(f"Yanwu report {index} must be an object")
        source_id = raw.get("id")
        import_order = raw.get("importOrder")
        if not isinstance(source_id, str) or not source_id or source_id in seen_ids:
            raise InvalidYanwuCorpus(f"Yanwu report {index} has an invalid/duplicate id")
        if (
            isinstance(import_order, bool)
            or not isinstance(import_order, int)
            or import_order < 0
            or import_order in seen_orders
        ):
            raise InvalidYanwuCorpus(
                f"Yanwu report {source_id!r} has an invalid/duplicate importOrder"
            )
        seen_ids.add(source_id)
        seen_orders.add(import_order)
        captured_at = _parse_timestamp(
            raw.get("createdAt"),
            f"Yanwu report {source_id!r} createdAt",
        )
        if raw.get("season") != expected_season:
            raise InvalidYanwuCorpus(
                f"Yanwu report {source_id!r} season does not match manifest"
            )
        parsed = raw.get("parsed")
        if not isinstance(parsed, dict):
            raise InvalidYanwuCorpus(f"Yanwu report {source_id!r} parsed must be an object")
        winner_side = parsed.get("winnerSide")
        if winner_side not in {"left", "right"}:
            exclusions["unknown_result"] += 1
            continue

        team_values: list[list[Any]] = []
        incomplete_team = False
        for side in ("leftTeam", "rightTeam"):
            team = parsed.get(side)
            heroes = team.get("heroes") if isinstance(team, dict) else None
            if not isinstance(heroes, list) or len(heroes) != 3:
                incomplete_team = True
                break
            team_values.append(heroes)
        if incomplete_team:
            exclusions["incomplete_team"] += 1
            continue

        normalized_teams: list[list[dict[str, Any]]] = []
        incomplete_tactics = False
        for team_index, heroes in enumerate(team_values, start=1):
            normalized_heroes: list[dict[str, Any]] = []
            seen_heroes: set[str] = set()
            for hero_index, hero in enumerate(heroes, start=1):
                if not isinstance(hero, dict):
                    incomplete_tactics = True
                    break
                raw_name = hero.get("name")
                if not isinstance(raw_name, str) or not raw_name:
                    incomplete_tactics = True
                    break
                name = HERO_ALIASES.get(raw_name, raw_name)
                if name not in default_skill:
                    raise InvalidYanwuCorpus(
                        f"Yanwu report {source_id!r} has unknown hero {raw_name!r}"
                    )
                if name in seen_heroes:
                    incomplete_tactics = True
                    break
                seen_heroes.add(name)
                tactics = hero.get("tactics")
                if not isinstance(tactics, list) or len(tactics) != 2:
                    incomplete_tactics = True
                    break
                normalized_tactics = [
                    _normalized_skill(
                        tactic,
                        f"Yanwu report {source_id!r} team {team_index} "
                        f"hero {hero_index} tactic",
                    )
                    for tactic in tactics
                ]
                unknown_skills = [
                    skill for skill in normalized_tactics if skill not in catalog_skills
                ]
                if unknown_skills:
                    raise InvalidYanwuCorpus(
                        f"Yanwu report {source_id!r} has unknown skill "
                        f"{unknown_skills[0]!r}"
                    )
                normalized_heroes.append(
                    {
                        "name": name,
                        "skills": [default_skill[name], *normalized_tactics],
                    }
                )
            if incomplete_tactics:
                break
            normalized_teams.append(normalized_heroes)
        if incomplete_tactics:
            exclusions["incomplete_tactics"] += 1
            continue

        accepted.append(
            {
                "1": normalized_teams[0],
                "2": normalized_teams[1],
                "captured_at": captured_at,
                "import_order": import_order,
                "season": season_number,
                "source_id": source_id,
                "winner": "1" if winner_side == "left" else "2",
            }
        )

    accepted.sort(key=lambda row: (row["import_order"], row["source_id"]))
    exclusion_count = sum(exclusions.values())
    if len(accepted) + exclusion_count != len(reports):
        raise InvalidYanwuCorpus("Yanwu normalization counts are inconsistent")
    return {
        "catalog_version": catalog_version,
        "format": NORMALIZED_FORMAT,
        "normalizer_version": NORMALIZER_VERSION,
        "reports": accepted,
        "source": {
            "asset_filename": manifest["asset"]["filename"],
            "asset_sha256": manifest["asset"]["sha256"],
            "exported_at": exported_at,
            "format": source["format"],
            "release_tag": manifest["release_tag"],
            "report_count": len(reports),
            "repository": manifest["repository"],
            "version": source["version"],
        },
        "summary": {
            "accepted_reports": len(accepted),
            "excluded_reports": exclusion_count,
            "exclusions": dict(sorted(exclusions.items())),
            "source_reports": len(reports),
        },
        "version": NORMALIZED_VERSION,
    }


def load_normalized_corpus(
    path: Path,
    manifest: Mapping[str, Any],
    *,
    catalog_version: str,
) -> dict[str, Any]:
    """Load and validate a normalized cache before model consumption."""
    value = _exact_keys(
        _load_json(path, "normalized Yanwu corpus"),
        {
            "catalog_version",
            "format",
            "normalizer_version",
            "reports",
            "source",
            "summary",
            "version",
        },
        "normalized Yanwu corpus",
    )
    if (
        value["format"] != NORMALIZED_FORMAT
        or value["version"] != NORMALIZED_VERSION
        or value["normalizer_version"] != NORMALIZER_VERSION
        or value["catalog_version"] != catalog_version
    ):
        raise InvalidYanwuCorpus("normalized Yanwu cache stamp is stale or invalid")

    source = _exact_keys(
        value["source"],
        {
            "asset_filename",
            "asset_sha256",
            "exported_at",
            "format",
            "release_tag",
            "report_count",
            "repository",
            "version",
        },
        "normalized Yanwu source",
    )
    expected_source = manifest["source"]
    if (
        source["asset_filename"] != manifest["asset"]["filename"]
        or source["asset_sha256"] != manifest["asset"]["sha256"]
        or source["release_tag"] != manifest["release_tag"]
        or source["repository"] != manifest["repository"]
        or source["report_count"] != manifest["asset"]["report_count"]
        or source["format"] != expected_source["format"]
        or source["version"] != expected_source["version"]
    ):
        raise InvalidYanwuCorpus("normalized Yanwu source does not match manifest")
    _parse_timestamp(source["exported_at"], "normalized Yanwu exported_at")

    reports = value["reports"]
    summary = _exact_keys(
        value["summary"],
        {"accepted_reports", "excluded_reports", "exclusions", "source_reports"},
        "normalized Yanwu summary",
    )
    if not isinstance(reports, list):
        raise InvalidYanwuCorpus("normalized Yanwu reports must be an array")
    if (
        summary["source_reports"] != manifest["asset"]["report_count"]
        or summary["accepted_reports"] != len(reports)
        or not isinstance(summary["excluded_reports"], int)
        or isinstance(summary["excluded_reports"], bool)
        or summary["excluded_reports"] < 0
        or summary["accepted_reports"] + summary["excluded_reports"]
        != summary["source_reports"]
        or not isinstance(summary["exclusions"], dict)
        or any(
            not isinstance(reason, str)
            or not reason
            or isinstance(count, bool)
            or not isinstance(count, int)
            or count <= 0
            for reason, count in summary["exclusions"].items()
        )
        or sum(summary["exclusions"].values()) != summary["excluded_reports"]
    ):
        raise InvalidYanwuCorpus("normalized Yanwu summary is inconsistent")

    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    previous_key: tuple[int, str] | None = None
    for index, report in enumerate(reports):
        expected_keys = {
            "1",
            "2",
            "captured_at",
            "import_order",
            "season",
            "source_id",
            "winner",
        }
        row = _exact_keys(report, expected_keys, f"normalized Yanwu report {index}")
        source_id = row["source_id"]
        import_order = row["import_order"]
        if (
            not isinstance(source_id, str)
            or not source_id
            or source_id in seen_ids
            or isinstance(import_order, bool)
            or not isinstance(import_order, int)
            or import_order < 0
            or import_order in seen_orders
        ):
            raise InvalidYanwuCorpus("normalized Yanwu report identity/order is invalid")
        key = (import_order, source_id)
        if previous_key is not None and key <= previous_key:
            raise InvalidYanwuCorpus("normalized Yanwu reports are not deterministically sorted")
        previous_key = key
        seen_ids.add(source_id)
        seen_orders.add(import_order)
        _parse_timestamp(row["captured_at"], f"normalized Yanwu report {source_id!r}")
    return dict(value)


def _sha256_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("rb") as handle:
            while chunk := handle.read(DOWNLOAD_CHUNK_BYTES):
                size += len(chunk)
                digest.update(chunk)
    except OSError as exc:
        raise InvalidYanwuCorpus(f"cannot read cached Yanwu asset {path}: {exc}") from exc
    return digest.hexdigest(), size


def _verified_raw_asset(path: Path, manifest: Mapping[str, Any]) -> bool:
    try:
        digest, size = _sha256_file(path)
    except InvalidYanwuCorpus:
        return False
    return digest == manifest["asset"]["sha256"] and size == manifest["asset"]["bytes"]


def _download_to(handle: BinaryIO, manifest: Mapping[str, Any]) -> tuple[str, int]:
    request = urllib.request.Request(
        manifest["asset"]["url"],
        headers={"User-Agent": USER_AGENT},
    )
    digest = hashlib.sha256()
    size = 0
    expected_size = manifest["asset"]["bytes"]
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                size += len(chunk)
                if size > expected_size:
                    raise InvalidYanwuCorpus("Yanwu download exceeds manifest byte size")
                digest.update(chunk)
                handle.write(chunk)
    except (OSError, TimeoutError) as exc:
        raise InvalidYanwuCorpus(f"cannot download pinned Yanwu release: {exc}") from exc
    return digest.hexdigest(), size


def _atomic_write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.",
        suffix=".tmp",
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(
                value,
                handle,
                ensure_ascii=False,
                indent=2,
                sort_keys=True,
                allow_nan=False,
            )
            handle.write("\n")
        os.replace(temporary_name, path)
    except BaseException:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def sync_corpus(
    manifest_path: Path,
    cache_dir: Path,
    *,
    catalog_version: str,
    default_skill: Mapping[str, str],
    catalog_skills: set[str] | frozenset[str],
) -> tuple[Path, dict[str, Any], bool]:
    """Ensure the pinned normalized corpus exists; return path, summary, cache hit."""
    manifest = load_manifest(manifest_path)
    normalized_path = normalized_cache_path(manifest, cache_dir)
    raw_path = raw_cache_path(manifest, cache_dir)

    if normalized_path.exists():
        try:
            cached = load_normalized_corpus(
                normalized_path,
                manifest,
                catalog_version=catalog_version,
            )
        except InvalidYanwuCorpus:
            pass
        else:
            return normalized_path, cached["summary"], True

    cache_dir.mkdir(parents=True, exist_ok=True)
    if not _verified_raw_asset(raw_path, manifest):
        fd, temporary_name = tempfile.mkstemp(
            dir=cache_dir,
            prefix=".yanwu-download.",
            suffix=".tmp",
        )
        try:
            with os.fdopen(fd, "wb") as handle:
                digest, size = _download_to(handle, manifest)
            if digest != manifest["asset"]["sha256"] or size != manifest["asset"]["bytes"]:
                raise InvalidYanwuCorpus("downloaded Yanwu asset failed manifest verification")
            os.replace(temporary_name, raw_path)
        except BaseException:
            try:
                os.unlink(temporary_name)
            except OSError:
                pass
            raise

    release = _load_json(raw_path, "pinned Yanwu release")
    normalized = normalize_release(
        release,
        manifest,
        catalog_version=catalog_version,
        default_skill=default_skill,
        catalog_skills=catalog_skills,
    )
    _atomic_write_json(normalized_path, normalized)
    validated = load_normalized_corpus(
        normalized_path,
        manifest,
        catalog_version=catalog_version,
    )
    return normalized_path, validated["summary"], False
