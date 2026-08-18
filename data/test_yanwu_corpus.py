from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path

import pytest

from data.yanwu_corpus import (
    InvalidYanwuCorpus,
    load_normalized_corpus,
    normalize_release,
    normalize_releases,
    normalized_cache_path,
    raw_cache_path,
    sync_corpus,
)


DEFAULT_SKILLS = {
    "孙坚2": "诛凶殄逆",
    "周瑜2": "焰燎江天",
    "诸葛亮2": "星罗棋布",
    "皇甫嵩2": "兵动若神",
    "祝融": "南疆烈刃",
    "张辽": "风袭逍遥",
}
EQUIPPED_SKILLS = {
    "战八方",
    "十面埋伏",
    "折冲御侮",
    "万人之敌",
}


def _hero(name: str, tactics: list[str] | None = None) -> dict:
    return {
        "name": name,
        "tactics": tactics if tactics is not None else ["战八方", "十面埋伏"],
    }


def _report(
    report_id: str,
    season: int,
    *,
    winner: str = "left",
    left: list[dict] | None = None,
    right: list[dict] | None = None,
) -> dict:
    return {
        "id": report_id,
        "createdAt": "2026-08-12T10:42:00Z",
        "updatedAt": "2026-08-17T00:00:00Z",
        "season": f"S{season}",
        "parsed": {
            "winnerSide": winner,
            "leftTeam": {
                "heroes": left
                if left is not None
                else [
                    _hero("SP孙坚"),
                    _hero("SP周瑜", ["折冲御侮", "影・万人之敌"]),
                    _hero("张辽"),
                ]
            },
            "rightTeam": {
                "heroes": right
                if right is not None
                else [
                    _hero("SP诸葛亮"),
                    _hero("皇甫嵩"),
                    _hero("祝融夫人"),
                ]
            },
        },
    }


def _release(season: int, reports: list[dict]) -> dict:
    return {
        "format": "yanwu-report-library-public",
        "version": 1,
        "season": f"S{season}",
        "exportedAt": "2026-08-17T16:10:25.936Z",
        "reports": reports,
    }


def _asset(season: int, release_bytes: bytes) -> dict:
    release = json.loads(release_bytes)
    return {
        "bytes": len(release_bytes),
        "filename": f"S{season}-test.ywrlib.json",
        "report_count": len(release["reports"]),
        "season": season,
        "sha256": hashlib.sha256(release_bytes).hexdigest(),
        "url": (
            "https://github.com/example/yanwu-battle-reports/releases/"
            f"download/test/S{season}-test.ywrlib.json"
        ),
    }


def _manifest(assets: list[dict]) -> dict:
    return {
        "schema_version": 3,
        "repository": "https://github.com/example/yanwu-battle-reports",
        "release_tag": "s7-s16-test",
        "assets": assets,
        "source": {
            "format": "yanwu-report-library-public",
            "version": 1,
        },
        "license": {
            "name": "CC BY 4.0",
            "url": "https://github.com/example/yanwu-battle-reports/blob/main/LICENSE",
        },
    }


def _release_bytes(release: dict) -> bytes:
    return json.dumps(release, ensure_ascii=False).encode()


def _normalize(releases: list[dict], manifest: dict) -> dict:
    return normalize_releases(
        releases,
        manifest,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )


def _write_manifest(path: Path, manifest: dict) -> None:
    path.write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")


def test_normalize_release_applies_aliases_shadow_skills_and_exclusions():
    reports = [
        _report("valid", 7),
        _report("unknown", 7, winner=""),
        _report("short-team", 7, left=[_hero("SP孙坚")]),
        _report(
            "short-tactics",
            7,
            left=[
                _hero("SP孙坚", ["战八方"]),
                _hero("SP周瑜"),
                _hero("张辽"),
            ],
        ),
    ]
    release = _release(7, reports)
    release_bytes = _release_bytes(release)
    manifest = _manifest([_asset(7, release_bytes)])

    normalized = normalize_release(
        release,
        manifest,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )

    assert normalized["summary"] == {
        "accepted_by_season": {"7": 1},
        "accepted_reports": 1,
        "excluded_reports": 3,
        "exclusions": {
            "incomplete_tactics": 1,
            "incomplete_team": 1,
            "unknown_result": 1,
        },
        "repeated_source_rows": 0,
        "source_rows": 4,
        "unique_reports": 4,
    }
    battle = normalized["reports"][0]
    assert battle["season"] == 7
    assert [hero["name"] for hero in battle["1"]] == ["孙坚2", "周瑜2", "张辽"]
    assert [hero["name"] for hero in battle["2"]] == [
        "诸葛亮2",
        "皇甫嵩2",
        "祝融",
    ]
    assert battle["1"][1]["skills"] == ["焰燎江天", "折冲御侮", "万人之敌"]
    assert battle["1"][1]["shadow_skills"] == ["万人之敌"]
    assert battle["evaluation_identity"] == "external-yanwu/00000000-valid.json"


def test_cumulative_assets_assign_first_appearance_season_and_remove_repeats():
    first = _report("first", 7)
    repeated = _report("first", 8)
    new = _report("new", 8, winner="right")
    release7 = _release(7, [first])
    release8 = _release(8, [repeated, new])
    manifest = _manifest(
        [
            _asset(7, _release_bytes(release7)),
            _asset(8, _release_bytes(release8)),
        ]
    )

    normalized = _normalize([release7, release8], manifest)

    assert [
        (row["source_id"], row["season"], row["evaluation_identity"])
        for row in normalized["reports"]
    ] == [
        ("first", 7, "external-yanwu/00000000-first.json"),
        ("new", 8, "external-yanwu/00000001-new.json"),
    ]
    assert normalized["summary"] == {
        "accepted_by_season": {"7": 1, "8": 1},
        "accepted_reports": 2,
        "excluded_reports": 0,
        "exclusions": {},
        "repeated_source_rows": 1,
        "source_rows": 3,
        "unique_reports": 2,
    }


