"""Focused regression tests for production and evaluation MECH scoring."""
from __future__ import annotations

import copy
import json
import os
import sys
from pathlib import Path
from types import MappingProxyType

import numpy as np
import pytest

sys.path.insert(0, os.path.dirname(__file__))

import evaluate_recommendation_model as evaluator  # noqa: E402
import manage_mech_catalog as catalog_manager  # noqa: E402
from build_recommendation_data import (  # noqa: E402
    F_MECHANIC,
    MECHANIC_SHRINKAGE,
    MIN_MECHANIC_PAIR_DIVERSITY,
    MIN_SUPPORT_MECHANIC,
    PRODUCTION_MECH_CERTAINTY_MODE,
    _compute_scoring_version,
    PRODUCTION_ENABLED_FAMILIES,
    Battle,
    _CatalogSeasons,
    active_mechanic_skill_instances,
    apply_family_shrinkage,
    build_artifact,
    compute_mechanic_witness_pair_counts,
    compute_support,
    mechanic_feature_witnesses,
    select_features,
    team_features,
)
from mechanics_contract import (  # noqa: E402
    MechanicRelationship,
    MechanicsContract,
    load_mechanics_contract,
)

FIRE_FEATURE = "M|debuff:huo_gong|benefits_from|enemy"
FIRE = "debuff:huo_gong"


def _relation(
    relation: str,
    mechanic: str = FIRE,
    subject: str = "enemy",
    certainty: str = "explicit",
) -> MechanicRelationship:
    return MechanicRelationship(relation, mechanic, subject, certainty)


def _contract(
    relationships: dict[str, tuple[MechanicRelationship, ...]],
    *,
    mechanics: tuple[str, ...] = (FIRE,),
) -> MechanicsContract:
    return MechanicsContract(
        skill_relationships=MappingProxyType(dict(sorted(relationships.items()))),
        mechanic_ids=frozenset(mechanics),
        mechanic_names=MappingProxyType(
            {mechanic_id: mechanic_id for mechanic_id in mechanics}
        ),
        catalog_sha256="test-mech-catalog",
    )


def _hero(name: str, signature: str, first: str, second: str) -> dict[str, object]:
    return {"name": name, "skills": [signature, first, second]}


def _empty_contract_for(
    team: list[dict[str, object]],
    overrides: dict[str, tuple[MechanicRelationship, ...]],
    *,
    mechanics: tuple[str, ...] = (FIRE,),
) -> MechanicsContract:
    skills = {
        str(skill): ()
        for hero in team
        for skill in hero["skills"]
    }
    skills.update(overrides)
    return _contract(skills, mechanics=mechanics)


def _fire_team(carrier: str = "张昭") -> tuple[
    list[dict[str, object]], dict[str, str], MechanicsContract
]:
    equipped = {
        "陆逊": ("普通甲", "普通乙"),
        "张昭": ("普通丙", "普通丁"),
        "孙权": ("普通戊", "普通己"),
    }
    first, _ = equipped[carrier]
    equipped[carrier] = ("烈火张天", first)
    team = [
        _hero("陆逊", "OCR槽零错误", *equipped["陆逊"]),
        _hero("张昭", "OCR槽零错误", *equipped["张昭"]),
        _hero("孙权", "OCR槽零错误", *equipped["孙权"]),
    ]
    defaults = {"陆逊": "火烧连营", "张昭": "张昭签名", "孙权": "孙权签名"}
    contract = _empty_contract_for(
        team,
        {
            "火烧连营": (
                _relation("provides"),
                _relation("benefits_from"),
            ),
            "烈火张天": (_relation("provides"),),
            "张昭签名": (),
            "孙权签名": (),
        },
    )
    return team, defaults, contract


def _m_features(
    team: list[dict[str, object]],
    defaults: dict[str, str],
    contract: MechanicsContract,
    *,
    concrete_team: bool = True,
    certainty_mode: str = "explicit_only",
) -> dict[str, int]:
    return {
        feature_id: value
        for feature_id, value in team_features(
            team,
            defaults,
            concrete_team=concrete_team,
            mechanics=contract,
            mech_certainty_mode=certainty_mode,
        ).items()
        if feature_id.startswith("M|")
    }


