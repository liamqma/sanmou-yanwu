# Sanmou Agent

Local TypeScript service for Sanmou's future LangGraph workflows. This first
milestone establishes the model boundary and HTTP runtime; it deliberately does
not contain team-building logic or LangGraph yet.

The agent is open-source application code. It talks to any OpenAI-compatible
model provider configured through environment variables. For the maintainer's
local setup, that provider is the separate, untracked Atlassian
`ai-gateway-provider` service.

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

## Setup

```bash
cd agent
pnpm install --frozen-lockfile
cp .env.example .env
```

With `atlas slauth server --port 5000` and `ai-gateway-provider` already
running, verify the model connection directly from the agent client:

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
smoke` is the explicit live integration check and does consume a small number
of tokens.
