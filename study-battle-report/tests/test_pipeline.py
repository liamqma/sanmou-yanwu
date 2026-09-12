from copy import deepcopy
import json
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace

import cv2
import numpy as np
import pytest

import backends
import ocr_battle_log as cli
from test_hybrid import BLUE, NAMES, localized, name_colours

TEXT = "[张宝]恢复了兵力0(9000)\n第八回合"


class FakeModels:
    def __init__(self, rows):
        self.rows = rows
        self.calls = 0
        self.fail = False

    def localize(self, image):
        self.calls += 1
        assert image.shape == (1845, 865, 3)
        return deepcopy(self.rows)

    def transcribe(self, image):
        if self.fail:
            raise RuntimeError("injected model failure")
        return TEXT


@pytest.fixture
def battle(tmp_path):
    image, rows = localized(TEXT, name_colours(TEXT, [BLUE]))
    screenshot = np.zeros((2340, 1080, 3), dtype=np.uint8)
    screenshot[275:275+image.shape[0], 195:195+image.shape[1]] = image
    battle = tmp_path / "battles" / "fixture"
    (battle / "images").mkdir(parents=True)
    path = battle / "images/battle_detail_001.png"
    assert cv2.imwrite(str(path), screenshot)
    return battle, tmp_path / "output", FakeModels(rows)


def run(battle, **options):
    source, output, models = battle
    return cli.process_battle(source, output, {"engine": "test"}, NAMES, models, **options)


def test_end_to_end_cache_only_retags_pixels_without_running_models(battle):
    _, output, models = battle
    result = run(battle)
    assert result["counts"]["unresolved_name_tokens"] == 0
    assert "[我方:张宝]" in (output / "battle_log.txt").read_text()
    previous = (output / "battle_log.txt").read_bytes()
    models.fail = True
    second = run(battle, cache_only=True)
    assert second["counts"]["cached_frames"] == 1
    assert models.calls == 1
    assert (output / "battle_log.txt").read_bytes() == previous
    cache = json.loads((output / ".ocr_cache.json").read_text())
    assert cache["schema_version"] == 3
    assert "glm_text" in cache["frames"]["battle_detail_001.png"]


@pytest.mark.parametrize("transcript,expected,unparsed", [
    ("[敌方 :陈琳]开始行动", "[待核:陈琳]开始行动", 0),
    ("[张?]开始行动", "[待核:张?]开始行动", 1),
    ("陈琳]开始行动", "[待核:陈琳]开始行动", 1),
    ("敌方 :陈?]开始行动", "[待核:陈?]开始行动", 1),
])
def test_untrusted_and_unparseable_actors_cannot_publish_complete_status(battle, monkeypatch, transcript, expected, unparsed):
    _, output, models = battle
    monkeypatch.setattr(models, "transcribe", lambda image: transcript)
    run(battle)
    report = json.loads((output / "battle_log.review.json").read_text())
    assert (output / "battle_log.txt").read_text() == expected + "\n"
    assert report["status"] == "needs_review"
    assert report["counts"]["unresolved_name_tokens"] == 1
    assert report["counts"]["unparsed_name_mentions"] == unparsed
    assert report["frames"][0]["lines"][0]["tokens"][0]["side"] is None
    if unparsed:
        assert report["frames"][0]["lines"][0]["unparsed_names"][0]["reason"] == "unparseable_actor"


def test_bare_localized_npc_cannot_publish_complete_status(battle, monkeypatch):
    _, output, models = battle
    text = "[陈琳]开始行动"
    _, models.rows = localized(text, name_colours(text, [BLUE]))
    monkeypatch.setattr(models, "transcribe", lambda image: "陈琳开始行动")
    run(battle)
    report = json.loads((output / "battle_log.review.json").read_text())
    assert (output / "battle_log.txt").read_text() == "陈琳开始行动\n"
    assert report["status"] == "needs_review"
    assert report["counts"]["unparsed_name_mentions"] == 1
    assert report["frames"][0]["lines"][0]["tokens"] == []


def test_low_confidence_diagnostics_are_published_in_review_evidence(battle):
    _, output, models = battle
    models.rows[0]["glyphs"][1]["score"] = 0.79
    run(battle)
    report = json.loads((output / "battle_log.review.json").read_text())
    assert report["status"] == "needs_review"
    token = report["frames"][0]["lines"][0]["tokens"][0]
    character = token["candidates"][0]["characters"][0]
    assert token["side"] is None
    assert character["side"] is None
    assert character["score"] == 0.79
    assert character["blue_pixels"] > 0
    assert character["red_pixels"] == 0
    assert character["box"] == models.rows[0]["glyphs"][1]["box"]
    assert character["reason"] == "low_localization_confidence"


def test_source_change_invalidates_cache_and_does_not_publish_partial_result(battle):
    source, output, models = battle
    run(battle)
    previous = (output / "battle_log.txt").read_bytes()
    path = source / "images/battle_detail_001.png"
    image = cv2.imread(str(path)); image[0, 0] = 1
    assert cv2.imwrite(str(path), image)
    with pytest.raises(ValueError, match="stale"):
        run(battle, cache_only=True)
    assert models.calls == 1
    models.fail = True
    with pytest.raises(RuntimeError, match="injected"):
        run(battle)
    assert (output / "battle_log.txt").read_bytes() == previous


