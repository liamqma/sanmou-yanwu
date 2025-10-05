# Team Optimization Improvement Plan

## Current Implementation Analysis

### What it does now (Lines 625-853):
1. **Random sampling**: Tries 500 random team configurations
2. **Parallel processing**: Uses ThreadPoolExecutor with up to 8 workers
3. **Greedy skill assignment**: For each team, tries combinations of skills
4. **Scoring function**: Combines individual scores + pairwise synergies

### Problems with current approach:
1. ❌ **Random = Inefficient**: 500 attempts might miss optimal solution
2. ❌ **No learning**: Doesn't use information from previous attempts
3. ❌ **Skill assignment bottleneck**: Nested brute force is slow
4. ❌ **No diversity**: May get stuck in local optima
5. ❌ **Hard to tune**: Magic numbers everywhere (500, max_skill_combos=300, etc.)

---

## Better Approaches (Ranked by Complexity)

### 🥉 Level 1: Improved Heuristics (Easiest - Recommended Start)
**Time to implement**: 1-2 days  
**Performance gain**: 2-5x better solutions, similar speed

#### Approach: Greedy + Local Search
```python
def optimize_teams_greedy(self, heroes, skills):
    """
    1. Sort heroes/skills by individual scores (best first)
    2. Greedily assign to teams considering synergies
    3. Use local search to swap members between teams
    4. Repeat multiple times with different orderings
    """
    
    # Phase 1: Greedy construction
    # - Start with best hero, assign to team 1
    # - Pick next hero that has best synergy with team 1
    # - Continue until team 1 has 3 heroes
    # - Repeat for teams 2 and 3
    
    # Phase 2: Local search improvements
    # - Try swapping heroes between teams
    # - Try swapping skills between teams
    # - Accept swap if it improves total score
    # - Repeat until no improvement
    
    # Phase 3: Multi-start
    # - Repeat 50-100 times with random orderings
    # - Keep best solution found
```

**Advantages:**
- ✅ Much faster than random sampling
- ✅ Guaranteed to find reasonable solution
- ✅ Easy to understand and debug
- ✅ Uses your existing scoring function

**Key improvements over current:**
1. **Greedy construction**: Build teams smartly instead of randomly
2. **Local search**: Refine solution by swapping
3. **Multi-start**: Run multiple times to escape local optima

---

### 🥈 Level 2: Genetic Algorithm (Medium - Great for Learning)
**Time to implement**: 3-5 days  
**Performance gain**: 5-10x better solutions  
**ML Learning**: Excellent introduction to evolutionary algorithms

#### Concept:
Teams are "DNA" that evolve over generations to become better

```python
from deap import base, creator, tools, algorithms
import random

def optimize_teams_genetic(self, heroes, skills, population_size=100, generations=50):
    """
    Genetic Algorithm for team optimization
    
    Chromosome (individual): A complete team configuration
    - 9 heroes (3 per team) + 18 skills (6 per team, 2 per hero)
    
    Fitness: Your calculate_team_score function
    
    Operators:
    - Selection: Tournament selection (pick best from random subset)
    - Crossover: Swap teams between two configurations
    - Mutation: Swap heroes/skills within or between teams
    """
    
    # 1. Create initial population (100 random team configs)
    population = []
    for _ in range(population_size):
        individual = create_random_team_config(heroes, skills)
        population.append(individual)
    
    # 2. Evolve for N generations
    for generation in range(generations):
        # Evaluate fitness
        fitnesses = [calculate_fitness(ind) for ind in population]
        
        # Select parents (tournament selection)
        parents = tournament_selection(population, fitnesses, k=50)
        
        # Create offspring via crossover
        offspring = []
        for i in range(0, len(parents), 2):
            child1, child2 = crossover(parents[i], parents[i+1])
            offspring.extend([child1, child2])
        
        # Mutate offspring
        for child in offspring:
            if random.random() < 0.2:  # 20% mutation rate
                mutate(child)
        
        # Replace population (elitism: keep top 10%)
        combined = population + offspring
        combined.sort(key=calculate_fitness, reverse=True)
        population = combined[:population_size]
    
    # 3. Return best solution
    best = max(population, key=calculate_fitness)
    return convert_to_team_format(best)
```

