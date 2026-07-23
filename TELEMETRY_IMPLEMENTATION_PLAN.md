# Telemetry Implementation Plan

This document is the approved implementation plan for anonymous draft-choice
telemetry. The recommendation system remains client-side: the paired battle
model is the only signal that chooses the recommended option. Telemetry records
offers, paired-model scores, and confirmed player choices so a separate player
preference probability (`P`) and descriptive analytics can be built later.

There are no battle outcomes in website telemetry. The data must never be used
to estimate win probability, causal strength, or whether following a
recommendation helped.

## Product decisions

- Telemetry is always enabled; there is no login or consent flow.
- The site stores no account, IP address, user agent, free text, or durable
  cross-session identifier in its D1 schema.
- Each browser tab keeps the current game's random `session_id` in memory and
  `sessionStorage`; each confirmed round receives an idempotent random
  `event_id`. The capped retry queue remains shared in `localStorage`.
- The recommendation is always visible, so no `recommendation_shown` field is
  recorded.
- Team formation, battle-result, completion, abandonment, and correction
  telemetry are out of scope for the initial implementation. Optional support
  selections are recorded separately as model context; they are not mixed into
  the ordinary hero and skill pool.
- Hero and skill display names are recorded together with `catalog_version`.
  Explicit immutable item IDs can be added later if catalog renaming becomes a
  real requirement.
- Telemetry failure must never block local recommendation or gameplay.

## Architecture

1. The browser computes the paired-model recommendation locally.
2. When the player confirms a round choice, it writes a `round` event to a
   capped local retry queue.
3. The browser posts queued events to `/api/telemetry/rounds` without awaiting
   the request as part of the game transition.
4. A Cloudflare Pages Function validates and inserts events idempotently into
   D1 through the `TELEMETRY_DB` binding.
5. A weekly GitHub Action exports D1, builds a deterministic aggregate/model
   artifact, commits it to `master`, and lets the existing Cloudflare Pages Git
   integration deploy it.
6. The browser eventually reads that artifact as a static asset. Static player
   preference and Analytics reads do not query D1 or invoke a Function.

## Round event contract (schema version 1)

```ts
interface RoundTelemetryEvent {
  event_id: string;
  session_id: string;
  client_ts: string;
  round_number: number;
  round_type: 'hero' | 'skill';
  schema_version: 1;
  model_version: string;
  catalog_version: string;
  pool_before: {
    heroes: string[];
    skills: string[];
    hero_support?: string;
    skills_support?: string[];
  };
  offered_sets: string[][];
  paired_scores: number[];
  recommended_index: number;
  chosen_index: number;
  preference_model_version: string | null;
  preference_probabilities: number[] | null;
}
```

The preference fields are `null` until the later preference-model phase. Once
`P` is displayed, those fields record exactly which probabilities were shown so
the weekly builder can measure calibration and feedback effects.

## Phase 1 — collection foundation

Status: implemented.

- Add the D1 migration for one append-only `round_telemetry` table.
- Add `POST /api/telemetry/rounds`, accepting one batch of at most eight events
  and 64 KiB.
- Strictly validate UUIDs, timestamps, round/type/set sizes, finite scores,
  indices, versions, preference probabilities, and unexpected fields.
- Deduplicate by `event_id` and enforce at most one row per
  `(session_id, round_number)`.
- Add an always-on browser telemetry service backed by a capped `localStorage`
  retry queue.
- Start a new tab-owned anonymous telemetry session when a new game begins.
- Record an event immediately before the confirmed choice updates game state.
- Retry queued events on later choices, page initialization, and browser
  `online` events.
- Add a short anonymous-collection disclosure to the game setup screen.
- Document the required `TELEMETRY_DB` dashboard binding and migration command.

## Phase 2 — weekly GitHub builder

Status: implemented.

- Add `.github/workflows/update-telemetry-data.yml` with weekly schedule and
  manual dispatch triggers only.
- Give the workflow `contents: write` so it can commit a changed generated
  artifact to `master`.
- Store a least-privilege Cloudflare `D1 Read` API token in the
  `CLOUDFLARE_API_TOKEN` GitHub Actions secret. Store account ID and database
  name as non-secret repository variables.
- Export only `round_telemetry` into runner-temporary storage; never upload or
  commit raw telemetry.
- Build `web/public/game-data/telemetry_data.json` deterministically and commit
  only when its content changes.
- Fail closed on complete D1 schema drift (column metadata plus constraints),
  malformed data, duplicate logical events, unknown catalog items, catalog
  mismatch, ineligible skill offers/support picks, scores or tie-breaks that do
  not exactly match the recorded current/retained recommendation model, failed
  tests, or invalid Phase 2 model output. Retain immutable historical model
  artifacts before a recommendation-model rollout.

The Phase 2 artifact contains only aggregate event/session/version/round and
position counts. `preference_model` is explicitly `null` until Phase 3 adds the
regularized conditional-choice model and its held-out validation metrics.

## Phase 3 — player preference and Analytics

- Train a regularized conditional-choice model over each three-option round.
- Predict `P(option | current pool, all offers, round, paired scores)` and
  normalize the three probabilities to 100%.
- Keep the paired-model maximum as the sole AI recommendation.
- Show paired score and player `P` together on every option once evidence is
  sufficient.
- Highlight **model–player disagreement** when their top options differ and the
  player-probability margin is meaningful. Do not subtract paired scores and
  probabilities directly because they use different units.
- Add offer count/rate, picked-when-offered rate, recommendation acceptance,
  round agreement, position bias, score-margin behavior, and largest
  model–player disagreements to Analytics.
- Suppress low-support percentages and publish held-out quality/calibration
  metrics in the generated artifact.

## Phase 4 — operations and retention

- Monitor Pages Function requests plus D1 row writes and storage.
- Add a Cloudflare dashboard rate-limiting rule for
  `/api/telemetry/rounds`; add Turnstile only if actual abuse warrants it.
- Aggregate and remove raw rows older than the chosen retention window before
  the free D1 database approaches its storage limit.
- Introduce immutable item IDs only if catalog renaming makes versioned display
  names insufficient.

## Validation

Phase 1 must pass:

- Function validation/idempotency tests with an in-memory D1 test double.
- Browser queue, session, retry, and event-construction tests.
- Game-flow tests proving logging is non-blocking and captures the pre-choice
  pool, all offers, scores, recommendation, and confirmed choice.
- `make test-data` when the data workspace changes.
- From `web/`: `npm run typecheck`, `npm test`, `npm run test:e2e`, and
  `npm run build`.
- The repository `no-mistakes` gate with `NO_MISTAKES_TELEMETRY=off` when the
  CLI is available.

Phase 2 must additionally pass:

- Telemetry-builder tests covering byte determinism, empty exports, atomic
  writes, fail-closed schema/catalog/model contracts, invalid-event
  quarantine, and future preference probability validation.
- A build from an empty schema producing the checked-in initial aggregate.
- Workflow review confirming that the raw SQL export stays under
  `$RUNNER_TEMP`, only the generated JSON is staged, and malformed input or test
  failures prevent a commit.
