# S17 catalog sources and normalization

This update adds 钟会、王平, their signature skills 怀锋献策、无当飞军,
and ordinary tactics 保境安民、随机应变 to `database.json`. It does not assign
speculative guide rankings or change existing guide data.

## Heroes: level 50, without allocated points or team bonuses

Source pages: [钟会](https://www.sgmdtx.com/wj/钟会/) and
[王平](https://www.sgmdtx.com/wj/王平/). Both are orange-quality S17 heroes.
The user confirmed that the displayed attributes are level 5, with a per-level
increase. Use `level50 = level5 + (50 - 5) × growth`, retaining decimals rather
than rounding each level or adding camp/bond bonuses.

| Hero | Camp / troop | Attribute | Level 5 | Growth | Level 50 |
|---|---|---|---:|---:|---:|
| 钟会 | 魏 / 盾 | 武力 | 102 | 2.31 | 205.95 |
| 钟会 | 魏 / 盾 | 智力 | 103 | 2.33 | 207.85 |
| 钟会 | 魏 / 盾 | 统率 | 107 | 2.44 | 216.80 |
| 钟会 | 魏 / 盾 | 先攻 | 85 | 1.83 | 167.35 |
| 王平 | 蜀 / 弓 | 武力 | 89 | 1.90 | 174.50 |
| 王平 | 蜀 / 弓 | 智力 | 72 | 1.57 | 142.65 |
| 王平 | 蜀 / 弓 | 统率 | 102 | 2.32 | 206.40 |
| 王平 | 蜀 / 弓 | 先攻 | 62 | 1.69 | 138.05 |

钟会's **三贤同殒** bond lists 姜维、钟会、邓艾. The site's bundled bond
record confirms `缘分关系2人在同一部队时激活效果` and
`部队中缘分武将智力和武力提升5%`. The bond is stored once, with all three
members; no bonus is baked into their base attributes. 王平's page lists no bond.

## Skills: level 10

Website pages: [怀锋献策](https://www.sgmdtx.com/zf/怀锋献策/),
[无当飞军](https://www.sgmdtx.com/zf/无当飞军/), and
[保境安民](https://www.sgmdtx.com/zf/保境安民/).
The initial rendered description is **not** the max-level description. The
pages' `mj_desc` values were cross-checked against the user's four screenshots:

1. [怀锋献策 screenshot][huai-feng]
2. [无当飞军 screenshot][wu-dang]
3. [保境安民 screenshot][bao-jing]
4. [随机应变 screenshot][sui-ji]

All four screenshots show **指挥**, **100% activation**, orange quality and all
four troop icons. The first three have the source trait **辅助**; 随机应变 has
**防御**. These source traits are recorded here, not inserted into `category`:
that database field is paired with a guide `ranking`, which the new entries do
not yet have. Signature skills remain linked to their heroes and are not ordinary
draftable tactics.

For every `low → high` level-up range, use **high**, as explicitly requested.
Preserve fixed probabilities, durations, stack counts and scaling clauses.
Normalize punctuation only; do not turn attribute-dependent values into constants.

| Skill | Level-10 upgrade endpoints | Important unchanged values |
|---|---|---|
| 怀锋献策 | 12% attribute transfer; 10% signature damage reduction; 50% damage coefficient | 2 executions; independent 60% targeting chances |
| 无当飞军 | 14% damage increase; 35% 伏矢 chance; 4% damage-taken increase; 100% damage coefficient | First 3 rounds; 3 stacks; 25% extra per 伏矢 stack |
| 保境安民 | 20% reduction; 80% healing rate | 50% reduction chance; at most 4 heals per round; healing starts round 3 and lasts 2 rounds |
| 随机应变 | 40% application chance; 20 attribute points; 10% damage reduction | Starts round 2; 8% effect increase per round; each target independently checked |

The first two screenshots are cut off at the bottom. Their visible values match
the website. The remaining damage/targeting clauses come from the complete
website `mj_desc`, not from unseen screenshot text. The other two screenshots
contain their complete descriptions. 随机应变's exact numbers come from the
fourth screenshot, not qualitative preview articles. Its database `prob` is
**100**, distinct from the **40%** per-target conditional application chance.

## Local artwork

- 钟会: [source PNG](https://cdn.sgmdtx.com/img/zhong_hui.png?v=v3.1.3),
  copied to `../game-assets/heroes/zhong_hui.png` (192 × 296).
- 王平: [source PNG](https://cdn.sgmdtx.com/img/wang_ping.png?v=v3.1.3),
  copied to `../game-assets/heroes/wang_ping.png` (192 × 296).
- 保境安民: [source PNG](https://cdn.sgmdtx.com/img/bao_jing_an_min.png?v=v3.1.3),
  copied to `../game-assets/tactics/bao_jing_an_min.png` (292 × 454).
- 随机应变: crop `(left=65, top=40, right=210, bottom=265)` from the fourth
  screenshot's native 691 × 274 WebP, saved losslessly as RGB PNG at
  `../game-assets/tactics/sui_ji_ying_bian.png` (145 × 225). No enlargement,
  reconstruction or external runtime image request is used.

The existing `../game-assets/manifest.json` maps both heroes and both ordinary
tactics. It deliberately does not include signature tactics as draftable cards.
Image rights remain with their original owners; see `../game-assets/README.md`.

## Reviewed mechanics

The site also supplies canonical definitions for **文韬** and **武略** in the
signature pages' keyword registry. Their text and `functional` booleans are
preserved from that source, without extrapolating their fixed 6%/10% values as
skill-level ranges. No existing buff/debuff definition changes.

The explicitly approved `update-mech-catalog` workflow initially found four new
skills, no stale/removed skills, and a stale registry after the two additions.
Bootstrap requires review of all 235 descriptions when the registry changes.
Review confirmed the 231 existing extractions remain semantically unchanged;
notably the older tactic 文韬武略 does not mention either new status in its
actual description and receives no inferred relationship from its name.

New extraction decisions:

- 怀锋献策 grants 文韬/武略 to the **施策 ally**, consumes that ally's 文韬,
  and later removes that ally's 武略. The nested `自身` refers to the recipient,
  not 钟会. 施策's explicit damage-reduction status maps conservatively to
  `特殊增益状态`, without inventing a functional-buff classification.
- 无当's named damage-increase effect maps to `特殊增益状态` for troop-filtered
  allied recipients, not unconditional `team` coverage. 伏矢's damage-taken
  increase maps to `常规负面状态`. Its local conditional damage is not represented
  as requiring *every* ordinary negative status. Troop predicates, coefficients,
  and timing remain source text, outside MECH v1's scoring vocabulary.
- 应变 maps to the existing `属性降低状态` and `常规负面状态` categories. It is
  not misclassified as 虚弱 or another control status.
- 保境安民 has no shared-status dependency: direct reduction/healing and
  coefficients do not create MECH relationships.

The four additions contain **7 provides, 1 consumes, 1 removes**, with no
unresolved items. Existing extraction arrays/hashes remain unchanged. The
separate approved integration rebuild uses the normal recommendation builder.
The new two-member bond can activate for existing 姜维/邓艾 teams, so its fitted
feature can also change existing coefficients during the joint model refit;
the battle corpus itself is unchanged. No scoring parameters, thresholds, or
weights are hand-edited. Mechanical
validation proves structure/freshness; this diff remains the human semantic
review surface.

## Telemetry compatibility

The additive availability transition is `ed3db0590240 → cb0948fb0edf`.
Removing exactly the two S17 heroes and four S17 skills reconstructs the previous
availability hash. The exact transition is allowlisted in the incremental
telemetry loader; unrelated catalog changes still fail closed.

The committed checkpoint and public telemetry artifact were regenerated through
the normal builder with the canonical empty SQL schema as a no-new-events input.
Only their `catalog_version` changes. Every prior count, cursor, aggregate and
online-model value is preserved; no D1 access, event replay, reset or purge is
performed. This keeps the static telemetry reader compatible with the new
recommendation catalog immediately, without waiting for the next scheduled export.

[huai-feng]: https://mmbiz.qpic.cn/mmbiz_png/WiaibwWjUePy8UuBLc1Zre9YLYiaqsYnu3IqJGqsZ1EiafRIG7EVXWZEKQo93SYNxRzbvGFNKJaQy2v3t4Gt8iavYU3e72ZgQ6KIA1rM0aLbQW3I/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=3
[wu-dang]: https://mmbiz.qpic.cn/sz_mmbiz_png/WiaibwWjUePyicib6EkjCXiaOALzyvgzGWzPK3pTmrXiaSbFkibibwumjibeal7wwS2jm5jcotH1vdEs4EsEozOH8sFTcciaKqVFL3Z96SIiaIsPmsiauh4/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=5
[bao-jing]: https://mmbiz.qpic.cn/mmbiz_png/WiaibwWjUePyicTjpUWt3OJJibpSeYs8ONm6lsb0jicYibLposMgJB3LNLRSP6xiaCRTqcaPltRXFW8R6XAMpYcH9xEuTvooU4sA1bw1kBhqK3t6kI/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=10
[sui-ji]: https://mmbiz.qpic.cn/sz_mmbiz_png/WiaibwWjUePy8tOCVKcT9ThDJT5GHddFYNLXdOBdwyqkLe4e9YLkPuI7nVPVOibyjPl63mLDicyiaXglFfiaZcMGk3Wc2ic49kNicEURT4COpuvSWFQ/640?wx_fmt=png&from=appmsg&watermark=1&tp=webp&wxfrom=5&wx_lazy=1#imgIndex=11