def test_mech_is_production_enabled_with_reviewed_configuration() -> None:
    assert F_MECHANIC in PRODUCTION_ENABLED_FAMILIES
    assert PRODUCTION_MECH_CERTAINTY_MODE == "all_reviewed"
    assert MIN_SUPPORT_MECHANIC == 30
    assert MIN_MECHANIC_PAIR_DIVERSITY == 2
    assert MECHANIC_SHRINKAGE == 0.25


def test_lu_xun_and_distinct_liehuo_emit_fire_feature_for_any_carrier() -> None:
    for carrier in ("陆逊", "张昭", "孙权"):
        team, defaults, contract = _fire_team(carrier)
        witnesses = mechanic_feature_witnesses(team, defaults, contract)

        assert _m_features(team, defaults, contract)[FIRE_FEATURE] == 1
        assert any(
            witness.provider_skill == "烈火张天"
            and witness.provider_carrier == carrier
            and witness.consumer_skill == "火烧连营"
            and witness.consumer_origin == "signature"
            for witness in witnesses[FIRE_FEATURE]
        )


def test_zhang_zhao_and_liehuo_without_fire_consumer_do_not_emit() -> None:
    team = [
        _hero("张昭", "错", "烈火张天", "甲"),
        _hero("孙权", "错", "乙", "丙"),
        _hero("周瑜", "错", "丁", "戊"),
    ]
    defaults = {"张昭": "张昭签名", "孙权": "孙权签名", "周瑜": "周瑜签名"}
    contract = _empty_contract_for(
        team,
        {
            "烈火张天": (_relation("provides"),),
            "张昭签名": (),
            "孙权签名": (),
            "周瑜签名": (),
        },
    )

    assert FIRE_FEATURE not in _m_features(team, defaults, contract)


def test_fire_signature_cannot_satisfy_its_own_provider_consumer_loop() -> None:
    team, defaults, contract = _fire_team()
    for hero in team:
        hero["skills"] = [hero["skills"][0], "普通一", "普通二"]
    contract = _empty_contract_for(
        team,
        {
            "火烧连营": (_relation("provides"), _relation("benefits_from")),
            "张昭签名": (),
            "孙权签名": (),
        },
    )

    assert FIRE_FEATURE not in _m_features(team, defaults, contract)


def test_canonical_and_equipped_copy_are_distinct_mech_instances() -> None:
    mechanic = "debuff:yao_shu"
    feature_id = f"M|{mechanic}|benefits_from|enemy"
    team = [
        _hero("张宝", "妖风大作", "妖风大作", "普通甲"),
        _hero("甲", "甲签", "普通乙", "普通丙"),
        _hero("乙", "乙签", "普通丁", "普通戊"),
    ]
    defaults = {"张宝": "妖风大作", "甲": "甲签", "乙": "乙签"}
    contract = _empty_contract_for(
        team,
        {
            "妖风大作": (
                _relation("provides", mechanic),
                _relation("benefits_from", mechanic),
            ),
            "甲签": (),
            "乙签": (),
        },
        mechanics=(mechanic,),
    )

    instances = active_mechanic_skill_instances(team, defaults, contract)
    copies = [
        instance
        for instance in instances
        if instance.carrier == "张宝" and instance.skill_name == "妖风大作"
    ]
    witnesses = mechanic_feature_witnesses(team, defaults, contract)[feature_id]

    assert [(instance.origin, instance.slot_index) for instance in copies] == [
        ("signature", 0),
        ("equipped", 1),
    ]
    assert {
        (witness.provider_slot_index, witness.consumer_slot_index)
        for witness in witnesses
        if witness.provider_carrier == witness.consumer_carrier == "张宝"
    } == {(0, 1), (1, 0)}


def test_repeated_equipped_names_retain_distinct_mech_slots() -> None:
    team = [
        _hero("甲", "甲签", "循环", "循环"),
        _hero("乙", "乙签", "普通甲", "普通乙"),
        _hero("丙", "丙签", "普通丙", "普通丁"),
    ]
    defaults = {"甲": "甲签", "乙": "乙签", "丙": "丙签"}
    contract = _empty_contract_for(
        team,
        {
            "甲签": (),
            "乙签": (),
            "丙签": (),
            "循环": (_relation("provides"), _relation("consumes")),
        },
    )
    feature_id = "M|debuff:huo_gong|consumes|enemy"

    witnesses = mechanic_feature_witnesses(team, defaults, contract)[feature_id]

    assert {
        (witness.provider_slot_index, witness.consumer_slot_index)
        for witness in witnesses
        if witness.provider_carrier == witness.consumer_carrier == "甲"
    } == {(1, 2), (2, 1)}


