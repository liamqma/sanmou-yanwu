# Smart Python runner: prefer local paddleocr_env if present
PY := $(shell if [ -x ./paddleocr_env/bin/python3 ]; then echo ./paddleocr_env/bin/python3; else echo python3; fi)
PIP := $(shell if [ -x ./paddleocr_env/bin/pip ]; then echo ./paddleocr_env/bin/pip; else echo pip; fi)

.PHONY: help extract test web install venv clean eval-synergy

help:
	@echo "Available targets:"
	@echo "  make extract       - Run image batch extraction"
	@echo "  make test          - Run pytest suite"
	@echo "  make web           - Start both Flask API (port 5001) and React frontend (port 3000)"
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

# Web service (starts both API and frontend)
web:
	@echo "Starting Flask API on port 5001..."
	@$(PY) api/start_web_advisor.py & \
	API_PID=$$!; \
	echo "API started with PID $$API_PID"; \
	echo "Starting React frontend on port 3000..."; \
	cd web && npm start & \
	FRONTEND_PID=$$!; \
	echo "Frontend started with PID $$FRONTEND_PID"; \
	echo ""; \
	echo "=============================================="; \
	echo "  Game Advisor is now running:"; \
	echo "  - API: http://localhost:5001"; \
	echo "  - Frontend: http://localhost:3000"; \
	echo "=============================================="; \
	echo ""; \
	echo "Press Ctrl+C to stop both services"; \
	trap "kill $$API_PID $$FRONTEND_PID 2>/dev/null" EXIT; \
	wait

# Install dependencies into current interpreter (prefers local venv)
install:
	$(PIP) install -r image_extraction/requirements.txt -r api/requirements.txt
	# Optional: test runner
	-$(PIP) install pytest

# Create local virtual environment
venv:
	python3 -m venv paddleocr_env
	./paddleocr_env/bin/pip install --upgrade pip
	make install

clean:
	rm -rf .pytest_cache .coverage htmlcov extracted_results tmp_crops

# Evaluate hero synergy parameters (grid search)
eval-synergy:
	$(PY) api/eval_synergy.py
