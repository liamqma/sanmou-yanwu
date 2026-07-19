---
name: update-game-database-from-csv
description: Updates `web/public/game-data/database.json` from the three 炎帝/UCL_Louis CSV source files (S<season>武将战法排行榜, S<season>影本战法, 阵容排行榜S<season>更新). Applies hero label/rank updates, skill note updates, and team updates while preserving the existing schema.
allowed-tools:
  - open_files
  - expand_code_chunks
  - grep
  - find_and_replace_code
  - create_file
  - delete_file
  - bash
---

# Update Game Database From CSV

Use this skill when the user asks to update `web/public/game-data/database.json` from the three 炎帝/UCL_Louis CSV source files.

Expected CSV files use the season suffix from the current source drop (for example `S14` or `S16`):

```text
炎帝的焚决（配将+UCL_Louis）-S<season>武将战法排行榜.csv
炎帝的焚决（配将+UCL_Louis）-S<season>影本战法.csv
炎帝的焚决（配将+UCL_Louis）-阵容排行榜S<season>更新.csv
```

Known current examples:

```text
炎帝的焚决（配将+UCL_Louis）-S16武将战法排行榜.csv
炎帝的焚决（配将+UCL_Louis）-S16影本战法.csv
炎帝的焚决（配将+UCL_Louis）-阵容排行榜S16更新.csv
```

The CSV files are temporary import sources. After updates are applied and committed, ask whether to remove them or remove them if the user explicitly asks.

## General rules

- Update only existing fields unless the user explicitly approves a schema change.
- Do not add new hero/skill entries unless explicitly requested.
- Do not add new fields like `shadow` without approval.
- Prefer exact matches, then curated aliases, then cautious fuzzy matching.
- Print ambiguous mappings for review before applying them.
- Validate after every update:

```bash
python3 -m json.tool web/public/game-data/database.json >/dev/null
(cd web && npx vitest run src/services/__tests__/promptGenerator.test.ts src/services/__tests__/recommendationEngine.test.ts)
npm --prefix web run build
```

## File 1: S<season>武将战法排行榜.csv

Purpose:

- update hero `label` / `rank`
- update skill `tier`

### Layout

Hero ranking columns:

```text
col 0: 体系核心
col 1: 输出核心
col 2: 功能辅助
col 3: 输出辅助
```

The source note says ordering is:

```text
从左到右，从上到下
```

Interpretation:

- Within each column, rank is top-to-bottom among non-empty rows.
- If a hero appears in multiple categories, keep the first higher-priority occurrence based on left-to-right category order.
- Update existing hero fields only:

```json
"label"
"rank"
```

Skill tier area:

```text
col 5: tier marker, e.g. T0, T1+, T1, T2, T3, T4
cols 6-12: skill abbreviations in the current tier block
```

Interpretation:

- A tier marker applies to following skill cells until the next tier marker appears.
- Update existing skill field only:

```json
"tier"
```

If a skill appears more than once, keep the highest tier by order:

```text
OP > T0 > T1+ > T1 > T2 > T3 > T4
```

### Known hero aliases

```text
神诸葛亮 -> 诸葛亮2
神诸葛 -> 诸葛亮2
神周瑜 -> 周瑜2
皇甫嵩 -> 皇甫嵩2
朱俊 -> 朱儁
木鹿 -> 木鹿大王
张合 -> 张郃
关妹 -> 关银屏
月英 -> 黄月英
春华 -> 张春华
司马 -> 司马懿
诸葛 -> 诸葛亮
马妹 -> 马云禄
糜夫人 -> 麋夫人   (CSV uses 糜; DB uses 麋)
皇甫 -> 皇甫嵩2
左慈拔刀 -> 左慈   (combo cell: hero is 左慈; the "拔刀" token belongs to the T0 skill area; see skill alias 拔刀 -> 拔刀相向)
三队陆逊 -> 陆逊   (drop prefix 三队)
三队孙坚 -> 孙坚   (drop prefix 三队)
三队张辽 -> 张辽   (drop prefix 三队)
定军弓腰糜夫人 -> 麋夫人   (combo cell: hero is 麋夫人)
七进七出刘禅 -> 刘禅       (combo cell: hero is 刘禅)
```

### Positional / disambiguation rules for duplicate heroes

Some heroes (e.g. 孙坚) appear in multiple category columns. Default rule is
"first higher-priority column wins". When the user clarifies that a specific
occurrence should resolve to the alternate hero (e.g. `孙坚2`), apply the
alternate only to that occurrence and keep the other occurrences as-is.

Known per-occurrence overrides (confirmed in past sessions):

```text
孙坚 @ 输出辅助 row 1 (top of column) -> 孙坚2
```

