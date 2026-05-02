# Self-Improvement: Update web/src/tips.json from Conversation

You are helping the user maintain `web/src/tips.json`, the knowledge base
of player tips for the 三国谋定天下 web app. This file feeds
`formatRelevantTips` in `web/src/services/promptGenerator.js` and is the
HIGHEST-PRIORITY signal in every per-round AI recommendation prompt.

When the user invokes `/improve-tips`, scan the **current chat session**
for any insight **the user has stated or confirmed** while analysing
rounds. **Only extract from the user's own messages** — do NOT mine
your own (the assistant's) prior analysis, speculation, or
recommendations as a source of tips. The user's input is the sole
source of truth; your role is to recognise, categorise, and apply
their insights, not to invent or self-cite. Examples of insights to
look for in the user's messages:

- A hero turned out to be much stronger / weaker in a specific role than
  the existing tip suggests.
- A particular three-hero combination dominated several games.
- A skill has a non-obvious counter or synergy that wasn't documented.
- A general game mechanic (damage layering, formation
  interaction, etc.) became clearer through play.

Then propose targeted edits to `web/src/tips.json` and apply them
directly to the file using the available file tools.

## tips.json schema (do not change the top-level shape)

```jsonc
{
  "general": [
    "<generic, game-wide insight as one prose string>",
    ...
  ],
  "team_compositions": [
    {
      "heroes": ["<hero1>", "<hero2>", "<hero3>"],
      "tier":   "OP" | "T0" | "T1" | "T2" | ...,
      "strength": "<low_score>→<high_score>",   // e.g. "S→SSS"
      "note":   "<optional short note>"          // optional
    },
    ...
  ],
  "heroes": {
    "<hero_name>": "<single-string tip about that hero>",
    ...
  },
  "skills": {
    "<skill_name>": "<single-string tip about that skill>",
    ...
  }
}
```

Keys are exact in-game names (Chinese). Values are concise prose
strings. `team_compositions` is the only array of objects; the others
are either an array of strings (`general`) or string-valued objects
(`heroes`, `skills`).

## Workflow

1. **Read** `web/src/tips.json` first — never propose edits without
   knowing the current state of the file.
2. **Mine the user's messages only**, focusing on the most recent
   round-by-round discussions (whether full or incremental prompts
   were used). **Do not extract insights from your own (the
   assistant's) earlier replies** — even if they seem correct or went
   unchallenged. An assistant claim only counts if the user later
   restated, endorsed, or built on it in their own words. Ignore
   tangents and confirmation-only exchanges. Extract concrete, durable
   insights from the user — not one-off tactical comments.
3. **Categorise each insight** into one of the four sections:
   - `general` — applies to all games, all heroes (e.g., damage layering
     mechanics, opening strategy).
   - `team_compositions` — a specific 3-hero core that proved
     consistently strong; pick a `tier` and `strength` based on
     observed performance and what the existing entries use.
   - `heroes` — a single hero's role, strengths, weaknesses, key
     partners.
   - `skills` — a single skill's optimal user, counter, or non-obvious
     synergy.
4. **Compare with existing entries**:
   - If the entry **does not exist**, plan an addition.
   - If the entry **exists and the new insight refines it**, plan a
     replacement that preserves the still-correct part of the old text
     and incorporates the new insight (do not strictly append — keep
     the value concise and re-write if it reads better).
   - If the entry **contradicts** the new insight and you are
     confident, plan a replacement that uses the new insight.
   - If you are NOT confident (single observation, lots of randomness,
     small sample), do **not** edit — call it out as a "low-confidence
     candidate" in your summary instead.
5. **Show a concise diff plan in chat first** — list every planned
   add/modify/remove with one line each, grouped by section. This is
   for the user to skim, not to ask permission.
6. **Apply the edits directly** to `web/src/tips.json` using file
   tools. Preserve the existing formatting style (2-space indentation,
   trailing comma rules, key ordering inside `team_compositions`
   objects: `heroes`, `tier`, `strength`, optional `note`).
7. **Validate** that the edited file is still valid JSON. If `jq` or
   `python3 -m json.tool` is available, run it to confirm. If validation
   fails, fix and re-validate.
8. **Run tests + build** per `web/AGENTS.md`:
   ```bash
   cd web
   CI=true npm test
   npm run test:e2e
   npm run build
   ```
   These should all pass — `tips.json` is consumed at runtime so a
   broken file would surface in unit tests for `promptGenerator`.
9. **Summarise** what was changed with the file path and a one-line
   description per change.

## Quality bar

- Be concise. Each tip value is a single prose string; do not write a
  paragraph where a sentence will do.
- Be **specific** and actionable. Vague tips like "this hero is good"
  are worse than no tip at all because they take up token budget in
  every round prompt.
- Use **in-game terminology** (Chinese names, the existing 增伤 / 借刀
  / 区间 / 兵种 / 阵营 etc. vocabulary) consistently with existing
  entries.
- **Never invent** hero/skill names. If you are unsure a name is the
  exact in-game spelling, search `web/src/database2.json` to confirm.
- **Never** restructure the top-level schema or rename existing keys.
- **Never** delete an existing entry unless the user explicitly asks
  or the conversation made it crystal clear the previous tip was
  factually wrong.

## When there is nothing useful to extract

If, after scanning the conversation, you cannot identify a durable
insight that meets the quality bar, **do not edit the file**. Tell the
user clearly what you reviewed and why nothing rose to the threshold
(e.g., "only one game observed, mostly tactical comments, no
generalisable pattern"). Suggest what kind of conversation would
produce useful tips next time.