def test_signature_participates_only_in_mech_not_ordinary_tactic_families() -> None:
    team, defaults, contract = _fire_team()
    features = team_features(team, defaults, mechanics=contract)

    assert FIRE_FEATURE in features
    assert not any(
        feature_id == "S|火烧连营"
        or feature_id.startswith("HS|") and feature_id.endswith("|火烧连营")
        or feature_id.startswith("SP|") and "火烧连营" in feature_id.split("|")
        or feature_id.startswith("THS|") and feature_id.endswith("|火烧连营")
        or feature_id.startswith("TSP|") and "火烧连营" in feature_id.split("|")
        or feature_id.startswith("TS3|") and "火烧连营" in feature_id.split("|")
        for feature_id in features
    )


def test_partial_non_concrete_and_cross_team_collections_emit_no_mech() -> None:
    fire_team, defaults, contract = _fire_team()
    provider_team = copy.deepcopy(fire_team)
    provider_team[0] = _hero("周瑜", "错", "普通庚", "普通辛")
    consumer_team = copy.deepcopy(fire_team)
    for hero in consumer_team:
        hero["skills"] = [hero["skills"][0], "普通一", "普通二"]
    defaults["周瑜"] = "周瑜签名"
    relationships = dict(contract.skill_relationships)
    relationships.update(
        {
            "周瑜签名": (),
            "普通庚": (),
            "普通辛": (),
            "普通一": (),
            "普通二": (),
        }
    )
    contract = _contract(relationships)

    assert not _m_features(fire_team[:2], defaults, contract)
    assert not _m_features(fire_team, defaults, contract, concrete_team=False)
    assert FIRE_FEATURE not in _m_features(provider_team, defaults, contract)
    assert FIRE_FEATURE not in _m_features(consumer_team, defaults, contract)
    assert not _m_features(
        [*provider_team, *consumer_team],
        defaults,
        contract,
        concrete_team=False,
    )


def test_exact_mechanic_ids_are_required_without_parent_inference() -> None:
    team = [
        _hero("甲", "错", "火攻提供", "空一"),
        _hero("乙", "错", "异常消费", "空二"),
        _hero("丙", "错", "空三", "空四"),
    ]
    defaults = {"甲": "甲签", "乙": "乙签", "丙": "丙签"}
    contract = _empty_contract_for(
        team,
        {
            "甲签": (),
            "乙签": (),
            "丙签": (),
            "火攻提供": (_relation("provides", "debuff:huo_gong"),),
            "异常消费": (
                _relation("benefits_from", "debuff:yi_chang_zhuang_tai"),
            ),
        },
        mechanics=("debuff:huo_gong", "debuff:yi_chang_zhuang_tai"),
    )

    assert not _m_features(team, defaults, contract)


def test_subject_compatible_relationships_match_on_friendly_side() -> None:
    team = [
        _hero("甲", "错", "提供", "消费"),
        _hero("乙", "错", "空一", "空二"),
        _hero("丙", "错", "空三", "空四"),
    ]
    defaults = {"甲": "甲签", "乙": "乙签", "丙": "丙签"}
    contract = _empty_contract_for(
        team,
        {
            "甲签": (),
            "乙签": (),
            "丙签": (),
            "提供": (_relation("provides", subject="self"),),
            "消费": (_relation("requires", subject="team"),),
        },
    )

    assert "M|debuff:huo_gong|requires|friendly" in _m_features(
        team, defaults, contract
    )


@pytest.mark.parametrize("consumer_subject", ["self", "unknown"])
def test_subject_incompatible_or_unknown_relationships_do_not_match(
    consumer_subject: str,
) -> None:
    team = [
        _hero("甲", "错", "提供", "空一"),
        _hero("乙", "错", "消费", "空二"),
        _hero("丙", "错", "空三", "空四"),
    ]
    defaults = {"甲": "甲签", "乙": "乙签", "丙": "丙签"}
    contract = _empty_contract_for(
        team,
        {
            "甲签": (),
            "乙签": (),
            "丙签": (),
            "提供": (_relation("provides", subject="self"),),
            "消费": (_relation("benefits_from", subject=consumer_subject),),
        },
    )

    assert not _m_features(team, defaults, contract)