def test_cumulative_assets_reject_conflicting_duplicate_content():
    first = _report("same", 7)
    changed = _report("same", 8, winner="right")
    release7 = _release(7, [first])
    release8 = _release(8, [changed])
    manifest = _manifest(
        [
            _asset(7, _release_bytes(release7)),
            _asset(8, _release_bytes(release8)),
        ]
    )

    with pytest.raises(InvalidYanwuCorpus, match="conflicts across season assets"):
        _normalize([release7, release8], manifest)


def test_cumulative_assets_reject_removed_prior_report():
    first = _report("first", 7)
    release7 = _release(7, [first])
    release8 = _release(8, [_report("new", 8)])
    manifest = _manifest(
        [
            _asset(7, _release_bytes(release7)),
            _asset(8, _release_bytes(release8)),
        ]
    )

    with pytest.raises(InvalidYanwuCorpus, match="is not cumulative"):
        _normalize([release7, release8], manifest)


def test_release_and_report_seasons_must_match_manifest_asset():
    report = _report("bad-season", 8)
    release = _release(7, [report])
    manifest = _manifest([_asset(7, _release_bytes(release))])

    with pytest.raises(InvalidYanwuCorpus, match="season does not match its asset"):
        _normalize([release], manifest)


@pytest.mark.parametrize(
    ("left", "catalog_skills", "message"),
    [
        (
            [_hero("UNKNOWN"), _hero("SP周瑜"), _hero("张辽")],
            EQUIPPED_SKILLS,
            "unknown hero",
        ),
        (
            [
                _hero("SP孙坚", ["UNKNOWN", "十面埋伏"]),
                _hero("SP周瑜"),
                _hero("张辽"),
            ],
            EQUIPPED_SKILLS,
            "unknown skill",
        ),
    ],
)
def test_normalize_release_fails_closed_on_unknown_catalog_values(
    left: list[dict],
    catalog_skills: set[str],
    message: str,
):
    release = _release(7, [_report("bad", 7, left=left)])
    manifest = _manifest([_asset(7, _release_bytes(release))])

    with pytest.raises(InvalidYanwuCorpus, match=message):
        normalize_release(
            release,
            manifest,
            catalog_version="catalog-v1",
            default_skill=DEFAULT_SKILLS,
            catalog_skills=catalog_skills | set(DEFAULT_SKILLS.values()),
        )


def test_sync_populates_reuses_and_authenticates_multi_asset_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    release7 = _release(7, [_report("first", 7)])
    release8 = _release(8, [_report("first", 8), _report("new", 8)])
    source_bytes = {
        7: _release_bytes(release7),
        8: _release_bytes(release8),
    }
    manifest = _manifest(
        [_asset(season, source_bytes[season]) for season in (7, 8)]
    )
    manifest_path = tmp_path / "manifest.json"
    cache_dir = tmp_path / "cache"
    _write_manifest(manifest_path, manifest)
    calls: list[str] = []

    def open_source(request, *, timeout):
        assert timeout == 120
        calls.append(request.full_url)
        season = 7 if "S7-" in request.full_url else 8
        return io.BytesIO(source_bytes[season])

    monkeypatch.setattr("data.yanwu_corpus.urllib.request.urlopen", open_source)
    path, summary, hit = sync_corpus(
        manifest_path,
        cache_dir,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )
    assert hit is False
    assert len(calls) == 2
    assert summary["accepted_by_season"] == {"7": 1, "8": 1}
    assert path == normalized_cache_path(manifest, cache_dir)
    for asset in manifest["assets"]:
        assert raw_cache_path(asset, cache_dir).exists()

    repeated_path, repeated_summary, repeated_hit = sync_corpus(
        manifest_path,
        cache_dir,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )
    assert repeated_path == path
    assert repeated_summary == summary
    assert repeated_hit is True
    assert len(calls) == 2

    tampered = json.loads(path.read_text(encoding="utf-8"))
    tampered["reports"][0]["winner"] = "2"
    path.write_text(json.dumps(tampered, ensure_ascii=False), encoding="utf-8")
    repaired_path, _repaired_summary, repaired_hit = sync_corpus(
        manifest_path,
        cache_dir,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )
    assert repaired_path == path
    assert repaired_hit is False
    assert len(calls) == 2
    validated = load_normalized_corpus(path, manifest, catalog_version="catalog-v1")
    assert validated["reports"][0]["winner"] == "1"


def test_sync_rejects_a_download_that_does_not_match_the_manifest(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    release = _release(7, [_report("valid", 7)])
    source_bytes = _release_bytes(release)
    manifest = _manifest([_asset(7, source_bytes)])
    manifest["assets"][0]["sha256"] = "0" * 64
    manifest_path = tmp_path / "manifest.json"
    cache_dir = tmp_path / "cache"
    _write_manifest(manifest_path, manifest)
    monkeypatch.setattr(
        "data.yanwu_corpus.urllib.request.urlopen",
        lambda _request, *, timeout: io.BytesIO(source_bytes),
    )

    with pytest.raises(InvalidYanwuCorpus, match="failed verification"):
        sync_corpus(
            manifest_path,
            cache_dir,
            catalog_version="catalog-v1",
            default_skill=DEFAULT_SKILLS,
            catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
        )
    assert not normalized_cache_path(manifest, cache_dir).exists()
