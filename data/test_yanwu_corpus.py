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
    normalized_cache_path,
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
    import_order: int,
    *,
    winner: str = "left",
    left: list[dict] | None = None,
    right: list[dict] | None = None,
) -> dict:
    return {
        "id": report_id,
        "importOrder": import_order,
        "createdAt": f"2026-08-12T10:42:{import_order:02d}Z",
        "season": "S16",
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


def _release(reports: list[dict]) -> dict:
    return {
        "format": "yanwu-report-library",
        "version": 1,
        "exportedAt": "2026-08-12T10:42:28.089Z",
        "reports": reports,
    }


def _manifest(release_bytes: bytes) -> dict:
    release = json.loads(release_bytes)
    return {
        "schema_version": 2,
        "repository": "https://github.com/example/yanwu-battle-reports",
        "release_tag": "s16-test",
        "asset": {
            "bytes": len(release_bytes),
            "filename": "s16-test.ywrlib.json",
            "report_count": len(release["reports"]),
            "sha256": hashlib.sha256(release_bytes).hexdigest(),
            "url": "https://github.com/example/yanwu-battle-reports/releases/download/s16-test/s16-test.ywrlib.json",
        },
        "source": {
            "format": "yanwu-report-library",
            "version": 1,
        },
        "license": {
            "name": "CC BY 4.0",
            "url": "https://github.com/example/yanwu-battle-reports/blob/main/LICENSE",
        },
    }


def _write_manifest(path: Path, manifest: dict) -> None:
    path.write_text(
        json.dumps(manifest, ensure_ascii=False),
        encoding="utf-8",
    )


def test_normalize_release_applies_aliases_shadow_skills_and_exclusions():
    reports = [
        _report("valid", 0),
        _report("unknown", 1, winner=""),
        _report("short-team", 2, left=[_hero("SP孙坚")]),
        _report(
            "short-tactics",
            3,
            left=[
                _hero("SP孙坚", ["战八方"]),
                _hero("SP周瑜"),
                _hero("张辽"),
            ],
        ),
    ]
    release_bytes = json.dumps(_release(reports), ensure_ascii=False).encode()
    manifest = _manifest(release_bytes)

    normalized = normalize_release(
        _release(reports),
        manifest,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )

    assert normalized["summary"] == {
        "accepted_reports": 1,
        "excluded_reports": 3,
        "exclusions": {
            "incomplete_tactics": 1,
            "incomplete_team": 1,
            "unknown_result": 1,
        },
        "source_reports": 4,
    }
    battle = normalized["reports"][0]
    assert [hero["name"] for hero in battle["1"]] == [
        "孙坚2",
        "周瑜2",
        "张辽",
    ]
    assert [hero["name"] for hero in battle["2"]] == [
        "诸葛亮2",
        "皇甫嵩2",
        "祝融",
    ]
    assert battle["1"][0]["skills"][0] == "诛凶殄逆"
    assert battle["1"][1]["skills"] == ["焰燎江天", "折冲御侮", "万人之敌"]
    assert battle["season"] is None


def test_normalize_release_ignores_untrusted_raw_season_label():
    report = _report("unknown-season", 0)
    report["season"] = "S999"
    release = _release([report])
    release_bytes = json.dumps(release, ensure_ascii=False).encode()

    normalized = normalize_release(
        release,
        _manifest(release_bytes),
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )

    assert normalized["reports"][0]["season"] is None
    assert "season" not in normalized["source"]


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
    reports = [_report("bad", 0, left=left)]
    release_bytes = json.dumps(_release(reports), ensure_ascii=False).encode()

    with pytest.raises(InvalidYanwuCorpus, match=message):
        normalize_release(
            _release(reports),
            _manifest(release_bytes),
            catalog_version="catalog-v1",
            default_skill=DEFAULT_SKILLS,
            catalog_skills=catalog_skills | set(DEFAULT_SKILLS.values()),
        )


def test_sync_populates_then_reuses_and_repairs_the_cache(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    source_bytes = json.dumps(
        _release([_report("valid", 0)]),
        ensure_ascii=False,
    ).encode()
    manifest = _manifest(source_bytes)
    manifest_path = tmp_path / "manifest.json"
    cache_dir = tmp_path / "cache"
    _write_manifest(manifest_path, manifest)
    calls = 0

    def open_source(_request, *, timeout):
        nonlocal calls
        assert timeout == 120
        calls += 1
        return io.BytesIO(source_bytes)

    monkeypatch.setattr("data.yanwu_corpus.urllib.request.urlopen", open_source)
    path, summary, hit = sync_corpus(
        manifest_path,
        cache_dir,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )
    assert hit is False
    assert calls == 1
    assert summary["accepted_reports"] == 1
    assert path == normalized_cache_path(manifest, cache_dir)

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
    assert calls == 1

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
    assert calls == 1
    assert json.loads(path.read_text(encoding="utf-8"))["reports"][0]["winner"] == "1"

    path.write_text("not json", encoding="utf-8")
    repaired_path, _repaired_summary, repaired_hit = sync_corpus(
        manifest_path,
        cache_dir,
        catalog_version="catalog-v1",
        default_skill=DEFAULT_SKILLS,
        catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
    )
    assert repaired_path == path
    assert repaired_hit is False
    assert calls == 1
    load_normalized_corpus(path, manifest, catalog_version="catalog-v1")


def test_sync_rejects_a_download_that_does_not_match_the_manifest(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
):
    source_bytes = json.dumps(
        _release([_report("valid", 0)]),
        ensure_ascii=False,
    ).encode()
    manifest = _manifest(source_bytes)
    manifest["asset"]["sha256"] = "0" * 64
    manifest_path = tmp_path / "manifest.json"
    cache_dir = tmp_path / "cache"
    _write_manifest(manifest_path, manifest)
    monkeypatch.setattr(
        "data.yanwu_corpus.urllib.request.urlopen",
        lambda _request, *, timeout: io.BytesIO(source_bytes),
    )

    with pytest.raises(InvalidYanwuCorpus, match="failed manifest verification"):
        sync_corpus(
            manifest_path,
            cache_dir,
            catalog_version="catalog-v1",
            default_skill=DEFAULT_SKILLS,
            catalog_skills=EQUIPPED_SKILLS | set(DEFAULT_SKILLS.values()),
        )
    assert not normalized_cache_path(manifest, cache_dir).exists()