@pytest.mark.parametrize("legacy", [{"file.png": [["[我方:张宝]", 1.0]]}, {"schema_version": 2, "frames": {}}])
def test_legacy_paddle_cache_is_not_trusted_for_side_tags(battle, legacy):
    _, output, models = battle
    output.mkdir()
    (output / ".ocr_cache.json").write_text(json.dumps(legacy))
    with pytest.raises(ValueError, match="Legacy Paddle"):
        run(battle, cache_only=True)
    assert models.calls == 0
    run(battle)
    assert models.calls == 1


def test_engine_configuration_change_invalidates_cache(battle):
    source, output, models = battle
    run(battle)
    with pytest.raises(ValueError, match="incompatible"):
        cli.process_battle(source, output, {"engine": "different"}, NAMES, models, cache_only=True)
    assert models.calls == 1


@pytest.mark.parametrize("corruption", ["nan-score", "bad-box", "missing-text"])
def test_corrupt_cached_evidence_is_rejected(battle, corruption):
    _, output, models = battle
    run(battle)
    cache_path = output / ".ocr_cache.json"
    cache = json.loads(cache_path.read_text())
    raw = cache["frames"]["battle_detail_001.png"]
    if corruption == "nan-score":
        raw["localization"][0]["glyphs"][0]["score"] = float("nan")
    elif corruption == "bad-box":
        raw["localization"][0]["glyphs"][0]["box"] = [[0, 0]]
    else:
        raw["glm_text"] = ""
    cache_path.write_text(json.dumps(cache))
    with pytest.raises(ValueError, match="invalid cached"):
        run(battle, cache_only=True)
    assert models.calls == 1


def test_refresh_recomputes_while_ordinary_runs_resume(battle):
    _, _, models = battle
    run(battle)
    run(battle)
    assert models.calls == 1
    run(battle, refresh=True)
    assert models.calls == 2


def test_source_hash_binds_the_decoded_snapshot_during_concurrent_replacement(battle, monkeypatch):
    import hashlib
    source, output, _ = battle
    path = source / "images/battle_detail_001.png"
    original = path.read_bytes()
    decode = cli.cv2.imdecode

    def replace_after_read(data, flags):
        image = decode(data, flags)
        replacement = image.copy()
        replacement[0, 0] = 17
        assert cv2.imwrite(str(path), replacement)
        return image

    monkeypatch.setattr(cli.cv2, "imdecode", replace_after_read)
    run(battle)
    raw = json.loads((output / ".ocr_cache.json").read_text())["frames"][path.name]
    assert raw["image_sha256"] == hashlib.sha256(original).hexdigest()
    assert raw["image_sha256"] != hashlib.sha256(path.read_bytes()).hexdigest()


def test_bad_image_dimensions_fail_without_publishing(battle):
    source, output, models = battle
    cv2.imwrite(str(source / "images/battle_detail_001.png"), np.zeros((20, 20, 3), np.uint8))
    with pytest.raises(ValueError, match="1080×2340"):
        run(battle)
    assert models.calls == 0
    assert not (output / "battle_log.txt").exists()


def test_output_is_isolated_from_original_logs(battle):
    source, _, _ = battle
    (source / "battle_log.txt").write_text("original")
    (source / ".ocr_cache.json").write_text("original cache")
    run(battle)
    assert (source / "battle_log.txt").read_text() == "original"
    assert (source / ".ocr_cache.json").read_text() == "original cache"


def test_cli_lists_without_loading_models_and_rejects_unknown_paths(battle, monkeypatch, capsys):
    source, _, _ = battle
    monkeypatch.setattr(cli, "BATTLES_DIR", source.parent)
    monkeypatch.setattr(cli, "LocalModels", lambda *args: pytest.fail("must not initialize"))
    assert cli.main(["--list"]) == 0
    assert "fixture: 1 frames" in capsys.readouterr().out
    with pytest.raises(SystemExit) as error:
        cli.main(["../outside"])
    assert error.value.code == 2


def test_local_model_override_identity_is_content_based(tmp_path):
    for name in ["model.safetensors", "config.json", "preprocessor_config.json", "tokenizer.json"]:
        (tmp_path / name).write_text("first")
    first = backends.configuration(tmp_path)
    (tmp_path / "model.safetensors").write_text("different")
    assert backends.configuration(tmp_path) != first


@pytest.mark.parametrize("result,raises", [
    (SimpleNamespace(text="recognized", generation_tokens=12, finish_reason="stop"), False),
    (SimpleNamespace(text="truncated", generation_tokens=4096, finish_reason="length"), True),
    (SimpleNamespace(text="", generation_tokens=0, finish_reason="stop"), True),
])
def test_glm_receives_rgb_and_rejects_empty_or_truncated_output(monkeypatch, result, raises):
    monkeypatch.setattr(backends.platform, "system", lambda: "Darwin")
    monkeypatch.setattr(backends.platform, "machine", lambda: "arm64")
    fake = ModuleType("mlx_vlm")

    def generate(*args, **kwargs):
        assert kwargs["image"][0].getpixel((0, 0)) == (0, 100, 255)
        assert kwargs["temperature"] == 0
        return result

    fake.generate = generate
    monkeypatch.setitem(sys.modules, "mlx_vlm", fake)
    model = backends.LocalModels()
    model.glm = (object(), object(), "formatted prompt")
    image = np.array([[BLUE]], np.uint8)
    if raises:
        with pytest.raises(RuntimeError):
            model.transcribe(image)
    else:
        assert model.transcribe(image) == "recognized"