def test_certainty_modes_bound_reviewed_inferred_relationships() -> None:
    team, defaults, base = _fire_team()
    relationships = dict(base.skill_relationships)
    relationships["烈火张天"] = (_relation("provides", certainty="inferred"),)
    contract = _contract(relationships)

    assert FIRE_FEATURE not in _m_features(team, defaults, contract)
    assert FIRE_FEATURE in _m_features(
        team,
        defaults,
        contract,
        certainty_mode="all_reviewed",
    )


@pytest.mark.parametrize("relation_name", ["removes", "prevents"])
def test_removes_and_prevents_never_create_pr_a_features(
    relation_name: str,
) -> None:
    team, defaults, base = _fire_team()
    relationships = dict(base.skill_relationships)
    relationships["火烧连营"] = (_relation("provides"),)
    relationships["烈火张天"] = (
        _relation("provides"),
        _relation(relation_name),
    )
    contract = _contract(relationships)

    assert not _m_features(team, defaults, contract)


def test_binary_presence_ignores_duplicate_witness_magnitude() -> None:
    team, defaults, base = _fire_team()
    team[2]["skills"][1] = "第二提供"
    relationships = dict(base.skill_relationships)
    relationships["第二提供"] = (_relation("provides"),)
    contract = _contract(relationships)

    features = team_features(team, defaults, mechanics=contract)
    witnesses = mechanic_feature_witnesses(team, defaults, contract)

    assert features[FIRE_FEATURE] == 1
    assert len(witnesses[FIRE_FEATURE]) == 2


def test_support_counts_a_mech_feature_once_per_battle() -> None:
    team, defaults, contract = _fire_team()
    battle = Battle("mirror.json", team, copy.deepcopy(team), 1)

    support = compute_support(
        [battle],
        defaults,
        mechanics=contract,
    )

    assert support[FIRE_FEATURE] == 1


def test_pair_diversity_is_ordered_and_uses_only_supplied_training_rows() -> None:
    team, defaults, base = _fire_team()
    first = Battle("first.json", team, [], 1)
    second_team = copy.deepcopy(team)
    second_team[1]["skills"][1] = "第二提供"
    relationships = dict(base.skill_relationships)
    relationships["第二提供"] = (_relation("provides"),)
    contract = _contract(relationships)
    second = Battle("held-out.json", second_team, [], 1)

    training_only = compute_mechanic_witness_pair_counts(
        [first], defaults, contract
    )
    with_held_out = compute_mechanic_witness_pair_counts(
        [first, second], defaults, contract
    )

    assert set(training_only[FIRE_FEATURE]) == {("烈火张天", "火烧连营")}
    assert set(with_held_out[FIRE_FEATURE]) == {
        ("烈火张天", "火烧连营"),
        ("第二提供", "火烧连营"),
    }


def test_single_pair_mech_feature_fails_diversity_floor() -> None:
    support = {FIRE_FEATURE: 30}

    assert FIRE_FEATURE not in select_features(
        support,
        enabled_families={F_MECHANIC},
        min_support_mechanic=12,
        min_mechanic_pair_diversity=2,
        mechanic_pair_diversity={FIRE_FEATURE: 1},
    )
    assert FIRE_FEATURE in select_features(
        support,
        enabled_families={F_MECHANIC},
        min_support_mechanic=12,
        min_mechanic_pair_diversity=2,
        mechanic_pair_diversity={FIRE_FEATURE: 2},
    )


def test_mech_shrinkage_applies_only_to_m() -> None:
    features = ["H|甲", FIRE_FEATURE, "HT|甲|乙|丙"]
    raw = np.asarray([2.0, 4.0, 6.0])

    adjusted = apply_family_shrinkage(
        features,
        raw,
        team_context_shrinkage=1.0,
        high_order_shrinkage=1.0,
        mechanic_shrinkage=0.25,
    )

    np.testing.assert_array_equal(adjusted, np.asarray([2.0, 1.0, 6.0]))


def test_optional_gate_rejects_mech_when_either_calibration_metric_regresses() -> None:
    reference = evaluator.EvaluationConfig(include_mech=False)
    enabled = evaluator.EvaluationConfig(include_mech=True)

    def rows(probabilities: list[float]) -> evaluator.PredictionRows:
        return evaluator.PredictionRows(
            outcomes=[1, 1, 0],
            probabilities=probabilities,
            baseline_probabilities=[0.5] * 3,
            group_ids=["a", "b", "c"],
            sources=["uploaded_by_me"] * 3,
            n_features=1,
            nonzero_rows=3,
            atomic_diagnostics={},
        )

    development = {
        reference: rows([0.7, 0.7, 0.3]),
        enabled: rows([0.99, 0.99, 0.6]),
    }

    assert evaluator._select_calibrated_optional_config(
        reference,
        [enabled],
        development.__getitem__,
    ) == reference