#### Key Components:

**1. Encoding (Chromosome representation):**
```python
class TeamConfiguration:
    def __init__(self):
        # Team assignments as lists
        self.team1_heroes = []  # 3 heroes
        self.team2_heroes = []  # 3 heroes
        self.team3_heroes = []  # 3 heroes
        
        # Skill assignments as dict: hero -> [skill1, skill2]
        self.skill_assignments = {}
    
    def to_chromosome(self):
        """Convert to list for GA operators"""
        # [h1, h2, h3, h4, h5, h6, h7, h8, h9, s1, s2, ..., s18]
        return (self.team1_heroes + self.team2_heroes + self.team3_heroes + 
                flatten(self.skill_assignments))
```

**2. Crossover (Breeding):**
```python
def crossover_teams(parent1, parent2):
    """Single-point crossover: swap entire teams"""
    child1 = parent1.copy()
    child2 = parent2.copy()
    
    # Swap team 2 and team 3 between parents
    child1.team2_heroes = parent2.team2_heroes
    child1.team3_heroes = parent2.team3_heroes
    
    child2.team2_heroes = parent1.team2_heroes
    child2.team3_heroes = parent1.team3_heroes
    
    # Recalculate skill assignments for swapped teams
    child1.skill_assignments = reassign_skills(child1)
    child2.skill_assignments = reassign_skills(child2)
    
    return child1, child2
```

**3. Mutation (Random changes):**
```python
def mutate_team_config(individual):
    """Randomly modify the configuration"""
    mutation_type = random.choice(['swap_heroes', 'swap_skills', 'reassign_skills'])
    
    if mutation_type == 'swap_heroes':
        # Swap a hero between two teams
        team1_idx = random.randint(0, 2)
        team2_idx = random.randint(0, 2)
        
        all_teams = [individual.team1_heroes, individual.team2_heroes, individual.team3_heroes]
        h1 = all_teams[0][random.randint(0, 2)]
        h2 = all_teams[1][random.randint(0, 2)]
        
        # Swap them
        all_teams[0][all_teams[0].index(h1)] = h2
        all_teams[1][all_teams[1].index(h2)] = h1
    
    elif mutation_type == 'swap_skills':
        # Swap skills between two heroes
        hero1, hero2 = random.sample(list(individual.skill_assignments.keys()), 2)
        skill1 = random.choice(individual.skill_assignments[hero1])
        skill2 = random.choice(individual.skill_assignments[hero2])
        
        individual.skill_assignments[hero1].remove(skill1)
        individual.skill_assignments[hero1].append(skill2)
        individual.skill_assignments[hero2].remove(skill2)
        individual.skill_assignments[hero2].append(skill1)
    
    elif mutation_type == 'reassign_skills':
        # Completely reassign skills for one team
        team = random.choice([1, 2, 3])
        # ... reassign skills greedily for that team
    
    return individual
```

**4. Fitness function (already have!):**
```python
def calculate_fitness(individual):
    """Use your existing scoring logic"""
    total_score = 0.0
    
    for team_heroes, team_skills in individual.get_teams():
        total_score += calculate_team_score(team_heroes, team_skills)
    
    return total_score
```

#### Implementation with DEAP library:
```python
from deap import base, creator, tools, algorithms
import random

def optimize_teams_ga(self, heroes, skills, pop_size=100, n_gen=50):
    """Genetic Algorithm using DEAP library"""
    
    # 1. Setup DEAP
    creator.create("FitnessMax", base.Fitness, weights=(1.0,))  # Maximize score
    creator.create("Individual", list, fitness=creator.FitnessMax)
    
    toolbox = base.Toolbox()
    
    # Individual generator
    toolbox.register("individual", self._create_random_team_config, heroes, skills)
    toolbox.register("population", tools.initRepeat, list, toolbox.individual)
    
    # Genetic operators
    toolbox.register("evaluate", self._evaluate_team_config)
    toolbox.register("mate", self._crossover_teams)
    toolbox.register("mutate", self._mutate_team, indpb=0.2)
    toolbox.register("select", tools.selTournament, tournsize=3)
    
    # 2. Run evolution
    population = toolbox.population(n=pop_size)
    
    # Use built-in algorithm
    final_pop, logbook = algorithms.eaSimple(
        population, toolbox,
        cxpb=0.7,  # 70% crossover probability
        mutpb=0.2,  # 20% mutation probability
        ngen=n_gen,
        verbose=True
    )
    
    # 3. Return best
    best = tools.selBest(final_pop, k=1)[0]
    return self._convert_to_team_format(best)
```

