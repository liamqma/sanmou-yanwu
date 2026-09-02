---
name: update-game-database-from-csv
description: Validates and imports the seven-sheet 但丁与你 演武 XLSX workbook into web/public/game-data/database.json through the deterministic workbook importer.
allowed-tools:
  - open_files
  - grep
  - bash
---

# Update Game Database From Workbook

Use `data/import_yanwu_workbook.py`; do not hand-edit the generated workbook
fields in `web/public/game-data/database.json`. The local source retains its
reviewed historical filename, while generated public metadata uses the separate
current-name label `三谋演武-但丁与你.xlsx`. Follow the repository's approved
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
   layout change with its source cell. This immutable revision spans the
   author's rename: validate the exact per-sheet author markers already encoded
   by the importer, then normalize them to 但丁与你 in generated metadata. Add
   any other exact alias only after explicit review and a focused test.
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
   catalog heroes, 99 ranked heroes, 231 catalog skills, 98 ranked skills across
   6 categories, 70 strong entries, 15 championship entries, 79 unique teams,
   3 cross-source overlaps, 13 matchup builds, 5 championship groups, 2 analysis
   sections, and 6 analysis points.
6. Require `yanwuGuide.source` to contain exactly:

   ```yaml
   provider: 但丁与你
   workbook: 三谋演武-但丁与你.xlsx
   updatedAt: 2026-09-02
   attribution: 攻略数据由但丁与你提供
   ```

   The reviewed date is printed by this immutable workbook revision and does
   not include a time. Do not invent one or read the wall clock during import,
   because either would break source fidelity and idempotence.
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
    `pnpm build` from `web/`. When the author account presentation changes, also
    run the visual audit required by `DEVELOPMENT.md`.
11. Inspect `git diff -- web/public/game-data/database.json` and confirm optional
    hero rankings/camps, optional skill rankings/categories, normalized
    formations and skill alternatives, content-derived build references, all
    seven sheets, current-name attribution, and the absence of workbook contact
    or link data. The only approved author-account links are page-owned content
    on `/guides/yanwu`: the Bilibili space `326647108` and the explicitly
    reviewed Douyin profile URL. They must never be imported from workbook
    cells or added to `yanwuGuide`.

## Audited contract decisions

- `武将Tier` ranks a reviewed subset of 99 catalog heroes. `小乔` is the exact
  unranked hero in this revision: keep her catalog identity, camp, stats, skill,
  season, and gameplay availability, but remove any stale presentation ranking.
  Fail if any other hero is absent or if `小乔` becomes ranked without a
  reviewed contract update.
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
- The exact reviewed old-name and current-name author markers in the source
  sheets refer to the same author. Import all seven sheets, but emit only
  `但丁与你` in the public provider, workbook label, and attribution fields.
- Contact prefaces and directory links are never imported. Reject contact or
  URL markers in the generated `yanwuGuide` payload. Attribution and the two
  explicitly approved Bilibili/Douyin profile links appear only on
  `/guides/yanwu`; the links are page-owned content and never workbook payload.
- The exact reviewed abbreviations include `暗度` → `暗渡阴平`, `瞋目` →
  `瞋目横矛`, and `谋而` → `谋而后动`; they are tested and must not be
  generalized into fuzzy matching.

## Layout-drift response

An earlier seven-sheet revision attributed every sheet to `飞将吕布`, ranked all
100 catalog heroes, and pinned a full timestamp. The current immutable revision
uses reviewed source markers from both sides of the same author's rename,
normalizes public attribution to `但丁与你`, intentionally leaves `小乔`
unranked, and pins the source's date-only value. Before that, the workbook used
five sheets, the filename `三谋吕布-演武.xlsx`, provider `三谋吕布`, fixed
matchup row anchors, and no imported skill ranking sheet. If a future workbook
changes filename, author markers, sheet order, categories, cardinalities, or
matchup identity, stop at dry-run, report the complete drift, agree on the new
contract, then update the importer, focused tests, this skill, and affected UI
together.

The importer is dry-run by default, validates before writing, and uses an atomic
replace only when output bytes changed.
