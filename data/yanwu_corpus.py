"""Verified deterministic normalization for pinned multi-season Yanwu assets."""
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
from typing import Any, BinaryIO, Mapping, Sequence


MANIFEST_SCHEMA_VERSION = 3
NORMALIZED_FORMAT = "sanmou-normalized-yanwu-corpus"
NORMALIZED_VERSION = 3
NORMALIZER_VERSION = 4
SEASON_ASSIGNMENT = "first_appearance_in_ascending_cumulative_assets"
DOWNLOAD_CHUNK_BYTES = 1024 * 1024
USER_AGENT = "sanmou-yanwu-corpus-sync/2"

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


def _validated_asset(value: Any, description: str) -> dict[str, Any]:
    asset = _exact_keys(
        value,
        {"bytes", "filename", "report_count", "season", "sha256", "url"},
        description,
    )
    if (
        isinstance(asset["bytes"], bool)
        or not isinstance(asset["bytes"], int)
        or asset["bytes"] <= 0
        or isinstance(asset["report_count"], bool)
        or not isinstance(asset["report_count"], int)
        or asset["report_count"] <= 0
        or isinstance(asset["season"], bool)
        or not isinstance(asset["season"], int)
        or asset["season"] <= 0
    ):
        raise InvalidYanwuCorpus("Yanwu manifest asset values must be positive integers")
    if not isinstance(asset["sha256"], str) or not _SHA256_RE.fullmatch(
        asset["sha256"]
    ):
        raise InvalidYanwuCorpus("Yanwu manifest asset SHA-256 is invalid")
    for field in ("filename", "url"):
        if not isinstance(asset[field], str) or not asset[field]:
            raise InvalidYanwuCorpus(
                f"Yanwu manifest asset {field} must be non-empty"
            )
    if not asset["url"].startswith("https://github.com/"):
        raise InvalidYanwuCorpus(
            "Yanwu manifest asset URL must use HTTPS on github.com"
        )
    return dict(asset)


def load_manifest(path: Path) -> dict[str, Any]:
    value = _exact_keys(
        _load_json(path, "Yanwu release manifest"),
        {"assets", "license", "release_tag", "repository", "schema_version", "source"},
        "Yanwu release manifest",
    )
    if value["schema_version"] != MANIFEST_SCHEMA_VERSION:
        raise InvalidYanwuCorpus("unsupported Yanwu manifest schema version")
    for field in ("repository", "release_tag"):
        if not isinstance(value[field], str) or not value[field]:
            raise InvalidYanwuCorpus(f"Yanwu manifest {field} must be non-empty")

    raw_assets = value["assets"]
    if not isinstance(raw_assets, list) or not raw_assets:
        raise InvalidYanwuCorpus("Yanwu manifest assets must be a non-empty array")
    assets = [
        _validated_asset(asset, f"Yanwu manifest asset {index}")
        for index, asset in enumerate(raw_assets)
    ]
    seasons = [asset["season"] for asset in assets]
    filenames = [asset["filename"] for asset in assets]
    hashes = [asset["sha256"] for asset in assets]
    if seasons != sorted(seasons) or len(set(seasons)) != len(seasons):
        raise InvalidYanwuCorpus(
            "Yanwu manifest assets must have unique ascending seasons"
        )
    if len(set(filenames)) != len(filenames) or len(set(hashes)) != len(hashes):
        raise InvalidYanwuCorpus(
            "Yanwu manifest assets must have unique filenames and SHA-256 values"
        )

    source = _exact_keys(value["source"], {"format", "version"}, "Yanwu manifest source")
    if (
        not isinstance(source["format"], str)
        or not source["format"]
        or isinstance(source["version"], bool)
        or not isinstance(source["version"], int)
        or source["version"] <= 0
    ):
        raise InvalidYanwuCorpus("Yanwu manifest source contract is invalid")

    license_value = _exact_keys(
        value["license"], {"name", "url"}, "Yanwu manifest license"
    )
    if not all(
        isinstance(license_value[field], str) and license_value[field]
        for field in ("name", "url")
    ):
        raise InvalidYanwuCorpus("Yanwu manifest license fields must be non-empty")

    result = dict(value)
    result["assets"] = assets
    return result


