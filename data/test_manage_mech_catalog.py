import copy
import json
from collections.abc import Callable
from pathlib import Path

import pytest

import manage_mech_catalog as mech


def database() -> dict:
    return {
        "skills": {
            "甲": {
                "type": "主动",
                "prob": 50,
                "desc": "对敌军施加火攻，并使自身获得1层抵御",
                "ranking": "S",
                "category": "谋略",
                "season": 1,
                "color": "orange",
                "damageEstimate": 100,
            },
            "乙": {
                "type": "指挥",
                "prob": 100,
                "desc": "恢复兵力",
                "ranking": "A",
            },
        },
        "buffs": {
            "di_yu": {
                "name": "抵御",
                "effect": "受到伤害时降低该次伤害",
                "functional": True,
            }
        },
        "debuffs": {
            "huo_gong": {
                "name": "火攻",
                "effect": "智力降低15点",
                "negative": True,
                "controlling": False,
            }
        },
    }


def complete_catalog(db: dict | None = None) -> dict:
    db = db or database()
    catalog = mech.new_catalog(db)
    for entry in catalog["skills"].values():
        entry["extraction_status"] = "complete"
    return catalog


def explicit_relation(**overrides: object) -> dict:
    relation = {
        "relation": "provides",
        "mechanic": "debuff:huo_gong",
        "subject": "enemy",
        "certainty": "explicit",
        "evidence": "施加火攻",
    }
    relation.update(overrides)
    return relation


def test_bootstrap_creates_deterministic_pending_entries() -> None:
    db = database()
    first = mech.bootstrap_catalog(db, None)
    second = mech.bootstrap_catalog(db, None)

    assert first == second
    assert list(first["skills"]) == ["乙", "甲"]
    assert {entry["extraction_status"] for entry in first["skills"].values()} == {
        "pending"
    }
    assert first["mechanics"] == {
        "buff:di_yu": {"kind": "buff", "source_key": "di_yu", "name": "抵御"},
        "debuff:huo_gong": {
            "kind": "debuff",
            "source_key": "huo_gong",
            "name": "火攻",
        },
    }


def test_bootstrap_preserves_current_extraction_and_removes_deleted_entries() -> None:
    db = database()
    existing = complete_catalog(db)
    existing["skills"]["甲"]["relations"] = [explicit_relation()]
    existing["skills"]["已删除"] = copy.deepcopy(existing["skills"]["乙"])

    result = mech.bootstrap_catalog(db, existing)

    assert set(result["skills"]) == set(db["skills"])
    assert result["skills"]["甲"]["relations"] == [explicit_relation()]


def test_bootstrap_requires_review_after_mechanics_registry_changes() -> None:
    db = database()
    existing = complete_catalog(db)
    existing["skills"]["甲"]["relations"] = [explicit_relation()]
    changed = copy.deepcopy(db)
    changed["debuffs"]["huo_gong"]["effect"] += "。"

    result = mech.bootstrap_catalog(changed, existing)
    status = mech.catalog_status(changed, result)

    assert result["skills"]["甲"]["relations"] == [explicit_relation()]
    assert status.pending_skills == ("乙", "甲")
    assert not status.mechanics_registry_stale
    assert status.update_required
    with pytest.raises(mech.CatalogError, match="is pending"):
        mech.validate_catalog(result, changed)


@pytest.mark.parametrize("loader", [mech.load_database, mech.load_catalog])
def test_json_loaders_reject_duplicate_object_keys(
    loader: Callable[[Path], dict], tmp_path: Path
) -> None:
    path = tmp_path / "duplicate.json"
    path.write_text('{"skills":{"甲":{},"甲":{}}}', encoding="utf-8")

    with pytest.raises(mech.CatalogError, match="duplicate JSON object key: '甲'"):
        loader(path)


def test_exact_coverage_of_database_skills_is_required() -> None:
    db = database()
    catalog = complete_catalog(db)
    del catalog["skills"]["乙"]

    with pytest.raises(mech.CatalogError, match="coverage mismatch"):
        mech.validate_catalog(catalog, db)


