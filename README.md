## Setup

- `web/public/database.json` contains the data for skills, heroes, and hero-skill mappings
- Copy game screenshots to `./data/images`
- Run `make extract` to extract battle data to `data/battles/` and update `web/public/battle_stats.json`
- Run `make web` to start the local development server

## Game Flow

**Initial Setup:**
- Start with 4 heroes and 4 skills

**Gameplay (8 rounds):**
- Round 1: Select 1 hero set from 3 options (each set contains 3 heroes)
- Round 2: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 3: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 4: Select 1 hero set from 3 options (each set contains 3 heroes)
- Round 5: Select 1 skill set from 3 options (each set contains 3 skills)
- Round 6: Select 1 skill set from 3 options (each set contains 3 skills)
- **After Round 6 (end of Cycle 2):** Pick 1 unchosen hero and 2 unchosen skills that are not hero skills *(unimplemented)*
- Round 7: Select 1 hero set from 3 options (each set contains 2 heroes)
- Round 8: Select 1 skill set from 3 options (each set contains 3 skills)
