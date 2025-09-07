# Smart Python runner: prefer local paddleocr_env if present
PY := $(shell if [ -x ./paddleocr_env/bin/python3 ]; then echo ./paddleocr_env/bin/python3; else echo python3; fi)
PIP := $(shell if [ -x ./paddleocr_env/bin/pip ]; then echo ./paddleocr_env/bin/pip; else echo pip; fi)

.PHONY: help extract test web install venv clean eval-synergy

help:
	@echo "Available targets:"
	@echo "  make extract       - Run image batch extraction"
	@echo "  make test          - Run pytest suite"
	@echo "  make web           - Start the web advisor"
	@echo "  make eval-synergy  - Run synergy parameter evaluation (grid search)"
	@echo "  make install       - Install all requirements into paddleocr_env (or current env)"
	@echo "  make venv          - Create paddleocr_env virtual environment"
	@echo "  make clean         - Remove temporary files (pytest cache, coverage, extracted_results)"

# Image extraction
extract:
	$(PY) image_extraction/batch_extract_battles.py

# Tests (image_extraction/test_*.py)
test:
	$(PY) -m pytest -q

# Web service
web:
	$(PY) web_service/start_web_advisor.py

# Install dependencies into current interpreter (prefers local venv)
install:
	$(PIP) install -r image_extraction/requirements.txt -r web_service/requirements.txt
	# Optional: test runner
	-$(PIP) install pytest

# Create local virtual environment
venv:
	python3 -m venv paddleocr_env
	./paddleocr_env/bin/pip install --upgrade pip
	make install

clean:
	rm -rf .pytest_cache .coverage htmlcov extracted_results

# Evaluate hero synergy parameters (grid search)
eval-synergy:
	$(PY) web_service/eval_synergy.py
