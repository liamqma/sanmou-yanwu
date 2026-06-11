---
name: team-damage-analysis
description: Analyzes a fixed 3-hero team's 增伤/减伤 (damage-dealt / damage-reduction) profile per hero, using web/src/database.json (hero stats + full skill descriptions + bonds) and research/公式.md (the damage formula). Accounts for formation (锥形阵/etc.), max-level values, "最高单体" routing of 指挥/借刀 skills, and the formula's 区间A/B/C stacking rules. Triggered when the user invokes `team-damage` and describes a specific squad with assigned skills.
allowed-tools:
  - open_files
  - expand_code_chunks
  - grep
  - bash
---

# Team Damage Analysis (增伤/减伤 复核)

Use this skill when the user has a **specific, fixed team configuration** (3 heroes, each with self-skill + assigned skills, optionally a formation and stat-tuning notes) and wants to understand, per hero, their **增伤 (damage dealt)** and **减伤 (damage reduction)** situation, grounded in the actual skill mechanics and the damage formula.

This is different from `game-detail-look` (which re-ranks 3 candidate groups). This skill takes **one already-decided squad** and produces a **mechanics-grounded breakdown of every hero's offensive/defensive multipliers**, then flags structural strengths/risks.

Trigger: user invokes `team-damage`, or asks to "分析这队的增伤/减伤", "check 增伤减伤", "拆解这套配置的攻防", etc., while providing a concrete squad.

## Level assumption (hard-coded)

Always assume **武将50级 + 战法满级**. This means **every skill range is evaluated at its MAX (upper bound)** value. Do NOT ask the user about levels and do NOT use lower-bound or mid-range numbers.

## Required inputs (ask if missing)

The user should provide:

1. **3 heroes** and, for each, the **2 assigned skills** (self-skill is fixed and read from the database).
2. **Formation (阵型)** if relevant (e.g. 锥形阵), plus **who is front row / back row**.
3. Any **stat-tuning declarations**, e.g. "皇甫嵩 四维调全队第一" or "某武将智力最高" — these decide how "最高单体" skills route.

If heroes/skills are missing, ask the user to paste the squad. Do NOT invent a squad.

## Data sources

Read BOTH:

```text
web/src/database.json   # heroes[*].stats {wl,zl,ts,xg}, heroes[*] self-skill, skills[*].desc/type/prob/tier/note, bonds[*]
research/公式.md         # the canonical damage formula (区间A/B/C, 同向乘法稀释, 异向线性相减, 主属性对位)
```

Always re-read `公式.md` so the stacking math matches the current formula doc; do not rely on memory.

## Core procedure

1. **Load data** (use a small python/bash one-liner against `database.json`):
   - For each hero: `stats` (wl/zl/ts/xg) + self-skill full `desc`.
   - For each assigned skill: full `desc`, `type`, `prob`, `tier`, `note`.
   - Any `bonds` whose members ⊇ ≥2 of the squad's heroes.
2. **Read `研究/公式.md`** and internalize the bucket model:
   - 区间A = attacker "造成X伤害" (linear within a tag, separate tags = separate multiplicative regions, 100% cap).
   - 区间B = "使敌方造成X伤害降低" (mirror of A).
   - 区间C = "受到X伤害" (same-direction multiplicative dilution `M = 1 − Π(1−mᵢ)`; opposite-direction linear `R = E − M`; sub-tags 通用/兵刃/谋略 are separate multiplicative regions).
   - 主属性对位: 兵刃 = 攻方武力 vs 守方统率; 谋略 = 攻方智力 vs 守方(智力+统率)/2.
3. **Resolve "最高单体" routing** using stats + the user's tuning declarations:
   - 指挥/借刀 skills (e.g. 合聚群雄) that fire from "武力/智力/先攻最高单体" → determine WHICH hero actually emits the damage, and therefore WHOSE 增伤/破甲 the borrowed damage benefits from.
   - Target-selecting reductions (e.g. 知人善任 → 智力最高, 步步为营 → 自身+随机友军) → determine WHICH hero actually receives the reduction.
   - 玉玺 (僭号天子) → 统率最高; 军令/统率墙 → note the snowball.
   - If the user said a hero is tuned to be first in all four stats, route ALL "最高单体" effects to that hero and note that this removes routing randomness.
