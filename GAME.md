# Game Strategy System

## Overview
- Start with 4 heroes and 4 skills.
- Play two 3-round cycles (6 rounds total):
  1) Hero: pick 1 set from 3 options (each set has 3 heroes).
  2) Skill A: pick 1 set from 3 options (each has 3 skills).
  3) Skill B: pick 1 set from 3 options (each has 3 skills).
- End: pick 1 unchosen hero and 2 unchosen skills that are not hero skills (not in `skill_hero_map`).

## AI Recommendations
- Goals: winning hero combos, skill fit with chosen heroes, counters vs opponents, meta trends.
- Output: round-by-round suggestions based on the data.
