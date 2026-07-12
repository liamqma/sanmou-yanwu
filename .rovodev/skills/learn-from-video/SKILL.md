---
name: learn-from-video
description: Extract durable gameplay insights from a 三国谋定天下 video (a URL via the ./learn CLI, or a local .mp4 via OCR+transcribe) and append them to web/src/tips.json after cross-referencing against the game database. Use when the user invokes /learn-from-video with a URL or a local video file path.
allowed-tools:
  - open_files
  - expand_code_chunks
  - grep
  - bash
  - create_file
  - find_and_replace_code
---
# Self-Improvement: Update web/src/tips.json from a Video

You are helping the user maintain `web/src/tips.json`, the knowledge base of
player tips for the 三国谋定天下 web app. This file feeds
`formatRelevantTips` in `web/src/services/promptGenerator.ts` and is the
**HIGHEST-PRIORITY signal** in every per-round AI recommendation prompt.

The user invokes this skill in one of **two modes**, depending on what they
give you:

| Mode | Trigger | Pipeline |
|------|---------|----------|
| **A. URL** | `/learn-from-video <URL>` | `./learn` CLI downloads + transcribes |
| **B. Local file** | `/learn-from-video <path/to/video.mp4>` | OCR frames + transcribe locally |

Both modes converge on the same Step 3+ (cross-reference, update
`tips.json` in place, validate, report; user reviews via `git diff`).

Treat the streamer as a domain expert; your job is to extract their concrete,
durable gameplay insights and reflect them in `tips.json` — not to invent
your own analysis.

## Pre-flight (both modes)

1. **Resolve the input form.** Three common shapes; pick the right pipeline
   automatically without re-asking:
   - **Full URL** (`https://www.bilibili.com/video/BVxxx`, `https://b23.tv/…`,
     a Douyin URL, etc.) → Mode A.
   - **`bilibili/<id>` shorthand** (e.g. `bilibili/38453249642`) → **Mode B
     with local path `./bilibili/<id>/`** at the workspace root (this
     directory is already in `.gitignore`). The user pre-downloads
     Bilibili-app videos into that folder; do not try to
     resolve the numeric id against the Bilibili API (modern app downloads
     often expose a streaming id that doesn't round-trip to an aid/BVID and
     will return `-404`). Just go straight to Mode B and look for the
     standard layout: `videoInfo.json` + two `.m4s` chunks
     (`<id>-1-30080.m4s` video, `<id>-1-30280.m4s` audio).
   - **Absolute path to a `.mp4` / `.m4s` folder** → Mode B as-is.
2. **Confirm only when ambiguous.** If the input doesn't match any of the
   three shapes above (e.g. an unprefixed bare numeric id), ask the user
   for a full URL or local path before doing anything else.
3. **Read `web/src/tips.json`** so you know the current state before
   proposing changes — never propose edits blind.

---

## Mode A — URL pipeline

```
URL ──▶ ./learn  ──▶ audio + transcript ──▶ Step 3
```

### A.1 Verify `./learn` is set up

- The unified CLI lives in the workspace's uv environment. Run from the repo
  root: `uv run learn providers` and confirm bilibili/douyin/generic are
  registered.
- If `uv run learn …` errors with "Failed to spawn", run
  `uv sync --all-packages` first.

### A.2 Download + transcribe

Run the end-to-end pipeline. Output goes to `learn/downloads/`.

```bash
# Bilibili / Douyin: Playwright cookie minting is recommended (defeats WAF)
uv run learn run "<URL>" --playwright --lang zh
```

Notes:

- **Default model is `large-v3-turbo`**. For a ~60-min video on Apple Silicon
  CPU expect ~15–25 wall-clock minutes (~3–5x real-time). The first run also
  downloads the model (~1.5 GB) into `~/.cache/huggingface`.
- If language is non-Chinese, drop `--lang zh` so it auto-detects, or pass
  the right ISO code.
- If `--playwright` hangs on Bilibili: ensure you're on the **workspace
  venv's** Playwright (Chromium is cached at
  `~/Library/Caches/ms-playwright`). First-time install is ~150 MB.
- Run the command **in the foreground** so you can monitor heartbeats. If
  the user is impatient, you may background it with `&` and poll `tail` on
  the log, but always wait until the **`Done in Xs … RTF=Yx`** line appears
  before moving on.

