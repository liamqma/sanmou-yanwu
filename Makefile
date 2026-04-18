# Run Python via uv (manages .venv automatically from pyproject.toml + uv.lock)
PY := uv run python

.PHONY: help extract test web install sync clean export-stats remove-duplicate-battles

help:
	@echo "Available targets:"
	@echo "  make extract                  - Run image batch extraction (then export stats)"
	@echo "  make test                     - Run pytest test suite"
	@echo "  make web                      - Start React frontend (port 3000, client-side only)"
	@echo "  make export-stats             - Export battle statistics to JSON for client-side use"
	@echo "  make remove-duplicate-battles - Remove duplicate battle files (keeps one per group)"
	@echo "  make install                  - Sync dependencies with uv (alias for 'sync')"
	@echo "  make sync                     - Install/sync all dependencies via 'uv sync'"
	@echo "  make clean                    - Remove temporary files (pytest cache, coverage, extracted_results, __pycache__)"

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
	rm -rf .pytest_cache .coverage htmlcov extracted_results tmp_crops
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Export battle statistics to JSON for client-side use
export-stats:
	$(PY) data/export_battle_stats.py

# Remove duplicate battle files (keeps one file per duplicate group)
remove-duplicate-battles:
	$(PY) data/remove_duplicate_battles.py
