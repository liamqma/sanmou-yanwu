# Sanmou Agent

Local TypeScript service for Sanmou's LangGraph workflows. The first workflow
fills hero-position blanks left by the conservative browser-side team builder.
Candidate retrieval and validation are deterministic; one high-effort model
node compares skill semantics, camp bonuses, bonds, formations, known teams,
and learned battle evidence. Invalid model output is retried with validation
feedback up to three attempts; if all attempts fail, every blank remains blank.

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

## Hero completion graph

The milestone-two graph runs these named nodes:

```text
prepare_context
      |
      v
reason_about_heroes  (one model call per attempt, reasoning_effort=high)
      |
      v
validate_decision
      | invalid/unavailable and attempts remain
      +---------------------------> reason_about_heroes
      |
      | third invalid attempt
      v
END (incomplete; original blanks preserved)
```

Run the checked-in edited-lineup fixture. It preserves one complete team and
fills the six hero positions in the other two teams from the unused hero pool:

```bash
pnpm recommend fixtures/partial-teams.json
```

`availableHeroes` may contain only the unused candidate pool; filled heroes do
not need to be repeated. The fixture also retains `availableSkills` for a later
skill-completion milestone, but the current graph does not assign them.

The workflow fills hero positions only. Existing heroes, rows, formations, and
skill slots are preserved. A result reports `status: "complete"` when every
blank is validated, or `status: "incomplete"` after three failed attempts; an
incomplete result never applies a partial assignment. Skill-slot completion is
intentionally deferred to a later graph node.

## Formation and position graph

After hero completion succeeds, the formation workflow fills only missing
formations and front/back rows. It retrieves the eight catalog formation
effects plus hero stats, signature and assigned skill descriptions, active
bonds, exact known-team references, and learned hero/pair evidence.

```text
prepare_formation_context
      |
      v
reason_about_formations  (one high-effort model call per attempt)
      |
      v
validate_formations
      | invalid/unavailable and attempts remain
      +---------------------------> reason_about_formations
      |
      | third invalid attempt
      v
END (incomplete; missing formations and rows remain null)
```

The command accepts the complete JSON output of `pnpm recommend`. It refuses to
run while any hero position is still blank:

```bash
pnpm recommend fixtures/partial-teams.json > /tmp/sanmou-heroes.json
pnpm formation /tmp/sanmou-heroes.json
```

Existing heroes, skills, formations, and rows are immutable. A valid response
must cover every team with missing layout data, use only catalog formations,
and repeat all three rows so preserved values can be validated. After three
invalid attempts, the result is `incomplete` and the original teams are returned
without partial layout changes.

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
| `SANMOU_REASONING_EFFORT` | `high` | Effort for the semantic hero-selection and formation reasoning nodes |
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
smoke`, `pnpm recommend fixtures/partial-teams.json`, and `pnpm formation
<hero-result.json>` are explicit live integration checks and consume tokens.