After the run, three sibling files exist next to the audio in
`learn/downloads/`:

- `<stem>.txt` — plain text, one segment per line
- `<stem>.srt` — timestamps for every segment (for re-listening)
- `<stem>.json` — per-segment objects with `start`, `end`, `text`

---

## Mode B — Local video file pipeline (OCR + transcribe)

Use this mode when the user gives you a path to an `.mp4` (or similar) file
that's already on disk, e.g. `/path/to/video.mp4` — OR when they use the
**`bilibili/<id>` shorthand** (per Pre-flight step 1), in which case the
folder is `./bilibili/<id>/` at the workspace root and is already
git-ignored.

This mode mirrors what a native multimodal model (Gemini 2.5 Pro) would do
— but on a workstation that does **not** have Gemini access via AI Gateway
yet. It combines two signals:

1. **Whisper transcript** — the streamer's spoken commentary.
2. **Tesseract OCR on sampled frames** — any spreadsheets, tier lists,
   skill tooltips, or UI text shown on screen.

The two signals together let you reconstruct what was said *and* what was
displayed, with timestamp alignment.

### B.1 Pre-requisites

- `ffmpeg` on PATH (used for frame extraction + audio remux).
- `tesseract` with the `chi_sim` data pack (`brew install
  tesseract-lang`).
- The `uv` venv must have `pytesseract` and `Pillow` installed
  (`uv add pytesseract Pillow` from `learn/`).

### B.2 Bilibili-app-specific: rebuild a playable mp4

If the user gives you a Bilibili-app download folder (e.g. one with two
`.m4s` chunks like `<id>-1-30064.m4s` and `<id>-1-30280.m4s`), the chunks
are wrapped with a 9-byte sentinel header (`000000000`) and must be
stripped before muxing:

```bash
uv run python learn/strip_m4s.py <input>.m4s <output>.m4s
ffmpeg -i video.m4s -i audio.m4s -c copy combined.mp4 -y
```

`learn/strip_m4s.py` is committed for exactly this case.

If the user already gave you a clean `.mp4`, skip this step.

### B.3 Extract audio + transcribe

Demux to mp3 and run Whisper:

```bash
ffmpeg -i <video>.mp4 -vn -acodec libmp3lame -q:a 2 <stem>.mp3 -y
uv run learn transcribe <stem>.mp3 --model turbo
```

Output: `<stem>.txt`, `<stem>.srt`, `<stem>.json` next to the mp3.

(Note: do **not** pass the raw `.m4s` to `learn transcribe` — Whisper's
demuxer trips on the Bilibili-stripped container and errors with
`tuple index out of range`. Always mux to a normal `.mp4`/`.mp3` first.)

### B.4 Extract frames + OCR

Extract one frame per minute (cheap; enough to catch every spreadsheet that
sits on screen for at least a minute):

```bash
mkdir -p learn/frames
ffmpeg -i <video>.mp4 -vf "fps=1/60" learn/frames/frame_%04d.jpg
```

Then OCR every frame with `learn/run_ocr.py` (committed); it filters out
near-blank frames and only prints frames with ≥50 characters of recognised
text:

```bash
cd learn && uv run python run_ocr.py
```

The script prints `--- frames/frame_NNNN.jpg ---` followed by the OCR'd
text. Capture this into a buffer you can grep alongside the Whisper
transcript.

### B.5 Cross-check OCR vs. transcript

This is the core value of Mode B. For each visible spreadsheet row /
on-screen claim:

- **OCR gives you the structured truth** (exact hero names, skill names,
  tier labels, support lists).
- **Whisper gives you the streamer's commentary** (rationale,
  substitutions, edge cases, "do not pair X with Y" warnings).

Synthesise tips only when *both* agree, or when the transcript provides
clear rationale for what's on screen. Disagreements should be flagged in
`review_checklist`.

A typical extraction pattern:

