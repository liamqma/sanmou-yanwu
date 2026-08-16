# Sanmou Agent

Local TypeScript service for Sanmou's LangGraph team recommendation. One public
`recommend` workflow fills the hero, formation/row, and skill blanks left by
the evidence-only browser-side team builder, then reviews the completed lineup.
Retrieval and validation are deterministic; highest-effort model nodes compare
skill semantics, camp bonuses, bonds, formations, known teams, and learned
battle evidence.

The agent talks to an OpenAI-compatible Responses API provider configured
through environment variables. The adapter posts to
`<AI_BASE_URL>/responses`, always disables upstream storage with `store: false`,
and maps the local `messages`, `reasoningEffort`, and `maxCompletionTokens`
contract to Responses `input`, `reasoning.effort`, and `max_output_tokens`. It
normalizes `output_text`, response status, and token usage back into the same
local completion contract. Provider authentication and startup are
intentionally kept outside this repository.

## Runtime architecture

```text
CLI, local HTTP caller, or enabled browser experiment
          |
          v
Sanmou Agent (127.0.0.1:8790)
          |
          v
OpenAI-compatible Responses provider (127.0.0.1:8787/v1)
```

The public Sanmou website does not start this service and consumes no model
tokens.

The HTTP server binds only to loopback. Browser access is restricted to the
health endpoints and `POST /v1/team-recommendations`; the generic `/v1/chat`
endpoint remains available only to callers that do not send a browser
`Origin`. The OpenAI-compatible Responses provider is never called directly by
the web app.

## Team recommendation graph

`pnpm recommend` invokes one parent graph with completion stages followed by an
advisory review:

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
review_team
      |
      v
END (one combined recommendation and review)
```

An already-complete input skips all completion stages and routes directly to
`review_team`:

```text
START --> review_team --> END
```

Run the checked-in edited-lineup fixture. It preserves one complete team and
recommends heroes, formations, rows, and extra skills for the remaining blanks:

```bash
pnpm recommend fixtures/partial-teams.json
```

Review a checked-in complete lineup without changing it:

```bash
pnpm recommend fixtures/complete-teams.json
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
- Team review is read-only. It reports grounded strengths, team warnings, and
  cross-team warnings using the completed layout, skill semantics, formation
  effects, camps, bonds, known teams, and learned evidence. A model-generated
  warning is included only when the supplied context supports a concrete,
  feasible lineup alternative; observation-only advice is suppressed rather
  than presented as a warning. Suggested actions may recommend a change, but
  the review never loops back to recommendation nodes or silently applies it.

The review result has its own `status`. If all three review attempts fail
because the provider output is malformed or cites unavailable evidence, the
recommendation remains `status: "complete"` and the nested review reports
`status: "unavailable"`. Lineup weaknesses are findings, not retry reasons.
The review prompt and validator share the same category, evidence-source, and
hard-limit constants. The prompt targets a smaller result inside those limits;
retries receive only a bounded list of path-specific corrections, and an
unavailable result never exposes the provider's raw validation dump.

The HTTP server and `recommend` CLI emit one compact JSON diagnostic per review
attempt. It contains prompt character/byte counts, duration, token usage when
the provider supplies it, finish reason, accepted/rejected outcome, and concise
validation errors. Full prompts and model responses are never logged. Example:

```json
{"event":"team_review_attempt","attempt":1,"promptCharacters":12000,"promptBytes":17000,"durationMs":42000,"finishReason":"stop","usage":{"promptTokens":7000,"completionTokens":1800,"totalTokens":8800},"outcome":"accepted","validationErrors":[]}
```

The model-facing contexts are normalized to keep local calls focused: hero
facts and equivalent candidate sets are shared across blank slots, the
formation catalog appears once per formation call, and skill facts plus S
evidence appear once in a shared catalog while only sparse HS/SP evidence is
attached to individual heroes. Production requests use compact JSON; the
deterministic retrieval and validation boundaries are unchanged.

Each internal reasoning loop makes at most three model calls. A partial input
that needs every stage normally uses four calls and has a worst case of twelve
calls only if all four stages each need three attempts. A failed hero,
formation, or skill stage ends earlier, so later calls are skipped. An
already-complete input normally uses one review call and at most three.