def _fit_corpus() -> tuple[
    list[Battle], dict[str, str], MechanicsContract, _CatalogSeasons
]:
    team, defaults, base = _fire_team()
    relationships = dict(base.skill_relationships)
    relationships["第二提供"] = (_relation("provides"),)
    contract = _contract(relationships)
    battles: list[Battle] = []
    for index in range(24):
        positive = copy.deepcopy(team)
        if index % 2:
            positive[1]["skills"][1] = "第二提供"
        negative = [
            _hero("曹操", "错", "普通一", "普通二"),
            _hero("荀彧", "错", "普通三", "普通四"),
            _hero("郭嘉", "错", "普通五", "普通六"),
        ]
        if index % 2:
            team1, team2, winner = negative, positive, 2
        else:
            team1, team2, winner = positive, negative, 1
        battles.append(Battle(f"{index:03d}.json", team1, team2, winner, season=1))
    defaults.update({"曹操": "曹操签", "荀彧": "荀彧签", "郭嘉": "郭嘉签"})
    all_skills = dict(contract.skill_relationships)
    all_skills.update({"曹操签": (), "荀彧签": (), "郭嘉签": ()})
    for battle in battles:
        for battle_team in (battle.team1, battle.team2):
            for hero in battle_team:
                for skill in hero["skills"][1:]:
                    all_skills.setdefault(str(skill), ())
    contract = _contract(all_skills)
    heroes = {
        str(hero["name"]): 1
        for battle in battles
        for battle_team in (battle.team1, battle.team2)
        for hero in battle_team
    }
    skills = {
        str(skill): 1
        for battle in battles
        for battle_team in (battle.team1, battle.team2)
        for hero in battle_team
        for skill in hero["skills"]
    }
    skills.update({signature: 1 for signature in defaults.values()})
    return battles, defaults, contract, _CatalogSeasons(heroes=heroes, skills=skills)


def test_production_artifact_applies_mech_support_and_diversity_thresholds() -> None:
    battles, defaults, contract, seasons = _fit_corpus()
    training = [*battles, *copy.deepcopy(battles)]
    artifact = build_artifact(
        training,
        [],
        {
            "catalog_version": "synthetic",
            "relationship_version": "abcdefabcdef",
            "hero_count": len(seasons.heroes),
            "skill_count": len(seasons.skills),
            "default_skill": defaults,
            "relationships": {"hero_camp": {}, "bonds": []},
        },
        catalog_seasons=seasons,
        mechanics=contract,
    )

    assert artifact["schema"]["version"] == 7
    assert artifact["model"]["min_support_mechanic"] == 30
    assert artifact["model"]["min_mechanic_pair_diversity"] == 2
    assert artifact["model"]["support"][FIRE_FEATURE] == 48
    assert FIRE_FEATURE in artifact["model"]["weights"]


def test_mechanics_contract_is_deterministic_and_disabled_path_is_unchanged() -> None:
    battles, defaults, contract, seasons = _fit_corpus()
    groups = tuple(f"group-{index}" for index in range(len(battles)))
    config = evaluator.EvaluationConfig(
        include_ths_tsp=False,
        include_hc_b=False,
        include_mech=True,
        min_support_mechanic=1,
        min_mechanic_pair_diversity=2,
        mechanic_shrinkage=0.5,
        include_ht=False,
        include_ts3=False,
    )
    first = evaluator._fit_and_predict(
        config,
        tuple(range(20)),
        tuple(range(20, 24)),
        battles,
        groups,
        defaults,
        seasons,
        None,
        contract,
    )
    second = evaluator._fit_and_predict(
        config,
        tuple(range(20)),
        tuple(range(20, 24)),
        battles,
        groups,
        defaults,
        seasons,
        None,
        contract,
    )
    disabled = evaluator.EvaluationConfig(
        include_ths_tsp=False,
        include_hc_b=False,
        include_mech=False,
        include_ht=False,
        include_ts3=False,
    )
    disabled_with_contract = evaluator._fit_and_predict(
        disabled,
        tuple(range(20)),
        tuple(range(20, 24)),
        battles,
        groups,
        defaults,
        seasons,
        None,
        contract,
    )
    disabled_without_contract = evaluator._fit_and_predict(
        disabled,
        tuple(range(20)),
        tuple(range(20, 24)),
        battles,
        groups,
        defaults,
        seasons,
        None,
        None,
    )

    assert first == second
    assert first.mechanic_diagnostics["selected_feature_count"] == 1
    assert disabled_with_contract == disabled_without_contract