def _manifest_content_key(manifest: Mapping[str, Any]) -> str:
    payload = json.dumps(
        [
            {
                "season": asset["season"],
                "sha256": asset["sha256"],
            }
            for asset in manifest["assets"]
        ],
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def normalized_cache_path(manifest: Mapping[str, Any], cache_dir: Path) -> Path:
    return cache_dir / f"{_manifest_content_key(manifest)}.normalized.json"


def raw_cache_path(asset: Mapping[str, Any], cache_dir: Path) -> Path:
    return cache_dir / f"{asset['sha256']}.ywrlib.json"


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


def _comparable_report(raw: Mapping[str, Any]) -> str:
    value = dict(raw)
    value.pop("season", None)
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )


def _normalize_unique_report(
    raw: Mapping[str, Any],
    *,
    source_id: str,
    import_order: int,
    season: int,
    default_skill: Mapping[str, str],
    catalog_skills: set[str] | frozenset[str],
    exclusions: Counter[str],
) -> dict[str, Any] | None:
    captured_at = _parse_timestamp(
        raw.get("createdAt"),
        f"Yanwu report {source_id!r} createdAt",
    )
    parsed = raw.get("parsed")
    if not isinstance(parsed, dict):
        raise InvalidYanwuCorpus(f"Yanwu report {source_id!r} parsed must be an object")
    winner_side = parsed.get("winnerSide")
    if winner_side not in {"left", "right"}:
        exclusions["unknown_result"] += 1
        return None

    team_values: list[list[Any]] = []
    for side in ("leftTeam", "rightTeam"):
        team = parsed.get(side)
        heroes = team.get("heroes") if isinstance(team, dict) else None
        if not isinstance(heroes, list) or len(heroes) != 3:
            exclusions["incomplete_team"] += 1
            return None
        team_values.append(heroes)

    normalized_teams: list[list[dict[str, Any]]] = []
    for team_index, heroes in enumerate(team_values, start=1):
        normalized_heroes: list[dict[str, Any]] = []
        seen_heroes: set[str] = set()
        for hero_index, hero in enumerate(heroes, start=1):
            if not isinstance(hero, dict):
                exclusions["incomplete_tactics"] += 1
                return None
            raw_name = hero.get("name")
            if not isinstance(raw_name, str) or not raw_name:
                exclusions["incomplete_tactics"] += 1
                return None
            name = HERO_ALIASES.get(raw_name, raw_name)
            if name not in default_skill:
                raise InvalidYanwuCorpus(
                    f"Yanwu report {source_id!r} has unknown hero {raw_name!r}"
                )
            if name in seen_heroes:
                exclusions["incomplete_tactics"] += 1
                return None
            seen_heroes.add(name)
            tactics = hero.get("tactics")
            if not isinstance(tactics, list) or len(tactics) != 2:
                exclusions["incomplete_tactics"] += 1
                return None
            normalized_tactics = [
                _normalized_skill(
                    tactic,
                    f"Yanwu report {source_id!r} team {team_index} "
                    f"hero {hero_index} tactic",
                )
                for tactic in tactics
            ]
            shadow_tactics = [
                normalized
                for raw_tactic, normalized in zip(tactics, normalized_tactics)
                if raw_tactic.startswith(SHADOW_SKILL_PREFIX)
            ]
            unknown_skills = [
                skill for skill in normalized_tactics if skill not in catalog_skills
            ]
            if unknown_skills:
                raise InvalidYanwuCorpus(
                    f"Yanwu report {source_id!r} has unknown skill "
                    f"{unknown_skills[0]!r}"
                )
            normalized_hero = {
                "name": name,
                "skills": [default_skill[name], *normalized_tactics],
            }
            if shadow_tactics:
                normalized_hero["shadow_skills"] = shadow_tactics
            normalized_heroes.append(normalized_hero)
        normalized_teams.append(normalized_heroes)

    return {
        "1": normalized_teams[0],
        "2": normalized_teams[1],
        "captured_at": captured_at,
        "import_order": import_order,
        "season": season,
        "source_id": source_id,
        "winner": "1" if winner_side == "left" else "2",
    }


