# AGENTS.md

Read [README.md](README.md), [GAME_RULE.md](GAME_RULE.md), and
[DEVELOPMENT.md](DEVELOPMENT.md) before changing anything.
`image_extraction/.agent.md` has notes for that folder.

- Belief Memory is disabled for this repository. Do not use the
  `belief-memory` skill or any Belief Memory MCP tool.
- Skills in `.agents/manual-skills/<name>/SKILL.md` run only when the user asks
  for that skill by name. Read its `SKILL.md` before starting.
- The explicitly invoked `publish-battle-screenshots` skill is the only
  exception to the plan, feature-branch, and pull-request lifecycle. That run
  may pull native battle screenshots, run the extraction pipeline, commit only
  the skill's allowlisted generated data and OCR files directly on `master`,
  and push `origin/master` without asking again. It must stop on unrelated
  changes, failed validation, remote divergence, or a rejected non-force push.
  The exception does not cover source-code changes or any other workflow.
- Keep docs, comments, and docstrings minimal; the code is the source of
  truth. Do not add implementation detail to Markdown files, and remove a
  feature's docs when you remove the feature.
