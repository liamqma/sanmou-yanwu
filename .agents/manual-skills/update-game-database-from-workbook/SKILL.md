---
name: update-game-database-from-workbook
description: Validates and imports the seven-sheet 但丁与你 演武 XLSX workbook into web/public/game-data/database.json through the deterministic workbook importer.
allowed-tools:
  - open_files
  - grep
  - bash
---

# Update Game Database From Workbook

Use `data/import_yanwu_workbook.py`; never hand-edit the generated workbook
fields in `web/public/game-data/database.json`. The importer enforces the
reviewed contract (sheet order, cardinalities, aliases, attribution) and is
dry-run by default.

1. Put the source at the repository root as `三谋演武-但丁与你.xlsx`. It is
   read-only and git-ignored (`git check-ignore -v '三谋演武-但丁与你.xlsx'`);
   never commit it.
2. Dry run: `uv run python data/import_yanwu_workbook.py`.
3. On any validation error or layout drift (filename, author marker, sheets,
   categories, cardinalities, matchup identity), stop and report every
   unknown hero/skill/formation with its source cell. Do not fuzzy-match,
   skip cells, or invent aliases. Agree on the new contract, then update the
   importer, its tests, this skill, and affected UI together.
4. Apply: `uv run python data/import_yanwu_workbook.py --apply`. Run it again
   and require `changes=no` and `written=no`.
5. Test: `uv run pytest data/test_import_yanwu_workbook.py -q`, then the web
   checks in `DEVELOPMENT.md` (`pnpm typecheck`, `pnpm test`, `pnpm test:e2e`,
   `pnpm build`).
6. Review `git diff -- web/public/game-data/database.json`. Workbook contact
   details and links must never be imported; the approved Bilibili/Douyin
   author links live only in the `/guides/yanwu` page code.