def normalize_releases(
    releases: Sequence[Any],
    manifest: Mapping[str, Any],
    *,
    catalog_version: str,
    default_skill: Mapping[str, str],
    catalog_skills: set[str] | frozenset[str],
) -> dict[str, Any]:
    """Normalize cumulative assets, assigning each report to first appearance.

    Assets are processed in ascending manifest season. Every later asset must be
    cumulative and every repeated report ID must be byte-equivalent after
    removing only its rewritten raw ``season`` field. The first asset containing
    an ID therefore provides that report's deterministic inferred season.
    """
    assets = manifest["assets"]
    if len(releases) != len(assets):
        raise InvalidYanwuCorpus("Yanwu release asset count does not match manifest")

    source = manifest["source"]
    accepted: list[dict[str, Any]] = []
    accepted_by_season: Counter[int] = Counter()
    exclusions: Counter[str] = Counter()
    seen_payloads: dict[str, str] = {}
    previous_asset_ids: set[str] = set()
    source_assets: list[dict[str, Any]] = []
    source_rows = 0
    repeated_rows = 0
    final_asset_order: dict[str, int] = {}

    for asset, release in zip(assets, releases):
        root = _exact_keys(
            release,
            {"exportedAt", "format", "reports", "season", "version"},
            f"Yanwu S{asset['season']} release",
        )
        expected_season = f"S{asset['season']}"
        if (
            root["format"] != source["format"]
            or root["version"] != source["version"]
            or root["season"] != expected_season
        ):
            raise InvalidYanwuCorpus(
                f"Yanwu {expected_season} release contract does not match manifest"
            )
        exported_at = _parse_timestamp(
            root["exportedAt"], f"Yanwu {expected_season} exportedAt"
        )
        reports = root["reports"]
        if not isinstance(reports, list) or len(reports) != asset["report_count"]:
            raise InvalidYanwuCorpus(
                f"Yanwu {expected_season} report count does not match manifest"
            )

        asset_ids: set[str] = set()
        global_offset = source_rows
        for index, raw in enumerate(reports):
            if not isinstance(raw, dict):
                raise InvalidYanwuCorpus(
                    f"Yanwu {expected_season} report {index} must be an object"
                )
            source_id = raw.get("id")
            if (
                not isinstance(source_id, str)
                or not source_id
                or source_id in asset_ids
            ):
                raise InvalidYanwuCorpus(
                    f"Yanwu {expected_season} report {index} has an invalid/duplicate id"
                )
            if raw.get("season") != expected_season:
                raise InvalidYanwuCorpus(
                    f"Yanwu report {source_id!r} season does not match its asset"
                )
            asset_ids.add(source_id)
            comparable = _comparable_report(raw)
            previous = seen_payloads.get(source_id)
            if previous is not None:
                if previous != comparable:
                    raise InvalidYanwuCorpus(
                        f"Yanwu report {source_id!r} conflicts across season assets"
                    )
                repeated_rows += 1
                continue
            seen_payloads[source_id] = comparable
            normalized = _normalize_unique_report(
                raw,
                source_id=source_id,
                import_order=global_offset + index,
                season=asset["season"],
                default_skill=default_skill,
                catalog_skills=catalog_skills,
                exclusions=exclusions,
            )
            if normalized is not None:
                accepted.append(normalized)
                accepted_by_season[asset["season"]] += 1

        final_asset_order = {
            raw["id"]: index
            for index, raw in enumerate(reports)
        }
        missing_prior = previous_asset_ids - asset_ids
        if missing_prior:
            raise InvalidYanwuCorpus(
                f"Yanwu {expected_season} asset is not cumulative; missing report "
                f"{sorted(missing_prior)[0]!r}"
            )
        previous_asset_ids = asset_ids
        source_rows += len(reports)
        source_assets.append(
            {
                "asset_filename": asset["filename"],
                "asset_sha256": asset["sha256"],
                "exported_at": exported_at,
                "report_count": len(reports),
                "season": asset["season"],
            }
        )

    for row in accepted:
        source_id = row["source_id"]
        row["evaluation_identity"] = (
            f"external-yanwu/{final_asset_order[source_id]:08d}-{source_id}.json"
        )
    accepted.sort(key=lambda row: (row["import_order"], row["source_id"]))
    unique_reports = len(seen_payloads)
    exclusion_count = sum(exclusions.values())
    if len(accepted) + exclusion_count != unique_reports:
        raise InvalidYanwuCorpus("Yanwu normalization counts are inconsistent")
    if source_rows != unique_reports + repeated_rows:
        raise InvalidYanwuCorpus("Yanwu cumulative de-duplication counts are inconsistent")

    return {
        "catalog_version": catalog_version,
        "format": NORMALIZED_FORMAT,
        "normalizer_version": NORMALIZER_VERSION,
        "reports": accepted,
        "source": {
            "assets": source_assets,
            "format": source["format"],
            "release_tag": manifest["release_tag"],
            "repository": manifest["repository"],
            "season_assignment": SEASON_ASSIGNMENT,
            "version": source["version"],
        },
        "summary": {
            "accepted_by_season": {
                str(season): accepted_by_season.get(season, 0)
                for season in (asset["season"] for asset in assets)
            },
            "accepted_reports": len(accepted),
            "excluded_reports": exclusion_count,
            "exclusions": dict(sorted(exclusions.items())),
            "repeated_source_rows": repeated_rows,
            "source_rows": source_rows,
            "unique_reports": unique_reports,
        },
        "version": NORMALIZED_VERSION,
    }