4. **Compute per-hero 增伤 (区间A)**: list each "造成伤害/造成X伤害/破甲/伤害提升" source with its **max-level number**, state which bucket it lands in, and whether sources share a bucket (linear add) or are separate regions (multiply).
5. **Compute per-hero 减伤 (区间C)**: collect all reduction sources that actually land on that hero, apply **multiplicative dilution** within the same tag:
   `M = 1 − Π(1 − mᵢ)`. Show the arithmetic. Keep 兵刃/谋略/通用 sub-tags separate if a source is type-specific.
   - Add bond reductions (e.g. 四世三公 −3%/−3%) as their own small region, and note which heroes the bond actually covers.
   - Note 抵御/规避/统率墙 separately (not part of the % multiplier but materially relevant).
6. **Synthesize**: identify the real role of each hero (core / borrow-the-knife 递刀 / support), the team archetype (e.g. 极致单核群盾), attack convergence, survivability, and **structural risks** (over-single-core, 被控/被驱散, 谋略减伤空缺, formula sub-buckets left empty, etc.).
7. Optionally offer 1 concrete improvement using ONLY skills the user already has, framed by the formula (e.g. "补一个'造成兵刃伤害'专属增伤会作为独立乘区叠加，收益高于继续堆通用槽").

## Stacking math reminders (from 公式.md — verify against the file each run)

- 区间A / 区间B same tag: **linear add**, 100% cap. Different tags: **multiply** (independent regions).
- 区间C same tag, same direction: **multiplicative dilution** `M = 1 − Π(1 − mᵢ)`; opposite direction: linear `R = E_易伤 − M_免伤`. Different sub-tags (通用/兵刃/谋略): **multiply**.
- A single large value > many small values for same-direction 区间C (dilution).
- For a 守势 team, lowering own 减伤 ceiling (区间C) and lowering enemy 增伤 are not symmetric — follow `公式.md` guidance.
- 统率 is a hidden 兵刃 mitigation because 兵刃 uses 守方统率 as the defensive stat; a 统率墙 (军令/僭号/百战) can dwarf percentage reductions vs 兵刃, but only half-helps vs 谋略.

## Output format

Use this shape (Chinese, concise, decision-oriented):

```text
# 增伤/减伤分析（<阵型>，武将50级 + 战法满级取最大值）

> 一句话说明站位与"最高单体"归属（如：四维全调皇甫嵩第一 → 所有最高单体效果锁定皇甫嵩）。

## <武将A>（站位·定位）
| 类型 | 来源 | 满级数值 | 公式归属 |
（增伤区间A、破甲、区间C减伤逐项；减伤给出乘法稀释算式）

## <武将B> ...
## <武将C> ...

## 全队对照表
| 武将 | 站位 | 增伤(区间A) | 减伤(区间C,稀释后) | 真实角色 |

## 定性与风险
- 队伍原型: ...
- 攻防收敛: ...
- 结构性风险: 1-3 条（只列真实短板）

## （可选）一处改进建议
- 仅用现有战法，按公式说明收益来源。
```

Omit empty sections. Show the dilution arithmetic explicitly (e.g. `M = 1 − (1−0.12)(1−0.24)(1−0.25) = −49.8%`).

## Important

- Do NOT invent heroes, skills, stats, or mechanics — read them from `database.json`.
- Preserve exact Chinese names from `database.json`.
- Honor the user's stat-tuning declarations for "最高单体" routing; they override raw base stats.
- Always use **max-level (range upper bound)** values (武将50级 + 战法满级 is hard-coded; never ask about levels).
- Always re-read `research/公式.md`; quote the relevant bucket rule when it changes a conclusion.
- Re-evaluate honestly: if a correction (e.g. a 借刀 skill actually routing to the core) makes the build stronger than first assessed, say so explicitly.
- Keep it concise; the goal is a clear attack/defense breakdown + risks, not a data dump.
