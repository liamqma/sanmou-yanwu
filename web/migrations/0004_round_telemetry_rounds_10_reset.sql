-- Explicit beta-history reset for the ten-round draft contract.
--
-- This migration intentionally discards only anonymous round telemetry. The
-- separate web_battle_submissions table and its accepted-report pipeline are
-- not touched.
DROP TABLE IF EXISTS "round_telemetry";

CREATE TABLE "round_telemetry" (
    "id"                       INTEGER PRIMARY KEY AUTOINCREMENT,
    "event_id"                 TEXT NOT NULL UNIQUE,
    "session_id"               TEXT NOT NULL,
    "client_ts"                TEXT NOT NULL,
    "received_at"              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "round_number"             INTEGER NOT NULL CHECK ("round_number" BETWEEN 1 AND 10),
    "round_type"               TEXT NOT NULL CHECK ("round_type" IN ('hero', 'skill')),
    "schema_version"           INTEGER NOT NULL,
    "model_version"            TEXT NOT NULL,
    "catalog_version"          TEXT NOT NULL,
    "pool_before_json"         TEXT NOT NULL,
    "offered_sets_json"        TEXT NOT NULL,
    "paired_scores_json"       TEXT NOT NULL,
    "recommended_index"        INTEGER NOT NULL CHECK ("recommended_index" BETWEEN 0 AND 2),
    "chosen_index"             INTEGER NOT NULL CHECK ("chosen_index" BETWEEN 0 AND 2),
    "preference_model_version" TEXT,
    "preference_probs_json"    TEXT,
    UNIQUE ("session_id", "round_number")
);