```text
OCR (frame 0006):
  主C: 司马懿
  辅助: 曹丕、曹操、双减、张春华、荀彧、卞夫人、郝昭
  战法刚需: 潜龙在渊、未雨绸缪、法追

Transcript context (search for 司马懿):
  L142: 好招和魁章不动这两个肯定要放一起讲
  L143: 他就是抬一个法系的谋略武将
  L144: 那我们第一个想到的肯定就是司马仪
  L145: 第二个就是王毅 (王异)

→ Tip: "司马懿主C：得益于新武将郝昭（带岿然不动）的加入，司马懿排名上升。
  刚需：潜龙在渊、未雨绸缪、法追。推荐辅助：曹丕、曹操、双减、张春华、
  荀彧、卞夫人、郝昭。无司马懿时可用王异平替。"
  [SRC: L142-L145 + OCR frame_0006]
  # NOTE: no 【S14】 / season prefix — tips.json must stay timeless.
```

### B.6 Hand off to Step 3

After B.4 + B.5, you have:

- A `.txt` Whisper transcript (same shape as Mode A).
- A concatenated OCR dump (treat as auxiliary evidence).

Now follow **Step 3** (cross-reference against game DB) and onward.
Annotation rules below apply equally to both modes — just allow
`[SRC: OCR frame_NNNN]` as an additional citation form alongside
`[SRC: L###]`.

---

## Step 3 — Cross-reference against the game database

Use `web/src/database.json` as your authoritative vocabulary:

- `database.json.skill` — list of valid skill names (currently 125).
- `database.json.skill_hero_map` — skill → carrier hero mapping.

Also load `web/src/tips.json` for the existing tip set (`general`, `heroes`,
`skills`, `team_compositions`).

Run a small Python snippet to find every `database.json` skill / `tips.json`
hero name that appears in the transcript, with a hit count, e.g.:

```python
import json
db   = json.load(open('web/src/database.json'))
tips = json.load(open('web/src/tips.json'))
txt  = open('learn/downloads/<stem>.txt', encoding='utf-8').read()

skills = {s for s in db['skill']} | set(tips['skills'])
heroes = set(tips['heroes'])

skill_hits = {s: txt.count(s) for s in skills if s in txt}
hero_hits  = {h: txt.count(h) for h in heroes if h in txt}
```

For each hit, dump 1–3 surrounding **non-empty** lines from the transcript
so you have actual quotes (not just hit counts) to ground each proposed tip
in. In Mode B, also fold in the OCR dump so the structured spreadsheet
rows participate in hit counting.

## Step 4 — Update tips.json directly

Edit `web/src/tips.json` **in place**. The user reviews via `git diff` rather
than a separate proposal file. This means:

- **Append** to the existing `general` array (skip duplicates by exact-string
  match).
- **Overwrite** entries in `heroes` / `skills` (insert if missing).
- **Append** entries to `team_compositions`.
- **Preserve** top-level key order (`general`, `team_compositions`, `heroes`,
  `skills`) and use 2-space indent, `ensure_ascii=False`, UTF-8, trailing
  newline.
- **Use a Python script**, not manual edits — JSON has 4 sections with 100+
  entries and hand-editing risks comma/quote mistakes.

Each new entry's prose should look exactly like the existing entries in the
same section. Do NOT include `[SRC: …]` markers, confidence stars, or
helper keys (`transcript_evidence`, etc.) — `tips.json` is shipped to the
LLM at runtime, and review-only metadata bloats the prompt.

Instead, **summarise your provenance in chat** when handing off to Step 5:
list per-entry citations (`L###` / `OCR frame_NNNN`), the confidence rating,
and any STT mishearings you pre-corrected. The user uses that summary +
`git diff web/src/tips.json` to verify.

Team-composition objects must contain only the production keys:
`heroes`, `tier`, `slot`, `awakening_dependency`, `strength`, `note`.

Provenance rules (track in chat, NOT in tips.json):

- Line numbers are **1-based indices into the non-empty lines of the `.txt`
  file** — produced by:

  ```python
  lines = [l.strip() for l in open(txt_path, encoding='utf-8') if l.strip()]
  ```

  This is the same convention the user is used to and lets them grep /
  re-listen.
- **Internal confidence rating** for every entry (only mentioned in chat,
  never written to tips.json):
  - `★★★` — streamer states the claim explicitly (or OCR shows it clearly)
  - `★★`  — paraphrase / strong implication
  - `★`   — your inference (be sparing). Drop ★ entries unless you have a
            strong reason to include them.
