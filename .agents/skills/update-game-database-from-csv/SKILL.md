---
name: update-game-database-from-csv
description: Validates and imports the seven-sheet 飞将吕布 演武 XLSX workbook into web/public/game-data/database.json through the deterministic workbook importer.
allowed-tools:
  - open_files
  - grep
  - bash
---

# Update Game Database From Workbook

Use `data/import_yanwu_workbook.py`; do not hand-edit the generated workbook
fields in `web/public/game-data/database.json`. Follow the repository's approved
plan/feature-branch lifecycle before changing the importer, schema, or UI.

## Import workflow

1. Put the source at the repository root with the exact filename
   `三谋演武-飞将吕布.xlsx`. Treat it as read-only and never commit it.
   Confirm `git check-ignore -v '三谋演武-飞将吕布.xlsx'` succeeds.
2. Run the default dry run:

   ```bash
   uv run python data/import_yanwu_workbook.py
   ```

3. Stop on any validation error. Do not fuzzy-match, silently skip a cell, or
   invent an alias. Report every unknown hero, skill, formation, category, or
   layout change with its source cell. Add an explicitly reviewed exact alias
   and a focused test only after the user confirms it.
4. Require exactly these sheets, in order:

   ```yaml
   - 目录
   - 武将Tier
   - 战法Tier
   - 强队Tier
   - 克制关系
   - 夺冠御三家
   - 阵容解析
   ```

5. Review the reported cardinalities. This audited workbook produces 100
   heroes, 231 catalog skills, 98 ranked skills across 6 categories, 70 strong
   entries, 15 championship entries, 79 unique teams, 3 cross-source overlaps,
   13 matchup builds, 5 championship groups, 2 analysis sections, and 6
   analysis points.
6. Require `yanwuGuide.source` to contain exactly:

   ```yaml
   provider: 飞将吕布
   workbook: 三谋演武-飞将吕布.xlsx
   updatedAt: 2026-08-11T16:07:04+10:00
   attribution: 攻略数据由飞将吕布提供
   ```

   The reviewed timestamp is pinned to this immutable workbook revision; do not
   read the wall clock during import because that would break idempotence.
7. Apply only when the update is intended:

   ```bash
   uv run python data/import_yanwu_workbook.py --apply
   ```

8. Prove idempotence by running the same apply command again; require
   `changes=no` and `written=no`.
9. Run the importer tests and validate the JSON:

   ```bash
   uv run pytest data/test_import_yanwu_workbook.py -q
   python3 -m json.tool web/public/game-data/database.json >/dev/null
   ```

10. Because the generated database drives the React UI, run the checks required
    by `web/AGENTS.md`: `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, and
    `pnpm build` from `web/`.
11. Inspect `git diff -- web/public/game-data/database.json` and confirm hero
    rankings/camps, optional skill rankings/categories, normalized formations
    and skill alternatives, content-derived build references, all seven sheets,
    and the absence of provider contact/link data.

## Audited contract decisions

- `战法Tier` ranks a reviewed subset of 98 catalog skills. Each listed skill gets
  paired `ranking` (`S`–`D`) and `category` (`兵刃`, `谋略`, `治疗`, `防御`,
  `辅助`, or `文武`). Skills absent from the sheet remain unranked. These fields
  are presentation-only and must not affect recommendation/model scores.
- Every `夺冠御三家` row is rank `S`. Builds are keyed by formation, ordered
  heroes, and every normalized skill alternative. Same heroes with different
  skills therefore remain distinct builds. Exact duplicate payloads share one
  build ID, while every championship group keeps its original reference.
- Matchup labels resolve to one normalized strong-build identity, not a row
  coordinate. The two 司马懿/曹操/曹丕 variants are distinguished by the
  presence of `运智铺谋` plus `谋而后动`. Fail if any label resolves to zero
  or multiple builds.
- Contact prefaces and directory links are never imported. Reject contact or
  URL markers in the generated `yanwuGuide` payload. Attribution appears only
  on `/guides/yanwu`.
- The exact reviewed abbreviations include `暗度` → `暗渡阴平`, `瞋目` →
  `瞋目横矛`, and `谋而` → `谋而后动`; they are tested and must not be
  generalized into fuzzy matching.

## Layout-drift response

The previous workbook used five sheets, the filename `三谋吕布-演武.xlsx`,
provider `三谋吕布`, fixed matchup row anchors, and no imported skill ranking
sheet. Those assumptions were intentionally removed. If a future workbook
changes filename, provider, sheet order, categories, cardinalities, or matchup
identity, stop at dry-run, report the complete drift, agree on the new contract,
then update the importer, focused tests, this skill, and affected UI together.

The importer is dry-run by default, validates before writing, and uses an atomic
replace only when output bytes changed.
