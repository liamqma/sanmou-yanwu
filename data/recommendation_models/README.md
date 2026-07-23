# Retained recommendation models

The telemetry builder recomputes every event's scores and recommendation from
the exact paired model version recorded by the browser. Before deploying a new
`web/src/recommendation_data.json`, copy the previous artifact into this
directory as an immutable `.json` file.

The builder loads the current artifact plus every `*.json` file here, rejects
unknown or conflicting versions, and caps the registry at 32 artifacts. A
retained artifact must use the current game catalog. Never edit an archived
artifact after events have recorded its version.