## Setup

```bash
cd agent
pnpm install --frozen-lockfile
cp .env.example .env
```

Start the configured OpenAI-compatible Responses provider separately, then
verify the model connection directly from the agent client:

```bash
pnpm smoke
```

The agent and every model-backed recommendation and review stage default to
`gpt-5.6-sol` with literal `xhigh` reasoning effort. Change `AI_MODEL` or
`SANMOU_REASONING_EFFORT` in `.env` to compare another setup.

## Run the local HTTP server

```bash
pnpm start
```

Check liveness:

```bash
curl http://127.0.0.1:8790/health/live
```

Exercise the same preflight that the production website sends:

```bash
curl --include --request OPTIONS \
  http://127.0.0.1:8790/v1/team-recommendations \
  -H 'origin: https://sanmouyanwu.com' \
  -H 'access-control-request-method: POST' \
  -H 'access-control-request-headers: content-type'
```

Review the complete fixture through the browser-facing endpoint. A partial
fixture uses the same route and runs the required completion stages before
review:

```bash
curl --silent --show-error --fail-with-body \
  http://127.0.0.1:8790/v1/team-recommendations \
  -H 'origin: https://sanmouyanwu.com' \
  -H 'content-type: application/json' \
  --data-binary @fixtures/complete-teams.json
```

`availableHeroes` and `availableSkills` in this request are unused pools, not
the entire owned roster. The endpoint validates the same
`TeamRecommendationInput` contract as the CLI and returns the same
`TeamRecommendationResult`.

Send a chat request through the agent and its configured provider:

```bash
curl --silent --show-error --fail-with-body \
  http://127.0.0.1:8790/v1/chat \
  -H 'content-type: application/json' \
  -d '{
    "messages": [
      {"role": "user", "content": "Reply with exactly: agent-http-ok"}
    ],
    "reasoningEffort": "xhigh",
    "maxCompletionTokens": 64
  }'
```

Do not add an `Origin` header to generic chat calls. Browser-origin requests to
`/v1/chat` are deliberately rejected even when that origin may call team
recommendations.

## Browser access

The server responds to JSON preflight requests only when `Origin` exactly
matches `SANMOU_AGENT_ALLOWED_ORIGINS`. It never uses a wildcard, sends no CORS
credentials, and continues to accept local curl/CLI calls that have no
`Origin`. Keep the default loopback bind; non-loopback host values are rejected
at startup.

The web integration is a private, hidden experiment. Start this Agent, then
open `/team-builder?local-agent=1` once to enable and remember the Agent button
in that browser. Use `/team-builder?local-agent=0` to hide it again. Enabling
the flag makes no network request; the page contacts `127.0.0.1:8790` only
after an explicit click on `智能补全阵容` or `智能复盘阵容`.

Chrome 142 and later also asks the user for Local Network Access permission
when a public page calls loopback. The web integration must initiate its first
health or recommendation request from an explicit click so ordinary visitors
are never prompted. Desktop Chrome is the supported browser for this private
experiment.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SANMOU_AGENT_HOST` | `127.0.0.1` | Local server bind address |
| `SANMOU_AGENT_PORT` | `8790` | Local server port |
| `SANMOU_AGENT_ALLOWED_ORIGINS` | production site plus local dev/preview origins | Exact browser origins allowed to call health and team recommendations |
| `AI_BASE_URL` | `http://127.0.0.1:8787/v1` | OpenAI-compatible Responses provider base URL |
| `AI_MODEL` | `gpt-5.6-sol` | Default model ID |
| `SANMOU_REASONING_EFFORT` | `xhigh` | Responses API effort for hero, formation/row, skill, and review reasoning nodes |
| `AI_TIMEOUT_MS` | `600000` | Provider request timeout; allows for buffered xhigh responses |
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
smoke`, `pnpm recommend fixtures/partial-teams.json`, and `pnpm recommend
fixtures/complete-teams.json` are explicit live integration checks and consume
tokens.
