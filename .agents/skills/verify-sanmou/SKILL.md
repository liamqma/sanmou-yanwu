---
name: verify-sanmou
description: Verify Sanmou's user-visible web behavior with the existing Playwright journeys, state fixtures, production-prerender checks, traces, screenshots, and visual audit. Use when implementing or reviewing UI flows, reproducing browser regressions, collecting runtime proof, or sweeping the product feature map.
compatibility: Requires Node.js 22, pnpm 11, Playwright Chromium, curl, and lsof when reusing a local Vite server.
---

# Verify Sanmou

Use the real browser surface under `web/` to close the implementation loop. This
skill complements the final `no-mistakes` shipping gate; it does not replace the
required checks in `web/AGENTS.md`.

The primary surface is the React app. For offline builders, OCR, or the local
model-backed agent, follow the workspace matrix in `DEVELOPMENT.md` instead of
forcing those workflows through a browser.

Do **not** call `sanmouDebug()` as part of verification. That export is a
player-initiated diagnostic: a player copies it and gives it to an agent when a
weight or recommendation falls outside human expectations. If the user supplies
such an export, treat it as investigation input, not as runtime proof.

## Pick the coverage before driving

1. Read [`references/features/README.md`](references/features/README.md).
2. Read every feature file affected by the change. Include
   [`multi-surface-journeys.md`](references/features/multi-surface-journeys.md)
   when state or navigation crosses routes.
3. Use the file's named Playwright specs and selectors. Do not substitute a
   convenient route-open check for the mapped behavior.
4. While iterating, run the smallest relevant journey. Before completion, run
   all four commands required by `web/AGENTS.md`.

## Launch

Focused dev-server Playwright runs normally own their Vite process:

```bash
cd web
pnpm exec playwright test tests/setup.spec.js --workers=1
```

Playwright starts `pnpm start` when port 3000 is free and tears down the process
it started. Before allowing it to reuse an existing port, run the doctor below.
A responsive visual audit needs a separately managed server:

```bash
mkdir -p /tmp/sanmou-verification/visual
cd web
pnpm start --host 127.0.0.1 > /tmp/sanmou-verification/vite.log 2>&1 &
vite_pid=$!
trap 'kill "$vite_pid" 2>/dev/null || true; wait "$vite_pid" 2>/dev/null || true' EXIT
until curl -fsS http://127.0.0.1:3000/ >/dev/null; do sleep 0.25; done
node scripts/capture-visual-audit.mjs /tmp/sanmou-verification/visual
```

Use `pnpm build && pnpm preview` only when manually inspecting the exact
production output. The maintained production proof is `pnpm test:prerender`.

## Doctor

Run this read-only preflight whenever port 3000 is already listening, the page
looks stale, or a drive behaves unexpectedly:

```bash
repo_root="$(git rev-parse --show-toplevel)"
expected_cwd="$(cd "$repo_root/web" && pwd -P)"
curl -fsS http://127.0.0.1:3000/ | grep -Fq '三国谋定天下演武配将与战法推荐'
pid="$(lsof -nP -tiTCP:3000 -sTCP:LISTEN | head -n 1)"
test -n "$pid"
actual_cwd="$(lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p' | head -n 1)"
test "$actual_cwd" = "$expected_cwd"
(cd "$repo_root/web" && pnpm exec playwright --version)
```

If any check fails, do not drive or kill the unknown process. Either ask its
owner to stop it or use a clean environment. After any surprising browser
failure, re-run the doctor and restart the instance that this run owns before
retrying.

## Drive

Prefer existing behavior-level specs and stable ARIA roles, labels,
`data-testid` values, and route paths. `web/tests/helpers.js` owns deterministic
`localStorage` seeding for later rounds and Team Builder prerequisites.

A focused proof with a retained trace looks like:

```bash
rm -rf /tmp/sanmou-verification/advisor
cd web
pnpm exec playwright test tests/setup.spec.js \
  --workers=1 --trace=on --output=/tmp/sanmou-verification/advisor
```

Use `-g '<exact or distinctive test title>'` to narrow a large spec while
iterating. Run a whole mapped spec when the change can affect several modes.
Never use fixed sleeps when a heading, dialog, progress indicator, request, or
persisted reload state can be observed instead.

For a broad visual regression sweep, run `capture-visual-audit.mjs`. It captures
all public routes at desktop, tablet, and mobile sizes plus representative draft,
Team Builder, loading, dialog, and completion states. Its `report.json` fails on
page errors, horizontal overflow, or disallowed large dark surfaces.

## Evidence

A convincing proof must:

- exercise the production user path through visible controls, keyboard input,
  normal routing, and the same persistence or network boundary the app uses;
- show the trigger and stable outcome, not only a final open page;
- verify meaningful side effects such as a request payload, downloaded file,
  clipboard result, saved state after reload, or route transition;
- cover affected success, validation/error, empty, cancellation, responsive,
  and persistence paths listed in the relevant feature file;
- use mocks only at an existing production boundary, such as intercepting
  `/api/battles`; never submit verification data to the deployed service; and
- report any unreachable path and its concrete prerequisite instead of silently
  skipping it.

Keep proof outside the repository, normally under
`/tmp/sanmou-verification/<feature>/`. Useful artifacts are Playwright
`trace.zip`, test-owned screenshots/downloads, the visual audit's PNGs and
`report.json`, plus the command and exit status. Confirm retained evidence still
exists after cleanup.

## Cleanup

Playwright cleans up a server that it launched. For a manually launched server,
retain its PID and stop only that PID:

```bash
kill "$vite_pid" 2>/dev/null || true
wait "$vite_pid" 2>/dev/null || true
```

Never use `killall`, `pkill`, or a process-name match. Never stop an existing
server that failed the doctor ownership check. Cleanup removes run-owned
processes and temporary browser state, but not the evidence directory.

## Maintain the map

When user-visible behavior, entry points, selectors, prerequisites, side
effects, or gotchas change, update the relevant file under
`references/features/` in the same change. Keep entries behavioral and concise;
source architecture belongs in `README.md` and `web/README.md`.
