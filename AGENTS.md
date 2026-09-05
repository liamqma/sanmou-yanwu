# AGENTS.md

Guidance for coding agents (Codex, Pi, Rovo Dev). The canonical project doc —
architecture, layout, commands, and data conventions — is **[README.md](README.md)**.
Game rules are in **[GAME_RULE.md](GAME_RULE.md)**. The development lifecycle
(plan → implement → validate, and which tests to run per workspace) is in
**[DEVELOPMENT.md](DEVELOPMENT.md)**. Read all three before making changes.

Belief Memory is disabled for this personal repository. Do not invoke the
`belief-memory` skill or any Belief Memory MCP tool.

Directory-scoped notes extend this for their subtree:
`web/AGENTS.md` (React app) and `image_extraction/.agent.md` (PaddleOCR/venv).

Manual-only agent workflows live at `.agents/manual-skills/<name>/SKILL.md`.
Do not load or use one unless the user explicitly asks to trigger that named
skill; when they do, read its `SKILL.md` before proceeding.

The explicitly invoked `publish-battle-screenshots` manual skill is the sole
exception to the plan, feature-branch, `no-mistakes`, and pull-request lifecycle.
Its explicit invocation authorizes that run to pull native battle screenshots,
run the repository extraction pipeline, commit only the skill's allowlisted
generated data/OCR artifacts directly on `master`, and push `origin/master`
without another confirmation. The skill must stop on unrelated changes, failed
validation, remote divergence, or a rejected non-force push. This exception does
not apply to source-code changes or any other workflow.
