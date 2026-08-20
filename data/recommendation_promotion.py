from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

BASELINE_SPEC_PATH = "data/evaluation/production-baseline.json"
PROMOTION_EVIDENCE_PATH = "data/evaluation/recommendation-promotion.json"
CANDIDATE_FEATURE_FAMILIES = sorted(
    [
        "H",
        "S",
        "HP",
        "HS",
        "SP",
        "M",
        "MP",
        "MC",
        "MX",
        "HMX",
        "HM",
        "HC",
        "HSM",
        "HTM",
        "B",
        "BM",
    ]
)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def load_json_object(path: str | Path) -> dict[str, Any]:
    value = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return value


def load_baseline_contract(
    spec_path: str | Path,
    artifact_path: str | Path,
) -> tuple[dict[str, Any], bytes, dict[str, Any]]:
    spec = load_json_object(spec_path)
    if spec.get("schema_version") != 1:
        raise ValueError("unsupported production baseline schema")
    artifact_bytes = Path(artifact_path).read_bytes()
    artifact_hash = sha256_bytes(artifact_bytes)
    expected_hash = spec.get("artifact", {}).get("sha256")
    if artifact_hash != expected_hash:
        raise ValueError(
            "production artifact does not match the reviewed baseline contract"
        )
    artifact = json.loads(artifact_bytes)
    if not isinstance(artifact, dict):
        raise ValueError("production baseline artifact must be a JSON object")
    families = sorted(artifact.get("schema", {}).get("feature_families", {}))
    if families != sorted(spec.get("feature_families", [])):
        raise ValueError("production baseline feature semantics do not match")
    model = artifact.get("model", {})
    configuration = spec.get("configuration", {})
    expected_model_fields = {
        "l2_C": configuration.get("C"),
        "min_support_single": configuration.get("min_support_single"),
        "min_support_pair": configuration.get("min_support_pair"),
    }
    if any(model.get(field) != value for field, value in expected_model_fields.items()):
        raise ValueError("production baseline model configuration does not match")
    return spec, artifact_bytes, artifact


def candidate_identity(artifact: Mapping[str, Any]) -> dict[str, Any]:
    model = artifact.get("model", {})
    schema = artifact.get("schema", {})
    families = sorted(schema.get("feature_families", {}))
    return {
        "catalog_version": artifact.get("catalog", {}).get("catalog_version"),
        "corpus_version": artifact.get("battle_counts", {}).get("corpus_version"),
        "configuration": {
            "C": model.get("l2_C"),
            "include_semantic_mechanics": "M" in families,
            "include_sp": "SP" in families,
            "min_support_pair": model.get("min_support_pair"),
            "min_support_single": model.get("min_support_single"),
            "popularity_exposure_tau": model.get("popularity_exposure_tau"),
            "popularity_penalty_gamma": model.get("popularity_penalty_gamma"),
        },
        "feature_families": families,
        "mechanics_version": artifact.get("catalog", {}).get("mechanics_version"),
    }


def promotion_is_supported(
    evidence: Mapping[str, Any],
    baseline_bytes: bytes,
    candidate: Mapping[str, Any],
) -> bool:
    gate = evidence.get("promotion_gate", {})
    intervals = (
        evidence.get("locked_test", {})
        .get("candidate_minus_baseline", {})
        .get("confidence_intervals_95", {})
    )
    accuracy = intervals.get("accuracy")
    brier = intervals.get("brier")
    log_loss = intervals.get("log_loss")
    interval_support = bool(
        isinstance(accuracy, Mapping)
        and isinstance(brier, Mapping)
        and isinstance(log_loss, Mapping)
        and accuracy.get("low", 0) > 0
        and brier.get("high", 0) < 0
        and log_loss.get("high", 0) < 0
    )
    return bool(
        evidence.get("schema_version") == 1
        and gate.get("supported") is True
        and gate.get("conclusion")
        == "candidate_improvement_supported_on_all_three_metrics"
        and interval_support
        and evidence.get("baseline", {}).get("artifact_sha256")
        == sha256_bytes(baseline_bytes)
        and evidence.get("candidate") == candidate_identity(candidate)
    )


def select_production_bytes(
    evidence: Mapping[str, Any],
    baseline_bytes: bytes,
    current_bytes: bytes,
    candidate: Mapping[str, Any],
    candidate_bytes: bytes,
) -> tuple[bytes, bool]:
    promoted = promotion_is_supported(evidence, baseline_bytes, candidate)
    return (candidate_bytes if promoted else current_bytes), promoted
