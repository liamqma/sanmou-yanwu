# Future Model Logging Plan (documentation only — NOT implemented)

This document specifies a **future, opt-in** telemetry contract for the
recommendation system. It is a design note only: **no telemetry is implemented
today**, and this plan must not be taken as license to add logging without a
separate, explicit decision. See [README.md](README.md) for the current
(fully client-side, no-server) architecture.

## Foundational assumption: no outcomes

**Battle results/outcomes will NOT be available from website telemetry.** The
website is a *draft/formation advisor*; the actual battles happen inside the
mobile game, which this site never observes. Any future logging can therefore
capture *what the user was offered, what the model said, and what the user
chose* — but never *whether the chosen roster won*.

This single constraint shapes everything below: the data can improve
**offer-distribution modeling, human-preference imitation, roster optionality,
final-formation alignment, and acceptance/drift monitoring**, but it **cannot**
estimate win probability, causal strength, or whether following a
recommendation actually helped.

## What the data CAN and CANNOT support

CAN:
- **Offer-distribution modeling** — learn the real distribution of offered
  hero/skill sets per round (today the app assumes nothing about future offers).
- **Human-preference imitation** — learn which option a human tends to pick given
  the pool + offers (a *preference* signal, see the caveat below).
- **Roster optionality** — study how pools evolve and which items keep options open.
- **Final-formation alignment** — compare the model's proposed 3×3 formation to
  the human's final formation.
- **Acceptance & drift monitoring** — track how often users accept the top
  recommendation, and detect metagame/catalog drift over time.

CANNOT (do not attempt, and do not let stakeholders assume otherwise):
- Estimate **win probability** — no outcomes are observed.
- Estimate **causal strength** of a hero/skill — no counterfactual, no outcome.
- Determine whether **following a recommendation helped** — no result to compare.

> **Human choice is a weak preference signal, not ground truth.** Users pick
> under bias (habit, UI ordering, the recommendation itself), with imperfect
> knowledge, and sometimes for reasons outside model scope (fun, cosmetics,
> testing). Treat logged choices as *noisy preferences*, never as labels of
> "correct".

## Recommendation influence / shadow mode

Because the recommendation is shown *before* the choice, logged choices are
**contaminated by the recommendation itself** (anchoring). To measure genuine
preference and acceptance honestly:
- Log the **recommendation-shown** state (what was highlighted, model version).
- Support a **shadow mode**: compute + log model scores **without displaying
  them** for a fraction of sessions, so a bias-free preference baseline exists.
- Always record **whether the UI surfaced the recommendation** for each event,
  so downstream analysis can condition on influence.

## Event contract (opt-in, versioned, privacy-minimized)

All events share an envelope:

| Field | Notes |
|---|---|
| `event_id` | Client-generated **idempotent** UUID (dedupe on server by this). |
| `source_id` | Stable per-install random id (rotatable; not a device/user identity). |
| `session_id` | Random per-game-session id. |
| `client_ts` | Client clock (advisory; do not trust ordering across devices). |
| `seq` | Monotonic per-session counter for within-session ordering. |
| `schema_version` | This contract's version. |
| `model_version` | Artifact `schema.version` + a model content hash. |
| `catalog_version` | `catalog.catalog_version` (database hash). |
| `ruleset_version` | Game-rules version (round structure can change). |
| `shadow_mode` | Whether the recommendation was hidden this session. |

Event types (per the [game flow](GAME_RULE.md)):

1. **session_start** — ruleset/catalog/model versions, opt-in confirmation, shadow flag.
2. **round** (one per round 1–8) — for each round capture:
   - `pool_before` — the item IDs already owned entering the round.
   - `offered_sets` — **all three** offered sets (the full option space, by item ID).
   - `model_scores` — per-option scores + the recommended index + `model_version`.
   - `recommendation_shown` — whether/how the recommendation was surfaced.
   - `human_choice` — which set the user picked (weak preference signal).
3. **support_choice** — the after-round-6 support hero + two support skills chosen,
   with the model's ranked candidates at decision time.
4. **final_formation** — the three 3-hero teams and their 18-skill assignment.
5. **unused_items** — items owned but not placed in the final formation.
6. **completion / abandonment** — whether the game reached a final formation or was
   abandoned (and at which round), for funnel/acceptance analysis.
7. **correction** — a user edit that supersedes an earlier logged event
   (references the corrected `event_id`; enables late fixes without deletion).

### Delivery semantics
- **Offline queue + late upload.** Buffer events locally; upload when online.
  Uploads may arrive out of order and days late — the server must tolerate this.
- **Idempotency.** Server dedupes by `event_id`; re-sending is safe.
- **Ordering.** Reconstruct order from (`session_id`, `seq`), never wall clock.

## Content-safe dedup

Dedup and joining must use **event/source/session IDs only**. **Never** dedup or
key on the *content* of a formation (identical hero/skill sets are legitimate,
common, and must remain distinct observations — mirroring the offline rule that
identical battles are not merged). No formation-content hashing for identity.

## Stable identifiers

- Use **stable item IDs** for heroes/skills (not display names, which can be
  re-romanized/renamed). Ship an ID↔name map versioned by `catalog_version`.
- Every event carries `catalog_version` and `ruleset_version` so historical data
  stays interpretable after catalog/rules changes.

## Privacy & consent

- **Opt-in only**, with a clear explanation of what is collected and why.
- **Privacy-minimized**: no account identity, no device fingerprint; `source_id`
  is a rotatable random token the user can reset (which also resets linkage).
- No free-text, no PII. Only item IDs, option indices, model scores, versions.
- Provide a local **view/export/delete** affordance for queued (not-yet-uploaded)
  events, and a documented server-side deletion path keyed by `source_id`.
- **No server logging is added by this plan.** Implementing any of the above is a
  separate, explicitly-approved project.
