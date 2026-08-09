# Sanmou Agent

Local TypeScript service for Sanmou's LangGraph team recommendation. One public
`recommend` workflow fills the hero, formation/row, and skill blanks left by
the conservative browser-side team builder. Retrieval and validation are
deterministic; high-effort model nodes compare skill semantics, camp bonuses,
bonds, formations, known teams, and learned battle evidence.

The agent talks to any OpenAI-compatible model provider configured through
environment variables. Provider authentication and startup are intentionally
kept outside this repository.

## Runtime architecture

```text
CLI or local HTTP caller
          |
          v
Sanmou Agent (127.0.0.1:8790)
          |
          v
OpenAI-compatible provider (127.0.0.1:8787/v1)
```

The public Sanmou website does not start this service and consumes no model
tokens.

## Team recommendation graph

`pnpm recommend` invokes one parent graph with three ordered internal stages:

```text
complete_heroes
      | complete
      v
complete_formations
      | complete
      v
complete_skills
      |
      v
END (one combined recommendation)
```

Run the checked-in edited-lineup fixture. It preserves one complete team and
recommends heroes, formations, rows, and extra skills for the remaining blanks:

```bash
pnpm recommend fixtures/partial-teams.json
```

`availableHeroes` may contain only the unused candidate pool; filled heroes do
not need to be repeated. `availableHeroes` and `availableSkills` are
authoritative pools prepared by the caller; the agent does not filter either
pool by season again. `availableSkills` is required by the combined
recommendation input.

Every stage fills only null values and preserves existing heroes, rows,
formations, and skills. A later stage runs only after the preceding stage has a
complete, validated result. If a stage fails three attempts, the combined
result reports `status: "incomplete"` and `stoppedAt` identifies `heroes`,
`formations`, or `skills`. That stage applies no partial decisions, and later
stages do not run. Earlier fully validated stages remain in the result.

The parent graph uses these internal LangGraph subgraphs:

- Hero completion retrieves a legal candidate shortlist for every hero blank,
  including camp boosts, skill descriptions, bonds, known teams, and H/HP
  evidence.
- Formation completion retrieves every catalog formation effect plus hero
  stats, skill descriptions, bonds, known teams, and H/HP evidence, then fills
  formations and all front/back rows.
- Skill completion reasons jointly across every empty extra-skill slot using
  skill descriptions and estimates, hero stats and signatures, team layout,
  bonds, and S/HS/SP evidence. A skill can be used at most once and a hero
  cannot equip its own signature skill.

Each internal reasoning loop makes at most three model calls. Therefore a
recommendation normally uses one call per non-empty stage and has a worst case
of nine calls only if all three stages each need three attempts. A failed hero
or formation stage ends earlier, so the later calls are skipped.

## Setup

```bash
cd agent
pnpm install --frozen-lockfile
cp .env.example .env
```

Start the configured OpenAI-compatible provider separately, then verify the
model connection directly from the agent client:

```bash
pnpm smoke
```

The default model is `gpt-5.6-sol`. Change `AI_MODEL` in `.env` to compare
another model.

## Run the local HTTP server

```bash
pnpm start
```

Check liveness:

```bash
curl http://127.0.0.1:8790/health/live
```

Send a chat request through the agent and its configured provider:

```bash
curl --silent --show-error --fail-with-body \
  http://127.0.0.1:8790/v1/chat \
  -H 'content-type: application/json' \
  -d '{
    "messages": [
      {"role": "user", "content": "Reply with exactly: agent-http-ok"}
    ],
    "reasoningEffort": "high",
    "maxCompletionTokens": 64
  }'
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SANMOU_AGENT_HOST` | `127.0.0.1` | Local server bind address |
| `SANMOU_AGENT_PORT` | `8790` | Local server port |
| `AI_BASE_URL` | `http://127.0.0.1:8787/v1` | OpenAI-compatible provider base URL |
| `AI_MODEL` | `gpt-5.6-sol` | Default model ID |
| `SANMOU_REASONING_EFFORT` | `high` | Effort for hero, formation/row, and skill reasoning nodes |
| `AI_TIMEOUT_MS` | `60000` | Provider request timeout |
| `AI_API_KEY` | unset | Optional bearer token for other providers |

Do not put provider credentials in the React app or a `VITE_*` variable. Keep
them in this local server's ignored `.env` file.

## Development checks

```bash
pnpm typecheck
pnpm test
pnpm build
```

Tests use fake model/provider implementations and consume no tokens. `pnpm
smoke` and `pnpm recommend fixtures/partial-teams.json` are explicit live
integration checks and consume tokens.
