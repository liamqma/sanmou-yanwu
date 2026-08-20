from __future__ import annotations

from data.skill_description_tokenizer import (
    audit_unknown_status_terms,
    normalize_description,
    parse_status_events,
    tokenize_description,
)


STATUS_METADATA = {
    "连击": {"family": "buff", "negative": False, "controlling": False},
    "倒戈": {"family": "buff", "negative": False, "controlling": False},
    "火攻": {"family": "debuff", "negative": True, "controlling": False},
    "缴械": {"family": "debuff", "negative": True, "controlling": True},
    "会心": {"family": "buff", "negative": False, "controlling": False},
}


def roles(description: str) -> set[tuple[str, str]]:
    tokens = tokenize_description(description, STATUS_METADATA)
    return {
        (event.role, event.status)
        for event in parse_status_events(tokens, STATUS_METADATA)
    }


def test_normalization_preserves_offsets_for_full_width_variants():
    source = "提升４５％连击率，持续２回合"
    normalized = normalize_description(source)
    tokens = tokenize_description(source, STATUS_METADATA)

    assert normalized == "提升45%连击率,持续2回合"
    status = next(token for token in tokens if token.kind == "STATUS")
    assert source[status.start : status.end] == "连击"


def test_tokenizes_and_binds_wunan_status_providers():
    description = "提升两名队友45%连击率和20%倒戈，持续2回合"
    tokens = tokenize_description(description, STATUS_METADATA)

    assert [(token.kind, token.value) for token in tokens if token.kind in {"STATUS", "PERCENT"}] == [
        ("PERCENT", 0.45),
        ("STATUS", "连击"),
        ("PERCENT", 0.2),
        ("STATUS", "倒戈"),
    ]
    assert ("provides", "连击") in roles(description)
    assert ("provides", "倒戈") in roles(description)


def test_distinguishes_provider_consumer_counter_and_negated_reference():
    assert ("provides", "火攻") in roles("对敌军全体施加火攻，持续2回合")
    assert ("consumes", "火攻") in roles("若目标已持有火攻状态，则伤害提升")
    assert ("counters", "缴械") in roles("该次普通攻击无视缴械状态")
    negated = roles("该伤害无法触发会心")
    assert ("provides", "会心") not in negated
    assert ("references", "会心") in negated


def test_condition_and_provider_mentions_in_one_clause_bind_separately():
    parsed = roles("未持有火攻的敌人施加火攻，持续2回合")
    assert ("consumes", "火攻") in parsed
    assert ("provides", "火攻") in parsed


def test_direct_and_caused_debuffs_are_providers():
    assert ("provides", "缴械") in roles("若目标武力较高，则造成缴械，持续1回合")
    assert ("provides", "缴械") in roles("缴械自身2回合")


def test_preserves_status_recipient_scope_and_excludes_immunity_providers():
    self_events = parse_status_events(
        tokenize_description("自身获得缴械，持续2回合", STATUS_METADATA),
        STATUS_METADATA,
    )
    enemy_events = parse_status_events(
        tokenize_description("对敌军全体施加缴械，持续1回合", STATUS_METADATA),
        STATUS_METADATA,
    )
    immunity_events = parse_status_events(
        tokenize_description("自身免疫缴械状态", STATUS_METADATA),
        STATUS_METADATA,
    )

    assert any(
        event.role == "provides"
        and event.status == "缴械"
        and event.recipient_scope == "self"
        for event in self_events
    )
    assert any(
        event.role == "provides"
        and event.status == "缴械"
        and event.recipient_scope == "enemy"
        for event in enemy_events
    )
    assert any(event.role == "immunities" for event in immunity_events)
    assert all(event.role != "provides" for event in immunity_events)


def test_passive_apply_triggers_are_consumers_not_providers():
    for description, status in (
        ("敌军被施加负面状态时，造成伤害", "负面状态"),
        ("我军对敌军施加缴械时，恢复兵力", "缴械"),
        ("受自带战法施加的属性降低状态后，恢复兵力", "属性降低状态"),
    ):
        metadata = {
            **STATUS_METADATA,
            "负面状态": {
                "family": "status_class",
                "negative": True,
                "controlling": False,
            },
            "属性降低状态": {
                "family": "status_class",
                "negative": True,
                "controlling": False,
            },
        }
        events = parse_status_events(
            tokenize_description(description, metadata),
            metadata,
        )
        assert any(event.role == "consumes" and event.status == status for event in events)
        assert all(
            event.role != "provides" or event.status != status
            for event in events
        )


def test_status_recipient_uses_effect_target_instead_of_clause_actor():
    metadata = {
        **STATUS_METADATA,
        "流血": {"family": "debuff", "negative": True, "controlling": False},
    }
    events = parse_status_events(
        tokenize_description(
            "自身对目标造成兵刃伤害,并有30%概率施加1层流血",
            metadata,
        ),
        metadata,
    )

    providers = [
        event for event in events if event.role == "provides" and event.status == "流血"
    ]
    assert {event.recipient_scope for event in providers} == {"enemy"}
    assert {event.conditional_probability for event in providers} == {0.3}


def test_preserves_multiple_inherited_scopes_and_event_probability():
    metadata = {
        **STATUS_METADATA,
        "混乱": {"family": "debuff", "negative": True, "controlling": True},
        "抵御": {"family": "buff", "negative": False, "controlling": False},
    }
    mixed = parse_status_events(
        tokenize_description(
            "有90%概率对敌军随机单体和一名队友施加混乱,持续2回合",
            metadata,
        ),
        metadata,
    )
    inherited = parse_status_events(
        tokenize_description("恢复我军全体兵力,并施加1层抵御", metadata),
        metadata,
    )

    mixed_providers = [
        event for event in mixed if event.role == "provides" and event.status == "混乱"
    ]
    assert {event.recipient_scope for event in mixed_providers} == {"ally", "enemy"}
    assert {event.conditional_probability for event in mixed_providers} == {0.9}
    assert len({event.event_id for event in mixed_providers}) == 1
    assert any(
        event.role == "provides"
        and event.status == "抵御"
        and event.recipient_scope == "team"
        for event in inherited
    )


def test_unknown_status_audit_is_contextual_instead_of_grabbing_whole_clauses():
    known = tuple(STATUS_METADATA)
    assert audit_unknown_status_terms("对目标施加天火状态，持续2回合", known) == ("天火",)
    assert audit_unknown_status_terms("若目标已持有火攻状态", known) == ()


def test_unknown_status_audit_covers_trigger_actions():
    known = tuple(STATUS_METADATA)

    assert audit_unknown_status_terms("成功触发天火", known) == ("天火",)
    assert audit_unknown_status_terms("必定触发会心和奇谋", (*known, "奇谋")) == ()