**Advantages:**
- ✅ Explores solution space intelligently
- ✅ Balances exploration (mutation) vs exploitation (crossover)
- ✅ Proven to work well for combinatorial problems
- ✅ Great for learning evolutionary algorithms
- ✅ DEAP library handles complexity for you

**Learning resources:**
- [DEAP documentation](https://deap.readthedocs.io/)
- [Genetic Algorithms tutorial](https://towardsdatascience.com/introduction-to-genetic-algorithms-including-example-code-e396e98d8bf3)

---

### 🥇 Level 3: Integer Linear Programming (Advanced - Best Solution)
**Time to implement**: 1 week  
**Performance gain**: Guaranteed optimal (or near-optimal with timeout)  
**When to use**: When you need the absolute best solution

#### Concept:
Formulate as optimization problem, let solver find optimal solution

```python
from pulp import LpMaximize, LpProblem, LpVariable, lpSum, LpBinary

def optimize_teams_ilp(self, heroes, skills):
    """
    Integer Linear Programming approach
    
    Decision variables:
    - x[h,t] = 1 if hero h is assigned to team t, else 0
    - y[s,h] = 1 if skill s is assigned to hero h, else 0
    
    Objective:
    Maximize: sum of all scores (individual + pairwise synergies)
    
    Constraints:
    - Each hero assigned to exactly 1 team
    - Each team has exactly 3 heroes
    - Each skill assigned to exactly 1 hero
    - Each hero has exactly 2 skills
    - Only heroes in same team can have synergy bonus
    """
    
    # 1. Create problem
    prob = LpProblem("TeamOptimization", LpMaximize)
    
    # 2. Decision variables
    # x[h,t] = 1 if hero h in team t
    hero_vars = {}
    for h in heroes:
        for t in [1, 2, 3]:
            hero_vars[(h, t)] = LpVariable(f"hero_{h}_team{t}", cat=LpBinary)
    
    # y[s,h] = 1 if skill s assigned to hero h
    skill_vars = {}
    for s in skills:
        for h in heroes:
            skill_vars[(s, h)] = LpVariable(f"skill_{s}_hero_{h}", cat=LpBinary)
    
    # z[h1,h2,t] = 1 if both h1 and h2 are in team t (for synergy)
    synergy_vars = {}
    for h1 in heroes:
        for h2 in heroes:
            if h1 < h2:  # Avoid duplicates
                for t in [1, 2, 3]:
                    synergy_vars[(h1, h2, t)] = LpVariable(
                        f"synergy_{h1}_{h2}_team{t}", cat=LpBinary
                    )
    
    # 3. Objective function
    objective = 0
    
    # Individual hero scores
    for h in heroes:
        hero_score = self.get_hero_confidence_score(h)
        for t in [1, 2, 3]:
            objective += hero_score * hero_vars[(h, t)]
    
    # Individual skill scores
    for s in skills:
        skill_score = self.get_skill_confidence_score(s)
        for h in heroes:
            objective += skill_score * skill_vars[(s, h)]
    
    # Hero-hero synergy scores
    for h1 in heroes:
        for h2 in heroes:
            if h1 < h2:
                wilson, total = self._get_hero_pair_wilson(h1, h2)
                if total >= 2 and wilson >= 0.4:
                    synergy_score = wilson * 5.0
                    for t in [1, 2, 3]:
                        objective += synergy_score * synergy_vars[(h1, h2, t)]
    
    # (Add skill-skill and hero-skill synergies similarly)
    
    prob += objective
    
    # 4. Constraints
    
    # Each hero in exactly one team
    for h in heroes[:9]:  # Only use first 9 heroes
        prob += lpSum([hero_vars[(h, t)] for t in [1, 2, 3]]) == 1
    
    # Each team has exactly 3 heroes
    for t in [1, 2, 3]:
        prob += lpSum([hero_vars[(h, t)] for h in heroes[:9]]) == 3
    
    # Each skill assigned to exactly one hero
    for s in skills[:18]:
        prob += lpSum([skill_vars[(s, h)] for h in heroes[:9]]) == 1
    
    # Each hero gets exactly 2 skills
    for h in heroes[:9]:
        prob += lpSum([skill_vars[(s, h)] for s in skills[:18]]) == 2
    
    # Synergy constraints: z[h1,h2,t] = 1 only if both in team t
    for h1 in heroes:
        for h2 in heroes:
            if h1 < h2:
                for t in [1, 2, 3]:
                    # z <= x[h1,t]
                    prob += synergy_vars[(h1, h2, t)] <= hero_vars[(h1, t)]
                    # z <= x[h2,t]
                    prob += synergy_vars[(h1, h2, t)] <= hero_vars[(h2, t)]
                    # z >= x[h1,t] + x[h2,t] - 1
                    prob += (synergy_vars[(h1, h2, t)] >= 
                            hero_vars[(h1, t)] + hero_vars[(h2, t)] - 1)
    
    # 5. Solve
    prob.solve()
    
    # 6. Extract solution
    teams = {1: [], 2: [], 3: []}
    for (h, t), var in hero_vars.items():
        if var.varValue == 1:
            teams[t].append(h)
    
    skill_assignments = {}
    for (s, h), var in skill_vars.items():
        if var.varValue == 1:
            if h not in skill_assignments:
                skill_assignments[h] = []
            skill_assignments[h].append(s)
    
    return format_teams(teams, skill_assignments)
```

**Advantages:**
- ✅ **Guaranteed optimal** (within time limit)
- ✅ Considers all constraints explicitly
- ✅ Solver handles the hard work
- ✅ Can add complex constraints easily

**Disadvantages:**
- ❌ Complex to set up
- ❌ May be slow for very large problems (>20 heroes, >40 skills)
- ❌ Need to linearize non-linear synergy terms

**When to use:**
- Small-medium problem sizes (<20 heroes)
- Need provably optimal solution
- Have complex constraints (e.g., role requirements, skill restrictions)

---

## Recommendation: Start with Level 1 (Greedy + Local Search)

### Why?
1. **Fast to implement** (1-2 days)
2. **Easy to understand** and debug
3. **Big improvement** over random (2-5x better)
4. **Foundation** for more advanced methods
5. **Uses existing code** (your scoring functions)

### Implementation Plan (Weekend Project)

#### Saturday: Greedy Construction
```python
def optimize_teams_greedy_v1(self, heroes, skills):
    """Phase 1: Greedy team construction"""
    
    # Sort heroes by individual score
    hero_scores = [(h, self.get_hero_confidence_score(h)) for h in heroes]
    hero_scores.sort(key=lambda x: x[1], reverse=True)
    sorted_heroes = [h for h, _ in hero_scores]
    
    # Initialize teams
    teams = [[], [], []]
    
    # Assign heroes greedily
    for hero in sorted_heroes[:9]:
        # Find team that maximizes synergy with this hero
        best_team_idx = 0
        best_synergy = -float('inf')
        
        for t_idx in range(3):
            if len(teams[t_idx]) >= 3:
                continue
            
            # Calculate synergy with current team members
            synergy = 0.0
            for teammate in teams[t_idx]:
                wilson, total = self._get_hero_pair_wilson(hero, teammate)
                if total >= 2:
                    synergy += wilson
            
            if synergy > best_synergy:
                best_synergy = synergy
                best_team_idx = t_idx
        
        teams[best_team_idx].append(hero)
    
    # Assign skills greedily to each team
    skill_scores = [(s, self.get_skill_confidence_score(s)) for s in skills]
    skill_scores.sort(key=lambda x: x[1], reverse=True)
    sorted_skills = [s for s, _ in skill_scores]
    
    skill_assignments = {}
    remaining_skills = sorted_skills[:18].copy()
    
    for team in teams:
        for hero in team:
            # Assign 2 best remaining skills for this hero
            best_skills = []
            for skill in remaining_skills:
                wilson, total = self._get_skill_hero_pair_wilson(hero, skill)
                best_skills.append((skill, wilson))
            
            best_skills.sort(key=lambda x: x[1], reverse=True)
            hero_skills = [best_skills[0][0], best_skills[1][0]]
            skill_assignments[hero] = hero_skills
            
            for s in hero_skills:
                remaining_skills.remove(s)
    
    return teams, skill_assignments
```

#### Sunday: Local Search Refinement
```python
def local_search_swap(self, teams, skill_assignments):
    """Phase 2: Improve via swapping"""
    
    improved = True
    iterations = 0
    max_iterations = 100
    
    while improved and iterations < max_iterations:
        improved = False
        current_score = self.evaluate_all_teams(teams, skill_assignments)
        
        # Try swapping heroes between teams
        for t1 in range(3):
            for t2 in range(t1 + 1, 3):
                for h1 in teams[t1]:
                    for h2 in teams[t2]:
                        # Try swap
                        teams[t1].remove(h1)
                        teams[t1].append(h2)
                        teams[t2].remove(h2)
                        teams[t2].append(h1)
                        
                        new_score = self.evaluate_all_teams(teams, skill_assignments)
                        
                        if new_score > current_score:
                            current_score = new_score
                            improved = True
                        else:
                            # Undo swap
                            teams[t1].remove(h2)
                            teams[t1].append(h1)
                            teams[t2].remove(h1)
                            teams[t2].append(h2)
        
        # Try swapping skills between heroes
        all_heroes = [h for team in teams for h in team]
        for h1 in all_heroes:
            for h2 in all_heroes:
                if h1 == h2:
                    continue
                for s1 in skill_assignments[h1]:
                    for s2 in skill_assignments[h2]:
                        # Try swap
                        skill_assignments[h1].remove(s1)
                        skill_assignments[h1].append(s2)
                        skill_assignments[h2].remove(s2)
                        skill_assignments[h2].append(s1)
                        
                        new_score = self.evaluate_all_teams(teams, skill_assignments)
                        
                        if new_score > current_score:
                            current_score = new_score
                            improved = True
                        else:
                            # Undo swap
                            skill_assignments[h1].remove(s2)
                            skill_assignments[h1].append(s1)
                            skill_assignments[h2].remove(s1)
                            skill_assignments[h2].append(s2)
        
        iterations += 1
    
    return teams, skill_assignments
```

---

## Comparison Table

| Approach | Time to Implement | Solution Quality | Speed | ML Learning Value |
|----------|------------------|------------------|-------|-------------------|
| **Current (Random)** | Done | 40/100 | Fast | Low |
| **Greedy + Local Search** | 1-2 days | 70/100 | Fast | Medium |
| **Genetic Algorithm** | 3-5 days | 85/100 | Medium | High |
| **Integer Linear Programming** | 1 week | 95-100/100 | Slow-Medium | Low (but valuable) |
| **Machine Learning** | 2-3 weeks | 80-90/100 | Fast (after training) | Very High |

---

## Next Steps

### Immediate (This Week):
1. ✅ Read this plan
2. Implement greedy construction (Saturday)
3. Add local search (Sunday)
4. Test on your data
5. Compare to current random approach

### Short-term (Next 2 weeks):
1. Learn Genetic Algorithms (DEAP tutorial)
2. Implement GA version
3. Compare all 3 approaches
4. Pick best for production

### Long-term (1-2 months):
1. Try ILP for small problems
2. Explore ML approaches (reinforcement learning)
3. Build hybrid system (greedy + ML scoring)

---

## Questions?

Would you like me to:
1. **Implement the greedy + local search version** for you now?
2. **Write the genetic algorithm code** with detailed comments?
3. **Create a comparison script** to benchmark all approaches?
4. **Explain any specific algorithm** in more detail?
5. **Something else?**

Let me know what you'd like to focus on!