- **Pre-correct STT mishearings before writing.** `faster-whisper` mis-hears
  game jargon (e.g. `好招` → `郝昭`, `魁章不动` → `岿然不动`, `王霜` →
  `王双`, `助容夫人` → `祝融夫人`, `张灵` → `张辽`). Disambiguate by
  cross-checking against `tips.json.heroes` / `database.json.skill` —
  pick the corrected name if and only if there's a single plausible
  match. List the pre-corrections in your chat summary so the user can
  challenge them.
- **Skip entries that fail validation.** If the corrected name still
  doesn't exist in `tips.json` (heroes) or `database.json` (skills), do
  not invent a new entry; flag it in chat and move on.

Quality bar:

- Tips are **single concise prose strings** (or short JSON objects for
  comps).
- Use **in-game terminology** (Chinese names, 增伤 / 借刀 / 区间 / 兵种 /
  阵营 vocabulary) consistently with existing entries.
- **Never invent** hero/skill names. Cross-check against
  `web/src/database.json` (skills) and `web/src/tips.json.heroes` (heroes).
  If a name doesn't match, either correct it or omit the tip.
- Hero entries must preserve the existing **`<role>排名第N`** prefix when
  refining (just append the new insight after a period).
- Skill entries must preserve the existing **tier label** (e.g. `T1+ —`)
  when refining.
- Don't propose new hero/skill entries — every name in the transcript
  should already exist; if not, that's an STT mishearing or an
  out-of-scope name and should be flagged in `review_checklist`.
- **Never include season / patch markers** (`S14`, `W11`, `赛季`, "现版本
  S14 …", etc.) — neither as bracket tags (`【S14】`, `【S14 演武】`) nor
  inline in prose. `tips.json` is regenerated as the meta evolves, so
  hard-coding a season number creates stale claims that will mislead the
  LLM next patch. If an insight is genuinely patch-bound and you can't
  rephrase it timelessly, prefer to **omit the tip entirely** and flag the
  ambiguity in your chat summary rather than ship a dated entry.

### Tagging & section discipline (learned 2026-05-20)

- **Do NOT add `【演武】` (or similar mode prefixes) as a tag.** The entire
  `tips.json` knowledge base — and the web app that consumes it — is
  exclusively about演武. Putting `【演武】` at the front of a tip is pure
  noise that bloats the runtime prompt. Same goes for redundant qualifiers
  in prose: write "张宁队" not "张宁演武队", "张宝位" not "演武 张宝位".
  Only use a bracketed prefix when it adds genuine disambiguation that the
  surrounding section can't already provide (e.g. `【张宁队反例】` to flag
  a hero-specific anti-pattern inside a skill entry). **Never** use a
  season prefix like `【S14】` — see the season-marker rule above.
- **Route insights to the right section. The `general` array is for
  cross-cutting principles that apply across many heroes/skills/comps.**
  If an insight is specific to one hero, it belongs in `heroes[<name>]`.
  If it's specific to one skill, it belongs in `skills[<name>]`. If it
  describes a specific lineup, it belongs in `team_compositions`. Do NOT
  write a long "design principle for X team" paragraph into `general` —
  break it apart and push the parts down:
  - Hero usage/avoidance rules → `heroes[<name>]`
  - Skill do/don't for that hero → `skills[<skill>]` with a brief
    `【<hero>反例】` or `【<hero>标配】` callout in the prose
  - Composition rationale → `note` field of the `team_compositions` entry

## Step 5 — Validate and report

After updating `web/src/tips.json`:

1. **Validate JSON** before announcing:
   ```bash
   uv run python -c "import json; json.load(open('web/src/tips.json'))"
   ```
2. **Verify no `[SRC: …]` leaked** into the file (these are review-only
   markers that must never ship to the runtime LLM):
   ```bash
   grep -c '\[SRC:' web/src/tips.json   # MUST return 0
   ```
   **CRASH WARNING:** The Rovo Dev CLI renders tool output through `rich`,
   which treats `[word]` as markup tags. Any `[SRC: ...]`, `[S14 演武]`,
   or similar bracket-patterns printed to the console will trigger
   `MarkupError("auto closing tag '[/]' has nothing to close")` and crash
   the CLI. **Never `print()` strings containing `[...]` patterns** from
   your merge script. Always redirect console output to a temp file:
   ```python
   with open('/tmp/merge_result.txt', 'w') as out:
       out.write(f"OK general={...} heroes={...}\n")
   ```
   Then read `/tmp/merge_result.txt` to verify.