def test_evaluator_does_not_use_held_out_rows_for_mech_pair_diversity() -> None:
    battles, defaults, contract, seasons = _fit_corpus()
    groups = tuple(f"group-{index}" for index in range(len(battles)))
    config = evaluator.EvaluationConfig(
        include_ths_tsp=False,
        include_hc_b=False,
        include_mech=True,
        min_support_mechanic=1,
        min_mechanic_pair_diversity=2,
        include_ht=False,
        include_ts3=False,
    )

    rows = evaluator._fit_and_predict(
        config,
        tuple(range(0, 20, 2)),  # only 烈火张天 -> 火烧连营
        tuple(range(1, 20, 2)),  # held out 第二提供 -> 火烧连营
        battles,
        groups,
        defaults,
        seasons,
        None,
        contract,
    )

    assert rows.mechanic_diagnostics["emitted_feature_count"] == 1
    assert rows.mechanic_diagnostics["diversity_qualified_feature_count"] == 0
    assert rows.mechanic_diagnostics["selected_feature_count"] == 0


def test_active_instances_use_canonical_signature_not_ocr_slot_zero() -> None:
    team, defaults, contract = _fire_team()
    instances = active_mechanic_skill_instances(team, defaults, contract)

    assert any(
        instance.carrier == "陆逊"
        and instance.skill_name == "火烧连营"
        and instance.origin == "signature"
        and instance.slot_index == 0
        for instance in instances
    )
    assert not any(instance.skill_name == "OCR槽零错误" for instance in instances)


def test_shared_python_typescript_mech_feature_parity_fixture() -> None:
    fixture = json.loads(
        Path("data/evaluation/mech_feature_parity.json").read_text(encoding="utf-8")
    )
    all_skills = {
        skill
        for case in fixture["cases"]
        for hero in case["team"]
        for skill in hero["equipped"]
    } | set(fixture["default_skill"].values())
    relationships = {
        skill: tuple(
            MechanicRelationship(
                relation=item["relation"],
                mechanic=item["mechanic"],
                subject=item["subject"],
                certainty="explicit",
            )
            for item in fixture["skills"].get(skill, [])
        )
        for skill in sorted(all_skills)
    }
    contract = MechanicsContract(
        skill_relationships=MappingProxyType(relationships),
        mechanic_ids=frozenset(fixture["mechanic_names"]),
        mechanic_names=MappingProxyType(fixture["mechanic_names"]),
        catalog_sha256="shared-parity-fixture",
    )

    for case in fixture["cases"]:
        team = [
            {
                "name": hero["name"],
                "skills": ["ignored OCR slot zero", *hero["equipped"]],
            }
            for hero in case["team"]
        ]
        emitted = sorted(
            feature_id
            for feature_id in team_features(
                team,
                fixture["default_skill"],
                mechanics=contract,
                mech_certainty_mode=fixture["certainty_mode"],
            )
            if feature_id.startswith("M|")
        )
        assert emitted == case["expected_m"], case["name"]


def test_minimal_scoring_contract_is_filtered_canonical_and_versioned() -> None:
    contract = _contract(
        {
            "consumer": (
                _relation("benefits_from"),
                _relation("prevents"),
            ),
            "provider": (
                _relation("provides", certainty="inferred"),
                _relation("removes"),
            ),
        }
    )

    explicit = contract.scoring_contract("explicit_only")
    reviewed = contract.scoring_contract("all_reviewed")

    assert explicit.semantic_dict()["skills"] == {
        "consumer": [
            {
                "relation": "benefits_from",
                "mechanic": FIRE,
                "subject": "enemy",
            }
        ]
    }
    assert reviewed.semantic_dict()["skills"] == {
        "consumer": [
            {
                "relation": "benefits_from",
                "mechanic": FIRE,
                "subject": "enemy",
            }
        ],
        "provider": [
            {
                "relation": "provides",
                "mechanic": FIRE,
                "subject": "enemy",
            }
        ],
    }
    assert explicit.mechanics_version != reviewed.mechanics_version
    assert len(reviewed.mechanics_version) == 12


