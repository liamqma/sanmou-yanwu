# Run Python via uv (manages .venv automatically from pyproject.toml + uv.lock)
PY := uv run python
TELEMETRY_STATE ?= data/telemetry_state.json
WEB_BATTLE_STATE ?= data/web_upload_state.json
YANWU_MANIFEST ?= data/external/yanwu-release.json
YANWU_CACHE_DIR ?= .cache/yanwu

.PHONY: help extract test test-data test-telemetry test-web-battles web install sync clean sync-yanwu-corpus build-recommendation evaluate-recommendation build-telemetry import-web-battles import-yanwu clean-battle-logs clean-battles

# study-battle-report locations
SBR := study-battle-report

help:
	@echo "Available targets:"
	@echo "  make extract                  - Run image batch extraction (then rebuild recommendation data)"
	@echo "  make test                     - Run image_extraction pytest suite"
	@echo "  make test-data                - Run the offline data-builder pytest suites (incl. incremental checkpoint)"
	@echo "  make test-telemetry           - Run the telemetry-builder and incremental-checkpoint pytest suites (data/)"
	@echo "  make test-web-battles         - Run web-battle importer and recommendation-builder tests"
	@echo "  make web                      - Start React frontend (port 3000, client-side only)"
	@echo "  make sync-yanwu-corpus        - Download/verify/normalize the pinned external corpus when uncached"
	@echo "  make build-recommendation     - Build recommendation data from manual + web + pinned Yanwu battles"
	@echo "  make evaluate-recommendation  - Run grouped stable-hash evaluation (ignored JSON result; no production changes)"
	@echo "  make build-telemetry EXPORT=  - Build the public aggregate and incremental checkpoint"
	@echo "  make import-web-battles EXPORT= - Import one bounded D1 export and rebuild recommendation data"
	@echo "  make import-yanwu [APPLY=1]     - Validate the local seven-sheet guide workbook; APPLY=1 updates database.json"
	@echo "  make install                  - Sync dependencies with uv (alias for 'sync')"
	@echo "  make sync                     - Install/sync all dependencies via 'uv sync'"
	@echo "  make clean                    - Remove temporary files (pytest cache, coverage, extracted_results, tmp_crops, __pycache__)"
	@echo "  make clean-battle-logs        - Remove regenerable battle OCR artifacts (battle_log.txt, .ocr_cache.json) but KEEP screenshots"
	@echo "  make clean-battles            - Also remove battle screenshots (DESTRUCTIVE: re-pull from phone needed). Use BATTLE=<id> to scope; CONFIRM=1 to skip prompt"

# Image extraction
extract:
	$(PY) image_extraction/batch_extract_battles.py
	$(MAKE) build-recommendation

# Tests (image_extraction/test_*.py)
# Uses session-scoped fixture to share extractor instance (faster)
# -n auto enables parallel execution if pytest-xdist is installed
test:
	uv run pytest image_extraction/test_image_extraction.py -v -W ignore::UserWarning -n auto

# Tests for the offline data builders (data/). Fast (no PaddleOCR).
test-data:
	uv run pytest data/test_yanwu_corpus.py data/test_skill_description_tokenizer.py data/test_skill_mechanics.py data/test_build_recommendation_data.py data/test_recommendation_evaluation.py data/test_import_web_battles.py data/test_import_yanwu_workbook.py data/test_build_telemetry_data.py data/test_telemetry_incremental_state.py data/test_telemetry_observation_report.py data/test_telemetry_retention.py -v

test-telemetry:
	uv run pytest data/test_build_telemetry_data.py data/test_telemetry_incremental_state.py data/test_telemetry_observation_report.py data/test_telemetry_retention.py -v

test-web-battles:
	uv run pytest data/test_yanwu_corpus.py data/test_import_web_battles.py data/test_skill_description_tokenizer.py data/test_skill_mechanics.py data/test_build_recommendation_data.py -v

# Web service (starts React frontend only - client-side implementation)
web:
	cd web && pnpm start

# Install / sync all Python dependencies (workspace + dev group)
install: sync

sync:
	uv sync --all-packages

clean:
	rm -rf .pytest_cache .coverage htmlcov extracted_results tmp_crops
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Populate the Git-ignored, content-addressed external corpus cache. A valid
# warm cache performs no network request.
sync-yanwu-corpus:
	$(PY) data/sync_yanwu_corpus.py --manifest "$(YANWU_MANIFEST)" --cache-dir "$(YANWU_CACHE_DIR)"

