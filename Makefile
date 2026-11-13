# Run Python via uv (manages .venv automatically from pyproject.toml + uv.lock)
PY := uv run python
TELEMETRY_STATE ?= data/telemetry_state.json
YANWU_MANIFEST ?= data/external/yanwu-release.json
YANWU_CACHE_DIR ?= .cache/yanwu

.PHONY: help test-data test-telemetry web install sync clean sync-yanwu-corpus build-recommendation evaluate-recommendation build-telemetry import-yanwu

help:
	@echo "Available targets:"
	@echo "  make test-data                - Run the offline data-builder tests"
	@echo "  make test-telemetry           - Run the telemetry-builder tests"
	@echo "  make web                      - Start the dev server (port 3000)"
	@echo "  make sync-yanwu-corpus        - Download/verify the pinned external corpus when uncached"
	@echo "  make build-recommendation     - Rebuild web/src/recommendation_data.json"
	@echo "  make evaluate-recommendation  - Run the evaluation (ignored JSON result)"
	@echo "  make build-telemetry EXPORT=  - Build the telemetry aggregate from a D1 export"
	@echo "  make import-yanwu [APPLY=1]   - Validate the guide workbook; APPLY=1 updates database.json"
	@echo "  make sync                     - Install Python dependencies (alias: install)"
	@echo "  make clean                    - Remove caches"

test-data:
	uv run pytest data/test_yanwu_corpus.py data/test_build_recommendation_data.py data/test_recommendation_evaluation.py data/test_import_yanwu_workbook.py data/test_build_telemetry_data.py data/test_telemetry_incremental_state.py data/test_telemetry_observation_report.py data/test_telemetry_retention.py -v

test-telemetry:
	uv run pytest data/test_build_telemetry_data.py data/test_telemetry_incremental_state.py data/test_telemetry_observation_report.py data/test_telemetry_retention.py -v

web:
	cd web && pnpm start

install: sync

sync:
	uv sync

clean:
	rm -rf .pytest_cache .coverage htmlcov
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# A valid warm cache performs no network request.
sync-yanwu-corpus:
	$(PY) data/sync_yanwu_corpus.py --manifest "$(YANWU_MANIFEST)" --cache-dir "$(YANWU_CACHE_DIR)"

build-recommendation: sync-yanwu-corpus
	$(PY) data/build_recommendation_data.py

# Writes an ignored results_*.json; never replaces the production artifact.
evaluate-recommendation: sync-yanwu-corpus
	$(PY) data/evaluate_recommendation_model.py --output results_recommendation_evaluation.json

# The raw SQL export is read only and never copied into the repository.
build-telemetry:
	@test -n "$(EXPORT)" || { echo "Usage: make build-telemetry EXPORT=/path/to/round_telemetry.sql"; exit 2; }
	$(PY) data/build_telemetry_data.py "$(EXPORT)" --state "$(TELEMETRY_STATE)"

# The workbook stays local and is never staged.
import-yanwu:
	$(PY) data/import_yanwu_workbook.py $(if $(filter 1,$(APPLY)),--apply,)