### Known skill aliases / cautions

Use curated aliases. Be careful: some abbreviations are ambiguous.

Important confirmed mappings:

```text
文武 -> 文武双全
文韬 -> 文韬武略
破军 -> 破军袭敌
```

Other commonly used mappings:

```text
折冲 -> 折冲御侮
胜敌 -> 胜敌益强
横征蹈锋 -> 横征暴敛 + 蹈锋饮血
横征 -> 横征暴敛
锐不 -> 锐不可当
指点 -> 指点乾坤
潜袭 -> 潜师袭远
威名 -> 威名显赫
未雨 -> 未雨绸缪
惩前 -> 惩前毖后
步步 -> 步步为营
避其 -> 避其锐气
洗筋 -> 洗筋伐髓
青囊 -> 青囊急救
蹈锋 -> 蹈锋饮血
运智 -> 运智铺谋
蓄势 -> 蓄势待发
及锋 -> 及锋而试
摧坚 -> 摧坚克难
战八 -> 万人之敌
谋动 -> 谋而后动
神略 -> 神略制变
明其 -> 明其虚实
黄天 -> 黄天惑心
潜龙 -> 潜龙在渊
一计 -> 一计决胜
御敌 -> 御敌临前
金汤 -> 金城汤池
挫锐 -> 挫锐折锋
如沐 -> 如沐春风
同舟 -> 同舟共济
忘私 -> 忘私相助
百战 -> 百战不殆
风助 -> 风助火势
知人 -> 知人善任
披坚 -> 披坚执锐
韬光 -> 韬光养晦
如有 -> 如有神助
运筹 -> 运筹帷幄
势如 -> 势如破竹
十面 -> 十面埋伏
水淹 -> 水淹七军
文治 -> 文治武功
奇正 -> 奇正相生
五雷 -> 五雷轰顶
经天 -> 经天纬地
狂风 -> 狂风大作
轻装 -> 轻装驰援
践墨 -> 践墨随敌
岿然 -> 岿然不动
清风 -> 清风驱疾
来好 -> 来好息师
空城 -> 空城计
王佐 -> 王佐之才
诱敌 -> 诱敌深入
无难 -> 无难之志
乘间 -> 乘间投隙
三军 -> 三军夺气
横矛 -> 瞋目横矛
勇冠 -> 勇冠贲育
合图 -> 睿虑合图    (DB only has 睿虑合图; previous note 合图聚众 is not in DB)
斩将 -> 斩将夺旗
断戈 -> 断戈夺锋
出其 -> 出其不意
伏兵 -> 伏兵四起
计袭 -> 计袭粮仓
机变 -> 机变无穷
智破 -> 智破千军
以静 -> 以静制动
坚如 -> 坚如磐石
恩威 -> 恩威并行
调和 -> 调和阴阳
上智 -> 上智为间
固若 -> 固若金汤
虎步 -> 虎步连环
舍生 -> 舍生取义
任人 -> 任人择势
膳甲 -> 缮甲厉兵
骁勇 -> 骁勇之姿    (DB has 骁勇之姿 only; 骁勇无前 does not exist in DB)
奇门 -> 奇门遁甲
破阵 -> 破阵驰围
趁火 -> 趁火打劫
兵贵 -> 兵贵神速
千里 -> 千里突袭
万军 -> 万军辟易
攻其 -> 攻其不备
横扫 -> 横扫千军
冲锐 -> 冲锐巧变
风卷 -> 风卷残云
洞若 -> 洞若观火
拔刀 -> 拔刀相向    (user note: CSV "拔刀相助" == DB "拔刀相向")
料事 -> 料事如神
侧击 -> 疾行侧击
决水 -> 决水破敌
决堤 -> 决水破敌
断粮 -> 断敌粮道    (DB has 断敌粮道 / 计袭粮仓; default to 断敌粮道, confirm with user if ambiguous)
铁骑 -> 铁骑横冲
万夫 -> 万夫莫当
天灾 -> 巧利天灾
趁需 -> 乘虚而入    (user confirmed)
乐不 -> 乐不思蜀
偷渡 -> 暗渡阴平
```

### Position-aware skill aliases (same token appears in multiple tier blocks)

When a token appears in more than one tier block, map per-tier:

```text
烈火 @ T2 -> 烈火张天
烈火 @ T3 -> 烈火焚营
```

If a token maps to multiple database skills and is not in the curated list, stop and ask the user.

## File 2: S<season>影本战法.csv

Purpose:

- update existing skill `note` only
- include shadow/影本 carrier guidance and per-carrier tier if useful

Do not add new fields.

Layout:

