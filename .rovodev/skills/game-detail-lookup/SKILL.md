---
name: game-detail-lookup
description: Re-reasons a previous compact recommendation by retrieving omitted verbose details (hero stats, full skill descriptions, buffs/debuffs, bonds) from web/src/database.json and producing a revised recommendation. Triggered when the user invokes `game-detail-look` after an initial recommendation they want rechecked.
allowed-tools:
  - open_files
  - expand_code_chunks
  - grep
  - bash
---

# Game Detail Lookup

Use this skill when the user triggers `game-detail-look` after pasting a compact recommendation prompt and receiving an initial recommendation that they do not fully trust.

Typical workflow:

1. User pastes a compact generated prompt into Rovo Dev.
2. Rovo Dev gives an initial recommendation.
3. User feels the recommendation may be weak or under-explained.
4. User triggers `game-detail-look`, usually without extra arguments.
5. This skill reads the previous compact prompt and previous recommendation from the conversation, retrieves omitted details from the database, and gives a revised recommendation.

The compact prompt intentionally omits verbose details. This skill is the manual fallback path for re-reasoning with full mechanics.

## Primary behavior: re-reason from previous prompt + recommendation

When invoked without a specific hero/skill/status name:

1. Recover context from the conversation:
   - the most recent compact recommendation prompt pasted by the user
   - the previous recommendation/answer from Rovo Dev
   - already chosen heroes
   - candidate hero sets
   - support hero, if present
   - already chosen skills
   - candidate skill sets
   - support skills, if present
2. Read `web/src/database.json`.
3. Retrieve omitted verbose details relevant to the chosen/candidate entities:
   - hero four stats: `wl`, `zl`, `ts`, `xg`
   - hero self-skill full description
   - skill full description
   - skill 类型 (type) and 发动概率 (prob)
   - skill tier/note
   - skill `*Estimate` fields (`damageEstimate`/`healingEstimate`/`attributeEstimate`/`damageBoostEstimate`/`damageReductionEstimate`/`damageDealtReductionEstimate`/`evasionEstimate`/`lifestealEstimate`/`critEstimate`/`critDamageEstimate`) — rough per-round strength estimates (伤害/治疗/属性/增伤/减伤/降伤/闪避/攻心/奇谋率/奇谋伤害); use them to compare candidates' output, sustain, and survivability
   - relevant buff/debuff definitions mentioned in those descriptions
   - relevant bonds involving at least two chosen/candidate heroes
4. Re-evaluate the previous recommendation using both:
   - the original compact prompt facts/stats
   - the additional verbose details from this skill
   - the skill `*Estimate` values as a strength factor (higher 伤害/治疗/减伤/降伤/奇谋率/奇谋伤害/etc. is a plus; note 降伤=敌方造成伤害降低, distinct from 减伤=受到伤害降低), weighed according to the prompt's priority order, which depends on the round type:
     - **武将 (hero) round:** 排名 > 胜率 > 玩家心得 > 战法预估 > 阵营/兵种
     - **战法 (skill) round:** 强度 > 胜率 > 战法预估 (排名/阵营/兵种 and the 玩家心得 hero-comp block are hero-only and omitted)
5. Produce a revised recommendation. If the original recommendation is still best, say so and explain why. If it changes, explicitly state what detail changed the decision.

Do not merely dump details. The goal is to use the extra details to reason again.

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
【本轮三组可选武将及胜率数据】
【本轮三组可选战法及胜率数据】
【武将池】
【战法池】
```

Extract names from those sections. Ignore numeric stats and labels such as `OP`, `T1+`, `胜率指数`, `第1组`. In the 【玩家心得】 comp lines, hero names may carry an ownership marker — strip a trailing `✓` (已选) or `◇` (本轮候选) before matching the name (e.g. `祝融◇` → `祝融`); names with no marker are heroes you don't yet own.

If no previous prompt or recommendation is available, ask the user to paste the compact prompt and the recommendation they want rechecked.

## Output format for no-argument usage

Use this shape:

```text
# 详细信息复核

## 复核结论
- 是否维持原推荐: 是/否
- 最终推荐: 第X组 / 第X组 > 第Y组 > 第Z组
- 变化原因: 如果推荐变化，说明是哪些详细机制导致变化；如果不变，说明详细机制如何支持原结论。

## 关键新增信息
- 只列影响判断的详细描述，不要把所有数据库文本完整倾倒出来。
- 按组选项组织，优先列候选组和已选队伍之间的关键机制。

## 分组复评
### 第1组
- 详细机制补充: ...
- 对推荐影响: 加分/减分/无明显影响

### 第2组
- ...

### 第3组
- ...

## 最终建议
- 推荐选择: ...
- 简要理由: 3-5条
- 如果是第4轮及以后: 给出3队暂定配置；缺少战法位留空。
```

Omit empty sections.

## Important

- Do not invent names or mechanics.
- If multiple matches exist and the intended entity is ambiguous, ask the user which one they mean.
- Do not assume the previous recommendation is wrong; re-evaluate it.
- Preserve exact Chinese names from `database.json`.
- Keep the final answer concise and decision-oriented.
