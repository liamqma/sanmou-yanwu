---
name: publish-battle-screenshots
description: "Explicit-only repository workflow that pulls native battle screenshots from a USB Android phone, runs make extract, validates the bounded generated outputs, commits them directly on master, and pushes origin/master. Use only when the user explicitly invokes this named skill."
allowed-tools:
  - bash
  - open_files
---

# Publish Battle Screenshots

Use this manual skill only when the user explicitly invokes
`publish-battle-screenshots`. One explicit invocation authorizes the complete
workflow for that run, including the final commit and non-force push to
`origin/master`; do not ask for a separate plan, feature branch, `no-mistakes`
run, pull request, commit confirmation, or push confirmation.

This is a narrow repository exception for importing native battle-result
screenshots. It never authorizes source-code changes, unrelated generated data,
force-pushing, history rewriting, deleting phone files, or bypassing a rejected
push. Honor any narrower instruction in the user's invocation, such as a dry run
or a request not to push.

## Allowed published paths

The recurring workflow may commit only:

```text
data/battles/screenshot_*.json
web/src/recommendation_data.json
image_extraction/ocr_corrections/*.json
image_extraction/ocr_corrections/*.png
image_extraction/fixtures/*.json
image_extraction/fixtures/*.png
```

The OCR correction and fixture paths are allowed only when `make extract`
created them during an interactive low-confidence correction in the current
run. Do not stage `data/images/`, `.cache/`, `tmp_crops/`, ignored files, or any
pre-existing/unrelated change.

## Workflow

1. Start from the repository root and read `AGENTS.md`, `README.md`,
   `GAME_RULE.md`, `DEVELOPMENT.md`, and `image_extraction/.agent.md`. The
   exception in `AGENTS.md` applies only to this skill.
2. Inspect the current branch, worktree, remotes, and any in-progress Git or
   `no-mistakes` operation. If another workflow owns the branch, stop. If the
   worktree has pre-existing changes that are not clearly outputs of an
   interrupted invocation of this same skill, stop before pulling or staging.
3. Work on `master`. If the worktree is clean and another branch is checked out,
   switch to `master`. Fetch `origin master` and require local `HEAD` to equal
   `origin/master` before importing. Never reset, rebase, merge, or force the
   branch to make this check pass.
4. Locate and authorize ADB as described by
   `.agents/manual-skills/pull-battle-screenshots/SKILL.md`. Run
   `adb devices -l`; if its list is empty, restart the ADB server once and retry.
   Stop and give the relevant phone instruction if the device is absent or
   unauthorized.
5. This workflow consumes native `screenshot_*.png` battle-result screenshots,
   not `battle_detail_*.png` scrolling battle-log frames. Pull them with:

   ```bash
   bash .agents/manual-skills/pull-battle-screenshots/pull_battles.sh --pattern 'screenshot_*.png'
   ```

   Never pass `--clean`. Record the pulled count and preserve the original
   filenames. If no matching files exist, stop without committing.
6. Run `make extract` and monitor it to completion. It OCRs the screenshots into
   `data/battles/` and rebuilds `web/src/recommendation_data.json`. When the
   extractor requests manual skill selection, inspect the saved crop. Enter an
   exact catalog skill only when visually unambiguous; otherwise ask the user.
   The extractor removes local `data/images` inputs after saving or discarding
   each result, but the phone copies remain because Step 5 never cleans them.
7. Require `make extract` to exit successfully. Report its saved, draw, and OCR
   failure counts. Validate every changed JSON file and run `make test-data`.
   If the current run added an OCR correction or extraction fixture, also run
   `make test`. Stop before Git mutation on any validation or test failure.
8. Inspect the full worktree delta. Require every publishable change to match
   the allowlist above, and require at least one change. Stage only the exact
   allowlisted paths reported by `git status`; never use `git add .`, `git add
   -A`, or a broad directory add. Review the staged path list and diff stat, then
   run `git diff --cached --check`.
9. Commit on `master` with the default message:

   ```text
   chore(data): import battle screenshots
   ```

   Use a more specific message only when the user supplies one. If a commit hook
   fails or changes the worktree, stop and report it instead of bypassing the
   hook.
10. Fetch `origin master` again. Require the new commit's first parent to equal
    the refreshed `origin/master`; if the remote advanced, stop without rebasing
    or force-pushing. Otherwise run exactly a normal `git push origin master`.
    Never use `--force` or `--force-with-lease`. If branch protection or any
    remote policy rejects the push, leave the local commit intact and report the
    rejection.
11. Verify local `master` and `origin/master` resolve to the pushed commit, then
    report the commit SHA, pulled/saved/discarded counts, validations, pushed
    remote, and final worktree status.

## Stop conditions

Stop without committing or pushing when scope cannot be proven, the device is
unavailable, extraction/validation/tests fail, the remote has diverged, or Git
rejects the operation. Do not convert this explicit-only data-import exception
into a general shortcut around the repository lifecycle.
