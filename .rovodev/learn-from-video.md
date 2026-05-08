# Self-Improvement: Update web/src/tips.json from a Video

You are helping the user maintain `web/src/tips.json`, the knowledge base of
player tips for the 三国谋定天下 web app. This file feeds
`formatRelevantTips` in `web/src/services/promptGenerator.js` and is the
**HIGHEST-PRIORITY signal** in every per-round AI recommendation prompt.

When the user invokes `/learn-from-video <URL>`, run the end-to-end pipeline:

```
URL ──▶ ./learn  ──▶ audio + transcript
                              │
                              ▼
              cross-reference web/src/database.json
                              │
                              ▼
         propose tips.json edits ──▶ user reviews ──▶ merge
```

The user will paste a video link (Bilibili, Douyin, YouTube, etc.). Treat the
streamer as a domain expert; your job is to extract their concrete, durable
gameplay insights and reflect them in `tips.json` — not to invent your own
analysis.

## Pre-flight

1. **Confirm the URL with the user** if it isn't immediately clear what video
   they meant.
2. **Verify `./learn` is set up**:
   - The unified CLI lives in the workspace's uv environment. Run from the
     repo root: `uv run learn providers` and confirm bilibili/douyin/generic
     are registered.
   - If `uv run learn …` errors with "Failed to spawn", run
     `uv sync --all-packages` first.
3. **Read `web/src/tips.json`** so you know the current state before
   proposing changes — never propose edits blind.

## Step 1 — Download + transcribe

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
- Run the command **in the foreground** so you can monitor heartbeats. If the
  user is impatient, you may background it with `&` and poll `tail` on the
  log, but always wait until the **`Done in Xs … RTF=Yx`** line appears
  before moving on.

After the run, three sibling files exist next to the audio in
`learn/downloads/`:

- `<stem>.txt` — plain text, one segment per line
- `<stem>.srt` — timestamps for every segment (for re-listening)
- `<stem>.json` — per-segment objects with `start`, `end`, `text`

## Step 2 — Cross-reference against the game database

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

For each hit, dump 1–3 surrounding **non-empty** lines from the transcript so
you have actual quotes (not just hit counts) to ground each proposed tip in.

## Step 3 — Synthesise proposed tips

Write a **separate proposal file** at `web/src/tips.proposed.json` with this
shape (so the user can review before merging):

```jsonc
{
  "_meta": {
    "source": "<URL or platform + video title>",
    "source_audio": "learn/downloads/<stem>.mp3",
    "source_transcript": "learn/downloads/<stem>.txt",
    "instructions": "Review and merge selectively. Each tip is annotated with [SRC L#] line numbers in the .txt transcript so you can verify. STT mishearings flagged with (?). Confidence: ★★★ stated clearly | ★★ paraphrased | ★ inferred."
  },
  "general_additions": [
    { "tip": "<one prose string>", "confidence": "★★★", "transcript_evidence": "L41-L51" },
    ...
  ],
  "heroes_additions": {
    "<exact hero name>": "<full replacement value, including the existing 排名第N prefix if present>",
    ...
  },
  "skills_additions": {
    "<exact skill name>": "<full replacement value, e.g. 'T1+ — <new insight>.'>",
    ...
  },
  "team_compositions_additions": [
    {
      "heroes": ["<h1>","<h2>","<h3>"],
      "tier": "OP|T0|T1+|T1|T2|T3|T4",
      "slot": "<一号位|二号位|三号位|...>",
      "awakening_dependency": "<低|中|高|很高|极高>",
      "strength": "<低分>→<高分>",
      "note": "<optional short note>",
      "confidence": "★★★",
      "transcript_evidence": "L###-L###"
    },
    ...
  ],
  "review_checklist": [
    "1. STT mishearings to verify: ...",
    "2. Conflicts with existing entries: ...",
    "3. Version-specific claims (tag with patch number): ...",
    ...
  ]
}
```

Annotation rules:

- **Each tip MUST cite its source** with `[SRC: L###]` (or
  `[SRC: L###-L###, L###-L###]` for multiple ranges) embedded inline in the
  string. Line numbers are **1-based indices into the non-empty lines of the
  `.txt` file** — produced by:

  ```python
  lines = [l.strip() for l in open(txt_path, encoding='utf-8') if l.strip()]
  ```

  This is the same convention the user is used to and lets them grep / re-listen.
- **Confidence rating** for every entry:
  - `★★★` — streamer states the claim explicitly
  - `★★`  — paraphrase / strong implication
  - `★`   — your inference (be sparing)
- **Flag STT mishearings**. `faster-whisper` mis-hears game jargon (e.g.
  `朱镕`, `恒征`, `B7锐器`, `略阵破均`, `电话` etc.). Mark suspect tokens
  with `(?)` in the tip and list them in `review_checklist[0]`.

Quality bar (inherited from `improve-tips.md`):

- Tips are **single concise prose strings** (or short JSON objects for comps).
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
- Flag any **version-specific** claim (e.g. "现版本 S14 …") so it can be
  refreshed when the patch changes.

## Step 4 — Show the user the proposal & wait

After writing `web/src/tips.proposed.json`:

