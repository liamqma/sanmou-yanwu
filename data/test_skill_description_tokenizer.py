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


def test_unknown_status_audit_is_contextual_instead_of_grabbing_whole_clauses():
    known = tuple(STATUS_METADATA)
    assert audit_unknown_status_terms("对目标施加天火状态，持续2回合", known) == ("天火",)
    assert audit_unknown_status_terms("若目标已持有火攻状态", known) == ()