def test_empty_complete_extraction_is_valid() -> None:
    mech.validate_catalog(complete_catalog(), database())


def test_changed_desc_makes_exactly_that_skill_stale() -> None:
    db = database()
    catalog = complete_catalog(db)
    changed = copy.deepcopy(db)
    changed["skills"]["甲"]["desc"] += "。"

    status = mech.catalog_status(changed, catalog)

    assert status.stale_skills == ("甲",)
    assert status.current_skills == ("乙",)


@pytest.mark.parametrize(("field", "value"), [("type", "追击"), ("prob", 51)])
def test_changed_type_or_prob_makes_exactly_that_skill_stale(field: str, value: object) -> None:
    db = database()
    catalog = complete_catalog(db)
    changed = copy.deepcopy(db)
    changed["skills"]["甲"][field] = value

    status = mech.catalog_status(changed, catalog)

    assert status.stale_skills == ("甲",)
    assert status.current_skills == ("乙",)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("ranking", "D"),
        ("category", "辅助"),
        ("season", 9),
        ("color", "purple"),
        ("damageEstimate", 999),
    ],
)
def test_unrelated_skill_metadata_does_not_make_mech_stale(field: str, value: object) -> None:
    db = database()
    catalog = complete_catalog(db)
    changed = copy.deepcopy(db)
    changed["skills"]["甲"][field] = value

    status = mech.catalog_status(changed, catalog)

    assert status.stale_skills == ()
    assert status.current_skills == ("乙", "甲")


def test_buff_or_debuff_change_makes_registry_stale() -> None:
    db = database()
    catalog = complete_catalog(db)
    for section in ("buffs", "debuffs"):
        changed = copy.deepcopy(db)
        key = next(iter(changed[section]))
        changed[section][key]["effect"] += "。"
        assert mech.catalog_status(changed, catalog).mechanics_registry_stale


def test_unknown_skill_names_fail_closed_when_stamping() -> None:
    with pytest.raises(mech.CatalogError, match="unknown skill"):
        mech.stamp_catalog(complete_catalog(), database(), ["不存在"])


def test_removed_skill_entry_fails_validation() -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["已删除"] = copy.deepcopy(catalog["skills"]["乙"])

    with pytest.raises(mech.CatalogError, match="unknown_or_removed"):
        mech.validate_catalog(catalog, db)


def test_unknown_mechanic_id_fails() -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["甲"]["relations"] = [
        explicit_relation(mechanic="debuff:not_real")
    ]

    with pytest.raises(mech.CatalogError, match="mechanic is unknown"):
        mech.validate_catalog(catalog, db)


@pytest.mark.parametrize(
    ("field", "value", "message"),
    [
        ("relation", "interacts_with", "relation must be one of"),
        ("subject", "opponent", "subject must be one of"),
    ],
)
def test_invalid_relation_or_subject_fails(field: str, value: str, message: str) -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["甲"]["relations"] = [explicit_relation(**{field: value})]

    with pytest.raises(mech.CatalogError, match=message):
        mech.validate_catalog(catalog, db)


def test_duplicate_relationships_fail_even_with_different_evidence() -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["甲"]["relations"] = [
        explicit_relation(),
        explicit_relation(evidence="火攻"),
    ]

    with pytest.raises(mech.CatalogError, match="duplicate relationship"):
        mech.validate_catalog(catalog, db)


def test_evidence_must_be_exact_description_substring() -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["甲"]["relations"] = [
        explicit_relation(evidence="施加 火攻")
    ]

    with pytest.raises(mech.CatalogError, match="exact description substring"):
        mech.validate_catalog(catalog, db)


