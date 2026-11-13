# 三国谋定天下 (演武) battle analytics

A personal analytics tool for the mobile game 三国谋定天下 (演武). Battle reports
are read from the emulator's client cache into battle JSON, an offline builder
trains a model on those battles, and a React app uses the generated model in
the browser to recommend heroes and skills.

- [GAME_RULE.md](GAME_RULE.md): the draft rules.
- [DEVELOPMENT.md](DEVELOPMENT.md): the workflow and which tests to run.
- [web/README.md](web/README.md): the web app and Cloudflare setup.

## Commands

| Command | What it does |
|---|---|
| `make sync` | Install Python dependencies (uv, Python 3.12). |
| `make build-recommendation` | Rebuild `web/src/recommendation_data.json`. |
| `make evaluate-recommendation` | Run the full evaluation. It writes an ignored report and never changes production weights. |
| `make sync-yanwu-corpus` | Download and verify the pinned Yanwu corpus into `.cache/yanwu/`. |
| `make build-telemetry EXPORT=<sql>` | Update telemetry from a D1 export. |
| `make import-yanwu [APPLY=1]` | Check the guide workbook, or import it with `APPLY=1`. |
| `make web` | Start the dev server on http://localhost:3000. |
| `make test-data`, `make test-telemetry` | Python tests. |

## Recommendation pipeline

- `data/build_recommendation_data.py` trains a regularized logistic
  (Bradley-Terry) model on battles from `data/battles/` (own captures),
  `data/web-upload/` (community reports from before uploads closed), and the pinned Yanwu corpus
  (`data/external/yanwu-release.json`, CC BY 4.0). It writes
  `web/src/recommendation_data.json`; never edit that file by hand.
- The browser scores options with `web/src/services/recommendationEngine.ts`.
  Build feature ids only through `recommendationModel.ts`, so they match the
  Python builder.
- The own captures come from 州内淘汰赛, a late stage that only stronger teams
  reach, so the builder adds an appearance prior: heroes and skills seen more
  often than expected get a bonus. Model decisions are recorded in
  [data/evaluation/](data/evaluation/).
- The draft page's 队伍编排 allocates 当前阵容 into three teams
  (`web/src/services/teamAllocation.ts`).
- Guide data in `web/public/game-data/database.json` is attributed to 但丁与你.
  Never publish the workbook's contact details.

## Battle data

- Own captures: 州内淘汰赛 reports read from the emulator cache by the local
  `sgmdtx-research` tools. Each file keeps the existing team/winner/season
  shape plus `match` (stage, region, round, series, 对局, 部队, players) and
  per-hero 红度 support marks (`red`, `skillRed`, `support`, `supportSkills`).
- Community reports: uploads are closed. `data/web-upload/` and the
  `/contributors` leaderboard (`web/public/game-data/web_upload_data.json`) are
  frozen.
- Telemetry: `POST /api/telemetry/rounds` writes to D1, and the weekly
  `update-telemetry-data.yml` workflow updates `data/telemetry_state.json` and
  `web/public/game-data/telemetry_data.json`. Raw rows are never committed and
  are deleted from D1 after 14 days.

## Layout

- `data/`: battles and the offline builders.
- `web/`: the React app and the Cloudflare Pages telemetry function.
