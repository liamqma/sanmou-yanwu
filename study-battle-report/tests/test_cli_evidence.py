"""Exercise the actual CLI entry point with real pixels and model calls forbidden."""
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
import pytest

import ocr_battle_log as cli
from backends import configuration


class ForbiddenModels:
    def __init__(self, *args, **kwargs):
        pass

    def localize(self, *args):
        raise AssertionError("cached CLI must not invoke RapidOCR")

    def transcribe(self, *args):
        raise AssertionError("cached CLI must not invoke GLM")


def test_cached_cli_real_pixels_replay_and_failure_contract(tmp_path, monkeypatch, capsys):
    fixtures = Path(__file__).parent.parent / "fixtures"
    fixture = json.loads((fixtures / "mixed-names.json").read_text())
    strip = cv2.imread(str(fixtures / "mixed-names.png"))
    screenshot = np.zeros((2340, 1080, 3), dtype=np.uint8)
    screenshot[275:275 + strip.shape[0], 195:195 + strip.shape[1]] = strip
    inputs = tmp_path / "inputs"
    battle = inputs / "cli-fixture"
    (battle / "images").mkdir(parents=True)
    source = battle / "images/battle_detail_001.png"
    assert cv2.imwrite(str(source), screenshot)
    (battle / "battle_log.txt").write_text("original report")
    (battle / ".ocr_cache.json").write_text("original legacy cache")
    outputs = tmp_path / "outputs"
    out = outputs / battle.name
    out.mkdir(parents=True)
    cache_file = out / ".ocr_cache.json"
    cli.write_json(cache_file, {
        "schema_version": 3,
        "ocr_config": configuration(),
        "frames": {source.name: {
            "image_sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "glm_text": fixture["glm_text"],
            "localization": fixture["localization"],
        }},
    })
    monkeypatch.setattr(cli, "BATTLES_DIR", inputs)
    monkeypatch.setattr(cli, "LocalModels", ForbiddenModels)
    assert cli.main(["--list"]) == 0
    assert "cli-fixture: 1 frames" in capsys.readouterr().out
    arguments = [battle.name, "--use-cache", "--output-dir", str(outputs)]
    assert cli.main(arguments) == 0
    log_path = out / "battle_log.txt"
    review_path = out / "battle_log.review.json"
    assert log_path.read_text() == "[我方:皇甫嵩]对[敌方:刘表]发动普通攻击\n"
    report = json.loads(review_path.read_text())
    assert report["status"] == "complete"
    assert report["counts"]["cached_frames"] == 1
    tokens = report["frames"][0]["lines"][0]["tokens"]
    assert [token["side"] for token in tokens] == ["我方", "敌方"]
    assert all(c["blue_pixels"] > 0 and c["red_pixels"] == 0
               for c in tokens[0]["candidates"][0]["characters"])
    assert all(c["red_pixels"] > 0 and c["blue_pixels"] == 0
               for c in tokens[1]["candidates"][0]["characters"])
    original_outputs = [log_path.read_bytes(), review_path.read_bytes()]
    assert cli.main(arguments) == 0
    assert [log_path.read_bytes(), review_path.read_bytes()] == original_outputs
    assert report["log_sha256"] == hashlib.sha256(log_path.read_bytes()).hexdigest()
    (out / "source.png").write_bytes(source.read_bytes())

    trusted_cache = cache_file.read_text()
    unverified = json.loads(trusted_cache)
    row = unverified["frames"][source.name]["localization"][0]
    row["text"] = row["text"].replace("[", "[ ", 1)
    row["score_alignment"] = "aligned"  # a cached assertion is not proof
    cli.write_json(cache_file, unverified)
    assert cli.main(arguments) == 0
    unsafe_report = json.loads(review_path.read_text())
    assert unsafe_report["status"] == "needs_review"
    assert unsafe_report["counts"]["unresolved_name_tokens"] == 2
    for token in unsafe_report["frames"][0]["lines"][0]["tokens"]:
        assert token["side"] is None
        assert all(c["score"] is None and c["raw_score"] > 0.8
                   for c in token["candidates"][0]["characters"])
    cache_file.write_text(trusted_cache)
    assert cli.main(arguments) == 0
    assert [log_path.read_bytes(), review_path.read_bytes()] == original_outputs

    screenshot[0, 0] = (1, 2, 3)
    assert cv2.imwrite(str(source), screenshot)
    with pytest.raises(SystemExit) as stale:
        cli.main(arguments)
    assert stale.value.code == 1
    assert "stale" in capsys.readouterr().err
    assert [log_path.read_bytes(), review_path.read_bytes()] == original_outputs

    cache_file.write_text(json.dumps({"schema_version": 2, "frames": {}}))
    with pytest.raises(SystemExit) as legacy:
        cli.main(arguments)
    assert legacy.value.code == 1
    assert "Legacy Paddle" in capsys.readouterr().err
    assert [log_path.read_bytes(), review_path.read_bytes()] == original_outputs
    assert (battle / "battle_log.txt").read_text() == "original report"
    assert (battle / ".ocr_cache.json").read_text() == "original legacy cache"
    print(f"CLI pixel/evidence artifacts: {out}")