def normalize_release(
    release: Any,
    manifest: Mapping[str, Any],
    *,
    catalog_version: str,
    default_skill: Mapping[str, str],
    catalog_skills: set[str] | frozenset[str],
) -> dict[str, Any]:
    """Compatibility helper for focused one-asset tests."""
    if len(manifest["assets"]) != 1:
        raise InvalidYanwuCorpus(
            "normalize_release requires a one-asset manifest; use normalize_releases"
        )
    return normalize_releases(
        [release],
        manifest,
        catalog_version=catalog_version,
        default_skill=default_skill,
        catalog_skills=catalog_skills,
    )


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
            "assets",
            "format",
            "release_tag",
            "repository",
            "season_assignment",
            "version",
        },
        "normalized Yanwu source",
    )
    expected_source = manifest["source"]
    if (
        source["release_tag"] != manifest["release_tag"]
        or source["repository"] != manifest["repository"]
        or source["format"] != expected_source["format"]
        or source["season_assignment"] != SEASON_ASSIGNMENT
        or source["version"] != expected_source["version"]
        or not isinstance(source["assets"], list)
        or len(source["assets"]) != len(manifest["assets"])
    ):
        raise InvalidYanwuCorpus("normalized Yanwu source does not match manifest")
    for index, (normalized_asset, manifest_asset) in enumerate(
        zip(source["assets"], manifest["assets"])
    ):
        asset = _exact_keys(
            normalized_asset,
            {"asset_filename", "asset_sha256", "exported_at", "report_count", "season"},
            f"normalized Yanwu source asset {index}",
        )
        if (
            asset["asset_filename"] != manifest_asset["filename"]
            or asset["asset_sha256"] != manifest_asset["sha256"]
            or asset["report_count"] != manifest_asset["report_count"]
            or asset["season"] != manifest_asset["season"]
        ):
            raise InvalidYanwuCorpus(
                "normalized Yanwu source asset does not match manifest"
            )
        _parse_timestamp(asset["exported_at"], "normalized Yanwu exported_at")

    reports = value["reports"]
    summary = _exact_keys(
        value["summary"],
        {
            "accepted_by_season",
            "accepted_reports",
            "excluded_reports",
            "exclusions",
            "repeated_source_rows",
            "source_rows",
            "unique_reports",
        },
        "normalized Yanwu summary",
    )
    expected_source_rows = sum(asset["report_count"] for asset in manifest["assets"])
    expected_seasons = {str(asset["season"]) for asset in manifest["assets"]}
    if not isinstance(reports, list):
        raise InvalidYanwuCorpus("normalized Yanwu reports must be an array")
    count_fields = (
        "accepted_reports",
        "excluded_reports",
        "repeated_source_rows",
        "source_rows",
        "unique_reports",
    )
    valid_counts = all(
        not isinstance(summary[field], bool)
        and isinstance(summary[field], int)
        and summary[field] >= 0
        for field in count_fields
    )
    valid_season_counts = (
        isinstance(summary["accepted_by_season"], dict)
        and set(summary["accepted_by_season"]) == expected_seasons
        and all(
            not isinstance(count, bool)
            and isinstance(count, int)
            and count >= 0
            for count in summary["accepted_by_season"].values()
        )
    )
    valid_exclusions = (
        isinstance(summary["exclusions"], dict)
        and all(
            isinstance(reason, str)
            and bool(reason)
            and not isinstance(count, bool)
            and isinstance(count, int)
            and count > 0
            for reason, count in summary["exclusions"].items()
        )
    )
    if not valid_counts or not valid_season_counts or not valid_exclusions:
        raise InvalidYanwuCorpus("normalized Yanwu summary is inconsistent")
    if (
        summary["source_rows"] != expected_source_rows
        or summary["accepted_reports"] != len(reports)
        or summary["accepted_reports"] + summary["excluded_reports"]
        != summary["unique_reports"]
        or summary["unique_reports"] + summary["repeated_source_rows"]
        != summary["source_rows"]
        or sum(summary["accepted_by_season"].values()) != len(reports)
        or sum(summary["exclusions"].values()) != summary["excluded_reports"]
    ):
        raise InvalidYanwuCorpus("normalized Yanwu summary is inconsistent")

    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    previous_key: tuple[int, str] | None = None
    report_season_counts: Counter[int] = Counter()
    valid_seasons = {asset["season"] for asset in manifest["assets"]}
    for index, report in enumerate(reports):
        row = _exact_keys(
            report,
            {
                "1",
                "2",
                "captured_at",
                "evaluation_identity",
                "import_order",
                "season",
                "source_id",
                "winner",
            },
            f"normalized Yanwu report {index}",
        )
        source_id = row["source_id"]
        import_order = row["import_order"]
        evaluation_identity = row["evaluation_identity"]
        if (
            not isinstance(source_id, str)
            or not source_id
            or source_id in seen_ids
            or isinstance(import_order, bool)
            or not isinstance(import_order, int)
            or import_order < 0
            or import_order in seen_orders
            or isinstance(row["season"], bool)
            or not isinstance(row["season"], int)
            or row["season"] not in valid_seasons
            or not isinstance(evaluation_identity, str)
            or not re.fullmatch(
                rf"external-yanwu/\d{{8}}-{re.escape(source_id)}\.json",
                evaluation_identity,
            )
        ):
            raise InvalidYanwuCorpus("normalized Yanwu report identity/order is invalid")
        key = (import_order, source_id)
        if previous_key is not None and key <= previous_key:
            raise InvalidYanwuCorpus(
                "normalized Yanwu reports are not deterministically sorted"
            )
        previous_key = key
        seen_ids.add(source_id)
        seen_orders.add(import_order)
        report_season_counts[row["season"]] += 1
        _parse_timestamp(
            row["captured_at"], f"normalized Yanwu report {source_id!r}"
        )
    if {
        str(season): report_season_counts.get(season, 0)
        for season in sorted(valid_seasons)
    } != summary["accepted_by_season"]:
        raise InvalidYanwuCorpus("normalized Yanwu season counts are inconsistent")
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


