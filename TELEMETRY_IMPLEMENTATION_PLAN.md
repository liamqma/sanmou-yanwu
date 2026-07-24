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
5. A weekly GitHub Action exports the complete D1 table, builds a deterministic
   aggregate/model artifact plus an internal aggregate-only checkpoint, commits
   those two files together to `master`, and lets the existing Cloudflare Pages
   Git integration deploy the public artifact.
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
retained preference models can later reproduce them for calibration and
feedback analysis without trusting client-reported probabilities directly.

## Phase 1 — collection foundation

Status: implemented.

- Add the D1 migration for one append-only `round_telemetry` table.
- Add `POST /api/telemetry/rounds`, accepting one batch of at most eight events
  and 64 KiB.
- Strictly validate UUIDs, timestamps, round/type/set sizes, finite scores,
  indices, versions, preference probabilities, and unexpected fields, rejecting
  events whose pool or offered sets contain duplicate or mutually overlapping
  items (the browser constructor applies the same check).
- Deduplicate by `event_id` and enforce at most one row per
  `(session_id, round_number)`.
- Add an always-on browser telemetry service backed by a capped `localStorage`
  retry queue.
- Start a new tab-owned anonymous telemetry session when a new game begins.
- Record an event immediately before the confirmed choice updates game state.
- Retry queued events on later choices, page initialization, and browser
  `online` events.
- Document the required `TELEMETRY_DB` dashboard binding and migration command.

## Phase 2 — weekly GitHub builder

Status: complete.

- Add `.github/workflows/update-telemetry-data.yml` with weekly schedule and
  manual dispatch triggers only.
- Give the workflow `contents: write` so it can commit a changed generated
  artifact to `master`.
- Store the existing account-scoped Cloudflare token with `D1 Read` and D1
  `Edit`/`Write` permissions in the `CLOUDFLARE_API_TOKEN` GitHub Actions
  secret. The write permission is reserved for the separately reviewed future
  retention rollout; the observation workflow does not delete rows. Store
  account ID and database name as non-secret repository variables.
- Export only `round_telemetry` into runner-temporary storage; never upload or
  commit raw telemetry.
- Build `web/public/game-data/telemetry_data.json` deterministically and commit
  only when its content changes.
- Fail closed on contract failures that invalidate the whole export: complete
  D1 schema drift (column metadata plus constraints), duplicate logical events,
  catalog mismatch, unsupported event schema version, a model version outside
  the retained registry, scores or tie-breaks that do not exactly match the
  recorded current/retained recommendation model, failed tests, or invalid
  Phase 2 model output.
- Quarantine — rather than fail closed on — individual malformed or impossible
  events (unknown catalog items, ineligible skill offers/support picks, offers
  that overlap the current pool or support selection), skipping them while still
  aggregating the valid rows and publishing only an aggregate
  `invalid_event_count`.
- Retain immutable historical model artifacts before a recommendation-model
  rollout.

The Phase 2 schema contains only aggregate event/session/version/round and
position counts, with `preference_model` explicitly `null`. Phase 3 upgrades
the artifact to schema v3 and adds the regularized conditional-choice model,
held-out validation metrics, and privacy-preserving choice aggregates.

## Phase 3 — player preference and Analytics

Status: in progress.

- Train a regularized conditional-choice model over each three-option round.
- Predict `P(option | current pool, all offers, round, paired scores)` and
  normalize the three probabilities to 100%.
- Keep the paired-model maximum as the sole AI recommendation.
- Show paired score and `玩家选择概率` together on every option once evidence
  is sufficient, marking the highest-probability option as `玩家选择最高`.
- Highlight **model–player disagreement** when their top options differ and the
  player-probability margin is meaningful, with a brief non-causal explanation
  derived from the strongest player-readable model contributions. Do not
  subtract paired scores and probabilities directly because they use different
  units.
- Publish offer/pick, recommendation-acceptance, round, position, score-margin,
  and model-disagreement aggregates in the artifact. Player-facing Analytics
  emphasizes two 武将/战法 rankings: `游戏最常提供` by offer count and
  `玩家最常选择` by pick count, with offer and picked-when-offered rates.
  Round, position, and score-margin aggregates remain available for diagnostics
  rather than occupying the main player view.
- Retain low-support markers in the artifact for diagnostics, while the
  player-facing all-item rankings show their exact count-derived percentages
  alongside the underlying counts. Publish held-out quality/calibration metrics
  in the generated artifact.

Implementation thresholds are explicit and deterministic: at least 240 valid
choices, 40 anonymous game sessions, 30 choices that differ from the paired
recommendation, and 36 events in the session-grouped holdout. Artifact
item-rate diagnostic markers use a 10-offer threshold. Until every evidence
gate and the held-out quality gate passes, the artifact reports
`insufficient_evidence` or `quality_gate_failed`, publishes no coefficients,
and the option cards show only the paired-model score.

The held-out quality gate requires conditional-choice log loss to improve over
the uniform three-option baseline by at least 0.01. Display probabilities are
quantized together to one decimal percent while retaining an exact 100.0% sum;
those exact values are recorded with the model version. Client-reported
probabilities remain version-counted but are not treated as trusted calibration
metrics until retained preference models can independently reproduce them.

