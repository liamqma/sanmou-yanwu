# Game Rules — 三国谋定天下 (演武)

The draft flow the analytics tool models. See [README.md](README.md) for setup
and project orientation.

## Game Flow

**Initial Setup:**
- Start with 4 heroes and 8 skills

**Gameplay (8 rounds):**
- Round 1: Select 1 hero set from 3 options (each set contains 3 heroes)
- Round 2: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 3: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 4: Select 1 hero set from 3 options (each set contains 3 heroes)
- Round 5: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 6: Select 1 skill set from 3 options (each set contains 3 skills)
- **After Round 6 (end of Cycle 2):** Pick 1 unchosen hero and 2 unchosen skills that are not hero skills — implemented as the "support hero / support skills" pick (add from the current-team panel; recommendations via `recommendSingleHero` / `recommendTwoSkills`)
- Round 7: Select 1 hero set from 3 options (each set contains 2 heroes)
- Round 8: Select 1 skill set from 3 options (each set contains 3 skills)
