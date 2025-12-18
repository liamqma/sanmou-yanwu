# Smart Python runner: prefer local venv if present
PY := $(shell if [ -x ./venv/bin/python3 ]; then echo ./venv/bin/python3; else echo python3; fi)
PIP := $(shell if [ -x ./venv/bin/pip ]; then echo ./venv/bin/pip; else echo pip; fi)

.PHONY: help extract web install venv clean export-stats

help:
	@echo "Available targets:"
	@echo "  make extract       - Run image batch extraction"
	@echo "  make web           - Start React frontend (port 3000, client-side only)"
	@echo "  make export-stats  - Export battle statistics to JSON for client-side use"
	@echo "  make install       - Install all requirements into venv (or current env)"
	@echo "  make venv          - Create venv virtual environment"
	@echo "  make clean         - Remove temporary files (pytest cache, coverage, extracted_results, __pycache__)"

# Image extraction
extract:
	$(PY) image_extraction/batch_extract_battles.py
	$(MAKE) export-stats

# Web service (starts React frontend only - client-side implementation)
web:
	cd web && npm start

# Install dependencies into current interpreter (prefers local venv)
install:
	$(PIP) install -r image_extraction/requirements.txt -r api/requirements.txt
	# Optional: test runner
	-$(PIP) install pytest

# Create local virtual environment
venv:
	python3 -m venv venv
	./venv/bin/pip install --upgrade pip
	make install

clean:
	rm -rf .pytest_cache .coverage htmlcov extracted_results tmp_crops
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true

# Export battle statistics to JSON for client-side use
export-stats:
	$(PY) api/export_battle_stats.py
