---
name: estimate-skill-strength
description: Estimate a 战法's per-round strength and write *Estimate fields onto its entry in web/src/database.json, organised into the categories damage/healing/attribute/damageBoost/damageReduction/evasion/lifesteal/crit/critDamage. Each estimate is a rough per-round coefficient (max-level, average-trigger) so the team-builder prompt can compare skills. Use when the user asks to "estimate" / "估算" / "evaluate the strength of" a named 战法.
allowed-tools:
  - open_files
  - expand_code_chunks
  - grep
  - find_and_replace_code
  - bash
---

# Estimate Skill Strength (战法预估)

Use this skill when the user asks to **estimate / 估算 / evaluate** the per-round strength of one or
more named 战法 (skills). The output is one or more `*Estimate` numeric fields written onto that
skill's entry in `web/src/database.json`, which the team-builder prompt then surfaces so the LLM can
weigh skill output.

## Goal

For a given skill, compute a **rough per-round coefficient** (a percentage number, no `%` sign in the
value) for each relevant category, using:

- the skill's `desc` in `web/src/database.json` (the source of truth — always re-read it, descriptions
  change), and
- `research/公式.md` (the damage formula) when a modifier like 无视减伤 / 会心 needs converting into a
  multiplier.

The number is a **comparison metric**, not an exact 兵力 figure — it deliberately omits the absolute
固定值/固定系数 constants and the attacker/defender stat line.

## The estimate categories (and their database keys)

| Category | Database key | Label in prompt | Meaning |
|----------|--------------|-----------------|---------|
| Damage | `damageEstimate` | 伤害 | Direct output (谋略/兵刃 coefficient) |
| Healing | `healingEstimate` | 治疗 | 回复兵力 (治疗率-based) |
| Attribute | `attributeEstimate` | 属性 | 属性增减幅度, in **points** (武/智/统/先攻…) |
| Damage boost | `damageBoostEstimate` | 增伤 | 造成伤害提升 % |
| Damage reduction | `damageReductionEstimate` | 减伤 | 受到伤害降低 % |
| Evasion | `evasionEstimate` | 闪避 | 规避率 % |
| Lifesteal | `lifestealEstimate` | 攻心 | Heal self as a % of 谋略 damage dealt |
| Crit rate | `critEstimate` | 奇谋率 | 奇谋 (谋略-crit) trigger-rate boost % |
| Crit damage | `critDamageEstimate` | 奇谋伤害 | 奇谋 (谋略-crit) damage boost % |

A skill can carry **several** of these at once (e.g. a buff that gives 增伤 + 减伤 + 属性). Only write
the categories the skill actually has. Skills that deal no direct damage get **no** `damageEstimate`.

> If you introduce a **new** `*Estimate` category that isn't in the table above, you MUST also update
> **(a)** `web/src/services/promptGenerator.js` — see "Keeping the prompt in sync" below (otherwise the
> new field will silently never render in the prompt) — **and (b)** the **three sibling skills** that
> read `*Estimate` fields — see "Keeping the sibling skills in sync" below. Don't forget the skills.

## Core formula

The per-round estimate for a damage-style category is:

```
estimate = trigger_prob  ×  Σ(coefficient × targets)  ×  any_multiplier
```

- **trigger_prob** — the skill's `prob` as a fraction (e.g. `60` → `0.6`). For 指挥/被动 that fire every
  round at 100%, use `1.0`; if such a skill has an *internal* "X%概率" gate, use that gate instead.
- **targets** — 单体 = 1, 随机两人 = 2, 全体 = 3. Multiply by N for "施放N次 / N times" skills.
  For "随机2-3人" use the midpoint **2.5**.
- **coefficient** — always use the **upper / max** value (descriptions in this DB are already collapsed
  to the upper bound). A 220% 谋略 hit contributes `2.20`.
- **any_multiplier** — conditional bonuses, crit, 无视减伤, etc. (see below).

## Conventions (decided with the user — keep consistent)

- **Use max coefficients.** Descriptions are already collapsed to the upper bound; always estimate at
  max level.
- **Dual-type "兵刃和谋略伤害" = two hits.** "100%兵刃和谋略伤害" deals **both** a 100% 兵刃 and a 100% 谋略
  hit → 200% per target. Do **not** count it once.
- **Averaging window = rounds 1–5.** For ramping / accumulating-DoT skills, average the per-round value
  over rounds 1–5 (matches 火烧连营=691, 焰燎江天=709). Use this so all skills are comparable.
- **"Average in one round" default** = the rounds 1–5 per-round average *with* the trigger chance folded
  in.
