---
name: update-game-database-from-csv
description: Validates and imports the five-sheet 三谋吕布 演武 XLSX workbook into web/public/game-data/database.json through the deterministic workbook importer.
allowed-tools:
  - open_files
  - grep
  - bash
---

# Update Game Database From Workbook

Use `data/import_yanwu_workbook.py`; do not hand-edit the generated workbook
fields in `web/public/game-data/database.json`.

1. Put the source at the repository root with the exact filename
   `三谋吕布-演武.xlsx`. Treat it as read-only and never commit it.
2. Run the default dry run:

   ```bash
   uv run python data/import_yanwu_workbook.py
   ```

3. Stop on any validation error. Do not fuzzy-match, silently skip a cell, or
   invent an alias. Add an explicitly reviewed alias and a focused test to the
   importer when the workbook uses a new exact spelling.
4. Review the reported cardinalities and diff expectation. The audited workbook
   produces 100 heroes, 231 skills, 68 strong entries, 15 championship entries,
   77 unique teams, 3 cross-source overlaps, 13 matchup builds, 5 championship
   groups, 2 analysis sections, and 6 analysis points.
   Require `yanwuGuide.source` to contain exactly:

   ```yaml
   provider: 三谋吕布
   workbook: 三谋吕布-演武.xlsx
   updatedAt: 2026-07-28
   attribution: 攻略数据由三谋吕布提供
   ```

   Reject the import if VX, an account number, or any other provider contact
   text would enter the output. Omit the workbook's contact prefaces entirely.
   If this workflow also updates UI attribution, show it only on
   `/guides/yanwu`.
5. Apply only when the update is intended:

   ```bash
   uv run python data/import_yanwu_workbook.py --apply
   ```

6. Prove idempotence by running the same apply command again; require
   `changes=no` and `written=no`.
7. Run the importer tests and validate the JSON:

   ```bash
   uv run pytest data/test_import_yanwu_workbook.py -q
   python3 -m json.tool web/public/game-data/database.json >/dev/null
   ```

8. Inspect `git diff -- web/public/game-data/database.json` and confirm:
   hero rankings/camps, removed legacy skill tiers/notes, normalized formations
   and skill alternatives, content-derived build references, all five workbook
   sheets represented, and no VX/contact data.

The importer is dry-run by default, validates before writing, and uses an atomic
replace only when output bytes changed.
