# 三国谋定天下 (演武) battle analytics

A personal analytics tool for the mobile game 三国谋定天下 (演武). Screenshots are
OCR'd into battle JSON, an offline builder trains a model on those battles, and
a React app uses the generated model in the browser to recommend heroes and
skills.

- [GAME_RULE.md](GAME_RULE.md): the draft rules.
- [DEVELOPMENT.md](DEVELOPMENT.md): the workflow and which tests to run.
- [web/README.md](web/README.md): the web app and Cloudflare setup.

## Commands

| Command | What it does |
|---|---|
| `make sync` | Install Python dependencies (uv, Python 3.12). |
| `make extract` | OCR `data/images/` into `data/battles/`, then rebuild the model. |
| `make build-recommendation` | Rebuild `web/src/recommendation_data.json`. |
| `make evaluate-recommendation` | Run the full evaluation. It writes an ignored report and never changes production weights. |
| `make sync-yanwu-corpus` | Download and verify the pinned Yanwu corpus into `.cache/yanwu/`. |
| `make import-web-battles EXPORT=<sql>` | Import a D1 export of community battle reports. |
| `make build-telemetry EXPORT=<sql>` | Update telemetry from a D1 export. |
| `make import-yanwu [APPLY=1]` | Check the guide workbook, or import it with `APPLY=1`. |
| `make web` | Start the dev server on http://localhost:3000. |
| `make test`, `make test-data`, `make test-web-battles`, `make test-telemetry` | Python tests. |

## Recommendation pipeline

- `data/build_recommendation_data.py` trains a regularized logistic
  (Bradley-Terry) model on battles from `data/battles/` (own captures),
  `data/web-upload/` (accepted community reports), and the pinned Yanwu corpus
  (`data/external/yanwu-release.json`, CC BY 4.0). It writes
  `web/src/recommendation_data.json`; never edit that file by hand.
- The browser scores options with `web/src/services/recommendationEngine.ts`.
  Build feature ids only through `recommendationModel.ts`, so they match the
  Python builder.
- The own captures come from 州内淘汰赛, a late stage that only stronger teams
  reach, so the builder adds an appearance prior: heroes and skills seen more
  often than expected get a bonus. Model decisions are recorded in
  [data/evaluation/](data/evaluation/).
- Automatic team building is paused because it was not reliable enough.
  `/team-builder` only shows relationships within the current roster.
- Guide data in `web/public/game-data/database.json` is attributed to 但丁与你.
  Never publish the workbook's contact details.

## Data from the website

- Community reports: `POST /api/battles` writes to D1, and the daily
  `update-web-battles.yml` workflow imports them into `data/web-upload/`.
- Telemetry: `POST /api/telemetry/rounds` writes to D1, and the weekly
  `update-telemetry-data.yml` workflow updates `data/telemetry_state.json` and
  `web/public/game-data/telemetry_data.json`. Raw rows are never committed and
  are deleted from D1 after 14 days.

## Battle-report OCR batches

Put one phone capture batch in `study-battle-report/battles/<batch-id>/images/`
and keep the original `battle_detail_<timestamp>.png` filenames.

```bash
# List available batches.
uv run python study-battle-report/ocr_battle_log.py --list

# OCR and split one batch into battle_logs/*.txt.
uv run python study-battle-report/ocr_battle_log.py <batch-id>

# Re-run text processing from compatible cached OCR observations.
uv run python study-battle-report/ocr_battle_log.py <batch-id> --use-cache
```

Logs go to the batch's `battle_logs/` folder, named
`<YYYY-MM-DD> - <our heroes> vs <enemy heroes> - <outcome>.txt`.

## Layout

- `image_extraction/`: screenshot OCR (PaddleOCR).
- `study-battle-report/`: battle-log OCR.
- `data/`: battles and the offline builders.
- `web/`: the React app and Cloudflare Pages Functions.
- `autojs/`: Android screenshot capture scripts.