## Phase 4 — operations and retention

Status: incremental checkpoint observation rollout approved; raw-row deletion
is disabled.

- Monitor Pages Function requests plus D1 row writes and storage.
- Add a Cloudflare dashboard rate-limiting rule for
  `/api/telemetry/rounds`; add Turnstile only if actual abuse warrants it.
- Build and commit `data/telemetry_state.json` beside the public artifact. This
  internal checkpoint preserves cumulative anonymous counters, a fixed-size
  distinct-session estimate, online preference-model optimizer state, and a D1
  processing cursor. The shadow model processes rows once in ascending D1 ID
  order with deterministic FTRL-Proximal updates and predict-before-update
  evaluation; it clips only its internal score feature and does not yet change
  the public schema-v3 model. The checkpoint contains no raw event rows,
  event/session IDs, or timestamps. Model features that correlate a pool or
  offer with a choice—and later changes to those features—are persisted only
  after support from at least ten new events in that checkpoint interval.
  Overall model-quality deltas require ten new events, each calibration-bin
  delta requires ten events in that bin, and per-round prediction deltas
  require ten new events in that round. New rare model features and small
  subsequent deltas may therefore lose sub-threshold learning and evaluation
  across checkpoint boundaries; this deliberate privacy trade-off is
  acceptable because the model is indicative rather than mathematically exact.
  Public-style cumulative item counters remain available at every support
  level, matching the Analytics UI.
- During the first observation rollout, continue exporting the complete D1
  table and rebuilding the current public schema-v3 artifact. Validate the
  checkpoint against that independently rebuilt artifact, then stage and
  commit only the checkpoint and public artifact in one commit.
- Record the checked-out `master` SHA at workflow start. Immediately before
  pushing, fetch `origin/master` and require that it still equals that SHA. If
  it changed, fail and rerun the whole build from the new revision rather than
  rebasing a generated checkpoint onto different source data.
- Report only the D1 byte size and the aggregate number of rows older than 14
  days in the workflow summary. Do not print, upload, or commit row-level data.
- Keep every `DELETE` operation absent from the observation workflow. No D1
  row is removed merely because a checkpoint was created.
- Expire browser and server retries after seven days now, ahead of any purge.
  The `localStorage` queue drops events whose `client_ts` is older than seven
  days on load, and the Pages Function rejects a `client_ts` older than seven
  days (or more than five minutes in the future) with `422`. This satisfies the
  event-age prerequisite noted below so a stale queued event cannot later be
  reinserted after its deduplication row is gone.
- Fail closed when the checkpoint catalog version differs from the current
  catalog. During observation, an intentional catalog migration may rebuild
  the checkpoint from the still-complete raw table. Before retention is
  enabled, add an explicit operator-controlled reset/migration path; an
  intentional reset may discard historical telemetry because this site does
  not require lossless history, but it must never happen silently.
- Introduce immutable item IDs only if catalog renaming makes versioned display
  names insufficient.

After the checkpoint has completed its observation period, enable retention in
a separate reviewed change. Before that change, migrate the D1 primary key from
the current reusable `INTEGER PRIMARY KEY` to a permanently monotonic
`INTEGER PRIMARY KEY AUTOINCREMENT`, update the builder's canonical schema, and
test delete-all followed by reinsertion. The intended window keeps raw rows for
at least 14 days, and a purge may remove a row only when both conditions hold:
its ID is no greater than the cursor already committed to `master`, and its
server `received_at` is older than 14 days. The checkpoint and public artifact
must be pushed successfully before any bounded deletion begins. A failed push
deletes nothing; a failed deletion is retried later without recounting the rows
because the committed cursor has already advanced. Browser/server event-age
limits must also be active before purge so a stale queued event cannot be
reinserted after its deduplication row is gone.

The aggregate checkpoint keeps the influence of all validated historical
telemetry after raw rows are removed. Historical raw events are intentionally
not recoverable or re-trainable under a new algorithm, which is acceptable for
this indicative hobby-site telemetry. No R2 archive is required.

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

Phase 3 must additionally pass:

- No-signal, insufficient-evidence, low-support-feature, malformed-artifact,
  deterministic ready-model, and session-held-out quality-gate builder tests.
- TypeScript feature-parity, exact displayed-probability normalization,
  non-blocking telemetry reads, ready schema-v3 parsing, and telemetry feedback
  tests.
- The full web type-check, unit, end-to-end, and production-build gates. The
  weekly workflow reruns the type-check, unit suite, and production build
  against each newly generated public artifact before committing it.

The Phase 4 observation rollout must additionally pass:

- Incremental-checkpoint tests covering bootstrap, replay idempotency,
  cumulative-aggregate equivalence across split batches, invalid-row cursor
  advancement, corrupt or incompatible state, absence of raw identifiers, and
  suppression of optimizer, evaluation, calibration, and per-round prediction
  deltas below ten-event support.
- A full-export build that validates the checkpoint against the independently
  generated public schema-v3 artifact.
- Workflow review confirming that exactly
  `data/telemetry_state.json` and
  `web/public/game-data/telemetry_data.json` are eligible for staging, both are
  committed together when changed, a moved `master` causes failure/rebuild,
  D1 reporting is aggregate-only, and no deletion command exists.
