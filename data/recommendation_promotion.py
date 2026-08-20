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


def mapping_identity(value: Mapping[str, Any]) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return sha256_bytes(payload)


def builder_source_identity() -> dict[str, str]:
    root = Path(__file__).resolve().parent
    paths = (
        "build_recommendation_data.py",
        "skill_description_tokenizer.py",
        "skill_mechanics.py",
    )
    return {
        path: sha256_bytes((root / path).read_bytes())
        for path in paths
    }


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


def candidate_identity(
    artifact: Mapping[str, Any],
    artifact_bytes: bytes,
) -> dict[str, Any]:
    serialized = json.loads(artifact_bytes)
    if serialized != artifact:
        raise ValueError("candidate bytes do not serialize the candidate artifact")
    model = artifact.get("model", {})
    schema = artifact.get("schema", {})
    families = sorted(schema.get("feature_families", {}))
    return {
        "artifact_sha256": sha256_bytes(artifact_bytes),
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


def candidate_algorithm_identity(
    artifact: Mapping[str, Any],
) -> dict[str, Any]:
    identity = candidate_identity(
        artifact,
        (json.dumps(artifact, ensure_ascii=False, sort_keys=True) + "\n").encode(
            "utf-8"
        ),
    )
    return {
        "configuration": identity["configuration"],
        "feature_families": identity["feature_families"],
        "mechanics_schema_version": (
            artifact.get("model", {}).get("mechanics", {}) or {}
        ).get("schema_version"),
        "mechanics_version": identity["mechanics_version"],
        "builder_source": builder_source_identity(),
    }


def promotion_is_supported(
    evidence: Mapping[str, Any],
    baseline_spec: Mapping[str, Any],
    baseline_bytes: bytes,
    candidate: Mapping[str, Any],
    candidate_bytes: bytes,
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
        evidence.get("schema_version") == 3
        and gate.get("supported") is True
        and gate.get("conclusion")
        == "candidate_improvement_supported_on_all_three_metrics"
        and interval_support
        and evidence.get("baseline", {}).get("specification_sha256")
        == mapping_identity(baseline_spec)
        and evidence.get("baseline", {}).get("fallback_artifact_sha256")
        == sha256_bytes(baseline_bytes)
        and evidence.get("candidate_algorithm")
        == candidate_algorithm_identity(candidate)
        and evidence.get("final_production_artifact", {}).get("selection")
        == "candidate"
        and evidence.get("final_production_artifact", {}).get("sha256")
        == sha256_bytes(candidate_bytes)
        and candidate_identity(candidate, candidate_bytes)["artifact_sha256"]
        == sha256_bytes(candidate_bytes)
    )


def select_production_bytes(
    evidence: Mapping[str, Any],
    baseline_spec: Mapping[str, Any],
    baseline_bytes: bytes,
    candidate: Mapping[str, Any],
    candidate_bytes: bytes,
) -> tuple[bytes, bool]:
    promoted = promotion_is_supported(
        evidence,
        baseline_spec,
        baseline_bytes,
        candidate,
        candidate_bytes,
    )
    return (candidate_bytes if promoted else baseline_bytes), promoted
