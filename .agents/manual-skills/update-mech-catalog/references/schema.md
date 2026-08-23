# MECH v1 schema

Read this reference before editing `web/public/game-data/mech.json`.

MECH v1 records only shared status/mechanic dependencies grounded in current
skill descriptions. It does not model damage or healing output, coefficients,
target counts, strength, summaries, hero-to-skill links, or recommendations.

## Canonical mechanics

The registry is derived only from `database.json.buffs` and
`database.json.debuffs`. IDs are `buff:<source-key>` and
`debuff:<source-key>`. Never invent an ID. Put a named state that cannot be
mapped safely in the skill's `unresolved` array.

`source.mechanics_source_hash` is SHA-256 over canonical compact JSON for exactly:

```json
{"buffs": <database buffs object>, "debuffs": <database debuffs object>}
```

Object keys are sorted, UTF-8 is used, and JSON has no insignificant whitespace.
Registry entries expose only `kind`, `source_key`, and `name`; the hash still
covers complete canonical definitions because their effects guide extraction.

## Skill hashes and entries

A skill hash is SHA-256 over canonical compact JSON containing exactly:

```json
{
  "name": "<skill name>",
  "type": "<type>",
  "prob": "<number as stored>",
  "desc": "<description>"
}
```

The example shows field meaning, not the numeric JSON type of `prob`. Ranking,
category, season, color, shadow flags, estimates, and all other metadata are
excluded.

Every database skill has exactly one entry:

```json
{
  "source_hash": "<64 lowercase hex characters>",
  "extraction_status": "complete",
  "relations": [],
  "unresolved": []
}
```

`pending` is allowed during editing but rejected by final validation. An empty
complete extraction means the full current description was reviewed and has no
MECH v1 relationship.

## Relationships

The closed relation enum is:

- `provides`: applies or grants the mechanic.
- `benefits_from`: the skill works without it but gains an additional effect.
- `requires`: the relevant effect cannot activate without it.
- `consumes`: uses or removes it while activating an effect.
- `removes`: cleanses, dispels, or removes it from its subject.
- `prevents`: grants immunity or prevents its application/effect.

The subject is one of `self`, `ally`, `enemy`, `any`, `team`, or `unknown`.
Use `team` for a whole allied team and `any` only when the description genuinely
covers allied and enemy subjects. Do not use subject to encode the skill owner.

Explicit relationship:

```json
{
  "relation": "provides",
  "mechanic": "debuff:huo_gong",
  "subject": "enemy",
  "certainty": "explicit",
  "evidence": "施加火攻"
}
```

`evidence` is the smallest useful non-empty exact substring of the current
`desc`. `certainty` is `explicit` or `inferred`. An inferred item has one extra
non-empty `reason` field explaining the text-grounded inference. Do not use
external game knowledge or battle/team co-occurrence. A skill may provide a
status and separately benefit from it; retain both when each has direct evidence.
Duplicate `(relation, mechanic, subject)` identities are invalid. A category
relationship does not make every member-specific transition a category-wide
transition: when a unique skill-local state is classified only as
`功能性增益状态`, do not claim the skill `consumes` all functional buffs merely
because it clears that local state. Add `consumes` only when the consumed
standalone mechanic has its own canonical ID (for example, `伏兵`).

Status categories are canonical mechanics too. For example, direct text about
`控制状态`, `属性降低状态`, or `负面状态` may map to the corresponding category
entry when the wording and subject are clear. Do not expand a category into all
of its members unless the skill explicitly names those members.

## Unresolved named states

```json
{
  "name": "潜袭",
  "evidence": "获得1层“潜袭”",
  "reason": "Named state is not present in the canonical buff/debuff registry"
}
```

All three strings are required, and evidence is an exact `desc` substring.
Unresolved entries are structurally valid and reported by `validate` and
`status`; they are a human-review queue, not permission to invent an ontology.

## Canonical serialization

Top-level keys are exactly `schema_version`, `source`, `mechanics`, and `skills`.
Schema version is integer `1`; there are no timestamps. Object keys and semantic
arrays are deterministic. JSON is UTF-8, `ensure_ascii=False`, two-space
indented, and ends with one newline. Use `data/manage_mech_catalog.py format`;
do not hand-format or manually edit hashes.
