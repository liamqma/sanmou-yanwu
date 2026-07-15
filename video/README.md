# SocialVideo — reusable 9:16 Remotion template

A generic, data-driven Remotion template for vertical (1080×1920, 30fps) social
videos. Everything visible is rendered from `content/video.json` plus measured
audio timing — there is **no domain-specific code**. The visual style mirrors the
web app (`web/src/theme/theme.ts`): paper background, seal-red primary, jade/gold
accents, Songti serif headings.

The composition id is **`SocialVideo`**; the render output is **`out/video.mp4`**.

## Pipeline

```
SCRIPT.md  →  content/video.json  →  validate + typecheck
           →  per-scene MP3 (public/audio/<id>.mp3)  →  measure audio timing
           →  render  →  QA
```

1. **Draft** the script in `SCRIPT.md` (get approval).
2. **Author** `content/video.json` against `content/video.schema.json`.
3. **Check:** `npm run validate` (content) and `npm run typecheck` (code).
4. **Narrate:** record one MP3 per scene (default), or opt into TTS.
5. **Measure:** `npm run audio` writes `src/generated/audio-timing.json`.
6. **Render:** `npm run render` → `out/video.mp4`.
7. **QA:** inspect frames + audio durations; iterate.

## Requirements

- Node 20.19+ (`nvm use` reads `.nvmrc`)
- `ffmpeg` / `ffprobe` (measuring + optional TTS encoding)
- Optional TTS only: a Python `.venv` from `requirements-tts.txt` and the clone
  model/reference files (see *Optional AI narration*).

```bash
cd video
nvm use
npm ci
```

## Content model

Edit `content/video.json`. `meta` sets series/title and the 1080×1920@30 frame.
Each scene has a unique `id`, a `kind`, and optional data-driven fields — only the
fields you provide are rendered. The four scene kinds:

- **intro** — eyebrow, title, subtitle, `tags`, caption.
- **content** — title, `bullets`, `stats`, optional `beforeAfter`, caption.
- **comparison** / **summary** — `rows` (name / before → after / delta),
  `beforeAfter`, `stats`.
- **outro** — title, subtitle, caption (call to action).

`accent` picks a theme role (`seal` | `jade` | `gold` | `ink`), default `seal`.
The full contract is documented in `content/video.schema.json` and typed in
`src/types.ts`. Run `npm run validate` for a fast, dependency-free check (unique
safe ids + required fields).

## Audio timing

Each scene lasts `timing[id]` frames if measured, otherwise
`fallbackSeconds × fps`. `Audio` is only added for scenes that have measured
timing, so missing clips never break a render.

### Manual narration (default)

Record one MP3 per scene at `public/audio/<scene-id>.mp3`, then:

```bash
npm run audio      # validates + measures your MP3s, writes timing
npm run render     # validate → audio → render out/video.mp4
```

If a clip is missing, `npm run audio` tells you which scene and stops — it never
substitutes a synthetic voice.

### Silent preview / render

No recordings needed:

```bash
npm run studio         # interactive preview (uses fallbackSeconds)
npm run render:silent   # preserves recordings, ignores timing, renders silently
```

### Optional AI narration (opt-in)

Set up the environment once:

```bash
uv venv .venv --python 3.12
uv pip install --python .venv/bin/python -r requirements-tts.txt
```

Then choose a backend explicitly:

```bash
npm run audio:clone   # your cloned voice via scripts/clone-voice.py (needs
                      #   voice-clone/voice.m4a + voice-clone/ref.txt, offline model)
npm run audio:say     # macOS `say` offline voice
```

Overrides: `CLONE_REF_AUDIO`, `CLONE_REF_TEXT`, `CLONE_PYTHON`, `VOICE`,
`VOICE_RATE`, `SCENE_PADDING`. A requested backend never silently falls back — if
it fails, the pipeline aborts.

## Theme sync

`src/theme.ts` mirrors `web/src/theme/theme.ts`. When the web palette or
typography changes, update `src/theme.ts` to keep videos on-brand. Do not edit
`web/`.

## Layout

- `content/video.json` — active content (the file you edit).
- `content/video.schema.json` — content contract.
- `src/SocialVideo.tsx` — generic composition.
- `src/Root.tsx`, `src/index.ts` — Remotion registration + timing helpers.
- `src/theme.ts`, `src/types.ts` — tokens + types.
- `scripts/` — `validate-content.mjs`, `generate-narration.mjs`, `clean.mjs`,
  and optional TTS (`clone-voice.py`, `generate-qwen-auditions.py`).
- `examples/skill-tier-changes/` — archived, non-active reference only.

## Cleanup

```bash
npm run clean       # removes out/ and resets timing; preserves all recordings
npm run clean:all   # also removes public/audio/* working narration files
```

Neither command touches source, examples, models, `.venv`, `node_modules`, or
personal reference recordings under `voice-clone/`. Use `clean:all` deliberately:
`public/audio` can contain manually recorded MP3s as well as generated speech.
