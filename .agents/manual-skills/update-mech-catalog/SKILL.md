---
name: update-mech-catalog
description: Explicitly updates the reviewed MECH v1 status-relationship catalog from new or changed database skill descriptions. Use only when the user invokes $update-mech-catalog, optionally followed by exact skill names.
---

# Update MECH Catalog

Update `web/public/game-data/mech.json` through language review plus the
deterministic `data/manage_mech_catalog.py` lifecycle. Read
[references/schema.md](references/schema.md) before extracting. The script must
never be used as a semantic extractor: you provide the language understanding.

Invocation modes:

```text
$update-mech-catalog
$update-mech-catalog 烈火张天 火烧连营
```

Without names, review every new, stale, or pending skill and synchronize removed
skills. Supplied names force a fresh review in addition to all maintenance needed
for a clean final status. Resolve supplied names by exact database key and fail
closed on any unknown name.

## Workflow

1. Run `uv run python data/manage_mech_catalog.py status --json`. Save the
   deterministic new/stale/removed/pending lists for the final summary.
2. Resolve every optional name exactly against `database.json.skills`; stop if
   any is unknown.
3. Run `bootstrap` when the catalog is absent, registry/coverage is stale, or
   skills were added/removed. It creates pending skeletons and canonical registry
   entries, removes deleted skill entries, and preserves active extraction
   content.
4. Select all new, stale, pending, and explicitly forced skills. Work in
   deterministic manageable batches. For each selected skill, read its complete
   current `name`, `type`, `prob`, and `desc`, plus canonical buff/debuff
   definitions relevant to its wording.
5. Re-extract that skill from scratch: replace its `relations` and `unresolved`
   arrays rather than merging assumptions from the old extraction. Preserve all
   unselected current entries byte-semantically unchanged.
6. Add only MECH v1 shared-status relationships supported by exact description
   substrings. Use the closed relation/subject enums in the schema reference.
   Keep evidence to the smallest useful phrase. Use `inferred` only with a
   concise text-grounded `reason`. The source-derived registry is exhaustive,
   not an extraction allowlist: do not create relationships for direct damage,
   damage types (including `传递伤害`), healing, coefficients, or target counts
   merely because their IDs are present in the registry.
7. Classify each named item deliberately:
   - Omit it when the full description clearly shows a unique skill-local
     internal counter/marker used only by that skill, or a unique non-dispellable
     ownership/equipment marker with no shared canonical relationship. Examples:
     云身、军令、玉玺.
   - Map it to a canonical category when the description and reviewed taxonomy
     safely support that mapping.
   - Put it in `unresolved` when it appears potentially shared or status-like but
     cannot be mapped safely. Never use omission merely to avoid reviewing an
     ambiguous name, and never invent an ID or generic `interacts_with` relation.
   It is valid—and expected—for most reviewed skills to have empty arrays.
8. Mark an entry `complete` only after reviewing its complete current
   description. Do not extract direct damage, damage types, healing,
   coefficients, target counts, probability, duration, strength estimates,
   general combat summaries, pairwise recommendations, or hero-to-carried-skill
   relationships. `prevents` must apply to the stated hero/team subject; omit a
   restriction that only says one generated attack or damage instance cannot
   crit because v1 has no attack-event subject.
9. After editing a batch, stamp only those exact reviewed names:

   ```bash
   uv run python data/manage_mech_catalog.py stamp <exact skill names...>
   ```

   Stamping validates structure and recomputes hashes; it never infers or changes
   relationships.
10. Run `uv run python data/manage_mech_catalog.py format`, then strict
    `validate`. Fix every structural, coverage, evidence, hash, duplicate, or
    pending error. Unresolved entries are allowed but must be reported for human
    attention.
11. Run `status --json` again and require no new, stale, removed, or pending
    entries and `update_required: false`.
12. Show `git diff -- web/public/game-data/mech.json` and summarize initial new,
    changed, and removed skills; relationship counts by kind; unresolved
    mechanics; and assumptions needing human review.
13. Stop without committing or pushing. Never change recommendation scoring,
    recommendation schemas/weights, or regenerate recommendation data.

A clean validation result proves structural coverage and freshness—not semantic
correctness. The user must inspect the JSON diff; human review is the approval
gate.
