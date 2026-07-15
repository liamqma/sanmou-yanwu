# AGENTS.md — SocialVideo template (video/)

Guidance for AI agents producing videos with this Remotion template. The template
is **generic and data-driven**: everything visible comes from `content/video.json`
plus measured audio timing. There is **no domain-specific hardcoding** in the
React code — keep it that way.

## Workflow (follow in order)

1. **Read first.** `README.md` (this folder), `content/video.schema.json` (the
   content contract), and `src/types.ts`.
2. **Draft `SCRIPT.md`** — selection, conclusion, scene breakdown, per-scene
   narration, and caption. **Get the user's approval before rendering.**
3. **Author `content/video.json`** to match the approved script. Use only the
   fields in the schema. Give every scene a unique, filesystem-safe `id`.
4. **Validate + typecheck:** `npm run validate` then `npm run typecheck`.
5. **Audio (default = manual human recording):** the user records one MP3 per
   scene at `public/audio/<scene-id>.mp3`. Then `npm run audio` measures them and
   writes timing. Use AI TTS **only if the user explicitly asks** — `npm run
   audio:clone` (cloned voice) or `npm run audio:say` (macOS voice).
6. **Preview / render.** `npm run studio` for interactive preview.
   `npm run render:silent` for a no-audio render (uses `fallbackSeconds` and
   preserves recordings).
   `npm run render` for the full render with audio → `out/video.mp4`.
7. **QA.** Inspect frames and audio metadata (durations, alignment). Iterate on
   `content/video.json` and re-validate.

## Rules

- **Theme:** match the web app. Use tokens from `src/theme.ts` (which mirrors
  `web/src/theme/theme.ts`). Never introduce the old dark neon look. Do not edit
  files under `web/`.
- **No hardcoding:** no fixed skill names, tiers, captions, colors, or
  conclusions in `src/`. All content lives in JSON.
- **Manual narration is the default.** AI TTS is opt-in and must never be a
  silent fallback.
- `npm run clean` must preserve recordings. Only use `npm run clean:all` when
  the user explicitly wants the working narration files removed.
- **Never commit** personal recordings/transcripts (`voice-clone/*`), generated
  media (`out/`, `public/audio/*.mp3`), models/caches (`.cache/`), environments
  (`.venv/`), or `node_modules/`. Do not add dependencies or edit
  `package-lock.json`.
- **Silent preview must work** with no personal recordings present.
- Keep `examples/` untouched — it is archived, non-active reference only.
