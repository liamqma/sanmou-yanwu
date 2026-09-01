---
name: verify-sanmou
description: Verify Sanmou's user-visible web behavior with the existing Playwright journeys, state fixtures, production-prerender checks, traces, screenshots, and visual audit. Use when implementing or reviewing UI flows, reproducing browser regressions, collecting runtime proof, or sweeping the product feature map.
compatibility: Requires Node.js 22, pnpm 11, Playwright Chromium, curl, and lsof for launch and doctor ownership checks.
---

# Verify Sanmou

Use the real browser surface under `web/` to close the implementation loop. This
skill complements the final `no-mistakes` shipping gate; it does not replace the
required checks in `web/AGENTS.md`.

The primary surface is the React app. For offline builders, OCR, or the local
model-backed agent, follow the workspace matrix in `DEVELOPMENT.md` instead of
forcing those workflows through a browser.

Do **not** invoke or inspect `sanmouDebug()` as a general runtime-verification
shortcut. That export is a player-initiated diagnostic: a player copies it and
gives it to an agent when a weight or recommendation falls outside human
expectations. If the user supplies such an export, treat it as investigation
input, not as runtime proof. Existing automated tests may regression-check the
export contract; its payload does not prove unrelated behavior.

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
(
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root/web"
pnpm exec playwright test tests/setup.spec.js --workers=1
)
```

Playwright starts `pnpm start` when port 3000 is free and tears down the process
it started. Before allowing it to reuse an existing port, run the doctor below.
A responsive visual audit needs a separately managed server:

```bash
(
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
expected_cwd="$(cd "$repo_root/web" && pwd -P)"
evidence_root="$(mktemp -d "${TMPDIR:-/tmp}/sanmou-verification.visual.XXXXXX")"
vite_log="$evidence_root/vite.log"

cd "$repo_root/web"
pnpm start --host 127.0.0.1 >"$vite_log" 2>&1 &
vite_pid=$!
# shellcheck disable=SC2329 # Invoked indirectly by the EXIT trap below.
cleanup() {
  kill "$vite_pid" 2>/dev/null || true
  wait "$vite_pid" 2>/dev/null || true
}
launch_failed() {
  printf '%s\n' "$1" "Vite log retained at $vite_log" >&2
  tail -n 200 "$vite_log" >&2 || true
  exit 1
}
is_descendant_of() {
  local candidate="$1"
  local ancestor="$2"
  local parent
  while [[ "$candidate" =~ ^[0-9]+$ ]] && (( candidate > 1 )); do
    test "$candidate" = "$ancestor" && return 0
    parent="$(ps -o ppid= -p "$candidate" 2>/dev/null | tr -d '[:space:]' || true)"
    test -n "$parent" || return 1
    candidate="$parent"
  done
  return 1
}
trap cleanup EXIT

ready=false
deadline=$((SECONDS + 30))
while (( SECONDS < deadline )); do
  kill -0 "$vite_pid" 2>/dev/null || launch_failed 'Vite exited before becoming ready.'
  if curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:3000/ >/dev/null; then
    ready=true
    break
  fi
  sleep 0.25
done
test "$ready" = true || launch_failed 'Timed out waiting for Vite on port 3000.'

listener_pid=""
for candidate in $(lsof -nP -tiTCP:3000 -sTCP:LISTEN 2>/dev/null || true); do
  if is_descendant_of "$candidate" "$vite_pid"; then
    listener_pid="$candidate"
    break
  fi
done
test -n "$listener_pid" || launch_failed 'Port 3000 is not owned by this Vite launch.'
actual_cwd="$(lsof -a -p "$listener_pid" -d cwd -Fn | sed -n 's/^n//p')"
test "$actual_cwd" = "$expected_cwd" || launch_failed 'The Vite listener has an unexpected working directory.'
page="$(curl -fsS --connect-timeout 1 --max-time 2 http://127.0.0.1:3000/)" || launch_failed 'The Vite listener stopped responding.'
grep -Fq '三国谋定天下演武配将与战法推荐' <<<"$page" || launch_failed 'Port 3000 serves an unexpected page.'

printf 'Evidence directory: %s\n' "$evidence_root"
VISUAL_AUDIT_BASE_URL=http://127.0.0.1:3000 \
  node scripts/capture-visual-audit.mjs "$evidence_root/visual"
)
```

Use `pnpm build && pnpm preview` only when manually inspecting the exact
production output. The maintained production proof is `pnpm test:prerender`.

## Doctor

Run this read-only preflight whenever port 3000 is already listening, the page
looks stale, or a drive behaves unexpectedly:

```bash
(
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
expected_cwd="$(cd "$repo_root/web" && pwd -P)"
page="$(curl -fsS --connect-timeout 2 --max-time 5 http://127.0.0.1:3000/)"
grep -Fq '三国谋定天下演武配将与战法推荐' <<<"$page"
pids="$(lsof -nP -tiTCP:3000 -sTCP:LISTEN | sort -u)"
test -n "$pids"
test "$(printf '%s\n' "$pids" | wc -l | tr -d '[:space:]')" -eq 1
pid="$pids"
actual_cwd="$(lsof -a -p "$pid" -d cwd -Fn | sed -n 's/^n//p')"
test "$actual_cwd" = "$expected_cwd"
cd "$repo_root/web"
pnpm exec playwright --version
)
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
(
set -euo pipefail
repo_root="$(git rev-parse --show-toplevel)"
evidence_root="$(mktemp -d "${TMPDIR:-/tmp}/sanmou-verification.advisor.XXXXXX")"
printf 'Evidence directory: %s\n' "$evidence_root"
cd "$repo_root/web"
pnpm exec playwright test tests/setup.spec.js \
  --workers=1 --trace=on --output="$evidence_root"
)
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

Keep proof outside the repository in a run-unique directory, normally created
with `mktemp -d "${TMPDIR:-/tmp}/sanmou-verification.<feature>.XXXXXX"`. Never
reuse or recursively delete a shared evidence path. Useful artifacts are
Playwright `trace.zip`, test-owned screenshots/downloads, the visual audit's
PNGs and `report.json`, plus the command and exit status. Confirm retained
evidence still exists after cleanup.

## Cleanup

Playwright cleans up a server that it launched. For a manually launched server,
retain its PID and stop only that PID:

```bash
if test -n "${vite_pid:-}"; then
  kill "$vite_pid" 2>/dev/null || true
  wait "$vite_pid" 2>/dev/null || true
fi
```

Never use `killall`, `pkill`, or a process-name match. Never stop an existing
server that failed the doctor ownership check. Cleanup removes run-owned
processes and temporary browser state, but not the evidence directory.

## Maintain the map

When user-visible behavior, entry points, selectors, prerequisites, side
effects, or gotchas change, update the relevant file under
`references/features/` in the same change. Keep entries behavioral and concise;
source architecture belongs in `README.md` and `web/README.md`.
