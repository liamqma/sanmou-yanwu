---
name: update-game-database-from-csv
description: Updates `web/src/database.json` from the three 炎帝/UCL_Louis CSV source files (S14武将战法排行榜, S14影本战法, 阵容排行榜S14更新). Applies hero label/rank updates, skill note updates, and team updates while preserving the existing schema.
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

Use this skill when the user asks to update `web/src/database.json` from the three 炎帝/UCL_Louis CSV source files.

Expected CSV files:

```text
炎帝的焚决（配将+UCL_Louis）-S14武将战法排行榜.csv
炎帝的焚决（配将+UCL_Louis）-S14影本战法.csv
炎帝的焚决（配将+UCL_Louis）-阵容排行榜S14更新.csv
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
python3 -m json.tool web/src/database.json >/dev/null
npm --prefix web test -- --watchAll=false --runTestsByPath src/services/__tests__/promptGenerator.test.js src/services/__tests__/recommendationEngine.test.js
npm --prefix web run build
```

## File 1: S14武将战法排行榜.csv

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
合图 -> 合图聚众
斩将 -> 斩将夺旗
断戈 -> 断戈夺锋
出其 -> 出其不意
伏兵 -> 伏兵四起
计袭 -> 计袭粮仓
机变 -> 机变无穷
烈火 -> 烈火张天
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
骁勇 -> 骁勇无前
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
```

If a token maps to multiple database skills and is not in the curated list, stop and ask the user.

## File 2: S14影本战法.csv

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

Preserve existing useful notes. If an existing note already contains important guidance, merge rather than overwrite.

Known aliases:

```text
马妹 -> 马云禄
群孙坚 -> 孙坚
七进七出（锥） -> 七进七出
鸩毒 -> 鸩饮毒弑
万人=战八方 -> 万人之敌
```

## File 3: 阵容排行榜S14更新.csv

Purpose:

- update `database.team`

Use existing schema only:

```json
{
  "heroes": ["...", "...", "..."],
  "tier": "OP"
}
```

Layout has left and right blocks. Parse both blocks.

Common aliases:

```text
春华 -> 张春华
月英 -> 黄月英
神周瑜 -> 周瑜2
朱俊 -> 朱儁
皇甫嵩 -> 皇甫嵩2
木鹿 -> 木鹿大王
神诸葛 -> 诸葛亮2
司马 -> 司马懿
关妹 -> 关银屏
诸葛 -> 诸葛亮
群孙坚 -> 孙坚
马妹 -> 马云禄
```

Skip placeholder/unresolved names unless the user clarifies:

```text
辅助
镜张辽
女追
男追
横矛
```

Comparison rule:

- Match teams by sorted hero set, not display order.
- If team exists and tier differs, update tier.
- If team does not exist and all 3 heroes resolve to database heroes, append the team.
- If any hero is unresolved, skip and report.

## Reporting requirements

After applying updates, summarize:

- count of hero label/rank updates
- count of skill tier/note updates
- count of team additions/tier updates
- aliases used
- skipped ambiguous or missing names
- validation results

Do not commit unless the user asks.
