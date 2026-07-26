# Game Rules — 三国谋定天下 (演武)

The draft flow the analytics tool models. See [README.md](README.md) for setup
and project orientation.

## Game Flow

**Initial Setup:**
- Select 4 starting heroes and the 8 starting skills shared by both players,
  then identify which one of those 4 heroes is also shared by both players

**Gameplay (10 rounds):**
- Round 1: Select 1 hero set from 3 options (each set contains 3 heroes)
- Round 2: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 3: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 4: Select 1 hero set from 3 options (each set contains 3 heroes)
- Round 5: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 6: Select 1 skill set from 3 options (each set contains 3 skills)
- **Optional support pick (unchanged):** After Round 6, the current-team panel
  may add 1 unchosen hero and 2 unchosen non-hero skills. The support choices
  use the existing `recommendSingleHero` / `recommendTwoSkills`
  recommendations and are carried through the later rounds.
- **Qualification after Round 6:** Confirm the win in one click to unlock Round 7.
- Round 7: Select 1 hero set from 3 options (each set contains 2 heroes)
- Round 8: Select 1 skill set from 3 options (each set contains 3 skills)
- **Qualification after Round 8:** Confirm the win in one click to unlock Round 9.
- Round 9: Repeat the Round 7 format — select 1 hero set from 3 options
  (each set contains 2 heroes)
- Round 10: Repeat the Round 8 format — select 1 skill set from 3 options
  (each set contains 3 skills)