def _verified_raw_asset(path: Path, asset: Mapping[str, Any]) -> bool:
    try:
        digest, size = _sha256_file(path)
    except InvalidYanwuCorpus:
        return False
    return digest == asset["sha256"] and size == asset["bytes"]


def _download_to(handle: BinaryIO, asset: Mapping[str, Any]) -> tuple[str, int]:
    request = urllib.request.Request(
        asset["url"], headers={"User-Agent": USER_AGENT}
    )
    digest = hashlib.sha256()
    size = 0
    expected_size = asset["bytes"]
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            while chunk := response.read(DOWNLOAD_CHUNK_BYTES):
                size += len(chunk)
                if size > expected_size:
                    raise InvalidYanwuCorpus(
                        f"Yanwu S{asset['season']} download exceeds manifest byte size"
                    )
                digest.update(chunk)
                handle.write(chunk)
    except (OSError, TimeoutError) as exc:
        raise InvalidYanwuCorpus(
            f"cannot download pinned Yanwu S{asset['season']} asset: {exc}"
        ) from exc
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
    """Ensure all pinned assets and their authenticated normalized corpus exist."""
    manifest = load_manifest(manifest_path)
    normalized_path = normalized_cache_path(manifest, cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)

    releases: list[Any] = []
    for asset in manifest["assets"]:
        raw_path = raw_cache_path(asset, cache_dir)
        if not _verified_raw_asset(raw_path, asset):
            fd, temporary_name = tempfile.mkstemp(
                dir=cache_dir,
                prefix=f".yanwu-S{asset['season']}-download.",
                suffix=".tmp",
            )
            try:
                with os.fdopen(fd, "wb") as handle:
                    digest, size = _download_to(handle, asset)
                if digest != asset["sha256"] or size != asset["bytes"]:
                    raise InvalidYanwuCorpus(
                        f"downloaded Yanwu S{asset['season']} asset failed verification"
                    )
                os.replace(temporary_name, raw_path)
            except BaseException:
                try:
                    os.unlink(temporary_name)
                except OSError:
                    pass
                raise
        releases.append(
            _load_json(raw_path, f"pinned Yanwu S{asset['season']} release")
        )

    normalized = normalize_releases(
        releases,
        manifest,
        catalog_version=catalog_version,
        default_skill=default_skill,
        catalog_skills=catalog_skills,
    )
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
            if cached == normalized:
                return normalized_path, cached["summary"], True

    _atomic_write_json(normalized_path, normalized)
    validated = load_normalized_corpus(
        normalized_path,
        manifest,
        catalog_version=catalog_version,
    )
    return normalized_path, validated["summary"], False
