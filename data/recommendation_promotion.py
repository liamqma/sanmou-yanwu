from __future__ import annotations

import copy
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping

try:
    from recommendation_evaluation import EVALUATION_PROTOCOL_VERSION
except ModuleNotFoundError:
    from .recommendation_evaluation import EVALUATION_PROTOCOL_VERSION

BASELINE_SPEC_PATH = "data/evaluation/production-baseline.json"
PROMOTION_EVIDENCE_PATH = "data/evaluation/recommendation-promotion.json"
COMPARISON_POLICY = "algorithm_configuration_refit_on_identical_non_test_population"
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


def _source_identity(paths: tuple[str, ...]) -> dict[str, str]:
    root = Path(__file__).resolve().parent
    return {path: sha256_bytes((root / path).read_bytes()) for path in paths}


def builder_source_identity() -> dict[str, str]:
    return _source_identity(
        (
            "build_recommendation_data.py",
            "skill_description_tokenizer.py",
            "skill_mechanics.py",
        )
    )


def evaluation_contract_identity() -> dict[str, Any]:
    return {
        "comparison_policy": COMPARISON_POLICY,
        "evaluation_protocol_version": EVALUATION_PROTOCOL_VERSION,
        "source": _source_identity(
            (
                "evaluate_recommendation_model.py",
                "recommendation_evaluation.py",
            )
        ),
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


def approved_contract(evidence: Mapping[str, Any]) -> dict[str, Any]:
    algorithm = evidence.get("candidate_algorithm")
    evaluation = evidence.get("evaluation_contract")
    if not isinstance(algorithm, Mapping) or not isinstance(evaluation, Mapping):
        raise ValueError("promotion evidence has no approved algorithm contract")
    return {
        "candidate_algorithm": dict(algorithm),
        "evaluation_contract": dict(evaluation),
    }


def _interval_supports_promotion(evidence: Mapping[str, Any]) -> bool:
    intervals = (
        evidence.get("locked_test", {})
        .get("candidate_minus_baseline", {})
        .get("confidence_intervals_95", {})
    )
    accuracy = intervals.get("accuracy")
    brier = intervals.get("brier")
    log_loss = intervals.get("log_loss")
    return bool(
        isinstance(accuracy, Mapping)
        and isinstance(brier, Mapping)
        and isinstance(log_loss, Mapping)
        and accuracy.get("low", 0) > 0
        and brier.get("high", 0) < 0
        and log_loss.get("high", 0) < 0
    )


def promotion_is_supported(
    evidence: Mapping[str, Any],
    baseline_spec: Mapping[str, Any],
    baseline_bytes: bytes,
    candidate: Mapping[str, Any],
    candidate_bytes: bytes,
) -> bool:
    candidate_identity(candidate, candidate_bytes)
    gate = evidence.get("promotion_gate", {})
    final_artifact = evidence.get("final_production_artifact", {})
    return bool(
        evidence.get("schema_version") == 4
        and evidence.get("comparison_policy") == COMPARISON_POLICY
        and gate.get("supported") is True
        and gate.get("conclusion")
        == "candidate_improvement_supported_on_all_three_metrics"
        and _interval_supports_promotion(evidence)
        and evidence.get("baseline", {}).get("specification_sha256")
        == mapping_identity(baseline_spec)
        and evidence.get("baseline", {}).get("fallback_artifact_sha256")
        == sha256_bytes(baseline_bytes)
        and evidence.get("candidate_algorithm")
        == candidate_algorithm_identity(candidate)
        and evidence.get("evaluation_contract") == evaluation_contract_identity()
        and final_artifact.get("selection") == "candidate"
        and isinstance(final_artifact.get("sha256"), str)
        and len(final_artifact["sha256"]) == 64
    )


def _artifact_contract_matches(
    artifact: Mapping[str, Any],
    contract: Mapping[str, Any],
) -> bool:
    algorithm = contract.get("candidate_algorithm", {})
    model = artifact.get("model", {})
    families = sorted(artifact.get("schema", {}).get("feature_families", {}))
    configuration = algorithm.get("configuration", {})
    mechanics_schema = (model.get("mechanics", {}) or {}).get("schema_version")
    return bool(
        families == algorithm.get("feature_families")
        and artifact.get("catalog", {}).get("mechanics_version")
        == algorithm.get("mechanics_version")
        and mechanics_schema == algorithm.get("mechanics_schema_version")
        and model.get("l2_C") == configuration.get("C")
        and model.get("min_support_single")
        == configuration.get("min_support_single")
        and model.get("min_support_pair") == configuration.get("min_support_pair")
        and model.get("popularity_penalty_gamma")
        == configuration.get("popularity_penalty_gamma")
        and model.get("popularity_exposure_tau")
        == configuration.get("popularity_exposure_tau")
        and ("SP" in families) == configuration.get("include_sp")
        and ("M" in families)
        == configuration.get("include_semantic_mechanics")
    )


def approved_production_artifact(
    artifact_bytes: bytes | None,
) -> tuple[dict[str, Any], dict[str, Any]] | None:
    if artifact_bytes is None:
        return None
    try:
        artifact = json.loads(artifact_bytes)
        if not isinstance(artifact, dict):
            return None
        lineage = artifact.get("production_lineage")
        if not isinstance(lineage, dict) or lineage.get("schema_version") != 1:
            return None
        contract = lineage.get("approved_contract")
        if not isinstance(contract, dict):
            return None
        if lineage.get("approved_contract_sha256") != mapping_identity(contract):
            return None
        if lineage.get("model_payload_sha256") != mapping_identity(
            artifact.get("model", {})
        ):
            return None
        if lineage.get("corpus_version") != artifact.get("battle_counts", {}).get(
            "corpus_version"
        ):
            return None
        if not _artifact_contract_matches(artifact, contract):
            return None
        return artifact, lineage
    except (TypeError, ValueError, json.JSONDecodeError):
        return None


def latest_approved_or_baseline(
    current_production_bytes: bytes | None,
    baseline_bytes: bytes,
) -> bytes:
    return (
        current_production_bytes
        if approved_production_artifact(current_production_bytes) is not None
        else baseline_bytes
    )


def production_candidate_bytes(
    evidence: Mapping[str, Any],
    candidate: Mapping[str, Any],
    parent_bytes: bytes,
) -> bytes:
    artifact = copy.deepcopy(dict(candidate))
    artifact.pop("production_lineage", None)
    contract = approved_contract(evidence)
    artifact["production_lineage"] = {
        "schema_version": 1,
        "approved_contract": contract,
        "approved_contract_sha256": mapping_identity(contract),
        "approval_evaluation_corpus_version": evidence.get(
            "evaluation_context", {}
        ).get("corpus_version"),
        "approval_locked_test_group_set_hash": evidence.get(
            "evaluation_context", {}
        ).get("locked_test_group_set_hash"),
        "corpus_version": artifact.get("battle_counts", {}).get("corpus_version"),
        "model_payload_sha256": mapping_identity(artifact.get("model", {})),
        "parent_artifact_sha256": sha256_bytes(parent_bytes),
        "refit": (
            "corpus_update"
            if approved_production_artifact(parent_bytes) is not None
            else "initial_promotion"
        ),
    }
    return (
        json.dumps(
            artifact,
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("utf-8")


def select_production_bytes(
    evidence: Mapping[str, Any],
    baseline_spec: Mapping[str, Any],
    baseline_bytes: bytes,
    candidate: Mapping[str, Any],
    candidate_bytes: bytes,
    current_production_bytes: bytes | None = None,
) -> tuple[bytes, bool]:
    fallback = latest_approved_or_baseline(current_production_bytes, baseline_bytes)
    if not promotion_is_supported(
        evidence,
        baseline_spec,
        baseline_bytes,
        candidate,
        candidate_bytes,
    ):
        return fallback, False

    current = approved_production_artifact(current_production_bytes)
    contract_hash = mapping_identity(approved_contract(evidence))
    candidate_model_hash = mapping_identity(candidate.get("model", {}))
    candidate_corpus = candidate.get("battle_counts", {}).get("corpus_version")
    if current is not None:
        _artifact, lineage = current
        if (
            lineage.get("approved_contract_sha256") == contract_hash
            and lineage.get("model_payload_sha256") == candidate_model_hash
            and lineage.get("corpus_version") == candidate_corpus
        ):
            return current_production_bytes or fallback, True

    selected = production_candidate_bytes(evidence, candidate, fallback)
    if current is None and sha256_bytes(selected) != evidence.get(
        "final_production_artifact", {}
    ).get("sha256"):
        return fallback, False
    return selected, True
