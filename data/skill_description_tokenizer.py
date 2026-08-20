"""Deterministic tokenizer and status-event parser for game descriptions.

This is a small domain tokenizer, not a general Chinese segmenter.  It keeps
known game entities intact, binds numeric/unit tokens, and exposes unrecognised
status-like terms for catalog-update review.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable, Mapping, Sequence

_NORMALIZE = str.maketrans(
    {
        "，": ",",
        "。": ".",
        "；": ";",
        "：": ":",
        "（": "(",
        "）": ")",
        "％": "%",
        "１": "1",
        "２": "2",
        "３": "3",
        "４": "4",
        "５": "5",
        "６": "6",
        "７": "7",
        "８": "8",
        "９": "9",
        "０": "0",
    }
)


@dataclass(frozen=True)
class DescriptionToken:
    kind: str
    value: str | float
    text: str
    start: int
    end: int


@dataclass(frozen=True)
class StatusEvent:
    role: str
    status: str
    recipient_scope: str
    conditional_probability: float
    event_id: str
    start: int
    end: int


# Longest matching is applied across this vocabulary and catalog-provided status
# names.  Values are stable feature vocabulary, while ``text`` retains source
# wording for audits.
_BASE_VOCABULARY: tuple[tuple[str, str, str], ...] = (
    ("敌军随机两人", "TARGET", "敌军随机两人"),
    ("敌我全体", "TARGET", "敌我全体"),
    ("全体敌军", "TARGET", "敌军全体"),
    ("敌军随机单体", "TARGET", "敌军随机单体"),
    ("友军随机两人", "TARGET", "友军随机两人"),
    ("友军随机单体", "TARGET", "友军单体"),
    ("主动战法发动后", "TRIGGER", "主动战法后"),
    ("发动主动战法后", "TRIGGER", "主动战法后"),
    ("受到普通攻击后", "TRIGGER", "受到普通攻击后"),
    ("普通攻击之后", "TRIGGER", "普通攻击后"),
    ("普通攻击后", "TRIGGER", "普通攻击后"),
    ("战斗开始前", "TRIGGER", "战斗开始"),
    ("战斗开始时", "TRIGGER", "战斗开始"),
    ("每个回合开始", "TRIGGER", "回合开始"),
    ("每回合开始", "TRIGGER", "回合开始"),
    ("回合开始", "TRIGGER", "回合开始"),
    ("每个回合结束", "TRIGGER", "回合结束"),
    ("每回合结束", "TRIGGER", "回合结束"),
    ("回合结束", "TRIGGER", "回合结束"),
    ("造成伤害后", "TRIGGER", "造成伤害后"),
    ("受到伤害后", "TRIGGER", "受到伤害后"),
    ("受到伤害时", "TRIGGER", "受到伤害后"),
    ("我军随机两人", "TARGET", "友军随机两人"),
    ("两名队友", "TARGET", "友军随机两人"),
    ("随机一名队友", "TARGET", "友军单体"),
    ("一名队友", "TARGET", "友军单体"),
    ("我军全体", "TARGET", "我军全体"),
    ("敌军全体", "TARGET", "敌军全体"),
    ("敌方全体", "TARGET", "敌军全体"),
    ("兵刃伤害", "DAMAGE_TYPE", "兵刃"),
    ("盾兵", "TROOP_TARGET", "盾"),
    ("弓兵", "TROOP_TARGET", "弓"),
    ("骑兵", "TROOP_TARGET", "骑"),
    ("枪兵", "TROOP_TARGET", "枪"),
    ("谋略伤害", "DAMAGE_TYPE", "谋略"),
    ("治疗率", "EFFECT", "治疗"),
    ("恢复", "EFFECT", "治疗"),
    ("发动率", "EFFECT", "发动率"),
    ("伤害提升", "EFFECT", "伤害提升"),
    ("伤害降低", "EFFECT", "伤害降低"),
    ("造成伤害提升", "EFFECT", "伤害提升"),
    ("受到伤害降低", "EFFECT", "伤害降低"),
    ("无法被", "ACTION", "COUNTER"),
    ("必定触发", "ACTION", "TRIGGER_STATUS"),
    ("成功触发", "ACTION", "TRIGGER_STATUS"),
    ("施加", "ACTION", "APPLY"),
    ("获得", "ACTION", "GAIN"),
    ("进入", "ACTION", "ENTER"),
    ("陷入", "ACTION", "ENTER"),
    ("产生", "ACTION", "PRODUCE"),
    ("附带", "ACTION", "ATTACH"),
    ("提升", "ACTION", "INCREASE"),
    ("提高", "ACTION", "INCREASE"),
    ("增加", "ACTION", "INCREASE"),
    ("触发", "ACTION", "TRIGGER_STATUS"),
    ("使", "ACTION", "MAKE"),
    ("令", "ACTION", "MAKE"),
    ("造成", "ACTION", "CAUSE"),
    ("受到", "ACTION", "RECEIVE"),
    ("驱散", "ACTION", "REMOVE"),
    ("清除", "ACTION", "REMOVE"),
    ("移除", "ACTION", "REMOVE"),
    ("免疫", "ACTION", "IMMUNE"),
    ("无视", "ACTION", "COUNTER"),
    ("消耗", "ACTION", "CONSUME"),
    ("失去", "ACTION", "CONSUME"),
    ("每多一种", "CONDITION", "HAS"),
    ("持有", "CONDITION", "HAS"),
    ("处于", "CONDITION", "HAS"),
    ("带有", "CONDITION", "HAS"),
    ("拥有", "CONDITION", "HAS"),
    ("存在", "CONDITION", "HAS"),
    ("影响", "MARKER", "INFLUENCE"),
    ("成功", "MARKER", "SUCCESS"),
    ("无法", "MARKER", "NEGATION"),
    ("无效", "MARKER", "NEGATION"),
    ("持续", "MARKER", "DURATION"),
    ("准备", "MARKER", "PREPARE"),
    ("概率", "MARKER", "PROBABILITY"),
    ("伤害", "MARKER", "DAMAGE"),
    ("回合", "UNIT", "回合"),
    ("层", "UNIT", "层"),
    ("次", "UNIT", "次"),
    ("武力", "ATTRIBUTE", "武力"),
    ("智力", "ATTRIBUTE", "智力"),
    ("统率", "ATTRIBUTE", "统率"),
    ("先攻", "ATTRIBUTE", "先攻"),
    ("兵力", "ATTRIBUTE", "兵力"),
    ("前排", "TARGET", "前排"),
    ("后排", "TARGET", "后排"),
    ("自身", "TARGET", "自身"),
    ("目标", "TARGET", "目标"),
    ("之后", "MARKER", "AFTER"),
    ("后", "MARKER", "AFTER"),
    ("时", "MARKER", "WHEN"),
    ("若", "MARKER", "IF"),
    ("未", "MARKER", "NEGATION"),
    ("受", "MARKER", "SCALED_BY"),
    ("和", "CONJUNCTION", "AND"),
    ("并", "CONJUNCTION", "AND"),
    ("然后", "CONJUNCTION", "THEN"),
    ("随后", "CONJUNCTION", "THEN"),
)

_PUNCTUATION = {",", ".", ";", ":", "(", ")"}
_NUMBER = re.compile(r"\d+(?:\.\d+)?%?")
_SELECTED_FRIENDLY_TARGET = re.compile(
    r"(?:我军)?(?:武力|智力|统率|先攻|兵力|最高属性)"
    r"(?:/(?:武力|智力|统率|先攻|兵力))*"
    r"(?:最高|最低)(?:的?\d+人|单体|友军|队友)"
)
_CONTEXTUAL_STATUS = re.compile(
    r"(?:施加|获得|进入|陷入|持有|处于|带有|拥有|免疫|无视)"
    r"\s*(?:\d+\s*层\s*)?([\u4e00-\u9fff]{1,6}?)(?:状态|[,.;])"
)
_LAYERED_STATUS = re.compile(
    r"(?:施加|获得|持有|消耗|失去)\s*\d*\s*层\s*([\u4e00-\u9fff]{1,8})"
)
_TRIGGERED_STATUS = re.compile(
    r"(?:必定触发|成功触发|触发)\s*(?:\d+\s*层\s*)?"
    r"([\u4e00-\u9fff]{1,8}?)(?=状态|[,.;]|$)"
)


def normalize_description(description: str) -> str:
    """Normalize one-to-one variants and reviewed catalog typos, preserving offsets."""
    return (
        description.translate(_NORMALIZE)
        .replace("混乱状悉", "混乱状态")
        .replace("虛弱", "虚弱")
    )


def _vocabulary(status_names: Iterable[str]) -> tuple[tuple[str, str, str], ...]:
    entries = [(name, "STATUS", name) for name in status_names]
    entries.extend(_BASE_VOCABULARY)
    # Prefer the longest token, then catalog statuses over fixed vocabulary on a
    # same-length collision.
    entries.sort(key=lambda item: (-len(item[0]), item[1] != "STATUS", item[0]))
    return tuple(entries)


def tokenize_description(
    description: str,
    status_names: Iterable[str],
) -> tuple[DescriptionToken, ...]:
    """Tokenize a description with stable source spans and longest matching."""
    text = normalize_description(description)
    vocabulary = _vocabulary(status_names)
    tokens: list[DescriptionToken] = []
    index = 0
    while index < len(text):
        if text[index].isspace():
            index += 1
            continue
        if text[index] in _PUNCTUATION:
            tokens.append(
                DescriptionToken("PUNCTUATION", text[index], text[index], index, index + 1)
            )
            index += 1
            continue
        number = _NUMBER.match(text, index)
        if number:
            raw = number.group(0)
            is_percent = raw.endswith("%")
            value = float(raw[:-1] if is_percent else raw)
            if is_percent:
                value /= 100.0
            tokens.append(
                DescriptionToken(
                    "PERCENT" if is_percent else "NUMBER",
                    value,
                    raw,
                    index,
                    number.end(),
                )
            )
            index = number.end()
            continue
        selected_friendly = _SELECTED_FRIENDLY_TARGET.match(text, index)
        if selected_friendly:
            raw = selected_friendly.group(0)
            tokens.append(
                DescriptionToken(
                    "TARGET",
                    "我军选定单位",
                    raw,
                    index,
                    selected_friendly.end(),
                )
            )
            index = selected_friendly.end()
            continue
        matched = next(
            (entry for entry in vocabulary if text.startswith(entry[0], index)),
            None,
        )
        if matched:
            lexeme, kind, value = matched
            tokens.append(
                DescriptionToken(kind, value, lexeme, index, index + len(lexeme))
            )
            index += len(lexeme)
            continue

        # Keep unknown text visible for audit, coalescing adjacent characters.
        start = index
        index += 1
        while (
            index < len(text)
            and not text[index].isspace()
            and text[index] not in _PUNCTUATION
            and _NUMBER.match(text, index) is None
            and _SELECTED_FRIENDLY_TARGET.match(text, index) is None
            and not any(text.startswith(entry[0], index) for entry in vocabulary)
        ):
            index += 1
        tokens.append(DescriptionToken("TEXT", text[start:index], text[start:index], start, index))
    return tuple(tokens)


def _clause(tokens: Sequence[DescriptionToken], index: int) -> tuple[int, int]:
    start = index
    while start > 0 and tokens[start - 1].kind != "PUNCTUATION":
        start -= 1
    end = index + 1
    while end < len(tokens) and tokens[end].kind != "PUNCTUATION":
        end += 1
    return start, end


def _recipient_scopes(
    tokens: Sequence[DescriptionToken],
    index: int,
    clause_start: int,
    clause_end: int,
    metadata: Mapping[str, Any],
) -> tuple[str, ...]:
    preceding_actions = [
        position
        for position in range(clause_start, index)
        if tokens[position].kind == "ACTION"
    ]
    recipient_end = preceding_actions[-1] if preceding_actions else index
    target_positions = [
        position
        for position in range(clause_start, recipient_end)
        if tokens[position].kind == "TARGET"
    ]
    targets: set[str] = set()
    if target_positions:
        selected = target_positions[-1]
        targets.add(str(tokens[selected].value))
        for position in reversed(target_positions[:-1]):
            if not any(
                item.kind == "CONJUNCTION"
                for item in tokens[position + 1 : selected]
            ):
                break
            targets.add(str(tokens[position].value))
            selected = position
    if not targets:
        for item in tokens[index + 1 : clause_end]:
            if item.kind == "ACTION":
                break
            if item.kind == "TARGET":
                targets.add(str(item.value))
    if not targets:
        inherits_previous_target = any(
            token.kind == "CONJUNCTION"
            for token in tokens[clause_start:index]
        )
        cursor = clause_start - 1
        while cursor >= 0:
            token = tokens[cursor]
            if token.kind == "TARGET":
                selected = cursor
                targets.add(str(token.value))
                cursor -= 1
                while cursor >= 0 and tokens[cursor].kind != "PUNCTUATION":
                    if tokens[cursor].kind == "TARGET":
                        if not any(
                            item.kind == "CONJUNCTION"
                            for item in tokens[cursor + 1 : selected]
                        ):
                            break
                        targets.add(str(tokens[cursor].value))
                        selected = cursor
                    cursor -= 1
                break
            if token.kind == "PUNCTUATION" and (
                token.value == "."
                or (token.value == ";" and not inherits_previous_target)
            ):
                break
            cursor -= 1

    scopes: set[str] = set()
    for target in targets:
        if target == "自身":
            scopes.add("self")
        elif target == "敌我全体":
            scopes.update(("enemy", "team"))
        elif target.startswith("敌军"):
            scopes.add("enemy")
        elif target == "我军全体" or target.startswith("我军选定"):
            scopes.add("team")
        elif target.startswith("友军"):
            scopes.add("ally")
        elif target == "目标":
            scopes.add("enemy" if metadata.get("family") == "debuff" else "self")
    if not scopes:
        scopes.add("enemy" if metadata.get("family") == "debuff" else "self")
    return tuple(sorted(scopes))


def _conditional_probability(
    tokens: Sequence[DescriptionToken],
    index: int,
) -> tuple[float, str]:
    sentence_start = index
    while sentence_start > 0:
        previous = tokens[sentence_start - 1]
        if previous.kind == "PUNCTUATION" and previous.value in {".", ";"}:
            break
        sentence_start -= 1
    crossed_action = False
    for position in range(index - 1, sentence_start - 1, -1):
        token = tokens[position]
        if token.kind == "ACTION":
            crossed_action = True
        if token.kind == "STATUS" and crossed_action:
            break
        if token.kind != "PERCENT":
            continue
        if any(
            item.kind == "MARKER" and item.value == "PROBABILITY"
            for item in tokens[position + 1 : index]
        ):
            return float(token.value), f"probability:{token.start}"
    return 1.0, f"status:{tokens[index].start}"


def parse_status_events(
    tokens: Sequence[DescriptionToken],
    status_metadata: Mapping[str, Mapping[str, Any]],
) -> tuple[StatusEvent, ...]:
    """Classify each known status mention into deterministic semantic roles."""
    events: set[StatusEvent] = set()
    provider_actions = {
        "APPLY",
        "GAIN",
        "ENTER",
        "PRODUCE",
        "ATTACH",
        "INCREASE",
        "TRIGGER_STATUS",
        "MAKE",
        "RECEIVE",
    }
    for index, token in enumerate(tokens):
        if token.kind != "STATUS":
            continue
        status = str(token.value)
        clause_start, clause_end = _clause(tokens, index)
        preceding = list(tokens[max(clause_start, index - 8) : index])
        following = list(tokens[index + 1 : min(clause_end, index + 5)])
        before_actions = {
            str(item.value) for item in preceding if item.kind == "ACTION"
        }
        after_actions = {
            str(item.value) for item in following if item.kind == "ACTION"
        }
        last_action = max(
            (position for position, item in enumerate(preceding) if item.kind == "ACTION"),
            default=-1,
        )
        bound_preceding = preceding[last_action + 1 :]
        before_conditions = {
            str(item.value) for item in bound_preceding if item.kind == "CONDITION"
        }
        before_markers = {
            str(item.value) for item in bound_preceding if item.kind == "MARKER"
        }
        all_before_markers = {
            str(item.value) for item in preceding if item.kind == "MARKER"
        }
        after_markers = {
            str(item.value) for item in following if item.kind == "MARKER"
        }
        clause_tokens = tokens[clause_start:clause_end]
        clause_actions = {str(item.value) for item in clause_tokens if item.kind == "ACTION"}
        clause_targets = {str(item.value) for item in clause_tokens if item.kind == "TARGET"}
        next_markers = {
            str(item.value) for item in following[:2] if item.kind == "MARKER"
        }

        roles: set[str] = set()
        if "REMOVE" in before_actions:
            roles.add("removes")
        if "IMMUNE" in before_actions:
            roles.add("immunities")
        if "COUNTER" in before_actions:
            roles.add("counters")

        passive_apply_trigger = (
            "APPLY" in before_actions
            and bool({"AFTER", "WHEN"} & after_markers)
        )
        consumes = bool(before_conditions) or "CONSUME" in before_actions
        consumes = consumes or passive_apply_trigger
        consumes = consumes or "INFLUENCE" in after_markers
        consumes = consumes or (
            "SUCCESS" in before_markers
            and bool({"AFTER", "WHEN"} & after_markers)
        )
        consumes = consumes or (
            "DAMAGE" in next_markers
            and bool({"AFTER", "WHEN"} & after_markers)
        )
        if consumes:
            roles.add("consumes")

        negated = "NEGATION" in all_before_markers or "NEGATION" in after_markers
        metadata = status_metadata.get(status, {})
        provider = bool(provider_actions & before_actions) or "INCREASE" in after_actions
        if metadata.get("family") == "debuff" and "CAUSE" in before_actions:
            provider = True
        # `造成会心伤害后` describes a trigger, not granting 会心.
        if "CAUSE" in before_actions and "DAMAGE" in next_markers:
            provider = False
        if negated and "TRIGGER_STATUS" in before_actions:
            provider = False
        if passive_apply_trigger:
            provider = False
        # Several debuffs are verbs themselves: `嘲讽敌军全体`, `技穷自身`.
        if (
            not provider
            and metadata.get("family") == "debuff"
            and (clause_targets or index == clause_start)
            and not before_conditions
            and "DAMAGE" not in next_markers
            and not ({"AFTER", "WHEN"} & after_markers)
            and not passive_apply_trigger
            and not ({"COUNTER", "IMMUNE", "REMOVE"} & clause_actions)
        ):
            provider = True
        if provider:
            roles.add("provides")

        if not roles:
            roles.add("references")
        recipient_scopes = _recipient_scopes(
            tokens,
            index,
            clause_start,
            clause_end,
            metadata,
        )
        for role in roles:
            if role == "provides":
                conditional_probability, event_id = _conditional_probability(
                    tokens, index
                )
            else:
                conditional_probability, event_id = 1.0, f"status:{token.start}"
            for recipient_scope in recipient_scopes:
                events.add(
                    StatusEvent(
                        role,
                        status,
                        recipient_scope,
                        conditional_probability,
                        event_id,
                        token.start,
                        token.end,
                    )
                )
    return tuple(
        sorted(
            events,
            key=lambda event: (
                event.start,
                event.role,
                event.status,
                event.recipient_scope,
                event.conditional_probability,
                event.event_id,
            ),
        )
    )


def audit_unknown_status_terms(
    description: str,
    known_status_names: Iterable[str],
) -> tuple[str, ...]:
    """Find plausible named mechanics that require catalog-update review."""
    text = normalize_description(description)
    known = set(known_status_names)
    unknown: set[str] = set()

    def review(term: str) -> None:
        candidate = term.removesuffix("状态").removesuffix("后")
        if candidate in known or f"{candidate}状态" in known:
            return
        compound = re.split(r"和|或", candidate)
        if len(compound) > 1 and all(
            part in known or f"{part}状态" in known for part in compound
        ):
            return
        # These fragments indicate that the conservative regex crossed a
        # grammatical phrase rather than finding a mechanic noun.
        if re.search(r"的|时|若|判断|概率|效果|军令|首位|令", candidate):
            return
        if candidate in {"不同", "不同的", "未持有", "未持有的", "该"}:
            return
        unknown.add(candidate)

    for match in _CONTEXTUAL_STATUS.finditer(text):
        review(match.group(1))
    for match in _LAYERED_STATUS.finditer(text):
        review(match.group(1))
    for match in _TRIGGERED_STATUS.finditer(text):
        review(match.group(1))
    return tuple(sorted(unknown))