3. **Run `web/` tests** if any tip schema-shaping changed:
   ```bash
   cd web && npm test
   ```
   (Skip e2e/build unless the user asks — pure data changes.)
4. **Print a concise chat summary** with:
   - counts per section (`general` +N, `heroes` +N/~M, `skills` +N/~M,
     `team_compositions` +N)
   - 1-line highlights of the most impactful additions
   - per-entry provenance table (entry name → confidence → `L###` /
     `OCR frame_NNNN` citations)
   - any STT mishearings you pre-corrected (so the user can challenge
     them)
5. **Tell the user how to review:**
   - `git diff web/src/tips.json` to see exactly what changed.
   - The chat summary above maps each new entry back to its source
     `L###` / `OCR frame_NNNN`.
   - `audio.srt` next to the transcript gives audio timestamps for
     re-listening.
6. **Do NOT auto-commit**. The user will trim / revert individual hunks
   via `git checkout -p` or by editing `tips.json` directly, then commit
   themselves.

## Step 6 — Cleanup (offer, don't force)

Offer the user three options:

- (a) **Keep** the audio + transcript (+ frames in mode B) — useful for
  future re-derivation if you decide an STT/OCR mishearing was wrong.
- (b) **Delete** the audio and frames but keep the transcript files (`.txt`
  + `.srt` + `.json`).
- (c) **Delete everything** including the transcript.

Wait for their choice; never auto-delete.

## When there is nothing useful to extract

If, after cross-referencing the transcript (+ OCR), you cannot identify a
durable insight that meets the quality bar, **do not write a proposal
file**. Tell the user clearly:

- How long the transcript was, what language was detected, and how many
  hero/skill terms were mentioned.
- (Mode B) how many frames had OCR content and what they showed.
- Why nothing rose to the threshold (e.g., "mostly chit-chat", "STT noise
  too high", "all observations duplicate existing tips").
- Suggest what kind of video would produce useful tips next time
  (gameplay-heavy commentary, post-match analysis, draft-pick discussion).

## Failure recovery

- **HTTP 412 from Bilibili even with `--playwright`** (Mode A): try
  `uv run learn download <url> --cookies-from-browser firefox` (Firefox has
  no Keychain prompt on macOS). Or have the user export `cookies.txt` from
  a logged-in browser and pass `--cookies-file`. If all download paths
  fail, ask them to use the Bilibili app to save the video locally and
  switch to **Mode B**.
- **`learn transcribe` errors with `tuple index out of range`** (Mode B):
  the file is probably a raw `.m4s` with Bilibili's 9-byte sentinel or an
  unusual codec. Always demux to a normal `.mp3` first
  (`ffmpeg -i <video>.mp4 -vn -acodec libmp3lame -q:a 2 audio.mp3`).
- **Whisper produces gibberish**: check `language_probability` in the
  `.json`. If <0.7, force `--lang` explicitly. If still gibberish, drop to
  `--model large-v3` (slower but more accurate than turbo).
- **OCR returns nothing** (Mode B): confirm `tesseract --list-langs`
  includes `chi_sim`. If missing, `brew install tesseract-lang`. If the
  source video is rendered Chinese in unusual fonts, try `--psm 6`
  (assume a uniform block of text) in `run_ocr.py`.
- **Transcript line numbering disagrees with what the user sees**:
  remember that the convention is **1-based, blank lines stripped** — easy
  to mis-count. Always reproduce the same `lines = [l.strip() for l in
  open(...) if l.strip()]` extraction when verifying.

## Helper scripts living under `learn/`

These scripts are committed and survive cleanup:

- `learn/strip_m4s.py` — strips the 9-byte Bilibili sentinel from `.m4s`
  chunks before muxing (Mode B prerequisite).
- `learn/run_ocr.py` — batched Tesseract OCR over every `learn/frames/*.jpg`
  (Mode B prerequisite).

One-off prototypes for native multimodal-model video ingestion (Gemini-via-
proxy) were explored and deleted. If a native video-capable model becomes
available, it can replace Mode B entirely — but as of writing, Mode B
(local OCR + Whisper) is the production path.
