# Web app

The React app (Vite, MUI, TypeScript) for the draft advisor. Recommendation and
analytics run in the browser: `src/services/api.ts` is an in-memory shim, not
an HTTP client. The Pages Functions in `functions/api/` only write telemetry
and battle reports to D1.

## Getting started

You need Node.js 22 (`.node-version`) and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm start       # Dev server on http://localhost:3000
pnpm typecheck
pnpm test        # Vitest
pnpm test:e2e    # Playwright (first run: pnpm exec playwright install)
pnpm build       # Prerendered build in build/ for Cloudflare Pages
```

## Routes

| Route | Page |
|---|---|
| `/` | Draft advisor |
| `/analytics` | Model and telemetry analytics |
| `/team-builder` | Relationships within the current roster |
| `/contribute` | Submit a battle report |
| `/contributors` | Contributor leaderboard |
| `/guides/yanwu` | 演武攻略 guide |

## Cloudflare setup

1. Create a D1 database and bind it to the Pages project as `TELEMETRY_DB`.
2. From `web/`, apply the migrations:

   ```bash
   pnpm dlx wrangler@4.112.0 d1 execute <database-name-or-id> --remote \
     --file=migrations/0001_round_telemetry.sql --yes
   pnpm dlx wrangler@4.112.0 d1 execute <database-name-or-id> --remote \
     --file=migrations/0003_web_battle_submissions.sql --yes
   ```

3. For the scheduled workflows, add the `CLOUDFLARE_API_TOKEN` secret (D1 Read
   and Edit), add the `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_D1_DATABASE_NAME`
   variables, and let GitHub Actions write repository contents.

## Debugging recommendations

On the draft page, run `copy(sanmouDebug())` in the browser console, then paste
the JSON into an agent together with the result you expected.