def test_inferred_relationship_requires_reason() -> None:
    db = database()
    catalog = complete_catalog(db)
    relation = explicit_relation(certainty="inferred")
    catalog["skills"]["甲"]["relations"] = [relation]

    with pytest.raises(mech.CatalogError, match=r"missing=\['reason'\]"):
        mech.validate_catalog(catalog, db)

    relation["reason"] = "火攻 is explicitly named as an applied state"
    mech.validate_catalog(catalog, db)


def test_unresolved_entries_are_allowed_and_reported() -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["甲"]["unresolved"] = [
        {
            "name": "未知状态",
            "evidence": "获得1层抵御",
            "reason": "Test unresolved mapping",
        }
    ]

    unresolved = mech.validate_catalog(catalog, db)
    status = mech.catalog_status(db, catalog)

    assert unresolved == [("甲", "未知状态")]
    assert status.unresolved_mechanic_count == 1


def test_pending_entries_fail_final_validation() -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["乙"]["extraction_status"] = "pending"

    with pytest.raises(mech.CatalogError, match="is pending"):
        mech.validate_catalog(catalog, db)


def test_stamp_requires_complete_structure_and_updates_only_named_hash() -> None:
    db = database()
    catalog = complete_catalog(db)
    catalog["skills"]["甲"]["source_hash"] = "0" * 64
    catalog["skills"]["乙"]["source_hash"] = "1" * 64

    stamped = mech.stamp_catalog(catalog, db, ["甲"])

    assert stamped["skills"]["甲"]["source_hash"] == mech.skill_source_hash(
        "甲", db["skills"]["甲"]
    )
    assert stamped["skills"]["乙"]["source_hash"] == "1" * 64

    catalog["skills"]["甲"]["extraction_status"] = "pending"
    with pytest.raises(mech.CatalogError, match="is pending"):
        mech.stamp_catalog(catalog, db, ["甲"])


def test_formatting_is_byte_idempotent_and_second_write_is_noop(tmp_path: Path) -> None:
    catalog = complete_catalog()
    catalog["skills"]["甲"]["relations"] = [
        explicit_relation(mechanic="buff:di_yu", subject="self", evidence="获得1层抵御"),
        explicit_relation(),
    ]
    rendered = mech.rendered_catalog(catalog)
    path = tmp_path / "mech.json"

    assert mech.atomic_write(path, rendered)
    assert not mech.atomic_write(path, rendered)
    assert path.read_bytes() == mech.rendered_catalog(json.loads(path.read_text()))


def test_status_output_is_deterministic() -> None:
    db = database()
    catalog = complete_catalog(db)
    first = mech.catalog_status(db, catalog)
    second = mech.catalog_status(copy.deepcopy(db), copy.deepcopy(catalog))

    assert first == second
    assert first.as_dict() == second.as_dict()
    assert mech._status_text(first) == mech._status_text(second)
    assert not first.update_required


def test_source_hash_uses_only_declared_fields() -> None:
    db = database()
    original = mech.skill_source_hash("甲", db["skills"]["甲"])
    changed = copy.deepcopy(db["skills"]["甲"])
    changed.update({"ranking": "D", "estimate": 10, "shadow": True})
    assert mech.skill_source_hash("甲", changed) == original


def test_real_mech_catalog_validates() -> None:
    db = mech.load_database()
    catalog = mech.load_catalog()
    mech.validate_catalog(catalog, db)
    assert set(catalog["skills"]) == set(db["skills"])


