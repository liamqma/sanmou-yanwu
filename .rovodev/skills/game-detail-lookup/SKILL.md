# Game Detail Lookup

Use this skill when the user explicitly asks to add/query details for a compact recommendation prompt, for example:

- "use game-detail-lookup"
- "add details"
- "补充详细信息"
- "查询详细描述"
- "用详细描述再分析"

The user may trigger this skill **without giving any additional arguments**. In that case, infer the relevant entities from the current conversation, pasted prompt, or most recent recommendation context.

Recommendation prompts intentionally omit verbose details by default. This skill restores those omitted details on demand so the LLM can reason with full mechanics when compact stats are not enough.

## Primary behavior: enrich current recommendation context

When invoked without a specific hero/skill/status name:

1. Identify all relevant entities from the current recommendation context:
   - already chosen heroes
   - candidate heroes
   - support hero, if present
   - already chosen skills
   - candidate skills
   - support skills, if present
2. Read `web/src/database.json`.
3. Add verbose information that compact prompts omit:
   - hero four stats: `wl`, `zl`, `ts`, `xg`
   - hero self-skill full description
   - skill full description
   - skill type/prob/tier/note, if useful
   - relevant buff/debuff definitions mentioned in those descriptions
   - relevant bonds involving at least two chosen/candidate heroes
4. Keep the output organized by context, not alphabetically.
5. Do not replace the original recommendation prompt; append this as a detail supplement.

## Data source

Read from:

```text
web/src/database.json
```

Relevant sections:

- `heroes[heroName]`
- `skills[skillName]`
- `buffs`
- `debuffs`
- `bonds[bondName]`
- `team`

## Entity extraction guidance

The compact prompt usually contains sections like:

```text
【已选武将】
【已选战法】
【本轮三组可选武将及战绩数据】
【本轮三组可选战法及战绩数据】
【武将池】
【战法池】
```

Extract names from those sections. Ignore numeric stats and labels such as `OP`, `T1+`, `胜率指数`, `第1组`.

If no current prompt/context is available, ask the user to paste the recommendation prompt or list the chosen/candidate heroes and skills.

## Output format when enriching a prompt

Use this shape:

```text
# 详细信息补充

## 已选武将详情
- 武将: ...
  定位: ...
  阵营/兵种: ...
  四维: 武力... 智力... 统帅... 先攻...
  自带战法: ...
  自带战法效果: ...

## 候选武将详情
### 第1组
- 武将: ...
  ...

## 已选战法详情
- 战法: ...
  强度: ...
  类型/概率: ...
  备注: ...
  完整效果: ...

## 候选战法详情
### 第1组
- 战法: ...
  ...

## 相关状态说明
- 状态: ...
  类型: 增益/负面
  效果: ...

## 相关缘分/已知队伍
- 缘分: ...
  成员: ...
  条件: ...
  效果: ...
```

Omit empty sections.

## Specific lookup mode

If the user asks about a specific name, search exact names first, then substring matches across heroes, skills, buffs, debuffs, and bonds.

Examples:

- "explain skill 洗筋伐髓"
- "what does 祝融 do?"
- "lookup 抵御"
- "show details for bond 南疆烽沏"
- "why does 七进七出 work with 甘夫人?"

For specific lookup, return only the requested entity and directly relevant related entities.

## Important

- Do not invent names or mechanics.
- If multiple matches exist and the intended entity is ambiguous, ask the user which one they mean.
- Include full raw descriptions only in this skill output, not in compact recommendation prompts.
- Preserve exact Chinese names from `database.json`.
