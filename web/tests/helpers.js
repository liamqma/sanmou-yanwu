const database = require('../public/game-data/database.json');

// ── Game-state seeding ───────────────────────────────────────────────────────
// The app restores a versioned `gameProgress` localStorage envelope on mount.
// Seeding it lets acceptance tests jump straight into a specific round instead
// of clicking through the 4-hero/8-skill setup.
const GAME_PROGRESS_STORAGE_KEY = 'gameProgress';
const GAME_PROGRESS_STORAGE_VERSION = 1;

async function seedStoredProgress(page, progress) {
  const value = JSON.stringify({
    version: GAME_PROGRESS_STORAGE_VERSION,
    ...progress,
  });
  await page.context().clearCookies();
  // The session marker applies each seed once. That lets reload assertions
  // observe later app writes instead of resetting to the original fixture.
  await page.addInitScript(({ key, value: storedValue }) => {
    const markerKey = `${key}:playwright-seed`;
    if (sessionStorage.getItem(markerKey) !== storedValue) {
      localStorage.setItem(key, storedValue);
      sessionStorage.setItem(markerKey, storedValue);
    }
  }, { key: GAME_PROGRESS_STORAGE_KEY, value });
}

async function seedGame(page, gameState, currentRoundInputs) {
  await seedStoredProgress(page, { gameState, currentRoundInputs });
  await page.goto('/');
}

// Minimal valid game state for a given round. Skills list just needs to exist;
// its contents don't affect the assertions here.
function makeGameState({ roundNumber, heroes, skills }) {
  return {
    current_heroes: heroes,
    current_skills: skills,
    support_hero: null,
    support_skills: [],
    round_number: roundNumber,
    round_history: [],
  };
}

// ── Data-driven expectations (read straight from the merged database) ─────────
const heroesWithMeta = Object.entries(database.heroes)
  .filter(([, h]) => ['S', 'A', 'B', 'C', 'D'].includes(h.ranking))
  .map(([name]) => name);

// Display strings produced by web/src/components/game/AnalysisGrid.js → itemChipLabel.
const heroChipLabel = (name) => {
  const h = database.heroes[name];
  return `${name} · ${h.ranking}档`;
};

const rankedSkills = Object.entries(database.skills)
  .filter(([, skill]) => ['S', 'A', 'B', 'C', 'D'].includes(skill.ranking))
  .map(([name]) => name);

const skillChipLabel = (name) => {
  const skill = database.skills[name];
  return `${name} · ${skill.ranking}档`;
};

const anySkills = (n) => Object.keys(database.skills).slice(0, n);

// Strict battle-upload fixture: signature skill is positional slot 0; equipped
// slots exclude every catalog signature and all nine skills are unique per team.
function makeUploadTeam(heroNames) {
  const signatureSkills = new Set(
    Object.values(database.heroes).map((hero) => hero.skill),
  );
  const equippedSkills = Object.keys(database.skills).filter(
    (skill) => !signatureSkills.has(skill),
  );
  const used = new Set(heroNames.map((name) => database.heroes[name].skill));

  return heroNames.map((name) => {
    const equipped = equippedSkills
      .filter((skill) => !used.has(skill))
      .slice(0, 2);
    equipped.forEach((skill) => used.add(skill));
    return {
      name,
      skills: [database.heroes[name].skill, ...equipped],
    };
  });
}

function makeValidUploadBattle(winner = '1') {
  const heroNames = Object.keys(database.heroes);
  return {
    1: makeUploadTeam(heroNames.slice(0, 3)),
    2: makeUploadTeam(heroNames.slice(3, 6)),
    winner,
  };
}

module.exports = {
  database,
  seedGame,
  seedStoredProgress,
  makeGameState,
  heroesWithMeta,
  heroChipLabel,
  rankedSkills,
  skillChipLabel,
  anySkills,
  makeValidUploadBattle,
};
