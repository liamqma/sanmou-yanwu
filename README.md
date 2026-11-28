# 三国谋定天下 (演武) battle analytics

A personal analytics tool for the mobile game 三国谋定天下 (演武). Battle reports
are read from the emulator's client cache into battle JSON, a neural lineup
model is trained on those battles, and a React app runs the exported model in
the browser to build teams and recommend heroes and skills.

- [GAME_RULE.md](GAME_RULE.md): the draft rules.
- [DEVELOPMENT.md](DEVELOPMENT.md): the workflow and which tests to run.
- [web/README.md](web/README.md): the web app and Cloudflare setup.

## Commands

| Command | What it does |
|---|---|
| `make sync` | Install Python dependencies (uv, Python 3.12). |
| `make train-lineup` | Train the lineup model into `.cache/lineup-net/final` (needs the `neural` dependency group). |
| `make export-lineup` | Export the trained model and its parity fixtures to `web/`. |
| `make sync-yanwu-corpus` | Download and verify the pinned Yanwu corpus into `.cache/yanwu/`. |
| `make build-telemetry EXPORT=<sql>` | Update telemetry from a D1 export. |
| `make import-yanwu [APPLY=1]` | Check the guide workbook, or import it with `APPLY=1`. |
| `make web` | Start the dev server on http://localhost:3000. |
| `make test-data`, `make test-telemetry`, `make test-lineup` | Python tests. |

## Recommendation pipeline

- `data/lineup_net.py` trains a small transformer over one team (3 heroes and
  their 6 extra skills) on battles from `data/battles/` (own captures),
  `data/web-upload/` (community reports from before uploads closed), and the
  pinned Yanwu corpus (`data/external/yanwu-release.json`, CC BY 4.0). It
  scores how likely players are to field a team and how strong the team is.
- `data/export_lineup_model.py` writes `web/public/game-data/lineup_model.bin`
  and `lineup_model.json`, and the fixtures of the parity test; never edit
  those files by hand.
- The browser runs the same model and search in a Web Worker
  (`web/src/services/lineupModel.ts`, `lineupSearch.ts`). They mirror
  `data/lineup_net.py`; change both together and re-export.
- One search serves three features: 队伍编排 (best three teams for 当前阵容),
  the three-choice recommendation (best lineup with each offered set), and the
  support pick (best lineup with each candidate card).
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