def test_nonsemantic_catalog_metadata_does_not_change_mechanics_version() -> None:
    relationships = {
        "provider": (_relation("provides"),),
        "consumer": (_relation("benefits_from"),),
    }
    first = _contract(relationships)
    second = MechanicsContract(
        skill_relationships=first.skill_relationships,
        mechanic_ids=first.mechanic_ids,
        mechanic_names=first.mechanic_names,
        catalog_sha256="different-source-evidence-and-format-hash",
    )

    assert (
        first.scoring_contract("all_reviewed").mechanics_version
        == second.scoring_contract("all_reviewed").mechanics_version
    )


def test_scoring_version_tracks_mechanics_semantics() -> None:
    model = {
        "weights": {FIRE_FEATURE: 0.1},
        "support": {FIRE_FEATURE: 30},
        "l2_C": 0.05,
        "min_support_single": 5,
        "min_support_pair": 8,
        "min_support_team_context": 20,
        "min_support_relationship": 12,
        "min_support_high_order": 50,
        "min_support_mechanic": 30,
        "min_mechanic_pair_diversity": 2,
        "team_context_shrinkage": 0.5,
        "high_order_shrinkage": 0.35,
        "mechanic_shrinkage": 0.25,
        "mech_certainty_mode": "all_reviewed",
        "enabled_families": ["M"],
        "selection_prior": {},
    }
    first_contract = _contract(
        {"provider": (_relation("provides"),), "consumer": (_relation("benefits_from"),)}
    ).scoring_contract("all_reviewed")
    changed_contract = _contract(
        {
            "provider": (_relation("provides", subject="any"),),
            "consumer": (_relation("benefits_from"),),
        }
    ).scoring_contract("all_reviewed")
    base_catalog = {
        "default_skill": {"A": "provider"},
        "relationship_version": "abcdefabcdef",
    }
    first_catalog = {
        **base_catalog,
        "mechanics_version": first_contract.mechanics_version,
        "mechanics": first_contract.semantic_dict(),
    }
    changed_catalog = {
        **base_catalog,
        "mechanics_version": changed_contract.mechanics_version,
        "mechanics": changed_contract.semantic_dict(),
    }

    assert _compute_scoring_version(first_catalog, model) != _compute_scoring_version(
        changed_catalog, model
    )


def test_committed_production_artifact_contains_only_minimal_mechanics() -> None:
    artifact = json.loads(
        Path("web/src/recommendation_data.json").read_text(encoding="utf-8")
    )
    mechanics = load_mechanics_contract()
    scoring = mechanics.scoring_contract("all_reviewed")

    assert artifact["schema"]["version"] == 7
    assert artifact["catalog"]["mechanics"] == scoring.semantic_dict()
    assert artifact["catalog"]["mechanics_version"] == scoring.mechanics_version
    assert artifact["model"]["scoring_version"] == _compute_scoring_version(
        artifact["catalog"], artifact["model"]
    )
    assert "M" in artifact["model"]["enabled_families"]
    assert any(feature.startswith("M|") for feature in artifact["model"]["weights"])
    serialized_contract = json.dumps(artifact["catalog"]["mechanics"], ensure_ascii=False)
    for forbidden in ("evidence", "reason", "source_hash", "unresolved", "removes", "prevents"):
        assert forbidden not in serialized_contract


def test_training_loader_rejects_unresolved_catalog(tmp_path: Path) -> None:
    database = {
        "skills": {
            "甲": {"type": "主动", "prob": 100, "desc": "施加火攻"},
        },
        "buffs": {},
        "debuffs": {
            "huo_gong": {"name": "火攻"},
        },
    }
    catalog = catalog_manager.new_catalog(database)
    catalog["skills"]["甲"].update(
        {
            "extraction_status": "complete",
            "unresolved": [
                {"name": "火攻", "evidence": "火攻", "reason": "review pending"}
            ],
        }
    )
    database_path = tmp_path / "database.json"
    catalog_path = tmp_path / "mech.json"
    database_path.write_text(json.dumps(database, ensure_ascii=False), encoding="utf-8")
    catalog_path.write_bytes(catalog_manager.rendered_catalog(catalog))

    with pytest.raises(
        catalog_manager.CatalogError,
        match="zero unresolved entries",
    ):
        load_mechanics_contract(database_path, catalog_path)
