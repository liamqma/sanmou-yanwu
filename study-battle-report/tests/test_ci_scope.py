"""Execute the workflow's path classifier against real temporary Git diffs.

Workflow YAML is the consumed declarative interface, not a source-text proxy
for OCR behavior. These tests inspect the classifier's actual output protocol.
"""
import os
from pathlib import Path
import subprocess

import pytest
import yaml

WORKFLOW = Path(__file__).resolve().parents[2] / ".github/workflows/pull-request-checks.yml"
SCOPES = {"web", "agent", "data", "image", "study"}


def git(root, *args):
    return subprocess.check_output(["git", *args], cwd=root, text=True).strip()


@pytest.mark.parametrize("changed,expected", [
    ("study-battle-report/hybrid.py", {"study"}),
    ("study-battle-report/fixtures/mirror.png", {"study"}),
    ("study-battle-report/README.md", set()),
    ("web/src/example.ts", {"web"}),
    ("image_extraction/example.py", {"image"}),
    ("web/public/game-data/database.json", SCOPES),
    ("Makefile", {"data", "image", "study"}),
    (".github/workflows/pull-request-checks.yml", SCOPES),
])
def test_workflow_classifies_real_changes(tmp_path, changed, expected):
    workflow = yaml.safe_load(WORKFLOW.read_text())
    script = next(s["run"] for s in workflow["jobs"]["scope"]["steps"] if s.get("id") == "changes")
    repo = tmp_path / "repo"; repo.mkdir()
    git(repo, "init", "-q")
    git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base")
    base = git(repo, "rev-parse", "HEAD")
    path = repo / changed; path.parent.mkdir(parents=True, exist_ok=True); path.write_text("fixture")
    git(repo, "add", "--", changed)
    git(repo, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "change")
    output, summary = tmp_path / "output", tmp_path / "summary"
    env = {**os.environ, "BASE_SHA": base, "HEAD_SHA": git(repo, "rev-parse", "HEAD"),
           "RUNNER_TEMP": str(tmp_path), "GITHUB_OUTPUT": str(output), "GITHUB_STEP_SUMMARY": str(summary)}
    subprocess.run(["bash", "-e", "-c", script], cwd=repo, env=env, check=True, capture_output=True)
    values = dict(line.split("=", 1) for line in output.read_text().splitlines())
    assert set(values) == SCOPES
    assert {name for name, value in values.items() if value == "true"} == expected


def test_required_ci_aggregator_includes_the_new_workspace():
    jobs = yaml.safe_load(WORKFLOW.read_text())["jobs"]
    assert set(jobs["required"]["needs"]) == SCOPES | {"scope"}
    assert jobs["study"]["runs-on"] == "ubuntu-latest"