# Build the client-side recommendation artifact (web/src/recommendation_data.json)
# from all three validated sources. Model fitting itself remains offline.
build-recommendation: sync-yanwu-corpus
	$(PY) data/build_recommendation_data.py

# Run the deterministic protocol, writing the ignored full report and the
# tracked compact promotion decision. It never replaces production directly.
evaluate-recommendation: sync-yanwu-corpus
	$(PY) data/evaluate_recommendation_model.py --output results_recommendation_evaluation.json

# Build the anonymous public aggregate and aggregate-only checkpoint from a
# runner-temporary/local D1 export. The raw SQL input is read only and is never
# copied into the repository. Override TELEMETRY_STATE for an isolated local run.
build-telemetry:
	@test -n "$(EXPORT)" || { echo "Usage: make build-telemetry EXPORT=/path/to/round_telemetry.sql"; exit 2; }
	$(PY) data/build_telemetry_data.py "$(EXPORT)" --state "$(TELEMETRY_STATE)"

# Import a runner-temporary/local D1 web-battle export. The importer revalidates
# every row, updates aggregate state plus accepted battles with moderation
# metadata and rebuilds the deterministic static artifacts.
import-web-battles: sync-yanwu-corpus
	@test -n "$(EXPORT)" || { echo "Usage: make import-web-battles EXPORT=/path/to/web_battle_submissions.sql"; exit 2; }
	$(PY) data/import_web_battles.py import "$(EXPORT)" --state "$(WEB_BATTLE_STATE)"

# Validate the provider workbook by default; opt in to the atomic database
# update with APPLY=1. The workbook stays local and is never staged.
import-yanwu:
	$(PY) data/import_yanwu_workbook.py $(if $(filter 1,$(APPLY)),--apply,)

# --------------------------------------------------------------------------- #
# study-battle-report cleanup
#
# Layout: study-battle-report/battles/<id>/{images/, battle_log.txt, .ocr_cache.json}
# Scope to one battle with BATTLE=<id>; otherwise all battles are affected.
# --------------------------------------------------------------------------- #

# SAFE: remove only regenerable OCR artifacts (logs + cache), KEEP screenshots.
# Also sweeps stray run logs, the legacy single-battle artifacts, the leftover
# empty top-level images/ dir, and __pycache__.
clean-battle-logs:
	@echo "Removing regenerable OCR artifacts (keeping screenshots)..."
	rm -f $(SBR)/battles/$(if $(BATTLE),$(BATTLE),*)/battle_log.txt
	rm -f $(SBR)/battles/$(if $(BATTLE),$(BATTLE),*)/.ocr_cache.json
	rm -f $(SBR)/.ocr_run.log $(SBR)/battles/*/.ocr_run.log 2>/dev/null || true
	rm -f $(SBR)/battle_log.txt $(SBR)/.ocr_cache.json 2>/dev/null || true
	rm -rf $(SBR)/__pycache__
	@# Remove the legacy/leftover empty top-level images/ dir if it is empty.
	@[ -d "$(SBR)/images" ] && rmdir "$(SBR)/images" 2>/dev/null || true
	@echo "Done. Re-run OCR with: uv run python $(SBR)/ocr_battle_log.py [<id>] --use-cache"

# DESTRUCTIVE: clean-battle-logs PLUS the source screenshots. The screenshots
# can only be re-pulled from the phone, so this prompts unless CONFIRM=1.
clean-battles: clean-battle-logs
	@echo ""
	@echo "DESTRUCTIVE: this also deletes battle screenshots under"
	@echo "  $(SBR)/battles/$(if $(BATTLE),$(BATTLE),*)/images/"
	@echo "They can only be recovered by re-pulling from the phone."
ifndef CONFIRM
	@printf "Proceed? [y/N] "; read ans; [ "$$ans" = "y" ] || [ "$$ans" = "Y" ] || { echo "Aborted."; exit 1; }
endif
	rm -rf $(SBR)/battles/$(if $(BATTLE),$(BATTLE),*)/images
	@# Drop now-empty per-battle dirs so battles/ stays tidy.
	@find $(SBR)/battles -mindepth 1 -maxdepth 1 -type d -empty -exec rmdir {} + 2>/dev/null || true
	@echo "Done."
