# Game Strategy System

## Game Overview

The game follows a strategic team-building format where players construct their battle teams through a series of selection rounds.

## Initial Setup
- Players start with **4 heroes** and **4 skills**
- Teams are built through multiple rounds of strategic choices

## Round Structure

The game consists of repeating 3-round cycles:

### Round 1: Hero Selection
- **Objective**: Choose 1 hero set from 3 available options
- **Format**: Each set contains 3 heroes
- **Strategy**: Consider hero synergies and counter-picks

### Round 2: Skill Selection (First Set)
- **Objective**: Choose 1 skill set from 3 available options  
- **Format**: Each set contains 3 skills
- **Strategy**: Match skills to selected heroes for optimal combinations

### Round 3: Skill Selection (Second Set)
- **Objective**: Choose 1 skill set from 3 available options
- **Format**: Each set contains 3 skills  
- **Strategy**: Complete team build with complementary skills

## Cycle Continuation
The 3-round structure repeats **once**, resulting in a total of 6 rounds to fully construct teams.

## AI Recommendation System

### Objective
Develop an intelligent recommendation system that analyzes historical battle data to provide optimal choice suggestions for each round.

### Data Source
- **Battle Results**: Located in `./battles/` directory
- **Historical Outcomes**: Team compositions and win/loss records
- **Skill Combinations**: Effective synergies and counter-strategies

### Recommendation Goals
1. **Hero Selection**: Identify winning hero combinations and meta trends
2. **Skill Optimization**: Recommend skill sets that complement chosen heroes
3. **Counter-Strategy**: Suggest picks that counter opponent team compositions
4. **Meta Analysis**: Track evolving strategies and successful patterns

### Implementation
The AI system should analyze extracted battle data to provide data-driven recommendations for optimal team building decisions in each round.