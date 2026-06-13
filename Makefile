# Run Python via uv (manages .venv automatically from pyproject.toml + uv.lock)
PY := uv run python

.PHONY: help extract test web install sync clean export-stats remove-duplicate-battles clean-battle-logs clean-battles

# study-battle-report locations
SBR := study-battle-report

help:
	@echo "Available targets:"
	@echo "  make extract                  - Run image batch extraction (then export stats)"
	@echo "  make test                     - Run pytest test suite"
	@echo "  make web                      - Start React frontend (port 3000, client-side only)"
	@echo "  make export-stats             - Export battle statistics to JSON for client-side use"
	@echo "  make remove-duplicate-battles - Remove duplicate battle files (keeps one per group)"
	@echo "  make install                  - Sync dependencies with uv (alias for 'sync')"
	@echo "  make sync                     - Install/sync all dependencies via 'uv sync'"
	@echo "  make clean                    - Remove temporary files (pytest cache, coverage, extracted_results, learn/downloads, __pycache__)"
	@echo "  make clean-battle-logs        - Remove regenerable battle OCR artifacts (battle_log.txt, .ocr_cache.json) but KEEP screenshots"
	@echo "  make clean-battles            - Also remove battle screenshots (DESTRUCTIVE: re-pull from phone needed). Use BATTLE=<id> to scope; CONFIRM=1 to skip prompt"

# Image extraction
extract:
	$(PY) image_extraction/batch_extract_battles.py
	$(MAKE) export-stats

# Tests (image_extraction/test_*.py)
# Uses session-scoped fixture to share extractor instance (faster)
# -n auto enables parallel execution if pytest-xdist is installed
test:
	uv run pytest image_extraction/test_image_extraction.py -v -W ignore::UserWarning -n auto

# Web service (starts React frontend only - client-side implementation)
web:
	cd web && npm start

# Install / sync all Python dependencies (workspace + dev group)
install: sync

sync:
	uv sync --all-packages

clean:
	rm -rf .pytest_cache .coverage htmlcov extracted_results tmp_crops learn/downloads
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Export battle statistics to JSON for client-side use
export-stats:
	$(PY) data/export_battle_stats.py

# Remove duplicate battle files (keeps one file per duplicate group)
remove-duplicate-battles:
	$(PY) data/remove_duplicate_battles.py

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