- **Sustained-bonus default.** If a skill applies a state that buffs *its own* repeat casts (e.g.
  "若目标已持有妖术则伤害+35%"), assume the bonus is active (sustained case), since the skill self-applies
  the state and the state outlasts a turn.
- **会心 / crit (会心率 r):** crit ≈ ×1.5 damage (`research/公式.md`: 触发时通常 ≥150%). Expected multiplier
  `= 1 + r×0.5` (e.g. 25% 会心 → ×1.125).
- **无视40%减伤:** a normal hit would be ×(1−0.40)=×0.60; ignoring it means ÷0.60 = **×1.667**. In general
  无视 m% 减伤 → multiplier `1/(1−m)`.
- **准备1回合 (charge):** the skill fires only every other round → **divide the estimate by 2**.
- **Intermittent fixed-round skills** (e.g. "战斗第3,5回合"): these are special and **non-comparable** —
  do NOT write an estimate (we removed 陷阵蹈难's). Tell the user it's intermittent.
- **Reactive skills** (trigger on dealing/receiving damage or on dodge, often with a per-round cap and
  diminishing coefficients): the value depends on combat activity. **Ask the user** how many
  triggers/round to assume (we've used 2.5–3.5). Sum the diminishing coefficients across the assumed
  trigger count.
- **Buff/debuff coverage & uptime.** Scale by how many heroes are affected and the uptime fraction:
  - Allied buff to "self + 1 teammate" → covers 2 of 3 heroes. Early conventions used a `× 2/3` factor;
    the later, preferred convention is the explicit form **`base × heroesAffected × upRounds/8`** (e.g.
    每战先登: `14 × 2 × 8.6/8 ≈ 30.1`). When in doubt, **ask** which basis the user wants and stay
    consistent within a batch.
  - Front-row-only bonuses: front row is typically **2 of 3** heroes unless told otherwise.
- **属性 sign:** record attribute debuffs as **positive** magnitude (the size of the attribute swing
  generated), same as buffs.
- **属性 stacking with 2-turn expiry.** A debuff/buff that adds 1 stack/round, lasts 2 turns, and is
  re-applied each round saturates at **~2 × prob** active stacks (NOT the nominal cap), because anything
  older than 2 turns expires. e.g. 三军夺气 at 55%/round → ~1.1 avg stacks. Only assume the cap if the
  state genuinely never expires.
- **Rounding:** integers for damage/healing/attribute; one decimal is fine for small buff %s.

## Modifiers cheat-sheet (`research/公式.md`)

| Modifier in desc | How to fold in |
|------------------|----------------|
| 会心率 r | `× (1 + 0.5r)` |
| 无视 m% 减伤 | `× 1/(1−m)` |
| 准备1回合 | `÷ 2` |
| X%概率额外 +Y% | `× (1 + X·Y)` |
| 风暴/状态-conditional +Z% | include if state is reliably present (sustained), else ask |

## Multi-component skills

Decompose the desc into independent effects and map each to a category. Skip components you cannot
quantify cleanly (e.g. a conditional crit+lifesteal *rider* on the carrier's normal attacks whose base
value isn't in the skill text) — note them to the user rather than guessing. Example: 南疆烈刃 →
`damageEstimate` (全体 90% × 3) + `attributeEstimate` (夺取 20武+20统 × 2 enemies), with the conditional
40%会心+25%lifesteal rider left un-estimated.

## Workflow

1. **Re-read the skill's `desc`** from `web/src/database.json` (don't trust earlier memory — descriptions
   get edited). Locate it with `grep` then read the entry with a small `python3 -c "import json…"` print.
2. **Decompose** the desc into category components.
3. **Compute** each estimate with the core formula + conventions above. Show the user the breakdown
   (a short table) and the assumptions used.
4. **Ask** for any genuinely ambiguous knob (trigger count for reactive skills, coverage basis, which of
   several interpretations) before writing — don't silently pick.
5. **Write** the field(s) onto the skill entry via a `python3` script that rewrites the JSON
   (`json.dump(..., ensure_ascii=False, indent=2)` + trailing newline), inserting the estimate(s) right
   after `desc`. Re-validate the JSON (`json.load`).
6. If a **new category** was introduced → update `promptGenerator.js` ("Keeping the prompt in sync")
   **AND** the three sibling skills ("Keeping the sibling skills in sync"). Don't forget the skills.
7. **Report** the value(s) and offer to commit & push (only commit on explicit user go-ahead).

## Keeping the prompt in sync (new categories only)

The prompt rendering lives in `web/src/services/promptGenerator.js`. For the **existing** categories
nothing more is needed. If you add a brand-new `*Estimate` key, update **all three** of:

1. `SKILL_ESTIMATES` — the shared `[key, label]` array (used by both `formatSkillInfo` and
   `formatSkillInfoEstimates`). Add `['newEstimate', '中文标签']`.
2. `PROMPT_INSTRUCTIONS` — extend the `战法说明：…` legend line with `标签=含义`.
3. The two `战法预估（…）` priority lines (one in `generateLLMPrompt`, one in
   `generateTeamBuilderPrompt`) — add the new label to the parenthesised list.

Then verify with a quick Node check that the new label renders, e.g.:

```bash
cd web && node -e "/* mini formatSkillInfo replica printing the target skill */"
```

## Keeping the sibling skills in sync (new categories only)

Three **sibling skills** read the `*Estimate` fields and list their keys/labels explicitly. Whenever you
add a brand-new `*Estimate` key, you MUST also add it to **all three** so the new estimate is actually
loaded and reasoned about — **don't forget the skills**:

1. **`team-damage-analysis/SKILL.md`** — add the new key to the `*Estimate` load list (the
   `damageEstimate`/`healingEstimate`/… enumeration in "Core procedure" step 1) and mention it in the
   sanity cross-check (step 6).
2. **`game-detail-lookup/SKILL.md`** — add the new key + its 中文 label to the `*Estimate` retrieval
   list (step 3) and the 中文 label to the re-evaluation strength-factor line (step 4).
3. **`estimate-skill-strength/SKILL.md`** (this file) — add the new key to the categories table, the
   frontmatter `description` enumeration, and ideally a worked example.

Quick check that nothing was missed:

```bash
grep -rl 'damageEstimate' .rovodev/skills/*/SKILL.md   # the 3 skills that must learn the new key
```

## Worked examples (for calibration)

- **火烧连营** (60% 主动, 220% 谋略 全体, 焚烧 DoT 60%/层 stacking, wipe after 2 consecutive misses):
  Model B simulation, avg rounds 1–5, ×3 enemies → `damageEstimate: 691`.
- **烈火张天** (50%, 全体, 90%谋+90%兵): `0.5 × (0.90+0.90) × 3 = 270`.
- **制霸江东** (65%, 随机两人 250% 兵刃, ignore healing): `0.65 × 2.50 × 2 = 325`.
- **威震塞外** (50% 追击, 随机两人 140% 兵刃和谋略): dual-type → `0.5 × (1.40+1.40) × 2 = 280`.
- **伏兵四起** (50%, 140% 兵刃 ×4 casts, +25% 会心): `0.5 × 1.40 × 4 × 1.125 = 315`.
- **智破千军** (50%, 随机两人 180% 谋, 35%→+20%): `0.5 × 1.80 × (1+0.35×0.20) × 2 = 193`.
- **上兵伐谋** (100% 指挥, 单体 120% 谋, +10%/round ramp): avg rounds 1–5 → `144`.
- **每战先登** (指挥, 先登 to self+1: +30先攻, +14%增伤, −14%减伤): `attributeEstimate 64.5`,
  `damageBoostEstimate 30.1`, `damageReductionEstimate 30.1` (all `base × 2 × 8.6/8`).
- **三军夺气** (55% 追击, −30 武/智/统 ×2-turn): ~1.1 avg stacks × 90 pts → `attributeEstimate: 99`.
- **同舟共济** (100% 指挥, 治疗率90% to self+1): `90 × 2 = healingEstimate 180`.
- **草船借箭** (指挥; 攻心+24%; 50% reactive 80% 谋, ~2.5 triggers): `damageEstimate 200`,
  `lifestealEstimate 24`.
- **七进七出** (被动, +35%规避, 龙胆 90%→diminishing ×2 targets, assume 3.5 triggers):
  `damageEstimate 540` (90%+80%+70% + 0.5×60%, ×2), `evasionEstimate 35`.
- **悲愤诗** (65% 主动, 全体 治疗率120% + 前排 +50%, assume 2 front-row):
  `0.65 × (120×3 + 50×2) = healingEstimate 299`.
- **未雨绸缪** (60% 主动, 随机两人 140% 谋; 奇谋几率+奇谋伤害 +8%, +2%/功能性增益, 上限+8次):
  `damageEstimate 168` (`0.60 × 1.40 × 2`); 奇谋 buff recorded as sustained magnitude (8% base + ~2
  增益 × 2%) → `critEstimate 12`, `critDamageEstimate 12`. The 获得1层抵御 single-hit block is left
  un-estimated (no clean per-round %).

