from __future__ import annotations

from copy import deepcopy

import pytest

from data.build_recommendation_data import (
    F_TEAM_SKILL_TRIPLE,
    InvalidBattleError,
    _validated_bonds,
    compute_support,
    select_features,
    team_features,
    Battle,
)


def hero(name: str, *skills: str) -> dict:
    return {"name": name, "skills": [f"sig-{name}", *skills]}


CATALOG = {
    "hero_camp": {"甲": "吴", "乙": "吴", "丙": "蜀", "丁": "吴"},
    "bonds": [
        {"name": "二人缘", "required_members": 2, "members": ["乙", "甲"]},
        {"name": "三人缘", "required_members": 3, "members": ["丙", "乙", "甲"]},
    ],
    "skill_mechanics": {
        "自循环": {"provides": ["火攻"], "benefitsFrom": ["火攻"]},
        "供火": {"provides": ["火攻"], "benefitsFrom": []},
        "受火": {"provides": [], "benefitsFrom": ["火攻"]},
        "sig-甲": {"provides": [], "benefitsFrom": ["火攻"]},
    },
}
DEFAULTS = {name: f"sig-{name}" for name in ("甲", "乙", "丙", "丁")}


def features(team):
    return team_features(team, DEFAULTS, CATALOG)


def test_ths_fires_regardless_of_carrier_and_tsp_crosses_carriers():
    first = features([hero("甲", "烈火", "甲技"), hero("乙", "乙技1", "乙技2"), hero("丙", "丙技1", "丙技2")])
    moved = features([hero("甲", "甲技", "乙技1"), hero("乙", "烈火", "乙技2"), hero("丙", "丙技1", "丙技2")])
    assert "THS|甲|烈火" in first and "THS|甲|烈火" in moved
    assert "TSP|乙技2|烈火" in first and "TSP|乙技2|烈火" in moved
    assert {key for key in first if key.startswith(("THS|", "TSP|"))} == {
        key for key in moved if key.startswith(("THS|", "TSP|"))
    }
    assert {key for key in first if key.startswith(("HS|", "SP|"))} != {
        key for key in moved if key.startswith(("HS|", "SP|"))
    }


def test_exact_sorted_trio_camp_exclusivity_and_bonds():
    both = features([hero("丙"), hero("甲"), hero("乙")])
    assert "HT|丙|乙|甲" in both
    assert "HC|2" in both and "HC|3" not in both
    assert "B|二人缘" in both and "B|三人缘" in both
    all_same = features([hero("丁"), hero("甲"), hero("乙")])
    assert "HC|3" in all_same and "HC|2" not in all_same
    insufficient = features([hero("甲"), hero("丁"), hero("丙")])
    assert "B|二人缘" not in insufficient and "B|三人缘" not in insufficient
    assert not any(key.startswith(("HT|", "HC|", "B|")) for key in features([hero("甲"), hero("乙")]))


def test_ts3_emits_all_twenty_triples_and_never_ts4_plus():
    emitted = features([
        hero("甲", "一", "二"), hero("乙", "三", "四"), hero("丙", "五", "六")
    ])
    triples = [key for key in emitted if key.startswith("TS3|")]
    assert len(triples) == 20
    assert all(len(key.split("|")) == 4 for key in triples)
    assert not any(key.startswith(("TS4|", "TS5|", "TS6|")) for key in emitted)


def test_mech_requires_an_external_same_team_instance_and_signatures_participate():
    self_only = features([hero("甲"), hero("乙"), hero("丙")])
    assert "MX|火攻" not in self_only and "HMX|甲|火攻" not in self_only
    external = features([hero("甲"), hero("乙", "供火"), hero("丙")])
    assert "MX|火攻" in external and "HMX|甲|火攻" in external
    signature_beneficiary = features([hero("甲"), hero("乙", "供火"), hero("丙")])
    assert "HMX|甲|火攻" in signature_beneficiary
    assert "S|sig-甲" not in signature_beneficiary and "HS|甲|sig-甲" not in signature_beneficiary


def test_cross_team_provider_never_matches():
    beneficiary = features([hero("甲", "受火"), hero("乙"), hero("丙")])
    provider = features([hero("丁", "供火"), hero("乙"), hero("丙")])
    assert "MX|火攻" not in beneficiary
    assert "MX|火攻" not in provider


def test_bond_catalog_contract_fails_closed():
    heroes = frozenset(("甲", "乙", "丙"))
    valid = {
        "缘": {"content": " 内容 ", "condition": "缘分关系2人在同一部队时激活效果", "members": ["乙", "甲"]}
    }
    assert _validated_bonds(valid, heroes)[0]["members"] == ["乙", "甲"]
    legacy = deepcopy(valid)
    legacy["缘"]["members"].append("旧将")
    assert _validated_bonds(legacy, heroes)[0]["members"] == ["乙", "旧将", "甲"]
    for bad in (
        {"缘": {"content": "x", "members": ["甲", "乙"]}},
        {"缘": {"content": "x", "condition": "缘分关系3人在同一部队时激活效果", "members": ["甲", "乙"]}},
        {"缘": {"content": "x", "condition": "缘分关系2人在同一部队时激活效果", "members": ["甲", "未知"]}},
    ):
        with pytest.raises(InvalidBattleError):
            _validated_bonds(bad, heroes)
    duplicate = deepcopy(valid)
    duplicate["重复"] = deepcopy(valid["缘"])
    with pytest.raises(InvalidBattleError, match="duplicates"):
        _validated_bonds(duplicate, heroes)


def test_family_specific_support_and_ts3_pair_prerequisite_are_literal():
    battles = [
        Battle(str(i), [hero("甲", "一", "二"), hero("乙", "三", "四"), hero("丙", "五", "六")], [hero("丁")], 1)
        for i in range(20)
    ]
    support = compute_support(battles, DEFAULTS, CATALOG)
    assert support["THS|甲|一"] == 20
    selected = select_features(
        support,
        min_support_context=20,
        min_support_high_order=20,
        enabled_families=("THS", "TSP", "HT", F_TEAM_SKILL_TRIPLE),
    )
    assert "THS|甲|一" in selected and any(key.startswith("TS3|") for key in selected)
    broken = dict(support)
    broken["TSP|一|二"] = 19
    selected_broken = select_features(
        broken,
        min_support_context=20,
        min_support_high_order=20,
        enabled_families=("TSP", F_TEAM_SKILL_TRIPLE),
    )
    assert "TS3|一|三|二" not in selected_broken