```text
col 0: shadow skill name, often repeated implicitly down following rows
then pairs of: suitable hero, tier
```

Example note format:

```text
影本战法；载体：祝融(OP)、甘夫人(OP)、马超(T1)、魏延(T1)
```

For toy rows:

```text
影本战法；玩具档（T3）
```

The toy-tier label in File 2 is shadow/影本 guidance only. It must not overwrite the skill's main `tier` from File 1. For example, if File 1 puts `战八 -> 万人之敌` in a `T1+` block but File 2 says `万人=战八方, 玩具, T3`, keep `skills["万人之敌"].tier = "T1+"` and only append/merge `影本战法；玩具档（T3）` into `note`.

Carrier hints beginning with `可玩` (for example `可玩刘禅` / `可玩糜夫人`) are explanatory hints, not carrier names. Do not include them in the rendered carrier list.

Preserve existing useful notes. If an existing note already contains important guidance, merge rather than overwrite.

Known aliases:

```text
马妹 -> 马云禄
群孙坚 -> 孙坚
七进七出（锥） -> 七进七出
鸩毒 -> 鸩饮毒弑
万人=战八方 -> 万人之敌
建计举人＞洛神 -> 建计举人
弓腰姬＞扬威(舍生） -> 弓腰姬
算无遗策(别玩汉盾） -> 算无遗策
临机制胜(别玩汉盾） -> 临机制胜
雄踞西凉（无曹纯不玩 -> 雄踞西凉
```

## File 3: 阵容排行榜S<season>更新.csv

Purpose:

- update `database.team`

### Schema (extended)

User-approved schema with one optional field. Only add `strengthRange` when
the CSV cell has a value; do not write empty strings or `null`s. Do NOT add
`economyRole` / `redImpact` — these were deemed too confusing for the LLM and
removed from both the database and the prompt rendering.

```json
{
  "heroes": ["...", "...", "..."],
  "tier": "OP",
  "strengthRange": "SS→SSS"
}
```

Field semantics:

- `strengthRange` (强度范围): floor → ceiling power band, e.g. `SS→SSS`,
  `B→A`. Determines lower-bound and upper-bound of the team's strength.

### Layout

Two side-by-side blocks. Column indices (0-based). The CSV still has
经济定位 and 红度影响 columns; SKIP them — they are not persisted.

```text
left  block: heroes=1, tier=2, [skip 3=经济定位], [skip 4=红度影响], strengthRange=5
right block: heroes=7, tier=8, [skip 9=经济定位], [skip 10=红度影响], strengthRange=11
```

Data rows start at row 5 (header is row 4). Rows 0-3 are introduction text
explaining 一号位 / 二号位 / 三号位.

### Common aliases

```text
春华 -> 张春华
月英 -> 黄月英
神周瑜 -> 周瑜2
神诸葛亮 -> 诸葛亮2
神诸葛 -> 诸葛亮2
朱俊 -> 朱儁
皇甫嵩 -> 皇甫嵩2
木鹿 -> 木鹿大王
司马 -> 司马懿
关妹 -> 关银屏
诸葛 -> 诸葛亮
群孙坚 -> 孙坚
马妹 -> 马云禄
糜夫人 -> 麋夫人
皇甫 -> 皇甫嵩2
```

### Slash-cell variants confirmed for S16

When a heroes cell uses `/` to indicate an alternative hero, expand it into the confirmed variants below instead of treating it as a 4-hero team:

```text
郝昭 曹丕/皇甫 司马懿 -> 郝昭 + 皇甫嵩2 + 司马懿 (OP); 郝昭 + 曹丕 + 司马懿 (OP)
春华 曹操/吴国太 王异 -> 张春华 + 曹操 + 王异 (OP); 张春华 + 吴国太 + 王异 (T0)
```

### Skip placeholder/unresolved names unless the user clarifies

```text
辅助
群辅助
镜张辽
女追
男追
横矛
拔刀         (this is a skill token leaked into a heroes cell)
孙荀朱张     (unresolved cluster - 4 names compressed)
```

### Comparison & merge rule

- Match teams by sorted hero set, not display order.
- If team exists and tier differs, update tier.
- If team exists, also set the three optional fields when CSV provides them.
- If team does not exist and all 3 heroes resolve to database heroes, append
  the new team with whatever optional fields the CSV provides.
- If any hero in the cell is unresolved (placeholder, unknown alias, or fewer
  than 3 valid heroes), skip the row and report.

## Reporting requirements

After applying updates, summarize:

- count of hero label/rank updates
- count of skill tier/note updates
- count of team additions/tier updates / strengthRange field updates
- aliases used
- skipped ambiguous or missing names
- validation results

Do not commit unless the user asks.
