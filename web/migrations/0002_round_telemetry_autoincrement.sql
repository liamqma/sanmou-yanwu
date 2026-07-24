CREATE TABLE "round_telemetry_autoincrement" (
    "id"                       INTEGER PRIMARY KEY AUTOINCREMENT,
    "event_id"                 TEXT NOT NULL UNIQUE,
    "session_id"               TEXT NOT NULL,
    "client_ts"                TEXT NOT NULL,
    "received_at"              TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "round_number"             INTEGER NOT NULL CHECK ("round_number" BETWEEN 1 AND 8),
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

INSERT INTO "round_telemetry_autoincrement" (
    "id",
    "event_id",
    "session_id",
    "client_ts",
    "received_at",
    "round_number",
    "round_type",
    "schema_version",
    "model_version",
    "catalog_version",
    "pool_before_json",
    "offered_sets_json",
    "paired_scores_json",
    "recommended_index",
    "chosen_index",
    "preference_model_version",
    "preference_probs_json"
)
SELECT
    "id",
    "event_id",
    "session_id",
    "client_ts",
    "received_at",
    "round_number",
    "round_type",
    "schema_version",
    "model_version",
    "catalog_version",
    "pool_before_json",
    "offered_sets_json",
    "paired_scores_json",
    "recommended_index",
    "chosen_index",
    "preference_model_version",
    "preference_probs_json"
FROM "round_telemetry";

DROP TABLE "round_telemetry";

ALTER TABLE "round_telemetry_autoincrement"
RENAME TO "round_telemetry";