1. Print a **concise summary** in chat with counts per section and 1-line
   highlights of the most impactful additions.
2. Tell the user how to review:
   - Open `web/src/tips.proposed.json` directly.
   - Each entry has `[SRC: L###]` pointing into
     `learn/downloads/<stem>.txt`. Use the `.srt` to find the audio
     timestamp if they want to re-listen.
3. **Wait for the user to edit** the proposal (they will trim / approve /
   reject entries in place).
4. Then ask explicitly: "Ready to merge what's left?" — do not auto-merge.

## Step 5 — Merge into tips.json

Once the user confirms, merge the surviving proposal into `web/src/tips.json`
programmatically. Use a small Python script (NOT manual edits) so:

- Top-level key order (`general`, `team_compositions`, `heroes`, `skills`)
  is preserved (use `collections.OrderedDict` + `object_pairs_hook`).
- `general_additions` are **appended** to the existing `general` array
  (skip duplicates by exact-string match).
- `heroes_additions` and `skills_additions` are **overwrites** of existing
  keys (insert if missing).
- `team_compositions_additions` are **appended** (drop the
  `confidence` / `transcript_evidence` helper keys before insertion;
  preserve only `heroes`, `tier`, `slot`, `awakening_dependency`,
  `strength`, `note`).
- The merged file is **valid JSON** (no trailing commas; UTF-8;
  `ensure_ascii=False`; 2-space indent; trailing newline).

After the merge:

1. Validate JSON with `python3 -c "import json; json.load(open('web/src/tips.json'))"`.
2. Run `web/AGENTS.md` test commands if any tip schema-shaping changed:
   ```bash
   cd web
   CI=true npm test
   ```
   (Skip e2e/build unless the user asks — these tips changes are pure data.)
3. **Strip `[SRC: …]` citations** from `tips.json` after merge.
   **CRASH WARNING:** The Rovo Dev CLI renders tool output through `rich`,
   which treats `[word]` as markup tags. Any `[SRC: ...]`, `[S14 演武]`,
   or similar bracket-patterns printed to the console will trigger
   `MarkupError("auto closing tag '[/]' has nothing to close")` and crash
   the CLI. **Never `print()` strings containing `[...]` patterns** from
   the merge script. Always redirect console output to a temp file:
   ```python
   with open('/tmp/merge_result.txt', 'w') as out:
       out.write(f"OK general={...} heroes={...}\n")
   ```
   Then read `/tmp/merge_result.txt` to verify.
   This is **mandatory** — `tips.json` is shipped to the LLM at runtime, and
   `[SRC: …]` markers are review-only metadata that bloat the prompt and
   confuse the model. The stripper must run as part of the merge script
   (not as a follow-up), and after the merge `grep -c '\[SRC:' web/src/tips.json`
   MUST return `0`. Strip in three places:
   - inside every appended `general` string,
   - inside every overwritten `heroes` / `skills` value,
   - inside every appended `team_compositions[*].note`.

   Use a regex-based stripper applied to **every string in the merged tree**
   (defence in depth):
   ```python
   import re
   SRC = re.compile(r'\s*\[SRC:[^\]]*\]')
   def strip_src(s): return SRC.sub('', s).rstrip() if isinstance(s, str) else s
   ```
4. **Delete `web/src/tips.proposed.json`** so the workspace is clean.
5. Summarise what merged: counts per section + a 1-line description per
   change.

## Step 6 — Cleanup (offer, don't force)

Offer the user three options:

- (a) **Keep** the audio + transcript in `learn/downloads/` (default — useful
  for future re-derivation if you decide an STT mishearing was wrong).
- (b) **Delete** the audio (`<stem>.mp3`) but keep the transcript files
  (`.txt` + `.srt` + `.json`) — saves the most disk while preserving
  re-readable text.
- (c) **Delete everything** including the transcript.

Wait for their choice; never auto-delete.

## When there is nothing useful to extract

If, after cross-referencing the transcript, you cannot identify a durable
insight that meets the quality bar, **do not write a proposal file**. Tell
the user clearly:

- How long the transcript was, what language was detected, and how many
  hero/skill terms were mentioned.
- Why nothing rose to the threshold (e.g., "mostly chit-chat", "STT noise
  too high", "all observations duplicate existing tips").
- Suggest what kind of video would produce useful tips next time
  (gameplay-heavy commentary, post-match analysis, draft-pick discussion).

## Failure recovery

- **HTTP 412 from Bilibili even with `--playwright`**: try
  `uv run learn download <url> --cookies-from-browser firefox` (Firefox has
  no Keychain prompt on macOS). Or have the user export `cookies.txt` from
  a logged-in browser and pass `--cookies-file`.
- **Whisper produces gibberish**: check `language_probability` in the
  `.json`. If <0.7, force `--lang` explicitly. If still gibberish, drop to
  `--model large-v3` (slower but more accurate than turbo).
- **Transcript line numbering disagrees with what the user sees**:
  remember that the convention is **1-based, blank lines stripped** — easy
  to mis-count. Always reproduce the same `lines = [l.strip() for l in
  open(...) if l.strip()]` extraction when verifying.