def test_reviewed_status_taxonomy_is_resolved() -> None:
    catalog = mech.load_catalog()

    assert all(not entry["unresolved"] for entry in catalog["skills"].values())
    assert {
        "buff:fu_bing",
        "buff:gong_neng_xing_zeng_yi_zhuang_tai",
        "debuff:du_shi",
        "debuff:fu_mian_zhuang_tai",
        "debuff:lian_huan",
        "debuff:yi_chang_zhuang_tai",
        "debuff:zhen_du",
    } <= set(catalog["mechanics"])
    assert {
        (item["relation"], item["mechanic"], item["subject"])
        for item in catalog["skills"]["临机制胜"]["relations"]
    } >= {("requires", "debuff:yi_chang_zhuang_tai", "any")}
    assert {
        (item["relation"], item["mechanic"])
        for item in catalog["skills"]["未雨绸缪"]["relations"]
    } >= {("benefits_from", "buff:gong_neng_xing_zeng_yi_zhuang_tai")}

    def identities(skill: str) -> set[tuple[str, str, str]]:
        return {
            (item["relation"], item["mechanic"], item["subject"])
            for item in catalog["skills"][skill]["relations"]
        }

    broad_relationships = {
        "出其不意": ("benefits_from", "enemy"),
        "定军扬威": ("benefits_from", "enemy"),
        "携民渡江": ("removes", "ally"),
        "横征暴敛": ("requires", "unknown"),
        "清风驱疾": ("removes", "ally"),
        "直谏固政": ("removes", "ally"),
        "纵马横枪": ("benefits_from", "enemy"),
        "谈笑诛心": ("requires", "enemy"),
        "青囊急救": ("removes", "ally"),
        "黄天当立": ("benefits_from", "enemy"),
    }
    for skill, (relation, subject) in broad_relationships.items():
        assert (
            relation,
            "debuff:fu_mian_zhuang_tai",
            subject,
        ) in identities(skill)
    assert ("consumes", "buff:fu_bing", "self") in identities("诱敌深入")
    assert not any(
        mechanic == "debuff:chuan_di_shang_hai"
        for _, mechanic, _ in identities("释权御下")
    )
    assert not catalog["skills"]["僭号天子"]["relations"]
    assert (
        "provides",
        "buff:gong_neng_xing_zeng_yi_zhuang_tai",
        "team",
    ) in identities("岿然不动")
    for skill in ("克敌如风", "权御九锡"):
        assert (
            "provides",
            "debuff:shu_xing_jiang_di_zhuang_tai",
            "enemy",
        ) in identities(skill)
    for skill in ("持军毅重", "蹈锋饮血", "划湘分荆"):
        assert (
            "provides",
            "debuff:chang_gui_fu_mian_zhuang_tai",
            "enemy",
        ) in identities(skill)


def test_reviewed_attribute_lowering_and_attack_prevention_are_complete() -> None:
    catalog = mech.load_catalog()

    def relationships(skill: str) -> set[tuple[str, str, str, str, str]]:
        return {
            (
                item["relation"],
                item["mechanic"],
                item["subject"],
                item["certainty"],
                item["evidence"],
            )
            for item in catalog["skills"][skill]["relations"]
        }

    assert (
        "provides",
        "debuff:shu_xing_jiang_di_zhuang_tai",
        "self",
        "inferred",
        "统率降低15点",
    ) in relationships("裸衣血战")
    assert (
        "prevents",
        "buff:hui_xin",
        "self",
        "explicit",
        "无法触发会心",
    ) in relationships("纵马横枪")


def test_reviewed_multi_target_immunity_preserves_each_subject() -> None:
    catalog = mech.load_catalog()

    relationships = {
        (
            item["relation"],
            item["mechanic"],
            item["subject"],
            item["certainty"],
            item["evidence"],
        )
        for item in catalog["skills"]["风急雨晦"]["relations"]
    }
    assert {
        ("prevents", "debuff:ji_qiong", "self", "explicit", "免疫技穷状态"),
        ("prevents", "debuff:ji_qiong", "ally", "explicit", "免疫技穷状态"),
    } <= relationships


def test_required_fire_relationships_are_present_and_correct() -> None:
    catalog = mech.load_catalog()

    def identities(skill: str) -> set[tuple[str, str]]:
        return {
            (item["relation"], item["mechanic"])
            for item in catalog["skills"][skill]["relations"]
        }

    assert ("provides", "debuff:huo_gong") in identities("烈火张天")
    assert {
        ("provides", "debuff:huo_gong"),
        ("benefits_from", "debuff:huo_gong"),
        ("provides", "debuff:fen_shao"),
    } <= identities("火烧连营")
