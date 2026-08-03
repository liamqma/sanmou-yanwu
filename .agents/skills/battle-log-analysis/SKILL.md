---
name: battle-log-analysis
description: Produces a round-by-round (回合) analysis of a finished battle from a battle_log.txt (the OCR'd 战报详情 log), grounded in web/public/game-data/formula.md (the damage formula) and the skill descriptions in web/public/game-data/database.json. For each round it surfaces every hero's 减少伤害/增加伤害 (区间A/B/C multipliers), healing, and damage above a threshold, identifies the turning points (who killed whom and via which skill), explains the win/loss/draw cause, and can suggest a concise team/formation adjustment. Triggered when the user asks to analyse / 复盘 / 分析 a battle log and points at a battle_log.txt location.
allowed-tools:
  - open_files
  - expand_code_chunks
  - grep
  - bash
---

# Battle Log Analysis (战报复盘)

Use this skill **after a battle has been fought** and the user wants a
mechanics-grounded **round-by-round (逐回合) breakdown** of what happened: for
every hero, their **减少伤害 (damage reduction)** and **增加伤害 (damage
dealt)** in formula terms, their **healing**, and the **damage they dealt /
took** (only entries above a threshold), plus the turning points and the final
win/loss/draw cause.

This skill analyses an **actual battle outcome** from its log and can optionally suggest a concise **team/formation adjustment** grounded in the same formula rules.

Trigger: user asks to "分析/复盘这场战报", "analyse the battle log", "逐回合分析",
"give me round-by-round 减伤/增伤/治疗/伤害", etc., and points at a battle log
(see input below).

## Required inputs (ask if missing)

1. **Battle log location** — the user specifies it. It is a `battle_log.txt`,
   normally under `study-battle-report/battles/<id>/battle_log.txt` (produced by
   the `battle-screenshots-to-log` skill). Accept either a full path or a battle `<id>`
   (then read `study-battle-report/battles/<id>/battle_log.txt`).
   If multiple battles exist and none is specified, list them
   (`ls study-battle-report/battles/`) and ask which one.
2. **Threshold** for "damage worth listing" (default **150**) — single damage
   events below this are summarised, not enumerated. Healing default threshold
   **50**. Use defaults silently unless the user overrides.

Do NOT invent a log. If the file is missing, say so.

## Level assumption

The log already reflects the actual in-battle numbers (50级/满级 values), so use
the numbers **as they appear in the log**. Only fall back to the database's
range values when explaining *why* a number is what it is.

## Data sources

Read all three:

```text
<battle_log.txt>        # the actual event log to analyse (user-specified)
web/public/game-data/formula.md         # the canonical damage formula (区间A/B/C, 同向乘法稀释, 异向线性相减, 主属性对位)
web/public/game-data/database.json    # skills[*].desc/type/prob/tier (explain each skill's mechanic), heroes[*], buffs, debuffs, bonds
```

Always re-read `web/public/game-data/formula.md` and look up **every skill that fires in the log** in
`database.json` so the explanation matches the real mechanic, not memory.

## Core procedure

1. **Load the log.** `open_files` / `expand_code_chunks` the full
   `battle_log.txt`. Identify:
   - the two sides and their 3 heroes each (`[我方:…]` blue / `[敌方:…]` red),
   - each side's **阵型** and faction (群/蜀/…) from the pre-battle 强化 block,
   - the **result line** at the end (胜利/失败/平局).
2. **Read `web/public/game-data/formula.md`** and internalise the bucket model:
   - 区间A = attacker 「造成X伤害」 (linear within a tag; separate tags = separate multiplicative regions; 100% cap).
   - 区间B = 「使敌方造成X伤害降低」 (mirror of A).
   - 区间C = 「受到X伤害」 (same-direction multiplicative dilution `M = 1 − Π(1−mᵢ)`; opposite-direction linear `R = E − M`; 通用/兵刃/谋略 sub-tags are separate multiplicative regions).
   - 主属性对位: 兵刃 = 攻方武力 vs 守方统率; 谋略 = 攻方智力 vs 守方(智力+统率)/2.
3. **Look up every firing skill** in `database.json` (a small python pass over
   the skill names that appear in `【…】` brackets). Keep each skill's `desc`,
   `type`, `prob`, `tier` handy so you can name the mechanic behind each log
   line (e.g. 焰燎江天 = 协防 + 迟滞 + 52% 谋伤无视40%减伤, 每层迟滞 +7%).
4. **Parse the pre-battle block** (before 第一回合) into a per-hero
   **starting 增伤/减伤 table**, classifying each `【造成伤害】提升 / 【受到伤害】降低 / 兵种加成 / 阵型 / 栋梁` line into 区间A or 区间C.
5. **Walk the log round by round.** A round starts at `第N回合` (or the
   `·第N回合` / `第N回合` markers). For each round collect, per hero:
   - **减伤 (区间B/C)**: every `【受到X伤害】降低/提升`, 抵御 (此次伤害减少…%),
     规避 (成功规避), 协防 (为…承担伤害 + 减少…%), 造成伤害降低…% (defender
     被动), 迟滞/技穷 stacks, 兵动若神 受伤-X%, etc. Note which are
     multiplicative-dilution (same tag) vs separate regions vs flat 抵御/规避.
   - **增伤 (区间A)**: every `【造成X伤害】提升`, 蓄势待发 stacks, 机变无穷 谋伤
     stacks, 攻心, 玉玺 伤害提升, 胜敌益强 武/智 growth, 空城计 谋伤, etc.
   - **healing** (`恢复了兵力N`) above the heal threshold, grouped by source
     skill (惩前毖后 / 皇思淑仁 / 攻心 / 清风驱疾 …).
   - **damage** (`损失了兵力N` / `由于…效果,损失了兵力N`) above the damage
     threshold, attributed to **source skill** and **target**.
   - any **HP milestone / death** (`兵力为0无法再战`).
6. **Identify turning points.** Mark the round where a key unit dies, where an
   AOE burst (e.g. 僭号天子玉玺 兵刃AOE, 兵动若神满军令AOE) lands, or where a
   defensive engine breaks (规避/抵御/协防 exhausted, 迟滞被驱散). Tie each to
   the formula (e.g. "玉玺是兵刃AOE，绕过了以空城计谋略减伤为主的防御，专杀低统率单位").
7. **Explain the result.** Summarise why it was 胜/负/平: compare both sides'
   sustained 增伤 (区间A), 减伤/规避 (区间B/C), and healing throughput; name the
   single most decisive event.
8. **(Optional) Team adjustment.** If the user asks "how to fix" or the loss/draw is clearly structural, name the empty formula sub-bucket or exploited weakness (e.g. "缺兵刃减伤/低统率前排被玉玺秒"), and propose one concrete formation or skill swap using ONLY heroes/skills the user has, justified by the formula (区间C 单一大数值优于多个小数值; 统率墙半克谋略; etc.).

## Counting / tallying helpers

For questions like "清风驱散了多少次迟滞" or "周瑜江天总共打了多少", use small
`grep`/`bash` passes over the log and **distinguish mechanism from coincidence**:

- A 负面状态 `「迟滞」效果已消失` line is only a **driver-dispel** if it is
  caused by a dispel skill (e.g. 清风驱疾) firing on the same actor/round;
  迟滞 also expires **naturally** after its 持续2回合 — do NOT count natural
  expiry as a dispel. Check the surrounding lines for `发动战法【清风驱疾】` /
  `执行来自【清风驱疾】` before attributing.
- A skill `因几率未发动` did NOT fire — exclude it from counts.
- When tallying a damage skill's total, sum the `损失了兵力N` lines whose cause
  clause names that skill (`由于…【skill】…效果`), per round and overall.

Always show the line numbers you counted from so the tally is auditable.

## Output format

Use this shape (Chinese, concise, decision-oriented). Use `<cite>` line-citations
into the log where possible.

```text
# 战报分析：<我方阵容> vs <敌方阵容>（<结果>）

## 阵容与角色定位
- 我方（<faction> · <阵型>）：<3 heroes + 一句话定位>
- 敌方（<faction> · <阵型>）：<3 heroes + 一句话定位>

## 战前布署（行动前）
| 角色 | 增伤（区间A） | 减伤/受伤（区间C等） |
（each hero's pre-battle multipliers, classified into buckets）

## 第N回合
**减伤（区间B/C）** — per relevant hero, with dilution/规避/抵御/协防 noted
**增伤（区间A）** — per relevant hero
**伤害（>阈值，按来源）** — skill → target: -N, grouped by source skill
**治疗（>阈值）**
（+ 转折点/death notes inline）
... repeat per round ...

## 总结：为什么是<结果>
| 维度 | 我方 | 敌方 |
| 持续输出(区间A) | … | … |
| 减伤/规避(区间B/C) | … | … |
| 治疗 | … | … |
| 致命点 | … | … |
- 核心判断: 2-4 条，点名最决定性的事件。

## （可选）配队/阵型调整建议
- 指出被利用的空槽/弱点 + 用现有战法的具体改法，按公式说明收益。
```

Omit empty sections. Don't enumerate sub-threshold chip damage — summarise it.

## Important

- Do NOT invent heroes, skills, mechanics, or numbers — heroes/skills/damage
  come from the **log**; mechanics come from `database.json`; stacking rules from
  `web/public/game-data/formula.md`.
- Preserve exact Chinese names from the log / `database.json`.
- Attribute every listed damage/heal to its **source skill** and **target**;
  when the log line wraps, read the surrounding lines to recover the full event.
- Distinguish **mechanism vs natural expiry / 几率未发动** when counting
  (especially dispels like 清风驱疾 and stack-based effects like 迟滞).
- Tie turning points to the formula: which **区间** was bypassed (e.g. 兵刃AOE
  vs 谋略减伤), which engine ran out (规避/抵御/协防/治疗), which 统率墙 mattered.
- Always re-read `web/public/game-data/formula.md`; quote the relevant bucket rule when it
  changes a conclusion.
- Keep it concise and decision-oriented — a round-by-round attack/defense/heal
  breakdown + turning points + cause, not a raw dump of the log.
- When the user wants a fix, keep it concise: one formula-grounded adjustment rather than a full squad rebuild.
```
