CREATE TABLE IF NOT EXISTS "web_battle_submissions" (
    "id"              INTEGER PRIMARY KEY AUTOINCREMENT,
    "submission_id"   TEXT NOT NULL UNIQUE,
    "uploader_name"   TEXT,
    "received_at"     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "catalog_version" TEXT NOT NULL,
    "canonical_hash"  TEXT NOT NULL,
    "battle_json"     TEXT NOT NULL
);
